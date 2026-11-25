import test from 'node:test';
import assert from 'node:assert/strict';
import {solePersistedSession,soleResultForRetry} from '../../js/city-arcade/sole-street-view.mjs';

const run={status:'won',index:4,remaining:17,score:320,encounters:{badge:'done'},player:[12,34]};
const pending={id:'cloud-run-1',body:{status:'won',served:4,encounters:['badge']}};

test('unfinished street runs retain the cloud ID without inventing a pending result',()=>{
 const snapshot=solePersistedSession({...run,status:'paused'},'designer-kicks', 'cloud-run-1', null);
 assert.equal(snapshot.cloudRun,'cloud-run-1');
 assert.equal(snapshot.pending,null);
 assert.equal(snapshot.locationId,'designer-kicks');
});

test('finished cloud street runs retain a retryable result across reloads',()=>{
 const snapshot=solePersistedSession(run,'designer-kicks','cloud-run-1',pending);
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).pending,pending);
 assert.deepEqual(soleResultForRetry(snapshot,'cloud-run-1',run.encounters,run.index,run.status),pending);
 assert.equal(solePersistedSession(run,'designer-kicks','cloud-run-1',null),null,'successful cloud save clears finished local session');
});

test('failed runs with zero remaining time remain recoverable',()=>{
 const failed={...run,status:'failed',remaining:0,index:2};
 const retry={id:'cloud-run-2',body:{status:'failed',served:2,encounters:['badge']}};
 const snapshot=solePersistedSession(failed,'designer-kicks','cloud-run-2',retry);
 assert.equal(snapshot.remaining,0);
 assert.deepEqual(soleResultForRetry(snapshot,'cloud-run-2',failed.encounters,2,'failed'),retry);
});

test('tampered or unrelated retry payloads are not restored or persisted',()=>{
 const snapshot=solePersistedSession(run,'designer-kicks','cloud-run-1',pending);
 assert.equal(soleResultForRetry(snapshot,'other-run',run.encounters,4,'won'),null);
 assert.equal(soleResultForRetry({...snapshot,pending:{...pending,body:{...pending.body,served:3}}},'cloud-run-1',run.encounters,4,'won'),null);
 assert.equal(soleResultForRetry({...snapshot,pending:{...pending,body:{...pending.body,encounters:['unauthorized']}}},'cloud-run-1',run.encounters,4,'won'),null);
 assert.equal(solePersistedSession(run,'designer-kicks','cloud-run-2',pending),null);
 assert.equal(solePersistedSession({...run,status:'failed'},'designer-kicks','cloud-run-1',pending),null);
});
