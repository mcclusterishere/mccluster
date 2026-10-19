import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  fftPower, modes, fieldAt, analyzePcm, analyzeTrackouts, MODEL_VERSION
} from "../../js/resonance/core.mjs";

const SR = 8192;
const sine = (hz = 78, seconds = 2, phase = 0) => Float32Array.from(
  {length:SR * seconds}, (_,i) => Math.sin(2 * Math.PI * hz * i / SR + phase) * 0.35
);

test("membrane modes are analytic, fixed-edge, deterministic and distinct from DNA", () => {
  const shape = modes();
  assert.equal(shape.length, 25);
  assert.equal(shape[0].m, 1); assert.equal(shape[0].n, 1);
  assert.ok(Math.abs(shape[0].hz - 110*Math.SQRT2/2)<0.01);
  assert.equal(fieldAt(0, 0.5, new Array(shape.length).fill(1)), 0);
  assert.equal(fieldAt(0.5, 0, new Array(shape.length).fill(1)), 0);
  assert.equal(modes()[0].hz, shape[0].hz);
});

test("FFT detects a sinusoid at its spectral frequency without inventing a musical fundamental", () => {
  const sample=sine(78);
  const power=fftPower(sample.subarray(0,2048),2048);
  const k=power.indexOf(Math.max(...power));
  assert.ok(Math.abs(k*SR/2048-78)<=4);
  const a=analyzePcm(sample,SR,{fftSize:2048,maxFrames:9});
  assert.equal(a.model,MODEL_VERSION);
  assert.match(a.interpretation,/not measured cymatics or DNA response/);
  assert.ok(Math.abs(a.frames[0].peakHz-78)<=4);
  assert.ok(a.frames.length >= 1 && a.frames.length <= 9, 'maxFrames is an upper limit, not a required frame count');
  assert.ok(a.features.lowBandFraction>.95);
  assert.equal(a.dominantModes[0].m,1);
  assert.equal(a.dominantModes[0].n,1);
});

test("silence cannot generate an invented auditory resonance",()=>{
  const a=analyzePcm(new Float32Array(SR),SR,{maxFrames:5});
  assert.equal(a.features.rms,0);
  assert.equal(a.frames[0].peakHz,0);
  assert.ok(a.frames.every(f=>f.weights.every(w=>w===0)));
});

test("stem reconstruction uses aligned PCM phase, not naive magnitude addition",()=>{
  const a=sine(78), b=Float32Array.from(a,x=>-x);
  const result=analyzeTrackouts([
    {name:"drums.wav",samples:a,sampleRate:SR},
    {name:"bass.wav",samples:b,sampleRate:SR}
  ],{maxFrames:5});
  assert.equal(result.schema,"mcc.resonance.trackouts.v1");
  assert.equal(result.stems.length,2);
  assert.ok(result.stems[0].analysis.features.rms>0.1);
  assert.ok(result.combined.features.rms<0.00001, "phase-cancelled stems must cancel");
  assert.match(result.combinedMeaning,/not a mastered mix/);
  assert.throws(()=>analyzeTrackouts([
    {name:"a",samples:a,sampleRate:SR},
    {name:"b",samples:b,sampleRate:44100}
  ]),/aligned to a common sample rate/);
});

test("inputs are bounded and FFT rejects non-power-of-two windows",()=>{
  assert.throws(()=>fftPower(sine().subarray(0,100),1500),/power of two/);
  assert.throws(()=>analyzePcm([1,2,3],SR),/PCM/);
  assert.throws(()=>analyzePcm(new Float32Array(2048),1000),/sample rate/);
  assert.throws(()=>analyzeTrackouts([]),/1–32 stems/);
});

function wav16(samples,rate) {
  const b=Buffer.alloc(44+samples.length*2);
  b.write("RIFF",0);b.writeUInt32LE(b.length-8,4);b.write("WAVE",8);
  b.write("fmt ",12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);
  b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write("data",36);b.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++) b.writeInt16LE(Math.round(Math.min(1,Math.max(-1,samples[i]))*32767),44+i*2);
  return b;
}

test("actual offline Node job reads a WAV and produces feature-only JSON; no raw audio",()=>{
  const folder=mkdtempSync(join(tmpdir(),"mcc-resonance-"));
  try {
    const path=join(folder,"synthetic.wav");
    writeFileSync(path,wav16(sine(78,1),SR));
    const out=spawnSync(process.execPath,["scripts/music-resonance-analyze.mjs",path],{
      encoding:"utf8",timeout:20000,maxBuffer:4*1024*1024
    });
    assert.equal(out.status,0,out.stderr);
    const data=JSON.parse(out.stdout);
    assert.equal(data.pipeline.kind,"offline-audio-analysis");
    assert.equal(data.input[0].sampleRate,SR);
    assert.ok(data.features.lowBandFraction>.9);
    assert.equal(data.samples,undefined,"do not return PCM samples");
    assert.ok(data.frames.length>1);
  } finally {rmSync(folder,{recursive:true,force:true});}
});

test("public research page cites literature, places equation first and retains canonical appbar",()=>{
  const html=readFileSync("resonance.html","utf8");
  const listen=readFileSync("listen.html","utf8");
  const engine=readFileSync("js/music-engine.js","utf8");
  const ui=readFileSync("js/resonance/atlas-ui.mjs","utf8");
  const doc=readFileSync("docs/research/MCCLUSTER-RESONANCE-ATLAS-V1.md","utf8");
  assert.ok(html.indexOf("rs-formula")<html.indexOf("id=\"resonanceLab\""));
  assert.match(html,/A<sub>k<\/sub>\(t\)/);
  assert.match(html,/js\/tabbar\.js/);
  assert.match(listen,/href="resonance\.html"/);
  assert.match(html,/10\.7717\/peerj\.830/);
  assert.match(html,/10\.1103\/PhysRevE\.52\.R4606/);
  assert.match(html,/not a photograph of a Chladni plate/);
  assert.match(doc,/GSE48624 was withdrawn/);
  assert.match(doc,/non-commercial research/);
  assert.match(ui,/window\.MCC_MUSIC/);
  assert.doesNotMatch(ui,/\bnew Audio\s*\(|\bnew Audio\(/);
  assert.match(ui,/gated \|\| !track\.src/);
  assert.match(engine,/selection_origin: origin/);
  assert.match(engine,/system_opt_in/);
  assert.match(doc,/algorithm-selected exposure never equals listener preference/i);
});

test("research modes stay reproducible for repeat audio inputs",()=>{
  const samples=sine(180,2);
  const a=analyzePcm(samples,SR,{maxFrames:4});
  const b=analyzePcm(samples,SR,{maxFrames:4});
  assert.deepEqual(a,b);
});
