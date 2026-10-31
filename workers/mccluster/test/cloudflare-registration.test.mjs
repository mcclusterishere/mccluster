import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareRegistrationAdapter,configuredCloudflareRegistration,registrationContact} from '../src/domains/cloudflare-registration.js';
import {startCloudflareRegistration,reconcileCloudflareRegistration,contactDigest} from '../src/domains/cloudflare-registration-flow.js';
// Shapes from official Cloudflare OpenAPI examples (domain/contact/date replaced
// with synthetic fixtures). No connected account, credential or domain operation.
const registrant={email:'ada@example.net',phone:'+1.5555555555',postal_info:{name:'Ada Fixture',address:{street:'123 Fixture St',city:'Austin',state:'TX',postal_code:'78701',country_code:'US'}}};
test('workerd-compatible manual redirect refuses 3xx without forwarding credentials or registrant data',async()=>{
 for(const status of [301,302,303,307,308]) {
  const calls=[];
  const provider=cloudflareRegistrationAdapter({accountId:'fixture',apiToken:'synthetic-secret',fetchImpl:async(url,init)=>{
   // Emulate workerd's supported redirect modes; accepting Node's error mode
   // would hide the production failure this regression is intended to catch.
   if(!['manual','follow'].includes(init.redirect))throw new TypeError('Unsupported workerd redirect mode');
   calls.push({url,init});assert.equal(init.redirect,'manual');
   return new Response(null,{status,headers:{location:'https://untrusted.invalid/collect'}});
  }});
  await assert.rejects(provider.quote('customer.org'),/uncertain/);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/fixture\/registrar-sandbox\/domain-check$/);
  assert.equal(calls[0].init.headers.authorization,'Bearer synthetic-secret');
 }
});
function fixture() {
 const calls=[];let state='in_progress',price='8.57',timeout=false,wrong=false,old=false;
 const now=()=>new Date(old?Date.now()-86400000:Date.now()).toISOString();
 const fetchImpl=async(url,init={})=>{const u=new URL(url);calls.push({path:u.pathname,method:init.method,body:init.body&&JSON.parse(init.body)});assert.match(u.pathname,/\/registrar-sandbox\//);
  let result;
  if(u.pathname.endsWith('/domain-check'))result={domains:[{name:'customer.org',registrable:true,tier:'standard',pricing:{currency:'USD',registration_cost:price,renewal_cost:'9.00'}}]};
  else if(u.pathname.includes('/extensions/'))result={metadata:{name:'org'},registration_schema:{type:'object'}};
  else if(u.pathname.endsWith('/registration-status')||u.pathname.endsWith('/registrations')){
   if(timeout&&init.method==='POST')throw Error('Synthetic lost response');
   result={state,completed:['failed','succeeded'].includes(state),created_at:now(),updated_at:now(),context:{domain_name:wrong?'other.org':'customer.org'},links:{self:'/untrusted/ignored'}};
  }else result={domain_name:wrong?'other.org':'customer.org',status:'active',created_at:now(),expires_at:new Date(Date.now()+365*86400000).toISOString(),auto_renew:false};
  return Response.json({success:true,errors:[],messages:[],result},{status:u.pathname.endsWith('/registrations')?202:200});};
 const adapter=cloudflareRegistrationAdapter({accountId:'fixture',apiToken:'synthetic',fetchImpl,validateExtension:async()=>true});
 return {adapter,calls,setState:v=>state=v,setPrice:v=>price=v,setTimeout:v=>timeout=v,setWrong:v=>wrong=v,setOld:v=>old=v};
}
test('factory disabled by default, sandbox explicit, renewal unsupported and precise multiyear quote',async()=>{
 assert.equal(configuredCloudflareRegistration({}),null);
 assert.throws(()=>configuredCloudflareRegistration({CREATOR_CF_REGISTRATION_ENABLED:'true',CREATOR_CF_REGISTRATION_MODE:'live'}));
 assert.throws(()=>cloudflareRegistrationAdapter({accountId:'fixture',apiToken:'synthetic'}));
 const f=fixture();assert.equal(f.adapter.capabilities.renew,false);
 assert.equal((await f.adapter.quote('customer.org','register',3)).registrar_cents,2657);
 await assert.rejects(f.adapter.quote('customer.org','renew'));f.setPrice('8.571');await assert.rejects(f.adapter.quote('customer.org'));
});
test('inline contact required; schema gate, prepared-body integrity, no auto-renew or repeated submit',async()=>{
 assert.throws(()=>registrationContact({}));
 const f=fixture(),body=await f.adapter.prepare({hostname:'customer.org',years:1,registrant});
 assert.equal(body.auto_renew,false);assert.deepEqual(body.contacts.registrant,registrant);
 assert.equal((await f.adapter.submit(body)).state,'in_progress');await assert.rejects(f.adapter.submit(body));
 const changed=await f.adapter.prepare({hostname:'customer.org',years:1,registrant});changed.contacts.registrant.email='other@example.net';await assert.rejects(f.adapter.submit(changed));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/registrations')).length,1);
});
async function flowFixture(f) {
 const order={auth_user_id:'tenant-a',hostname:'customer.org',action:'register',years:1,currency:'USD',total_cents:1500,paid_cents:1500,registrar_cents:857,funded_event_id:'verified-event',consent_at:'now',quote_expires_at:Date.now()+60000,contact_ref:'immutable-vault-ref',contact_sha256:await contactDigest(registrant)};
 let record={...order,status:'funded'};
 const store={claim:async()=>{if(record.status!=='funded')return null;record.status='prepared';return {...record};},markSubmitted:async(id,data)=>{if(record.status!=='prepared')return false;Object.assign(record,data,{status:'submit_started'});return true;},finish:async(id,data)=>{Object.assign(record,data);return {...record};},get:async()=>({...record})};
 const options={store,provider:f.adapter,loadRegistrant:async({owner,reference})=>{assert.equal(owner,'tenant-a');assert.equal(reference,'immutable-vault-ref');return registrant;},verifyFunding:async()=>true,enabled:true};
 return {store,options,order,get record(){return record;}};
}
test('funded async registration reconciles ownership without claiming contact/charge verification',async()=>{
 const f=fixture(),x=await flowFixture(f);
 assert.equal((await startCloudflareRegistration('order',x.options)).status,'processing');
 assert.equal((await startCloudflareRegistration('order',x.options)).status,'not_claimed');
 f.setState('succeeded');assert.equal((await reconcileCloudflareRegistration('order',x.options)).status,'registered_pending_reconciliation');
 assert.equal((await reconcileCloudflareRegistration('order',x.options)).status,'not_pollable');
 assert.equal(f.calls.filter(c=>c.path.endsWith('/registrations')).length,1);
});
test('uncertain submit polls only; action-required stops automatic polling and wrong/old identity fails closed',async()=>{
 const f=fixture(),x=await flowFixture(f);f.setTimeout(true);
 assert.equal((await startCloudflareRegistration('order',x.options)).status,'reconciliation_required');
 assert.equal((await startCloudflareRegistration('order',x.options)).status,'not_claimed');
 f.setState('action_required');assert.equal((await reconcileCloudflareRegistration('order',x.options)).status,'action_required');
 const count=f.calls.length;await reconcileCloudflareRegistration('order',x.options);assert.equal(f.calls.length,count);
 f.setState('succeeded');f.setOld(true);assert.equal((await reconcileCloudflareRegistration('order',{...x.options,manual:true})).status,'reconciliation_required');
 f.setOld(false);f.setWrong(true);assert.equal((await reconcileCloudflareRegistration('order',x.options)).status,'reconciliation_required');
 assert.equal(f.calls.filter(c=>c.path.endsWith('/registrations')).length,1);
});
test('funding, consent contact mismatch and price changes never submit',async()=>{
 for(const problem of ['funding','contact','price']) {
  const f=fixture(),x=await flowFixture(f);
  if(problem==='funding')x.options.verifyFunding=async()=>false;
  if(problem==='contact')x.options.loadRegistrant=async()=>({...registrant,email:'wrong@example.net'});
  if(problem==='price')f.setPrice('9.57');
  assert.equal((await startCloudflareRegistration('order',x.options)).status,'refund_required');
  assert.equal(f.calls.filter(c=>c.path.endsWith('/registrations')).length,0);
 }
});
test('blocked workflow backs off, failed workflow never resubmits, missing schema validation blocks prepare',async()=>{
 const f=fixture(),x=await flowFixture(f);await startCloudflareRegistration('order',x.options);
 f.setState('blocked');const blocked=await reconcileCloudflareRegistration('order',x.options);assert.equal(blocked.status,'processing');assert.equal(blocked.retry_after_seconds,3600);
 f.setState('failed');assert.equal((await reconcileCloudflareRegistration('order',x.options)).status,'reconciliation_required');
 assert.equal((await startCloudflareRegistration('order',x.options)).status,'not_claimed');
 const noValidator=cloudflareRegistrationAdapter({accountId:'fixture',apiToken:'synthetic',fetchImpl:async()=>Response.json({success:true,result:{metadata:{name:'org'},registration_schema:{type:'object'}}})});
 await assert.rejects(noValidator.prepare({hostname:'customer.org',years:1,registrant}),/requirements/);
});
