// Sandbox integration: actual PostgreSQL semantics through PGlite; all provider/checkout I/O is fixture-only.
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {handleCreatorDomainOrders,handleVerifiedCloudflareDomainFunding,domainPurchaseCapabilities} from '../../workers/mccluster/src/creator-domain-orders.js';
const db=new PGlite(),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');`);
for(const file of ['creator_domain_orders_v1.sql','creator_cf_registration_attempts_v1.sql','creator_inline_domain_contacts_v1.sql'])await db.exec(fs.readFileSync(new URL('../../supabase/pending/'+file,import.meta.url),'utf8'));
await db.exec('set role service_role');
const env={CREATOR_DOMAIN_CONTACT_KEY_ID:'fixture',CREATOR_DOMAIN_CONTACT_KEYS:JSON.stringify({fixture:btoa('a'.repeat(32))}),CREATOR_CF_REGISTRATION_CHECKOUT_ENABLED:'true',CREATOR_CF_REGISTRATION_EXECUTION_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',CREATOR_DOMAIN_SALES_ENABLED:'true',CREATOR_DOMAIN_TERMS_URL:'https://mccluster.org/domain-terms',CREATOR_DOMAIN_TERMS_VERSION:'fixture-v1',CREATOR_DOMAIN_MARKUP_CENTS:'200'};
const identifier=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/);return '"'+s+'"';};
async function fetchImpl(input,init={}){
 const u=new URL(input),method=init.method||'GET';
 if(u.pathname==='/auth/v1/user')return Response.json({id:init.headers.authorization==='Bearer A'?A:B});
 assert.equal(u.hostname,'fixture.invalid');
 const parts=u.pathname.split('/').filter(Boolean),name=parts.at(-1),body=init.body?JSON.parse(init.body):null;
 try{
  if(parts.includes('rpc')){const values=Object.values(body),r=await db.query(`select public.${identifier(name)}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);return Response.json(r.rows[0].result);}
  let args=[],where=[];
  for(const [k,v]of u.searchParams){if(['select','limit','order'].includes(k))continue;if(v==='is.null'){where.push(`${identifier(k)} is null`);continue;}assert.match(v,/^(eq|gt)\./);args.push(v.slice(3));where.push(`${identifier(k)}${v.startsWith('gt.')?'>':'='}$${args.length}`);}
  let sql;
  if(method==='POST'){args=Object.values(body);sql=`insert into public.${identifier(name)}(${Object.keys(body).map(identifier).join(',')})values(${args.map((_,i)=>'$'+(i+1)).join(',')}) returning *`;}
  else if(method==='PATCH'){const set=Object.entries(body).map(([k,v])=>{args.push(v);return `${identifier(k)}=$${args.length}`;});sql=`update public.${identifier(name)} set ${set.join(',')} ${where.length?'where '+where.join(' and '):''} returning *`;}
  else{const cols=u.searchParams.get('select')?.split(',').map(identifier).join(',')||'*';sql=`select ${cols} from public.${identifier(name)} ${where.length?'where '+where.join(' and '):''}`;if(u.searchParams.has('order')){const [k,dir]=u.searchParams.get('order').split('.');sql+=` order by ${identifier(k)} ${dir==='desc'?'desc':'asc'}`;}if(u.searchParams.has('limit'))sql+=' limit '+Number(u.searchParams.get('limit'));}
  return Response.json((await db.query(sql,args)).rows);
 }catch(e){return Response.json({code:e.code},{status:409});}
}
import {cloudflareRegistrationAdapter} from '../../workers/mccluster/src/domains/cloudflare-registration.js';
import {validateRegistrationSchema} from '../../workers/mccluster/src/domains/registration-schema.js';
let registrarCalls=0,providerState='in_progress',providerTimeout=false,schemaBlocked=false;
const provider=cloudflareRegistrationAdapter({accountId:'fixture',apiToken:'fixture',validateExtension:validateRegistrationSchema,fetchImpl:async(input,init={})=>{
 const url=new URL(input);let result;
 if(url.pathname.endsWith('/domain-check')){const name=JSON.parse(init.body).domains[0];result={domains:[{name,registrable:true,tier:'standard',pricing:{currency:'USD',registration_cost:'10.00',renewal_cost:'11.00'}}]};}
 else if(url.pathname.includes('/extensions/'))result={metadata:{name:'org'},registration_schema:{type:'object',required:['domain_name','years','contacts','auto_renew',...(schemaBlocked?['contact_extensions']:[])],properties:{domain_name:{type:'string',pattern:'\\.org$'},years:{type:'integer',minimum:1,maximum:10},contacts:{type:'object',required:['registrant']},auto_renew:{const:false}}}};
 else if(url.pathname.endsWith('/registrations')){registrarCalls++;if(providerTimeout)throw Error('fixture timeout');const name=JSON.parse(init.body).domain_name;result={state:'in_progress',completed:false,context:{domain_name:name},created_at:new Date().toISOString()};}
 else if(url.pathname.endsWith('/registration-status'))result={state:providerState,completed:providerState==='succeeded',context:{domain_name:url.pathname.split('/').at(-2)},created_at:new Date().toISOString()};
 else result={domain_name:url.pathname.split('/').at(-1),status:'active',auto_renew:false,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+365*86400000).toISOString()};
 return Response.json({success:true,result},{status:url.pathname.endsWith('/registrations')?202:200});
}});
let checkoutCalls=0;
const options={provider,fetchImpl,authorizeEntitlement:async()=>true,createDomainCheckout:async o=>{checkoutCalls++;return {id:'cs_'+o.id,url:'https://checkout.stripe.com/c/pay/fixture'};}};
async function call(user,path='',body,method=body?'POST':'GET'){
 const response=await handleCreatorDomainOrders(new Request('https://api.mccluster.org/v1/creator-domain-orders'+path,{method,headers:{authorization:'Bearer '+user},body:body?JSON.stringify(body):undefined}),env,options);
 return {status:response.status,body:await response.json()};
}
const details={first_name:'Only',last_name:'Fixture',address:'123 Fixture',city:'Austin',state:'TX',postal_code:'78701',country:'US',email:'fixture@example.net',phone:'+1.5555555555',consent:true,terms_version:'fixture-v1'};
assert.equal(domainPurchaseCapabilities({...env,CREATOR_CF_REGISTRATION_CHECKOUT_ENABLED:'false'},options).purchase,false);
assert.equal(domainPurchaseCapabilities(env,options).renew,false);
const saved=await call('A','/contacts',details);assert.equal(saved.status,201,JSON.stringify(saved));const contact=saved.body.contact;
let row=(await db.query('select * from creator_domain_contacts where id=$1',[contact.id])).rows[0];assert.equal(row.provider_contact_id,null);assert.equal(row.verified_at,null);assert.equal(row.contact_kind,'inline');assert.ok(row.sealed_contact);assert.ok(!JSON.stringify(row).includes(details.email));
assert.deepEqual((await call('B')).body.contacts,[]);assert.equal((await call('B','/contacts/'+contact.id,undefined,'DELETE')).status,404);
assert.equal((await call('A','/quotes',{hostname:'customer.org',action:'renew',years:1})).status,400);
async function createOrder(host,contactId=contact.id){
 const q=await call('A','/quotes',{hostname:host,action:'register',years:1});assert.equal(q.status,201,JSON.stringify(q));
 const b={quote_id:q.body.quote.id,contact_id:contactId,consent:true,terms_version:'fixture-v1'};
 assert.equal((await call('B','',b)).status,404);
 const result=await call('A','',b);assert.equal(result.status,201,JSON.stringify(result));
 assert.equal((await call('A','',b)).body.order.id,result.body.order.id);
 assert.equal((await call('A','/'+result.body.order.id+'/checkout',{})).status,200);
 return {id:result.body.order.id,total:q.body.quote.total_cents};
}
function event(order){return {orderId:order.id,ownerUserId:A,eventId:'evt_'+order.id,sessionId:'cs_'+order.id,amountTotal:order.total,currency:'USD',paymentStatus:'paid',paidAt:new Date().toISOString(),livemode:false};}
schemaBlocked=true;const unsupported=await call('A','/quotes',{hostname:'unsupported.org',action:'register',years:1});
assert.equal((await call('A','',{quote_id:unsupported.body.quote.id,contact_id:contact.id,consent:true,terms_version:'fixture-v1'})).status,409);assert.equal(checkoutCalls,0);schemaBlocked=false;
const order=await createOrder('customer.org');
assert.equal((await handleVerifiedCloudflareDomainFunding(event(order),env,options)).status,'processing');assert.equal(registrarCalls,1);
await handleVerifiedCloudflareDomainFunding(event(order),env,options);assert.equal(registrarCalls,1);
assert.equal((await call('B','/'+order.id+'/status',{})).status,404);
providerState='action_required';assert.equal((await call('A','/'+order.id+'/status',{})).body.status,'action_required');
providerState='succeeded';assert.equal((await call('A','/'+order.id+'/status',{})).body.status,'registered_pending_reconciliation');
const list=await call('A');assert.equal(list.body.orders[0].status,'registered_pending_reconciliation');assert.ok(!JSON.stringify(list.body).includes(details.email));
assert.equal((await call('A','/'+order.id+'/checkout',{})).status,409);
// Cipher erasure retains immutable consent/digest but blocks future use.
const second=await createOrder('second.org');assert.equal((await call('A','/contacts/'+contact.id,undefined,'DELETE')).status,200);
row=(await db.query('select * from creator_domain_contacts where id=$1',[contact.id])).rows[0];assert.equal(row.sealed_contact,null);assert.ok(row.deleted_at);
assert.equal((await call('A','/'+second.id+'/checkout',{})).status,409);
assert.equal((await handleVerifiedCloudflareDomainFunding(event(second),env,options)).status,'refund_required');assert.equal(registrarCalls,1);
const newContact=(await call('A','/contacts',details)).body.contact;
const third=await createOrder('third.org',newContact.id);providerTimeout=true;
assert.equal((await handleVerifiedCloudflareDomainFunding(event(third),env,options)).status,'reconciliation_required');assert.equal(registrarCalls,2);
await handleVerifiedCloudflareDomainFunding(event(third),env,options);assert.equal(registrarCalls,2);
await assert.rejects(db.query('update creator_domain_contacts set auth_user_id=$1 where id=$2',[B,newContact.id]),/immutable/);
const expired=(await db.query("insert into creator_domain_contacts(auth_user_id,terms_version,consent_at,contact_kind,sealed_contact,contact_key_id,contact_sha256,expires_at) select auth_user_id,terms_version,consent_at,contact_kind,sealed_contact,contact_key_id,contact_sha256,now()-interval '1 minute' from creator_domain_contacts where id=$1 returning id",[newContact.id])).rows[0].id;
assert.equal(Number((await db.query('select erase_expired_domain_contacts() as count')).rows[0].count),1);assert.equal((await db.query('select sealed_contact from creator_domain_contacts where id=$1',[expired])).rows[0].sealed_contact,null);
await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select sealed_contact from creator_domain_contacts'),/permission denied/);await db.exec('reset role;set role service_role');
await db.close();console.log('Inline contact SQL/API flow passed: encrypted owner isolation, consent, registration-only checkout, verified funding/replay, status, ciphertext deletion and uncertain submit.');
