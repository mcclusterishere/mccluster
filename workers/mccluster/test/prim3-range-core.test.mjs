import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const corePath = resolve(root, 'js', 'prim3-range-core.js');
const controllerPath = resolve(root, 'js', 'prim3-range.js');
const htmlPath = resolve(root, 'prim3-range.html');

async function source(path) {
  return readFile(path, 'utf8');
}

async function loadCore() {
  const context = vm.createContext({});
  vm.runInContext(await source(corePath), context, { filename: corePath });
  return context.PRIM3_RANGE_CORE;
}

function progress(score = 80, attempts = 1, mastery = {}) {
  return {
    module_id: 'M01',
    assessment_score: score,
    assessment_attempts: attempts,
    passed_at: score >= 80 ? '2026-09-12T00:00:00.000Z' : null,
    mastery
  };
}

function profileFor(core, score, learner = 'learner', mastery = {}, attempts = 1) {
  return core.buildReadiness(progress(score, attempts, mastery), learner);
}

function solve(core, profile) {
  let session = core.createSession(profile, []);
  const variant = core.publicVariant(session.variant_id);
  variant.evidence.filter((item) => item.material).forEach((item) => {
    session = core.reviewEvidence(session, item.id);
  });
  let result = core.commitObservation(session);
  assert.equal(result.correct, true);
  session = result.session;
  result = core.classifyRisk(session, variant.classification);
  assert.equal(result.correct, true);
  session = result.session;
  const control = variant.controls.find((item) => item.correct);
  result = core.chooseControl(session, control.id);
  assert.equal(result.correct, true);
  session = result.session;
  const verification = variant.verification.find((item) => item.correct);
  result = core.verifyControl(session, verification.id);
  assert.equal(result.correct, true);
  return result.session;
}

test('Training Range 01 preserves the complete required tool floor at low mastery', async () => {
  const core = await loadCore();
  const profile = profileFor(core, 40);
  assert.equal(profile.scaffolding, 'HIGH');
  assert.equal(profile.technical_challenge, 'FOUNDATION');
  assert.deepEqual(Array.from(profile.minimum_required_toolset), Array.from(core.requiredTools));
  assert.deepEqual(Array.from(profile.granted_toolset), Array.from(core.requiredTools));
  assert.equal(profile.fairness.required_tools_removed_for_low_mastery, false);
});

test('readiness adaptation changes support without changing the fairness contract', async () => {
  const core = await loadCore();
  const highSupport = profileFor(core, 60);
  const standardSupport = profileFor(core, 75);
  const lowSupport = profileFor(core, 85);
  assert.equal(highSupport.scaffolding, 'HIGH');
  assert.equal(standardSupport.scaffolding, 'STANDARD');
  assert.equal(lowSupport.scaffolding, 'LOW');
  assert.equal(lowSupport.preparation_credits, 1);
  assert.deepEqual(Array.from(highSupport.granted_toolset), Array.from(lowSupport.granted_toolset));
  assert.equal('rhythm' in lowSupport, false);
  assert.equal('immersion' in lowSupport, false);
});

test('weak CIA concept evidence deterministically selects the matching approved variant', async () => {
  const core = await loadCore();
  const confidential = profileFor(core, 85, 'one', { concept_mastery: { 'security.confidentiality': 35 } });
  const integrity = profileFor(core, 85, 'two', { concept_mastery: { 'security.integrity': 42 } });
  const availability = profileFor(core, 85, 'three', { concept_mastery: { 'security.availability': 18 } });
  assert.equal(confidential.variant_id, 'TR01-A');
  assert.equal(integrity.variant_id, 'TR01-B');
  assert.equal(availability.variant_id, 'TR01-C');
});

test('scaffolding controls nonmaterial evidence density and never required evidence', async () => {
  const core = await loadCore();
  const high = core.createSession(profileFor(core, 60, 'high'), []);
  const standard = core.createSession(profileFor(core, 75, 'standard'), []);
  const lowProfile = profileFor(core, 85, 'low');
  const low = core.createSession(lowProfile, []);
  const reduced = core.createSession(lowProfile, ['remove-one-nonmaterial-distractor']);

  assert.equal(high.available_evidence.length, 2);
  assert.equal(standard.available_evidence.length, 3);
  assert.equal(low.available_evidence.length, 4);
  assert.equal(reduced.available_evidence.length, 3);

  [high, standard, low, reduced].forEach((session) => {
    const variant = core.publicVariant(session.variant_id);
    const required = variant.evidence.filter((item) => item.material).map((item) => item.id);
    required.forEach((id) => assert.ok(session.available_evidence.includes(id)));
  });
});

test('technical truth stays fixed after deployment', async () => {
  const core = await loadCore();
  const profile = profileFor(core, 85, 'truth-lock');
  let session = core.createSession(profile, []);
  const originalVariant = session.variant_id;
  const firstEvidence = session.available_evidence[0];
  session = core.reviewEvidence(session, firstEvidence);
  assert.equal(session.variant_id, originalVariant);
  const result = core.commitObservation(session);
  assert.equal(result.session.variant_id, originalVariant);
  assert.equal(profile.fairness.technical_truth_locked_at_compile, true);
  assert.equal(profile.fairness.threat_logic_can_read_hidden_mastery, false);
});

test('a correct mission path writes all four canonical evidence traces', async () => {
  const core = await loadCore();
  const profile = profileFor(core, 85, 'perfect-run');
  const session = solve(core, profile);
  assert.equal(session.completed, true);
  assert.equal(session.failed, false);
  assert.deepEqual(Array.from(session.evidence_trace_ids), Array.from(core.requiredTraces));
  const score = core.scoreSession(session);
  assert.equal(score.technical_mastery, 100);
  assert.equal(score.independence, 100);
  assert.equal(score.transfer, 100);
  assert.equal(score.compliance, 100);
  assert.equal(score.operational_grade, 'A');
  assert.notEqual(score.technical_mastery, score.operational_score);
});

test('wrong decisions consume the mission window and can terminate the attempt', async () => {
  const core = await loadCore();
  const profile = profileFor(core, 60, 'window-test');
  let session = core.createSession(profile, []);
  session = core.reviewEvidence(session, session.available_evidence[0]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    session = core.commitObservation(session).session;
  }
  assert.equal(session.window, 0);
  assert.equal(session.failed, true);
  assert.equal(session.stage, 'FAILED');
  assert.equal(session.mission_state, 'TERMINAL');
  const score = core.scoreSession(session);
  assert.ok(score.operational_score < 60);
  assert.equal(score.completed, false);
});

test('all three authored variants are solvable through the same deterministic evidence cycle', async () => {
  const core = await loadCore();
  for (const variantId of ['TR01-A', 'TR01-B', 'TR01-C']) {
    const profile = profileFor(core, 85, variantId);
    profile.variant_id = variantId;
    const first = solve(core, profile);
    const second = solve(core, profile);
    assert.equal(first.variant_id, variantId);
    assert.equal(first.completed, true);
    assert.deepEqual(Array.from(first.evidence_trace_ids), Array.from(second.evidence_trace_ids));
    assert.equal(core.scoreSession(first).technical_mastery, 100);
  }
});

test('the browser vertical slice gates on M01 and writes mission evidence through the existing M Account progress route', async () => {
  const controller = await source(controllerPath);
  const html = await source(htmlPath);
  assert.doesNotThrow(() => new Function(controller));
  assert.match(controller, /!state\.progress \|\| !state\.progress\.passed_at/);
  assert.match(controller, /api\("\/v1\/prim3\/progress\/M01"/);
  assert.match(controller, /mastery\.missions/);
  assert.match(controller, /technical_truth_locked_at_compile: true/);
  assert.match(controller, /minimum_required_tools_preserved: true/);
  assert.match(html, /Training Range 01/);
  assert.match(html, /Risk and Controls/);
  assert.match(html, /js\/prim3-range-core\.js/);
  assert.match(html, /js\/prim3-range\.js/);
});
