import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const coveragePath = resolve(root, 'docs', 'prim3', 'COMPTIA-COVERAGE.json');
const lessonMapPath = resolve(root, 'docs', 'prim3', 'LESSON-CERTIFICATION-MAP.json');
const conceptMapPath = resolve(root, 'docs', 'prim3', 'SONG-CONCEPT-CROSSWALK.json');
const lessonMapMarkdownPath = resolve(root, 'docs', 'prim3', 'LESSON-CERTIFICATION-MAP.md');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const securityObjectives = [
  '1.1', '1.2', '1.3', '1.4',
  '2.1', '2.2', '2.3', '2.4', '2.5',
  '3.1', '3.2', '3.3', '3.4',
  '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9',
  '5.1', '5.2', '5.3', '5.4', '5.5', '5.6'
];

const networkObjectives = [
  '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8',
  '2.1', '2.2', '2.3', '2.4',
  '3.1', '3.2', '3.3', '3.4', '3.5',
  '4.1', '4.2', '4.3',
  '5.1', '5.2', '5.3', '5.4', '5.5'
];

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function expectedModulesForUnit(unitNumber) {
  const first = 4 + (unitNumber - 1) * 3;
  return [first, first + 1, first + 2].map((n) => `M${String(n).padStart(2, '0')}`);
}

test('the lesson certification map contains exactly the fixed sixty six modules', async () => {
  const map = await json(lessonMapPath);
  assert.equal(map.course, 'prim3-foundation-v3');
  assert.equal(map.module_count, 66);
  assert.equal(map.foundation_module_count, 3);
  assert.equal(map.song_aligned_module_count, 63);
  assert.equal(map.modules.length, 66);

  const expectedIds = Array.from({ length: 66 }, (_, index) => `M${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(map.modules.map((module) => module.id), expectedIds);
  assert.equal(new Set(map.modules.map((module) => module.id)).size, 66);

  for (const module of map.modules.slice(0, 3)) {
    assert.equal(module.unit, null);
    assert.equal(module.song, null);
    assert.equal(module.origin, 'mccluster-certification-foundation');
  }

  for (const module of map.modules.slice(3)) {
    const number = Number(module.id.slice(1));
    if (number >= 55 && number <= 57) {
      assert.equal(module.unit, 'U18');
      assert.equal(module.song, null);
      assert.equal(module.status, 'blocked');
      assert.equal(module.origin, 'owner-source-required');
      assert.deepEqual(module.security_plus, []);
      assert.deepEqual(module.network_plus, []);
    } else {
      assert.ok(module.unit, `${module.id} must identify its PRIM3 source unit`);
      assert.ok(module.song, `${module.id} must identify its known source song`);
      assert.ok(module.security_plus.length + module.network_plus.length > 0, `${module.id} needs at least one planned exam home`);
    }
  }
});

test('all twenty one PRIM3 source slots map to exactly three consecutive LMS modules', async () => {
  const map = await json(lessonMapPath);
  for (let unitNumber = 1; unitNumber <= 21; unitNumber += 1) {
    const unitId = `U${String(unitNumber).padStart(2, '0')}`;
    const expected = expectedModulesForUnit(unitNumber);
    const actual = map.modules.filter((module) => module.unit === unitId).map((module) => module.id);
    assert.deepEqual(actual, expected, `${unitId} must own ${expected.join(', ')}`);
  }
});

test('the planned module map assigns every numbered objective on both mandatory exams', async () => {
  const map = await json(lessonMapPath);
  const securitySeen = new Set(map.modules.flatMap((module) => module.security_plus));
  const networkSeen = new Set(map.modules.flatMap((module) => module.network_plus));

  assert.deepEqual(sorted(securitySeen), sorted(securityObjectives));
  assert.deepEqual(sorted(networkSeen), sorted(networkObjectives));

  for (const module of map.modules) {
    for (const id of module.security_plus) assert.ok(securityObjectives.includes(id), `${module.id} has invalid Security+ objective ${id}`);
    for (const id of module.network_plus) assert.ok(networkObjectives.includes(id), `${module.id} has invalid Network+ objective ${id}`);
  }
});

test('the concept crosswalk covers every source slot without inventing the protected open song', async () => {
  const crosswalk = await json(conceptMapPath);
  assert.equal(crosswalk.course, 'prim3-foundation-v3');
  assert.equal(crosswalk.units.length, 21);
  assert.deepEqual(crosswalk.units.map((unit) => unit.unit), Array.from({ length: 21 }, (_, index) => `U${String(index + 1).padStart(2, '0')}`));

  for (let unitNumber = 1; unitNumber <= 21; unitNumber += 1) {
    const unit = crosswalk.units[unitNumber - 1];
    assert.deepEqual(unit.modules, expectedModulesForUnit(unitNumber));
    if (unitNumber === 18) {
      assert.equal(unit.song, null);
      assert.equal(unit.status, 'owner-source-required');
      assert.deepEqual(unit.concepts, []);
      continue;
    }
    assert.ok(unit.song, `${unit.unit} must retain the canonical song identity`);
    assert.ok(unit.concepts.length > 0, `${unit.unit} must expose source concepts`);
  }
});

test('every concept exam reference is valid and empty mappings remain legal', async () => {
  const crosswalk = await json(conceptMapPath);
  let conceptCount = 0;
  let emptySecurityMappings = 0;
  let emptyNetworkMappings = 0;

  for (const unit of crosswalk.units) {
    for (const concept of unit.concepts) {
      conceptCount += 1;
      assert.ok(String(concept.concept || '').trim(), `${unit.unit} contains an unnamed concept`);
      assert.ok(Array.isArray(concept.security_plus));
      assert.ok(Array.isArray(concept.network_plus));
      for (const id of concept.security_plus) assert.ok(securityObjectives.includes(id), `${unit.unit} concept ${concept.concept} has invalid Security+ objective ${id}`);
      for (const id of concept.network_plus) assert.ok(networkObjectives.includes(id), `${unit.unit} concept ${concept.concept} has invalid Network+ objective ${id}`);
      if (!concept.security_plus.length) emptySecurityMappings += 1;
      if (!concept.network_plus.length) emptyNetworkMappings += 1;
    }
  }

  assert.ok(conceptCount >= 150, `expected a comprehensive source concept map, found only ${conceptCount} concepts`);
  assert.ok(emptySecurityMappings > 0, 'the map must allow concepts that do not naturally fit Security+');
  assert.ok(emptyNetworkMappings > 0, 'the map must allow concepts that do not naturally fit Network+');
});

test('lesson map song identities agree with the source concept crosswalk', async () => {
  const map = await json(lessonMapPath);
  const crosswalk = await json(conceptMapPath);

  for (const unit of crosswalk.units) {
    const modules = map.modules.filter((module) => module.unit === unit.unit);
    assert.equal(modules.length, 3);
    for (const module of modules) assert.equal(module.song, unit.song, `${module.id} song identity drifted from ${unit.unit}`);
  }
});

test('coverage contract points to the comprehensive maps without claiming planned work is complete', async () => {
  const coverage = await json(coveragePath);
  assert.equal(coverage.version, '2.1.0');
  assert.equal(coverage.mapped_lesson_count, 66);
  assert.equal(coverage.known_song_unit_count, 20);
  assert.equal(coverage.blocked_source_unit_count, 1);
  assert.equal(coverage.lesson_map_markdown, 'docs/prim3/LESSON-CERTIFICATION-MAP.md');
  assert.equal(coverage.lesson_map_json, 'docs/prim3/LESSON-CERTIFICATION-MAP.json');
  assert.equal(coverage.source_concept_crosswalk_json, 'docs/prim3/SONG-CONCEPT-CROSSWALK.json');
  assert.equal(coverage.completion_contract.planned_assignment_is_completion, false);
  assert.equal(coverage.completion_contract.official_bullets_required, 'ALL');
  assert.equal(coverage.completion_contract.official_nested_bullets_required, 'ALL');
  assert.match(coverage.completion_contract.unknown_source_rule, /U18/);

  const markdown = await readFile(lessonMapMarkdownPath, 'utf8');
  assert.match(markdown, /## U01 High Alert/);
  assert.match(markdown, /## U17 Patch Work/);
  assert.match(markdown, /## U18 Open Song 21/);
  assert.match(markdown, /OWNER SOURCE REQUIRED/);
  assert.match(markdown, /## U19 RAID HOT SITE/);
  assert.match(markdown, /## U20 Evil Twin/);
  assert.match(markdown, /## U21 Ghost In The Wires/);
});
