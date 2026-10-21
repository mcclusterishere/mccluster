import test from 'node:test';
import assert from 'node:assert/strict';
import {actorLiveComment} from '../src/executors/actor-live-comment.mjs';
import {buildCompletionEvidence} from '../src/completion-evidence.mjs';
const job={id:'job',org_id:'house',target_id:'royce.r01',job_type:'actor_live_comment'};
function fixture({context={},approved=true,publish={}}={}){
 const calls=[],inferences=[];
 return {calls,inferences,resolveOrg:async()=>'house',
 query:async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});return {body:path.endsWith('_context')?{actor_key:'royce.r01',source_post_id:'source',source_text:'We are opening a community studio.',messages:[],persona:{name:'Royce'},...context}:{actor_key:'royce.r01',published:true,publication_id:'receipt',comment_id:'comment',...publish}};},
 chat:async(input)=>{inferences.push(input);return {model:'qwen3:8b',message:{content:JSON.stringify(inferences.length===1?{comment:'A community studio? Give the neighborhood a mic and see who has something to say.',source_article_id:'source'}:{approved,reason:'Relevant opinion'})}};}
 };
}
test('live turn uses shared public context, review, atomic publisher and completion evidence',async()=>{
 const f=fixture(),out=await actorLiveComment(job,f);assert.equal(out.published,true);assert.equal(f.inferences.length,2);
 assert.match(f.inferences[0].messages[1].content,/community studio/);assert.equal(f.calls[1].body.p_review.approved,true);
 assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
});
test('wrong organization or actor receipt fails before inference',async()=>{
 const f=fixture();await assert.rejects(actorLiveComment({...job,org_id:'other'},f),/authority/);assert.equal(f.calls.length,0);
 const g=fixture({context:{actor_key:'other'}});await assert.rejects(actorLiveComment(job,g),/mismatch/);assert.equal(g.inferences.length,0);
});
test('replay and paused or stale room never spend inference',async()=>{
 for(const context of [{published:true,publication_id:'receipt',comment_id:'comment'},{published:false,reason:'inactive_or_stale'}]){
 const f=fixture({context}),out=await actorLiveComment(job,f);assert.equal(f.inferences.length,0);assert.equal(f.calls.length,1);assert.doesNotThrow(()=>buildCompletionEvidence(job,out));}
});
test('review rejection never calls the publisher',async()=>{
 const f=fixture({approved:false}),out=await actorLiveComment(job,f);assert.equal(out.reason,'review_withheld');assert.equal(f.calls.length,1);assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
});
test('pause while inference runs is an evidenced no-op',async()=>{
 const f=fixture({publish:{published:false,reason:'inactive_or_stale'}}),out=await actorLiveComment(job,f);assert.equal(out.published,false);assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
});
