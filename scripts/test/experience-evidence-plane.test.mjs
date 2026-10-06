import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('experience evidence migration separates product and research policy planes',async()=>{
  const sql=await read('supabase/migrations/20261006211536_experience_evidence_plane_v1.sql');
  for(const table of [
    'experience_surfaces','experience_policies','experience_experiments',
    'experience_experiment_arms','experience_assignments','experience_feature_snapshots',
    'experience_decisions','research_projects','research_sources','research_artifacts'
  ]) assert.match(sql,new RegExp('create table if not exists public\\.'+table+'\\b','i'),table+' missing');
  assert.match(sql,/plane in \('production','research'\)/i);
  assert.match(sql,/intent in \('product','research'\)/i);
  assert.match(sql,/status not in \('canary','running'\).*research_review in \('exempt','approved'\)/is);
  for(const table of ['experience_surfaces','experience_policies','research_projects','experience_experiments','experience_experiment_arms','experience_assignments','experience_feature_snapshots','experience_decisions','research_sources','research_artifacts']) {
    assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security','i'),table+' RLS missing');
    assert.match(sql,new RegExp('revoke all on table public\\.'+table+' from anon, authenticated','i'),table+' client revoke missing');
  }
  assert.doesNotMatch(sql,/grant\s+(select|insert|update|delete)\s+on\s+public\.experience_/i);
});

test('evidence plane records opportunity, selection, propensities and downstream decision context',async()=>{
  const sql=await read('supabase/migrations/20261006211536_experience_evidence_plane_v1.sql');
  for(const column of ['eligible_candidates','selected_candidates','propensities','reason_codes','objective_weights']){
    assert.match(sql,new RegExp('\\b'+column+'\\b'),column+' missing');
  }
  for(const event of ['experience_impression','experience_visible','experience_interaction','experience_dismissed','experience_outcome']){
    assert.match(sql,new RegExp("'"+event+"'"),event+' taxonomy missing');
  }
  for(const column of ['decision_id','experience_surface','experience_policy','experience_experiment','experience_arm']){
    assert.match(sql,new RegExp('events_lean add column if not exists '+column,'i'),column+' lean projection missing');
  }
});

test('public Research Lab is citable and bibliography is versioned',async()=>{
  const [page,cff,refs,governance,log]=await Promise.all([
    read('research.html'),read('CITATION.cff'),read('data/research/references.json'),
    read('docs/research/RESEARCH-LAB-GOVERNANCE-AND-FUNDING.md'),
    read('docs/research/ADAPTIVE-EXPERIENCE-RESEARCH-LOG-2026-10-06.md')
  ]);
  assert.match(page,/McCluster Research Lab/);
  assert.match(page,/CIA Mind Control/);
  assert.match(page,/0009-0000-8988-8955/);
  assert.match(cff,/orcid:\s*"https:\/\/orcid\.org\/0009-0000-8988-8955"/);
  const data=JSON.parse(refs);
  assert.ok(data.sources.length>=35,'canonical bibliography should retain the expanded research base');
  for(const key of ['recsys_2026_genpage','recsys_2026_egrec','recsys_2026_conalign','hhs_common_rule','scsu_irb','nsf_26_510_sbir_sttr','minisforum_ai_x1_pro_470_official','access_allocations_no_cost','jetstream2_gpu_faq']){
    assert.ok(data.sources.some((x)=>x.citation_key===key),key+' missing');
  }
  assert.match(governance,/November 4, 2026/);
  assert.match(governance,/up to \*\*\$305,000\*\*/);
  assert.match(governance,/up to \*\*\$1,250,000\*\*/);
  assert.match(page,/ADAPTIVE-EXPERIENCE-RESEARCH-LOG-2026-10-06\.md/);
  assert.match(page,/s\.url\|\|"#"/);
  assert.match(page,/s\.citation_key/);
  assert.match(page,/s\.category/);
  assert.match(log,/## 1\. Adaptive-interface foundations reviewed/);
  assert.match(log,/## 9\. Local\/remote AI compute research/);
  assert.match(log,/Things we have explicitly NOT proven/);
});
