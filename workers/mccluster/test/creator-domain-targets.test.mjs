import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDomainTarget} from '../src/creator-domain-targets.js';
import {handleCreatorDomainHost} from '../src/creator-domain-host.js';
import {fulfillDomainOrder,nameSiloAdapter} from '../src/domains/namesilo.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('target resolution rejects another owner, reused slug, arbitrary adapters and changed identity',async()=>{
 const input={type:'managed_project',id:ID,slug:'portfolio'};
 const row={id:ID,owner_user_id:A,slug:'portfolio'};
 const db=async()=>[row];
 assert.deepEqual(await resolveDomainTarget(A,input,db),input);
 await assert.rejects(resolveDomainTarget(B,input,db));
 row.owner_user_id=B;await assert.rejects(resolveDomainTarget(A,input,db));row.owner_user_id=A;
 row.id=B;await assert.rejects(resolveDomainTarget(A,input,db));row.id=ID;
 row.slug='replacement';await assert.rejects(resolveDomainTarget(A,input,db));
 for(const type of ['studio','wetrust','url'])await assert.rejects(resolveDomainTarget(A,{...input,type},async()=>{throw Error('Unsupported must not query');}));
});
test('managed domain delegates immutable authority; unpublish, missing integration and transferred targets fail closed',async()=>{
 const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',CREATOR_DOMAINS_ENABLED:'true',CREATOR_DOMAINS_ZONE_ID:'zone',CREATOR_DOMAINS_API_TOKEN:'fixture',CREATOR_DOMAINS_CNAME:'sites.mccluster.org'};
 let owner=A,id=ID,published=true,tiles=false,options;
 const fetchImpl=async input=>{const u=new URL(input);
  if(u.pathname.endsWith('/creator_domains'))return Response.json([{auth_user_id:A,handle:'portfolio',target_type:'managed_project',target_id:ID,hostname:'www.customer.org',ssl_status:'active'}]);
  if(u.pathname.endsWith('/managed_projects'))return Response.json([{id,owner_user_id:owner,slug:'portfolio'}]);
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:5,data:'sites.mccluster.org.'}]});
  if(['/front.html','/website-studio-view.html'].includes(u.pathname))return new Response('<html><head></head></html>');throw Error('Unexpected fetch');};
 const projectPublic=async(req,env,opts)=>{options=opts;assert.equal(req.headers.get('authorization'),null);return Response.json({ok:true,presentation:tiles?'tiles':'front',config:{}},{status:published?200:404});};
 const call=(path='/',handler=projectPublic,tileHandler=null)=>handleCreatorDomainHost(new Request('https://www.customer.org'+path,{headers:{authorization:'Bearer private'}}),env,{fetchImpl,authorizeEntitlement:async()=>true,projectPublic:handler,projectTilesPublic:tileHandler});
 assert.equal((await call('/',null)).status,404);
 const r=await call();assert.equal(r.status,200);assert.match(await r.text(),/"project":"portfolio"/);
 assert.equal(options.expectedAuthUserId,A);assert.equal(options.expectedProjectId,ID);
 assert.equal((await call('/v1/projects/other')).status,404);
 published=false;assert.equal((await call()).status,404);published=true;
 owner=B;assert.equal((await call()).status,404);owner=A;id=B;assert.equal((await call()).status,404);id=ID;
 tiles=true;assert.equal((await call()).status,404); // no wrong renderer fallback
 const tileHandler=async(req,env,opts)=>{assert.equal(opts.expectedProjectId,ID);assert.equal(opts.expectedAuthUserId,A);assert.equal(req.headers.get('authorization'),null);return Response.json({document:{tiles:[]},media:{}});};
 const tilePage=await call('/',projectPublic,tileHandler);assert.equal(tilePage.status,200);assert.match(await tilePage.text(),/MCC_STUDIO_HOST/);
 assert.equal((await call('/v1/projects/portfolio/tiles/public',projectPublic,tileHandler)).status,200);
 assert.equal((await call('/',projectPublic,async()=>Response.json({error:'withdrawn'},{status:404}))).status,404);
});
test('registrar rejects unsafe direct transport inputs and imprecise confirmation; replay stays inert',async()=>{
 let calls=0;
 const adapter=nameSiloAdapter({apiKey:'fixture',fetchImpl:async()=>{calls++;return Response.json({reply:{code:300}});}});
 assert.throws(()=>adapter.register({domain:'bad/url',years:1,contactId:'x'}));
 assert.throws(()=>adapter.renew({domain:'customer.org',years:1.5}));assert.equal(calls,0);
 let state='funded';const store={claim:async()=>{if(state!=='funded')return null;state='executing';return {hostname:'customer.org',years:1,action:'register',registrant_contact_id:'contact',funded_event_id:'event',consent_at:'now',quote_expires_at:Date.now()+60000,currency:'USD',total_cents:1500,paid_cents:1500,registrar_cents:1000};},finish:async(id,r)=>{state=r.status;return r;}};
 const registrar={register:async()=>{calls++;return {code:300,domain:'customer.org',order_amount:'10.001'};}};
 assert.equal((await fulfillDomainOrder('id',{store,registrar,enabled:true})).status,'reconciliation_required');
 assert.equal((await fulfillDomainOrder('id',{store,registrar,enabled:true})).status,'not_claimed');assert.equal(calls,1);
});
