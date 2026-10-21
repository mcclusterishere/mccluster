import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEvidence, digest, SCHEMA } from '../research/evaluate-evidence.mjs';

function fixture() {
  const rows = ['supported','supported','supported','unsupported','unknown','unsupported'].map((label,i) => ({
    id: `claim-${i+1}`, event_group_id: `event-${i+1}`, split: 'test', available_at: '2026-10-19T12:00:00Z',
    source_ids: [`source-${i+1}`], reference_label: label, labeler: 'synthetic-fixture-author', adjudication_ref: `fixture:${i+1}`,
  }));
  const prediction = (i, decision, extra = {}) => ({method_id:'rules',sample_id:`claim-${i}`,status:'ok',decision,
    citation_ids: decision === 'supported' ? [`source-${i}`] : [],latency_ms: null,...extra});
  const predictions = [prediction(1,'supported',{latency_ms:10}),prediction(2,'abstain'),prediction(4,'supported',{latency_ms:40}),
    prediction(5,'supported',{cost:{amount:.03,currency:'USD',basis:'estimated',method:'synthetic accounting example'}}),
    prediction(6,null,{status:'failed',latency_ms:100})];
  const manifest = {schema_version:SCHEMA,run_kind:'engineering_fixture',code_sha:'a'.repeat(40),
    retrieval_cutoff:'2026-10-20T00:00:00Z',research_project_key:'review-proposed-evidence-evaluation',access:'public_fixture',
    dataset:{origin:'synthetic',sha256:digest(rows),source_url:'fixture:unit-tests',rights:'repository proprietary; test fixture only',
      attribution:'McCluster engineering fixture',version:'1'}, predictions_sha256:digest(predictions),
    protocol:{hypothesis:'Scorer distinguishes missing/unknown/failure/abstention.',primary_endpoint:'Known-label precision and recall',
      sampling_unit:'synthetic claim',outcome_window:'fixed fixture',sample_size_rationale:'six explicit edge cases; no power claim',
      analysis_plan:'hand-computed confusion counts',failure_criteria:'mismatched count or unsafe acceptance'},
    methods:[{id:'rules',kind:'rules',configuration_sha256:digest({rule:'fixture'}),runtime:'fixture',runtime_version:'1'},
      {id:'not-run',kind:'rules',configuration_sha256:digest({rule:'absent'}),runtime:'fixture',runtime_version:'1'}]};
  return {manifest, rows, predictions};
}
function rehash(f) {f.manifest.dataset.sha256=digest(f.rows);f.manifest.predictions_sha256=digest(f.predictions);return f;}
function run(f) {return evaluateEvidence(f.manifest,f.rows,f.predictions);}

test('hand-adjudicated fixture: distinct unknown, missing, failed and abstained predictions', () => {
  const report=run(fixture()), r=report.methods[0];
  assert.equal(r.true_positive,1); assert.equal(r.false_positive,1);
  assert.equal(r.precision.value,1/2); assert.equal(r.precision.denominator,2);
  assert.equal(r.recall.value,1/3); assert.equal(r.recall.denominator,3);
  assert.equal(r.recall.interval,null); assert.match(r.recall.completeness,/lower_bound/);
  assert.equal(r.unknown_labels,1);assert.equal(r.missing,1);assert.equal(r.failed,1);assert.equal(r.abstentions,1);
  assert.equal(r.classification_coverage.value,3/6);assert.equal(r.execution_failure_rate.value,1/5);
  assert.deepEqual(r.latency_ms,{sample_count:3,missing_count:3,p50:40,p95:100,method:'nearest-rank; includes recorded failed attempts'});
  assert.equal(r.costs[0].basis,'estimated');assert.equal(r.cost_receipts_missing,5);
  assert.equal(report.methods[1].state,'not_run');assert.equal(report.methods[1].recall.value,null);
  assert.equal(report.artifact_draft.status,'draft'); assert.equal(report.artifact_draft.metadata.publication_eligible,false);
});
test('modified dataset or prediction fails hash before scoring', () => {
  const f=fixture();f.rows[0].reference_label='unsupported';assert.throws(()=>run(f),/dataset hash/);
  const g=fixture();g.predictions[0].decision='abstain';assert.throws(()=>run(g),/predictions hash/);
});
test('syndicated source and related event cannot leak across splits', () => {
  for(const key of ['event_group_id','source_ids']) {
    const f=fixture();f.rows.push({...f.rows[0],id:'train-copy',split:'train',event_group_id:'distinct',source_ids:['distinct']});
    f.rows.at(-1)[key]=f.rows[0][key];rehash(f);assert.throws(()=>run(f),/leaks across splits/);
  }
});
test('future information and unknown citations rejected', () => {
  const f=fixture();f.rows[0].available_at='2026-10-21T00:00:00Z';rehash(f);assert.throws(()=>run(f),/future information/);
  const g=fixture();g.predictions[0].citation_ids=['unseen'];rehash(g);assert.throws(()=>run(g),/outside sample allowlist/);
});
test('duplicate predictions, duplicate sample IDs and unreviewed known labels rejected', () => {
  const f=fixture();f.predictions.push(f.predictions[0]);rehash(f);assert.throws(()=>run(f),/duplicate method/);
  const g=fixture();g.rows.push(g.rows[0]);rehash(g);assert.throws(()=>run(g),/unique sample/);
  const h=fixture();h.rows[0].adjudication_ref='';rehash(h);assert.throws(()=>run(h),/adjudication/);
});
test('training rows cannot be used as held-out predictions', () => {
  const f=fixture();f.rows[0].split='train';rehash(f);assert.throws(()=>run(f),/held-out test/);
});
test('a scientific study requires attributed protocol and ethics review references', () => {
  const f=fixture();f.manifest.run_kind='adjudicated_study';assert.throws(()=>run(f),/protocol review/);
  f.manifest.protocol.qualified_reviewer='reviewer';f.manifest.protocol.review_ref='review:1';assert.throws(()=>run(f),/ethics determination/);
});
test('model outputs cannot be evaluated without exact runtime/weights/prompt configuration', () => {
  const f=fixture();f.manifest.methods[0].kind='single_model';assert.throws(()=>run(f),/method model/);
});
test('unknown cost and absent outcome denominator stay unknown; currencies never sum', () => {
  const f=fixture();f.rows=f.rows.map(r=>({...r,reference_label:'unknown'}));
  f.predictions[1].cost={amount:4,currency:'EUR',basis:'measured',method:'synthetic receipt'};rehash(f);
  const r=run(f).methods[0];assert.equal(r.precision.value,null);assert.equal(r.recall.value,null);
  assert.equal(r.costs.length,2);assert.deepEqual(new Set(r.costs.map(c=>c.currency)),new Set(['USD','EUR']));
});
test('results are deterministic for frozen inputs', () => {
  const f=fixture();assert.deepEqual(run(f),run(f));
});
test('finite individual costs cannot produce a nonfinite report aggregate', () => {
  const f=fixture();
  for (const p of f.predictions.slice(0,2)) p.cost={amount:Number.MAX_VALUE,currency:'USD',basis:'measured',method:'overflow fixture'};
  rehash(f);assert.throws(()=>run(f),/aggregate cost exceeds finite/);
});
test('method count and total scoring work are bounded before hashing or evaluation', () => {
  const f=fixture();f.manifest.methods=Array.from({length:17},(_,i)=>({...f.manifest.methods[0],id:`method-${i}`}));
  assert.throws(()=>run(f),/between 1 and 16/);
  f.manifest.methods=f.manifest.methods.slice(0,16);f.rows=Array(62501).fill(f.rows[0]);
  assert.throws(()=>run(f),/one million method\/sample pairs/);
});
