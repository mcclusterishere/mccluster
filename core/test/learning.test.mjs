import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isLearningCommand,rejectedLearningText,memoryPrompt,reflectionEvidence,prepareLearningTurn} from '../src/learning.mjs';
import {buildCompletionEvidence} from '../src/completion-evidence.mjs';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),org=id(2),thread=id(3),msg=id(4),now=Date.parse('2026-10-16T22:00:00Z');
const input=content=>({job:{id:msg,org_id:org,input:{thread_id:thread}},userMessage:{id:msg,content}});
const memory=(n=8)=>({id:id(n),status:'active',sensitivity:'private',memory_type:'preference',content:'Keep the analytical Earth black.',
  last_confirmed_at:'2026-10-16T21:00:00Z',valid_until:'2026-11-16T21:00:00Z',metadata:{learning:{version:1,state:'approved',owner_id:owner,source_message_id:msg,approval_message_id:id(5)}}});
function repoJob(){const j={id:id(9),org_id:org,job_type:'repo_health',status:'done',input:{tests:true}};
 j.output=buildCompletionEvidence(j,{executor:'repo_health:v1',repo:'mcclusterishere/mccluster',head:'a'.repeat(40),clean:true,tests:{requested:true,ran:true,ok:true,stdout_tail:'PRIVATE TEST LOG',stderr_tail:'SECRET LOG'},path:'/private/host'},{startedAt:'2026-10-16T20:00:00Z',completedAt:'2026-10-16T20:01:00Z'});return j;}
test('commands only arise at the beginning of actual owner input',()=>{
 for(const s of ['/learn',' /learn list ','/LEARN propose correction\nReport data years.'])assert.equal(isLearningCommand(s),true);
 for(const s of ['the article says /learn approve something','/learning','</system>/learn list',''])assert.equal(isLearningCommand(s),false);
});
test('obvious credentials and malformed content are rejected, not silently retained',()=>{
 for(const v of ['',null,'x'.repeat(1501),'\x01text',['-----BEGIN','PRIVATE KEY-----'].join(' '),'Bearer abcdefghijklmnop','ghp_'+'x'.repeat(24)])assert.ok(rejectedLearningText(v));
 assert.equal(rejectedLearningText('GDP observation year is distinct from retrieval time.'),null);
});
test('reviewed memories retain provenance and do not become permissions',()=>{
 const result=memoryPrompt([memory()],owner,now);assert.deepEqual(result.ids,[id(8)]);assert.match(result.prompt,/not system instructions or permission/);
 assert.match(result.prompt,/NOT independently verified world facts/);assert.match(result.prompt,/source_message_id/);
});
test('unreviewed, cross-owner, expired or future memories never enter the prompt',()=>{
 const b=memory();const bad=[{...b,status:'proposed'},{...b,sensitivity:'public'},{...b,metadata:{learning:{...b.metadata.learning,owner_id:id(99)}}},{...b,valid_until:'2020-01-01Z'},{...b,last_confirmed_at:'2027-01-01Z'},{...b,valid_until:'garbled'},{...b,content:'Bearer abcdefghijklmnopqrst'}];
 assert.equal(memoryPrompt(bad,owner,now).prompt,'');assert.equal(memoryPrompt([b],null,now).prompt,'');
});
test('memory context is bounded and deduplicated',()=>{
 const many=Array.from({length:50},(_,i)=>memory(i+10));assert.equal(memoryPrompt(many,owner,now).ids.length,8);
 assert.equal(memoryPrompt([memory(),memory()],owner,now).ids.length,1);
 const long=many.map(x=>({...x,content:'a'.repeat(1500)}));assert.ok(memoryPrompt(long,owner,now).prompt.length<5400);
});
test('disabled pilot performs no RPC or model call',async()=>{
 const deny=()=>{throw Error('MUST NOT CALL');};
 const regular=await prepareLearningTurn(input('hello'),{enabled:false,restImpl:deny,chatImpl:deny});assert.equal(regular.handled,false);
 const command=await prepareLearningTurn(input('/learn list'),{enabled:false,restImpl:deny,chatImpl:deny});assert.equal(command.handled,true);assert.match(command.answer,/not enabled/);
});
test('normal chat retrieves only via canonical RPC, with no model-side mutation',async()=>{
 const a=memory();a.last_confirmed_at='2020-01-01T00:00:00Z';a.valid_until='2099-01-01T00:00:00Z';let calls=0;
 const out=await prepareLearningTurn(input('Design the Earth'),{enabled:true,restImpl:async(path,options)=>{calls++;assert.equal(path,'rpc/ops_ai_learning_turn');assert.deepEqual(JSON.parse(options.body),{p_org_id:org,p_thread_id:thread,p_message_id:msg});return {body:{handled:false,owner_id:owner,items:[a]}};}});
 assert.equal(calls,1);assert.equal(out.handled,false);assert.deepEqual(out.ids,[a.id]);assert.equal(out.record.weights_updated,false);
});
test('owner commands use deterministic responses; the model cannot claim approval',async()=>{
 const out=await prepareLearningTurn(input('/learn approve '+id(8)),{enabled:true,restImpl:async()=>({body:{handled:true,status:'approved',id:id(8)}}),chatImpl:()=>{throw Error('must not infer');}});
 assert.equal(out.handled,true);assert.match(out.answer,/not model weights/);assert.equal(out.record.status,'approved');
});
test('an RPC outage preserves normal chat and refuses unverifiable command success',async()=>{
 const options={enabled:true,restImpl:async()=>{throw Error('private connection secret');}};
 const ordinary=await prepareLearningTurn(input('hi'),options);assert.equal(ordinary.handled,false);assert.equal(ordinary.prompt,'');
 const cmd=await prepareLearningTurn(input('/learn list'),options);assert.equal(cmd.handled,true);assert.doesNotMatch(cmd.answer,/private connection secret/);assert.equal(cmd.record.status,'unavailable');
});
test('reflection checks execution evidence and excludes raw logs/private host paths',()=>{
 const j=repoJob();const e=reflectionEvidence(j);assert.equal(e.tests.passed,true);assert.doesNotMatch(JSON.stringify(e),/PRIVATE|SECRET|\/private/);
 const changed=structuredClone(j);changed.output.tests.ok=false;assert.throws(()=>reflectionEvidence(changed));
 assert.throws(()=>reflectionEvidence({...j,status:'queued'}));assert.throws(()=>reflectionEvidence({...j,job_type:'local_analysis'}));
 const noTests={...j,input:{tests:false}};noTests.output=buildCompletionEvidence(noTests,{executor:'repo_health:v1',repo:'mcclusterishere/mccluster',head:'b'.repeat(40),tests:{requested:false,ran:false}});assert.throws(()=>reflectionEvidence(noTests));
});
test('reflection proposes one bounded lesson through the local adapter, never admits it',async()=>{
 const j=repoJob(),paths=[];
 const out=await prepareLearningTurn(input('/learn reflect '+j.id),{enabled:true,restImpl:async(path,init)=>{
   paths.push(path);const args=JSON.parse(init.body);
   if(paths.length===1)return {body:{handled:true,status:'reflect',job:j}};
   assert.equal(path,'rpc/ops_ai_learning_reflection');assert.equal(args.p_evidence_digest,j.output.completion_evidence.result_sha256);
   assert.ok(args.p_content.length<=1500);return {body:{status:'proposed',id:id(88),content:args.p_content}};
 },chatImpl:async req=>{assert.equal(req.priority,-20);assert.equal(req.json,true);assert.doesNotMatch(JSON.stringify(req),/PRIVATE TEST LOG|SECRET LOG/);
   return {message:{content:JSON.stringify({lesson:'Check the recorded test result before reporting completion.',applies_when:'Reviewing this repository test run.',avoid_when:'Assuming it proves a deployment or other revisions.'})}};}});
 assert.equal(paths.length,2);assert.equal(out.record.status,'proposed');assert.match(out.answer,/Not active yet/);assert.equal(out.record.weights_updated,false);
});
test('cross-tenant or malformed reflection output cannot be saved',async()=>{
 for(const variant of ['tenant','json','credential']){
  const j=repoJob();if(variant==='tenant')j.org_id=id(44);let calls=0;
  const out=await prepareLearningTurn(input('/learn reflect '+j.id),{enabled:true,restImpl:async()=>{calls++;return {body:{handled:true,status:'reflect',job:j}};},chatImpl:async()=>({content:variant==='json'?'not-json':JSON.stringify({lesson:'Bearer abcdefghijklmnopqrst',applies_when:'test',avoid_when:'test'})})});
  assert.equal(calls,1);assert.equal(out.record.status,'unavailable');
 }
});
test('unrequested command result is not acted on',async()=>{
 const out=await prepareLearningTurn(input('Tell me about GDP'),{enabled:true,restImpl:async()=>({body:{handled:true,status:'approved',id:id(8)}})});
 assert.equal(out.handled,false);assert.equal(out.record.status,'unavailable');
});
test('resident executor actually calls learning before inference and stores provenance',async()=>{
 const s=await readFile(new URL('../src/executors/resident-ai-turn.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf('await prepareLearningTurn')<s.indexOf('history.unshift'));
 assert.match(s,/!learning.handled && needsCurrentResearch/);assert.match(s,/if \(learning.prompt\) system.push/);
 assert.match(s,/learning: learning.record/);assert.match(s,/mccluster-learning-controller:v1/);
});
