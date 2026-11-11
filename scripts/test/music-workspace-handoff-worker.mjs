import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleMusicWorkspaceRelease} from '../../workers/mccluster/src/music-workspace-release.js';
import {workspaceAnalysisHandoff} from '../../workers/mccluster/src/music-workspace-analysis.js';
const project='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',asset='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',owner='cccccccc-cccc-cccc-cccc-cccccccccccc',id='dddddddd-dddd-dddd-dddd-dddddddddddd';
const bytes=new TextEncoder().encode('RIFF0000WAVE');const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'};
const data={project_id:project,asset_id:asset,version:1,authorized:true};
const req=(body=data)=>new Request('https://api.mccluster.org/v1/music-workspace/release-draft',{method:'POST',headers:{authorization:'Bearer owner-session'},body:JSON.stringify(body)});
test('private copy uses member JWT, preserves source, retries exact copy and finalizes with service-only RPC',async()=>{
 let completed=false,stored=false,calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('music_workspace_release_prepare'))return Response.json({id,owner_id:owner,project_id:project,asset_id:asset,master_path:owner+'/workspace/'+id+'.wav',bytes:12,mime:'audio/wav',source_sha256:checksum,completed_at:completed?'now':null});if(String(url).endsWith('music_workspace_release_finish')){completed=true;return Response.json({track_id:id})}if(init.method==='POST'){if(stored)return new Response('',{status:409});stored=true;return new Response('{}')}return new Response(bytes)};
 assert.equal((await handleMusicWorkspaceRelease(req(),env,{fetchImpl})).status,200);
 assert.equal(calls.filter(c=>c.init.method==='POST'&&c.url.includes('/storage/')).length,1);
 assert.equal(calls.find(c=>c.url.includes('/storage/')&&c.init.method==='POST').init.headers['x-upsert'],'false');
 assert.equal(calls.filter(c=>!c.url.endsWith('music_workspace_release_finish')).every(c=>c.init.headers.authorization==='Bearer owner-session'),true);
 assert.equal(calls.at(-1).init.headers.authorization,'Bearer fixture-service');
 calls=[];assert.equal((await handleMusicWorkspaceRelease(req(),env,{fetchImpl})).status,200);assert.equal(calls.some(c=>c.url.includes('/storage/')),false);
 completed=false;calls=[];assert.equal((await handleMusicWorkspaceRelease(req(),env,{fetchImpl})).status,200);assert.ok(calls.some(c=>c.url.includes('/authenticated/creator-masters/')));
 calls=[];assert.equal((await handleMusicWorkspaceRelease(req({...data,authorized:false}),env,{fetchImpl})).status,400);assert.equal(calls.length,0);
});
test('denied owner preparation and checksum mismatch never finalize or create a public object',async()=>{
 let calls=[];let deny=true;
 const fetchImpl=async(url,init)=>{calls.push(String(url));if(String(url).endsWith('music_workspace_release_prepare'))return deny?Response.json({error:'owner required'},{status:403}):Response.json({id,owner_id:owner,project_id:project,asset_id:asset,master_path:owner+'/workspace/'+id+'.wav',bytes:12,mime:'audio/wav',source_sha256:'0'.repeat(64)});return new Response(bytes)};
 assert.equal((await handleMusicWorkspaceRelease(req(),env,{fetchImpl})).status,409);assert.equal(calls.length,1);
 deny=false;calls=[];assert.equal((await handleMusicWorkspaceRelease(req(),env,{fetchImpl})).status,409);assert.equal(calls.length,2);assert.equal(calls.some(u=>u.includes('/public/')||u.endsWith('_finish')),false);
});
test('analysis handoff reuses queue contract but never executes; owner/rights/prior-stage gates stay explicit',()=>{
 const track={id,uid:owner,m_uid:owner,status:'draft',rights_status:'incomplete',master_bucket:'creator-masters',master_path:owner+'/workspace/master.wav',rights_declaration:{workspace_handoff:{id}}};
 let p=workspaceAnalysisHandoff({actorId:owner,creatorMUid:owner,track,stage:'analyze'});assert.ok(p.blockers.includes('Explicit analysis consent required'));assert.ok(p.blockers.includes('Creator rights attestation required'));
 assert.throws(()=>workspaceAnalysisHandoff({actorId:asset,creatorMUid:asset,track,stage:'analyze'}),/Creator-owned/);
 const base={actorId:owner,creatorMUid:owner,track:{...track,rights_status:'attested'},attestation:{track_id:id,creator_m_uid:owner,owns_master:true,collaborators_cleared:true},stage:'separate',consent:true,model:{stage:'separate',enabled:true,license_class:'approved_commercial',reviewed_at:'fixture'}};
 p=workspaceAnalysisHandoff(base);assert.ok(p.blockers.includes('Creator approval of prior stage required'));
 p=workspaceAnalysisHandoff({...base,parent:{track_id:id,creator_m_uid:owner,stage:'analyze',status:'approved'}});assert.equal(p.blockers.length,1);assert.equal(p.enqueue_allowed,false);assert.equal(p.provider_execution,false);assert.equal(p.existing_queue_rpc,'mcc_music_research_enqueue');
});
