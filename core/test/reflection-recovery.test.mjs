import test from 'node:test';
import assert from 'node:assert/strict';
import {objectiveReflection, fetchReflectionResponse} from '../src/executors/objective-reflection.mjs';
const job = {id:'diagnostic',org_id:'house',job_type:'objective_reflection',input:{max_next_jobs:0}};
const dependencies = {
  getObjectives: async () => [{id:'goal',title:'Verify Core',description:'x'.repeat(500000)}],
  getJobs: async () => [{id:'failed',job_type:'local_analysis',status:'failed',output:{private:'NEVER_FORWARD'}}],
  getHealth: async () => ({overall:'degraded',parity:'true',failures:'42'}),
};

test('diagnostic reflection cannot enqueue work even when the model requests it', async () => {
  let calls = 0;
  const result = await objectiveReflection(job, {...dependencies,
    chat: async (messages, options) => {
      assert.ok(Buffer.byteLength(JSON.stringify(messages)) < 8192);
      assert.ok(!JSON.stringify(messages).includes('NEVER_FORWARD'));
      assert.ok(options.metadata.compact_evidence);
      return {message:{content:JSON.stringify({summary:'Evidence checked',rationale:'Diagnostic only',next_jobs:[{job_type:'local_analysis',task:'Do work'}]})}};
    }, enqueue: async () => {calls++; throw new Error('must not enqueue');},
  });
  assert.equal(calls,0); assert.deepEqual(result.queued_jobs,[]);
  assert.equal(result.diagnostics.max_next_jobs,0);
  assert.ok(result.diagnostics.prompt_bytes < 8192);
});

test('transport failure diagnostics include size/timing but not sensitive error contents', async () => {
  await assert.rejects(objectiveReflection(job, {...dependencies,
    chat: async () => {throw Object.assign(new Error('SECRET_PAYLOAD'),{name:'TimeoutError'});}
  }), error => /TimeoutError; elapsed_ms=\d+; prompt_bytes=\d+/.test(error.message) && !error.message.includes('SECRET_PAYLOAD'));
});

test('reflection uses bounded non-thinking structured output and unchanged 90-second ceiling', async () => {
  let request;
  await fetchReflectionResponse([{role:'user',content:'test'}], {chatImpl:async value => {request=value;return {};}});
  assert.equal(request.json,true); assert.equal(request.think,false);
  assert.equal(request.numPredict,384); assert.ok(request.timeoutMs <= 90000);
});
