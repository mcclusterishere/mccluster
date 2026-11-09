import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as compatibility from '../../js/world-environment.mjs';
import * as product from '../../vendor/equity-uprise/src/environment/panel.mjs';
const read = path => readFileSync(new URL('../../'+path,import.meta.url));
test('McCluster imports the exact pinned Equity Uprise source through its stable path', () => {
  const lock = JSON.parse(read('vendor/equity-uprise/product-source.lock.json'));
  assert.equal(lock.repository, 'mcclusterishere/Equity-Uprise'); assert.match(lock.commit, /^[a-f0-9]{40}$/);
  for (const file of lock.files) assert.equal(createHash('sha256').update(read('vendor/equity-uprise/'+file.path)).digest('hex'), file.sha256, file.path);
  // Local divergence from the pinned upstream is declared, never hidden: each patch names its base commit, defect IDs and regression test.
  for (const patch of lock.local_patches || []) { assert.match(patch.base_commit, /^[a-f0-9]{40}$/); assert.ok(patch.defects.length && patch.files.every(f => lock.files.some(x => x.path === f))); for (const t of patch.regression_tests) read(t); }
  assert.equal(compatibility.mountEnvironment, product.mountEnvironment); assert.equal(compatibility.normalizeFeed, product.normalizeFeed);
});
test('host auth adapter consumes the product transport but retains McCluster identity and API', () => {
  const source = read('js/world-environment-mccluster.mjs').toString();
  assert.match(source, /createEnvironmentTransport/); assert.match(source, /MCC_SUPA/); assert.match(source, /https:\/\/api\.mccluster\.org/);
  assert.doesNotMatch(read('vendor/equity-uprise/src/environment/transport.mjs').toString(), /api\.mccluster\.org|MCC_SUPA/);
});

test('Worker implements product server contracts over the existing auth and persistence adapters', () => {
  const source=read('workers/mccluster/src/world-environment.js').toString();
  assert.match(source,/createEnvironmentServer/);assert.match(source,/world_environment_team/);assert.match(source,/world_environment_join/);assert.match(source,/bearerUser/);assert.match(source,/isHouseOwner/);
  assert.match(source,/state:'enabled'/);assert.match(source,/not a persisted owner module toggle/);
});
