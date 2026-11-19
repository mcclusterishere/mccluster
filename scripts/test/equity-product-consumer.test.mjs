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
  // Module policy is the persisted owner decision, not a constant in the adapter (changed on purpose 2026-11-10:
  // this line used to pin a built-in state:'enabled'). The adapter holds no policy literal of any state and
  // loadPolicy reads module 'environment' through the one reader, which names the service-only RPC.
  assert.doesNotMatch(source,/implementationPolicy/);assert.doesNotMatch(source,/state\s*:\s*['"`](?:enabled|draining|disabled)['"`]/);
  assert.doesNotMatch(source,/equity-uprise\.module-policy\/v1/);
  // Changed on purpose 2026-11-19 (event timeline slice S0, docs/control-plane/EUP-EVENT-TIMELINE.md): the request's one policy read
  // moved to ./world-environment-guard.js, so a never-installed module (the store's EUM01) answers off and the layer routes and the
  // pinned server share one read. loadPolicy is that read (policyLoader over policyRead); both, and the mutation gate's second read,
  // still go through the one reader, and the guard holds no policy literal either.
  assert.match(source,/const read=policyRead\(env,fetchImpl\);/);
  assert.match(source,/loadPolicy:policyLoader\(read,env,fetchImpl\)/);
  assert.match(source,/import \{[^}]*\bpolicyLoader\b[^}]*\bpolicyRead\b[^}]*\} from '\.\/world-environment-guard\.js'/);
  const guard=read('workers/mccluster/src/world-environment-guard.js').toString();
  assert.match(guard,/import \{ readModulePolicy \} from '\.\/eup\/modules\.js'/);
  assert.equal((guard.match(/readModulePolicy\(env, fetchImpl, 'environment'\)/g)||[]).length,2,'the request\'s read and the mutation gate\'s second read');
  assert.doesNotMatch(guard,/state\s*:\s*['"`](?:enabled|draining|disabled)['"`]/);assert.doesNotMatch(guard,/equity-uprise\.module-policy\/v1/);
  const reader=read('workers/mccluster/src/eup/modules.js').toString();
  assert.match(reader,/export async function readModulePolicy\(env, fetchImpl, module\)/);
  assert.match(reader,/call\(env, fetchImpl, plain, 'eup_module_policy_read', \{ p_module: module \}/);
  assert.doesNotMatch(reader,/state\s*:\s*['"`](?:enabled|draining|disabled)['"`]/);
});

test('a patch names the suites that exercise it: from the release polish on, every regression test names a defect of its patch (review of the release polish, RP-5)', () => {
  // The release polish's entry first named the lifecycle suite, which exercises none of its three patches: every named file exists
  // (the test above reads each one), so nothing noticed. From that entry on, each regression test a patch lists must name, in its
  // own words, at least one defect of that patch; a suite carried over from the entry before it is caught here.
  const lock = JSON.parse(read('vendor/equity-uprise/product-source.lock.json'));
  const from = lock.local_patches.findIndex(patch => patch.defects.some(defect => defect.id === 'V2-M2'));
  assert.ok(from >= 0, 'the release polish is recorded in the lock');
  const held = lock.local_patches.slice(from);
  assert.ok(held.length >= 2, 'the release polish and its review');
  const names = (source, id) => new RegExp(`(?<![A-Za-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`).test(source);
  for (const patch of held) {
    const ids = patch.defects.map(defect => defect.id);
    assert.ok(patch.regression_tests.length > 0, `${ids.join(', ')}: a patch lists at least one regression test`);
    for (const path of patch.regression_tests) assert.ok(ids.some(id => names(read(path).toString(), id)), `${path} names none of ${ids.join(', ')}`);
  }
});
