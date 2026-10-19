import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {spawnSync} from "node:child_process";

const read=path=>readFileSync(path,"utf8");
const SQL=()=>read("supabase/pending/music_research_pipeline_v1.sql");
const PY=()=>read("scripts/research-engine/queued_worker.py");
const SHELL=()=>read("js/music-runtime-shell.js");
const HTML=()=>read("_unfinished/music-runtime/index.html");

test("canonical Music transport remains the only player in embedded rooms",()=>{
 const engine=read("js/music-engine.js"),shell=SHELL(),home=HTML();
 assert.ok(engine.indexOf('data-mcc-single-music-engine')>-1);
 assert.ok(engine.indexOf('data-mcc-single-music-engine')<engine.indexOf("var audio = new Audio()"),
   "embed handoff must prevent constructing the second Audio element");
 assert.match(home,/js\/music-engine\.js/);
 assert.match(home,/id="mccStage"/);
 assert.match(home,/data-mcc-single-music-engine/);
 assert.match(shell,/MCC_MUSIC/);
 assert.doesNotMatch(shell,/new\s+Audio\s*\(/);
 assert.match(shell,/frame\.src=pathFor\(page\)/);
 assert.match(shell,/event\.preventDefault\(\)/);
 assert.match(home,/research-jobs\.html/);
 assert.match(shell,/research-jobs\.html/);
 assert.match(home,/js\/mcc-auth\.js/);
 const deploy=read(".github/workflows/deploy-pages.yml");
 assert.match(deploy,/rm -rf[^\n]*_unfinished/,"private shell stays out of public deploys");
 assert.doesNotMatch(home,/autoplay\s*=\s*["']true/);
});

test("secure queue SQL uses durable PGMQ, unique dedupe, lease fencing and explicit transition stages",()=>{
 const sql=SQL();
 assert.match(sql,/create extension if not exists pgmq/);
 assert.match(sql,/pgmq\.create\('mcc_music_research_v1'\)/);
 assert.match(sql,/pgmq\.send\('mcc_music_research_v1'/);
 assert.match(sql,/pgmq\.read\('mcc_music_research_v1'/);
 assert.match(sql,/pgmq\.archive\('mcc_music_research_v1'/);
 assert.match(sql,/pgmq\.set_vt\('mcc_music_research_v1'/);
 assert.match(sql,/unique\(creator_m_uid,track_id,stage,idempotency_key\)/);
 assert.match(sql,/lease_token uuid/);
 assert.match(sql,/leased_until timestamptz/);
 assert.match(sql,/v_job\.lease_token is distinct from p_token/);
 assert.match(sql,/leased_until<=now\(\)/);
 assert.match(sql,/mcc_music_research_heartbeat/);
 for(const s of ["analyze","separate","transcribe","engrave"]){
   assert.match(sql,new RegExp("'"+s+"'"));
 }
 assert.match(sql,/case p_stage when 'analyze' then null when 'separate' then 'analyze'/);
 assert.match(sql,/and j\.status='approved'/);
 assert.match(sql,/status='awaiting_review'/);
 assert.doesNotMatch(sql,/music_research_artifacts[\s\S]{0,350}public\s*=\s*true/);
});

test("models are disabled until commercial license, human approval, weight pin and checksum",()=>{
 const sql=SQL(),worker=PY(),manifest=JSON.parse(read("scripts/research-engine/models.approval-example.json"));
 assert.match(sql,/license_class in \('first_party','approved_commercial'\)/);
 assert.match(sql,/checkpoint_sha256 is not null/);
 assert.match(sql,/approval_reference is not null/);
 assert.match(sql,/model not commercially approved/);
 assert.match(worker,/license_class/);
 assert.match(worker,/checkpoint_sha256/);
 assert.match(worker,/hashlib\.file_digest/);
 assert.match(worker,/--model_filename/);
 assert.match(worker,/--model-path/);
 assert.match(worker,/defusedxml/);
 assert.match(worker,/temporary_transport_error/);
 assert.equal(manifest.models.mcc_spectral_v1.enabled,true);
 for(const [name,model] of Object.entries(manifest.models)){
   if(name!=="mcc_spectral_v1"){
     assert.equal(model.enabled,false);
     assert.notEqual(model.license_class,"approved_commercial");
   }
 }
});

test("every research table and privileged RPC has explicit access controls",()=>{
 const sql=SQL();
 for(const t of ["music_research_models","music_research_jobs","music_research_artifacts","music_research_reviews"]){
   assert.match(sql,new RegExp("alter table public\\."+t+" enable row level security"));
 }
 assert.match(sql,/music_research_creator_artifact_read on storage\.objects/);
 assert.match(sql,/a\.creator_m_uid=public\.current_m_uid\(\)/);
 assert.match(sql,/creator_m_uid=public\.current_m_uid\(\)/);
 assert.match(sql,/auth\.uid\(\) is null/);
 assert.match(sql,/exists\(select 1 from public\.music_rights_attestations/);
 assert.match(sql,/master_bucket='creator-masters'/);
 assert.match(sql,/source_objects jsonb/);
 assert.match(sql,/revoke all on function public\.mcc_music_research_enqueue/);
 assert.match(sql,/mcc_music_research_review\(uuid,text,text\)/);
 assert.match(sql,/to authenticated;/);
 assert.match(sql,/to service_role;/);
 assert.doesNotMatch(sql,/grant\s+(?:all|execute)\s+on\s+(?:table|function)[^;]+to\s+anon\s*;/i);
 assert.match(sql,/values\('creator-research-outputs','creator-research-outputs',false/);
});

test("creator must consent to each stage and review private results",()=>{
 const client=read("js/music-research-queue.mjs");
 const html=read("_unfinished/music-runtime/research-jobs.html");
 assert.match(client,/refreshIfNeeded/);
 assert.match(client,/window\.MCC\.mUid\(\)/);
 assert.match(client,/creator_tracks\?m_uid=eq\./);
 assert.match(client,/mcc_music_research_available_models/);
 assert.match(client,/mcc_music_research_enqueue/);
 assert.match(client,/mcc_music_research_review/);
 assert.match(client,/mcc_music_research_cancel/);
 assert.match(client,/storage\/v1\/object\/sign\/creator-research-outputs/);
 assert.match(client,/expiresIn:120/);
 assert.match(html,/mrResearchConsent/);
 assert.match(html,/ONLY YOU CAN APPROVE/);
 assert.doesNotMatch(client,/(?:sb_secret_|SUPABASE_SERVICE_ROLE_KEY)/);
});

test("backend includes optional improved tempo/key benchmarking with abstention and reference metrics",()=>{
 const py=read("scripts/research-engine/tempo_key.py");
 const bench=read("scripts/research-engine/benchmark_tempo_key.py");
 assert.match(py,/librosa\.effects\.harmonic/);
 assert.match(py,/librosa\.feature\.chroma_cqt/);
 assert.match(py,/librosa\.beat\.beat_track/);
 assert.match(py,/candidates_bpm/);
 assert.match(py,/confidence/);
 assert.match(py,/status":"abstained"/);
 assert.match(bench,/octave_aware_4pct/);
 assert.match(bench,/mirex_weighted/);
 assert.match(bench,/bpm_covered/);
 assert.match(bench,/predictions/);
 const scripts=["tempo_key.py","queued_worker.py","benchmark_tempo_key.py"];
 for(const file of scripts){
   const out=spawnSync("python3",["-c","import ast,sys;ast.parse(open(sys.argv[1]).read())",
     "scripts/research-engine/"+file],{encoding:"utf8",timeout:8000});
   assert.equal(out.status,0,out.stderr);
 }
});

test("queue branch is staged: no schema apply, no public music upload, no runtime deployments",()=>{
 assert.equal(existsSync("supabase/pending/music_research_pipeline_v1.sql"),true);
 assert.equal(existsSync("_unfinished/music-runtime/index.html"),true);
 assert.equal(existsSync("music-runtime.html"),false);
 assert.doesNotMatch(read("js/music-runtime-shell.js"),/localStorage\.setItem|sessionStorage\.setItem|supabase.*service_role/i);
 assert.match(read("scripts/research-engine/queued_worker.py"),/--once/);
 assert.match(read("scripts/research-engine/queued_worker.py"),/mcc_music_research_claim/);
 assert.match(read("scripts/research-engine/queued_worker.py"),/mcc_music_research_finish/);
 assert.match(read("scripts/research-engine/queued_worker.py"),/mcc_music_research_fail/);
});
