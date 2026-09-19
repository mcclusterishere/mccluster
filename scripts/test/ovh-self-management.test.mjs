import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('local bootstrap installs and enables both reconciliation and health timers', async () => {
  const source = await read('scripts/bootstrap-vps-self-management.sh');
  assert.match(source, /mccluster-vps-reconcile\.timer/);
  assert.match(source, /mccluster-core-system-health\.timer/);
  assert.match(source, /systemctl enable --now mccluster-vps-reconcile\.timer/);
  assert.match(source, /systemctl enable --now mccluster-core-system-health\.timer/);
  assert.match(source, /systemctl start mccluster-vps-reconcile\.service/);
});

test('automatic OVH production pushes verify self-reconciliation without SSH', async () => {
  const workflow = await read('.github/workflows/deploy-ovh-core.yml');
  const verifyStart = workflow.indexOf('verify-self-reconcile:');
  const deployStart = workflow.indexOf('\n  deploy:', verifyStart);
  assert.ok(verifyStart > 0 && deployStart > verifyStart);

  const verify = workflow.slice(verifyStart, deployStart);
  assert.match(verify, /github\.event_name == 'push'/);
  assert.match(verify, /https:\/\/core\.mccluster\.org\/health/);
  assert.match(verify, /deployment_sha/);
  assert.doesNotMatch(verify, /OVH_SSH_KEY|ssh |rsync /);

  const fallback = workflow.slice(deployStart);
  assert.match(fallback, /github\.event_name == 'workflow_dispatch'/);
  assert.match(fallback, /OVH_SSH_KEY/);
  assert.match(fallback, /Break-glass SSH deploy/);
});

test('public Core liveness exposes only safe deployment provenance', async () => {
  const source = await read('core/src/tool-broker.mjs');
  assert.match(source, /deployment_sha: deployedRevision\(\)/);
  assert.match(source, /\.mccluster-deploy\.json/);
  assert.match(source, /if \(!authenticated\)/);
});
