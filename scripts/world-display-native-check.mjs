// Equity Uprise shared World presentation proof; support only, no activation.
// Native PostgreSQL only. Standalone uses canonical tenancy DDL with explicit
// local role/default-privilege fixtures. --full-reset uses the complete local
// Supabase reset without replacing its roles, tables, RLS or triggers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { nativeTestDb, resetMigrationPlan, waitForBlocked } from './native-admin-test-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fullReset = process.argv.includes('--full-reset');
assert.deepEqual(process.argv.slice(2), fullReset ? ['--full-reset'] : []);
const forward = 'supabase/pending/20261123013000_eup_world_display_v1.sql';
const recovery = forward.replace('.sql', '.rollback.sql');
const checks = [];
const equal = (actual, expected, name) => { assert.deepEqual(Array.isArray(actual) ? Array.from(actual) : actual, expected, name); checks.push(name); };
const ok = (actual, name) => { assert.ok(actual, name); checks.push(name); };
const deny = async (action, expected, name) => { await assert.rejects(action, expected, name); checks.push(name); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const digest = file => createHash('sha256').update(read(file)).digest('hex');
const report = { scope: 'Equity Uprise shared World presentation support; no activation', mode: fullReset ? 'complete-local-reset' : 'canonical-tenancy-native-fixture', started_at: new Date().toISOString(), sql_sha256: { [forward]: digest(forward), [recovery]: digest(recovery) }, checks };

async function openReset() {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'proof is local only');
  assert.equal(url.port, '54322'); assert.equal(url.pathname, '/postgres');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice: () => {}, connection: { application_name: 'world-display-native-proof', statement_timeout: 20000 } };
  const wrap = conn => ({ sql: conn, query: async (text, values = []) => ({ rows: await conn.unsafe(text, values) }), exec: text => conn.unsafe(text), transaction: fn => conn.begin(tx => fn(wrap(tx))), close: () => conn.end() });
  const database = wrap(postgres(url.href, options)); database.fork = () => wrap(postgres(url.href, options));
  try {
    const plan = await resetMigrationPlan(root);
    equal(Array.from((await database.query('select version,name from supabase_migrations.schema_migrations order by version')).rows), plan.rows, 'reset ledger exactly equals canonical files plus replay foundations');
    report.reset = { migration_count: plan.rows.length, production_migration_count: plan.productionCount, replay_only_count: plan.replayOnlyCount };
    return database;
  } catch (error) { await database.close(); throw error; }
}
const db = fullReset ? await openReset() : await nativeTestDb('world_display');
const clients = new Set();
const OWNER = randomUUID(), MEMBER = randomUUID(), OTHER_OWNER = randomUUID(), UNKNOWN = randomUUID();
const OTHER_ORG = randomUUID();
let house, service, member, anon;
const scalar = async (sql, values = [], connection = db) => (await connection.query(sql, values)).rows[0].value;
const objects = () => scalar("select jsonb_build_array(to_regclass('public.eup_world_display')::text,to_regprocedure('public.eup_world_display_read()')::text,to_regprocedure('public.eup_world_display_set(uuid,boolean)')::text) as value");
const state = () => scalar('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\'::jsonb) as value from public.eup_world_display t');
const readPreference = (connection = service) => scalar('select public.eup_world_display_read() as value', [], connection);
const save = (value, actor = OWNER, connection = service) => scalar('select public.eup_world_display_set($1::uuid,$2::boolean) as value', [actor, value], connection);
async function migration(file, connection = db) {
  // Execute exact committed bytes, including BEGIN/COMMIT and SET LOCAL. Roll
  // back a failed file before reusing the connection; never replay production.
  try { return await connection.exec(read(file)); }
  catch (error) { await connection.exec('rollback'); throw error; }
}
async function session(role) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  const connection = db.fork(); clients.add(connection); await connection.exec(`set role ${role}`); return connection;
}
const guard = (file, token, name) => deny(() => migration(file), error => error.code === '55000' && error.message.includes(token), name);
async function drift(change, restore, name) {
  const before = await state(); await db.exec(change);
  try { for (const file of [forward, recovery]) await guard(file, 'WORLD_DISPLAY_SCHEMA_DRIFT', `${name}: ${path.basename(file)} refuses`); }
  finally { await db.exec(restore); }
  equal(await state(), before, `${name}: rows preserved`);
}

try {
  report.postgres_version = await scalar("select current_setting('server_version') as value");
  ok(report.postgres_version.startsWith('17.'), 'proof runs on native PostgreSQL 17');
  equal(await objects(), [null, null, null], 'optional objects are absent before apply');
  if (!fullReset) {
    await guard(forward, 'WORLD_DISPLAY_PREREQUISITES_REQUIRED', 'forward fails before the canonical tenancy prerequisites exist');
    equal(await objects(), [null, null, null], 'missing prerequisites leave no partial objects');
    await db.exec(`
      do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);
    const tenancy = read('supabase/replay_migrations/0026_tenancy.sql');
    await db.exec(tenancy.slice(tenancy.indexOf('create table if not exists public.orgs'), tenancy.indexOf('-- The house.')));
  }
  ok(await scalar("select rolbypassrls as value from pg_roles where rolname='service_role'"), 'existing service role has BYPASSRLS; proof never alters reserved roles');
  service = await session('service_role'); member = await session('authenticated'); anon = await session('anon');
  await deny(() => readPreference(), { code: '42883' }, 'real service read fails without the migration');
  await deny(() => save(false), { code: '42883' }, 'real service save fails without the migration');
  await migration(recovery); equal(await objects(), [null, null, null], 'recovery before apply is a no-op');
  await db.query("insert into public.orgs(slug,name,kind) values('mccluster','Synthetic native house','studio') on conflict(slug) do nothing");
  house = await scalar("select id as value from public.orgs where slug='mccluster'");
  await db.query("insert into public.orgs(id,slug,name) values($1,$2,'Synthetic native other org')", [OTHER_ORG, `native-world-${OTHER_ORG}`]);
  await db.query("insert into public.org_members(org_id,profile_id,role) values($1,$2,'owner'),($1,$3,'staff'),($4,$5,'owner')", [house, OWNER, MEMBER, OTHER_ORG, OTHER_OWNER]);
  await migration(forward); await migration(forward);
  equal(await readPreference(), false, 'empty store defaults off after apply and reapply');
  equal(await state(), [], 'apply creates no owner decision or activation');
  equal(await scalar("select jsonb_build_array(relrowsecurity,(select count(*) from pg_policy where polrelid=c.oid)) as value from pg_class c where c.oid='public.eup_world_display'::regclass"), [true, 0], 'table has RLS and no API policies');
  for (const [role, connection] of [['anon', anon], ['authenticated', member], ['service_role', service]]) {
    for (const sql of ['select * from public.eup_world_display', 'insert into public.eup_world_display default values', 'update public.eup_world_display set public_news_heat_map=true', 'delete from public.eup_world_display', 'truncate public.eup_world_display'])
      await deny(() => connection.exec(sql), { code: '42501' }, `${role}: direct ${sql.split(' ')[0]} is refused`);
  }
  for (const [role, connection] of [['anon', anon], ['authenticated', member]]) {
    await deny(() => readPreference(connection), { code: '42501' }, `${role}: RPC read is refused`);
    await deny(() => save(true, OWNER, connection), { code: '42501' }, `${role}: RPC save is refused even with owner UUID`);
  }
  for (const [label, actor] of [['null actor', null], ['unknown actor', UNKNOWN], ['house staff', MEMBER], ['other organization owner', OTHER_OWNER]])
    await deny(() => save(true, actor), { code: '42501' }, `${label}: cannot save`);
  await deny(() => save(null), { code: '22023' }, 'owner cannot save null');
  equal(await state(), [], 'rejected saves create no decision');
  for (const value of [true, false]) {
    equal(await save(value), value, `owner can save ${value}`);
    equal(await readPreference(), value, `read returns saved ${value}`);
    const before = await state(); await migration(forward);
    equal(await state(), before, `reapply preserves saved ${value}`);
    await guard(recovery, 'WORLD_DISPLAY_HAS_SAVED_DECISION', `recovery preserves owner ${value} decision`);
    equal(await state(), before, `refused recovery preserves saved ${value} exactly`);
  }
  await deny(() => db.exec('insert into public.eup_world_display(singleton,public_news_heat_map) values(false,false)'), { code: '23514' }, 'singleton cannot be false');
  await deny(() => db.exec('insert into public.eup_world_display default values'), { code: '23505' }, 'second singleton is refused');
  await deny(() => db.exec('update public.eup_world_display set public_news_heat_map=null'), { code: '23502' }, 'null preference is refused at the table');
  await db.exec('grant select on public.eup_world_display to authenticated');
  try { equal((await member.query('select * from public.eup_world_display')).rows, [], 'RLS still hides saved decision after an accidental SELECT grant'); }
  finally { await db.exec('revoke select on public.eup_world_display from authenticated'); }
  await drift('grant select on public.eup_world_display to anon', 'revoke select on public.eup_world_display from anon', 'unexpected table grant');
  await drift('alter table public.eup_world_display disable row level security', 'alter table public.eup_world_display enable row level security', 'RLS drift');
  const definition = await scalar("select pg_get_functiondef('public.eup_world_display_read()'::regprocedure) as value");
  await drift("create or replace function public.eup_world_display_read() returns boolean language sql stable security definer set search_path='' as $$select true$$", definition, 'function body drift');
  // Test-only deletion of synthetic state, never a recovery bypass.
  await db.exec('delete from public.eup_world_display');
  await db.exec('create view public.native_world_display_dependency as select singleton from public.eup_world_display');
  await deny(() => migration(recovery), { code: '2BP01' }, 'recovery refuses later dependencies without CASCADE');
  ok((await objects()).every(Boolean), 'dependency refusal restores functions and table atomically');
  await db.exec('drop view public.native_world_display_dependency');

  const stale = db.fork(); clients.add(stale);
  await stale.exec('begin isolation level repeatable read');
  equal(await scalar('select count(*)::int as value from public.eup_world_display', [], stale), 0, 'stale transaction starts with an empty snapshot');
  await save(false);
  equal(await scalar('select count(*)::int as value from public.eup_world_display', [], stale), 0, 'stale snapshot cannot see later committed owner save');
  await deny(() => migration(recovery, stale), error => error.code === '55000' && error.message.includes('WORLD_DISPLAY_READ_COMMITTED_REQUIRED'), 'recovery rejects stale snapshot before inspecting records');
  equal(await state(), [{ singleton: true, public_news_heat_map: false }], 'later committed false decision survives stale recovery');
  await db.exec('delete from public.eup_world_display');

  const writer = await session('service_role'), remover = db.fork(), observer = db.fork();
  clients.add(remover); clients.add(observer);
  const ready = deferred(), release = deferred();
  const writing = writer.transaction(async tx => { await save(false, OWNER, tx); ready.resolve(); await release.promise; });
  let removing;
  try {
    await ready.promise;
    removing = migration(recovery, remover).then(() => ({ applied: true }), error => ({ code: error.code, message: error.message }));
    await waitForBlocked(observer); checks.push('recovery reaches a real PostgreSQL lock wait behind an in-flight owner save');
    release.resolve(); await writing;
    const outcome = await removing;
    equal(outcome.code, '55000', 'recovery waits then refuses the newly committed decision');
    ok(outcome.message.includes('WORLD_DISPLAY_HAS_SAVED_DECISION'), 'concurrent recovery refuses for the saved record');
    equal(await state(), [{ singleton: true, public_news_heat_map: false }], 'concurrent false save survives recovery exactly');
  } finally { release.resolve(); await writing; if (removing) await removing; }

  await db.exec('delete from public.eup_world_display');
  const locker = db.fork(); clients.add(locker);
  await locker.exec('begin; lock table public.eup_world_display in access exclusive mode');
  const started = Date.now();
  try { await deny(() => migration(forward), { code: '55P03' }, 'forward stops at its five-second lock bound'); }
  finally { await locker.exec('rollback'); }
  ok(Date.now() - started >= 4500 && Date.now() - started < 12000, 'lock timeout is bounded and was not a fixture shortcut');
  equal(await state(), [], 'timed-out forward changes nothing');
  await migration(recovery); equal(await objects(), [null, null, null], 'empty store recovery removes only its three objects');
  await migration(recovery); equal(await objects(), [null, null, null], 'repeat recovery is a no-op');
  await migration(forward); equal(await readPreference(), false, 'reapply after empty recovery works and stays off');
  await migration(recovery);
  await db.query('delete from public.org_members where profile_id in($1,$2,$3)', [OWNER, MEMBER, OTHER_OWNER]);
  await db.query('delete from public.orgs where id=$1', [OTHER_ORG]);
  report.result = 'passed'; report.passed = checks.length; report.failed = 0;
} catch (error) {
  report.result = 'failed'; report.passed = checks.length; report.failed = 1; report.error = { code: error.code, message: error.message }; throw error;
} finally {
  report.finished_at = new Date().toISOString();
  if (process.env.NATIVE_PROOF_REPORT) fs.writeFileSync(process.env.NATIVE_PROOF_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, mode: report.mode, postgres_version: report.postgres_version, passed: checks.length, failed: report.failed, reset: report.reset }));
  for (const connection of clients) await connection.close();
  await db.close();
}
