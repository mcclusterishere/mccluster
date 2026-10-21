// Offline evaluation over an explicitly labelled reference corpus. No network,
// model calls, credentials, publication, or new durable authority.
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

export const SCHEMA = 'mccluster-evidence-evaluation/v1';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => text(value) && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ratio = (n, d) => ({ numerator: n, denominator: d, value: d ? n / d : null });

function interval(n, d) {
  if (!d) return null;
  const z = 1.959963984540054, p = n / d, scale = 1 + z * z / d;
  const center = (p + z * z / (2 * d)) / scale;
  const radius = z * Math.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / scale;
  return { method: 'Wilson 95%', lower: Math.max(0, center - radius), upper: Math.min(1, center + radius),
    assumption: 'Independent Bernoulli sampling units; descriptive only if this assumption is not justified.' };
}

function validate(manifest, rows, predictions) {
  assert(manifest?.schema_version === SCHEMA, 'unsupported manifest schema');
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 100000, 'bounded nonempty corpus required');
  assert(Array.isArray(manifest.methods) && manifest.methods.length > 0 && manifest.methods.length <= 16, 'between 1 and 16 methods required');
  assert(rows.length * manifest.methods.length <= 1000000, 'scoring work exceeds one million method/sample pairs');
  assert(Array.isArray(predictions) && predictions.length <= rows.length * manifest.methods.length, 'bounded predictions required');
  assert(['engineering_fixture', 'adjudicated_study'].includes(manifest.run_kind), 'run_kind required');
  assert(/^[a-f0-9]{40}$/.test(manifest.code_sha || ''), 'exact code SHA required');
  assert(timestamp(manifest.retrieval_cutoff), 'retrieval_cutoff with timezone required');
  assert(['real', 'synthetic', 'llm_generated', 'mixed'].includes(manifest.dataset?.origin), 'dataset origin required');
  assert(sha(manifest.dataset?.sha256) && manifest.dataset.sha256 === digest(rows), 'dataset hash mismatch');
  assert(sha(manifest.predictions_sha256) && manifest.predictions_sha256 === digest(predictions), 'predictions hash mismatch');
  for (const key of ['source_url', 'rights', 'attribution', 'version']) assert(text(manifest.dataset[key]), `dataset ${key} required`);
  for (const key of ['hypothesis', 'primary_endpoint', 'sampling_unit', 'outcome_window', 'sample_size_rationale', 'analysis_plan', 'failure_criteria']) {
    assert(text(manifest.protocol?.[key]), `protocol ${key} required`);
  }
  assert(text(manifest.research_project_key), 'existing/review-proposed research project key required');
  assert(['public_fixture', 'authorized_environment_only'].includes(manifest.access), 'access scope required');
  if (manifest.run_kind === 'adjudicated_study') {
    assert(text(manifest.protocol.qualified_reviewer) && text(manifest.protocol.review_ref), 'study requires attributed protocol review');
    assert(text(manifest.protocol.ethics_determination_ref), 'study requires institutional ethics determination reference');
  }
  const methods = new Set();
  for (const method of manifest.methods) {
    assert(text(method.id) && !methods.has(method.id), 'unique method IDs required'); methods.add(method.id);
    assert(['rules', 'single_model', 'bounded_orchestration'].includes(method.kind), 'unknown method kind');
    assert(sha(method.configuration_sha256), 'pinned configuration hash required');
    assert(text(method.runtime) && text(method.runtime_version), 'pinned runtime required');
    if (method.kind !== 'rules') {
      for (const k of ['model', 'model_revision', 'weight_license', 'quantization']) assert(text(method[k]), `method ${k} required`);
      assert(sha(method.prompt_sha256), 'pinned prompt hash required');
    }
  }
  const samples = new Map(), groups = new Map(), sourceSplits = new Map();
  for (const row of rows) {
    assert(text(row.id) && !samples.has(row.id), 'unique sample IDs required');
    assert(['train', 'validation', 'test'].includes(row.split), 'split required');
    assert(text(row.event_group_id), 'related-event group required');
    assert(!groups.has(row.event_group_id) || groups.get(row.event_group_id) === row.split, 'related event leaks across splits');
    groups.set(row.event_group_id, row.split);
    assert(timestamp(row.available_at) && Date.parse(row.available_at) <= Date.parse(manifest.retrieval_cutoff), 'future information after retrieval cutoff');
    assert(Array.isArray(row.source_ids) && row.source_ids.length > 0 && row.source_ids.every(text), 'source IDs required');
    for (const id of row.source_ids) {
      assert(!sourceSplits.has(id) || sourceSplits.get(id) === row.split, 'source copy leaks across splits');
      sourceSplits.set(id, row.split);
    }
    assert(['supported', 'unsupported', 'unknown'].includes(row.reference_label), 'reference label required');
    if (row.reference_label !== 'unknown') {
      assert(text(row.labeler) && text(row.adjudication_ref), 'known labels require labeler and adjudication reference');
    }
    samples.set(row.id, row);
  }
  const seen = new Set();
  for (const p of predictions) {
    assert(methods.has(p.method_id) && samples.has(p.sample_id), 'prediction references unknown method/sample');
    assert(samples.get(p.sample_id).split === 'test', 'only held-out test predictions are scored');
    const key = JSON.stringify([p.method_id, p.sample_id]);
    assert(!seen.has(key), 'duplicate method/sample prediction'); seen.add(key);
    assert(['ok', 'failed'].includes(p.status), 'execution status required');
    assert(p.status === 'failed' || ['supported', 'unsupported', 'abstain'].includes(p.decision), 'decision required');
    assert(Array.isArray(p.citation_ids) && p.citation_ids.every(id => samples.get(p.sample_id).source_ids.includes(id)), 'citation outside sample allowlist');
    assert(p.status !== 'ok' || p.decision !== 'supported' || p.citation_ids.length > 0, 'supported prediction requires citations');
    assert(p.latency_ms === null || (typeof p.latency_ms === 'number' && Number.isFinite(p.latency_ms) && p.latency_ms >= 0), 'latency must be measured nonnegative number or null');
    if (p.cost !== null && p.cost !== undefined) {
      assert(['measured', 'estimated'].includes(p.cost.basis) && /^[A-Z]{3}$/.test(p.cost.currency || ''), 'cost needs basis and currency');
      assert(typeof p.cost.amount === 'number' && Number.isFinite(p.cost.amount) && p.cost.amount >= 0, 'invalid cost');
      assert(text(p.cost.method), 'cost calculation method required');
    }
  }
  assert(rows.some(r => r.split === 'test'), 'held-out test set required');
}

export function evaluateEvidence(manifest, rows, predictions) {
  validate(manifest, rows, predictions);
  const test = rows.filter(r => r.split === 'test');
  const known = test.filter(r => r.reference_label !== 'unknown');
  const outputs = new Map(predictions.map(p => [JSON.stringify([p.method_id, p.sample_id]), p]));
  const methods = manifest.methods.map(method => {
    let tp = 0, fp = 0, abstentions = 0, missing = 0, failed = 0, classified = 0, labelledPredictedPositive = 0;
    const latency = [], costs = new Map();
    for (const row of test) {
      const p = outputs.get(JSON.stringify([method.id, row.id]));
      if (!p) { missing++; continue; }
      if (p.latency_ms !== null) latency.push(p.latency_ms);
      if (p.cost) {
        const key = `${p.cost.currency}:${p.cost.basis}`;
        const value = costs.get(key) || { currency: p.cost.currency, basis: p.cost.basis, amount: 0, receipts: 0 };
        value.amount += p.cost.amount;
        assert(Number.isFinite(value.amount), 'aggregate cost exceeds finite numeric range');
        value.receipts++; costs.set(key, value);
      }
      if (p.status === 'failed') { failed++; continue; }
      if (p.decision === 'abstain') { abstentions++; continue; }
      classified++;
      if (p.decision === 'supported' && row.reference_label !== 'unknown') {
        labelledPredictedPositive++;
        if (row.reference_label === 'supported') tp++; else fp++;
      }
    }
    latency.sort((a,b) => a-b);
    const quantile = q => latency.length ? latency[Math.max(0, Math.ceil(q * latency.length) - 1)] : null;
    const positives = known.filter(r => r.reference_label === 'supported').length;
    return { id: method.id, kind: method.kind, state: missing === test.length ? 'not_run' : missing || failed ? 'partial' : 'complete',
      corpus_size: test.length, known_labels: known.length, unknown_labels: test.length - known.length,
      missing, failed, abstentions, classified, true_positive: tp, false_positive: fp,
      precision: { ...ratio(tp, labelledPredictedPositive), interval: interval(tp, labelledPredictedPositive) },
      recall: { ...ratio(tp, positives), value: test.length === missing ? null : positives ? tp / positives : null,
        completeness: missing || failed ? 'lower_bound_pending_missing_or_failed_predictions' : 'observed_corpus',
        interval: missing || failed ? null : interval(tp, positives) },
      classification_coverage: ratio(classified, test.length), abstention_rate: ratio(abstentions, test.length),
      execution_failure_rate: ratio(failed, test.length - missing),
      latency_ms: { sample_count: latency.length, missing_count: test.length - latency.length, p50: quantile(.5), p95: quantile(.95), method: 'nearest-rank; includes recorded failed attempts' },
      costs: [...costs.values()], cost_receipts_missing: test.length - [...costs.values()].reduce((n,c) => n+c.receipts, 0) };
  });
  const report = { schema_version: SCHEMA, run_kind: manifest.run_kind, manifest_sha256: digest(manifest),
    dataset_sha256: digest(rows), predictions_sha256: digest(predictions), code_sha: manifest.code_sha,
    retrieval_cutoff: manifest.retrieval_cutoff, access: manifest.access, dataset_origin: manifest.dataset.origin,
    methods, limitations: [
      'Recall is against this labelled reference corpus, not all real-world events.',
      'An allowlisted citation proves referential integrity, not semantic support or independent corroboration.',
      'Unknown labels, missing predictions, execution failures and abstentions are distinct.',
      'Intervals assume independent Bernoulli sampling; correlated event groups require a reviewed grouped analysis.',
      'No significance, causal effect, scientific novelty, partner outcome, energy consumption or external validation is inferred.',
      ...(manifest.run_kind === 'engineering_fixture' ? ['Engineering fixture only; not a scientific benchmark or human-subject study.'] : []),
    ] };
  return { ...report, artifact_draft: { key: `evidence-eval-${digest(report).slice(0,24)}`, kind: 'report', status: 'draft',
    git_commit_sha: manifest.code_sha, metadata: { schema_version: SCHEMA, research_project_key: manifest.research_project_key,
      manifest_sha256: digest(manifest), report_sha256: digest(report), access: manifest.access, run_kind: manifest.run_kind,
      publication_eligible: false, reviewed: false } } };
}

async function readJson(path) {
  assert((await stat(path)).size <= 32 * 1024 * 1024, 'input exceeds 32 MiB bound');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [manifestPath, datasetPath, predictionsPath, outputPath] = process.argv.slice(2);
  assert(manifestPath && datasetPath && predictionsPath && outputPath, 'usage: node scripts/research/evaluate-evidence.mjs MANIFEST DATASET PREDICTIONS REPORT');
  assert(![manifestPath,datasetPath,predictionsPath].some(p => resolve(p) === resolve(outputPath)), 'output must not overwrite inputs');
  const started = performance.now();
  const [manifest, rows, predictions] = await Promise.all([readJson(manifestPath), readJson(datasetPath), readJson(predictionsPath)]);
  const report = evaluateEvidence(manifest, rows, predictions);
  report.execution = { node: process.version, platform: platform(), arch: arch(), logical_cpus: cpus().length,
    memory_bytes: totalmem(), elapsed_ms: performance.now() - started,
    evaluator_sha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    measured_at: new Date().toISOString(), scope: 'local evaluator; not model inference or OVH hardware benchmark' };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`Wrote ${outputPath}; ${report.methods.length} method(s); ${report.run_kind}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
