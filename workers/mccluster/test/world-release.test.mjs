import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};return n(s,c);},load(u,c,n){if(/\.html$/.test(u))return{format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(u),'utf8'))+';',shortCircuit:true};return n(u,c);}});
const {default:core}=await import('../src/index.js');
import { guardWorldRelease } from '../src/world-release.js';
import { globeRelease, globeFeatureForPath, GLOBE_FEATURES } from '../../../packages/release-policy/globe.mjs';
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
/* Halo on the admin globe: every new feed, place search, Halo operations and water levels are owner-only through the same guard, before dispatch. */
const HALO=[['/v1/world/layers/military','military'],['/v1/world/layers/quakes','quakes'],['/v1/world/layers/fires','fires'],['/v1/world/layers/perimeters','perimeters'],['/v1/world/layers/cyclones','cyclones'],['/v1/world/layers/vessels','vessels'],['/v1/world/geocode','search'],['/v1/world/halo/missions','halo-ops'],['/v1/world/halo/people','halo-ops'],['/v1/world/layers/tides','tides'],['/v1/world/tides/8518750','tides']];
test('Halo feeds and place search are features of the release policy',()=>{
 for(const [,feature] of HALO){assert.ok(GLOBE_FEATURES.includes(feature),feature);assert.equal(globeRelease(feature,{}),'admin_preview');}
 for(const [path,feature] of HALO)assert.equal(globeFeatureForPath(path),feature,path);
 assert.equal(globeFeatureForPath('/v1/world/geocodes'),null);
 for(const p of ['/v1/world/halo','/v1/world/halo/anything'])assert.equal(globeFeatureForPath(p),'halo-ops',p);
 for(const p of ['/v1/world/tides','/v1/world/tides/x'])assert.equal(globeFeatureForPath(p),'tides',p);
 for(const p of ['/v1/world/halox','/v1/world/tidesx','/v1/world/haloops'])assert.equal(globeFeatureForPath(p),null,p);
});
test('Halo feeds and place search are 403 admin_preview for guests and non-owners, before any provider is asked',async()=>{
 const original=globalThis.fetch;
 try{for(const token of ['','member']){globalThis.fetch=db(false);for(const [path,feature] of HALO){for(const p of [path,path+'/',path+'?q=New%20Haven']){const r=await core.fetch(new Request('https://api.mccluster.org'+p,{headers:token?{authorization:'Bearer '+token}:{}}),{...env,FIRMS_MAP_KEY:'k',AISSTREAM_API_KEY:'k'});assert.equal(r.status,403,p);assert.equal(r.headers.get('cache-control'),'private, no-store');const b=await r.json();assert.equal(b.code,'admin_preview',p);assert.equal(b.feature,feature);}}}}finally{globalThis.fetch=original;}
});
test('the house owner passes the guard for every Halo path, and the handlers answer behind it',async()=>{
 for(const [path] of HALO)assert.equal(await guardWorldRelease(new Request('https://api.mccluster.org'+path,{headers:{authorization:'Bearer t'}}),env,{fetchImpl:db(true)}),null,path);
 const original=globalThis.fetch;
 try{globalThis.fetch=db(true);
  /* fires without FIRMS_MAP_KEY: dispatched past the guard, not_configured, no provider asked (db() throws on any other host) */
  const fires=await core.fetch(new Request('https://api.mccluster.org/v1/world/layers/fires',{headers:{authorization:'Bearer t'}}),env);
  assert.equal(fires.status,200);const fb=await fires.json();assert.equal(fb.layer,'fires');assert.equal(fb.upstream_error,'not_configured');
  const ships=await core.fetch(new Request('https://api.mccluster.org/v1/world/layers/vessels',{headers:{authorization:'Bearer t'}}),env);
  assert.equal((await ships.json()).upstream_error,'not_configured');
  const search=await core.fetch(new Request('https://api.mccluster.org/v1/world/geocode?q=a',{headers:{authorization:'Bearer t'}}),env);
  assert.equal(search.status,400);assert.equal((await search.json()).code,'invalid_query');
  /* Halo operations: dispatched past the guard, the handler re-checks the owner, then reads (db() refuses mission tables: an honest unavailable) */
  for(const [path,schema] of [['/v1/world/halo/missions','halo-missions/v1'],['/v1/world/halo/people','halo-people/v1']]){const r=await core.fetch(new Request('https://api.mccluster.org'+path,{headers:{authorization:'Bearer t'}}),env);assert.equal(r.status,200,path);assert.equal(r.headers.get('cache-control'),'private, no-store');const b=await r.json();assert.equal(b.schema,schema);assert.equal(b.unavailable,true);}
  const station=await core.fetch(new Request('https://api.mccluster.org/v1/world/tides/12',{headers:{authorization:'Bearer t'}}),env);
  assert.equal(station.status,400);assert.equal((await station.json()).code,'invalid_station');
 }finally{globalThis.fetch=original;}
});
test('WORLD_GLOBE_WITHDRAWN withdraws each Halo feed and place search, for the owner too',async()=>{
 for(const [path,feature] of HALO){
  for(const value of [feature,'*','flights,'+feature]){const r=await guardWorldRelease(new Request('https://api.mccluster.org'+path,{headers:{authorization:'Bearer t'}}),{...env,WORLD_GLOBE_WITHDRAWN:value},{fetchImpl:db(true)});assert.equal(r.status,403,path+' '+value);assert.equal((await r.json()).code,'feature_withdrawn');}
  assert.equal(await guardWorldRelease(new Request('https://api.mccluster.org'+path,{headers:{authorization:'Bearer t'}}),{...env,WORLD_GLOBE_WITHDRAWN:'flights'},{fetchImpl:db(true)}),null,'withdrawing another feature leaves '+feature);
 }
});
