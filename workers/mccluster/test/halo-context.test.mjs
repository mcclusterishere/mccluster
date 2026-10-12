import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHaloContext} from '../src/seek-first/halo-context.js';
const good={version:1,investigation_id:'case_123',start:'2026-10-01T00:00:00.000Z',end:'2026-10-11T00:00:00.000Z',viewport:{lat:41.3,lon:-72.9,height:12000},layers:['campaign_region']};
test('accepts canonical, non-sensitive handoff',()=>assert.equal(validateHaloContext(good).investigation_id,'case_123'));
test('rejects leaked credentials and customer records',()=>{
 for(const field of ['access_token','email','ip_address','stripe_account','url','customer_id']){
  assert.throws(()=>validateHaloContext({...good,[field]:'secret'}),/unexpected context field/);
 }
});
test('rejects invalid viewports, time ranges and layer injection',()=>{
 for(const change of [{viewport:{lat:91,lon:0,height:100}}, {start:'bad'}, {layers:['../../admin']},{layers:Array(25).fill('x')},{investigation_id:'../../secret'}]){
  assert.throws(()=>validateHaloContext({...good,...change}));
 }
});
test('deduplicates layers without mutating input',()=>{
 const v=validateHaloContext({...good,layers:['weather','weather']});
 assert.deepEqual(v.layers,['weather']);
 assert.deepEqual(good.layers,['campaign_region']);
});
