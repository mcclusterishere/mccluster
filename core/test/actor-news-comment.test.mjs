import test from 'node:test';
import assert from 'node:assert/strict';
import {actorNewsComment,validateActorComment} from '../src/executors/actor-news-comment.mjs';
import {buildCompletionEvidence} from '../src/completion-evidence.mjs';
const job={id:'00000000-0000-4000-8000-000000000001',org_id:'house',job_type:'actor_news_comment',target_id:'royce.r01'};
const article={id:'00000000-0000-4000-8000-000000000002',title:'City opens new public recording studio',canonical_url:'https://news.example/studio',published_at:'2026-10-21T12:00:00Z'};
function fixture({paused=false,limit=false,replay=false,approved=true}={}){
 const calls=[],inferences=[];
 return {calls,inferences,resolveOrg:async()=> 'house',now:new Date('2026-10-21T13:00:00Z'),
 query:async(url,init)=>{
  calls.push({url,init});
  if(url.startsWith('ops_actor_publications?job_id'))return {body:replay?[{id:'receipt',comment_id:'comment',article_id:article.id,actor_key:'royce.r01'}]:[]};
  if(url.startsWith('ops_platform_actors?'))return {body:[{enabled:!paused,daily_limit:1,persona:{name:'Royce'}}]};
  if(url.startsWith('ops_actor_publications?'))return {body:limit?[{article_id:'old',body:'old'}]:[]};
  if(url.startsWith('media_news_articles?'))return {body:[article]};
  if(url==='rpc/ops_actor_publish_comment'){const p=JSON.parse(init.body);assert.equal(p.p_org_id,'house');assert.equal(p.p_actor_key,'royce.r01');assert.equal(p.p_article_id,article.id);return {body:{published:true,publication_id:'receipt',comment_id:'comment',article_id:article.id}};}
  throw new Error(url);
 },
 chat:async(input)=>{inferences.push(input);return {model:'qwen3:8b',message:{content:JSON.stringify(inferences.length===1?{source_article_id:article.id,comment:'A public studio? Finally, a city budget with something worth listening to.'}:{approved,reason:'Opinion on the supplied headline.'})}};}
 };
}
test('Royce generates and reviews using local inference before a scoped publication',async()=>{
 const deps=fixture();const out=await actorNewsComment(job,deps);
 assert.equal(out.published,true);assert.equal(deps.inferences.length,2);assert.equal(deps.inferences[0].numCtx,4096);
 assert.ok(deps.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'));
 assert.doesNotThrow(()=>buildCompletionEvidence(job,out));
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
 const rejected=fixture({approved:false});await assert.rejects(actorNewsComment(job,rejected),/withheld/);assert.equal(rejected.calls.some(c=>c.url==='rpc/ops_actor_publish_comment'),false);
});
test('malformed, threatening, and misattributed model outputs are rejected',()=>{
 for(const data of [{comment:'Something interesting',source_article_id:'other'},{comment:'I will kill you for that',source_article_id:article.id},{comment:'Go to https://example.test now',source_article_id:article.id}])assert.throws(()=>validateActorComment(data,article.id));
});
