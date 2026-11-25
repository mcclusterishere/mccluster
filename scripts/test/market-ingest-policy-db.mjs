// No URL or credentials accepted. Exercises exact migration functions in disposable PostgreSQL.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const original=await readFile('supabase/migrations/20260919055029_universal_ingestion_entity_resolution_v1.sql','utf8');
const repair=await readFile('supabase/pending/20261022015000_market_layer1_preserve_source_policy.sql','utf8');
const behaviour=await readFile('supabase/tests/market_layer1_policy.behaviour.sql','utf8');
const container='market-policy-test-'+process.pid;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=s=>docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres'],s);
function fn(name){const start=original.indexOf('create or replace function '+name+'(');if(start<0)throw Error('Function missing: '+name);return original.slice(start,original.indexOf('$$;',start)+3);}
try{
 docker(['run','--pull=never','--rm','-d','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6']);
 for(let i=0;i<60;i++){try{sql('select 1');break;}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,250));}}
 sql(`create schema private;create schema extensions;create extension pgcrypto with schema extensions;
 create role anon;create role authenticated;create role service_role bypassrls;
 create table public.orgs(id uuid primary key,slug text);
 insert into public.orgs values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture-policy');`);
 sql(original.slice(original.indexOf('create table if not exists public.ops_ingest_connectors'),original.indexOf('create table if not exists public.ops_fact_claims')));
 for(const name of ['private.ops_ingest_ensure_connector','private.ops_ingest_upsert_record','public.ops_ingest_begin_run_service','public.ops_ingest_write_record_service'])sql(fn(name));
 sql(`revoke all on function private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
 revoke all on function private.ops_ingest_upsert_record(uuid,text,text,text,text,text,jsonb,timestamptz,jsonb,uuid,uuid) from public,anon,authenticated;
 revoke all on function public.ops_ingest_begin_run_service(uuid,text,text,jsonb) from public,anon,authenticated;
 revoke all on function public.ops_ingest_write_record_service(uuid,uuid,text,text,jsonb,timestamptz,jsonb) from public,anon,authenticated;
 grant execute on function public.ops_ingest_begin_run_service(uuid,text,text,jsonb) to service_role;
 grant execute on function public.ops_ingest_write_record_service(uuid,uuid,text,text,jsonb,timestamptz,jsonb) to service_role;`);
 let reproduced=false;
 try{sql(behaviour);}catch(e){reproduced=String(e.stderr).includes('Source policy erased by canonical record upsert');}
 if(!reproduced)throw Error('Baseline did not reproduce the policy-loss defect');
 console.log('PASS: original migration reproduces policy loss');
 sql(repair);sql(behaviour);
 console.log('PASS: repaired policy snapshots, explicit updates, service writes, revisions and grants');
}finally{try{docker(['rm','-f',container]);}catch{}}
