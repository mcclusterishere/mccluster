// Disposable PostgreSQL/WASM tests. Never sends fixtures to production.
// PGLITE_MODULE_PATH may point at an isolated @electric-sql/pglite installation.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const {PGlite} = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const promoted = (await readdir(resolve(root, 'supabase/migrations'))).find(f => f.endsWith('_analytics_read_hotpaths_v2.sql'));
const migration = await read(promoted ? `supabase/migrations/${promoted}` : 'supabase/pending/analytics_read_hotpaths_v2.sql');
const promotedV3 = (await readdir(resolve(root, 'supabase/migrations'))).find(f => f.endsWith('_analytics_region_covering_v3.sql'));
const migrationV3 = await read(promotedV3 ? `supabase/migrations/${promotedV3}` : 'supabase/pending/analytics_region_covering_v3.sql');
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant select on tables to service_role;`);
  let fixture = await read('supabase/tests/analytics_region.behaviour.sql');
  const regionSql = await read('supabase/migrations/20261017030554_analytics_region_v1.sql');
  fixture = fixture.replace(/\\i [^\n]+/, () => regionSql);
  // Stable clock across baseline and replacement, including window boundaries.
  await db.exec('begin');
  await db.exec(fixture);
  await db.exec(`insert into public.events(at,name,device_id,is_bot,country,region,edge,site_id)
    select now()-interval '60 days','bar_boot','legacy-'||g,null,'US','Legacy','{"cf-region-code":"L-EG"}',null
      from generate_series(1,5) g;
    insert into public.events(at,name,device_id,is_bot,country,region,edge,site_id)
    select now()-interval '2 hours','bar_boot','tenant-'||g,false,'US','Tenant','{"cf-region-code":"TEN"}',
      '00000000-0000-0000-0000-000000000002' from generate_series(1,5) g;
    create table public.events_lean as select id,at,site_id,name,device_id,coalesce(is_bot,false) as is_bot,country,
      nullif(btrim(region),'') as region,nullif(upper(edge->>'cf-region-code'),'') as region_code from public.events;
    create table public.media_news_articles(id bigint primary key,imported_at timestamptz);
    alter table public.events_lean enable row level security;
    alter table public.events_lean force row level security;
    alter role service_role bypassrls;`);
  const cases = [
    "'US',now()-interval '24 hours',now(),null", "'US',now()-interval '7 days',now(),null",
    "'us',now()-interval '30 days',now(),null", "'US',now()-interval '90 days',now(),null",
    "'US',now()-interval '24 hours',now(),'00000000-0000-0000-0000-000000000001'",
    "'US',now()-interval '24 hours',now(),'00000000-0000-0000-0000-000000000002'",
    "'USA',now()-interval '7 days',now(),null", "'GB',now()-interval '7 days',now(),null",
    "'US',now(),now()+interval '1 day',null"
  ];
  const canonical = rows => rows.map(r => JSON.stringify(r)).sort();
  const baseline = [];
  for (const args of cases) baseline.push(canonical((await db.query(`select * from public.analytics_region_totals(${args})`)).rows));
  await db.exec(migration);
  await db.exec(migrationV3);
  await db.exec('set role service_role');
  for (let i=0;i<cases.length;i++) {
    const rows = canonical((await db.query(`select * from public.analytics_region_totals(${cases[i]})`)).rows);
    assert.deepEqual(rows, baseline[i], `regional semantics: ${cases[i]}`);
  }
  await db.exec('reset role');
  for (const role of ['anon','authenticated']) {
    const {rows} = await db.query(`select has_function_privilege('${role}',
      'public.analytics_region_totals(text,timestamptz,timestamptz,uuid)','execute') as allowed`);
    assert.equal(rows[0].allowed, false, `${role} cannot read owner regions`);
  }
  assert.equal((await db.query(`select prosecdef from pg_proc where proname='analytics_region_totals'`)).rows[0].prosecdef, false);
  // Assert useful access paths with realistic cardinality, without forcing the planner.
  await db.exec(`insert into public.events_lean(id,at,name,is_bot,country,region,region_code,device_id)
    select gen_random_uuid(),now()-g*interval '1 minute','page_view',false,
      case when g%10=0 then 'US' else 'GB' end,'Test','TT','d-'||g from generate_series(1,20000) g;
    insert into public.media_news_articles select g,now()-g*interval '1 minute' from generate_series(1,20000) g;
    analyze public.events_lean; analyze public.media_news_articles;`);
  for (const [query,index] of [
    ['select imported_at from public.media_news_articles order by imported_at desc nulls last limit 1','media_news_articles_imported_v2_idx'],
    ["select at,name from public.events_lean where site_id is null and is_bot is not true order by at desc nulls last limit 1",'events_lean_first_party_counts_v2_idx'],
    ["select name,device_id,region,region_code from public.events_lean where upper(country)='US' and at>=now()-interval '1 hour' and not coalesce(is_bot,false)",'events_lean_country_window_cover_v3_idx']
  ]) {
    const plan = JSON.stringify((await db.query(`explain (format json) ${query}`)).rows);
    assert.ok(plan.includes(index), `planner uses ${index}`);
  }
  await db.exec('rollback');
  console.log('PASS regional parity in nine windows/scopes, legacy fallback, privacy folding, role denial, and three indexed access paths');
} finally { await db.close(); }

const countsDb = new PGlite();
try {
  let fixture = await read('supabase/tests/analytics_business_event_counts.behaviour.sql');
  const countsSql = await read('supabase/migrations/20261021205801_analytics_business_event_counts_v1.sql');
  fixture = fixture.replace(/^\\set.*\n/m,'').replace(/\\ir [^\n]+/, () => countsSql);
  await countsDb.exec(fixture);
  console.log('PASS all eighteen exact business counters, bot/tenant exclusions, time boundaries, and role denial');
} finally { await countsDb.close(); }
