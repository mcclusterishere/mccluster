// Actual canonical queue/cost functions over disposable SQL; storage and auth are local fixtures.
import {readFile} from 'node:fs/promises';
import {projectTilesFixture,A,ORG} from './project-tiles-fixture.mjs';
import {handleProjectTiles} from '../../src/project-tiles.js';
export async function studioProcessingFixture(){
 const f=await projectTilesFixture(),objects=new Map();
 const read=path=>readFile(new URL('../../../../'+path,import.meta.url),'utf8');
 await f.sql.exec(`alter table media_jobs alter column id set default gen_random_uuid();alter table media_jobs add column org_id uuid,add column created_by uuid,add column provider text,add column provider_model_id text,add column capability text,add column prompt text,add column input jsonb,add column routing jsonb,add column estimated_cost_cents integer;
 create table ops_compute_nodes(id text primary key);
 -- PGlite exposes PostgreSQL sha256(bytea); this is the pgcrypto digest signature used by canonical enqueue.
 create function digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;`);
 const core=await read('supabase/replay_migrations/20260912071000_compute_node_protocol.sql');
 await f.sql.exec(core.slice(core.indexOf('create table if not exists public.ops_compute_tasks ('),core.indexOf('create table if not exists public.ops_compute_leases (')));
 const costs=await read('supabase/replay_migrations/0052_media_cost_controls.sql');await f.sql.exec(costs.slice(costs.indexOf('create table'),costs.indexOf('create or replace function')));
 const precision=await read('supabase/replay_migrations/0053_media_cost_precision.sql');await f.sql.exec(precision.slice(0,precision.indexOf('create or replace function public.media_record_actual_cost_v2')));
 const queue=await read('supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql');await f.sql.exec(queue.slice(0,queue.indexOf('create or replace function public.compute_enqueue_task'))+queue.slice(queue.indexOf('create or replace function public.compute_enqueue_task'),queue.indexOf('end;\n$$;',queue.indexOf('create or replace function public.compute_enqueue_task'))+8));
 await f.sql.exec('grant all on all tables in schema public to service_role;');
 // An existing approved allowance is fixture input, not a new product grant or subscription projection.
 await f.sql.query("insert into creator_site_access values($1,$2,'pilot','fixture-existing-allowance','2099-01-01',true,200000,now())",[A,ORG]);
 await f.sql.exec("insert into media_models(provider,provider_model_id,capability,enabled) values('native','studio-native-1','media.prepare',true)");
 f.env.WEBSITE_STUDIO_PROCESSOR_ENABLED='true';
 f.db.sign=async(path,upload=false)=>'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/'+(upload?'upload/sign/':'sign/')+'mnet-media/'+path+'?token=fixture';
 f.db.exists=async(path,expected)=>{if(objects.get(path)?.byteLength!==Number(expected))throw Object.assign(Error('Uploaded size differs from the registered source'),{status:400});};
 f.db.put=async(path,bytes)=>{objects.set(path,new Uint8Array(bytes));};
 async function request(path,method='GET',body,token='fixture-alice'){
  return handleProjectTiles(new Request('https://api.mccluster.org/v1/creator-sites/studio'+path,{method,headers:{authorization:'Bearer '+token},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),f.env,{db:f.db,fetchImpl:f.fetchImpl});
 }
 async function call(...args){const r=await request(...args);return {status:r.status,body:await r.json()};}
 const fetcher=async(input,init={})=>{
  const u=new URL(input);
  if(u.origin==='https://api.mccluster.org')return handleProjectTiles(new Request(u,{...init}),f.env,{db:f.db,fetchImpl:f.fetchImpl});
  const marker='/mnet-media/',path=u.pathname.slice(u.pathname.indexOf(marker)+marker.length);
  if(init.method==='PUT'&&u.pathname.includes('/upload/sign/')){objects.set(path,new Uint8Array(await new Response(init.body).arrayBuffer()));return new Response('{}');}
  if(u.origin==='https://zmnhbrjyhxzhkxmhkexs.supabase.co'&&objects.has(path))return new Response(objects.get(path));
  throw Error('Unexpected fixture network request: '+u.origin+u.pathname);
 };
 return {...f,objects,request,mediaCall:call,fetcher};
}
