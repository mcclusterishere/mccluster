import test from 'node:test';
import assert from 'node:assert/strict';
import {executeResidentTool} from '../src/resident-tools.mjs';
test('resident connection reads use trusted org and bounded context',async()=>{
 let input;const out=await executeResidentTool('connections_read',{root:'actor:royce.r01',depth:99},{orgId:'house',turnId:'turn'},{rest:async(url,init)=>{assert.equal(url,'rpc/ops_connected_graph_service');input=JSON.parse(init.body);return {body:{nodes:[],edges:[]}};}});
 assert.equal(input.p_org,'house');assert.equal(input.p_depth,3);assert.equal(input.p_limit,30);assert.deepEqual(out,{nodes:[],edges:[]});
 await assert.rejects(executeResidentTool('connections_read',{org_id:'foreign'},{orgId:'house',turnId:'turn'}),/Unexpected/);
});
