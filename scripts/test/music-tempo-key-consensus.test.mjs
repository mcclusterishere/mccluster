import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {reconcileMusicTheory} from "../../js/resonance/tempo-key-consensus.mjs";

const v=(method,bpm,key,confidence=.88)=>({method,
  tempo:{bpm,confidence},key:{name:key,confidence}});

test("different independent beats in one octave family preserve the 2× ambiguity",()=>{
  const result=reconcileMusicTheory([
    v("neural",120,"C major",.92),v("onset",60,"C major",.79)
  ]);
  assert.equal(result.schema,"mcc.music.tempo-key-consensus.v1");
  assert.equal(result.tempo.bpm,120);
  assert.equal(result.tempo.halfDoubleTimeAmbiguous,true);
  assert.equal(result.key.name,"C major");
  assert.equal(result.requiresHumanCorrectionForNotation,true);
});

test("one isolated estimate does not masquerade as verified key or genre",()=>{
  const result=reconcileMusicTheory([v("chroma",128,"A minor",.78)]);
  assert.equal(result.key.name,null);
  assert.ok(result.key.candidates.length>=1);
  assert.equal(result.tempo.confidenceCalibrated,false);
  assert.doesNotMatch(JSON.stringify(result),/brain activation|dna enhancement|song makes you/i);
});

test("unrelated metrical estimates abstain rather than fabricate a precise BPM",()=>{
  const result=reconcileMusicTheory([
    v("strong_model",120,"A minor",.91),
    v("alternate_model",97,"C major",.88)
  ]);
  assert.equal(result.tempo.bpm,null);
  assert.match(result.tempo.reason,/disagree/);
  assert.equal(result.key.name,null);
});

test("enharmonic estimates agree but disagreements or zero input abstain",()=>{
  const result=reconcileMusicTheory([
    v("alpha",108,"C# major",.75),v("beta",109,"Db major",.71)
  ]);
  assert.equal(result.key.name,"C# major");
  const empty=reconcileMusicTheory([]);
  assert.equal(empty.key.name,null);assert.equal(empty.tempo.bpm,null);
  assert.throws(()=>reconcileMusicTheory([v("duplicate",120,"C major"),v("duplicate",120,"C major")]),/duplicate/);
});

test("optional Beat This and CQT are fully checkpoint-gated and model versioned",async()=>{
  const registry=JSON.parse(await readFile("config/music-research-models.v1.json","utf8"));
  const beat=registry.models.find(x=>x.id==="mcc_beat_this_reviewed_v1");
  assert.ok(beat);assert.equal(beat.enabled,false);
  const adapters=await readFile("scripts/research-engine/model-adapters.mjs","utf8");
  const python=await readFile("scripts/research-engine/beat_this_tempo.py","utf8");
  assert.match(adapters,/approvedCheckpoint/);
  assert.match(adapters,/tempo-key-consensus\.json/);
  assert.match(python,/File2Beats\(checkpoint_path=str\(checkpoint\.resolve\(\)\)/);
  assert.match(python,/hashlib\.file_digest/);
  assert.match(python,/estimated_not_verified/);
});
