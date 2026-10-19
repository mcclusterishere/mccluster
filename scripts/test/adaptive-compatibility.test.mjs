import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('MCC_MODEL keeps its public compatibility API while using ExperienceDecision',async()=>{
  const analytics=await read('js/analytics.js');
  assert.match(analytics,/window\.MCC_MODEL/);
  assert.match(analytics,/function localSuggest\(\)/);
  assert.match(analytics,/function suggest\(\)/);
  assert.match(analytics,/function suggestAsync\(surface\)/);
  assert.match(analytics,/function decide\(surface, candidates, opts\)/);
  assert.match(analytics,/MCC_EXPERIENCE\.decide/);
  assert.match(analytics,/source\s*=\s*"local-fallback"|source:\s*"local-fallback"/);
  assert.match(analytics,/source\s*=\s*"experience-decision"|source:\s*"experience-decision"/);
  assert.match(analytics,/profile:profile, suggest:suggest, suggestAsync:suggestAsync, shown:shown, decide:decide/);
});

test('legacy behavioral scores stay on-device and are not sent as server decision context',async()=>{
  const analytics=await read('js/analytics.js');
  const adapter=analytics.slice(analytics.indexOf('function decide(surface, candidates, opts)'),analytics.indexOf('/* what an event means'));
  assert.doesNotMatch(adapter,/S\.doms|S\.heat|ranked|archetype|persuade/);
  assert.match(analytics,/Legacy interest weights and[\s\S]*never uploaded by this adapter/);
});

test('the adaptive renderer is allowlisted and never renders server-authored HTML',async()=>{
  const js=await read('js/adaptive-surfaces.js');
  assert.match(js,/function card\(candidate,decision,surface\)/);
  assert.match(js,/document|doc\.createElement/);
  assert.doesNotMatch(js,/innerHTML\s*=/);
  assert.doesNotMatch(js,/eval\s*\(|new Function/);
  assert.match(js,/u\.origin!==location\.origin/);
  assert.match(js,/u\.protocol!=="http:"&&u\.protocol!=="https:"/);
  assert.match(js,/map\[String\(c\.id\)\]/,'server decisions may choose only IDs in the caller allowlist');
});

test('all three initial adaptive surfaces are live and decision-instrumented',async()=>{
  const [index,listen,actionPage,actionJs,adaptive,migration]=await Promise.all([
    read('index.html'),read('listen.html'),read('action/index.html'),read('js/action.js'),
    read('js/adaptive-surfaces.js'),read('supabase/migrations/20261006211536_experience_evidence_plane_v1.sql')
  ]);
  for(const key of ['global.for_you','music.next_step','action.next_step']){
    assert.match(migration,new RegExp(key.replace('.','\\.')),key+' must exist in the canonical surface registry');
    assert.match(adaptive+actionJs,new RegExp(key.replace('.','\\.')),key+' must be consumed by a browser surface');
  }
  assert.match(index,/data-adaptive-auto="global"/);
  assert.match(listen,/data-adaptive-auto="music"/);
  assert.match(actionJs,/MCC_ADAPTIVE\.rank\("action\.next_step"/);
  for(const page of [index,listen,actionPage]){
    assert.match(page,/js\/experience\.js/);
    assert.match(page,/js\/adaptive-surfaces\.js/);
  }
  assert.match(adaptive,/experience_impression|impression/);
  assert.match(adaptive,/visible/);
  assert.match(adaptive,/interact/);
});

test('PR C launches only the deterministic production policy, not a research bandit',async()=>{
  const [router,migration,protocol]=await Promise.all([
    read('workers/mccluster/src/experience/router.js'),
    read('supabase/migrations/20261006235944_adaptive_production_policy_v1.sql'),
    read('docs/research/PROTOCOL-002-PRODUCTION-POLICY-V1.md')
  ]);
  assert.match(router,/deterministic_score_mmr/);
  assert.match(router,/production-mature/);
  assert.match(router,/caller_order_preserved/);
  assert.match(router,/Unsupported\/shadow policies never silently alter production traffic/);
  assert.match(migration,/'production-mature','v1','production','promoted','deterministic_score_mmr'/);
  assert.match(protocol,/No training job, embedding model, LLM call/);
  assert.doesNotMatch(router,/thompson_sampling|linucb|epsilon_greedy/i);
});

test('all three surfaces preserve caller order when the decision service is unavailable',async()=>{
  const adaptive=await read('js/adaptive-surfaces.js');
  assert.match(adaptive,/local\.slice\(0,maxItems\)/);
  assert.match(adaptive,/fallback:!\(decision&&decision\.ok\)/);
  const action=await read('js/action.js');
  assert.match(action,/catch\(function \(\) \{ renderCampaigns\(list, null\); \}\)/);
});


test('experience decisions stay behind the existing privacy gate',async()=>{
  const experience=await read('js/experience.js');
  const start=experience.indexOf('async function decide(surface, candidates, opts)');
  const body=experience.slice(start,start+1800);
  assert.match(body,/!root\.MCC_ANALYTICS_CONTEXT/);
  assert.match(body,/privacy gate not acknowledged/);
  const gate=body.indexOf('privacy gate not acknowledged');
  const fetchAt=body.indexOf('fetch(');
  assert.ok(gate>-1 && (fetchAt===-1 || gate<fetchAt),'privacy fallback must happen before any decision fetch');
});


test('signed-in adaptive cards expose explicit preference controls without changing anonymous fallback',async()=>{
  const [adaptive,experience,css]=await Promise.all([
    read('js/adaptive-surfaces.js'),read('js/experience.js'),read('css/adaptive-surfaces.css')
  ]);
  assert.match(adaptive,/More like this/);
  assert.match(adaptive,/Less like this/);
  assert.match(adaptive,/MCC_EXPERIENCE\.prefer/);
  assert.match(experience,/function preferences\(surface\)/);
  assert.match(experience,/function clearPreference\(surface,key\)/);
  assert.match(experience,/experience_preference_set/);
  assert.match(css,/adaptive-card__tune/);
  assert.match(adaptive,/local\.slice\(0,maxItems\)/);
});

test('server-ranked positions replace caller positions for downstream evidence',async()=>{
  const adaptive=await read('js/adaptive-surfaces.js');
  assert.match(adaptive,/Object\.assign\(\{\},localCandidate,\{position:/);
});
