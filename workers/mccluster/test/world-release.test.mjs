import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};return n(s,c);},load(u,c,n){if(/\.html$/.test(u))return{format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(u),'utf8'))+';',shortCircuit:true};return n(u,c);}});
const {default:core}=await import('../src/index.js');
import { guardWorldRelease } from '../src/world-release.js';
import { globeRelease, GLOBE_FEATURES } from '../../../packages/release-policy/globe.mjs';
const UID='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://sb.test',SUPABASE_SERVICE_ROLE_KEY:'key'};
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
function db(owner=false){return async(url)=>{const s=String(url);if(s.endsWith('/auth/v1/user'))return json({id:UID,user_metadata:{role:'owner'}});if(s.includes('/orgs?'))return json([{id:'house'}]);if(s.includes('/org_members?')){assert.ok(s.includes('profile_id=eq.'+UID));assert.ok(s.includes('role=eq.owner'));return json(owner?[{role:'owner'}]:[]);}throw Error('upstream must not be reached: '+s);};}
const paths=['/v1/world/layers/flights','/v1/world/layers/satellites','/v1/world/layers/launches','/v1/world/cctv/eligibility','/v1/world/cctv/sources','/v1/world/cctv/frame/id','/v1/world/ion','/v1/world/ion/v1/assets/1/endpoint','/v1/intel/geo','/v1/equity-uprise/halo-globe'];
test('all optional data paths deny guests and non-owners before dispatch/cache/upstream',async()=>{
 const original=globalThis.fetch;
 try{for(const token of ['', 'member']){globalThis.fetch=db(false);for(const path of paths){const r=await core.fetch(new Request('https://api.mccluster.org'+path,{headers:token?{authorization:'Bearer '+token}:{}}),env);assert.equal(r.status,403,path);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal((await r.json()).code,'admin_preview');}}}finally{globalThis.fetch=original;}
});
test('only live house-owner membership permits preview; metadata cannot grant it',async()=>{
 const r=new Request('https://api.mccluster.org/v1/world/layers/flights',{headers:{authorization:'Bearer t'}});
 assert.equal((await guardWorldRelease(r,env,{fetchImpl:db(false)})).status,403);
 assert.equal(await guardWorldRelease(r,env,{fetchImpl:db(true)}),null);
 assert.equal((await guardWorldRelease(r,env,{fetchImpl:async()=>{throw Error('offline');}})).status,403);
});
test('withdrawal denies owners too; malformed and unknown policy fail closed',async()=>{
 for(const value of ['*','flights','not-a-feature',{},'flights,']){
  const r=await guardWorldRelease(new Request('https://api.mccluster.org/v1/world/layers/flights'),{...env,WORLD_GLOBE_WITHDRAWN:value},{fetchImpl:()=>{throw Error('no auth/network expected')}});assert.equal(r.status,403);assert.equal((await r.json()).code,'feature_withdrawn');
 }
 assert.equal(globeRelease('unknown',{}),'withdrawn');
 assert.ok(GLOBE_FEATURES.every(x=>globeRelease(x,{})==='admin_preview'));
});
test('base globe, missions, news and existing admin analytics are outside optional-layer gate',async()=>{
 for(const path of ['/action-globe.html','/v1/world/access','/v1/world/news','/v1/analytics/cameras','/v1/mnet/missions'])assert.equal(await guardWorldRelease(new Request('https://api.mccluster.org'+path),env,{fetchImpl:()=>{throw Error('not needed')}}),null);
});
