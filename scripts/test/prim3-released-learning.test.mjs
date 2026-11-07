import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointReady,createReleasedLearning} from '../../js/prim3-mission/released-learning.mjs';
test('checkpoint presentation requires exact recipe and completed canonical step',()=>{
 const s={battlefield:{generated:{recipeId:'recipe-a'}},nodes:[{id:'CHECKPOINT-1',state:'STEP_1'}]};
 assert.equal(checkpointReady(s,'recipe-a','CHECKPOINT-1:STEP_1'),true);
 assert.equal(checkpointReady(s,'recipe-a','CHECKPOINT-1:STEP_2'),false);
 assert.equal(checkpointReady(s,'recipe-b','CHECKPOINT-1:STEP_1'),false);
 assert.equal(checkpointReady(s,'recipe-a','CHECKPOINT-2:STEP_1'),false);
 s.nodes[0].state='VERIFIED';assert.equal(checkpointReady(s,'recipe-a','CHECKPOINT-1:STEP_3'),true);
});
test('shared adapter binds server release and forwards answer, never client correctness',async()=>{
 const release={id:'release-a',recipe_id:'recipe-a',recipe_hash:'hash-a'},calls=[];
 const practice={current:null,async start(review,options){calls.push({review,options});this.current={flow:{phase:'brief'},released_mission:{id:release.id,recipe_hash:release.recipe_hash,next_checkpoint_id:'CHECKPOINT-1:STEP_1'}};},async submit(type,fields){calls.push({type,fields});if(type==='begin')this.current.flow.phase='play';if(type==='handoff')this.current.flow.tacticalHandoff=true;return this.current;}};
 let state={battlefield:{generated:{recipeId:'recipe-a'}},nodes:[{id:'CHECKPOINT-1',state:'OBSERVED'}]};
 const client=createReleasedLearning({practice,release,getTacticalState:()=>state});
 await client.open();assert.equal(calls[0].options.releaseId,release.id);assert.deepEqual(calls.slice(1).map(c=>c.type),['begin','handoff']);
 await assert.rejects(client.answer('8'),/Complete|complete/);
 state.nodes[0].state='STEP_1';await client.answer('8');assert.deepEqual(calls.at(-1),{type:'answer',fields:{answer:'8',checkpointId:'CHECKPOINT-1:STEP_1'}});
 practice.current.released_mission.recipe_hash='wrong';assert.throws(()=>client.current,/different release/);
});
