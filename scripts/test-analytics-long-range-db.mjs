import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFile(resolve(root,p),'utf8');
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href:'@electric-sql/pglite');
const promoted=(await readdir(resolve(root,'supabase/migrations'))).find(f=>f.endsWith('_analytics_long_range_v4.sql'));
const migration=await read(promoted?'supabase/migrations/'+promoted:'supabase/pending/analytics_long_range_v4.sql');
const v5=(await readdir(resolve(root,'supabase/migrations'))).find(f=>f.endsWith('_analytics_audience_index_width_v5.sql'));
const widthMigration=await read('supabase/migrations/'+v5);
const v6=(await readdir(resolve(root,'supabase/migrations'))).find(f=>f.endsWith('_analytics_summary_parameter_plans_v6.sql'));
const parameterMigration=await read(v6?'supabase/migrations/'+v6:'supabase/pending/analytics_summary_parameter_plans_v6.sql');
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.events(id uuid primary key,at timestamptz,uid uuid,device_id text,payload text,site_id uuid,session_id text);
    create table public.events_lean(id uuid primary key,at timestamptz,site_id uuid,name text,device_id text,session_id text,dwell_s numeric,is_bot boolean,country text,path text,track text,src text,source text,referrer text,listened_seconds numeric,visible_s numeric);
    create table public.media_news_articles(id uuid primary key,ingestion_provider text,published_at timestamptz,location_country_fips text);
    grant usage on schema public to anon,authenticated,service_role;
    grant select on all tables in schema public to service_role;
    alter table public.events_lean enable row level security;
    alter table public.events_lean force row level security;`);
  await db.exec(await read('supabase/tests/analytics_summary_before_v4.sql'));
  await db.exec(`revoke all on all functions in schema public from public,anon;
    grant execute on all functions in schema public to authenticated,service_role;
    insert into public.events_lean(id,at,site_id,name,device_id,session_id,dwell_s,is_bot)
    select gen_random_uuid(), '2026-10-01T00:00:00Z'::timestamptz+g*interval '1 hour',
      case when g%3=0 then '00000000-0000-0000-0000-000000000001'::uuid when g%3=1 then '00000000-0000-0000-0000-000000000002'::uuid else null end,
      (array['page_view','acquired','album_play','song_start','bar_boot','page_leave'])[1+g%6],
      case when g%11=0 then null else 'd-'||(g%17) end,
      case when g%13=0 then null else 's-'||(g%29) end,g%45,
      case when g%31=0 then null when g%19=0 then true else false end
    from generate_series(0,800) g;
    insert into public.events_lean(id,at,site_id,name,device_id,session_id,dwell_s,is_bot) values
      (gen_random_uuid(),'2026-09-01',null,'bar_boot','old','old',null,false),
      (gen_random_uuid(),'2026-10-10',null,'page_view','boundary','boundary',4,false),
      (gen_random_uuid(),'2026-11-01T05:30:00Z',null,'page_view','dst1','dst1',10,false),
      (gen_random_uuid(),'2026-11-01T06:30:00Z',null,'page_view','dst2','dst2',20,false);
    create index events_lean_first_party_inventory_v1_idx on public.events_lean(name,at desc) where site_id is null;`);
  await db.exec("update public.events_lean set country=case when device_id='dst1' then 'invalid' when name='page_view' then 'us' else 'GB' end");
  const windows=[['2026-10-09','2026-10-10'],['2026-10-01','2026-10-08'],['2026-10-01','2026-10-31'],['2026-08-31','2026-09-02'],['2026-11-01T04:00Z','2026-11-02T05:00Z'],['2025-01-01','2025-01-02']];
  const queries=[];
  for(const site of ['null',"'00000000-0000-0000-0000-000000000001'","'00000000-0000-0000-0000-000000000002'","'00000000-0000-0000-0000-000000000009'"])
    for(const [since,until] of windows)
      for(const fn of ['analytics_totals','analytics_daily','analytics_hourly','analytics_country_totals'])
        queries.push(`select * from public.${fn}('${since}','${until}',${site}${['analytics_totals','analytics_country_totals'].includes(fn)?'':",'America/New_York'"})`);
  // Match PostgREST's lateral JSON argument wrapper, which changes planning.
  const apiQueries=queries.map(q=>{
    const [,fn,args]=q.match(/^select \* from public\.(\w+)\((.*)\)$/),values=args.split(',');
    const names=['p_since','p_until','p_site','p_tz'].slice(0,values.length);
    const types=['timestamptz','timestamptz','uuid','text'];
    return `select f.* from (select json_build_object(${names.map((n,i)=>`'${n}',${values[i]}`).join(',')}) as body) p, lateral (select * from json_to_record(p.body) as x(${names.map((n,i)=>`${n} ${types[i]}`).join(',')}) limit 1) a, lateral public.${fn}(${names.map(n=>'a.'+n).join(',')}) f`;
  });
  queries.push(...apiQueries);
  const before=[];
  await db.exec('set role service_role');
  for(const q of queries)before.push((await db.query(q)).rows);
  await db.exec('reset role');
  const aclBefore=(await db.query("select proname,proacl::text,prosecdef from pg_proc where pronamespace='public'::regnamespace order by proname")).rows;
  await db.exec('begin');await db.exec(migration);await db.exec(parameterMigration);await db.exec('commit');
  assert.deepEqual((await db.query("select proname,proacl::text,prosecdef from pg_proc where pronamespace='public'::regnamespace order by proname")).rows,aclBefore);
  await db.exec('set role service_role');
  for(let i=0;i<queries.length;i++)assert.deepEqual((await db.query(queries[i])).rows,before[i],queries[i]);
  await db.exec('reset role');
  // Realistic volume verifies that the identity page no longer sorts wide payloads.
  await db.exec(`insert into public.events(id,at,uid,device_id,payload) select gen_random_uuid(),now()-g*interval '1 minute',
    ('00000000-0000-0000-0000-'||lpad((g%100)::text,12,'0'))::uuid,'d-'||g,repeat('payload',100)
    from generate_series(1,30000) g;
    insert into public.events_lean(id,at,site_id,name,device_id,session_id,dwell_s,is_bot) select gen_random_uuid(),now()-g*interval '1 minute',null,'page_view','d-'||g,'s-'||g,1,false from generate_series(1,30000) g;
    insert into public.media_news_articles select gen_random_uuid(),'gdelt_gkg_v2',now()-g*interval '1 minute',case when g%20=0 then 'US' else null end from generate_series(1,30000) g;
    analyze public.events;analyze public.events_lean;analyze public.media_news_articles;`);
  const identity="select id,at,payload from public.events where uid in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002') and device_id is not null and at>=now()-interval '30 days' order by at desc,id desc limit 100";
  const rows=(await db.query(identity)).rows;
  await db.exec('begin;drop index events_identity_cover_v4_idx');
  assert.deepEqual((await db.query(identity)).rows,rows,'identity pagination output unchanged');
  await db.exec('rollback');
  // Payload fields are unbounded. An incompressible long URL must remain ingestible.
  const wideInsert="insert into public.events_lean(id,at,name,device_id,is_bot,referrer) select gen_random_uuid(),now(),'page_view','wide-url',false,string_agg(md5(g::text),'') from generate_series(1,500) g";
  await db.exec('begin');
  await assert.rejects(()=>db.exec(wideInsert),/index row|index tuple|maximum/i);
  await db.exec('rollback');
  await db.exec('begin');await db.exec(widthMigration);await db.exec('commit');
  await db.exec(wideInsert);
  assert.equal((await db.query("select octet_length(referrer) as bytes from public.events_lean where device_id='wide-url'")).rows[0].bytes,16000);
  const access=[
    [identity,'events_identity_cover_v4_idx'],
    ["select id,at,name,path,device_id,session_id,track,src,source,referrer,is_bot,listened_seconds,dwell_s,visible_s from public.events_lean where site_id is null and is_bot is false and device_id is not null and name in ('page_view','page_leave') and at>=now()-interval '30 days' order by at,id limit 100",'events_lean_audience_order_v5_idx'],
    ["select name,device_id,session_id,dwell_s from public.events_lean where site_id is null and not is_bot and at>=now()-interval '1 hour'",'events_lean_summary_window_v4_idx'],
    ["select id from public.media_news_articles where ingestion_provider='gdelt_gkg_v2' and published_at>=now()-interval '30 days' and location_country_fips is not null order by published_at,id limit 100",'media_news_geo_window_v4_idx']
  ];
  for(const [q,index] of access)assert.ok(JSON.stringify((await db.query('explain (format json) '+q)).rows).includes(index),index);
  console.log(`PASS ${queries.length} summary parity cases, DST, empty/tenant/bot boundaries, grants, identity page parity, four access paths, and long-URL ingestion`);
}finally{await db.close();}
