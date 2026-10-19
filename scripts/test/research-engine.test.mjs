import test from "node:test";
import assert from "node:assert/strict";
import {readFile,access,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {fftPower,modes,analyzePcm,analyzeTrackouts,fieldAt,MODEL_VERSION} from "../../js/resonance/core.mjs";
import {estimateMusicTheory,chromaEstimate,tempoEstimate} from "../../js/resonance/theory.mjs";

const read=async p=>readFile(p,"utf8");
const SR=22050;
function oscillator(freq,seconds=5){
  const pcm=new Float32Array(Math.floor(SR*seconds));
  for(let i=0;i<pcm.length;i++)pcm[i]=.55*Math.sin(2*Math.PI*freq*i/SR);
  return pcm;
}
function beat(bpm,seconds=15){
  const pcm=new Float32Array(Math.floor(SR*seconds));
  const gap=Math.round(SR*60/bpm);
  for(let start=0;start<pcm.length;start+=gap){
    for(let i=0;i<Math.min(140,pcm.length-start);i++)
      pcm[start+i]=.70*(1-i/140)*Math.sin(2*Math.PI*350*i/SR);
  }
  return pcm;
}
function wav(pcm,sampleRate=SR){
  const data=Buffer.alloc(44+pcm.length*2);
  data.write("RIFF",0);data.writeUInt32LE(data.length-8,4);data.write("WAVE",8);
  data.write("fmt ",12);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);
  data.writeUInt16LE(1,22);data.writeUInt32LE(sampleRate,24);
  data.writeUInt32LE(sampleRate*2,28);data.writeUInt16LE(2,32);
  data.writeUInt16LE(16,34);data.write("data",36);data.writeUInt32LE(pcm.length*2,40);
  for(let i=0;i<pcm.length;i++)data.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(pcm[i]*32767))),44+i*2);
  return data;
}

test("membrane eigenmodes are deterministic and pinned to a declared physical model",()=>{
  assert.equal(MODEL_VERSION,"mcc-resonance-membrane-v1");
  const shape=modes();
  assert.equal(shape.length,25);
  assert.ok(Math.abs(shape[0].hz-77.782)<0.02);
  assert.equal(shape[0].m,1);assert.equal(shape[0].n,1);
  assert.ok(shape.every(m=>m.coupling>=0&&m.coupling<=1));
  assert.ok(Math.abs(fieldAt(0,.4,[1]))<1e-8,"fixed boundary must have a node");
  assert.ok(Math.abs(fieldAt(.5,.5,[1]))>0,"interior has nonzero displacement");
});

test("pure sine FFT resolves spectral peak, not a supposed gene or music note",()=>{
  const pcm=oscillator(440,1);
  const p=fftPower(pcm.subarray(0,8192),8192);
  let max=0,k=0;
  for(let i=1;i<p.length;i++)if(p[i]>max){max=p[i];k=i;}
  assert.ok(Math.abs(k*SR/8192-440)<SR/8192);
  const features=analyzePcm(pcm,SR,{maxFrames:5});
  assert.equal(features.schema,"mcc.resonance.analysis.v1");
  assert.ok(features.dominantModes.length>0);
  assert.match(features.interpretation,/not measured cymatics or DNA/);
});

test("rhythmic pulses create BPM hypotheses, silence does not",()=>{
  const p=tempoEstimate(beat(120),SR);
  assert.ok(p.candidates.length>=1);
  assert.ok(p.candidates.some(x=>Math.abs(x.bpm-120)<3),
    "120 BPM must appear among periodicity hypotheses even if a metrical octave wins");
  assert.match(p.reason,/ambiguity|may be/);
  const silent=tempoEstimate(new Float32Array(SR*7),SR);
  assert.equal(silent.bpm,null);
});

test("chroma and tempo metadata are explicitly estimates with confidence and uncertainty",()=>{
  const a=oscillator(440,3);
  const t=estimateMusicTheory(a,SR);
  assert.equal(t.status,"estimated_not_verified");
  assert.equal(t.key.chroma.length,12);
  assert.ok(t.key.confidence>=0&&t.key.confidence<=1);
  assert.equal(t.score.available,false);
  assert.equal(t.separation.available,false);
  assert.doesNotMatch(JSON.stringify(t),/activates .*gene/i);
  assert.equal(chromaEstimate(new Float32Array(SR*2),SR).name,null);
});

test("aligned trackouts retain individual analyses; cross-rate stems fail closed",()=>{
  const a=oscillator(220,2),b=oscillator(440,2);
  const r=analyzeTrackouts([{name:"bass",samples:a,sampleRate:SR},{name:"keys",samples:b,sampleRate:SR}],{maxFrames:3});
  assert.equal(r.stems.length,2);
  assert.match(r.combinedMeaning,/not a mastered mix/);
  assert.throws(()=>analyzeTrackouts([{samples:a,sampleRate:SR},{samples:b,sampleRate:48000}]),/aligned/);
});

test("offline WAV analyzer reports both modal field and estimated BPM/key schema",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"mcc-resonance-test-"));
  try{
    const file=join(dir,"fixture.wav");
    await writeFile(file,wav(beat(120,6)));
    const result=JSON.parse(execFileSync(process.execPath,
      ["scripts/music-resonance-analyze.mjs",file],{encoding:"utf8",timeout:25000}));
    assert.equal(result.schema,"mcc.resonance.analysis.v1");
    assert.equal(result.musicTheory.schema,"mcc.music-theory.estimated.v1");
    assert.equal(result.pipeline.originalMix,false);
    assert.equal(result.pipeline.autonomousGeneClaim,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("underwater prototype remains quarantined, keeps canonical transport, and exposes research caveats",async()=>{
  const page=await read("_unfinished/research-world/index.html");
  const world=await read("js/resonance/world.mjs");
  const publish=await read(".github/workflows/deploy-pages.yml");
  assert.match(page,/<base href="\.\.\/\.\.\/">/);
  assert.match(page,/js\/tabbar\.js/);
  assert.match(page,/js\/music-engine\.js/);
  assert.match(page,/id="rwWaterView"/);
  assert.match(page,/Selecting one <strong>does not activate it<\/strong>/);
  assert.match(world,/engine\.play\(/);
  assert.doesNotMatch(world,/new (?:Audio|AudioBufferSourceNode)\(/);
  assert.match(publish,/rm -rf [^\n]*_unfinished/);
  await assert.rejects(access("resonance-world.html"),/ENOENT/);
});

test("brain research is literature-anchored without brain targeting or medical data collection",async()=>{
  const atlas=JSON.parse(await read("data/research/music-brain-networks.json"));
  assert.equal(atlas.regions.length,6);
  for(const region of atlas.regions){
    assert.match(region.source.url,/^https:\/\//);
    assert.ok(region.evidence.length>55);
  }
  assert.match(atlas.disclaimer,/NOT activate/);
  const source=await read("js/resonance/world.mjs");
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/);
  const app=await read("creator.html");
  const uploaded=await read("js/music-creator-studio.js");
  assert.match(app,/creatorResearchResult/);
  assert.match(uploaded,/if \(window\.MCC_TRACK\) window\.MCC_TRACK\("creator_track_submitted"/);
  assert.match(uploaded,/import\("\.\/resonance\/upload-hook\.mjs"\)/);
});

test("advanced stem and sheet-scoring processes cannot execute without explicit authorization",async()=>{
  const script=await read("scripts/research-engine/derive-stems-score.py");
  assert.match(script,/args\.execute and not args\.rights_confirmed/);
  assert.match(script,/args\.execute and args\.separate and not args\.allow_model_download/);
  assert.match(script,/shell=False/);
  assert.match(script,/human_review_required/);
});

test("research families use measured acoustic features, not mood or implied neural activation",async()=>{
  const {scientificTrackIndex,explainRegion}=await import("../../js/resonance/associations.mjs");
  const signal=analyzePcm(oscillator(110,3),SR,{maxFrames:5});
  const theory=estimateMusicTheory(oscillator(110,3),SR);
  const classified=scientificTrackIndex(signal,theory);
  assert.equal(classified.schema,"mcc.research.scientific-track-index.v1");
  assert.ok(classified.tags.some(t=>t.family==="modeled-resonance"));
  assert.ok(classified.tags.some(t=>t.family==="spectral-distribution"));
  assert.ok(classified.tags.every(t=>["measured-audio","modeled","estimated-model","insufficient-evidence"].includes(t.evidence)));
  assert.doesNotMatch(JSON.stringify(classified),/listener.?s (mood|personality)|dopamine release|dna activation/i);
  const reward=explainRegion("reward",signal,theory);
  assert.equal(reward.status,"not-measured");
  assert.match(reward.caveat,/No audio-only features establish enjoyment/);
  const rhythmic=explainRegion("rhythm",signal,theory);
  assert.match(rhythmic.claim,/no brain activation/);
  const world=await read("js/resonance/world.mjs");
  const markup=await read("_unfinished/research-world/index.html");
  assert.match(world,/scientificTrackIndex/);
  assert.match(world,/explainRegion/);
  assert.match(world,/origin==="random_one_time_opt_in"\?"system_opt_in":"user"/);
  assert.ok(world.includes('album.slug+"|"+track.title'),"album-and-title key disambiguates same-named tracks");
  assert.match(world,/state\.analysisId!==sourceId/,"discard stale decoded audio");
  assert.match(world,/!track\.gated/,"opt-in shuffle may not select gated tracks");
  assert.match(world,/const results=await Promise\.allSettled/,"playback failures are reported independently of analysis");

  assert.match(markup,/rwRegionAcoustic/);
  assert.match(markup,/rwScientificClasses/);
});

test("science-first catalogue refuses gated audio, unsafe sources, and invented measurements",async()=>{
  const {eligibleTrack,buildIndex}=await import("../research-engine/build-science-catalogue.mjs");
  const album={slug:"here"};
  assert.equal(eligibleTrack(album,{title:"Public",src:"assets/audio/public.mp3"}),true);
  assert.equal(eligibleTrack(album,{title:"Protected",src:"assets/audio/master.mp3",gated:{bucket:"private"}}),false);
  assert.equal(eligibleTrack(album,{title:"Unsafe",src:"../private/master.mp3"}),false);
  assert.equal(eligibleTrack(album,{title:"External",src:"https://elsewhere.test/music.mp3"}),false);
  const plan=await buildIndex({dryRun:true,maxTracks:2});
  assert.equal(plan.schema,"mcc.research.catalogue-index.v1");
  assert.equal(plan.tracks.length,0,"a dry run must not invent analysis");
  assert.ok(plan.eligible.length<=2);
  assert.match(plan.caveat,/No genre, mood, DNA activation/);
});

test("music-first media graph requires provenance, rights, explicit audio linkage and honest autoplay evidence",async()=>{
  const {validateMusicMediaRelation,researchAllowedForAsset,playbackSelectionEvidence}=
    await import("../../js/resonance/media-graph.mjs");
  const media={mediaId:"asset_123",mediaKind:"video",
    producer:{kind:"approved_agent",id:"agent_mcc"},
    rights:{status:"pending_rights",ownerId:"creator_A"},
    provenance:{agentRunId:"run_123",transform:"visualize"},
    audioRelation:{kind:"track",trackId:"track_public"}};
  const valid=validateMusicMediaRelation(media);
  assert.equal(valid.audioRelation.trackId,"track_public");
  assert.equal(researchAllowedForAsset(valid,{researchOptIn:true}).analysisPermitted,false);
  assert.equal(researchAllowedForAsset({...media,rights:{status:"approved",ownerId:"creator_A"}},{researchOptIn:true}).analysisPermitted,true);
  assert.throws(()=>validateMusicMediaRelation({...media,audioRelation:null}),/declare its relationship/);
  assert.throws(()=>validateMusicMediaRelation({...media,audioRelation:{kind:"track",trackId:"x",masterUrl:"signed-secret"}}),/signed media URLs/);
  assert.throws(()=>validateMusicMediaRelation({...media,provenance:null}),/attributable run ID/);
  assert.throws(()=>validateMusicMediaRelation({...media,subjectDna:"GCTA"}),/personal DNA/);
  const queued=playbackSelectionEvidence("system_queue",{affirmativePreference:true});
  assert.equal(queued.inferPreference,false);
  assert.equal(queued.needsGesture,true);
  const chosen=playbackSelectionEvidence("user_selected");
  assert.equal(chosen.inferPreference,false,"one play is not a stable preference");
  assert.equal(chosen.inferBrainActivity,false);
});
