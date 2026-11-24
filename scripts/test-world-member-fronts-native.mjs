// Shared World/identity verification support used by Equity Uprise; no building capability.
// Native-only disposable proof for member aggregation and publication recovery.
// Bounded mode uses repository Auth/Storage stand-ins. --full-reset never creates
// or replaces baseline roles, tables, functions, grants or triggers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeTestDb } from './native-admin-test-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [lane, ...args] = process.argv.slice(2);
assert.ok(['world', 'front'].includes(lane), 'choose the world or front proof');
const fullReset = args.length === 1 && args[0] === '--full-reset';
assert.ok(args.length === 0 || fullReset, 'only --full-reset is supported');
async function sqlFile(relative) {
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep), 'fixture include stays inside the repository');
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  const expanded = [];
  for (const line of lines) {
    if (/^\\(?:set|echo)\b/.test(line)) continue;
    const include = line.match(/^\\ir\s+(.+)$/);
    expanded.push(include ? await sqlFile(path.relative(root, path.resolve(path.dirname(file), include[1]))) : line);
  }
  return expanded.join('\n');
}
async function resetDatabase() {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'full reset must be local');
  assert.equal(url.port, '54322');
  assert.equal(url.pathname, '/postgres');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const client = postgres(url.href, { max: 1, onnotice: () => {}, connection: { statement_timeout: 20000 } });
  const wrap = connection => ({ exec: text => connection.unsafe(text),
    query: async (text, values = []) => ({ rows: await connection.unsafe(text, values) }),
    transaction: fn => connection.begin(tx => fn(wrap(tx))) });
  const db = wrap(client);
  db.close = () => client.end();
  assert.ok((await db.query("select to_regclass('supabase_migrations.schema_migrations') as ledger")).rows[0].ledger,
    'full-reset mode requires the canonical reset ledger; CI validates its migration/replay plan');
  return db;
}
const db = fullReset ? await resetDatabase() : await nativeTestDb(`pending_${lane}`);
const apply = async file => db.transaction(async tx => tx.exec(await sqlFile(file)));
const fixture = async file => {
  try { return await db.exec(await sqlFile(file)); }
  catch (error) { await db.exec('rollback'); throw error; }
};
const expectGuard = (fn, token) => assert.rejects(fn, error => error.code === '55000' && error.message.includes(token));
const fnDefinition = async signature => (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [signature])).rows[0].definition;
let groups = 0;
const check = async (label, fn) => { await fn(); console.log(`PASS ${++groups} ${label}`); };
async function changedBodyRefused(signature, files, token) {
  const before = await fnDefinition(signature);
  for (const file of files) {
    await db.exec('begin');
    try {
      assert.ok(before.includes('AS $function$'), 'known PostgreSQL function definition delimiter');
      await db.exec(before.replace('AS $function$', 'AS $function$\n-- synthetic concurrent body change\n'));
      await expectGuard(() => db.exec(sqlCache.get(file)), token);
    } finally { await db.exec('rollback'); }
    assert.equal(await fnDefinition(signature), before, 'refused recovery keeps the reviewed definition');
  }
}
const sqlCache = new Map();
try {
  console.log(JSON.stringify({ lane, engine: (await db.query('select version() as version')).rows[0].version,
    full_reset: fullReset, production_changes: false }));
  if (!fullReset) await db.exec(await sqlFile('supabase/tests/supabase_api_roles.stub.sql'));
  if (lane === 'world') {
    if (!fullReset) await db.exec(await sqlFile('supabase/migrations/20260919093553_native_telemetry_columns.sql'));
    const forward = 'supabase/pending/world_member_regions_v1.sql';
    const recovery = 'supabase/pending/world_member_regions_v1.rollback.sql';
    for (const file of [forward, recovery]) sqlCache.set(file, await sqlFile(file));
    await check('world reader applies twice and passes 12 behavior groups with real denied-role calls', async () => {
      await apply(forward); await apply(forward);
      await fixture('supabase/tests/world_member_regions.behaviour.sql');
    });
    await check('world reader recovery preserves telemetry and identities and is repeatable', async () => {
      const before = (await db.query('select (select count(*) from public.events) as events,(select count(*) from auth.users) as users')).rows[0];
      await apply(recovery); await apply(recovery);
      assert.equal((await db.query("select to_regprocedure('public.world_member_regions(integer)') as rpc")).rows[0].rpc, null);
      assert.deepEqual((await db.query('select (select count(*) from public.events) as events,(select count(*) from auth.users) as users')).rows[0], before);
      await apply(forward);
      await fixture('supabase/tests/world_member_regions.behaviour.sql');
    });
    await check('world apply and recovery both refuse an unknown installed body', () => changedBodyRefused('public.world_member_regions(integer)', [forward, recovery], 'PENDING_FUNCTION_CHANGED'));
    await apply(recovery);
  } else {
    if (!fullReset) {
      await db.exec(await sqlFile('supabase/tests/supabase_storage.stub.sql'));
      await db.exec(`create table public.m_auth_user_links(auth_user_id uuid primary key references auth.users(id),m_uid uuid references public.m_people(id),is_primary boolean not null);
        create table public.platform_profiles(user_id uuid primary key references auth.users(id),mccluster_id text,display_name text,avatar_url text);
        create table public.network_profiles(m_uid uuid primary key references public.m_people(id),visibility text not null check(visibility in ('public','network','private')),display_name text,avatar_url text,headline text);
        create table public.orgs(id uuid primary key default gen_random_uuid(),slug text unique);
        create table public.org_members(org_id uuid references public.orgs(id),profile_id uuid references auth.users(id),role text,primary key(org_id,profile_id));`);
      await db.exec(await sqlFile('supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql'));
    }
    const forward = 'supabase/pending/member_fronts_publication_visibility_guard_v1.sql';
    const recovery = 'supabase/pending/member_fronts_publication_visibility_guard_v1.rollback.sql';
    const signature = 'member_fronts_private.save(jsonb,integer,boolean,boolean)';
    for (const file of [forward, recovery]) sqlCache.set(file, await sqlFile(file));
    await check('original member-front publication defect reproduces before correction', () => assert.rejects(
      fixture('supabase/tests/member_fronts_publication_visibility_guard.behaviour.sql'), /nonpublic publication must be refused/));
    await check('visibility guard repeats, save recovery denies both roles and entry points, data/read/unpublish survive, and reapply restores admission', async () => {
      await apply(forward); await apply(forward);
      await fixture('supabase/tests/member_fronts_publication_visibility_guard.behaviour.sql');
      assert.equal(Number((await db.query('select count(*) as n from public.member_fronts')).rows[0].n), 0, 'fixture pages rolled back');
    });
    await check('member-front apply and recovery refuse changed function bodies', () => changedBodyRefused(signature, [forward, recovery], 'MEMBER_FRONT_SAVE_CHANGED'));
    await check('unrelated owner ACL changes cannot be adopted as recovery permission', async () => {
      for (const mutation of [
        `grant execute on function public.member_front_save(jsonb,integer,boolean,boolean) to anon`,
        `revoke all on function public.member_front_save(jsonb,integer,boolean,boolean),member_fronts_private.save(jsonb,integer,boolean,boolean) from authenticated,service_role`,
        `comment on function public.member_front_save(jsonb,integer,boolean,boolean) is 'Synthetic independent owner policy'`,
      ]) {
        for (const file of [forward, recovery]) {
          await db.exec('begin');
          try { await db.exec(mutation); await expectGuard(() => db.exec(sqlCache.get(file)), 'MEMBER_FRONT_SAVE_ADMISSION_CHANGED'); }
          finally { await db.exec('rollback'); }
        }
      }
    });
  }
  console.log(JSON.stringify({ lane, passed: true, groups, full_reset: fullReset, production_changes: false }));
} finally { await db.close(); }
