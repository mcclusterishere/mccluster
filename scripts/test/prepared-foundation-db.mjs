// Portable proof for the seven audit-prepared definitions and Storage policy meaning.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/productization-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');let assertions=0;
const equal=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const denies=async(fn)=>{await assert.rejects(fn,e=>e.code==='42501');assertions++;};
try{
 const pins=JSON.parse(await read('supabase/tests/editor-versioned/fixture-hashes.json'));
 for(const f of ['api-roles','storage','account-fixture']){
  const path='supabase/tests/editor-versioned/'+f+'.sql',s=await read(path);
  equal(createHash('sha256').update(s).digest('hex'),pins[path]);await db.exec(s.replaceAll('create extension if not exists pgcrypto;',''));
 }
 const dir='docs/productization/20261102/',manifest=JSON.parse(await read(dir+'migration-manifest.json'));
 for(const item of manifest.prepared){const s=await read(dir+item.path);equal(createHash('sha256').update(s).digest('hex'),item.sha256);await db.exec(s);}
 for(const f of ['canonical_artist_binding_v1','customer_site_address_assign_v1','customer_site_module_set_v1','customer_site_storage_reserve_v1','customer_site_storage_usage_v1']){
  const q=await db.query("select has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,has_function_privilege('service_role',p.oid,'execute') s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[f]);equal(q.rows.length,1);equal(q.rows[0],{a:false,u:false,s:true});
 }
 const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
 await db.query("insert into managed_projects(slug,owner_user_id,m_uid,name) values('alice-project',$1,$1,'Alice')",[A]);
 await db.exec('set role service_role');
 await db.query("select customer_site_module_set_v1($1,$1,'project','alice-project','world',true)",[A]);
 await denies(()=>db.query("select customer_site_module_set_v1($1,$1,'project','alice-project','world',true)",[B]));
 await db.exec('reset role');
 // Owner-list/delete behavior from the original policy remains, even though writes are fenced.
 await db.query("insert into storage.objects(bucket_id,name,owner,metadata) values('front-media',$1,$2,'{\"size\":1}'),('front-media',$3,$4,'{\"size\":1}')",[A+'/one',A,B+'/two',B]);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:A})]);await db.exec('set role authenticated');
 equal((await db.query("select name from storage.objects where bucket_id='front-media'")).rows,[{name:A+'/one'}]);
 equal((await db.query("delete from storage.objects where name=$1 returning name",[B+'/two'])).rows,[]);
 await db.exec('reset role');
 // A permissive write policy cannot defeat the restrictive quota policies.
 await db.exec("insert into storage.buckets(id,name) values('mnet-media','mnet-media'); create policy fixture_allow_insert on storage.objects for insert to authenticated with check(true); create policy fixture_allow_update on storage.objects for update to authenticated using(true) with check(true); create policy fixture_allow_select on storage.objects for select to authenticated using(true);");
 await db.exec('set role authenticated');
 await denies(()=>db.query("insert into storage.objects(bucket_id,name) values('front-media',$1)",[A+'/blocked']));
 await denies(()=>db.query("insert into storage.objects(bucket_id,name) values('mnet-media',$1)",['studio/'+A+'/blocked']));
 await db.query("insert into storage.objects(bucket_id,name) values('mnet-media','ordinary-permitted')");
 await denies(()=>db.query("update storage.objects set name='studio/blocked' where name='ordinary-permitted'"));
 await denies(()=>db.query("update storage.objects set bucket_id='front-media' where name='ordinary-permitted'"));
 equal((await db.query("update storage.objects set name='ordinary-updated' where name='ordinary-permitted' returning name")).rows,[{name:'ordinary-updated'}]);
 console.log('PASS '+assertions+' assertions: seven pinned SQL definitions, role-specific RPC permissions, cross-account refusal, owner storage visibility/deletion, and restrictive INSERT/UPDATE quota semantics under competing permissive policies.');
}finally{await db.close();}
