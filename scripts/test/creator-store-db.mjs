import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/tmp/selfservice-tools/node_modules/@electric-sql/pglite/dist/index.js');
test('store SQL immutable checkout, exact payment, webhook replay and tenant boundaries',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table orgs(id uuid primary key);create table creator_billing_subscriptions(org_id uuid,status text,current_period_end timestamptz);create table org_stripe_accounts(org_id uuid,livemode boolean,charges_enabled boolean,payouts_enabled boolean,details_submitted boolean,stripe_account_id text);insert into orgs values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');insert into creator_billing_subscriptions values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active','2099-01-01');insert into org_stripe_accounts values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false,true,true,true,'acct_alice');grant select,update on all tables in schema public to service_role;`);
 await db.exec(await readFile(new URL('../../supabase/migrations/pending/20261026009300_creator_store.sql',import.meta.url),'utf8'));
 await db.exec(`insert into creator_products(id,org_id,title,kind,amount_cents,status) values('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Commission','service',1500,'live');set role service_role`);
 const id='dddddddd-dddd-dddd-dddd-dddddddddddd',product='cccccccc-cccc-cccc-cccc-cccccccccccc',hash='a'.repeat(64);
 const reserve=async (token=hash)=>(await db.query('select reserve_creator_store_order($1,$2,$3,false) result',[id,product,token])).rows[0].result;
 const first=await reserve();assert.equal(first.amount_cents,1500);assert.deepEqual(await reserve(),first);await assert.rejects(reserve('b'.repeat(64)),/conflict/);
 await db.exec("update creator_products set status='archived'");await assert.rejects(reserve(),/product unavailable/);
 await db.exec("update creator_products set status='live';update creator_billing_subscriptions set status='canceled'");await assert.rejects(reserve(),/seller plan inactive/);
 await db.exec("update creator_billing_subscriptions set status='active';update org_stripe_accounts set charges_enabled=false");await assert.rejects(reserve(),/seller payments unavailable/);
 await db.exec("update org_stripe_accounts set charges_enabled=true");
 await db.exec('update creator_products set amount_cents=2000');assert.equal((await reserve()).amount_cents,1500);
 const paid=async(account='acct_alice',amount=1500,event='evt_fixture')=>(await db.query('select record_creator_store_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[event,id,'cs_fixture',account,'pi_fixture',amount,'usd','buyer@example.test',null,new Date().toISOString()])).rows[0].result;
 await assert.rejects(paid('acct_bob'),/immutable order/);await assert.rejects(paid('acct_alice',2000),/immutable order/);
 await assert.rejects(paid(),/immutable order/);
 await db.exec("update creator_store_orders set checkout_session_id='cs_fixture'");
 assert.equal((await paid()).status,'paid');assert.equal((await paid()).duplicate,true);
 await db.exec("update creator_store_orders set status='fulfilled'");await paid('acct_alice',1500,'evt_second');assert.equal((await db.query('select status from creator_store_orders')).rows[0].status,'fulfilled');
 const refund=async(event,amount,intent='pi_fixture')=>(await db.query('select record_creator_store_refund($1,$2,$3,$4,$5,$6,$7,$8) result',[event,id,'acct_alice','ch_fixture',intent,1500,amount,'usd'])).rows[0].result;
 await assert.rejects(refund('evt_wrong_order_intent',500,'pi_other_order'),/refund mismatch/);
 assert.equal(await refund('evt_refund',500),true);assert.equal(await refund('evt_refund',500),false);
 assert.equal((await db.query('select status from creator_store_orders')).rows[0].status,'partially_refunded');
 await refund('evt_full',1500);await paid('acct_alice',1500,'evt_late_paid');assert.equal((await db.query('select status from creator_store_orders')).rows[0].status,'refunded');
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from creator_store_orders'),/permission denied/);await assert.rejects(reserve(),/permission denied/);
 }finally{await db.close()}
});
