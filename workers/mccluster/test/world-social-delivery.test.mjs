import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePlatformApi} from '../src/platform-api.js';
import {handleCustomerSocialRequest} from '../src/social/customer.js';
import {handleSocialRequest} from '../src/social/router.js';
import {processInstagramPublishQueue} from '../src/social/meta.js';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const USER=id(1),OTHER=id(2),ORG=id(3),ACCOUNT=id(4),MUID=id(5),VIDEO=id(6),KEY=id(7),POST=id(8),JOB=id(9),DELIVERY=id(10);
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',CUSTOMER_SOCIAL_ENABLED:'true',META_APP_ID:'app',META_APP_SECRET:'fixture',CUSTOMER_SOCIAL_REDIRECT_URI:'https://matthew.mccluster.org/customer-social.html'};
const ok=(value,status=200)=>new Response(JSON.stringify(value),{status});
const original=globalThis.fetch;test.afterEach(()=>globalThis.fetch=original);
const request=(path,body)=>new Request('https://api.test'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer alice','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('authenticated World endpoint commits prepared post/identity once and replays before attached-media validation',async()=>{
 let saved=null,writes=0,mediaReads=0;const calls=[];
 globalThis.fetch=async(url,init={})=>{
  const u=String(url),b=init.body?JSON.parse(init.body):null;calls.push({u,b});
  if(u.endsWith('/auth/v1/user'))return ok({id:USER});
  if(u.includes('/m_auth_user_links'))return ok([{m_uid:MUID}]);
  if(u.includes('/network_media_assets')){mediaReads++;return ok([{id:VIDEO,media_type:'video',mime_type:'video/mp4'}]);}
  if(u.includes('/platform_apps'))return ok([]);
  if(u.endsWith('/rpc/world_social_delivery')){
   assert.equal(b.p_user,USER);assert.equal(b.p_data.request.app_key,'mccluster-web');
   if(b.p_action==='lookup')return ok(saved);
   assert.equal(b.p_action,'create');writes++;assert.equal(b.p_data.post.visibility,'public');
   assert.deepEqual(b.p_data.post.media_asset_ids,[VIDEO]);saved={post:{id:POST},delivery:{id:DELIVERY,user:USER,jobId:JOB}};return ok(saved);
  }
  throw Error('Unexpected '+u);
 };
 const body={body:'Hello',visibility:'public',media_asset_ids:[VIDEO],delivery:{org_id:ORG,account_id:ACCOUNT,operation_key:KEY},user_id:OTHER};
 const a=await handlePlatformApi(request('/v1/mnet/posts?app_key=mccluster-web',body),env);
 const b=await handlePlatformApi(request('/v1/mnet/posts?app_key=mccluster-web',body),env);
 assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(writes,1);assert.equal(mediaReads,1);
 assert.equal((await a.json()).post.id,(await b.json()).post.id);
 assert.ok(!calls.some(c=>c.u.includes('graph.facebook')));
});
test('combined post rejects private media and never makes a delivery transaction; ordinary validation retained',async()=>{
 globalThis.fetch=async(url)=>{const u=String(url);if(u.endsWith('/auth/v1/user'))return ok({id:USER});if(u.includes('/m_auth_user_links'))return ok([{m_uid:MUID}]);if(u.endsWith('/rpc/world_social_delivery'))return ok(null);if(u.includes('/network_media_assets'))return ok([]);throw Error('Unexpected '+u);};
 const out=await handlePlatformApi(request('/v1/mnet/posts',{body:'Hello',media_asset_ids:[VIDEO],delivery:{org_id:ORG,account_id:ACCOUNT,operation_key:KEY}}),env);
 assert.equal(out.status,400);assert.match((await out.json()).error,/unavailable/);
});
test('delivery submit is owner, active-plan, customer-ready and original-user scoped',async()=>{
 const actions=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url),b=init.body?JSON.parse(init.body):null;
  if(u.includes('/org_members'))return ok([{role:'owner'}]);
  if(u.includes('/creator_billing_subscriptions'))return ok([{current_period_end:'2099-01-01'}]);
  if(u.endsWith('/rpc/customer_social_service')){actions.push(b.p_action);return ok({});}
  if(u.endsWith('/rpc/world_social_delivery')){assert.equal(b.p_user,USER);actions.push(b.p_action);return ok(b.p_action==='get'?{id:DELIVERY,org:ORG}:{id:JOB,state:'queued',payload:{}});}
  throw Error('Unexpected '+u);
 };
 const result=await handleCustomerSocialRequest(request(`/v1/customer-social/deliveries/${DELIVERY}/submit`,{org_id:ORG,user_id:OTHER}),env,{id:USER});
 assert.equal(result.publish_job.id,JOB);assert.deepEqual(actions,['get','ready','submit']);
});
test('external cancellation keeps independently published World post',async()=>{
 const calls=[];
 globalThis.fetch=async(url,init={})=>{const u=String(url),method=init.method||'GET';calls.push([u,method]);
  if(u.includes('/org_members'))return ok([{role:'owner',org_id:ORG}]);
  if(u.includes('/social_publish_jobs'))return ok([{id:JOB,content_id:id(11),state:'cancelled',payload:{world_delivery:true}}]);
  return ok([]);
 };
 await handleSocialRequest(request(`/v1/social/publish/${JOB}/cancel`,{org_id:ORG}),env,{id:USER});
 assert.ok(!calls.some(([u])=>u.includes('/network_posts')));
});
for(const state of ['queued','processing'])test(`canonical ${state} queue rechecks registered World video before any provider activity`,async()=>{
 let graphCalls=0,checked=false;
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.includes('graph.facebook')){graphCalls++;throw Error('No provider activity allowed');}
  if(u.endsWith('/rpc/claim_social_publish_jobs'))return ok([{id:JOB,org_id:ORG,account_id:ACCOUNT,state,attempts:0,payload:{world_delivery:true},external_creation_id:'container'}]);
  if(u.includes('/social_accounts'))return ok([{id:ACCOUNT,org_id:ORG,platform:'instagram',external_account_id:'123'}]);
  if(u.includes('/org_channels'))return ok([{enabled:true,account_id:'123',secret_id:id(12)}]);
  if(u.endsWith('/rpc/customer_social_credential_access'))return ok({allowed:true});
  if(u.endsWith('/rpc/vault_secret'))return ok('fixture-secret');
  if(u.endsWith('/rpc/world_social_video')){checked=true;return ok({message:'removed'},403);}
  return ok([]);
 };
 await processInstagramPublishQueue(env);assert.equal(checked,true);assert.equal(graphCalls,0);
});
