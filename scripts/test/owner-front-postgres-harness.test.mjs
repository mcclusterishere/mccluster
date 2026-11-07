import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCanonicalTarget } from '../test-owner-front-postgres.mjs';
const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('canonical replay harness refuses nonlocal, redirected or unacknowledged targets before opening a connection', () => {
  assert.equal(validateCanonicalTarget(local, '1'), local);
  for (const url of [
    local.replace('127.0.0.1', 'db.example.com'),
    local.replace('127.0.0.1', 'localhost'),
    local.replace('54322', '5432'),
    local.replace('/postgres', '/customer'),
    local + '?host=db.example.com', local + '?service=production', local + '#anything',
    local.replace('postgresql:', 'https:')
  ]) assert.throws(() => validateCanonicalTarget(url, '1'));
  for (const flag of [undefined, '', 'true', '0']) assert.throws(() => validateCanonicalTarget(local, flag));
});

test('full replay proof follows the unmodified manifest gate and always tears down the isolated stack', () => {
  const source = readFileSync(new URL('../../.github/workflows/reconciliation-ci.yml', import.meta.url), 'utf8');
  const gate = source.indexOf('--snapshot "$RUNNER_TEMP/reset-schema/reset-schema-snapshot.json"');
  const proof = source.indexOf('node scripts/test-owner-front-postgres.mjs --canonical-reset');
  const stop = source.indexOf('- name: Stop isolated stack');
  assert.ok(gate > 0 && proof > gate && stop > proof);
  assert.match(source.slice(stop), /if: always\(\)/);
  const harness = readFileSync(new URL('../test-owner-front-postgres.mjs', import.meta.url), 'utf8');
  assert.match(harness, /wait_event_type === 'Lock'/);
  assert.match(harness, /assert\.equal\(result\.error\?\.code, '40001'/);
  assert.match(harness, /if \(!canonical\) await localSubset\(db\)/);
});
