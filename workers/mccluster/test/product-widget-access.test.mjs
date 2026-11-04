import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductWidgetAccess} from '../src/lib/product-widget-access.js';
import {__resetCapabilityCache} from '../src/lib/capabilities.js';
const org='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',CREATOR_STARTER_MONTHLY_PRICE_ID:'price_fixture'};
const input={orgId:org,productId:'fixture-product',widgetId:'fixture-widget',resourceId:'resource-1'};
const policy={kind:'subscription',configured:true,capability:'fixture.read',plans:{'fixture-plan':['CREATOR_STARTER_MONTHLY_PRICE_ID']}};
function harness(t,options={}){
 __resetCapabilityCache();const calls=[];const previous=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);calls.push({u,init});assert.equal(init.method||'GET','GET');assert.equal(u.origin,'https://db.fixture.invalid');
  if(u.pathname.endsWith('/org_members'))return Response.json(options.members??[{role:'staff',orgs:{id:org,enabled:true}}]);
  if(u.pathname.endsWith('/control_role_capabilities'))return Response.json([{role:'staff',capability:'fixture.read',allowed:options.capability!==false}]);
  assert.equal(u.pathname,'/rest/v1/creator_billing_subscriptions');assert.equal(u.searchParams.get('org_id'),'eq.'+org);
  if(options.failure)return new Response('',{status:503});
  return Response.json(options.rows??[{org_id:org,status:'active',stripe_price_id:'price_fixture',current_period_end:'2099-01-01T00:00:00Z'}]);
 };
 t.after(()=>{globalThis.fetch=previous;__resetCapabilityCache();});
 const gate=createProductWidgetAccess({catalog:{'fixture-product':{'fixture-widget':options.policy??policy},system:{'fixture-widget':options.policy??policy}},authenticate:async()=>options.guest?null:{id:uid},authorizeResource:async()=>options.resource!==false,authorizeInternal:async()=>options.internal===true,authorizePreview:async()=>options.preview===true});
 return {gate,calls,request:new Request('https://app.fixture.invalid/widget')};
}
test('active subscription plus canonical membership/capability and resource permission allows',async t=>{const {gate,request,calls}=harness(t);assert.equal((await gate.requireAccess(request,env,input)).allowed,true);assert.equal(calls.length,3);});
for(const [name,options] of [['foreign tenant',{members:[]}],['disabled tenant',{members:[{role:'staff',orgs:{id:org,enabled:false}}]}],['role denied',{capability:false}],['foreign resource',{resource:false}]])test(name+' denies before billing disclosure',async t=>{const {gate,request,calls}=harness(t,options);assert.equal((await gate.inspect(request,env,input)).state,'forbidden');assert.ok(!calls.some(c=>c.u.pathname.includes('subscriptions')));});
for(const status of ['past_due','trialing','canceled','unpaid','paused'])test(status+' never grants active subscription access',async t=>{const {gate,request}=harness(t,{rows:[{org_id:org,status,stripe_price_id:'price_fixture',current_period_end:'2099-01-01'}]});assert.equal((await gate.inspect(request,env,input)).state,'locked');});
test('missing subscription is locked, missing approved price configuration is unconfigured, read failure unavailable',async t=>{const {gate,request}=harness(t,{rows:[]});assert.equal((await gate.inspect(request,env,input)).state,'locked');assert.equal((await gate.inspect(request,{...env,CREATOR_STARTER_MONTHLY_PRICE_ID:undefined},input)).state,'unconfigured');});
test('billing errors cannot look like an upgrade opportunity',async t=>{const {gate,request}=harness(t,{failure:true});assert.equal((await gate.inspect(request,env,input)).state,'unavailable');await assert.rejects(gate.requireAccess(request,env,input),e=>e.status===503);});
for(const rows of [[{org_id:org,status:'active',stripe_price_id:'price_fixture',current_period_end:'bad'}],[{org_id:'other',status:'active',stripe_price_id:'price_fixture'}],{}])test('malformed or cross-tenant billing evidence fails closed '+JSON.stringify(rows),async t=>{const {gate,request}=harness(t,{rows});assert.equal((await gate.inspect(request,env,input)).state,'unavailable');});
test('expired and unrelated price subscriptions remain locked',async t=>{const {gate,request}=harness(t,{rows:[{org_id:org,status:'active',stripe_price_id:'price_other',current_period_end:'2000-01-01'}]});assert.equal((await gate.inspect(request,env,input)).state,'locked');});
test('owner plan presentation never changes actual access or issues billing writes',async t=>{const {gate,request}=harness(t,{rows:[],preview:true});const d=await gate.inspect(request,env,{...input,previewPlan:'fixture-plan'});assert.equal(d.allowed,false);assert.equal(d.state,'locked');assert.deepEqual(d.presentation,{plan_code:'fixture-plan',state:'available',simulation:true,grants_access:false});await assert.rejects(gate.requireAccess(request,env,{...input,previewPlan:'fixture-plan'}),e=>e.status===400);await assert.rejects(gate.requireAccess(request,env,input),e=>e.status===403);});
test('unauthorized presentation preview is refused',async t=>{const {gate,request}=harness(t);await assert.rejects(gate.inspect(request,env,{...input,previewPlan:'fixture-plan'}),e=>e.status===403);});
test('even owner preview cannot bypass resource permission',async t=>{const {gate,request}=harness(t,{resource:false,preview:true});const d=await gate.inspect(request,env,{...input,previewPlan:'fixture-plan'});assert.equal(d.state,'forbidden');assert.equal(d.presentation,undefined);});
test('System cannot be sold by adding subscription configuration',async t=>{const {gate,request}=harness(t);assert.equal((await gate.inspect(request,env,{...input,productId:'system'})).state,'unconfigured');});
test('internal System requires independent house authority and has no subscription preview',async t=>{const {gate,request,calls}=harness(t,{policy:{...policy,kind:'internal'},internal:true});assert.equal((await gate.inspect(request,env,{...input,productId:'system'})).allowed,true);assert.ok(!calls.some(c=>c.u.pathname.includes('subscriptions')));await assert.rejects(gate.inspect(request,env,{...input,productId:'system',previewPlan:'fixture-plan'}),e=>e.status===400);});
test('authentication is mandatory and unknown catalog is unconfigured',async t=>{const {gate,request}=harness(t,{guest:true});await assert.rejects(gate.inspect(request,env,input),e=>e.status===401);});
test('unregistered widget never invents an entitlement',async t=>{const {gate,request}=harness(t);assert.equal((await gate.inspect(request,env,{...input,widgetId:'unknown'})).state,'unconfigured');});
test('expired matching price does not grant access',async t=>{const {gate,request}=harness(t,{rows:[{org_id:org,status:'active',stripe_price_id:'price_fixture',current_period_end:'2000-01-01'}]});assert.equal((await gate.inspect(request,env,input)).state,'locked');});
test('unexpired subscription to an unmapped price does not grant access',async t=>{const {gate,request}=harness(t,{rows:[{org_id:org,status:'active',stripe_price_id:'price_other',current_period_end:'2099-01-01'}]});assert.equal((await gate.inspect(request,env,input)).state,'locked');});
test('workspace role does not imply house-internal authority',async t=>{const {gate,request}=harness(t,{policy:{...policy,kind:'internal'}});assert.equal((await gate.inspect(request,env,{...input,productId:'system'})).state,'forbidden');});
