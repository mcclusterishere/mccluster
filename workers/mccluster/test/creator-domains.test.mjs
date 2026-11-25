import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCreatorDomains,hostname,domainCapabilities} from '../src/creator-domains.js';
import {fulfillDomainOrder,nameSiloAdapter} from '../src/domains/namesilo.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',CREATOR_DOMAINS_ENABLED:'true',CREATOR_DOMAINS_ZONE_ID:'zone',CREATOR_DOMAINS_API_TOKEN:'fixture',CREATOR_DOMAINS_CNAME:'sites.mccluster.org'};
function fixture(){
 const rows=[],providers=[];let txt=[],cnames=[],failure=false,entitled=true,creates=0,frontAvailable=true,removeDuringProvider=false;
 const json=(v,status=200)=>Response.json(v,{status});
 async function fetchImpl(input,init={}){
  const u=new URL(input),method=init.method||'GET';
  if(u.pathname==='/auth/v1/user')return json({id:init.headers.authorization==='Bearer A'?A:B});
  if(u.hostname==='cloudflare-dns.com')return json({Status:0,Answer:(u.searchParams.get('type')==='TXT'?txt:cnames).map(data=>({type:u.searchParams.get('type')==='TXT'?16:5,data}))});
  if(u.hostname==='api.cloudflare.com'){
   if(failure)return json({success:false},503);
   if(method==='POST'){creates++;if(removeDuringProvider)frontAvailable=false;const p={...JSON.parse(init.body),id:'provider',status:'active',ssl:{status:'active'}};providers.push(p);return json({success:true,result:p});}
   if(method==='DELETE'){providers.length=0;return json({success:true,result:null});}
   return json({success:true,result:u.searchParams.has('hostname')?providers:providers[0]});
  }
  if(u.pathname.endsWith('/managed_projects'))return json([]);
  if(u.pathname.endsWith('/member_fronts'))return json(frontAvailable?[{auth_user_id:u.searchParams.get('auth_user_id')?.slice(3) || A,handle:'creator'}]:[]);
  if(u.pathname.endsWith('/rpc/claim_creator_domain')){const b=JSON.parse(init.body),r=rows.find(r=>r.id===b.domain_id&&r.auth_user_id===b.owner_id);if(!r||r.lease_until)return json(false);r.lease_until='busy';return json(true);}
  if(u.pathname.endsWith('/creator_domains')){
   const found=rows.filter(r=>[...u.searchParams].every(([k,v])=>!v.startsWith('eq.')||String(r[k])===v.slice(3)));
   if(method==='POST'){const r={id:crypto.randomUUID(),status:'ownership_pending',...JSON.parse(init.body)};rows.push(r);return json([r]);}
   if(method==='PATCH'){found.forEach(r=>Object.assign(r,JSON.parse(init.body)));return json(found);}
   if(method==='DELETE'){found.forEach(r=>rows.splice(rows.indexOf(r),1));return json([]);}return json(found);
  }throw Error('Unexpected fixture '+u.pathname);
 }
 return{rows,removeDuringProvider:()=>removeDuringProvider=true,get creates(){return creates;},setTxt:v=>txt=v,setCname:v=>cnames=v,setFail:v=>failure=v,setEntitled:v=>entitled=v,
 call:(user,method='GET',path='',body)=>handleCreatorDomains(new Request('https://api.mccluster.org/v1/creator-domains'+path,{method,headers:{authorization:'Bearer '+user},body:body?JSON.stringify(body):undefined}),env,{fetchImpl,authorizeEntitlement:async()=>entitled})};
}
test('rejects unsafe hostnames and defaults configuration off',()=>{assert.equal(hostname(' WWW.Customer.org '),'www.customer.org');for(const h of ['api.mccluster.org','https://foo.org','foo.org/x','127.0.0.1','*.foo.org','foo.org:443'])assert.throws(()=>hostname(h));assert.equal(domainCapabilities({}).connect,false);});
test('two tenants cannot read, verify or remove each other’s domains',async()=>{const f=fixture();assert.equal((await f.call('A','POST','',{hostname:'www.customer.org'})).status,201);const id=f.rows[0].id;assert.deepEqual((await(await f.call('B')).json()).domains,[]);for(const [m,p]of [['POST','/verify'],['DELETE','']])assert.equal((await f.call('B',m,'/'+id+p)).status,404);assert.equal(f.creates,0);});
test('proof precedes provisioning, DNS/TLS progression and failure recovery do not duplicate provider creates',async()=>{const f=fixture();await f.call('A','POST','',{hostname:'www.customer.org'});const r=f.rows[0],p='/'+r.id+'/verify';await f.call('A','POST',p);assert.equal(r.status,'ownership_pending');assert.equal(f.creates,0);f.setTxt([r.verification_token]);f.setFail(true);assert.equal((await f.call('A','POST',p)).status,503);assert.equal(r.status,'error');f.setFail(false);await f.call('A','POST',p);assert.equal(r.status,'dns_pending');f.setCname(['sites.mccluster.org.']);await f.call('A','POST',p);assert.equal(r.status,'active');assert.equal(f.creates,1);f.setTxt([]);await f.call('A','POST',p);assert.equal(r.status,'ownership_pending');});
test('entitlement required; failed remote disconnect stops routing and retries recover',async()=>{const f=fixture();f.setEntitled(false);assert.equal((await f.call('A','POST','',{hostname:'www.customer.org'})).status,402);f.setEntitled(true);await f.call('A','POST','',{hostname:'www.customer.org'});const r=f.rows[0];f.setTxt([r.verification_token]);await f.call('A','POST','/'+r.id+'/verify');f.setFail(true);assert.equal((await f.call('A','DELETE','/'+r.id)).status,503);assert.equal(r.status,'detached');f.setFail(false);assert.equal((await f.call('A','DELETE','/'+r.id)).status,200);assert.equal(f.rows.length,0);});
function store(overrides={}){const order={action:'register',hostname:'customer.org',years:1,registrant_contact_id:'contact',funded_event_id:'event',currency:'USD',total_cents:1500,paid_cents:1500,consent_at:'today',quote_expires_at:Date.now()+60000,...overrides};return{state:'funded',async claim(){if(this.state!=='funded')return null;this.state='executing';return order;},async finish(_,v){this.state=v.status;}};}
test('ambiguous registrar outcome cannot charge twice',async()=>{const s=store();let calls=0;const registrar={register:async()=>{calls++;throw Error('timeout');}};assert.equal((await fulfillDomainOrder('x',{store:s,registrar,enabled:true})).status,'reconciliation_required');assert.equal((await fulfillDomainOrder('x',{store:s,registrar,enabled:true})).status,'not_claimed');assert.equal(calls,1);});
test('funding gate and fallback registrant response cannot report completion',async()=>{let calls=0;const registrar={register:async()=>{calls++;return{code:302,domain:'customer.org'};}};assert.equal((await fulfillDomainOrder('x',{store:store({funded_event_id:null}),registrar,enabled:true})).status,'blocked');assert.equal(calls,0);assert.equal((await fulfillDomainOrder('x',{store:store(),registrar,enabled:true})).status,'reconciliation_required');});
test('registrar transport prevents accidental live calls and disables auto-renew',async()=>{assert.throws(()=>nameSiloAdapter({apiKey:'fixture'}));let url;const a=nameSiloAdapter({apiKey:'fixture',fetchImpl:async u=>{url=new URL(u);return Response.json({reply:{code:300,domain:'customer.org'}});}});await a.register({domain:'customer.org',years:1,contactId:'contact',paymentId:'payment'});assert.equal(url.searchParams.get('auto_renew'),'0');assert.equal(url.searchParams.get('contact_id'),'contact');});
import {handleCreatorDomainHost} from '../src/creator-domain-host.js';
test('host routing uses actual hostname, published page and entitlement; cannot select a different tenant',async()=>{
 let privateProfile=false,paid=true,recycled=false;
 const fetchImpl=async input=>{const u=new URL(input);if(u.pathname.endsWith('/creator_domains'))return Response.json(u.searchParams.get('hostname')==='eq.www.customer.org'?[{auth_user_id:A,handle:'creator',hostname:'www.customer.org',ssl_status:'active'}]:[]);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:5,data:'sites.mccluster.org.'}]});
 if(u.pathname.endsWith('/member_fronts'))return Response.json([{m_uid:A,auth_user_id:recycled?B:A,handle:'creator',published:{words:{title1:'Creator'}}}]);
 if(u.pathname.endsWith('/network_profiles'))return Response.json([{visibility:privateProfile?'private':'public'}]);
 if(u.pathname==='/front.html')return new Response('<html><head></head><body>Site</body></html>');throw Error('unexpected');};
 const call=url=>handleCreatorDomainHost(new Request(url,{headers:{'x-forwarded-host':'www.customer.org'}}),env,{fetchImpl,authorizeEntitlement:async()=>paid});
 const r=await call('https://www.customer.org/?u=other');assert.equal(r.status,200);assert.match(await r.text(),/"handle":"creator"/);
 assert.equal((await call('https://www.other.org/')).status,404);assert.equal((await call('https://www.customer.org/v1/fronts/other')).status,404);
 recycled=true;assert.equal((await call('https://www.customer.org/')).status,404);recycled=false;
 privateProfile=true;assert.equal((await call('https://www.customer.org/')).status,404);privateProfile=false;paid=false;assert.equal((await call('https://www.customer.org/')).status,404);
});

test('disabled custom hosting fails closed on tenant hosts while canonical and explicit preview hosts continue',async()=>{
 const options={fetchImpl:async()=>{throw Error('Disabled host must not read storage');}};
 for(const host of ['www.customer.org','unknown.org','evil-workers.dev.example.org'])assert.equal((await handleCreatorDomainHost(new Request('https://'+host+'/v1/fronts/other'),{},options)).status,404);
 for(const host of ['api.mccluster.org','mccluster.org','matthew.mccluster.org','preview.mccluster.workers.dev'])assert.equal(await handleCreatorDomainHost(new Request('https://'+host+'/healthz'),{},options),null);
});

test('late provider completion cannot activate a removed publication target',async()=>{const f=fixture();await f.call('A','POST','',{hostname:'www.customer.org'});const r=f.rows[0];f.setTxt([r.verification_token]);f.setCname(['sites.mccluster.org.']);f.removeDuringProvider();assert.equal((await f.call('A','POST','/'+r.id+'/verify')).status,409);assert.notEqual(r.status,'active');assert.equal(f.creates,1);});
