import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleCustomerSocialRequest as handler, handleCustomerSocial } from '../src/social/customer.js';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const org = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const user = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const env = { SUPABASE_URL:'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'service-fixture', CUSTOMER_SOCIAL_ENABLED:'true', META_APP_ID:'app', META_APP_SECRET:'secret-fixture', CUSTOMER_SOCIAL_REDIRECT_URI:'https://matthew.mccluster.org/customer-social.html' };
const response = (data,status=200) => new Response(JSON.stringify(data),{status});
const request = (path,body) => new Request('https://api.mccluster.org/v1/customer-social/'+path+(body?'':'?org_id='+org),{method:body?'POST':'GET',...(body?{body:JSON.stringify({org_id:org,...body})}:{})});
function mock(extra) {
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/org_members')) return response(url.searchParams.get('org_id')==='eq.'+org?[{role:'owner'}]:[]);
  if(url.pathname.endsWith('/creator_billing_subscriptions')) return response([{current_period_end:'2099-01-01'}]);
  return extra(url,init);
 };
}
test('two tenants: unauthorized org cannot begin OAuth or read connection',async()=>{
 let called=false;mock(()=>{called=true;throw Error('unexpected');});
 await assert.rejects(handler(request('connect',{org_id:other}),env,user),{status:403});
 await assert.rejects(handler(new Request('https://api.mccluster.org/v1/customer-social/status?org_id='+other),env,user),{status:403});
 assert.equal(called,false);
});
test('disabled status reports unavailable without exposing credentials',async()=>{
 mock(()=>response(null));
 const result=await handler(request('status'),{...env,CUSTOMER_SOCIAL_ENABLED:'false'},user);
 assert.equal(result.configured,false);assert.equal(result.connection,null);
});
test('OAuth state is random, hashed, and bound to authenticated org and user',async()=>{
 let saved;mock((url,init)=>{saved=JSON.parse(init.body);return response({});});
 const result=await handler(request('connect',{}),env,user);
 const state=new URL(result.authorization_url).searchParams.get('state');
 assert.equal(state.length,72);assert.equal(saved.p_data.state_hash.length,64);
 assert.equal(saved.p_org,org);assert.equal(saved.p_user,user.id);
 assert.equal(JSON.stringify(result).includes('secret-fixture'),false);
});
test('replayed or wrong-user OAuth state fails before provider exchange',async()=>{
 let providerCalls=0;mock((url)=>{if(url.hostname==='graph.facebook.com')providerCalls++;return response({code:'P0002'},409);});
 await assert.rejects(handler(request('complete',{state:'a'.repeat(72),code:'fixture'}),env,user),{status:409});
 assert.equal(providerCalls,0);
});
test('OAuth returns account choices without credentials; provider token stays in server RPC',async()=>{
 let stage;mock((url,init)=>{
  if(url.pathname.endsWith('customer_social_service')){const body=JSON.parse(init.body);if(body.p_action==='stage')stage=body;return response({});}
  if(url.pathname.endsWith('oauth/access_token'))return response({access_token:'private-token'});
  if(url.pathname.endsWith('debug_token'))return response({data:{is_valid:true,app_id:'app',scopes:['pages_show_list','pages_read_engagement','instagram_basic','instagram_content_publish']}});
  if(url.pathname.endsWith('me/accounts'))return response({data:[{id:'123',name:'Shop',access_token:'page-secret',instagram_business_account:{id:'456',username:'shop'}}]});
  throw Error('unexpected');
 });
 const result=await handler(request('complete',{state:'a'.repeat(72),code:'fixture'}),env,user);
 assert.equal(result.accounts[0].account_id,'456');assert.equal(stage.p_data.token,'private-token');
 assert.doesNotMatch(JSON.stringify(result),/private-token|page-secret/);
});
test('OAuth denies missing publishing permission without leaking tokens',async()=>{
 mock((url)=>{
  if(url.pathname.endsWith('customer_social_service'))return response({});
  if(url.pathname.endsWith('oauth/access_token'))return response({access_token:'private-token'});
  if(url.pathname.endsWith('debug_token'))return response({data:{is_valid:true,app_id:'app',scopes:['instagram_basic']}});
  throw Error('unexpected');
 });
 await assert.rejects(handler(request('complete',{state:'a'.repeat(72),code:'fixture'}),env,user),e=>e.status===409&&!e.message.includes('private-token'));
});
test('publish rejects another tenant upload',async()=>{
 mock(()=>{throw Error('unexpected RPC');});
 await assert.rejects(handler(request('publish',{storage_path:other+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',caption:'hello',idempotency_key:'stable-request-key'}),env,user),{status:400});
});
test('publish derives same request hash/key for retry and redacts internal errors',async()=>{
 const calls=[];mock((url,init)=>{const body=JSON.parse(init.body);calls.push(body);return response({id:'job',state:'queued',payload:body.p_data.payload,last_error:'token=secret'});});
 const body={storage_path:org+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',caption:'hello',idempotency_key:'stable-request-key'};
 const a=await handler(request('publish',body),env,user),b=await handler(request('publish',body),env,user);
 assert.deepEqual(calls[0],calls[1]);assert.deepEqual(a,b);assert.doesNotMatch(JSON.stringify(a),/secret/);
});
test('unpaid owner cannot connect or publish',async()=>{
 globalThis.fetch=async input=>response(new URL(input).pathname.endsWith('/org_members')?[{role:'owner'}]:[]);
 await assert.rejects(handler(request('connect',{}),env,user),{status:402});
});
test('disconnect remains available with feature disabled and no active payment',async()=>{
 let action;mock((url,init)=>{action=JSON.parse(init.body).p_action;return response({disconnected:true,provider_revoked:false});});
 const result=await handler(request('disconnect',{}),{...env,CUSTOMER_SOCIAL_ENABLED:'false'},user);
 assert.equal(action,'disconnect');assert.equal(result.provider_revoked,false);
});
test('platform wrapper rejects missing sessions and keeps errors uncached',async()=>{
 globalThis.fetch=()=>{throw Error('should not fetch');};
 const result=await handleCustomerSocial(request('status'),env);
 assert.equal(result.status,401);assert.match(result.headers.get('cache-control'),/no-store/);
});

test('canonical token loader blocks expired customer credentials before Vault/Meta; operator binding stays usable',async()=>{
 const { tokenFor }=await import('../src/social/meta.js');
 let allowed=false,managed=true,vaultReads=0;
 globalThis.fetch=async(input)=>{
  const path=new URL(input).pathname;
  if(path.endsWith('org_channels'))return response([{secret_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',account_id:'123'}]);
  if(path.endsWith('customer_social_credential_access'))return response({managed,allowed});
  if(path.endsWith('vault_secret')){vaultReads++;return response('fixture-page-token');}
  throw Error('unexpected '+path);
 };
 const account={org_id:org,platform:'instagram',external_account_id:'123'};
 await assert.rejects(tokenFor(env,account),{status:402});assert.equal(vaultReads,0);
 allowed=true;assert.equal(await tokenFor(env,account),'fixture-page-token');
 await assert.rejects(tokenFor({...env,CUSTOMER_SOCIAL_ENABLED:'false'},account),{status:402});
 managed=false;assert.equal(await tokenFor({...env,CUSTOMER_SOCIAL_ENABLED:'false'},account),'fixture-page-token');
});

test('status capability uses owned active workspace entitlement, never admin metadata',async()=>{
 for(const active of [false,true]){
  globalThis.fetch=async input=>{
   const u=new URL(input);
   if(u.pathname.endsWith('/org_members'))return response([{role:'owner'}]);
   if(u.pathname.endsWith('/creator_billing_subscriptions')){assert.equal(u.searchParams.get('owner_user_id'),'eq.'+user.id);assert.equal(u.searchParams.get('status'),'eq.active');return response([{current_period_end:active?'2099-01-01':'2000-01-01'}]);}
   return response({status:'connected',account_id:'owned-account'});
  };
  const result=await handler(request('status'),env,{...user,user_metadata:{role:'admin'}});
  assert.equal(result.capability.eligible,active);assert.equal(result.capability.can_publish,active);
  assert.deepEqual(result.capability.formats,['instagram_reels']);
 }
});
test('eligible owner can discover setup while unready connection stays nonpublishable',async()=>{
 mock(()=>response(null));const result=await handler(request('status'),env,user);
 assert.equal(result.capability.eligible,true);assert.equal(result.capability.can_publish,false);assert.equal(result.capability.reason,'owned_connection_required');
});
