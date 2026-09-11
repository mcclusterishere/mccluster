import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const prim3Path = resolve(here, '..', 'src', 'prim3', 'index.js');
const workerPath = resolve(here, '..', 'src', 'index.js');

async function text(path) {
  return readFile(path, 'utf8');
}

test('PRIM3 ingestion points at the canonical Prim3 publication feed', async () => {
  const source = await text(prim3Path);
  assert.match(source, /mcclusterishere\/Prim3\/main\/learning\/course\/course-feed\.json/);
  assert.match(source, /schema_version !== '1\.0\.0'/);
  assert.match(source, /modules\.length !== 21/);
  assert.match(source, /course\.id !== COURSE_ID/);
});

test('PRIM3 routes remain inside the canonical mccluster Worker', async () => {
  const source = await text(workerPath);
  assert.match(source, /import prim3 from '\.\/prim3\/index\.js'/);
  assert.match(source, /path === '\/v1\/prim3'/);
  assert.match(source, /return prim3\.fetch\(request, env\)/);
  assert.match(source, /export \{ HereTenantAgent \}/);
  assert.doesNotMatch(source, /mccluster-core/);
});

test('PRIM3 learner state is authenticated and separate from course canon', async () => {
  const source = await text(prim3Path);
  assert.match(source, /Authentication required for synced PRIM3 progress/);
  assert.match(source, /prim3_course_progress/);
  assert.match(source, /user_id=eq\.\$\{encodeURIComponent\(user\.id\)\}/);
  assert.match(source, /\/v1\/prim3\/progress/);
});

test('protected open module is preserved rather than invented', async () => {
  const source = await text(prim3Path);
  assert.match(source, /module\.id === 'M18'/);
  assert.match(source, /owner-source-required/);
});
