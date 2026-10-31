// Sandbox integration: actual PostgreSQL semantics through PGlite; all provider/checkout I/O is fixture-only.
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {handleCreatorDomainOrders,recordDomainFunding,fulfillStoredDomainOrder,domainPurchaseCapabilities} from '../../workers/mccluster/src/creator-domain-orders.js';
const db=new PGlite(),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');`);
await db.exec(fs.readFileSync(new URL('../../supabase/pending/creator_domain_orders_v1.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',CREATOR_DOMAIN_SALES_ENABLED:'true',CREATOR_DOMAIN_TERMS_URL:'https://mccluster.org/domain-terms',CREATOR_DOMAIN_TERMS_VERSION:'fixture-v1',CREATOR_DOMAIN_MARKUP_CENTS:'200'};
const identifier=s=>{assert.match(s,/^[a-z_]+$/);return '"'+s+'"';};
async function fetchImpl(input,init={}){
 const u=new URL(input),method=init.method||'GET';
 if(u.pathname==='/auth/v1/user')return Response.json({id:init.headers.authorization==='Bearer A'?A:B});
 assert.equal(u.hostname,'fixture.invalid');
 const parts=u.pathname.split('/').filter(Boolean),name=parts.at(-1),body=init.body?JSON.parse(init.body):null;
 try{
  if(parts.includes('rpc')){const values=Object.values(body),r=await db.query(`select public.${identifier(name)}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);return Response.json(r.rows[0].result);}
  let args=[],where=[];
  for(const [k,v]of u.searchParams){if(['select','limit','order'].includes(k))continue;assert.match(v,/^eq\./);args.push(v.slice(3));where.push(`${identifier(k)}=$${args.length}`);}
  let sql;
  if(method==='POST'){args=Object.values(body);sql=`insert into public.${identifier(name)}(${Object.keys(body).map(identifier).join(',')})values(${args.map((_,i)=>'$'+(i+1)).join(',')}) returning *`;}
  else if(method==='PATCH'){const set=Object.entries(body).map(([k,v])=>{args.push(v);return `${identifier(k)}=$${args.length}`;});sql=`update public.${identifier(name)} set ${set.join(',')} ${where.length?'where '+where.join(' and '):''} returning *`;}
  else{const cols=u.searchParams.get('select')?.split(',').map(identifier).join(',')||'*';sql=`select ${cols} from public.${identifier(name)} ${where.length?'where '+where.join(' and '):''}`;if(u.searchParams.has('order')){const [k,dir]=u.searchParams.get('order').split('.');sql+=` order by ${identifier(k)} ${dir==='desc'?'desc':'asc'}`;}if(u.searchParams.has('limit'))sql+=' limit '+Number(u.searchParams.get('limit'));}
  return Response.json((await db.query(sql,args)).rows);
 }catch(e){return Response.json({code:e.code},{status:409});}
}
let calls=0,timeout=false,ownership=true;
const provider={quote:async()=>({available:true,premium:false,currency:'USD',registrar_cents:1000}),createContact:async()=>({id:crypto.randomUUID(),verified:true}),register:async({domain})=>{calls++;if(timeout)throw Error('timeout');return{code:300,domain,order_amount:'10.00'};},renew:async({domain})=>{calls++;return{code:300,domain,order_amount:'10.00'};},verifyOwnership:async()=>({owned:ownership,registrant_matches:true,expires_at:new Date(Date.now()+31536000000).toISOString()})};
let checkoutCalls=0;
const options={fetchImpl,provider,authorizeEntitlement:async()=>true,createDomainCheckout:async o=>{checkoutCalls++;return{id:'cs_'+o.id,url:'https://checkout.stripe.com/c/pay/fixture'};}};
async function call(user,path='',body){const r=await handleCreatorDomainOrders(new Request('https://api.mccluster.org/v1/creator-domain-orders'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+user},body:body?JSON.stringify(body):undefined}),env,options);return{status:r.status,body:await r.json()};}
const contactBody={first_name:'Fixture',last_name:'Only',address:'Fixture address',city:'Fixture city',state:'CA',postal_code:'90001',country:'US',email:'fixture@example.invalid',phone:'+1 555 555 0100',consent:true,terms_version:'fixture-v1'};
assert.equal(domainPurchaseCapabilities(env,{}).purchase,false);
const contact=(await call('A','/contacts',contactBody)).body.contact;
assert.ok(contact.id);
const quote=(await call('A','/quotes',{hostname:'customer.org'})).body.quote;assert.equal(quote.total_cents,1200);
const orderBody={quote_id:quote.id,contact_id:contact.id,consent:true,terms_version:'fixture-v1'};
assert.equal((await call('B','',orderBody)).status,404);
assert.equal((await call('A','',{...orderBody,consent:false})).status,400);
const order=(await call('A','',orderBody)).body.order;assert.ok(order.id);
assert.equal((await call('A','',orderBody)).body.order.id,order.id);
assert.equal((await call('B','/'+order.id+'/checkout',{})).status,404);
assert.equal((await call('A','/'+order.id+'/checkout',{})).status,200);assert.equal(checkoutCalls,1);
await assert.rejects(db.query('update creator_domain_quotes set total_cents=1 where id=$1',[quote.id]),/permission denied/);
await assert.rejects(db.query('update creator_domain_orders set auth_user_id=$1 where id=$2',[B,order.id]),/immutable/);
const funding={orderId:order.id,ownerUserId:A,eventId:'evt_1',sessionId:'cs_'+order.id,amountTotal:1200,currency:'usd',paymentStatus:'paid',paidAt:new Date().toISOString()};
assert.equal((await recordDomainFunding({...funding,ownerUserId:B},env,{fetchImpl})).status,'not_found');
assert.equal((await recordDomainFunding(funding,env,{fetchImpl})).status,'funded');
assert.equal((await recordDomainFunding(funding,env,{fetchImpl})).status,'funded');
assert.equal((await fulfillStoredDomainOrder(order.id,env,{provider,fetchImpl})).status,'fulfilled');
assert.equal((await fulfillStoredDomainOrder(order.id,env,{provider,fetchImpl})).status,'not_claimed');assert.equal(calls,1);
assert.equal((await call('A','/'+order.id+'/checkout',{})).status,409);
assert.equal((await call('B')).body.orders.length,0);
async function nextOrder(domain){const q=(await call('A','/quotes',{hostname:domain})).body.quote;return(await call('A','',{...orderBody,quote_id:q.id})).body.order;}
const wrong=await nextOrder('mismatch.org');assert.equal((await recordDomainFunding({...funding,orderId:wrong.id,eventId:'evt_wrong',sessionId:'cs_wrong',amountTotal:1},env,{fetchImpl})).status,'refund_required');assert.equal((await fulfillStoredDomainOrder(wrong.id,env,{provider,fetchImpl})).status,'not_claimed');
const uncertain=await nextOrder('uncertain.org');await recordDomainFunding({...funding,orderId:uncertain.id,eventId:'evt_uncertain',sessionId:'cs_uncertain'},env,{fetchImpl});timeout=true;
assert.equal((await fulfillStoredDomainOrder(uncertain.id,env,{provider,fetchImpl})).status,'reconciliation_required');assert.equal((await fulfillStoredDomainOrder(uncertain.id,env,{provider,fetchImpl})).status,'not_claimed');assert.equal(calls,2);
const unowned=await nextOrder('unowned.org');await recordDomainFunding({...funding,orderId:unowned.id,eventId:'evt_unowned',sessionId:'cs_unowned'},env,{fetchImpl});timeout=false;ownership=false;assert.equal((await fulfillStoredDomainOrder(unowned.id,env,{provider,fetchImpl})).status,'reconciliation_required');
assert.equal((await call('B','/quotes',{hostname:'customer.org',action:'renew'})).status,404);
await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select * from creator_domain_orders'),/permission denied/);await assert.rejects(db.query("select claim_creator_domain_order($1)",[order.id]),/permission denied/);
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from creator_domain_contacts'),/permission denied/);
await db.close();console.log('Domain purchase SQL/API fixture flow passed: two tenants, immutable quote/consent, checkout, duplicate funding, fulfillment, mismatch/refund, timeout and ownership reconciliation, role denial.');
