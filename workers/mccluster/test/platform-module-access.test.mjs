import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handlePlatformModuleAccess, requirePlatformModule, recordVerifiedDomainTrial} from '../src/platform-module-access.js';
import {handleCustomerSocialRequest} from '../src/social/customer.js';
const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',order='33333333-3333-4333-8333-333333333333';
const env={CREATOR_DOMAIN_TRIAL_ENABLED:'true',SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',CREATOR_SOCIAL_PLATFORM_APP_KEY:'social'};
const projection=(allowed=false)=>({scope:{org_id:org,app_key:'social'},capabilities:{base_manage:{allowed:true},advanced:{allowed},white_label:{allowed}}});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const req=(path,body)=>new Request('https://test.invalid'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer example'},...(body?{body:JSON.stringify(body)}:{})});
test('default off makes no auth, database or provider calls',async()=>{const response=await handlePlatformModuleAccess(req('/v2/platform/apps/social/access?org_id='+org),{}, {fetchImpl:()=>assert.fail('network')});assert.equal(response.status,503);});
test('metadata uses authenticated subject; private no-store and foreign projections fail closed',async()=>{
 let calls=0; const fetchImpl=async(url,init)=>{if(url.endsWith('/user'))return json({id:user});calls++;assert.equal(JSON.parse(init.body).p_user,user);return json(projection());};
 const response=await handlePlatformModuleAccess(req('/v2/platform/apps/social/access?org_id='+org),env,{fetchImpl});assert.equal(response.status,200);assert.equal((await response.json()).capabilities.advanced.allowed,false);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(calls,1);
 await assert.rejects(requirePlatformModule(env,user,org,'social','advanced',{fetchImpl:async()=>json({...projection(true),scope:{org_id:user,app_key:'social'}})}),/invalid_module_projection/);
});
test('require is enforced even if RPC incorrectly returns denied without error',async()=>{await assert.rejects(requirePlatformModule(env,user,org,'social','advanced',{fetchImpl:async()=>json(projection())}),e=>e.status===403);});
test('anonymous user and forged owner fields never reach cancellation RPC',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return json({id:user,is_anonymous:true});};
 assert.equal((await handlePlatformModuleAccess(req('/v2/platform/domain-trials/'+order+'/cancel',{org_id:org}),env,{fetchImpl})).status,401);assert.equal(calls,1);
 assert.equal((await handlePlatformModuleAccess(req('/v2/platform/domain-trials/'+order+'/cancel',{org_id:org,owner_id:user}),env,{fetchImpl:async()=>json({id:user})})).status,400);
});
test('cancellation identity/event are server bound and stable across retries',async()=>{
 const bodies=[];const fetchImpl=async(url,init)=>{if(url.endsWith('/user'))return json({id:user});bodies.push(JSON.parse(init.body));return json({cancelled:true});};
 for(let i=0;i<2;i++)assert.equal((await handlePlatformModuleAccess(req('/v2/platform/domain-trials/'+order+'/cancel',{org_id:org}),env,{fetchImpl})).status,200);
 assert.deepEqual(bodies[0],{p_owner:user,p_org:org,p_order:order,p_event:'cancel:'+order});assert.deepEqual(bodies[0],bodies[1]);
});
test('no public grant endpoint and current incapable registrar cannot grant',async()=>{
 assert.equal(await handlePlatformModuleAccess(req('/v2/platform/domain-trials/'+order+'/grant',{}),env),null);
 await assert.rejects(recordVerifiedDomainTrial(env,{ownerId:user,orgId:org,orderId:order,eventId:'e'}, {capabilities:{charge_readback:false,registrant_readback:false}},{fetchImpl:()=>assert.fail('network')}),/verified_registrar_readback_unavailable/);
 await assert.rejects(recordVerifiedDomainTrial(env,{ownerId:user,orgId:org,orderId:order,eventId:'e'},{capabilities:{charge_readback:true,registrant_readback:true},readVerifiedRegistration:async()=>({source:'payment_success'})},{fetchImpl:()=>assert.fail('network')}),/registration_not_verified/);
});
test('actual social mutation denies advanced before paid/provider execution; cancellation remains available',async()=>{
 const original=globalThis.fetch;let checks=0;
 globalThis.fetch=async(url)=>{if(url.includes('org_members'))return json([{role:'owner'}]);if(url.includes('creator_platform_require_v1')){checks++;return json({code:'42501'},403);}if(url.includes('customer_social_service'))return json({cancelled:true});assert.fail('unexpected request '+url);};
 try{await assert.rejects(handleCustomerSocialRequest(req('/v1/customer-social/publish',{org_id:org}),env,{id:user}),e=>e.status===403);assert.equal(checks,1);assert.deepEqual(await handleCustomerSocialRequest(req('/v1/customer-social/disconnect',{org_id:org}),env,{id:user}),{cancelled:true});assert.equal(checks,1);}finally{globalThis.fetch=original;}
});
