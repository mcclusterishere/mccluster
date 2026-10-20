import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi } from '../src/platform-api-metered.js';
import { handleAuthHandoff } from '../src/auth-handoff.js';
import { fail } from '../src/lib/http.js';
const UID='11111111-1111-4111-8111-111111111111';
const MUID='22222222-2222-4222-8222-222222222222';
const CID='33333333-3333-4333-8333-333333333333';
const ENV={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role'};
const calls=[];let visibility='public',expires=null;
const ok=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
async function mock(url,init={}) {
  const u=new URL(url), p=u.pathname; const body=init.body?JSON.parse(init.body):null;
  calls.push({url:String(url),p,method:init.method||'GET',body});
  if(p==='/auth/v1/user')return ok({id:UID,email:'person@example.test'});
  if(p==='/rest/v1/api_keys')return ok([{id:'key-1',consumer_id:CID,scopes:['mnet:read'],expires_at:expires}]);
  if(p==='/rest/v1/api_consumers')return ok([{id:CID,plan_code:'developer'}]);
  if(p==='/rest/v1/api_plan_scopes')return ok([{scope_key:'mnet:read'}]);
  if(p==='/rest/v1/api_scopes')return ok([{scope_key:'mnet:read'}]);
  if(p==='/rest/v1/m_auth_user_links')return ok([{auth_user_id:UID,m_uid:MUID}]);
  if(p==='/rest/v1/platform_profiles')return ok([{user_id:UID,display_name:'Test',avatar_url:'',mccluster_id:'test_person'}]);
  if(p==='/rest/v1/network_profiles')return ok([{m_uid:MUID,visibility,display_name:'Test',email:'should-not-return@example.test',metadata:{secret:'private'}}]);
  if(p==='/rest/v1/network_feed_items')return ok([]);
  if(p==='/rest/v1/rpc/api_reserve_usage')return ok([{reservation_id:'r',reserved_units:1}]);
  if(p==='/rest/v1/rpc/api_settle_usage')return ok([{charged_units:1}]);
  throw new Error('Unexpected egress: '+url);
}
function req(path,options={}) {return new Request('https://api.mccluster.org'+path,{...options,headers:{authorization:'Bearer mcc_live_testkey','origin':'https://mccluster.org',...options.headers}});}
test.beforeEach(()=>{calls.length=0;visibility='public';expires=null;globalThis.fetch=mock;});

test('metered developer key cannot read private or network-only profiles',async()=>{
  for(const v of ['private','network',null]) {visibility=v;const r=await handlePlatformApi(req('/v1/mnet/people/test_person'),ENV);assert.equal(r.status,404);assert.doesNotMatch(await r.text(),/should-not-return|metadata|user_id/);}
});
test('public profile projection never returns auth user IDs or unapproved metadata',async()=>{
  const r=await handlePlatformApi(req('/v1/mnet/people/test_person'),ENV);
  assert.equal(r.status,200);assert.equal((await r.clone().json()).profile.visibility,'public');
  assert.doesNotMatch(await r.text(),/should-not-return|secret|metadata|user_id/);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  const lookup=calls.find(c=>c.p==='/rest/v1/platform_profiles');assert.match(lookup.url,/test%5C_person/);
});
test('wildcard handles never become privileged database searches',async()=>{
  const r=await handlePlatformApi(req('/v1/mnet/people/%2A'),ENV);assert.equal(r.status,404);
  assert.equal(calls.some(c=>c.p==='/rest/v1/platform_profiles'),false);
});
test('repeated GET idempotency headers cannot reuse one settled charge',async()=>{
  for(let n=0;n<2;n++){const r=await handlePlatformApi(req('/v1/mnet/feed',{headers:{'idempotency-key':'repeat-this-key','x-request-id':'repeat-this-key'}}),ENV);assert.equal(r.status,200);}
  const ids=calls.filter(c=>c.p.endsWith('/api_reserve_usage')).map(c=>c.body.p_request_id);
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);assert.ok(ids.every(x=>x!=='repeat-this-key'));
  assert.ok(calls.filter(c=>c.p==='/rest/v1/network_feed_items').every(c=>c.url.includes('item_type=eq.post')));
});
test('invalid expiry fails closed before metered reads',async()=>{
  expires='not-a-date';const r=await handlePlatformApi(req('/v1/mnet/feed'),ENV);assert.equal(r.status,401);
  assert.equal(calls.some(c=>c.p.endsWith('/api_reserve_usage')),false);
});
test('creating more developer consumers does not mint free credits',async()=>{
  const r=await handlePlatformApi(req('/v1/developer/consumers',{method:'POST',headers:{authorization:'Bearer user-token','content-type':'application/json'},body:'{"name":"Extra integration"}'}),ENV);
  assert.equal(r.status,201);assert.equal((await r.json()).developer_grant_credits,0);
  assert.equal(calls.some(c=>c.p==='/rest/v1/api_credit_ledger'),false);
});
test('key creation checks exact plan entitlements before database insertion',async()=>{
  for(const scopes of [['*'],['mnet:*'],['social:publish'],['mnet:read','admin:*'],[],'mnet:read']) {
    calls.length=0;
    const r=await handlePlatformApi(req(`/v1/developer/consumers/${CID}/keys`,{method:'POST',headers:{authorization:'Bearer user-token','content-type':'application/json'},body:JSON.stringify({scopes})}),ENV);
    assert.ok([400,403].includes(r.status),String(r.status));
    assert.equal(calls.some(c=>c.p==='/rest/v1/api_keys'&&c.method==='POST'),false);
  }
});
test('a copied bearer and spoofed allowed Origin cannot mint refreshable sessions',async()=>{
  globalThis.fetch=async()=>{throw new Error('No auth egress permitted');};
  const r=await handleAuthHandoff(req('/v1/auth/handoff',{method:'POST',headers:{authorization:'Bearer genuine-stolen-token'}}),ENV);
  assert.equal(r.status,410);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.doesNotMatch(await r.text(),/token_hash|refresh_token/);
});
test('redaction covers top-level SQL messages and extended error objects',async()=>{
  const original=console.log;console.log=()=>{};
  try {
    for(const raw of [{code:'23505',details:'private@example.test',hint:null,message:'private_table private@example.test'}, {code:'PGRST301',message:'private_table private@example.test',additional:'upstream'}]) {
      const response=fail(req('/v1/test'),ENV,raw.message,400,raw);
      assert.doesNotMatch(await response.text(),/private_table|private@example/);
      assert.equal(response.headers.get('cache-control'),'no-store');
    }
  } finally {console.log=original;}
});
