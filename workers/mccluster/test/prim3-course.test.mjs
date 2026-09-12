import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const prim3Path = resolve(here, '..', 'src', 'prim3', 'index.js');
const workerPath = resolve(here, '..', 'src', 'index.js');
const frontendPath = resolve(here, '..', '..', '..', 'js', 'prim3.js');
const lessonsPath = resolve(here, '..', '..', '..', 'js', 'prim3-lessons.js');
const syncPath = resolve(here, '..', '..', '..', 'js', 'prim3-sync.js');
const htmlPath = resolve(here, '..', '..', '..', 'prim3.html');
const coveragePath = resolve(here, '..', '..', '..', 'docs', 'prim3', 'COMPTIA-COVERAGE.json');
const architecturePath = resolve(here, '..', '..', '..', 'docs', 'prim3', 'LMS-INGESTION.md');

async function text(path) {
  return readFile(path, 'utf8');
}

test('PRIM3 keeps 21 source units and builds exactly 66 LMS modules', async () => {
  const source = await text(prim3Path);
  assert.match(source, /const SOURCE_UNIT_COUNT = 21/);
  assert.match(source, /const FOUNDATION_MODULE_COUNT = 3/);
  assert.match(source, /const SONG_ALIGNED_MODULE_COUNT = SOURCE_UNIT_COUNT \* 3/);
  assert.match(source, /const INSTRUCTIONAL_MODULE_COUNT = FOUNDATION_MODULE_COUNT \+ SONG_ALIGNED_MODULE_COUNT/);
  assert.match(source, /\[\.\.\.foundationModules\(\), \.\.\.sourceCourse\.modules\.flatMap\(expandUnit\)\]/);
  assert.match(source, /module_count: modules\.length/);
  assert.match(source, /foundation_module_count: FOUNDATION_MODULE_COUNT/);
  assert.match(source, /song_aligned_module_count: SONG_ALIGNED_MODULE_COUNT/);
  assert.match(source, /module_strategy: '3 certification foundation modules plus 3 instructional modules per episode and song unit'/);
  assert.match(source, /schema_version: '3\.0\.0'/);
  assert.match(source, /const COURSE_ID = 'prim3-foundation-v3'/);
});

test('the first three modules are certification foundations with no song or episode attachment', async () => {
  const source = await text(prim3Path);
  assert.match(source, /function foundationModules\(\)/);
  assert.match(source, /foundation: true/);
  assert.match(source, /unit_id: null/);
  assert.match(source, /episode_id: null/);
  assert.match(source, /episode_title: null/);
  assert.match(source, /song: null/);
  assert.match(source, /curriculum_origin: 'mccluster-certification-foundation'/);
  assert.match(source, /id: 'M01'[\s\S]*title: 'Security Foundations and Risk'/);
  assert.match(source, /id: 'M02'[\s\S]*title: 'Networking Foundations'/);
  assert.match(source, /id: 'M03'[\s\S]*title: 'Identity, Cryptography and Access'/);
  assert.match(source, /const firstSequence = FOUNDATION_MODULE_COUNT \+ unitIndex \* 3 \+ 1/);
});

test('authored coursework is separated from the controller and blocks forbidden dash punctuation', async () => {
  const lessons = await text(lessonsPath);
  const frontend = await text(frontendPath);
  assert.doesNotThrow(() => new Function(lessons));
  assert.doesNotThrow(() => new Function(frontend));
  assert.match(frontend, /var LESSONS = window\.PRIM3_LESSONS \|\| \{\}/);
  assert.match(lessons, /validateAuthoredLessonCopy/);
  assert.match(lessons, /M01:\s*\{\s*title: "Security Foundations and Risk"/);
  assert.match(lessons, /M02:\s*\{\s*title: "Networking Foundations"/);
  assert.match(lessons, /M03:\s*\{\s*title: "Identity, Cryptography and Access"/);
  assert.match(lessons, /M04:\s*\{\s*title: "Alerts, Monitoring and Triage"/);
  assert.match(lessons, /M05:\s*\{\s*title: "Scope, Authorization and Evidence"/);
  assert.match(lessons, /M06:\s*\{\s*title: "Monitoring Infrastructure and Incident Response"/);
  assert.match(lessons, /M07:\s*\{\s*title: "White Grey Black Hat"/);
  assert.match(lessons, /M08:\s*\{\s*title: "White Grey Black Box"/);
  assert.match(lessons, /M09:\s*\{\s*title: "Penetration Testing Infrastructure, Scope and Remediation"/);
  const bodyStart = lessons.indexOf('window.PRIM3_LESSONS = {');
  const validatorStart = lessons.indexOf('(function validateAuthoredLessonCopy()');
  assert.ok(bodyStart >= 0 && validatorStart > bodyStart);
  const authoredCopy = lessons.slice(bodyStart, validatorStart);
  assert.doesNotMatch(authoredCopy, /[-\u2013\u2014]/);
  assert.equal((authoredCopy.match(/quiz:\s*\[/g) || []).length, 9);
  assert.equal((authoredCopy.match(/reading:\s*\[/g) || []).length, 9);
});

test('High Alert is shifted to M04 through M06 and White Grey Black Hat is shifted to M07 through M09', async () => {
  const lessons = await text(lessonsPath);
  assert.match(lessons, /M04:[\s\S]*High Alert/);
  assert.match(lessons, /M05:[\s\S]*High Alert/);
  assert.match(lessons, /M06:[\s\S]*High Alert/);
  assert.match(lessons, /M07:[\s\S]*White hat/);
  assert.match(lessons, /M08:[\s\S]*White box/);
  assert.match(lessons, /M09:[\s\S]*Vulnerability management/);
});

test('hat and box material remains separate in the curriculum adapter', async () => {
  const source = await text(prim3Path);
  assert.match(source, /\['White Grey Black Hat', 'White Grey Black Box', 'Penetration Testing Infrastructure, Scope and Remediation'\]/);
  assert.match(source, /part_label: 'SONG CORE A'/);
  assert.match(source, /part_label: 'SONG CORE B'/);
  assert.match(source, /part_label: 'INFRASTRUCTURE AND EXAM BRIDGE'/);
});

test('team role source unit still separates red and blue from purple and white', async () => {
  const source = await text(prim3Path);
  assert.match(source, /\['Red and Blue Teams', 'Purple and White Teams', 'Security Engineering Teams and Exercise Operations'\]/);
  assert.match(source, /\['red team', 'blue team'\]/);
  assert.match(source, /\['purple team', 'white team'\]/);
  assert.match(source, /const sourceRemainder = sourceConcepts\.filter/);
});

test('Security Plus and Network Plus are mandatory complete coverage targets', async () => {
  const coverage = JSON.parse(await text(coveragePath));
  assert.equal(coverage.course, 'prim3-foundation-v3');
  assert.equal(coverage.instructional_module_count, 66);
  assert.equal(coverage.foundation_module_count, 3);
  assert.equal(coverage.song_aligned_module_count, 63);
  assert.equal(coverage.source_unit_count, 21);
  assert.equal(coverage.mandatory_numbered_objective_count, 53);
  assert.equal(coverage.mandatory_certifications.length, 2);
  const security = coverage.mandatory_certifications.find((item) => item.exam === 'SY0-701');
  const network = coverage.mandatory_certifications.find((item) => item.exam === 'N10-009');
  assert.ok(security);
  assert.ok(network);
  assert.equal(security.numbered_objective_count, 28);
  assert.equal(network.numbered_objective_count, 25);
  assert.equal(security.domains.flatMap((domain) => domain.objectives).length, 28);
  assert.equal(network.domains.flatMap((domain) => domain.objectives).length, 25);
  assert.equal(coverage.completion_contract.official_bullets_required, 'ALL');
  assert.equal(coverage.completion_contract.official_nested_bullets_required, 'ALL');
  assert.equal(coverage.module_structure.hard_ceiling, 66);
  assert.equal(coverage.module_structure.next_module_forbidden, 'M67');
});

test('active LMS documentation no longer treats 63 as the whole course', async () => {
  const architecture = await text(architecturePath);
  const html = await text(htmlPath);
  assert.match(architecture, /Canon(?:ical)? curriculum rule: 66 modules/i);
  assert.match(architecture, /foundation_module_count = 3/);
  assert.match(architecture, /song_aligned_module_count = 63/);
  assert.match(architecture, /module_count = 66/);
  assert.doesNotMatch(architecture, /(^|\n)module_count = 63(\n|$)/);
  assert.match(html, /66 focused modules/);
  assert.match(html, /3 foundations · 7 seasons · 21 episode and song units · 66 modules/);
  assert.match(html, /js\/prim3-lessons\.js/);
  assert.doesNotMatch(html, />63<\/dt>/);
});

test('course access and progress require an M Account while tuition remains free', async () => {
  const source = await text(prim3Path);
  assert.match(source, /M Account required for the free PRIM3 course/);
  assert.match(source, /account_required: true/);
  assert.match(source, /price_cents: 0/);
  assert.match(source, /await requireLearner\(request, env\)/);
  assert.match(source, /prim3_course_progress/);
});

test('new module meanings use new remote and local progress namespaces', async () => {
  const source = await text(prim3Path);
  const frontend = await text(frontendPath);
  const sync = await text(syncPath);
  assert.match(source, /const COURSE_ID = 'prim3-foundation-v3'/);
  assert.match(frontend, /prim3_course_progress_v4/);
  assert.match(sync, /prim3_course_progress_v4/);
  assert.match(sync, /prim3_progress_bootstrap_v3/);
  assert.doesNotMatch(frontend, /prim3_course_progress_v3/);
});

test('PRIM3 routes remain inside the canonical mccluster Worker', async () => {
  const source = await text(workerPath);
  assert.match(source, /import prim3 from '\.\/prim3\/index\.js'/);
  assert.match(source, /path === '\/v1\/prim3'/);
  assert.match(source, /return prim3\.fetch\(request, env\)/);
  assert.match(source, /export \{ HereTenantAgent \}/);
  assert.doesNotMatch(source, /mccluster-core/);
});

test('source provenance, foundation curriculum and enrichment are distinguished', async () => {
  const source = await text(prim3Path);
  assert.match(source, /mccluster-certification-foundation/);
  assert.match(source, /curriculum_origin: 'prim3-source'/);
  assert.match(source, /mccluster-enrichment/);
  assert.match(source, /prim3-source\+mccluster-enrichment/);
  assert.match(source, /mandatory_certifications: \['Security\+ SY0-701', 'Network\+ N10-009'\]/);
});

test('protected owner source remains uninvented', async () => {
  const source = await text(prim3Path);
  assert.match(source, /sourceLocked = unit\.status === 'owner-source-required'/);
  assert.match(source, /'Owner Source Required Part One', 'Owner Source Required Part Two', 'Infrastructure Bridge Pending Source'/);
  assert.match(source, /status: sourceLocked \? 'owner-source-required'/);
});

test('the API exposes all instructional modules and the original source units', async () => {
  const source = await text(prim3Path);
  assert.match(source, /course\\\/modules/);
  assert.match(source, /course\\\/units/);
  assert.match(source, /foundation_module_count: course\.foundation_module_count/);
  assert.match(source, /song_aligned_module_count: course\.song_aligned_module_count/);
});
