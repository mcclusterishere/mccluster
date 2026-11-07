// Real PostgreSQL sessions, never hosted Supabase or production credentials.
// Local subset: NATIVE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54322/postgres
//   POSTGRES_MODULE_PATH=/path/to/postgres/src/index.js node scripts/test-owner-front-postgres.mjs
// Canonical mode is run only AFTER the CI disposable full Supabase reset/manifest check.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { nativeTestDb } from './native-admin-test-db.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
export function validateCanonicalTarget(raw, acknowledgement) {
  const url = new URL(raw);
  assert.equal(acknowledgement, '1', 'canonical tests require explicit disposable-reset acknowledgement');
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '54322');
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.username, 'postgres');
  assert.ok(['', 'postgres'].includes(url.password), 'only disposable test credentials are accepted');
  assert.equal(url.search, '', 'connection overrides are forbidden');
  assert.equal(url.hash, '');
  return url.href;
}
const owner = 'a7410000-0000-4000-8000-000000000001';
const member = 'a7410000-0000-4000-8000-000000000002';
const unlinked = 'a7410000-0000-4000-8000-000000000003';
const config = song => ({ scenes: { doors: true, vaunt: true, night: true, world: true },
  scroll: { duration: 0.85, touchLerp: 0.14 },
  vr: { enabled: true, hold: true, band: [0.4, 0.5], yaw: -140, pitch: -32,
    spots: [{ yaw: 0, pitch: 0, label: 'Home', href: 'hire.html' }] },
  night: { arrive: 0.74 }, start: 'cabin', song, visible: true });
const snap = async db => (await db.query('select public.owner_front_snapshot_v1() as data')).rows[0].data;
const publish = async (db, rev, value) => (await db.query(
  'select public.owner_front_publish_v1($1,$2::jsonb) as data', [rev, value])).rows[0].data;
const save = async (db, rev, base, value) => (await db.query(
  'select public.owner_front_draft_save_v1($1,$2,$3::jsonb) as data', [rev, base, value])).rows[0].data;
const legacy = (db, song) => db.query("select public.site_content_set('index.html','@front',$1)", [JSON.stringify(config(song))]);
async function as(db, id = owner, role = 'authenticated') {
  assert.ok(['authenticated','anon','service_role'].includes(role));
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false), set_config('request.jwt.claims',$3,false)",
    [id || '', role, JSON.stringify({ sub: id || '', role })]);
  await db.exec('set role ' + role);
  return db;
}
async function canonicalDb() {
  const url = validateCanonicalTarget(process.env.NATIVE_TEST_DATABASE_URL, process.env.OWNER_FRONT_DISPOSABLE_RESET);
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice() {}, connection: { application_name: 'owner-front-canonical', statement_timeout: 15000 } };
  const wrap = sql => ({ query: async (text, values = []) => ({ rows: await sql.unsafe(text, values) }),
    exec: text => sql.unsafe(text), close: () => sql.end() });
  const db = wrap(postgres(url, options));
  db.fork = () => wrap(postgres(url, options));
  return db;
}
async function localSubset(db) {
  // Managed auth is the ONLY stub. Identity/admin and content functions below
  // are loaded from canonical files, not permissive substitute helper bodies.
  await db.exec(`do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema auth, public to anon,authenticated,service_role;`);
  const people = await read('supabase/replay_migrations/0049_m_account_people.sql');
  assert.ok(people.includes('alter table public.m_devices'));
  await db.exec(people.slice(0, people.indexOf('alter table public.m_devices')));
  await db.exec(await read('supabase/replay_migrations/0051_m_account_uid_rpc.sql'));
  const admin = await read('supabase/migrations/20260921050000_mnet_profile_save_autofollow_admin.sql');
  const first = admin.indexOf('create or replace function public.mnet_admin_m_uids()');
  const end = admin.indexOf('-- 1. THE SAVE, RE-CREATED CLEAN');
  assert.ok(first >= 0 && end > first);
  await db.exec(admin.slice(first, end));
  for (const file of ['20260922100313_site_content_live_editing.sql','20260922100615_site_content_service_role_path.sql'])
    await db.exec(await read('supabase/migrations/' + file));
}
async function seed(db) {
  const existing = (await db.query("select count(*)::int as n from auth.users where lower(email)='matthew@mccluster.org' or id in ($1,$2,$3)", [owner,member,unlinked])).rows[0].n;
  assert.equal(existing, 0, 'refuse a database with an existing owner or test identities');
  assert.equal((await db.query("select count(*)::int as n from public.site_content where page='index.html' and slot='@front'")).rows[0].n, 0, 'refuse existing house settings');
  await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)',
    [owner,'matthew@mccluster.org',member,'owner-front-member@fixture.invalid',unlinked,'owner-front-unlinked@fixture.invalid']);
  assert.equal((await db.query('select count(*)::int as n from public.m_auth_user_links where auth_user_id in ($1,$2,$3)', [owner,member,unlinked])).rows[0].n, 3, 'canonical signup trigger created all identities');
  await db.query('update public.m_auth_user_links set is_primary=false where auth_user_id=$1', [unlinked]);
}
async function waitForBlocked(db, pid) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if ((await db.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('operation did not reach a real PostgreSQL lock wait');
}
function observed(promise) { return promise.then(value => ({ value }), error => ({ error })); }
function succeeded(result) { if (result.error) throw result.error; return result.value; }
function conflict(result) { assert.equal(result.error?.code, '40001', result.error?.message || 'stale write unexpectedly succeeded'); }

export async function run({ canonical = false } = {}) {
  let checks = 0;
  const db = canonical ? await canonicalDb() : await nativeTestDb('owner_front');
  const clients = [];
  const check = async (name, fn) => { await fn(); checks++; console.log('ok ' + checks + ' - ' + name); };
  const session = async (id = owner, role = 'authenticated') => { const c = db.fork(); clients.push(c); await as(c,id,role); return c; };
  let a, b;
  try {
    if (!canonical) await localSubset(db);
    await seed(db);
    const sql = await read('supabase/pending/owner_front_publication_v1.sql');
    await db.exec(sql); await db.exec(sql); // Idempotent over the canonical schema.
    a = await session(); b = await session();
    const bpid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    await check('canonical M-account helpers, forced RLS and private grants', async () => {
      assert.equal((await a.query('select public.mnet_is_admin() as allowed')).rows[0].allowed, true);
      const row = (await db.query(`select relrowsecurity,relforcerowsecurity,
        has_table_privilege('authenticated','public.owner_front_drafts','select') as readable,
        has_function_privilege('anon','public.owner_front_snapshot_v1()','execute') as callable,
        has_function_privilege('authenticated','public.owner_front_validate_v1(jsonb)','execute') as validator
        from pg_class where oid='public.owner_front_drafts'::regclass`)).rows[0];
      assert.deepEqual(row, { relrowsecurity:true, relforcerowsecurity:true, readable:false, callable:false, validator:false });
      for (const [id,role] of [[member,'authenticated'],[unlinked,'authenticated'],[null,'authenticated'],[null,'anon'],[null,'service_role']]) {
        const c = await session(id,role);
        for (const op of [() => snap(c), () => publish(c,'0',config('here')), () => save(c,null,'0',config('here')),
          () => c.query('select public.owner_front_draft_discard_v1(null)')])
          await assert.rejects(op, e => e.code === '42501');
      }
    });
    await check('two new publishers serialize and the stale second publication is refused', async () => {
      const before = await snap(a);
      await a.exec('begin'); const first = await publish(a,before.revision,config('here'));
      const pending = observed(publish(b,before.revision,config('vaunt')));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      assert.equal((await snap(b)).revision, first.revision);
    });
    await check('legacy INSERT before new publication waits, then rejects the stale base', async () => {
      const current = await snap(a); await publish(a,current.revision,null);
      const before = await snap(a);
      await a.exec('begin'); await legacy(a,'vaunt');
      const pending = observed(publish(b,before.revision,config('here')));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      assert.equal(JSON.parse((await snap(b)).value).song,'vaunt');
    });
    await check('legacy UPDATE before new publication waits, then rejects the stale base', async () => {
      const before = await snap(a);
      await a.exec('begin'); await legacy(a,'runway');
      const pending = observed(publish(b,before.revision,config('here')));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      assert.equal(JSON.parse((await snap(b)).value).song,'runway');
    });
    await check('legacy DELETE before publication is a new revision, not version zero', async () => {
      const before = await snap(a);
      await a.exec('begin'); await a.exec("select public.site_content_revert('index.html','@front')");
      const pending = observed(publish(b,before.revision,config('here')));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      const after = await snap(b); assert.equal(after.value,null); assert.notEqual(after.revision,'0');
    });
    await check('new publication first blocks a legacy writer and both commits are audited in order', async () => {
      const before = await snap(a);
      await a.exec('begin'); const first = await publish(a,before.revision,config('here'));
      const pending = observed(legacy(b,'antisocial'));
      await waitForBlocked(db,bpid); await a.exec('commit'); succeeded(await pending);
      const after = await snap(b); assert.equal(JSON.parse(after.value).song,'antisocial');
      assert.equal(after.history[1].id,first.revision); assert.notEqual(after.revision,first.revision);
    });
    await check('snapshot waits for a legacy writer and returns matching value and audit revision', async () => {
      await a.exec('begin'); await legacy(a,'runway');
      const pending = observed(snap(b));
      await waitForBlocked(db,bpid); await a.exec('commit');
      const after = succeeded(await pending);
      assert.equal(after.value,after.history[0].value); assert.equal(after.revision,after.history[0].id);
      assert.equal(JSON.parse(after.value).song,'runway');
    });
    await check('two draft saves serialize and preserve the winner', async () => {
      const base = (await snap(a)).revision;
      await a.exec('begin'); const first = await save(a,null,base,config('here'));
      const pending = observed(save(b,null,base,config('vaunt')));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      assert.equal((await snap(b)).draft.revision,first.revision);
    });
    await check('publication waiting on a newer draft preserves its different content', async () => {
      const before = await snap(a);
      await a.exec('begin'); const draft = await save(a,before.draft.revision,before.revision,config('vaunt'));
      const pending = observed(publish(b,before.revision,config('here')));
      await waitForBlocked(db,bpid); await a.exec('commit'); const after = succeeded(await pending);
      assert.equal(after.draft.revision,draft.revision); assert.equal(after.draft.config.song,'vaunt');
      assert.equal(JSON.parse(after.value).song,'here');
    });
    await check('draft discard waiting on a newer save refuses to remove newer work', async () => {
      const before = await snap(a);
      await a.exec('begin'); const draft = await save(a,before.draft.revision,before.revision,config('runway'));
      const pending = observed(b.query('select public.owner_front_draft_discard_v1($1)',[before.draft.revision]));
      await waitForBlocked(db,bpid); await a.exec('commit'); conflict(await pending);
      assert.equal((await snap(b)).draft.revision,draft.revision);
    });
    await check('invalid settings do not mutate drafts, content or history', async () => {
      const before = await snap(a);
      await assert.rejects(() => publish(a,before.revision,{...config('here'),visible:'yes'}), e => e.code==='22023');
      await assert.rejects(() => save(a,before.draft.revision,before.revision,{...config('here'),song:'unknown'}), e => e.code==='22023');
      assert.deepEqual(await snap(a),before);
    });
    await check('rollback/reapply preserves private drafts, publication and immutable history', async () => {
      const before = await snap(a);
      await db.exec(await read('supabase/pending/owner_front_publication_v1.rollback.sql'));
      await assert.rejects(() => snap(a), e => e.code==='42883');
      await db.exec(sql);
      assert.deepEqual(await snap(a),before);
    });
    console.log(`owner front PostgreSQL: ${checks} passed; ${canonical ? 'full canonical replay, real managed-auth schema' : 'canonical identity/content subset, synthetic auth schema'}; no production access`);
  } finally {
    // End connections first so no lock survives a failed race. A local subset DB
    // is dropped by nativeTestDb. Canonical CI destroys its whole stack afterwards.
    await Promise.all(clients.map(c => c.close()));
    await db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run({ canonical: process.argv.includes('--canonical-reset') });
}
