// Native PostgreSQL proof for the reflection/digest indexes, publisher geography,
// and connector policy-preservation migration. Never connects to a hosted database.
// Uses source-extracted canonical table DDL plus explicit peripheral FK/role stubs;
// this is not a full production migration replay. The normal full reset is separate.
// Run against an isolated localhost:54322 server with NATIVE_TEST_DATABASE_URL and
// POSTGRES_MODULE_PATH as required by native-admin-test-db.mjs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { nativeTestDb, waitForBlocked } from './native-admin-test-db.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const names = [
  'core_reflection_read_indexes_v1',
  'ops_signals_digest_window_unique_v1',
  'world_publisher_verified_geo_v1',
  'market_layer1_preserve_source_policy',
];
const migrations = {};
const recoveries = {};
for (const name of names) {
  const candidates = [];
  for (const dir of ['supabase/pending', 'supabase/migrations']) {
    for (const file of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      if (file === `${name}.sql` || file.endsWith(`_${name}.sql`)) candidates.push(`${dir}/${file}`);
    }
  }
  assert.equal(candidates.length, 1, `exactly one forward migration for ${name}`);
  migrations[name] = await read(candidates[0]);
  recoveries[name] = await read(candidates[0].replace(/\.sql$/, '.rollback.sql'));
}
const between = (text, start, end) => {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `canonical source markers: ${start}`);
  return text.slice(from, to);
};
const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const db = await nativeTestDb('small_pending');
let passed = 0;
const check = async (name, fn) => { await fn(); console.log(`PASS ${++passed} ${name}`); };
const expectCode = (fn, code) => assert.rejects(fn, error => error.code === code);
const apply = name => db.transaction(tx => tx.exec(migrations[name]));
const recover = name => db.transaction(tx => tx.exec(recoveries[name]));
const asRole = (role, fn) => db.transaction(async tx => {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await tx.exec(`set local role ${role}`);
  return fn(tx);
});
try {
  console.log('Native server:', (await db.query('select version() as version')).rows[0].version);
  await db.exec(await read('supabase/tests/supabase_api_roles.stub.sql'));
  await db.exec(`
    create schema if not exists private;
    create table public.orgs(id uuid primary key);
    create table public.out_companies(id uuid primary key);
    create table public.out_contacts(id uuid primary key);
    create table public.out_campaigns(id uuid primary key);
    insert into public.orgs values ('${org}'), ('${otherOrg}');
  `);
  const ontology = await read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
  await db.exec(between(ontology, 'create table if not exists public.ops_objectives', 'create table if not exists public.ops_ontology_types'));
  const signals = await read('supabase/migrations/20260919031008_canonical_lead_scoring_queue_contract.sql');
  await db.exec(between(signals, 'create table if not exists public.ops_signals', 'create table if not exists public.ops_lead_scores'));
  const news = await read('supabase/migrations/20261014023548_media_news_namespace.sql');
  await db.exec(between(news, 'create table if not exists public.media_news_sources', 'create table if not exists public.media_news_articles'));
  await db.exec(`
    alter table public.media_news_sources enable row level security;
    revoke all on public.media_news_sources from public,anon,authenticated;
    grant all on public.media_news_sources to service_role;
    grant select,insert on public.ops_signals to service_role;
    grant usage on sequence public.ops_signals_id_seq to service_role;
    insert into public.media_news_sources(domain,language_code) values ('fixture.example','en');
    insert into public.ops_agent_jobs(org_id,job_type,status,updated_at)
      select case when g % 4 = 0 then '${otherOrg}'::uuid else '${org}'::uuid end,
             case when g % 3 = 0 then 'host_health' else 'fixture_job' end,
             case when g % 2 = 0 then 'done' else 'failed' end,
             '2026-11-24T00:00:00Z'::timestamptz + make_interval(secs=>g)
        from generate_series(1,4000) g;
    analyze public.ops_agent_jobs;
  `);
  const ingestion = await read('supabase/migrations/20260919055029_universal_ingestion_entity_resolution_v1.sql');
  await db.exec(between(ingestion, 'create table if not exists public.ops_ingest_connectors', 'create table if not exists public.ops_ingest_runs'));
  const functionStart = ingestion.indexOf('create or replace function private.ops_ingest_ensure_connector(');
  const functionEnd = ingestion.indexOf('$$;', functionStart) + 3;
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  await db.exec(ingestion.slice(functionStart, functionEnd));
  // Match the observed live ACL: this private helper is executable only by its owner.
  await db.exec(`revoke all on function private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb) from public,anon,authenticated,service_role`);
  const originalAcl = (await db.query(`select proacl::text as acl from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure`)).rows[0].acl;
  const healthQuery = `select id from public.ops_agent_jobs where org_id='${org}' and job_type='host_health' and status='done' order by updated_at desc,id desc limit 1`;
  const recentQuery = `select id from public.ops_agent_jobs where org_id='${org}' and job_type<>'host_health' and updated_at>='2026-11-24T00:00:00Z' order by updated_at desc,id desc limit 12`;
  const healthBefore = (await db.query(healthQuery)).rows;
  const recentBefore = (await db.query(recentQuery)).rows;

  await check('all four migrations apply in ordinary transactions twice', async () => {
    for (let pass=0; pass<2; pass++) for (const name of names) await apply(name);
    const { rows } = await db.query(`select relname from pg_class where relname in ('ops_agent_jobs_reflection_health_idx','ops_agent_jobs_reflection_recent_idx','ops_signals_core_digest_window_key') order by relname`);
    assert.equal(rows.length, 3);
    const constraints = await db.query(`select count(*)::int as n from pg_constraint where conrelid='public.media_news_sources'::regclass and conname='media_publisher_headquarters_complete'`);
    assert.equal(constraints.rows[0].n, 1);
  });
  await check('reflection result ordering stays identical and both real plans use the new indexes', async () => {
    assert.deepEqual((await db.query(healthQuery)).rows, healthBefore);
    assert.deepEqual((await db.query(recentQuery)).rows, recentBefore);
    const healthPlan = JSON.stringify((await db.query(`explain (format json) ${healthQuery}`)).rows);
    const recentPlan = JSON.stringify((await db.query(`explain (format json) ${recentQuery}`)).rows);
    assert.ok(healthPlan.includes('ops_agent_jobs_reflection_health_idx'), healthPlan);
    assert.ok(recentPlan.includes('ops_agent_jobs_reflection_recent_idx'), recentPlan);
  });
  await check('unique digest windows constrain only the same organization and report type', async () => {
    const insert = (orgId,type,payload) => db.query(`insert into public.ops_signals(org_id,signal_type,source,payload) values($1,$2,'fixture',$3::jsonb)`,[orgId,type,payload]);
    await insert(org,'core_morning_digest',{window_id:'scope-proof'});
    assert.equal((await db.query(`select jsonb_typeof(payload) as kind from public.ops_signals where source='fixture' limit 1`)).rows[0].kind,'object');
    await expectCode(() => insert(org,'core_morning_digest',{window_id:'scope-proof'}),'23505');
    await insert(otherOrg,'core_morning_digest',{window_id:'scope-proof'});
    await insert(org,'other_signal',{window_id:'scope-proof'});
    await insert(org,'core_morning_digest',{});
    await insert(org,'core_morning_digest',{});
    assert.equal((await db.query('select count(*)::int as n from public.ops_signals')).rows[0].n,5);
  });
  await check('two real sessions racing for one digest window commit exactly one row', async () => {
    const first=db.fork(), second=db.fork();
    let secondResult;
    try {
      await first.exec('begin');
      await first.query(`insert into public.ops_signals(org_id,signal_type,source,payload) values($1,'core_morning_digest','fixture','{"window_id":"race-proof"}')`,[org]);
      secondResult=second.query(`insert into public.ops_signals(org_id,signal_type,source,payload) values($1,'core_morning_digest','fixture','{"window_id":"race-proof"}')`,[org]).then(value=>({value}),error=>({error}));
      await waitForBlocked(db);
      await first.exec('commit');
      assert.equal((await secondResult).error?.code,'23505');
      assert.equal((await db.query(`select count(*)::int as n from public.ops_signals where payload->>'window_id'='race-proof'`)).rows[0].n,1);
    } finally {
      await first.exec('rollback');
      if(secondResult) await secondResult;
      await first.close(); await second.close();
    }
  });
  await check('pre-existing duplicate windows fail the build without deleting either row or leaving an index', async () => {
    await db.exec('begin');
    try {
      await db.exec('drop index public.ops_signals_core_digest_window_key');
      await db.query(`insert into public.ops_signals(org_id,signal_type,source,payload) values($1,'core_morning_digest','fixture','{"window_id":"scope-proof"}')`,[org]);
      await db.exec('savepoint before_index_build');
      await expectCode(()=>db.exec(migrations.ops_signals_digest_window_unique_v1),'23505');
      await db.exec('rollback to savepoint before_index_build');
      assert.equal((await db.query(`select count(*)::int as n from public.ops_signals where org_id=$1 and payload->>'window_id'='scope-proof' and signal_type='core_morning_digest'`,[org])).rows[0].n,2);
      assert.equal((await db.query(`select to_regclass('public.ops_signals_core_digest_window_key') as index_name`)).rows[0].index_name,null);
    } finally {await db.exec('rollback');}
    assert.ok((await db.query(`select to_regclass('public.ops_signals_core_digest_window_key') as index_name`)).rows[0].index_name);
  });
  await check('digest build respects its five-second lock timeout and then succeeds after release', async () => {
    await db.exec('drop index public.ops_signals_core_digest_window_key');
    const holder=db.fork();
    try {
      await holder.exec('begin; lock table public.ops_signals in row exclusive mode');
      await expectCode(()=>apply('ops_signals_digest_window_unique_v1'),'55P03');
      assert.equal((await db.query(`select to_regclass('public.ops_signals_core_digest_window_key') as index_name`)).rows[0].index_name,null);
    } finally {await holder.exec('rollback');await holder.close();}
    await apply('ops_signals_digest_window_unique_v1');
  });
  await check('publisher additions preserve old rows and reject incomplete or invalid verified geography', async () => {
    const old=(await db.query(`select * from public.media_news_sources where domain='fixture.example'`)).rows[0];
    assert.equal(old.language_code,'en');assert.equal(old.headquarters_latitude,null);assert.equal(old.publisher_kind,null);
    await db.exec(`update public.media_news_sources set publisher_kind='wire',headquarters_label='Verified fixture',headquarters_latitude=40,headquarters_longitude=-75,headquarters_basis='official_address',headquarters_source_url='https://fixture.example/about',headquarters_verified_at=now() where domain='fixture.example'`);
    for(const assignment of [
      "publisher_kind='unknown'",'headquarters_latitude=91','headquarters_longitude=-181',
      "headquarters_basis='story_mention'","headquarters_source_url='http://fixture.example'",
      'headquarters_longitude=null','headquarters_basis=null','headquarters_verified_at=null','headquarters_source_url=null',
    ]) await expectCode(()=>db.query(`update public.media_news_sources set ${assignment} where domain='fixture.example'`),'23514');
    await db.exec(`insert into public.media_news_sources(domain,language_code) values('new-unverified.example','en')`);
    assert.equal((await db.query(`select count(*)::int as n from public.media_news_sources where headquarters_basis='official_address'`)).rows[0].n,1);
  });
  await check('publisher RLS and API privileges remain service-only through real role calls', async () => {
    assert.equal((await db.query(`select relrowsecurity from pg_class where oid='public.media_news_sources'::regclass`)).rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated']) {
      await expectCode(()=>asRole(role,tx=>tx.query('select * from public.media_news_sources')),'42501');
      await expectCode(()=>asRole(role,tx=>tx.query(`insert into public.media_news_sources(domain) values('denied.example')`)),'42501');
    }
    await asRole('service_role',tx=>tx.query(`insert into public.media_news_sources(domain) values('service.example')`));
  });
  await check('connector ensure preserves omitted, null and empty policies while allowing explicit changes', async () => {
    const call=(description,retention,license)=>db.query(`select private.ops_ingest_ensure_connector($1,'fixture-policy','api','Fixture',$2,$3::jsonb,$4::jsonb) as id`,[org,description,retention,license]);
    const first=await call('Verified source',{days:30},{permission:'read'});
    const id=first.rows[0].id;
    for(const args of [ ['Canonical McCluster source adapter',null,null],['Canonical McCluster source adapter',{},{}] ]) assert.equal((await call(...args)).rows[0].id,id);
    await db.query(`select private.ops_ingest_ensure_connector($1,'fixture-policy','api','Fixture','Canonical McCluster source adapter')`,[org]);
    let row=(await db.query(`select description,retention_policy,license_policy from public.ops_ingest_connectors where id=$1`,[id])).rows[0];
    assert.equal(row.description,'Verified source');assert.deepEqual(row.retention_policy,{days:30});assert.deepEqual(row.license_policy,{permission:'read'});
    await call('Reviewed replacement',{days:14},{permission:'quoted'});
    row=(await db.query(`select description,retention_policy,license_policy from public.ops_ingest_connectors where id=$1`,[id])).rows[0];
    assert.equal(row.description,'Reviewed replacement');assert.deepEqual(row.retention_policy,{days:14});assert.deepEqual(row.license_policy,{permission:'quoted'});
  });
  await check('private connector ACL is unchanged and only service_role can call the readiness probe', async () => {
    assert.equal((await db.query(`select proacl::text as acl from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure`)).rows[0].acl,originalAcl);
    for(const role of ['anon','authenticated','service_role']) await expectCode(()=>asRole(role,tx=>tx.query(`select private.ops_ingest_ensure_connector($1,'denied-policy','api','Denied')`,[org])),'42501');
    for(const role of ['anon','authenticated']) await expectCode(()=>asRole(role,tx=>tx.query('select public.market_layer1_policy_ready_service()')),'42501');
    assert.equal((await asRole('service_role',tx=>tx.query('select public.market_layer1_policy_ready_service() as ready'))).rows[0].ready,true);
  });
  await check('same-name altered optional indexes refuse apply and recovery without changing rows', async () => {
    for (const [name, table, index] of [
      ['core_reflection_read_indexes_v1', 'ops_agent_jobs', 'ops_agent_jobs_reflection_health_idx'],
      ['ops_signals_digest_window_unique_v1', 'ops_signals', 'ops_signals_core_digest_window_key'],
    ]) {
      const before = (await db.query(`select count(*)::integer as n from public.${table}`)).rows[0].n;
      for (const command of [migrations[name], recoveries[name]]) {
        await db.exec('begin');
        try {
          await db.exec(`drop index public.${index}; create index ${index} on public.${table}(org_id)`);
          await db.exec('savepoint guarded_recovery');
          await expectCode(() => db.exec(command), '55000');
          await db.exec('rollback to savepoint guarded_recovery');
          assert.equal((await db.query(`select count(*)::integer as n from public.${table}`)).rows[0].n, before);
          assert.ok((await db.query('select to_regclass($1) as name', [`public.${index}`])).rows[0].name);
        } finally { await db.exec('rollback'); }
      }
    }
  });
  await check('saved verified geography blocks recovery without changing publisher data', async () => {
    const before = (await db.query('select to_jsonb(s) as value from public.media_news_sources s order by id')).rows;
    await expectCode(() => recover('world_publisher_verified_geo_v1'), '55000');
    assert.deepEqual((await db.query('select to_jsonb(s) as value from public.media_news_sources s order by id')).rows, before);
    for (const command of [migrations.world_publisher_verified_geo_v1, recoveries.world_publisher_verified_geo_v1]) {
      await db.exec('begin');
      try {
        await db.exec('alter table public.media_news_sources drop constraint media_publisher_headquarters_complete');
        await expectCode(() => db.exec(command), '55000');
      } finally { await db.exec('rollback'); }
    }
  });
  await check('saved connector policy blocks legacy recovery and an unknown body refuses both directions', async () => {
    const before = (await db.query('select to_jsonb(c) as value from public.ops_ingest_connectors c order by id')).rows;
    const signature = 'private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)';
    const definition = (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [signature])).rows[0].definition;
    await expectCode(() => recover('market_layer1_preserve_source_policy'), '55000');
    assert.deepEqual((await db.query('select to_jsonb(c) as value from public.ops_ingest_connectors c order by id')).rows, before);
    for (const command of [migrations.market_layer1_preserve_source_policy, recoveries.market_layer1_preserve_source_policy]) {
      await db.exec('begin');
      try {
        await db.exec(definition.replace('AS $function$', 'AS $function$\n-- synthetic concurrent change\n'));
        await expectCode(() => db.exec(command), '55000');
      } finally { await db.exec('rollback'); }
      assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) as definition', [signature])).rows[0].definition, definition);
    }
  });
  await check('geography and connector recovery reject stale repeatable-read snapshots before removal', async () => {
    for (const name of ['world_publisher_verified_geo_v1', 'market_layer1_preserve_source_policy']) {
      await db.exec('begin isolation level repeatable read');
      try {
        await db.query('select count(*) from public.media_news_sources');
        await assert.rejects(() => db.exec(recoveries[name]), error => error.code === '55000' && error.message.includes('PENDING_REQUIRES_READ_COMMITTED'));
      } finally { await db.exec('rollback'); }
    }
  });
  await check('clean optional recovery repeats, keeps base data and restores the exact canonical helper', async () => {
    // Remove only this disposable proof's newly written optional state. The
    // recovery files themselves never clear data to make their guards pass.
    await db.exec(`update public.media_news_sources set publisher_kind=null,headquarters_label=null,headquarters_latitude=null,
      headquarters_longitude=null,headquarters_basis=null,headquarters_source_url=null,headquarters_verified_at=null
      where domain='fixture.example'`);
    await db.exec(`delete from public.ops_ingest_connectors where connector_key='fixture-policy'`);
    const before = (await db.query(`select (select count(*) from public.ops_agent_jobs) as jobs,(select count(*) from public.ops_signals) as signals,
      (select jsonb_agg(jsonb_build_object('id',id,'domain',domain,'language_code',language_code,'created_at',created_at) order by id) from public.media_news_sources) as publishers`)).rows[0];
    for (let pass = 0; pass < 2; pass++) for (const name of [...names].reverse()) await recover(name);
    assert.equal((await db.query("select to_regprocedure('public.market_layer1_policy_ready_service()') as ready")).rows[0].ready, null);
    assert.equal((await db.query(`select proacl::text as acl from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure`)).rows[0].acl, originalAcl);
    assert.equal((await db.query(`select prosrc as body from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure`)).rows[0].body,
      ingestion.slice(functionStart, functionEnd).match(/as \$\$([\s\S]*?)\$\$;/i)[1]);
    assert.deepEqual((await db.query(`select (select count(*) from public.ops_agent_jobs) as jobs,(select count(*) from public.ops_signals) as signals,
      (select jsonb_agg(jsonb_build_object('id',id,'domain',domain,'language_code',language_code,'created_at',created_at) order by id) from public.media_news_sources) as publishers`)).rows[0], before);
    for (const name of names) await apply(name);
    assert.equal((await db.query('select public.market_layer1_policy_ready_service() as ready')).rows[0].ready, true);
  });
  console.log(`PASS ${passed} native scenario groups. Source-extracted canonical table DDL with peripheral FK/auth-role stubs; full reset remains separate.`);
} finally {await db.close();}
