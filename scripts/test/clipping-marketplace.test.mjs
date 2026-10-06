/* Clipping marketplace contracts: the boundaries that keep money honest and
   civic work separate, read from the source that ships. The database's
   behaviour (settlement, caps, holds, payouts) is proven end to end by
   supabase/tests/action_clipping_regression.sql; the Worker's platform reads
   by workers/mccluster/test/clipping.test.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (path) => fs.readFile(new URL('../../' + path, import.meta.url), 'utf8');
const MIGRATION = 'supabase/pending/action_clipping_marketplace_v1.sql';

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end);
}

test('the clipping migration waits in pending/ until it is applied in production', async () => {
  const [readme, ledger] = await Promise.all([read('supabase/pending/README.md'), read('supabase/production-ledger.json')]);
  assert.match(readme, /action_clipping_marketplace_v1\.sql/);
  assert.doesNotMatch(ledger, /clipping/, 'not claimed as applied before it is');
  await assert.rejects(fs.access(new URL('../../supabase/migrations/action_clipping_marketplace_v1.sql', import.meta.url)));
});

test('only Instagram is verifiable; YouTube and TikTok are off in the database and the Worker', async () => {
  const [sql, platforms] = await Promise.all([read(MIGRATION), read('workers/mccluster/src/clipping/platforms.js')]);
  assert.match(fnBody(sql, 'private.clip_platform_enabled'), /select p_platform = 'instagram'/);
  assert.match(platforms, /instagram:\s*\{\s*enabled:\s*true/);
  assert.match(platforms, /youtube:\s*\{\s*enabled:\s*false/);
  assert.match(platforms, /tiktok:\s*\{\s*enabled:\s*false/);
});

test('views are never taken from the member: submission carries a link, metrics come from the service role', async () => {
  const [sql, web, native] = await Promise.all([read(MIGRATION), read('js/mnet-clips.js'), read('native/src/actionNetwork.ts')]);
  assert.match(sql, /create or replace function public\.clip_submit\(p_mission uuid, p_platform text, p_url text, p_moment uuid default null\)/);
  for (const client of [web, native]) {
    const call = client.slice(client.indexOf('clip_submit'), client.indexOf('clip_submit') + 260);
    assert.doesNotMatch(call, /views|likes|screenshot/i, 'the client never reports a number');
  }
  assert.match(fnBody(sql, 'public.clip_record_metrics'), /'platform_api'/, 'snapshots are marked as platform reads');
  const grants = sql.slice(sql.indexOf('-- 9. Who may call what.'));
  for (const fn of ['clip_settle_submission(uuid)', 'clip_work_due(integer)', 'clip_record_verification(uuid, jsonb)',
    'clip_record_metrics(uuid, jsonb)', 'clip_release_due()', 'clip_attribute_conversions(timestamptz)',
    'clip_account_mark_verified(uuid, jsonb)', 'clip_check_fraud(uuid)']) {
    const at = grants.indexOf(`'public.${fn}'`);
    assert.ok(at > grants.indexOf('settlement is the Worker'), `${fn} is service-only`);
  }
});

test('every clipping table is server-only and the payout ledger guards itself', async () => {
  const sql = await read(MIGRATION);
  for (const table of ['action_clip_campaigns', 'action_clip_assets', 'action_clip_claims', 'action_clip_submissions',
    'action_clip_payouts', 'action_clip_earnings', 'action_clip_conversions']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`));
    assert.match(sql, new RegExp(`'${table}'`), `${table} is in the RLS/revoke loop`);
  }
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(sql, /idempotency_key\s+text not null unique/);
  assert.match(sql, /create trigger action_clip_earnings_guard before update or delete on public\.action_clip_earnings/);
  const guard = fnBody(sql, 'private.clip_earnings_guard');
  assert.match(guard, /append-only/);
  assert.match(guard, /never edited/);
});

test('settlement is budget-safe: it locks the campaign and never commits past funded budget', async () => {
  const sql = await read(MIGRATION);
  const settle = fnBody(sql, 'public.clip_settle_submission');
  assert.match(settle, /from public\.action_clip_campaigns where mission_id = v_sub\.mission_id for update/);
  assert.match(settle, /on conflict \(idempotency_key\) do nothing/);
  assert.match(fnBody(sql, 'private.clip_money'), /least\(c\.budget_cents, f\.funded\)/);
  assert.match(fnBody(sql, 'public.clip_work_due'), /for update skip locked/);
});

test('paid clip work is kept out of civic proof, points and the Action Record', async () => {
  const [sql, mnet, native] = await Promise.all([read(MIGRATION), read('js/mnet.js'), read('native/src/actionNetwork.ts')]);
  assert.match(sql, /create trigger action_proofs_civic_only before insert or update of assignment_id on public\.action_proofs/);
  assert.match(sql, /create trigger action_points_civic_only before insert on public\.action_points_ledger/);
  assert.match(fnBody(sql, 'public.action_record'), /kind = 'civic'/);
  assert.match(mnet, /kind!=="clip"/);
  assert.match(native, /row\.kind !== 'clip'/);
});

test('creator dashboards are org-scoped through the existing owner check', async () => {
  const sql = await read(MIGRATION);
  assert.match(fnBody(sql, 'private.clip_require_owner'), /private\.is_org_owner/);
  // by campaign through clip_require_owner, by org directly through is_org_owner
  for (const fn of ['public.clip_campaign_dashboard', 'public.clip_review_submission', 'public.clip_campaign_update',
    'public.clip_campaign_set_status', 'public.clip_campaign_fund']) {
    assert.match(fnBody(sql, fn), /private\.clip_require_owner\(/, `${fn} checks the creator org`);
  }
  for (const fn of ['public.clip_campaign_create', 'public.clip_campaigns_for_org', 'public.clip_record_payout']) {
    assert.match(fnBody(sql, fn), /not private\.is_org_owner\((?:p_org|v_org)\)/, `${fn} checks the creator org`);
  }
});

test('the surfaces are wired: Worker cron and routes, Control, web and native Clips', async () => {
  const [entry, control, controlV2, mnetHtml, screen] = await Promise.all([
    read('workers/mccluster/src/entry.js'), read('control.html'), read('js/control-room-v2.js'),
    read('mnet.html'), read('native/src/ActionNetworkScreen.tsx')]);
  assert.match(entry, /observeScheduled\(env, ctx, 'clipping\.settlement'/);
  assert.match(entry, /handleClippingRequest/);
  assert.match(control, /js\/control-room\/clipping\.js/);
  assert.match(controlV2, /"clipping"/);
  assert.match(mnetHtml, /data-mn-view="clips"/);
  assert.match(mnetHtml, /js\/mnet-clips\.js/);
  assert.match(screen, /\{ key: 'clips', label: 'Clips' \}/);
  assert.match(screen, /view === 'clips' \? <ClipsView \/>/);
  assert.doesNotMatch(screen + (await read('js/mnet-clips.js')), /service_role/i);
});

test('CI rebuilds the database, applies the pending migration and runs the end-to-end regression', async () => {
  const ci = await read('.github/workflows/api-economic-core-ci.yml');
  const apply = ci.indexOf('psql \'postgresql://postgres:postgres@127.0.0.1:54322/postgres\' -v ON_ERROR_STOP=1 -f supabase/pending/action_clipping_marketplace_v1.sql');
  const regress = ci.indexOf('-f supabase/tests/action_clipping_regression.sql');
  assert.ok(apply > 0 && regress > apply, 'migration applied before its regression runs');
  assert.match(ci, /'supabase\/pending\/\*\*'/);
});
