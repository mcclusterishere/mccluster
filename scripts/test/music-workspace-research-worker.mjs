import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleMusicWorkspaceResearch} from '../../workers/mccluster/src/music-workspace-research.js';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const body={track_id:id,stage:'analyze',model_id:'mcc_spectral_v1',idempotency_key:'fixture-request-1',consent:true};
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',MUSIC_WORKSPACE_RESEARCH_ENQUEUE_ENABLED:'true'};
const request=(b=body)=>new Request('https://api.mccluster.org/v1/music-workspace/analysis',{method:'POST',headers:{authorization:'Bearer member-session'},body:JSON.stringify(b)});
test('default-off bridge forwards consent and user JWT to existing queue only; failure is retryable without provider calls',async()=>{
 const calls=[];let denied=false;const fetchImpl=async(url,init)=>{calls.push({url,init});return denied?Response.json({message:'owner required'},{status:403}):Response.json(id)};
 let response=await handleMusicWorkspaceResearch(request(),{...env,MUSIC_WORKSPACE_RESEARCH_ENQUEUE_ENABLED:undefined},{fetchImpl});assert.equal(response.status,503);assert.equal(calls.length,0);
 response=await handleMusicWorkspaceResearch(request({...body,consent:false}),env,{fetchImpl});assert.equal(response.status,400);assert.equal(calls.length,0);
 response=await handleMusicWorkspaceResearch(request({...body,padding:'x'.repeat(5000)}),env,{fetchImpl});assert.equal(response.status,413);assert.equal(calls.length,0);
 response=await handleMusicWorkspaceResearch(request(),env,{fetchImpl});assert.equal(response.status,202);assert.deepEqual(await response.json(),{job_id:id,accepted:true,published:false});assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://fixture.invalid/rest/v1/rpc/music_workspace_research_enqueue');assert.equal(calls[0].init.headers.authorization,'Bearer member-session');assert.equal(JSON.parse(calls[0].init.body).p_consent,true);assert.equal(response.headers.get('cache-control'),'private, no-store');
 denied=true;response=await handleMusicWorkspaceResearch(request(),env,{fetchImpl});assert.equal(response.status,409);assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].init.body).p_idempotency_key,body.idempotency_key);
});
