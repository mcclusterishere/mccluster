import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const prim3Path = resolve(here, '..', 'src', 'prim3', 'index.js');
const workerPath = resolve(here, '..', 'src', 'index.js');
const frontendPath = resolve(here, '..', '..', '..', 'js', 'prim3.js');

async function text(path) {
  return readFile(path, 'utf8');
}

test('PRIM3 ingestion keeps 21 canonical episode/song source units but expands the LMS to 63 modules', async () => {
  const source = await text(prim3Path);
  assert.match(source, /mcclusterishere\/Prim3\/main\/learning\/course\/course-feed\.json/);
  assert.match(source, /const SOURCE_UNIT_COUNT = 21/);
  assert.match(source, /const INSTRUCTIONAL_MODULE_COUNT = 63/);
  assert.match(source, /sourceCourse\.modules\.flatMap\(expandUnit\)/);
  assert.match(source, /modules\.length !== INSTRUCTIONAL_MODULE_COUNT/);
  assert.match(source, /module_strategy: '3 instructional modules per episode\/song unit'/);
  assert.match(source, /module_count: modules\.length/);
});

test('Episode One is fully authored as three comprehensive modules with forbidden dash punctuation blocked', async () => {
  const source = await text(frontendPath);
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /M01:\s*\{\s*title: "Alerts, Monitoring and Triage"/);
  assert.match(source, /M02:\s*\{\s*title: "Scope, Authorization and Evidence"/);
  assert.match(source, /M03:\s*\{\s*title: "Monitoring Infrastructure and Incident Response"/);
  assert.match(source, /validateEpisodeOneCopy/);
  assert.match(source, /lessonText/);
  const start = source.indexOf('    M01:');
  const end = source.indexOf('    M04:');
  assert.ok(start >= 0 && end > start);
  const episodeOne = source.slice(start, end);
  assert.doesNotMatch(episodeOne, /[-\u2013\u2014]/);
  assert.ok((episodeOne.match(/q:"/g) || []).length >= 30);
  assert.ok((episodeOne.match(/\[\["/g) || []).length >= 3);
});

test('hat/box material is protected from being recompressed into one beginner lesson', async () => {
  const source = await text(prim3Path);
  assert.match(source, /'White \/ Grey \/ Black Hat', 'White \/ Grey \/ Black Box', 'Pen-Test Infrastructure, Scope & Remediation'/);
  assert.match(source, /part_label: 'SONG CORE A'/);
  assert.match(source, /part_label: 'SONG CORE B'/);
  assert.match(source, /part_label: 'INFRASTRUCTURE \+ EXAM BRIDGE'/);
});

test('team-role source unit separates red-blue from purple-white and preserves remaining source concepts', async () => {
  const source = await text(prim3Path);
  assert.match(source, /'Red & Blue Teams', 'Purple & White Teams', 'Security Engineering Teams & Exercise Operations'/);
  assert.match(source, /\['red team', 'blue team'\]/);
  assert.match(source, /\['purple team', 'white team'\]/);
  assert.match(source, /const sourceRemainder = sourceConcepts\.filter/);
  assert.match(source, /source_concepts: sourceRemainder/);
  assert.match(source, /enrichment_concepts: bridge/);
});

test('course access and progress require an M Account while tuition remains free', async () => {
  const source = await text(prim3Path);
  assert.match(source, /M Account required for the free PRIM3 course/);
  assert.match(source, /account_required: true/);
  assert.match(source, /price_cents: 0/);
  assert.match(source, /await requireLearner\(request, env\)/);
  assert.match(source, /prim3_course_progress/);
});

test('PRIM3 routes remain inside the canonical mccluster Worker', async () => {
  const source = await text(workerPath);
  assert.match(source, /import prim3 from '\.\/prim3\/index\.js'/);
  assert.match(source, /path === '\/v1\/prim3'/);
  assert.match(source, /return prim3\.fetch\(request, env\)/);
  assert.match(source, /export \{ HereTenantAgent \}/);
  assert.doesNotMatch(source, /mccluster-core/);
});

test('source provenance and enrichment are distinguished', async () => {
  const source = await text(prim3Path);
  assert.match(source, /curriculum_origin: 'prim3-source'/);
  assert.match(source, /mccluster-enrichment/);
  assert.match(source, /prim3-source\+mccluster-enrichment/);
  assert.match(source, /CompTIA objective families without treating the song as complete exam coverage/);
  assert.match(source, /A\+ 220-1201/);
  assert.match(source, /Network\+ N10-009/);
  assert.match(source, /Security\+ SY0-701/);
});

test('protected open source unit stays uninvented and expands into protected module slots', async () => {
  const source = await text(prim3Path);
  assert.match(source, /unit\.id === 'U18'/);
  assert.match(source, /owner-source-required/);
  assert.match(source, /'Owner Source Required · Part I', 'Owner Source Required · Part II', 'Infrastructure Bridge · Pending Source'/);
});

test('the API exposes both instructional modules and original source units', async () => {
  const source = await text(prim3Path);
  assert.match(source, /course\\\/modules/);
  assert.match(source, /course\\\/units/);
});
