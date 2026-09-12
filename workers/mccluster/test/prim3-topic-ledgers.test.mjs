import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const coveragePath = resolve(root, 'docs', 'prim3', 'COMPTIA-COVERAGE.json');
const securityPath = resolve(root, 'docs', 'prim3', 'SECURITY-PLUS-TOPIC-LEDGER.json');
const networkPath = resolve(root, 'docs', 'prim3', 'NETWORK-PLUS-TOPIC-LEDGER.json');
const aPlusPath = resolve(root, 'docs', 'prim3', 'APLUS-PRECURSOR-MAP.json');
const overlapPath = resolve(root, 'docs', 'prim3', 'OBJECTIVE-OVERLAP-GRAPH.json');
const modalityPath = resolve(root, 'docs', 'prim3', 'LEARNING-MODALITY-CONTRACT.md');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function objectiveSet(certification) {
  return new Set(certification.domains.flatMap((domain) => domain.objectives));
}

function validModuleId(id) {
  const match = /^M(\d{2})$/.exec(id);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 66);
}

function assertModuleHomes(entry, reservedForbidden = false) {
  assert.ok(Array.isArray(entry.learn_modules) && entry.learn_modules.length > 0);
  for (const id of entry.learn_modules) {
    assert.ok(validModuleId(id), `invalid module home ${id}`);
    if (reservedForbidden) assert.ok(!['M55', 'M56', 'M57'].includes(id), `mandatory topic depends on blocked ${id}`);
  }
}

test('Security Plus surgical ledger covers all 28 objectives with topic families and LEARN homes', async () => {
  const coverage = await json(coveragePath);
  const ledger = await json(securityPath);
  const certification = coverage.mandatory_certifications.find((item) => item.exam === 'SY0-701');
  const expected = objectiveSet(certification);
  const actual = new Set(Object.keys(ledger.objectives));

  assert.equal(actual.size, 28);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(ledger.semantics.learn_required, true);
  assert.equal(ledger.semantics.assessment_required, true);
  assert.equal(ledger.semantics.lab, 'Deferred until the PRIM3 game lab design conversation.');

  for (const [id, entry] of Object.entries(ledger.objectives)) {
    assert.ok(expected.has(id));
    assert.ok(Array.isArray(entry.topic_groups) && entry.topic_groups.length > 0, `${id} has no topic groups`);
    assertModuleHomes(entry, true);
  }
});

test('Network Plus surgical ledger covers all 25 objectives with topic families and LEARN homes', async () => {
  const coverage = await json(coveragePath);
  const ledger = await json(networkPath);
  const certification = coverage.mandatory_certifications.find((item) => item.exam === 'N10-009');
  const expected = objectiveSet(certification);
  const actual = new Set(Object.keys(ledger.objectives));

  assert.equal(actual.size, 25);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(ledger.semantics.learn_required, true);
  assert.equal(ledger.semantics.assessment_required, true);
  assert.equal(ledger.semantics.lab, 'Deferred until the PRIM3 game lab design conversation.');

  for (const [id, entry] of Object.entries(ledger.objectives)) {
    assert.ok(expected.has(id));
    assert.ok(Array.isArray(entry.topic_groups) && entry.topic_groups.length > 0, `${id} has no topic groups`);
    assertModuleHomes(entry, true);
  }
});

test('A Plus v15 is tracked as a 63 objective precursor overlay and is not a completion gate', async () => {
  const map = await json(aPlusPath);
  assert.equal(map.role, 'SUPPORTING_PRECURSOR_NOT_COMPLETION_GATE');
  assert.equal(map.exams.length, 2);

  const core1 = map.exams.find((exam) => exam.exam.includes('220-1201'));
  const core2 = map.exams.find((exam) => exam.exam.includes('220-1202'));
  assert.ok(core1);
  assert.ok(core2);
  assert.equal(core1.numbered_objective_count, 27);
  assert.equal(core2.numbered_objective_count, 36);
  assert.equal(Object.keys(core1.objectives).length, 27);
  assert.equal(Object.keys(core2.objectives).length, 36);
  assert.equal(map.total_numbered_objective_count, 63);

  for (const exam of map.exams) {
    for (const entry of Object.values(exam.objectives)) assertModuleHomes(entry, false);
  }
});

test('overlap graph credits shared concept mastery without duplicate conventional work', async () => {
  const coverage = await json(coveragePath);
  const aPlus = await json(aPlusPath);
  const graph = await json(overlapPath);
  const securityValid = objectiveSet(coverage.mandatory_certifications.find((item) => item.exam === 'SY0-701'));
  const networkValid = objectiveSet(coverage.mandatory_certifications.find((item) => item.exam === 'N10-009'));
  const core1Valid = new Set(Object.keys(aPlus.exams.find((exam) => exam.exam.includes('220-1201')).objectives));
  const core2Valid = new Set(Object.keys(aPlus.exams.find((exam) => exam.exam.includes('220-1202')).objectives));

  assert.equal(graph.status, 'CANONICAL_CONCEPT_MASTERY_GRAPH');
  assert.equal(graph.progress_semantics.atomic_unit, 'canonical_concept');
  assert.equal(graph.progress_semantics.learn_mastery_required, true);
  assert.equal(graph.progress_semantics.lab_status, 'DEFERRED_TO_GAME_DESIGN');
  assert.match(graph.progress_semantics.shared_credit_rule, /credits every linked certification objective/i);
  assert.match(graph.progress_semantics.duplicate_work_rule, /must not repeat/i);
  assert.ok(graph.nodes.length >= 25);

  const ids = new Set();
  for (const node of graph.nodes) {
    assert.ok(node.id && !ids.has(node.id), `duplicate concept node ${node.id}`);
    ids.add(node.id);
    assertModuleHomes(node, false);
    for (const id of node.security_plus) assert.ok(securityValid.has(id), `invalid Security Plus ref ${id} in ${node.id}`);
    for (const id of node.network_plus) assert.ok(networkValid.has(id), `invalid Network Plus ref ${id} in ${node.id}`);
    for (const id of node.a_plus_core1) assert.ok(core1Valid.has(id), `invalid A Plus Core 1 ref ${id} in ${node.id}`);
    for (const id of node.a_plus_core2) assert.ok(core2Valid.has(id), `invalid A Plus Core 2 ref ${id} in ${node.id}`);
  }
});

test('coverage contract keeps 66 modules and distinguishes mandatory exams from A Plus precursor tracking', async () => {
  const coverage = await json(coveragePath);
  assert.equal(coverage.instructional_module_count, 66);
  assert.equal(coverage.mandatory_numbered_objective_count, 53);
  assert.equal(coverage.supporting_precursor.numbered_objective_count, 63);
  assert.equal(coverage.supporting_precursor.completion_gate, false);
  assert.equal(coverage.raw_cross_certification_numbered_objective_reference_count, 116);
  assert.equal(coverage.mastery_model.atomic_unit, 'canonical concept');
  assert.match(coverage.mastery_model.rule, /credit every linked certification objective/i);
  assert.match(coverage.modality_model.learn, /Mandatory complete conventional instruction/i);
  assert.match(coverage.modality_model.lab, /Detailed lab design is deferred/i);
});

test('modality contract makes LEARN complete and keeps music story and game as reinforcement or application', async () => {
  const source = await readFile(modalityPath, 'utf8');
  assert.match(source, /LEARN is the complete conventional course/);
  assert.match(source, /song never substitutes for conventional instruction/);
  assert.match(source, /WATCH does not replace the complete explanation in LEARN/);
  assert.match(source, /Detailed lab design is intentionally deferred/);
  assert.match(source, /one coherent curriculum through multiple forms of explanation, memory and application/);
});
