import test from 'node:test';
import assert from 'node:assert/strict';
import {actorNewsComment,validateActorComment,isNewsCandidate} from '../src/executors/actor-news-comment.mjs';
import {buildCompletionEvidence} from '../src/completion-evidence.mjs';
const job={id:'00000000-0000-4000-8000-000000000001',org_id:'house',job_type:'actor_news_comment',target_id:'royce.r01'};
const article={id:'00000000-0000-4000-8000-000000000002',title:'City opens new public recording studio',canonical_url:'https://news.example/studio',published_at:'2026-10-21T12:00:00Z'};
function fixture({paused=false,limit=false,replay=false,approved=true}={}){
 const calls=[],inferences=[];
 return {calls,inferences,thinContextMode:'question_preview',resolveOrg:async()=> 'house',now:new Date('2026-10-21T13:00:00Z'),
 query:async(url,init)=>{
  calls.push({url,init});
  if(url.startsWith('ops_actor_publications?job_id'))return {body:replay?[{id:'receipt',comment_id:'comment',article_id:article.id,actor_key:'royce.r01'}]:[]};
  if(url.startsWith('ops_platform_actors?'))return {body:[{enabled:!paused,daily_limit:1,persona:{name:'Royce'}}]};
  if(url.startsWith('ops_actor_publications?'))return {body:limit?[{article_id:'old',body:'old'}]:[]};
  if(url.startsWith('media_news_articles?'))return {body:[article]};
  if(url==='rpc/ops_actor_publish_comment'){const p=JSON.parse(init.body);assert.equal(p.p_org_id,'house');assert.equal(p.p_actor_key,'royce.r01');assert.equal(p.p_article_id,article.id);return {body:{published:true,publication_id:'receipt',comment_id:'comment',article_id:article.id}};}
  throw new Error(url);
 },
 chat:async(input)=>{inferences.push(input); const packet=JSON.parse(input.messages[1].content).evidence; const anchor={source_id:packet.sources[0].source_id,quote:packet.sources[0].text}; return {model:'qwen3:8b',message:{content:JSON.stringify(inferences.length===1?{decision:'comment',source_item_id:article.id,comment:'A public recording studio? What would make it easier for beginners to book time?',evidence:[anchor],claims:[{text:'A public recording studio? What would make it easier for beginners to book time?',kind:'question',source_ids:[anchor.source_id]}]}:{approved,grounded:true,relevant:true,voice_consistent:true,issues:[],anchors:[anchor],claim_reviews:[{index:0,supported:true,reason:'Synthetic permissive verdict'}],reason:'A question grounded in the supplied headline.'})}};}
 };
}
test('model approval yields a private news candidate and cannot authorize publication',async()=>{
 const deps=fixture();const out=await actorNewsComment(job,deps);
 assert.equal(out.published,false);assert.equal(out.withheld_reason,'semantic_review_not_validated');assert.equal(out.review.model_approved,true);assert.equal(out.review.approved,false);assert.ok(out.candidate.comment);assert.equal(deps.inferences.length,2);assert.equal(deps.inferences[0].numCtx,8192);
 assert.ok(!deps.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'));
 assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
});
test('legacy news jobs abstain on headline-only evidence by default',async()=>{
 const {thinContextMode,...deps}=fixture();const out=await actorNewsComment(job,deps);
 assert.equal(out.published,false);assert.equal(out.withheld_reason,'thin_context_abstained');assert.equal(deps.inferences.length,0);
 assert.ok(!deps.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'));
});
test('paused, capped, and replayed jobs do not spend inference or publish again',async()=>{
 for(const option of [{paused:true},{limit:true},{replay:true}]){
  const deps=fixture(option);const out=await actorNewsComment(job,deps);
  assert.equal(deps.inferences.length,0);assert.equal(deps.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'),false);
  assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
 }
});
test('wrong organization and rejected reviews cannot publish',async()=>{
 const deps=fixture();await assert.rejects(actorNewsComment({...job,org_id:'other'},deps),/authority/);assert.equal(deps.calls.length,0);
 const rejected=fixture({approved:false});assert.equal((await actorNewsComment(job,rejected)).reason,'review_withheld');assert.equal(rejected.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'),false);
});
test('malformed, threatening, and misattributed model outputs are rejected',()=>{
 for(const data of [{comment:'Something interesting',source_article_id:'other'},{comment:'I will kill you for that',source_article_id:article.id},{comment:'Go to https://example.test now',source_article_id:article.id}])assert.throws(()=>validateActorComment(data,article.id));
});

test('profile and directory pages cannot become news reactions',()=>{
 assert.equal(isNewsCandidate(article),true);
 for(const candidate of [
  {...article,title:'Derek Clarkston',canonical_url:'https://www.kmxt.org/people/derek-clarkston'},
  {...article,canonical_url:'https://example.org/author/a-person-with-a-long-name'},
  {...article,canonical_url:'https://example.org/marketplace/listing/purchase-clerk'},
  {...article,canonical_url:'not a URL'},
 ]) assert.equal(isNewsCandidate(candidate),false);
});

test('an article changed during inference is withheld before publication',async()=>{
 const deps=fixture(),query=deps.query;
 deps.query=async(url,init)=>url.startsWith('media_news_articles?id=')?{body:[{...article,title:'A changed story about something entirely different'}]}:query(url,init);
 const out=await actorNewsComment(job,deps);
 assert.equal(out.published,false);assert.equal(out.withheld_reason,'source_changed_before_publish');
 assert.ok(!deps.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'));
});
