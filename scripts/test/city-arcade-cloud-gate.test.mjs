import test from 'node:test';
import assert from 'node:assert/strict';
import {handleArcade} from '../../workers/mccluster/src/arcade/index.js';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
for(const flag of [undefined,false,'false',true,'1'])test('cloud is default-off with flag '+String(flag),async()=>{
 let rpc=0,auth=0;
 const options={requireHouseOwner:async()=>{auth++;return {id:'fixture-owner'};},fetchImpl:async()=>{rpc++;throw Error('must not query');}};
 const config={...env,ARCADE_CLOUD_ENABLED:flag};
 const capabilities=await handleArcade(new Request('https://fixture.invalid/v1/arcade/capabilities'),config,options);
 assert.equal((await capabilities.json()).value.cloudEnabled,false);
 for(const [path,method]of [['missions/bridgeport-main-elm','GET'],['missions/bridgeport-main-elm','PUT'],['start/bridgeport-main-elm','POST'],['finish/11111111-1111-4111-8111-111111111111','POST'],['results','GET']]){
  const r=await handleArcade(new Request('https://fixture.invalid/v1/arcade/'+path,{method}),config,options);assert.equal(r.status,503);
 }
 assert.equal(rpc,0);assert.equal(auth,6);
});
test('capability remains owner gated and never probes missing schema',async()=>{
 let rpc=0;const opts={requireHouseOwner:async()=>{throw Object.assign(Error('Owner required'),{status:403});},fetchImpl:async()=>{rpc++;}};
 assert.equal((await handleArcade(new Request('https://fixture.invalid/v1/arcade/capabilities'),env,opts)).status,403);assert.equal(rpc,0);
});
test('explicit enabled fixture retains RPC path and fails closed on missing schema',async()=>{
 let rpc=0;const opts={requireHouseOwner:async()=>({id:'fixture-owner'}),fetchImpl:async()=>{rpc++;return Response.json({code:'PGRST202'},{status:404});}};
 const config={...env,ARCADE_CLOUD_ENABLED:'true'};
 const c=await handleArcade(new Request('https://fixture.invalid/v1/arcade/capabilities'),config,opts);assert.equal((await c.json()).value.cloudEnabled,true);assert.equal(rpc,0);
 const r=await handleArcade(new Request('https://fixture.invalid/v1/arcade/missions/bridgeport-main-elm'),config,opts);assert.equal(r.status,503);assert.equal(rpc,1);
});
