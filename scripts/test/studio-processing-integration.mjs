// Synthetic upload → actual queue/cost SQL → local native executor → ready/approval/publication.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {studioProcessingFixture} from '../../workers/mccluster/test/support/studio-processing-fixture.mjs';
import {executeStudioTask} from '../../core/src/website-studio/executor.mjs';
import {A,B} from '../../workers/mccluster/test/support/project-tiles-fixture.mjs';
const f=await studioProcessingFixture();
const task=async id=>(await f.sql.query("select input from ops_compute_tasks where input->>'asset_id'=$1 order by created_at desc limit 1",[id])).rows[0].input;
async function upload(kind,file){const bytes=await readFile(new URL('../e2e/fixtures/front-media/'+file,import.meta.url));const r=await f.mediaCall('/uploads','POST',{bytes:bytes.length,rights_confirmed:true,settings:{kind}});assert.equal(r.status,200,JSON.stringify(r));await f.fetcher(r.body.upload_url,{method:'PUT',body:bytes});return r.body.asset_id;}
try{
 const ready=await f.mediaCall('/assets');assert.equal(ready.body.processing.can_prepare,true);assert.equal(ready.body.processing.executor_status,'not_verified');
 const ids=[];
 for(const [kind,file] of [['music','beat.wav'],['native_video','film.webm'],['immersive360','room360.jpg']]){
  const id=await upload(kind,file);ids.push(id);
  assert.equal((await f.mediaCall('/assets/'+id+'/approve','POST',{public_approved:true})).status,409);
  assert.equal((await f.mediaCall('/assets/'+id+'/complete','POST',{},'fixture-bob')).status,404);
  const queued=await f.mediaCall('/assets/'+id+'/complete','POST',{});assert.equal(queued.status,200,JSON.stringify(queued));
  assert.equal(JSON.stringify(queued.body).includes('ticket'),false);
  const duplicate=await f.mediaCall('/assets/'+id+'/complete','POST',{});assert.equal(duplicate.body.job_id,queued.body.job_id);
  const input=await task(id);assert.equal((await f.mediaCall('/processor/'+id,'GET',undefined,'0'.repeat(64))).status,403);
  await executeStudioTask(input,{fetcher:f.fetcher});
  assert.equal((await f.mediaCall('/processor/'+id,'GET',undefined,input.ticket)).status,403,'finished capability revoked');
  const state=(await f.db.select('creator_site_media_state',{asset_id:'eq.'+id}))[0];assert.equal(state.state,'ready');assert.ok(state.output_manifest.files.length);assert.equal(state.public_approved,false);
 }
 assert.equal((await f.sql.query('select count(*)::int as n from media_cost_events')).rows[0].n,3,'duplicates reserve once');
 const doc=(await f.call('/templates')).body.templates[0].definition;doc.tiles.forEach((t,i)=>{t.source_ref={type:'media_asset',key:ids[i]};});
 await f.call('','PUT',{expected_revision:0,document:doc});
 const org='33333333-3333-4333-8333-333333333333';assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:org})).status,409);
 for(const id of ids)assert.equal((await f.mediaCall('/assets/'+id+'/approve','POST',{public_approved:true})).status,200);
 assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:org})).status,200);assert.equal((await f.call('/public','GET',null,null)).status,200);
 // Retained invalid source fails processing and is explicitly retryable, without inventing refunds.
 const bad=await upload('music','notround.jpg');await f.mediaCall('/assets/'+bad+'/complete','POST',{});const badTask=await task(bad);await assert.rejects(()=>executeStudioTask(badTask,{fetcher:f.fetcher}));
 assert.equal((await f.mediaCall('/assets')).body.assets.find(a=>a.asset_id===bad).retryable,true);
 assert.equal((await f.mediaCall('/assets/'+bad+'/complete','POST',{})).status,200,'explicit failed retry');
 const retryTask=await task(bad);assert.notEqual(retryTask.ticket,badTask.ticket);
 await f.sql.query("update creator_site_media_state set ticket_expires_at=now()-interval '1 second' where asset_id=$1",[bad]);
 assert.equal((await f.mediaCall('/assets')).body.assets.find(a=>a.asset_id===bad).retryable,true);
 assert.equal((await f.mediaCall('/assets/'+bad+'/complete','POST',{})).status,200,'expired capability can be retried');
 assert.equal((await f.mediaCall('/processor/'+bad,'GET',undefined,retryTask.ticket)).status,403);
 assert.equal((await f.sql.query("select count(*)::int n from ops_compute_tasks where status='canceled'")).rows[0].n,1);
 f.env.WEBSITE_STUDIO_PROCESSOR_ENABLED='false';assert.equal((await f.mediaCall('/assets')).body.processing.can_prepare,false);assert.equal((await f.mediaCall('/assets/'+bad+'/complete','POST',{})).status,503);
 f.env.WEBSITE_STUDIO_PROCESSOR_ENABLED='true';await f.sql.query('update creator_site_access set preparation_budget_microusd=0 where owner_m_uid=$1',[A]);assert.equal((await f.mediaCall('/assets')).body.processing.can_prepare,false);
 const retained=await upload('music','beat.wav');const countBefore=(await f.sql.query('select count(*)::int n from media_jobs')).rows[0].n;assert.equal((await f.mediaCall('/assets/'+retained+'/complete','POST',{})).status,409);assert.equal((await f.sql.query('select count(*)::int n from media_jobs')).rows[0].n,countBefore,'no allowance means no new job');
 await f.sql.query('update creator_site_access set preparation_budget_microusd=10000 where owner_m_uid=$1',[A]);await f.sql.exec('update media_models set enabled=false');assert.equal((await f.mediaCall('/assets')).body.processing.can_prepare,false);assert.equal((await f.mediaCall('/assets/'+retained+'/complete','POST',{})).status,409);
 assert.equal((await f.mediaCall('/assets','GET',undefined,'fixture-bob')).body.assets.length,0);
 console.log('PASS upload→canonical job/reservation→actual FFmpeg→ready→approve→publish; owner isolation, duplicate completion, ticket replay, failure/expired retry, disabled/allowance gates');
}finally{await f.close();}
