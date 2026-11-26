// PGlite executes SQL/RLS fixtures. Native two-session contention lives in CI.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire((process.env.PGLITE_DIR||'/tmp/first-offer-tools/node_modules')+'/fixture.cjs');const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
try{
 for(const file of ['supabase/tests/supabase_api_roles.stub.sql','supabase/tests/supabase_storage.stub.sql','supabase/pending/member_fronts_v1.sql'])await db.exec((await readFile(file,'utf8')).replace('create extension if not exists pgcrypto;',''));
 await db.exec('create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);grant select on m_auth_user_links to service_role;');
 for(const id of [A,B]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into m_auth_user_links values($1,$1,true)',[id]);}
 const sql=await readFile('supabase/pending/customer_site_storage_v1.sql','utf8');await db.exec(sql);await db.exec(sql);
 const reserve=async(user,path,bytes)=>db.query('select customer_site_storage_reserve_v1($1,\'front-media\',$2,$3)',[user,path,bytes]);
 await db.exec('set role service_role');await reserve(A,A+'/a',300000000);await assert.rejects(()=>reserve(A,A+'/b',200000001),/storage full/);await reserve(A,A+'/b',200000000);
 await assert.rejects(()=>reserve(A,A+'/a',3),/already reserved/);await assert.rejects(()=>reserve(A,B+'/stolen',3),/invalid owned/);await reserve(B,B+'/own',3);
 await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('front-media',$1,'{\"size\":300000000}')",[A+'/a']);
 await db.query("update customer_site_storage_reservations set state='settled' where owner_user_id=$1 and path=$2",[A,A+'/a']);
 await db.exec('set role service_role');await reserve(A,A+'/a',100000000);await assert.rejects(()=>reserve(A,A+'/extra',1),/storage full/);await db.exec('reset role');
 await db.query("update customer_site_storage_reservations set state='released' where owner_user_id=$1",[A]);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:A,role:'authenticated'})]);await db.exec('set role authenticated');
 await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('front-media',$1,'{\"size\":1}')",[A+'/bypass']),/row-level security/);
 await assert.rejects(()=>reserve(A,A+'/bypass',1),/permission denied/);
 await db.query("delete from storage.objects where bucket_id='front-media' and name=$1",[A+'/a']);await db.exec('reset role');
 const usage=(await db.query('select customer_site_storage_usage_v1($1) as usage',[A])).rows[0].usage;assert.equal(usage.used_bytes,0);assert.equal(usage.available_bytes,500000000);
 console.log('PASS: 500 MB pooled reservation boundary, repeated writer denial, replacement headroom, tenant isolation, direct Storage bypass denied, owner delete and authoritative usage');
}finally{await db.close();}
