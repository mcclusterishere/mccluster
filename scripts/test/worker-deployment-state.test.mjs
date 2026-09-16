import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDeployment, allocation } from '../worker-deployment-state.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const deployment=(time,versions)=>({id:time,created_on:time,versions});
test('latest deployment is selected by time, never list order',()=>{
 const older=deployment('2026-01-01',[{version_id:a,percentage:100}]);
 const newer=deployment('2026-01-02',[{version_id:b,percentage:100}]);
 assert.deepEqual(allocation(currentDeployment([older,newer])),[`${b}@100`]);
 assert.deepEqual(currentDeployment([newer,older]),currentDeployment([older,newer]));
});
test('a split deployment rolls back to the full traffic allocation',()=>{
 assert.deepEqual(allocation(currentDeployment([deployment('2026-01-01',[{version_id:a,percentage:20},{version_id:b,percentage:80}])])),[`${a}@20`,`${b}@80`]);
});
for(const value of [[],{},[deployment('invalid',[])],[deployment('2026-01-01',[{version_id:a,percentage:50}])],[deployment('2026-01-01',[{version_id:'injected',percentage:100}])]]){
 test('ambiguous rollback state fails closed '+JSON.stringify(value),()=>assert.throws(()=>currentDeployment(value)));
}
