// Step 0 (bring the production-only schema into Git) against a throwaway local Postgres,
// never production. It proves two things about
// supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql:
//
//   1. Fidelity: each object it creates comes out exactly as production has it, row for
//      row in the same catalog queries the production verifier runs
//      (scripts/db/schema-queries.mjs), compared with the production evidence it was
//      written from (docs/control-plane/evidence/production-schema-snapshot-2026-10-28.json): columns,
//      constraints, indexes, RLS flags, function bodies, config and EXECUTE grants,
//      policy expressions, trigger definitions, buckets.
//   2. Idempotency: applied a second time it changes nothing (the whole snapshot hashes
//      the same), which is the same guard that makes it a no-op on production, where
//      every object already exists.
//
// The CI reset ("Supabase migration reset" in .github/workflows/reconciliation-ci.yml)
// proves the same on the real stack and writes supabase/schema-manifest.json.
//
// Postgres 16 has no MAINTAIN privilege, so on 16 the 'm' is dropped from production's
// table grants before comparing. Everything else must be equal.
//
// Usage: SCHEMA_RECONCILE_DB_URL=postgresql://postgres@/scratch?host=/var/tmp/pg&port=5497 \
//        node scripts/test/schema-reconcile-db.mjs
// (run by scripts/test-schema-reconcile-db.sh, which makes and drops the scratch database)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { snapshotDatabase, FIELDS } from '../db/verify-production-schema.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const url = process.env.SCHEMA_RECONCILE_DB_URL;
if (!url) { console.error('set SCHEMA_RECONCILE_DB_URL to a scratch database'); process.exit(2); }

export const BASELINE = 'supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql';

// The production-only objects of docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md.
export const EXPECTED = {
  relations: ['private.rate_limit_counters', 'private.rate_limit_salt', 'public._analytics_baseline_tmp', 'public.feed',
    'public.music_direct_entitlements', 'public.music_direct_offers', 'public.music_direct_orders', 'public.music_isrc_allocations',
    'public.music_isrc_registrants', 'public.network_attribution', 'public.network_operator_access_log', 'public.network_post_edges',
    'public.network_sessions', 'public.network_telemetry_events', 'public.network_user_features', 'public.ops_recommendations',
    'public.private_song_asset_chunks'],
  functions: ['private.enforce_anon_insert_rate_limit()', 'private.rate_limit_client_key()', 'public.is_org_member(p_org uuid)',
    'public.is_org_owner(p_org uuid)', 'public.kb_search(q text, q_embedding vector, match_count integer, rrf_k integer)',
    'public.mnet_feed_item_from_activity()', 'public.mnet_refresh_user_features(p_m_uid uuid)', 'public.mnet_seed_surface_config()',
    'public.music_assign_isrc(p_recording_id uuid)', 'public.network_profile_after_auth_link()'],
  policies: ['control_approvals :: control_approvals_decide', 'control_approvals :: control_approvals_read',
    'control_approvals :: control_approvals_request', 'control_audit :: control_audit_read',
    'control_capabilities :: control_capabilities_read', 'control_commands :: control_commands_read',
    'control_leases :: control_leases_read', 'control_role_capabilities :: control_role_capabilities_read',
    'feed :: feed_file', 'feed :: feed_pull', 'feed :: feed_read', 'mnet_onboarding_state :: mnet_onboarding_self',
    'mnet_surface_config :: mnet_surface_config_auth_read', 'network_activity :: network_activity_read',
    'network_activity :: network_activity_self_insert', 'network_attribution :: network_attribution_self_insert',
    'network_blocks :: network_blocks_self', 'network_bookmarks :: network_bookmarks_self',
    'network_connections :: network_connections_self_update', 'network_connections :: network_connections_self_write',
    'network_feed_items :: network_feed_items_auth_read', 'network_follows :: network_follows_self_read',
    'network_follows :: network_follows_self_write', 'network_mutes :: network_mutes_self',
    'network_post_edges :: network_post_edges_self_write', 'network_post_edges :: network_post_edges_visible',
    'network_profiles :: network_profiles_self', 'network_sessions :: network_sessions_self_insert',
    'network_sessions :: network_sessions_self_read', 'network_telemetry_events :: network_telemetry_self_insert']
    .map((k) => `public.${k}`)
    .concat(['l3_private_staff_delete', 'l3_private_staff_insert', 'l3_private_staff_select', 'l3_private_staff_update',
      'l3_public_staff_delete', 'l3_public_staff_insert', 'l3_public_staff_update'].map((p) => `storage.objects :: ${p}`)),
  triggers: ['public.events :: events_anon_rate_limit', 'public.leads :: leads_anon_rate_limit',
    'public.m_auth_user_links :: network_profile_after_auth_link_trg', 'public.network_activity :: network_activity_feed_item_trg',
    'public.network_posts :: network_posts_feed_item_trg', 'public.platform_apps :: platform_apps_mnet_surface_trg'],
  buckets: ['l3-product-files', 'l3-public'],
};
const KEYS = {
  relations: (r) => `${r[0]}.${r[1]}`,
  functions: (r) => `${r[0]}.${r[1]}(${r[2]})`,
  policies: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
  triggers: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
  buckets: (r) => r[0],
};

const psql = (file) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', url, '-f', path.join(ROOT, file)],
  { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
const serverVersion = Number(execFileSync('psql', ['-X', '-A', '-t', '-d', url, '-c', 'show server_version_num'], { encoding: 'utf8' }).trim());

const evidenceDir = path.join(ROOT, 'docs', 'control-plane', 'evidence');
// Pinned to the capture step 0 was written from. Group 0 (applied 2026-10-29, the
// 20261029010919.. migrations) later wrapped four of these policies' expressions in
// production; the CI reset applies those migrations after step 0, so the rebuilt schema
// still ends where production is.
const latest = 'production-schema-snapshot-2026-10-28.json';
const production = JSON.parse(readFileSync(path.join(evidenceDir, latest), 'utf8'));

for (const f of ['supabase/tests/supabase_api_roles.stub.sql', 'supabase/tests/supabase_storage.stub.sql',
  'supabase/tests/schema_reconcile_production_only.stub.sql', BASELINE]) psql(f);
// Read the catalogs with Supabase's default search_path ("$user", public, extensions), as the
// verifier does against production and the CI stack: deparsed defaults and expressions name an
// object without its schema when the schema is on the path.
process.env.PGOPTIONS = `-c client_min_messages=warning -c search_path="$user",public,extensions`;
const first = snapshotDatabase(url, { source: 'scratch' });
psql(BASELINE);
const second = snapshotDatabase(url, { source: 'scratch' });

const failures = [];
for (const name of Object.keys(EXPECTED)) {
  if (first.sections[name].md5 !== second.sections[name].md5) failures.push(`${name}: a second application changed the schema`);
  const key = KEYS[name];
  const have = new Map(first.sections[name].rows.map((r) => [key(r), r]));
  const want = new Map(production.sections[name].rows.map((r) => [key(r), r]));
  for (const k of EXPECTED[name]) {
    const w = want.get(k);
    const h = have.get(k);
    if (!w) { failures.push(`${name} ${k}: not in the production evidence ${latest}`); continue; }
    if (!h) { failures.push(`${name} ${k}: not created`); continue; }
    FIELDS[name].forEach((field, i) => {
      let expected = w[i];
      if (field === 'acl' && serverVersion < 170000) expected = String(expected).replace(/m/g, '');
      if (JSON.stringify(h[i]) !== JSON.stringify(expected)) failures.push(`${name} ${k}: ${field} is ${JSON.stringify(h[i])}, production has ${JSON.stringify(expected)}`);
    });
  }
}
assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
const total = Object.values(EXPECTED).reduce((n, l) => n + l.length, 0);
console.log(`schema reconcile: ${total} production-only objects rebuilt exactly as ${latest} records them; second application is a no-op (PostgreSQL ${serverVersion})`);
