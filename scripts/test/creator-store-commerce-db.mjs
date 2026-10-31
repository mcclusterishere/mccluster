import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {checkoutReceipt} from '../../workers/mccluster/src/commerce/receipt.js';
import {commerceSummary} from '../../workers/mccluster/src/commerce/summary.js';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/tmp/selfservice-tools/node_modules/@electric-sql/pglite/dist/index.js');
const sql=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
test('storefront uses actual v3 canonical reconciler atomically across seller tenants, modes, replay, refunds and fulfillment',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table orgs(id uuid primary key,slug text);create table creator_billing_subscriptions(org_id uuid,status text,current_period_end timestamptz);create table org_stripe_accounts(org_id uuid,livemode boolean,charges_enabled boolean,payouts_enabled boolean,details_submitted boolean,stripe_account_id text);
 create table offerings(slug text,title text,revenue_type text,fulfillment_type text,billing_interval text);
 create table leads(id uuid primary key default gen_random_uuid(),org_id uuid,name text,email text,want text,note text,page text,source text,status text,at timestamptz default now());
 create table work_orders(id uuid primary key default gen_random_uuid(),org_id uuid,lead_id uuid,title text,state text,amount_cents integer,currency text default 'usd',items jsonb,source_table text,source_id text,placed_at timestamptz);
 create table work_payments(id uuid primary key default gen_random_uuid(),org_id uuid,title text,state text,amount_cents integer,currency text,provider text,provider_reference text,verification text,lead_id uuid,order_id uuid,renewal_id uuid,paid_at timestamptz,note text);
 create unique index payment_reference on work_payments(org_id,provider,provider_reference) where provider_reference is not null;
 create table work_renewals(id uuid primary key default gen_random_uuid(),org_id uuid,title text,state text,cadence text,order_id uuid,amount_cents integer,currency text,renews_at timestamptz,last_renewed_at timestamptz,source_table text,source_id text);
 create table work_bookings(id uuid primary key default gen_random_uuid(),org_id uuid,lead_id uuid,title text,state text,note text,starts_at timestamptz,created_at timestamptz default now());
 create table work_tasks(id uuid primary key default gen_random_uuid(),org_id uuid,title text,state text default 'open',detail text,related_type text,related_id uuid,completed_at timestamptz);
 create table control_audit(org_id uuid,actor_kind text,event text,resource_type text,resource_id text,detail jsonb);
 `);
 for(const file of ['supabase/migrations/20261006021431_commerce_stripe_reconciler_v1.sql','supabase/migrations/20261006023453_commerce_stripe_reconciler_v2.sql','supabase/pending/commerce_stripe_reconciler_v3.sql','supabase/pending/20261026009300_creator_store.sql','supabase/pending/20261026009500_creator_store_commerce_adapter.sql'])await db.exec(await sql(file));
 const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',house='cccccccc-cccc-cccc-cccc-cccccccccccc';
 await db.query("insert into orgs values($1,'alice'),($2,'bob'),($3,'mccluster')",[a,b,house]);
 for(const [org,acct] of [[a,'acct_alice'],[b,'acct_bob']]){await db.query("insert into creator_billing_subscriptions values($1,'active','2099-01-01')",[org]);for(const mode of [true,false])await db.query('insert into org_stripe_accounts values($1,$2,true,true,true,$3)',[org,mode,acct+(mode?'Live':'Test')])}
 await db.exec('grant all on all tables in schema public to service_role;set role service_role');
 async function make(org,mode){const product=(await db.query("insert into creator_products(org_id,title,kind,amount_cents,status) values($1,'Commission','service',1500,'live') returning id",[org])).rows[0].id;const id=crypto.randomUUID();const order=(await db.query('select reserve_creator_store_order($1,$2,$3,$4) result',[id,product,'a'.repeat(64),mode])).rows[0].result;const suffix=id.replaceAll('-','');const session='cs_'+(mode?'live_':'test_')+suffix,intent='pi_'+suffix;await db.query('update creator_store_orders set checkout_session_id=$1 where id=$2',[session,id]);return {...order,session,intent,mode}}
 const first=await make(a,true),second=await make(b,true),sandbox=await make(a,false);
 async function pay(o,event='evt_'+o.id,account=o.stripe_account_id,mode=o.mode){return(await db.query('select record_creator_store_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',[event,o.id,o.session,account,o.intent,1500,'usd','buyer@example.test',null,new Date().toISOString(),mode])).rows[0].result}
 async function refund(o,n,event='evt_refund_'+n,mode=o.mode){return(await db.query('select record_creator_store_refund($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[event,o.id,o.stripe_account_id,'ch_original',o.intent,1500,n,'usd',mode])).rows[0].result}
 await assert.rejects(refund(first,500,'evt_early'),/refund mismatch/);assert.equal((await db.query('select count(*)::int n from creator_store_events')).rows[0].n,0);
 await assert.rejects(pay(first,'evt_wrong_tenant',second.stripe_account_id),/immutable order/);await assert.rejects(pay(first,'evt_wrong_mode',first.stripe_account_id,false),/immutable order/);
 await pay(first);await pay(first);await pay(first,'evt_second_delivery');await pay(second);await pay(sandbox);
 assert.equal((await db.query('select count(*)::int n from work_orders')).rows[0].n,3);assert.equal((await db.query('select count(*)::int n from work_payments')).rows[0].n,3);assert.equal((await db.query('select count(*)::int n from work_tasks')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from leads')).rows[0].n,2);
 // Legacy metadata routing cannot bypass the storefront payment check.
 await assert.rejects(db.query('select commerce_record_stripe_checkout($1)',[JSON.stringify({session_id:first.session,payment_intent:first.intent,org_id:a,amount_cents:1500,currency:'usd',livemode:true})]),/verified storefront handler/);
 await assert.rejects(db.query('select commerce_record_stripe_refund($1)',[JSON.stringify({payment_intent:first.intent,org_id:b,amount_cents:1500,amount_refunded:1500,livemode:true})]),/verified storefront handler/);assert.equal((await db.query('select count(*)::int n from work_orders')).rows[0].n,3);
 await refund(first,500,'evt_early');await refund(first,500,'evt_early');await refund(first,100,'evt_older');
 let row=(await db.query('select * from creator_store_orders where id=$1',[first.id])).rows[0];assert.equal(row.refunded_cents,500);assert.equal((await db.query('select refunded_cents from work_payments where id=$1',[row.canonical_payment_id])).rows[0].refunded_cents,500);
 await db.query("update creator_store_orders set status='fulfilled',fulfillment_note='Service completed',fulfilled_at=now() where id=$1 and org_id=$2 and status='paid'",[second.id,b]);let fulfilled=(await db.query('select * from creator_store_orders where id=$1',[second.id])).rows[0];assert.equal((await db.query('select state from work_orders where id=$1',[fulfilled.canonical_order_id])).rows[0].state,'fulfilled');assert.equal((await db.query('select state from work_tasks where id=$1',[fulfilled.canonical_task_id])).rows[0].state,'done');
 await refund(first,1500,'evt_full');await pay(first,'evt_late_paid');row=(await db.query('select * from creator_store_orders where id=$1',[first.id])).rows[0];assert.equal(row.status,'refunded');assert.equal((await db.query('select state from work_orders where id=$1',[row.canonical_order_id])).rows[0].state,'cancelled');
 const payments=(await db.query('select * from work_payments where org_id=$1',[a])).rows;assert.equal(commerceSummary({payments}).live.net_cents,0);assert.equal(commerceSummary({payments}).test.net_cents,1500);assert.equal((await db.query('select count(*)::int n from work_payments where org_id=$1',[house])).rows[0].n,0);
 // The existing receipt endpoint sees the same canonical sale, without a new route.
 const fetcher=async url=>{const u=new URL(url);const table=u.pathname.split('/').at(-1);const value=u.searchParams.get(table==='work_orders'?'source_id':'order_id').slice(3);const rows=(await db.query('select * from '+table+' where '+(table==='work_orders'?'source_id':'order_id')+'=$1',[value])).rows;return Response.json(rows)};
 const receipt=await checkoutReceipt({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},first.session,fetcher);assert.equal(receipt.recorded,true);assert.equal(receipt.next,'refunded');assert.equal(receipt.item,'Commission');assert.equal(receipt.refunded_cents,1500);
 const conflict=await make(a,false);
 await db.query("insert into work_orders(org_id,title,state,amount_cents,currency,source_table,source_id,livemode) values($1,'Historic conflicting sale','paid',1,'usd','stripe_checkout',$2,false)",[a,conflict.session]);
 await assert.rejects(pay(conflict),/conflicts with immutable/);assert.equal((await db.query('select status from creator_store_orders where id=$1',[conflict.id])).rows[0].status,'pending');assert.equal((await db.query('select count(*)::int n from creator_store_events where order_id=$1',[conflict.id])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from work_payments where provider_reference=$1',[conflict.intent])).rows[0].n,0);
 const ordinary=(await db.query('select commerce_record_stripe_checkout($1) result',[JSON.stringify({session_id:'cs_test_ordinary00001',payment_intent:'pi_ordinary00001',org_id:house,amount_cents:2500,currency:'usd',livemode:false})])).rows[0].result;assert.equal(ordinary.created,true);
 await db.exec('set role authenticated');await assert.rejects(pay(first),/permission denied/);
 }finally{await db.close()}
});
