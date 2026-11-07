// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module. No external database.
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');");
await db.exec(fs.readFileSync(new URL('../../supabase/pending/creator_domains_v1.sql',import.meta.url),'utf8'));
await db.exec("set role service_role;insert into creator_domains(id,auth_user_id,handle,hostname,verification_token) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','creator','www.customer.org','token');");
let r=await db.query("select claim_creator_domain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222',true) as claimed");assert.equal(r.rows[0].claimed,false);
r=await db.query("select claim_creator_domain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',true) as claimed");assert.equal(r.rows[0].claimed,true);
r=await db.query("select claim_creator_domain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',true) as claimed");assert.equal(r.rows[0].claimed,false);
await db.exec('reset role;set role authenticated');
await assert.rejects(db.query('select * from creator_domains'),/permission denied/);
await assert.rejects(db.query("select claim_creator_domain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',true)"),/permission denied/);
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from creator_domains'),/permission denied/);
await db.close();console.log('Domain pending SQL applies in PGlite; role denial, cross-owner claim and exclusive lease passed');
