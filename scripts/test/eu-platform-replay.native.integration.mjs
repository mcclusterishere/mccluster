// The replay twin of the Equity Uprise platform registry
// (supabase/replay_migrations/20261114015120_equity_uprise_platform_registry.sql) on a disposable PostgreSQL built to
// the shape the CI rebuild has just before ledger row 365: supabase/tests/eu_platform_replay.stub.sql on top of
// supabaseShapedDatabase(), supabase/tests/action_mission_catalog.stub.sql and the four applied globe migrations.
//
//   1. The rebuild, through this repository's own reset script. scripts/supabase-local-reset-with-replay.sh runs from a
//      scratch copy of supabase/migrations/ and supabase/replay_migrations/, with the Supabase CLI stood in for by a
//      shim that applies the staged files from ledger row 365 (20261114015120) to 376 in name order with psql and
//      records each version, as the CLI does. Without the twin the run stops at the registry, at its app check, with
//      nothing from row 365 on applied. With the twin all twelve apply: the registry, the music workspace, the module
//      policy, the join scope, the mission details and the seven Drawdown parts. Both times the script puts the
//      scratch copy back exactly as it was.
//   2. What the rebuild then holds: every relation, function, policy and trigger the twelve files create or change,
//      row for row in the production verifier's catalog queries (scripts/db/schema-queries.mjs), against the
//      production snapshot of 2026-11-18 (the rows it added or changed since the snapshot of 2026-11-10).
//   3. Where production's preconditions hold (four canonical apps enabled, one authenticated owner, a creator with a
//      linked sign-in and one without), the twin has the same effect as the stored statement: the same rows and the
//      same catalog, before and after the music workspace.
//   4. The twin keeps every other refusal (two owners, a disabled canonical app, an existing equity-uprise
//      organisation, no enabled McCluster organisation), and the stored statement refuses the rebuild twice over:
//      at the app check, then, with a fixture mnet-web app, at the owner check.
//   5. Below its header the twin is the stored statement byte for byte except its two preflight lines.
//
// It does not run the Supabase CLI or the 364 rows before the registry: the stub stands for them, column for column
// where the twelve files read, and the CI reset ("Supabase migration reset") stays the proof of the whole chain.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/eu-platform-replay.native.integration.mjs
//
// Disposable server only (scripts/test/support/native-postgres.mjs); never the canonical project. Needs bash and psql.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { refuseUnlessAllowed, startNativePostgres, supabaseShapedDatabase } from './support/native-postgres.mjs';
import { snapshotDatabase, FIELDS } from '../db/verify-production-schema.mjs';

refuseUnlessAllowed('eu-platform-replay.native');

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const REGISTRY = '20261114015120_equity_uprise_platform_registry.sql';
const MUSIC = '20261114060150_equity_uprise_music_workspace.sql';
const FIRST = '20261114015120'; // ledger row 365
const TAIL = [ // ledger rows 365 to 376
  REGISTRY, MUSIC, '20261117144103_eup_module_policy_v1.sql', '20261117222809_action_globe_join_scope_v1.sql',
  '20261118021521_action_mission_details.sql', '20261118034753_action_mission_drawdown_import_01.sql',
  '20261118034926_action_mission_drawdown_import_02.sql', '20261118035056_action_mission_drawdown_import_03.sql',
  '20261118035221_action_mission_drawdown_import_04.sql', '20261118035346_action_mission_drawdown_import_05.sql',
  '20261118035521_action_mission_drawdown_import_06.sql', '20261118035654_action_mission_drawdown_import_07.sql',
];
const GLOBE = [
  'supabase/migrations/20261014013557_action_globe_regions.sql',
  'supabase/migrations/20261014013601_action_globe_song_portfolios.sql',
  'supabase/migrations/20261014014547_action_globe_region_activation.sql',
  'supabase/migrations/20261014184518_action_globe_join_authorization.sql',
];
const SNAPSHOT = 'docs/control-plane/evidence/production-schema-snapshot-2026-11-18.json';
const BEFORE = 'docs/control-plane/evidence/production-schema-snapshot-2026-11-10.json';
const SWAPS = [
  [" if (select count(*) from public.platform_apps where app_key in ('mccluster-web','mnet-web','music-web','equity-uprise-web') and enabled)<>4 then raise exception 'Canonical app registration preflight failed'; end if;\n",
    " if exists(select 1 from public.platform_apps where app_key in ('mccluster-web','mnet-web','music-web','equity-uprise-web') and not enabled) then raise exception 'Canonical app registration preflight failed'; end if;\n"],
  [" if (select count(*) from public.org_members m join public.orgs o on o.id=m.org_id join auth.users u on u.id=m.profile_id where o.slug='mccluster' and m.role='owner')<>1 then raise exception 'Expected one existing authenticated McCluster owner'; end if;\n",
    " if (select count(*) from public.org_members m join public.orgs o on o.id=m.org_id join auth.users u on u.id=m.profile_id where o.slug='mccluster' and m.role='owner')>1 then raise exception 'Expected one existing authenticated McCluster owner'; end if;\n"],
];
const APP_REFUSAL = /Canonical app registration preflight failed/;
const OWNER_REFUSAL = /Expected one existing authenticated McCluster owner/;
// Fixture identities (no real account): the house owner, a second owner, and a creator with a linked sign-in.
const OWNER = '00000000-0000-4000-8000-0000000000f1';
const OWNER_2 = '00000000-0000-4000-8000-0000000000f2';
const ARTIST_USER = '00000000-0000-4000-8000-0000000000a7';
const ARTIST_M = '10000000-0000-4000-8000-0000000000a7';
const ROYCE_M = '20000000-0000-4000-8000-0000000000e1'; // the stub's unlinked creator

const read = (p) => readFile(path.join(ROOT, p), 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; console.log(`ok ${n} ${m}`); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; console.log(`ok ${n} ${m}`); };
const refuses = async (p, re, m) => {
  let error = null;
  try { await p; } catch (e) { error = e; }
  assert.ok(error, `${m}: it succeeded`);
  assert.match(error.message, re, m);
  n += 1; console.log(`ok ${n} ${m}`);
};

const SHIM = `#!/usr/bin/env bash
# Stands in for the Supabase CLI. "db reset" applies the staged supabase/migrations/ files from ledger row 365 on, in
# name order, each with psql, records each version as the CLI does, and stops at the first file that fails.
set -euo pipefail
[[ "\${1:-} \${2:-}" == "db reset" ]] || { echo "shim: only db reset" >&2; exit 64; }
export LC_ALL=C
mkdir -p "$SHIM_ROOT/staged"
for f in "$SHIM_ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f")"; v="\${n%%_*}"
  [[ "$v" < "$SHIM_FROM" ]] && continue
  m="\${n#*_}"; m="\${m%.sql}"
  cp "$f" "$SHIM_ROOT/staged/$n"
  psql -X -q -v ON_ERROR_STOP=1 -d "$SHIM_DB_URL" -f "$f" || { echo "shim: $n failed" >&2; exit 3; }
  psql -X -q -v ON_ERROR_STOP=1 -d "$SHIM_DB_URL" -c "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$m')"
done
`;

/** A database shaped like the rebuild just before ledger row 365. */
async function rebuildShape(server, name) {
  const admin = await supabaseShapedDatabase(server, name);
  await admin.query('create extension if not exists "uuid-ossp"');
  await admin.query(await read('supabase/tests/supabase_storage.stub.sql'));
  await admin.query(await read('supabase/tests/action_mission_catalog.stub.sql'));
  await admin.query(await read('supabase/tests/eu_platform_replay.stub.sql'));
  for (const f of GLOBE) await admin.query(await read(f));
  // join_action_mission's grants as production has them (an earlier migration made them), as the mission catalog proof sets them
  await admin.query('revoke all on function public.join_action_mission(uuid) from public, anon; grant execute on function public.join_action_mission(uuid) to authenticated, service_role;');
  await admin.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[])');
  return admin;
}

/** Production's preconditions, with fixture identities: a fourth app, one authenticated owner, a linked creator. */
async function productionPreconditions(admin) {
  await admin.query("insert into public.platform_apps (app_key, name, product_family, kind) values ('mnet-web', 'Fixture mnet', 'mccluster', 'web')");
  await admin.query('insert into auth.users (id) values ($1), ($2)', [OWNER, ARTIST_USER]);
  await admin.query("insert into public.org_members (org_id, profile_id, role) select id, $1, 'owner' from public.orgs where slug = 'mccluster'", [OWNER]);
  await admin.query('insert into public.m_people (id) values ($1)', [ARTIST_M]);
  await admin.query('insert into public.m_auth_user_links (auth_user_id, m_uid) values ($1, $2)', [ARTIST_USER, ARTIST_M]);
  await admin.query("insert into public.music_creator_profiles (m_uid, handle, artist_name) values ($1, 'fixture.artist', 'Fixture Artist')", [ARTIST_M]);
}

/** Every row the two 2026-11-14 files write, with generated organisation ids replaced by slugs. */
const ROWS_SQL = `select jsonb_build_object(
  'orgs', (select jsonb_agg(jsonb_build_array(slug, name, kind, settings, enabled) order by slug) from public.orgs),
  'members', (select jsonb_agg(jsonb_build_array(o.slug, m.profile_id, m.role) order by o.slug, m.profile_id) from public.org_members m join public.orgs o on o.id = m.org_id),
  'registry', (select jsonb_agg(jsonb_build_array(o.slug, r.platform_key, r.display_name, r.enabled)) from public.eu_platform_registry r join public.orgs o on o.id = r.org_id),
  'tenants', (select jsonb_agg(jsonb_build_array(o.slug, p.slug, t.tenant_kind, t.display_name, t.public_listing, t.enabled) order by o.slug) from public.eu_platform_tenants t join public.orgs o on o.id = t.org_id join public.orgs p on p.id = t.platform_org_id),
  'apps', (select jsonb_agg(jsonb_build_array(a.app_key, o.slug) order by a.app_key) from public.eu_platform_app_bindings b join public.platform_apps a on a.id = b.app_id join public.orgs o on o.id = b.tenant_org_id),
  'modules', (select jsonb_agg(jsonb_build_array(t.slug, m.module_key, p.slug, m.adapter, m.read_enabled, m.write_enabled) order by t.slug, m.module_key) from public.eu_platform_module_bindings m join public.orgs t on t.id = m.tenant_org_id join public.orgs p on p.id = m.provider_org_id),
  'artists', (select jsonb_agg(jsonb_build_array(b.m_uid, o.slug, b.identity_state) order by b.m_uid) from private.eu_platform_artist_bindings b join public.orgs o on o.id = b.tenant_org_id),
  'checks', (select jsonb_agg(jsonb_build_array(release_key, before_state = after_state, (select jsonb_agg(k order by k) from jsonb_object_keys(before_state) k)) order by release_key) from private.eu_platform_release_checks)
) as d`;

const KEYS = {
  relations: (r) => `${r[0]}.${r[1]}`,
  functions: (r) => `${r[0]}.${r[1]}(${r[2]})`,
  policies: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
  triggers: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
};
const SECTIONS = Object.keys(KEYS);
const rowsOf = (snap, name) => (Array.isArray(snap.sections[name]) ? snap.sections[name] : snap.sections[name].rows);

const server = await startNativePostgres();
const clients = [];
const roots = [];
const url = (db) => `postgresql://postgres@127.0.0.1:${server.port}/${db}`;
/** Read the catalogs with Supabase's default search_path, as the verifier does against production and the CI stack. */
const snapshot = (db) => {
  const saved = process.env.PGOPTIONS;
  process.env.PGOPTIONS = '-c client_min_messages=warning -c search_path="$user",public,extensions';
  try { return snapshotDatabase(url(db), { source: 'scratch' }); } finally {
    if (saved === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = saved;
  }
};
const psqlFile = (db, file) => spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', url(db), '-f', file],
  { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });

/** This repository's reset script, from a scratch copy of the two migration folders, with the CLI shim on PATH. */
async function reset(db, { withTwin }) {
  const root = await mkdtemp(path.join(tmpdir(), 'eu-platform-reset-'));
  roots.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'bin'));
  await copyFile(path.join(ROOT, 'scripts/supabase-local-reset-with-replay.sh'), path.join(root, 'scripts/supabase-local-reset-with-replay.sh'));
  await cp(path.join(ROOT, 'supabase/migrations'), path.join(root, 'supabase/migrations'), { recursive: true });
  await cp(path.join(ROOT, 'supabase/replay_migrations'), path.join(root, 'supabase/replay_migrations'), { recursive: true });
  if (!withTwin) await rm(path.join(root, 'supabase/replay_migrations', REGISTRY));
  await writeFile(path.join(root, 'bin/supabase'), SHIM);
  await chmod(path.join(root, 'bin/supabase'), 0o755);
  const listing = async () => {
    const dir = path.join(root, 'supabase/migrations');
    const names = (await readdir(dir)).sort();
    return Promise.all(names.map(async (f) => [f, md5(await readFile(path.join(dir, f), 'utf8'))]));
  };
  const before = await listing();
  const r = spawnSync('bash', [path.join(root, 'scripts/supabase-local-reset-with-replay.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, SHIM_ROOT: root, SHIM_FROM: FIRST, SHIM_DB_URL: url(db), PGOPTIONS: '-c client_min_messages=warning' },
  });
  const staged = (await readdir(path.join(root, 'staged')).catch(() => [])).sort();
  const stagedRegistry = staged.includes(REGISTRY) ? await readFile(path.join(root, 'staged', REGISTRY), 'utf8') : null;
  return { status: r.status, stderr: r.stderr, staged, stagedRegistry, restored: JSON.stringify(await listing()) === JSON.stringify(before) };
}

try {
  const stored = await read(`supabase/migrations/${REGISTRY}`);
  const twin = await read(`supabase/replay_migrations/${REGISTRY}`);
  const musicStored = await read(`supabase/migrations/${MUSIC}`);
  const production = JSON.parse(await read(SNAPSHOT));
  const before1110 = JSON.parse(await read(BEFORE));

  /* ---- 5. the twin is the stored statement below its header, but for its two preflight lines ------------------ */
  let body = stored;
  for (const [from, to] of SWAPS) { eq(body.split(from).length - 1, 1, `the stored statement has the line the twin replaces: ${from.trim().slice(0, 48)}...`); body = body.replace(from, to); }
  ok(twin.endsWith(body), 'below its header the twin is the stored statement byte for byte except those two lines');
  const header = twin.slice(0, twin.length - body.length);
  ok(header.split('\n').every((line) => line === '' || line.startsWith('--')), 'the header is comments only, so it executes nothing');
  eq(md5(stored), '5687d8ab0b1af7a8d6548bbd1ed0ebb6', 'and the stored statement is still production\'s (17,044 bytes, md5 5687d8ab...)');

  /* ---- 1. the rebuild through the reset script, without and with the twin ---------------------------------- */
  const without = await rebuildShape(server, 'reset_without_twin'); clients.push(without);
  const r1 = await reset('reset_without_twin', { withTwin: false });
  ok(r1.status !== 0, `without the twin the reset fails (exit ${r1.status})`);
  ok(APP_REFUSAL.test(r1.stderr) && r1.stderr.includes(`shim: ${REGISTRY} failed`), 'at the registry, at its app check: Canonical app registration preflight failed');
  eq(r1.stagedRegistry, stored, 'the file it ran was the stored statement');
  eq((await without.query('select count(*)::int as c from supabase_migrations.schema_migrations')).rows[0].c, 0, 'nothing from ledger row 365 on was applied');
  eq((await without.query("select to_regclass('public.eu_platform_registry') as r")).rows[0].r, null, 'and the registry left no object behind');
  ok(r1.restored, 'the script put the scratch supabase/migrations/ back exactly as it was');

  const withTwin = await rebuildShape(server, 'reset_with_twin'); clients.push(withTwin);
  const r2 = await reset('reset_with_twin', { withTwin: true });
  eq([r2.status, r2.stderr.trim()], [0, ''], 'with the twin the reset succeeds');
  eq(r2.staged, TAIL, 'it applied the twelve files of ledger rows 365 to 376, in order');
  eq(r2.stagedRegistry, twin, 'the registry it ran was the twin, staged over the stored statement under the same name');
  eq((await withTwin.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version), TAIL.map((f) => f.slice(0, 14)), 'and recorded each of their versions');
  ok(r2.restored, 'the script put the scratch supabase/migrations/ back exactly as it was, the stored statement included');

  const one = async (c, q, p = []) => (await c.query(q, p)).rows[0];
  const built = (await one(withTwin, ROWS_SQL)).d;
  eq(built.registry, [['equity-uprise', 'equity-uprise', 'Equity Uprise', true]], 'the rebuild holds the platform registry row');
  eq(built.tenants, [
    ['artist-' + ROYCE_M, 'equity-uprise', 'artist', 'Royce', false, true],
    ['equity-uprise', 'equity-uprise', 'platform', 'Equity Uprise', true, true],
    ['mccluster', 'equity-uprise', 'organization', 'McCluster', true, true],
  ], 'the platform, McCluster and the one creator as tenants');
  eq(built.apps, [['equity-uprise-web', 'equity-uprise'], ['mccluster-web', 'mccluster'], ['music-web', 'mccluster']], 'the three canonical apps it has, bound (no mnet-web: no file registers it)');
  eq(built.members, null, 'and no owner: the rebuild has none and the twin invents none');
  eq(built.artists, [[ROYCE_M, 'artist-' + ROYCE_M, 'needs_identity_review']], 'the unlinked creator waits for identity review');
  eq(built.checks.map((c) => c.slice(0, 2)), [['music-workspace-v1', true], ['platform-registry-v1', true]], 'both compatibility checks held and were recorded');
  eq([(await one(withTwin, "select count(*)::int as c from public.action_missions where status = 'draft'")).c, (await one(withTwin, 'select count(*)::int as c from public.action_mission_details')).c], [125, 125], 'the Drawdown parts left 125 draft missions with 125 details rows, as production holds them');
  const anon = await server.client('reset_with_twin'); clients.push(anon);
  await anon.query('set role anon');
  const context = (await anon.query("select public.eu_platform_context('equity-uprise-web') as c")).rows[0].c;
  eq([context.schema, context.platform.key, context.tenant.kind, Object.keys(context.modules).sort()], ['equity-uprise.platform-context/v1', 'equity-uprise', 'platform', ['identity', 'missions', 'music']], 'a visitor reads the platform context through the new API');

  /* ---- 2. what it built, against production --------------------------------------------------------------- */
  const pg16 = Number((await one(withTwin, 'show server_version_num')).server_version_num) < 170000;
  const snap = snapshot('reset_with_twin');
  const failures = [];
  const compared = { eu: 0, tail: 0 };
  for (const name of SECTIONS) {
    const key = KEYS[name];
    const old = new Map(rowsOf(before1110, name).map((r) => [key(r), JSON.stringify(r)]));
    const have = new Map(rowsOf(snap, name).map((r) => [key(r), r]));
    for (const w of rowsOf(production, name)) {
      const k = key(w);
      if (old.get(k) === JSON.stringify(w)) continue; // unchanged since 2026-11-10: not the twelve files' work
      const eu = /(^|\.)eu_platform_/.test(k);
      compared[eu ? 'eu' : 'tail'] += 1;
      const h = have.get(k);
      if (!h) { failures.push(`${name} ${k}: not built`); continue; }
      FIELDS[name].forEach((field, i) => {
        let expected = w[i];
        if (field === 'acl' && pg16) expected = String(expected).replace(/m/g, ''); // PostgreSQL 16 has no MAINTAIN
        if (JSON.stringify(h[i]) !== JSON.stringify(expected)) failures.push(`${name} ${k}: ${field} is ${JSON.stringify(h[i])}, production has ${JSON.stringify(expected)}`);
      });
    }
  }
  eq(failures, [], `every object the twelve files create or change comes out as production's snapshot of 2026-11-18 records it: ${compared.eu} rows of the two 2026-11-14 files (relations, functions, policies) and ${compared.tail} of the ten after them`);
  ok(compared.eu === 27, 'those are the 27 rows of the two 2026-11-14 files: 9 relations, 10 functions, 8 policies, no trigger');

  /* ---- 3. on production's preconditions: the same effect as the stored statement -------------------------- */
  const pStored = await rebuildShape(server, 'production_stored'); clients.push(pStored);
  const pTwin = await rebuildShape(server, 'production_twin'); clients.push(pTwin);
  for (const c of [pStored, pTwin]) await productionPreconditions(c);
  await pStored.query(stored);
  await pTwin.query(twin);
  const rowsStored = (await one(pStored, ROWS_SQL)).d;
  eq((await one(pTwin, ROWS_SQL)).d, rowsStored, 'with four apps and one authenticated owner the twin writes exactly the rows the stored statement writes');
  eq(rowsStored.members.filter((m) => m[2] === 'owner').map((m) => m[0]).sort(), ['artist-' + ARTIST_M, 'equity-uprise', 'mccluster'], 'there the owner is copied to the platform and the linked creator owns its space');
  eq(rowsStored.apps.map((a) => a[0]), ['equity-uprise-web', 'mccluster-web', 'mnet-web', 'music-web'], 'and all four apps are bound');
  const sameCatalog = (a, b) => SECTIONS.every((s) => JSON.stringify(rowsOf(a, s)) === JSON.stringify(rowsOf(b, s)));
  ok(sameCatalog(snapshot('production_stored'), snapshot('production_twin')), 'and the same catalog, row for row');
  await pStored.query(musicStored);
  await pTwin.query(musicStored);
  const musicRows = (await one(pStored, ROWS_SQL)).d;
  eq((await one(pTwin, ROWS_SQL)).d, musicRows, 'the music workspace then writes the same rows after either');
  eq(musicRows.modules.filter((m) => m[1] === 'music' && m[0].startsWith('artist-')).map((m) => m.slice(3)).sort(), [['pending_creator_music_v2', false, false], ['shared_creator_music_v1', true, true]], 'it opens the linked creator\'s music space and leaves the unlinked one pending');
  ok(sameCatalog(snapshot('production_stored'), snapshot('production_twin')), 'and the same catalog');

  /* ---- 4. every other refusal stays; the stored statement refuses the rebuild twice over ------------------- */
  const neg = await rebuildShape(server, 'refusals'); clients.push(neg);
  const unchanged = async () => (await one(neg, "select to_regclass('public.eu_platform_registry') is null and not exists (select 1 from public.orgs where slug = 'equity-uprise') as u")).u;
  const tryFile = async (sql, re, m) => { await refuses(neg.query(sql), re, m); await neg.query('rollback'); ok(await unchanged(), `${m}: nothing changed`); };
  await tryFile(stored, APP_REFUSAL, 'the stored statement on the rebuild: refused at the app check');
  await neg.query("insert into public.platform_apps (app_key, name, product_family, kind) values ('mnet-web', 'Fixture mnet', 'mccluster', 'web')");
  await tryFile(stored, OWNER_REFUSAL, 'given a fixture mnet-web app, refused at the owner check');
  await neg.query("delete from public.platform_apps where app_key = 'mnet-web'");
  await neg.query('insert into auth.users (id) values ($1), ($2)', [OWNER, OWNER_2]);
  await neg.query("insert into public.org_members (org_id, profile_id, role) select id, u, 'owner' from public.orgs, unnest($1::uuid[]) u where slug = 'mccluster'", [[OWNER, OWNER_2]]);
  await tryFile(twin, OWNER_REFUSAL, 'the twin refuses two authenticated owners');
  await neg.query('delete from public.org_members');
  await neg.query("update public.platform_apps set enabled = false where app_key = 'music-web'");
  await tryFile(twin, APP_REFUSAL, 'the twin refuses a disabled canonical app');
  await neg.query("update public.platform_apps set enabled = true where app_key = 'music-web'");
  await neg.query("update public.orgs set enabled = false where slug = 'mccluster'");
  await tryFile(twin, /Expected one enabled canonical McCluster organization/, 'the twin refuses without an enabled McCluster organisation');
  await neg.query("update public.orgs set enabled = true where slug = 'mccluster'");
  await neg.query("insert into public.orgs (slug, name, kind) values ('equity-uprise', 'Fixture', 'business')");
  await refuses(neg.query(twin), /Equity Uprise organization already exists/, 'the twin refuses when an equity-uprise organisation already exists');
  await neg.query('rollback');
  await neg.query("delete from public.orgs where slug = 'equity-uprise'");
  await neg.query(twin);
  ok(!(await unchanged()), 'and with the rebuild\'s rows restored it applies');

  console.log(`eu platform replay native: ${n} passed on PostgreSQL ${server.version}`);
} finally {
  for (const c of clients) await c.end().catch(() => {});
  server.stop();
  for (const r of roots) await rm(r, { recursive: true, force: true });
}
