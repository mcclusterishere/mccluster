// W3 Worker contract: starts carry an owner-bound idempotency key and running runs are readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleArcade} from '../src/arcade/index.js';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',ARCADE_CLOUD_ENABLED:'true'};
const owner={requireHouseOwner:async()=>({id:'11111111-1111-4111-8111-111111111111'})};
const post=(path,body)=>new Request('https://fixture.invalid/v1/arcade/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('start without a start key never reaches storage',async()=>{
 let rpc=0;const r=await handleArcade(post('start/bridgeport-main-elm',{expectedRevision:1}),env,{...owner,fetchImpl:async()=>{rpc++;}});
 assert.equal(r.status,400);assert.equal(rpc,0);
 const bad=await handleArcade(post('start/bridgeport-main-elm',{expectedRevision:1,startKey:'not-a-uuid'}),env,{...owner,fetchImpl:async()=>{rpc++;}});
 assert.equal(bad.status,400);assert.equal(rpc,0);
});
test('start forwards the normalized key as the RPC document and keeps the revision check',async()=>{
 let sent;const r=await handleArcade(post('start/bridgeport-main-elm',{expectedRevision:3,startKey:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}),env,{...owner,fetchImpl:async(url,o)=>{sent=JSON.parse(o.body);return Response.json({id:'run',revision:3,document:{}});}});
 assert.equal(r.status,201);assert.deepEqual(sent,{p_action:'start',p_actor:'11111111-1111-4111-8111-111111111111',p_id:'bridgeport-main-elm',p_document:{startKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},p_revision:3});
 const conflict=await handleArcade(post('start/bridgeport-main-elm',{expectedRevision:2,startKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),env,{...owner,fetchImpl:async()=>Response.json({code:'40001'},{status:400})});
 assert.equal(conflict.status,409);
});
test('current-run read is owner gated, default-off and forwards the current action',async()=>{
 let sent;const r=await handleArcade(new Request('https://fixture.invalid/v1/arcade/current'),env,{...owner,fetchImpl:async(url,o)=>{sent=JSON.parse(o.body);return Response.json([]);}});
 assert.equal(r.status,200);assert.equal(sent.p_action,'current');
 const off=await handleArcade(new Request('https://fixture.invalid/v1/arcade/current'),{...env,ARCADE_CLOUD_ENABLED:'false'},{...owner,fetchImpl:async()=>{throw Error('no');}});
 assert.equal(off.status,503);
 const denied=await handleArcade(new Request('https://fixture.invalid/v1/arcade/current'),env,{requireHouseOwner:async()=>{throw Object.assign(Error('Owner required'),{status:403});},fetchImpl:async()=>{throw Error('no');}});
 assert.equal(denied.status,403);
});
