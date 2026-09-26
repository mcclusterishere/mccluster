import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

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


test('reconciler sandbox permits only deploy-controlled configuration writes', async () => {
  const source = await read('core/systemd/mccluster-vps-reconcile.service');
  assert.match(source, /ProtectSystem=full/);
  assert.match(source, /ReadWritePaths=.*\/etc\/systemd\/system/);
  assert.match(source, /ReadWritePaths=.*\/etc\/polkit-1\/rules\.d/);
  assert.match(source, /ReadWritePaths=.*\/etc\/mccluster-node/);
  assert.doesNotMatch(source, /ProtectSystem=false/);
});

test('rollback ignores optional services that are not installed', async () => {
  const source = await read('scripts/deploy-ovh-core.sh');
  assert.match(source, /systemctl list-unit-files "\$\{unit\}"/);
  assert.match(source, /systemctl try-restart "\$\{unit\}" \|\| true/);
});


test('reconciler ignores directory mtimes while still attesting live file content', async () => {
  const source = await read('scripts/mccluster-vps-reconcile.sh');
  assert.match(source, /rsync -acni --delete --omit-dir-times/,
    'deploy manifest writes must not turn the Core directory mtime into false runtime drift');
  assert.match(source, /--exclude '\.mccluster-deploy\.json'/,
    'the separately attested deployment manifest must stay outside the Core file comparison');
});


test('the OVH reconciler itself is a versioned deploy artifact with rollback', async () => {
  const [service, bootstrap, deploy] = await Promise.all([
    read('core/systemd/mccluster-vps-reconcile.service'),
    read('scripts/bootstrap-vps-self-management.sh'),
    read('scripts/deploy-ovh-core.sh'),
  ]);

  assert.match(service, /ExecStart=\/opt\/mccluster\/reconcile\/mccluster-vps-reconcile\.sh/);
  assert.match(bootstrap, /\/opt\/mccluster\/reconcile\/mccluster-vps-reconcile\.sh/);
  assert.match(deploy, /scripts\/mccluster-vps-reconcile\.sh/);
  assert.match(deploy, /BACKUP_DIR}\/reconcile-script/);
  assert.match(deploy, /RECONCILE_SCRIPT/);
});


test('OVH self-management shell scripts remain syntactically valid', () => {
  assert.doesNotThrow(() => execFileSync('bash', [
    '-n',
    'scripts/mccluster-vps-reconcile.sh',
    'scripts/deploy-ovh-core.sh',
    'scripts/bootstrap-vps-self-management.sh',
  ], { stdio: 'pipe' }));
});
