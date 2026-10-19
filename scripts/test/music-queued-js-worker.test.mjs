import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {modelApproved,adapterCommand} from "../research-engine/model-adapters.mjs";
import {assertClaim,processOnce,MusicResearchClient} from "../research-engine/music-job-worker.mjs";

const read=p=>readFile(p,"utf8");
const manifest=JSON.parse(await read("config/music-research-models.v1.json"));
const token="00000000-0000-4000-8000-000000000001";
const creator="00000000-0000-4000-8000-000000000002";
const jobId="00000000-0000-4000-8000-000000000003";
const fakeJob=()=>({job_id:jobId,creator_m_uid:creator,lease_token:token,
  stage:"analyze",model_id:"mcc_spectral_v1",
  source_objects:[{bucket:"creator-masters",path:"creator/demo.wav",kind:"master"}]});
const sha=x=>createHash("sha256").update(x).digest("hex");

test("model registry fails closed on unlicensed or disabled model weights",()=>{
  assert.equal(modelApproved(manifest,"mcc_spectral_v1","analyze").adapter,"first_party_fft");
  for(const m of manifest.models.filter(x=>!x.enabled)) {
    assert.throws(()=>modelApproved(manifest,m.id,m.stage),/not licensed/);
  }
  const forged=structuredClone(manifest);
  forged.models.find(m=>m.id==="mcc_muscriptor_research_only").enabled=true;
  assert.throws(()=>modelApproved(forged,"mcc_muscriptor_research_only","transcribe"),/not licensed/);
});

test("one allowlisted native analysis command without shell or implicit model download",async()=>{
  const m=modelApproved(manifest,"mcc_spectral_v1","analyze");
  const cmds=adapterCommand(m,"analyze",["/tmp/input.wav"],"/tmp/output");
  assert.equal(cmds.length,1);assert.equal(cmds[0].exe,process.execPath);
  assert.ok(cmds[0].args.includes("/tmp/input.wav"));
  const code=await read("scripts/research-engine/model-adapters.mjs");
  assert.doesNotMatch(code,/shell:\s*true|--download_model_only/);
  assert.match(code,/HF_HUB_OFFLINE/);
});

test("forged or overbroad PGMQ claims cannot be run",()=>{
  assert.equal(assertClaim(fakeJob()).stage,"analyze");
  assert.throws(()=>assertClaim({...fakeJob(),lease_token:"invalid"}),/invalid leased/);
  assert.throws(()=>assertClaim({...fakeJob(),source_objects:Array(40).fill({})}),/invalid leased/);
  assert.throws(()=>assertClaim({...fakeJob(),stage:"publish"}),/invalid leased/);
});

test("service-side client requires HTTPS and denies arbitrary RPCs",async()=>{
  assert.throws(()=>new MusicResearchClient({url:"http://localhost:54321",serviceKey:"x".repeat(40)}),/HTTPS/);
  const api=new MusicResearchClient({url:"https://example.supabase.co",
    serviceKey:"service-role-secret-xxxxxxxxxxxxxxxxxxx",
    fetcher:async()=>({ok:true,json:async()=>[]})});
  await assert.rejects(api.callRpc("delete_anything",{}),/allowlisted/);
});

test("one leased analysis uploads a private, reviewed-only artifact and never auto-publishes",async()=>{
  const uploaded=[],finished=[],failed=[];
  const client={
    claim:async()=>fakeJob(),heartbeat:async()=>true,
    fetchPrivate:async()=>Buffer.from("signed private source"),
    uploadPrivate:async(path,bytes,type)=>uploaded.push({path,bytes,type}),
    finish:async(j,result,items)=>{finished.push({j,result,items});return true;},
    fail:async(...x)=>failed.push(x)
  };
  const result=await processOnce(client,{registry:manifest,leaseSeconds:600,
    stageRunner:async(j,registry,inputs,out)=>{
      const bytes=Buffer.from('{"features":{"lowBandFraction":0.25}}');
      const file=join(out,"acoustic-features.json");
      await writeFile(file,bytes);
      return {modelVersion:"1",artifacts:[{file,name:"acoustic-features.json",kind:"features",
        sha256:sha(bytes),byteSize:bytes.length}]};
    }});
  assert.deepEqual(result,{status:"awaiting_review",stage:"analyze",artifactCount:1});
  assert.equal(failed.length,0);assert.equal(uploaded.length,1);assert.equal(finished.length,1);
  assert.match(uploaded[0].path,new RegExp("^research/"+creator+"/"+jobId+"/"));
  assert.equal(uploaded[0].type,"application/json");
  assert.equal(finished[0].result.noAutomaticPublication,true);
  assert.equal(finished[0].items[0].checksum_sha256,sha(uploaded[0].bytes));
});

test("failed adapter never approves or publishes a job",async()=>{
  let finished=0,failed=0;
  const client={claim:async()=>fakeJob(),heartbeat:async()=>true,
    fetchPrivate:async()=>Buffer.from("source"),
    finish:async()=>{finished++;return true;},
    fail:async()=>{failed++;return "queued";}};
  const r=await processOnce(client,{registry:manifest,
    stageRunner:async()=>{throw Error("test adapter failure");}});
  assert.equal(r.status,"failed");assert.equal(finished,0);assert.equal(failed,1);
});

test("persistent player delegates to exactly one Music instance and remains unpublished",async()=>{
  const page=await read("_unfinished/music-runtime/index.html");
  const player=await read("js/music-engine.js");
  const shell=await read("js/music-runtime-shell.js");
  const publish=await read(".github/workflows/deploy-pages.yml");
  assert.match(page,/data-mcc-single-music-engine/);
  assert.match(shell,/engine=root\.MCC_MUSIC/);
  assert.match(player,/root\.MCC_MUSIC = root\.parent\.MCC_MUSIC/);
  assert.equal((player.match(/new Audio\(\)/g)||[]).length,1);
  assert.match(publish,/rm -rf[^\n]*_unfinished/);
});

test("creator preview stays behind RLS, rights checks, commercial models and explicit review",async()=>{
  const sql=await read("supabase/pending/music_research_pipeline_v1.sql");
  const review=await read("js/music-research-review.mjs");
  const studio=await read("js/music-creator-studio.js");
  const html=await read("creator.html");
  for(const rule of [/PENDING APPROVAL ONLY/,/music_research_artifact_owner_download/,
    /mcc_music_research_review/,/mcc_music_research_claim/,
    /license_class in \('first_party','approved_commercial'\)/,
    /music_research_approved_model_read/]) assert.match(sql,rule);
  assert.match(html,/id="researchQueueOptIn"/);
  assert.match(studio,/researchQueueOptIn\) \{/);
  assert.match(review,/createSignedUrl\(artifact\.object_path,60/);
  assert.match(review,/awaiting_review/);
  assert.doesNotMatch(review,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
