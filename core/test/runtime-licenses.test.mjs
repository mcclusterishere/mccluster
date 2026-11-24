import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const record = JSON.parse(await readFile(new URL('../compute-runtime-licenses.json', import.meta.url), 'utf8'));

test('every runtime engine beneath the adapter is pinned to an exact revision with a hashed, named license', () => {
  assert.equal(record.schema, 'mccluster-runtime-licenses/1');
  assert.ok(Array.isArray(record.engines) && record.engines.length >= 3);
  for (const engine of record.engines) {
    assert.match(engine.pinned_commit, /^[a-f0-9]{40}$/, `${engine.engine} must pin a full commit`);
    assert.match(engine.license.sha256, /^[a-f0-9]{64}$/, `${engine.engine} must hash its LICENSE bytes`);
    assert.ok(['Apache-2.0', 'MIT'].includes(engine.license.spdx), `${engine.engine} license ${engine.license.spdx} is not one this repository has reviewed`);
    assert.equal(engine.license.copyleft, false, `${engine.engine} must not be copyleft without a separate review`);
    assert.match(engine.repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.ok(typeof engine.status === 'string' && engine.status.length > 10);
  }
  const exo = record.engines.find((e) => e.engine === 'exo');
  assert.match(exo.status, /no shared-inference claim/, 'shared inference stays unclaimed until a real two-device run is recorded');
});
