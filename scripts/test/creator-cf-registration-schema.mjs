import fs from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');`);
for(const file of ['creator_domain_orders_v1.sql','creator_cf_registration_attempts_v1.sql'])await db.exec(fs.readFileSync(new URL('../../supabase/pending/'+file,import.meta.url),'utf8'));
await db.exec('set role service_role');
async function seed(owner,hostname,event) {
 const c=(await db.query("insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values($1,$2,'fixture',now(),now()) returning id",[owner,event])).rows[0].id;
 const q=(await db.query("insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values($1,$2,'register',1,1500,857,'USD',now()+interval '1 hour') returning id",[owner,hostname])).rows[0].id;
 const o=(await db.query("insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version) values($1,$2,$3,'fixture') returning id",[owner,q,c])).rows[0].id;
 await db.query("select fund_creator_domain_order($1,$2,$3,$4,1500,'USD',now())",[o,owner,event,'session-'+event]);return o;
}
const order=await seed(A,'customer.org','event-a'),hash='a'.repeat(64);
const claim=(id,owner)=>db.query('select claim_cf_registration_attempt($1,$2,$3,$4) as result',[id,owner,'immutable-encrypted-contact-reference',hash]);
assert.equal((await claim(order,B)).rows[0].result,null);
assert.equal((await claim(order,A)).rows[0].result.auth_user_id,A);
assert.equal((await claim(order,A)).rows[0].result,null);
await assert.rejects(db.query("update creator_cf_registration_attempts set auth_user_id=$1 where order_id=$2",[B,order]),/immutable/);
await assert.rejects(db.query("update creator_cf_registration_attempts set status='submit_started',submitted_at=now() where order_id=$1",[order]),/proof/);
await db.query("update creator_cf_registration_attempts set status='submit_started',submitted_at=now(),request_sha256=$1 where order_id=$2",[hash,order]);
await assert.rejects(db.query("update creator_cf_registration_attempts set status='prepared' where order_id=$1",[order]),/replayed/);
await db.query("update creator_cf_registration_attempts set status='processing' where order_id=$1",[order]);
await db.query("update creator_cf_registration_attempts set status='registered_pending_reconciliation' where order_id=$1",[order]);
await assert.rejects(db.query("update creator_cf_registration_attempts set status='reconciliation_required' where order_id=$1",[order]),/terminal/);
const duplicate=await seed(B,'customer.org','event-b');
await assert.rejects(claim(duplicate,B),/unique constraint/);
assert.equal((await db.query('select status from creator_domain_orders where id=$1',[duplicate])).rows[0].status,'funded');
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(db.query('select * from creator_cf_registration_attempts'),/permission denied/);await assert.rejects(claim(order,A),/permission denied/);}
await db.close();console.log('Cloudflare attempts: SQL executed; two owners, single claim, hostname uniqueness, submission proof, terminal monotonicity and role denial passed');
