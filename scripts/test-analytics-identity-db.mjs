// Isolated PostgreSQL/WASM only; no production credentials or network reads.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href:'@electric-sql/pglite');
const db=new PGlite();
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',SITE='00000000-0000-4000-8000-000000000003';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.analytics_sites(id uuid primary key);
 create table public.events(id uuid primary key,at timestamptz,uid uuid,device_id text,session_id text,name text,site_id uuid references public.analytics_sites(id) on delete set null,
   ip inet,city text,region text,country text,timezone text,asn_org text,user_agent text,device jsonb,postal text, props jsonb default '{}'::jsonb, asn bigint,latitude numeric,longitude numeric);
 create table public.events_lean(id uuid primary key references public.events(id) on delete cascade,at timestamptz,site_id uuid,name text,device_id text,session_id text,is_bot boolean,country text,path text,src text,visible_s numeric,referrer text,track text,depth numeric);
 create table public.platform_profiles(user_id uuid primary key,primary_email text,display_name text,mccluster_id text);
 grant usage on schema public to anon,authenticated,service_role;
 grant select on all tables in schema public to service_role;
 alter table public.events enable row level security;alter table public.events_lean enable row level security;
 insert into public.analytics_sites values('${SITE}');
 insert into public.platform_profiles values('${A}','a@fixture.test','Account A','a'),('${B}','b@fixture.test','Account B','b');`);
 const fixture=[
  ['shared','old',null,'page_view',null,'Anonymous'],
  ['shared','mixed',null,'page_view',null,'Anonymous'],
  ['shared','mixed',A,'music_play',null,'A place'],
  ['shared','mixed',A,'music_full_play',null,'A place'],
  ['shared','mixed',B,'music_play',null,'B place'],
  ['shared','mixed',B,'page_view',null,'B place'],
  ['second','second-session',A,'page_view',null,'A second place'],
  ['shared','tenant',B,'page_view',SITE,'Tenant place'],
 ];
 for(let i=0;i<fixture.length;i++){
   const [device,session,uid,name,site,city]=fixture[i];
   await db.query(`insert into public.events(id,at,uid,device_id,session_id,name,site_id,city,country) values($1,$2,$3,$4,$5,$6,$7,$8,'US')`,
    ['00000000-0000-4000-8000-'+String(i+10).padStart(12,'0'),`2026-10-20T12:00:0${i}Z`,uid,device,session,name,site,city]);
 }
 await db.exec(`insert into public.events_lean(id,at,site_id,name,device_id,session_id,is_bot,country,path,src,visible_s) select id,at,site_id,name,device_id,session_id,false,country,'listen.html','fixture',null from public.events;`);
 // Establish the defect against the checked-in applied v5 definition.
 const baseline=await read('supabase/migrations/20261005212323_analytics_session_forensics_v5.sql');
 const begin=baseline.indexOf('create or replace function public.analytics_visitor_list('),end=baseline.indexOf('$function$;',begin)+12;
 await db.exec(baseline.slice(begin,end));
 const before=(await db.query(`select public.analytics_visitor_list('2026-10-20','2026-10-21') as data`)).rows[0].data;
 assert.equal(before.visitors.find(v=>v.uid===B).events,6,'baseline latest account incorrectly inherits anonymous and A history');
 await db.exec('begin');await db.exec(await read('supabase/pending/analytics_visitor_event_identity_v6.sql'));await db.exec(await read('supabase/pending/analytics_tenant_history_restrict_v1.sql'));await db.exec(await read('supabase/pending/analytics_session_evidence_v6.sql'));await db.exec('commit');
 async function visitors(filter='all',query=null,limit=40,offset=0){
   return (await db.query(`select public.analytics_visitor_list_v6('2026-10-20','2026-10-21',$1,$2,$3,'recent',$4) as data`,[limit,offset,filter,query])).rows[0].data;
 }
 await db.exec('set role service_role');
 const after=await visitors(),by=new Map(after.visitors.map(v=>[v.visitor_key,v]));
 assert.equal(after.total,3);assert.equal(by.get('d:shared').events,2);assert.equal(by.get('d:shared').email,null);
 assert.equal(by.get('u:'+A).events,3);assert.equal(by.get('u:'+A).plays,1,'paired full-play report is not a second start');
 assert.equal(by.get('u:'+B).events,2);assert.equal(by.get('u:'+B).city,'B place');assert.equal(by.get('u:'+A).sessions,2);
 assert.equal(after.visitors.reduce((n,v)=>n+v.events,0),7,'tenant rows excluded and each first-party event counted once');
 assert.equal((await visitors('identified')).total,2);assert.equal((await visitors('all','B place')).total,1);
 assert.equal((await visitors('all','B place')).visitors[0].uid,B,'location search does not match another account on shared device');
 assert.equal((await visitors('all','Tenant place')).total,0);
 assert.equal((await visitors('all',null,1,1)).visitors.length,1);
 assert.equal((await db.query(`select public.analytics_visitor_list_v6('2026-10-21','2026-10-22') as d`)).rows[0].d.total,0);
 async function sessions(key=null,ids=null,limit=100,offset=0){
   return (await db.query(`select public.analytics_session_evidence_v6('2026-10-20','2026-10-21',$1,$2,'any','recent',null,null,$3,$4) as d`,[limit,offset,ids,key])).rows[0].d;
 }
 for(const v of after.visitors){
   const h=await sessions(v.visitor_key);
   assert.equal(h.total,v.sessions,'visitor/history session populations agree');
   assert.equal(h.sessions.reduce((n,x)=>n+x.events,0),v.events,'visitor/history events agree');
   assert.equal(h.sessions.reduce((n,x)=>n+x.plays,0),v.plays,'approved full-start counts agree');
   assert.ok(h.sessions.every(x=>x.visitor_key===v.visitor_key));
 }
 const mixed=(await sessions(null,['mixed'])).sessions[0];
 assert.equal(mixed.uid,null);assert.equal(mixed.email,null);assert.equal(mixed.identity_status,'mixed');
 assert.equal(mixed.account_count,2);assert.equal(mixed.unattributed_events,1);assert.equal(mixed.identity_buckets.length,3);
 const a=(await sessions('u:'+A,['mixed'])).sessions[0];
 assert.equal(a.events,2);assert.equal(a.plays,1);assert.equal(a.city,'A place');assert.equal(a.uid,A);
 assert.equal(a.identity_status,'event_bound_account');assert.equal(a.play_metric_version,'browser-start/v3');
 const anonymous=(await sessions('d:shared',['mixed'])).sessions[0];
 assert.equal(anonymous.events,1);assert.equal(anonymous.uid,null);assert.equal(anonymous.city,'Anonymous');
 assert.equal((await sessions('u:'+A,['tenant'])).total,0);
 assert.equal((await sessions('u:'+A,null,1,1)).sessions.length,1);
 await assert.rejects(()=>sessions('u:not-a-valid-uuid'),/Invalid visitor key/);
 await assert.rejects(()=>db.query(`select public.analytics_session_evidence_v6('2026-10-21','2026-10-20')`),/Invalid analytics range/);
 await db.exec('reset role');
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','public.analytics_session_evidence_v6(timestamptz,timestamptz,integer,integer,text,text,text,text[],text[],text)','execute') as allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`select prosecdef from pg_proc where proname='analytics_session_evidence_v6'`)).rows[0].prosecdef,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','public.analytics_visitor_list_v6(timestamptz,timestamptz,integer,integer,text,text,text)','execute') as allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`select prosecdef from pg_proc where proname='analytics_visitor_list_v6'`)).rows[0].prosecdef,false);
 await assert.rejects(()=>db.exec(`delete from public.analytics_sites where id='${SITE}'`),/foreign key constraint/);
 assert.equal((await db.query(`select count(*)::int as n from public.events where site_id='${SITE}'`)).rows[0].n,1);
 assert.equal((await db.query(`select count(*)::int as n from public.events_lean where site_id='${SITE}'`)).rows[0].n,1,'failed delete preserves raw and lean scope');
 await db.exec('begin');await db.exec(await read('supabase/pending/analytics_tenant_history_restrict_v1.sql'));await db.exec('commit');
 await db.exec(`update public.events_lean set device_id='projection-mismatch' where id='00000000-0000-4000-8000-000000000012'`);
 const missing=await sessions('d:projection-mismatch');
 assert.equal(missing.identity_missing_events,1);assert.equal(missing.sessions[0].uid,null);
 assert.equal(missing.sessions[0].identity_status,'partial_identity');
 assert.equal((await sessions('u:'+A)).sessions.reduce((n,x)=>n+x.events,0),2,'unmatched projection identity cannot claim an account');
 console.log('PASS scoped session/visitor parity, mixed sessions, missing identity, history pagination, schema roles; baseline reproduction, event-bound/shared-device attribution, counts, paired-start exclusion, tenant and time boundaries, scoped location search, pagination, role denial, invoker execution, restricted tenant deletion and idempotency');
}finally{await db.close();}
