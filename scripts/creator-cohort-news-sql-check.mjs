// Equity Uprise shared-platform support-only proof of creator publishing and
// regional newsroom grants. No capability activation or production connection.
// Default: disposable native PostgreSQL with canonical source-extracted tables
// and identity trigger, plus explicit Auth stand-ins. --full-reset: the existing
// local Supabase reset, without replacing base objects, Auth or default grants.
// Both unchanged behavior fixtures roll back every synthetic row/trigger effect.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeTestDb } from './native-admin-test-db.mjs';

const fullReset = process.argv.includes('--full-reset');
assert.deepEqual(process.argv.slice(2), fullReset ? ['--full-reset'] : []);
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const grants = 'supabase/pending/20261010009000_creator_site_cohort_grants.sql';
const publish = 'supabase/pending/20261010009100_creator_publish_cohort_entitlement.sql';
const news = 'supabase/pending/20261020170000_news_region_leads.sql';
const rollback = file => file.replace('.sql', '.rollback.sql');
const files = [grants, publish, news, rollback(grants), rollback(publish), rollback(news)];
const source = Object.fromEntries(await Promise.all(files.map(async file => [file, await read(file)])));
const baseTables = ['auth.users', 'public.orgs', 'public.org_members', 'public.m_people', 'public.m_auth_user_links',
  'public.action_cohorts', 'public.action_cohort_members', 'public.creator_billing_subscriptions', 'public.creator_published_sites'];
const legacy = 'public.creator_publish_site(uuid,text,text,text)';
const cohort = 'public.creator_publish_site(uuid,text,text,text,uuid)';
let guardChecks = 0;
const fixtureResults = [];
const rolledBack = new Error('rollback synthetic proof fixture');

async function openReset() {
  const url = new URL(process.env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'only a disposable local database is allowed');
  assert.equal(url.port, '54322'); assert.equal(url.pathname, '/postgres');
  assert.ok(path.isAbsolute(process.env.POSTGRES_MODULE_PATH || ''), 'POSTGRES_MODULE_PATH must be absolute');
  const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
  const options = { max: 1, onnotice: () => {}, connection: { application_name: 'creator-cohort-news-proof', statement_timeout: 20000 } };
  const wrap = sql => ({ query: async (text, values = []) => ({ rows: await sql.unsafe(text, values) }),
    exec: text => sql.unsafe(text), transaction: fn => sql.begin(tx => fn(wrap(tx))), close: () => sql.end() });
  const database = wrap(postgres(url.href, options));
  try {
    // Reconciliation CI already verifies the complete canonical/replay reset.
    // Do not compare its replay foundations to a production-only ledger count.
    const row = (await database.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as reset,
      to_regclass('public.creator_published_sites') is not null as sites,
      to_regprocedure('public.creator_publish_site(uuid,text,text,text)') is not null as publisher`)).rows[0];
    assert.ok(row.reset && row.sites && row.publisher, '--full-reset requires the canonical Supabase reset first');
    return database;
  } catch (error) { await database.close(); throw error; }
}
const db = fullReset ? await openReset() : await nativeTestDb('creator_cohort_news');
const apply = file => db.transaction(tx => tx.exec(source[file]));
async function table(file, name) {
  const sql = await read(file);
  const match = sql.match(new RegExp(`create table (?:if not exists )?public\\.${name}\\s*\\([\\s\\S]*?^\\);`, 'mi'));
  assert.ok(match, `canonical table DDL: ${name}`); await db.exec(match[0]);
}
async function snapshot(connection = db, tables = baseTables) {
  const result = {};
  for (const name of tables) result[name] = (await connection.query(`select count(*)::text as count,
    md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as digest from ${name} t`)).rows[0];
  return result;
}
const definition = async (connection, signature) => (await connection.query('select pg_get_functiondef($1::regprocedure) as definition', [signature])).rows[0].definition;
async function expectGuard(connection, file, token) {
  await connection.exec('savepoint expected_guard');
  let error;
  try { await connection.exec(source[file]); } catch (caught) { error = caught; }
  await connection.exec('rollback to savepoint expected_guard'); await connection.exec('release savepoint expected_guard');
  assert.equal(error?.code, '55000', `${file} must refuse with SQLSTATE 55000, got ${error?.code || 'success'}`);
  assert.ok(error.message.includes(token), `${file}: expected ${token}, got ${error.message}`); guardChecks++;
}
async function isolated(fn) {
  try { await db.transaction(async tx => { await fn(tx); throw rolledBack; }); }
  catch (error) { if (error !== rolledBack) throw error; }
}
async function noClientPublisher(connection = db) {
  const row = (await connection.query(`select has_function_privilege('anon',$1,'execute') as anon,
    has_function_privilege('authenticated',$1,'execute') as member,
    has_function_privilege('service_role',$1,'execute') as service`, [legacy])).rows[0];
  assert.deepEqual(row, { anon: false, member: false, service: true });
}
async function syntheticRecords(connection) {
  const user = randomUUID(), reviewer = randomUUID(), org = randomUUID(), selected = randomUUID();
  await connection.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [user, `${user}@example.invalid`, reviewer, `${reviewer}@example.invalid`]);
  await connection.query('insert into public.orgs(id,slug,name) values($1,$2,$3)', [org, `cohort-native-${org}`, 'Synthetic rollback preservation']);
  await connection.query("insert into public.action_cohorts(id,name,status) values($1,'Synthetic selected cohort','active')", [selected]);
  const person = (await connection.query('select m_uid from public.m_auth_user_links where auth_user_id=$1 and is_primary', [user])).rows[0].m_uid;
  await connection.query('insert into public.action_cohort_members(cohort_id,m_uid) values($1,$2)', [selected, person]);
  await connection.query('insert into public.creator_site_cohort_grants(org_id,creator_user_id,cohort_id,granted_by,reason) values($1,$2,$3,$4,$5)', [org, user, selected, reviewer, 'Synthetic reviewed cohort grant']);
  await connection.query("insert into public.creator_billing_subscriptions(stripe_subscription_id,stripe_customer_id,owner_user_id,stripe_price_id,status,current_period_end,org_id) values($1,$2,$3,'price_NativeFixture','active',now()+interval '1 day',$4)", [`sub_${org.replaceAll('-', '')}`, `cus_${org.replaceAll('-', '')}`, user, org]);
  await connection.query("insert into public.news_region_leads(m_uid,country_code,granted_by) values($1,'NZ',$2)", [person, reviewer]);
  await connection.exec('set local role service_role');
  await connection.query('select public.creator_publish_site($1,$2,$3,$4,$5)', [org, 'Synthetic published site', 'Preserved tagline', 'Preserved plain text', user]);
  await connection.exec('reset role'); return { org, user, person };
}

let ownsPending = false;
try {
  console.log('Native PostgreSQL:', (await db.query('select version() as version')).rows[0].version);
  if (!fullReset) {
    await db.exec(`do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
      alter role service_role bypassrls;
      grant anon, authenticated, service_role to postgres;
      create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
    await table('supabase/replay_migrations/0026_tenancy.sql', 'orgs');
    await table('supabase/replay_migrations/0026_tenancy.sql', 'org_members');
    const identity = await read('supabase/replay_migrations/0049_m_account_people.sql');
    const start = identity.indexOf('create table if not exists public.m_people'), end = identity.indexOf('alter table public.m_devices');
    assert.ok(start >= 0 && end > start, 'canonical identity DDL/trigger boundaries'); await db.exec(identity.slice(start, end));
    await table('supabase/migrations/20260930235851_uprise_action_network.sql', 'action_campaigns');
    await table('supabase/migrations/20261002061056_action_network_gamification_v1.sql', 'action_cohorts');
    await table('supabase/migrations/20261002061056_action_network_gamification_v1.sql', 'action_cohort_members');
    await db.exec('alter table public.action_cohorts enable row level security; alter table public.action_cohort_members enable row level security');
    for (const file of ['supabase/migrations/20261009204152_creator_billing_subscriptions_v1.sql', 'supabase/migrations/20261009204158_creator_published_sites_v1.sql']) await db.exec(await read(file));
    // Only this bounded fixture injects legacy privileges. The full-reset mode
    // leaves real base/default grants alone and executes the actual pending SQL.
    await db.exec('grant execute on function public.creator_publish_site(uuid,text,text,text) to authenticated');
    await db.exec('alter default privileges in schema public revoke all on tables from service_role');
    const org = randomUUID();
    await db.query('insert into public.orgs(id,slug,name) values($1,$2,$3)', [org, `existing-proof-${org}`, 'Preexisting synthetic site']);
    await db.query("insert into public.creator_published_sites(org_id,slug,title,tagline,bio) values($1,$2,'Existing published title','Existing tagline','Existing plain text')", [org, `site-${org.replaceAll('-', '')}`]);
  }
  const preflight = (await db.query(`select to_regclass('public.creator_site_cohort_grants') is null as grants_absent,
    to_regclass('public.news_region_leads') is null as news_absent,
    to_regprocedure('public.creator_publish_site(uuid,text,text,text,uuid)') is null as publisher_absent,
    (select rolbypassrls from pg_roles where rolname='service_role') as bypassrls`)).rows[0];
  assert.deepEqual(preflight, { grants_absent: true, news_absent: true, publisher_absent: true, bypassrls: true }, 'refuse to take ownership of preexisting pending objects');
  ownsPending = true;
  const original = await snapshot(), paidPublisher = await definition(db, legacy);
  await isolated(tx => expectGuard(tx, publish, 'CREATOR_COHORT_GRANTS_REQUIRED'));
  for (let pass = 1; pass <= 2; pass++) {
    for (const file of [grants, publish, news, grants, publish, news]) await apply(file);
    for (const [name, expected] of [['creator_cohort_entitlement', 39], ['news_region_leads', 17]]) {
      const results = await db.exec(await read(`supabase/tests/${name}.behaviour.sql`));
      const counts = results.flatMap(result => Array.isArray(result) ? result : []).filter(row => 'passed_checks' in row);
      assert.equal(counts.length, 1, `${name} must report its actual assertion count`); assert.equal(Number(counts[0].passed_checks), expected);
      fixtureResults.push({ name, pass, checks: expected });
      assert.deepEqual(await snapshot(), original, `${name}: all preexisting rows survive fixture rollback`);
      console.log(`PASS ${name} ${pass}: ${expected} checks; baseline row digests unchanged`);
    }
    if (pass === 1) {
      await isolated(async tx => {
        await syntheticRecords(tx);
        const before = await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']);
        await expectGuard(tx, rollback(grants), 'CREATOR_PUBLISH_ROLLBACK_REQUIRED');
        await tx.exec(source[rollback(publish)]);
        await expectGuard(tx, rollback(grants), 'PENDING_ROLLBACK_DATA_PRESENT');
        await expectGuard(tx, rollback(news), 'PENDING_ROLLBACK_DATA_PRESENT');
        assert.deepEqual(await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']), before, 'refused rollback preserves all grants, leaders and published text');
        assert.equal(await definition(tx, legacy), paidPublisher); await noClientPublisher(tx);
      });
      console.log('PASS actual populated rollback files retain grants, country leaders and published sites');
      for (const [file, name] of [[grants, 'creator_site_cohort_grants'], [news, 'news_region_leads']]) {
        await isolated(async tx => {
          await syntheticRecords(tx);
          const before = await snapshot(tx, [...baseTables, `public.${name}`]);
          await tx.exec(`alter table public.${name} add column native_proof_extra text`);
          await expectGuard(tx, file, 'PENDING_TABLE_CHANGED'); await expectGuard(tx, rollback(file), 'PENDING_TABLE_CHANGED');
          assert.equal((await tx.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name=$1 and column_name='native_proof_extra'", [name])).rows[0].n, 1);
          await tx.exec(`alter table public.${name} drop column native_proof_extra`);
          assert.deepEqual(await snapshot(tx, [...baseTables, `public.${name}`]), before, 'schema refusal preserves records');
        });
        await isolated(async tx => {
          await tx.exec(`alter table public.${name} disable row level security`);
          await expectGuard(tx, file, 'PENDING_TABLE_CHANGED'); await expectGuard(tx, rollback(file), 'PENDING_TABLE_CHANGED');
        });
      }
      for (const withUser of [false, true]) await isolated(async tx => {
        await syntheticRecords(tx);
        const before = await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']);
        const signature = withUser ? cohort : legacy;
        await tx.exec(`create or replace function public.creator_publish_site(p_org_id uuid,p_title text,p_tagline text,p_bio text${withUser ? ',p_user_id uuid' : ''})
          returns text language plpgsql security invoker set search_path=public,pg_temp as $proof$ begin return 'synthetic changed body'; end $proof$`);
        const changed = await definition(tx, signature);
        await expectGuard(tx, publish, 'PENDING_FUNCTION_CHANGED'); await expectGuard(tx, rollback(publish), 'PENDING_FUNCTION_CHANGED');
        assert.equal(await definition(tx, signature), changed, 'refusal must not overwrite a later publisher definition');
        assert.deepEqual(await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']), before, 'function-body refusal preserves all records');
      });
      console.log('PASS forward/rollback files refuse changed table shape, RLS and publisher bodies without losing data');
      for (const file of [grants, news]) await isolated(async tx => {
        await tx.exec('set transaction isolation level repeatable read');
        await expectGuard(tx, rollback(file), 'PENDING_REQUIRES_READ_COMMITTED');
      });
      console.log('PASS grants/news recoveries reject old-snapshot transactions before inspecting or dropping state');
      await isolated(async tx => {
        const { org } = await syntheticRecords(tx);
        const before = await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']);
        await tx.exec(source[rollback(publish)]); await tx.exec(source[rollback(publish)]);
        assert.equal((await tx.query('select to_regprocedure($1) as f', [cohort])).rows[0].f, null);
        assert.equal(await definition(tx, legacy), paidPublisher);
        assert.deepEqual(await snapshot(tx, [...baseTables, 'public.creator_site_cohort_grants', 'public.news_region_leads']), before, 'publisher rollback retains all publications and grants');
        await noClientPublisher(tx); await tx.exec('set local role service_role');
        assert.equal((await tx.query('select public.creator_publish_site($1,$2,$3,$4) as slug', [org, 'Paid publisher still works', '', ''])).rows[0].slug, `site-${org.replaceAll('-', '')}`);
        await tx.exec('reset role'); await tx.exec(source[publish]); await noClientPublisher(tx);
        assert.notEqual((await tx.query('select to_regprocedure($1) as f', [cohort])).rows[0].f, null);
      });
      console.log('PASS actual publisher rollback/reapply preserves paid service publishing and keeps browser EXECUTE revoked');
    }
    for (const file of [rollback(publish), rollback(publish), rollback(grants), rollback(grants), rollback(news), rollback(news)]) await apply(file);
    assert.deepEqual((await db.query(`select to_regclass('public.creator_site_cohort_grants') is null as grants,
      to_regclass('public.news_region_leads') is null as news,
      to_regprocedure('public.creator_publish_site(uuid,text,text,text,uuid)') is null as cohort`)).rows[0], { grants: true, news: true, cohort: true });
    assert.equal(await definition(db, legacy), paidPublisher, 'exact canonical paid publisher remains'); await noClientPublisher();
    assert.deepEqual(await snapshot(), original, `rollback pass ${pass}: baseline row counts and complete-row digests unchanged`);
    console.log(`PASS actual empty rollback ${pass}: repeatable, correct dependency order, legacy publisher and existing rows preserved`);
  }
  console.log(JSON.stringify({ suite: 'creator-cohort-news-native', full_reset: fullReset, fixture_results: fixtureResults,
    guard_checks: guardChecks, passed: true, synthetic_rows_rolled_back: true, pending_objects_removed: true,
    legacy_client_grant_hardening_retained: true, production_changes: false,
    sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(source[file]).digest('hex')])) }));
} finally {
  try {
    if (fullReset && ownsPending) {
      // Only actual guarded rollback files may clean up newly introduced
      // objects. No force deletion or restoration of unsafe client grants.
      for (const file of [rollback(publish), rollback(grants), rollback(news)]) await apply(file);
    }
  } finally { await db.close(); }
}
