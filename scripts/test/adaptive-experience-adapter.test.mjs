import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('MCC_MODEL keeps its synchronous public API while preferring recorded decisions',async()=>{
  const [analytics,adapter]=await Promise.all([read('js/analytics.js'),read('js/mcc-model-adapter.js')]);
  assert.match(analytics,/profile: profile, suggest: suggest, shown: shown/);
  assert.match(analytics,/js\/experience\.js/);
  assert.match(analytics,/js\/mcc-model-adapter\.js/);
  assert.match(analytics,/js\/adaptive-surfaces\.js/);
  assert.match(adapter,/var legacy=root\.MCC_MODEL/);
  assert.match(adapter,/adapted\.suggest=suggest/);
  assert.match(adapter,/adapted\.shown=shown/);
  assert.match(adapter,/adapted\.profile=profile/);
  assert.match(adapter,/root\.MCC_EXPERIENCE\.decide\(surface/);
  assert.match(adapter,/return fallback;/);
  assert.match(adapter,/__legacy=legacy/);
});

test('compatibility adapter fails open to the legacy on-device model',async()=>{
  const adapter=await read('js/mcc-model-adapter.js');
  assert.match(adapter,/if\(!root\.MCC_MODEL \|\| !root\.MCC_EXPERIENCE/);
  assert.match(adapter,/catch\(function\(\)\{return null;\}\)/);
  assert.match(adapter,/var fallback=legacy\.suggest\(\)/);
  assert.doesNotMatch(adapter,/localStorage\.removeItem\("mcc_model_v1"\)/);
});

test('first three surfaces use the ExperienceDecision API and do not reorder DOM',async()=>{
  const js=await read('js/adaptive-surfaces.js');
  for(const surface of ['global.for_you','music.next_step','action.next_step']){
    assert.ok(js.includes(surface),surface+' must be instrumented');
  }
  assert.match(js,/MCC_EXPERIENCE\.decide\(surface,candidates/);
  assert.match(js,/MCC_EXPERIENCE\.impression/);
  assert.match(js,/MCC_EXPERIENCE\.visible/);
  assert.match(js,/MCC_EXPERIENCE\.interact/);
  assert.doesNotMatch(js,/appendChild\(entry\.el\)|insertBefore\(entry\.el\)|replaceChildren/);
  assert.doesNotMatch(js,/style\.order|sort\(function.*entry/);
});

test('music and Action surfaces derive candidates from real interactive elements',async()=>{
  const js=await read('js/adaptive-surfaces.js');
  assert.match(js,/#tracks li\[data-title\]/);
  assert.match(js,/\[data-music-play\]\[data-track\]/);
  assert.match(js,/\[data-mission\]/);
  assert.match(js,/\[data-open-mission\]/);
  assert.match(js,/\[data-take-mission\]/);
});

test('global For You keeps legacy choice first so evidence collection is behavior-neutral',async()=>{
  const adapter=await read('js/mcc-model-adapter.js');
  assert.match(adapter,/first=legacy\.suggest\(\)/);
  assert.match(adapter,/if\(a\.dom===first\.dom\)return -1/);
  assert.match(adapter,/prefetch\("global\.for_you",null,\{maxItems:1\}\)/);
});

test('evidence client still falls back without blocking live pages',async()=>{
  const experience=await read('js/experience.js');
  assert.match(experience,/fallback: true/);
  assert.match(experience,/error: error && error\.message \|\| "decision unavailable"/);
  assert.match(experience,/candidates: body\.candidates\.slice/);
});
