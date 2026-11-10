import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWorldEnvironment} from '../src/world-environment.js';
import {environmentNewsRevision} from '../src/environment-mission-planning.js';
const USER='10000000-0000-4000-8000-000000000001',ORG='10000000-0000-4000-8000-000000000002',ARTICLE='10000000-0000-4000-8000-000000000003',REVIEW='10000000-0000-4000-8000-000000000004',MISSION='10000000-0000-4000-8000-000000000005',ASSIGN='10000000-0000-4000-8000-000000000006',PROOF='10000000-0000-4000-8000-000000000007';
const env={SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const request=(path,body,identity='owner',method='POST')=>new Request('https://api.example.invalid/v1/world/environment'+path,{method,headers:identity?{authorization:'Bearer '+identity}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function fixture(){
 const now=new Date().toISOString(),article={id:ARTICLE,title:'Flood access planning in Connecticut',canonical_url:'https://news.example.invalid/flood-access',published_at:now,imported_at:now,ingestion_provider:'gdelt_gkg_v2'};
 const calls=[],reviews=[];let owner=true;
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url);calls.push({url:u.href,options});
  /* The persisted module policy the route reads first on every request: installed and enabled in this fixture. */
  if(u.pathname==='/rest/v1/rpc/eup_module_policy_read')return json({schema:'equity-uprise.module-policy/v1',installationId:'mccluster',moduleId:'environment',state:'enabled',revision:1});
  if(u.pathname==='/auth/v1/user'){owner=options.headers?.authorization==='Bearer owner';return json({id:USER});}
  if(u.pathname==='/rest/v1/orgs')return json([{id:ORG}]);
  if(u.pathname==='/rest/v1/org_members')return json(owner?[{role:'owner'}]:[]);
  if(u.pathname==='/rest/v1/media_news_articles')return json([article]);
  if(u.pathname==='/rest/v1/ops_recommendations'){
   if(options.method==='POST'){const record=JSON.parse(options.body);reviews.push({...record,id:REVIEW});return json([reviews.at(-1)]);}
   return json(reviews);
  }
  if(u.pathname==='/rest/v1/action_environment_missions')return json([]);
  if(u.pathname==='/rest/v1/rpc/world_environment_propose')return json({mission_id:MISSION,status:'draft',created:true});
  if(u.pathname==='/rest/v1/rpc/world_environment_proof_review')return json({proof_id:PROOF,status:'verified'});
  if(u.pathname==='/rest/v1/rpc/world_environment_proof_submit')return json({proof_id:PROOF,assignment_id:ASSIGN,status:'submitted',share:false});
  if(u.hostname==='api.weather.gov')return json({features:[{id:'alert1',geometry:null,properties:{id:'alert1',status:'Actual',event:'Flood Warning',sent:now,expires:new Date(Date.now()+3600000).toISOString()}}]});
  if(u.hostname==='eonet.gsfc.nasa.gov')return json({events:[]});
  if(u.hostname==='earthquake.usgs.gov')return json({features:[],metadata:{generated:Date.now()}});
  if(u.hostname==='www.nhc.noaa.gov')return json({activeStorms:[]});
  throw Error('Unexpected fixture route '+u.href);
 };
 return {calls,reviews,article,fetchImpl};
}
test('HTTP controller integrates owner headline review into immutable mission proposal input without private metadata',async()=>{
 const f=fixture();const input={eventId:'nws:alert1',actionId:'resource-check'};
 let r=await handleWorldEnvironment(request('/planning/context',input),env,f);assert.equal(r.status,200);const context=await r.json();assert.equal(context.articles[0].id,ARTICLE);assert.equal(context.reviewed.length,0);
 r=await handleWorldEnvironment(request('/planning/review',{...input,articleId:ARTICLE,revision:await environmentNewsRevision(f.article),headlineExcerpt:f.article.title,rationale:'Relevant access planning for the official flood warning.'}),env,f);assert.equal(r.status,200);assert.equal((await r.json()).review_id,REVIEW);
 assert.equal(f.reviews[0].confidence,undefined);
 r=await handleWorldEnvironment(request('/missions/propose',{event_id:input.eventId,action_id:input.actionId,news_review_id:REVIEW,news_context:{title:'Forged'}}),env,f);assert.equal(r.status,200);
 const sent=JSON.parse(f.calls.find(c=>c.url.endsWith('/world_environment_propose')).options.body);assert.equal(sent.p_event.news_context.article_id,ARTICLE);assert.equal(sent.p_event.news_context.title,f.article.title);assert.equal(sent.p_event.news_context.url,f.article.canonical_url);assert.doesNotMatch(JSON.stringify(sent.p_event.news_context),/reviewer_id|rationale|org_id|Forged/);
});
test('guests and ordinary members cannot reach news review or sponsor records',async()=>{
 for(const identity of [null,'member']){
  const f=fixture();const r=await handleWorldEnvironment(request('/planning/context',{eventId:'nws:alert1',actionId:'resource-check'},identity),env,f);assert.equal(r.status,identity?403:401);assert.ok(!f.calls.some(c=>/media_news_articles|ops_recommendations|out_companies/.test(c.url)));
 }
});
test('proof HTTP route calls canonical wrapper with the verified user bearer and explicit private choice',async()=>{
 const f=fixture();const r=await handleWorldEnvironment(request(`/assignments/${ASSIGN}/proof`,{proof_type:'text',statement:'Checked dated official accessible-support guidance.',proof_url:null,share:false,consent:true,metadata:{asset_id:ARTICLE},status:'verified'},'member'),env,f);assert.equal(r.status,200);assert.equal((await r.json()).status,'submitted');
 const call=f.calls.find(c=>c.url.endsWith('/world_environment_proof_submit'));assert.equal(call.options.headers.authorization,'Bearer member');assert.deepEqual(JSON.parse(call.options.body),{p_assignment:ASSIGN,p_proof_type:'text',p_statement:'Checked dated official accessible-support guidance.',p_proof_url:null,p_share:false,p_consent:true});
});

test('owner proof HTTP review carries the exact displayed revision to canonical RPC',async()=>{
 const f=fixture(),expected_revision='a'.repeat(32);
 const body={decision:'verified',review_note:'Reviewed exact evidence.',expected_revision};
 assert.equal((await handleWorldEnvironment(request(`/proofs/${PROOF}/review`,{...body,expected_revision:undefined}),env,f)).status,400);
 const r=await handleWorldEnvironment(request(`/proofs/${PROOF}/review`,body),env,f);assert.equal(r.status,200);
 const call=f.calls.find(c=>c.url.endsWith('/world_environment_proof_review'));assert.equal(call.options.headers.authorization,'Bearer owner');assert.deepEqual(JSON.parse(call.options.body),{p_proof:PROOF,p_decision:'verified',p_expected_revision:expected_revision,p_review_note:'Reviewed exact evidence.'});
});
