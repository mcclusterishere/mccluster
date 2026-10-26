import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/tmp/selfservice-tools/node_modules/@electric-sql/pglite/dist/index.js');
test('five-argument publisher enforces tenant identity and paid/cohort entitlement in SQL',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table creator_billing_subscriptions(org_id uuid,owner_user_id uuid,status text,current_period_end timestamptz);create table action_cohorts(id uuid,status text);create table action_cohort_members(cohort_id uuid,m_uid text);create table m_auth_user_links(m_uid text,auth_user_id uuid);create table creator_published_sites(org_id uuid primary key,slug text,title text,tagline text,bio text,updated_at timestamptz);create function creator_publish_site(uuid,text,text,text) returns text language sql as 'select $2';insert into auth.users values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');insert into creator_billing_subscriptions values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active','2099-01-01');`);
 for(const file of ['20261010009000_creator_site_cohort_grants.sql','20261010009100_creator_publish_cohort_entitlement.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/pending/'+file,import.meta.url),'utf8'));
 await db.exec('grant select on all tables in schema public to service_role;grant insert,update on creator_published_sites to service_role;set role service_role');
 const publish=(owner,title='My site')=>db.query('select creator_publish_site($1,$2,$3,$4,$5) slug',['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title,'Tag','Bio',owner]);
 assert.match((await publish('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rows[0].slug,/^site-/);
 await assert.rejects(publish('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),/entitlement required/);
 await assert.rejects(publish('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null),/invalid site content/);
 await db.exec('set role authenticated');await assert.rejects(publish('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),/permission denied/);
 }finally{await db.close()}
});
