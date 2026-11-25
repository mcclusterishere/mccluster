// Disposable Postgres WASM only; never uses remote database credentials.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');`);
for(const file of ['managed_projects_v1.sql','creator_domains_v1.sql','creator_domain_targets_v1.sql'])await db.exec(fs.readFileSync(new URL('../../supabase/pending/'+file,import.meta.url),'utf8'));
await db.exec(`set role service_role;insert into managed_projects(slug,owner_user_id,m_uid,name) values('portfolio','${A}','${A}','Portfolio');`);
const row=(await db.query('select id from managed_projects')).rows[0];
await db.exec(`insert into creator_domains(auth_user_id,handle,hostname,verification_token,target_type,target_id) values('${A}','portfolio','www.customer.org','proof','managed_project','${row.id}');`);
for(const sql of [`update managed_projects set owner_user_id='${B}'`,`update managed_projects set slug='replacement'`,`update managed_projects set id='${B}'`,`update creator_domains set target_id='${B}'`,`update creator_domains set auth_user_id='${B}'`,`update creator_domains set handle='replacement'`])await assert.rejects(db.exec(sql),/immutable/);
await db.exec("update managed_projects set name='Updated';update creator_domains set status='tls_pending';");
// Delayed callback for a removed claim cannot change a newly created claim.
const old=(await db.query('select id from creator_domains')).rows[0].id;
await db.exec(`delete from creator_domains;insert into creator_domains(auth_user_id,handle,hostname,verification_token,target_type,target_id) values('${A}','portfolio','www.customer.org','newproof','managed_project','${row.id}');`);
assert.equal((await db.query(`update creator_domains set status='active' where id='${old}' returning id`)).rows.length,0);
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(db.query('select * from creator_domains'),/permission denied/);await assert.rejects(db.query('select * from managed_projects'),/permission denied/);}
await db.close();console.log('Domain targets: applied pending SQL, immutable owners/IDs/slugs, late callback and role isolation passed');
