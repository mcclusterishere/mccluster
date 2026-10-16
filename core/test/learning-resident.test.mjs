import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='fixture-only';
process.env.MCCLUSTER_OLLAMA_ADAPTER_URL='http://127.0.0.1:4790';
process.env.MCCLUSTER_LEARNING_ENABLED='true';
const {residentAiTurn}=await import('../src/executors/resident-ai-turn.mjs');
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),thread=id(2),user=id(3),assistant=id(4),owner=id(5),lesson=id(6);
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
async function run(command){
 const original=globalThis.fetch;let persisted=null,inferences=0;
 const message={id:user,thread_id:thread,org_id:org,role:'user',content:command?'/learn propose preference\nKeep the globe black.':'How should our globe look?',metadata:{},created_at:new Date().toISOString()};
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));const method=init.method||'GET';
  if(url.pathname==='/rest/v1/control_observability_events')return json([]);
  if(url.pathname==='/rest/v1/rpc/ops_ai_learning_turn')return json(command?{handled:true,status:'proposed',id:lesson,content:'Keep the globe black.'}:{handled:false,owner_id:owner,items:[{id:lesson,memory_type:'preference',content:'Keep the globe black.',status:'active',sensitivity:'private',last_confirmed_at:'2020-01-01T00:00:00Z',valid_until:'2099-01-01T00:00:00Z',metadata:{learning:{version:1,owner_id:owner,state:'approved',source_message_id:id(7),approval_message_id:id(8)}}}]});
  if(url.pathname==='/rest/v1/ops_ai_messages'){
   if(method==='POST'){persisted=JSON.parse(init.body);return json([persisted]);}
   if(method==='PATCH')return json([message]);
   if(url.searchParams.get('id')==='eq.'+assistant)return json(persisted?[persisted]:[]);
   return json([message]);
  }
  if(url.origin==='http://127.0.0.1:4790'){
   inferences++;const req=JSON.parse(init.body);
   assert.ok(req.input.messages[0].content.includes('REVIEWED OWNER MEMORY'));
   assert.ok(req.input.messages[0].content.includes('Keep the globe black.'));
   return json({content:'Use the approved black analytical Earth.',model:'fixture-model',implementation:'core-local'});
  }
  throw Error('Unexpected intercepted route '+url.pathname);
 };
 try{const output=await residentAiTurn({id:user,org_id:org,job_type:'resident_ai_turn',input:{thread_id:thread,user_message_id:user,assistant_message_id:assistant}});return{output,persisted,inferences};}
 finally{globalThis.fetch=original;}
}
test('real resident executor injects reviewed cross-thread memory and records memory IDs',async()=>{
 const {output,persisted,inferences}=await run(false);assert.equal(inferences,1);
 assert.deepEqual(persisted.metadata.learning.memory_ids,[lesson]);assert.equal(output.learning.weights_updated,false);
});
test('real resident executor handles teaching without asking a model to perform a mutation',async()=>{
 const {output,persisted,inferences}=await run(true);assert.equal(inferences,0);
 assert.equal(output.implementation,'mccluster-learning-controller:v1');assert.match(persisted.content,/Not active yet/);assert.equal(persisted.metadata.learning.status,'proposed');
});
