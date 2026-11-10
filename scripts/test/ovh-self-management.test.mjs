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
  assert.match(verify, /timeout-minutes: 35/);
  assert.match(verify, /deadline=\$\(\(SECONDS \+ 1800\)\)/);
  assert.match(verify, /while \(\( SECONDS < deadline \)\)/);
  assert.match(verify, /--max-time 15/);
  assert.doesNotMatch(verify, /OVH_SSH_KEY|ssh |rsync /);

  const fallback = workflow.slice(deployStart);
  assert.match(fallback, /github\.event_name == 'workflow_dispatch'/);
  assert.match(fallback, /OVH_SSH_KEY/);
  assert.match(fallback, /Break-glass SSH deploy/);
});

test('public Core liveness exposes only safe startup-bound deployment provenance', async () => {
  const [source, revision] = await Promise.all([
    read('core/src/tool-broker.mjs'),
    read('core/src/runtime-revision.mjs'),
  ]);
  assert.match(source, /deployment_sha: deployedRevision\(\)/);
  assert.match(source, /import \{ RUNNING_DEPLOYMENT_SHA \} from '\.\/runtime-revision\.mjs'/);
  assert.match(source, /function deployedRevision\(\)\s*\{\s*return RUNNING_DEPLOYMENT_SHA;/);
  assert.doesNotMatch(source, /readFileSync/,
    'the running broker must not re-read mutable deployment provenance');
  assert.match(revision, /\/opt\/mccluster\/core\/\.mccluster-deploy\.json/);
  assert.match(revision, /export const RUNNING_DEPLOYMENT_SHA = readRevisionAtStartup\(\)/);
  assert.match(source, /if \(!authenticated\)/);
  const publicStart = source.indexOf('if (!authenticated)');
  const publicEnd = source.indexOf('const [listedTools, listedCapabilities]', publicStart);
  assert.ok(publicStart >= 0 && publicEnd > publicStart);
  const publicHealth = source.slice(publicStart, publicEnd);
  assert.doesNotMatch(publicHealth, /upstreams|diagnostics|catalog_version/,
    'public liveness must not expose private inventory or diagnostics');
});


test('reconciler sandbox permits only deploy-controlled configuration writes', async () => {
  const source = await read('core/systemd/mccluster-vps-reconcile.service');
  assert.match(source, /ProtectSystem=full/);
  assert.match(source, /ReadWritePaths=.*\/etc\/systemd\/system/);
  assert.match(source, /ReadWritePaths=.*\/etc\/polkit-1\/rules\.d/);
  assert.match(source, /ReadWritePaths=.*\/etc\/mccluster-node/);
  assert.doesNotMatch(source, /ProtectSystem=false/);
});

test('rollback ignores optional services that are not installed, and really restarts the rest', async () => {
  const [deploy, health] = await Promise.all([
    read('scripts/deploy-ovh-core.sh'),
    read('scripts/ovh-core-health.sh'),
  ]);
  assert.match(health, /systemctl list-unit-files "\$1"/);
  assert.match(health, /mcc_unit_installed "\$\{unit\}" \|\| continue/);
  // try-restart is a no-op for a unit the failed release left stopped.
  assert.doesNotMatch(deploy + health, /^\s*systemctl try-restart/m);
  assert.match(deploy, /mcc_recover_restored_release/);
  assert.match(deploy, /exit "\$\{MCC_ROLLBACK_UNHEALTHY_RC\}"/);
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
    'scripts/ovh-core-health.sh',
    'scripts/bootstrap-vps-self-management.sh',
  ], { stdio: 'pipe' }));
});

test('a promotion names the head it replaces, moves the ref only from that head and verifies the runtime itself', async () => {
  const workflow = await read('.github/workflows/promote-ovh-production.yml');
  const promoteStart = workflow.indexOf('\n  promote:');
  const verifyStart = workflow.indexOf('\n  verify:');
  assert.ok(promoteStart > 0 && verifyStart > promoteStart, 'promote and verify jobs exist');
  const promote = workflow.slice(promoteStart, verifyStart);
  const verify = workflow.slice(verifyStart);

  // The approval names the previous head, and the ref moves only from exactly that head.
  assert.match(workflow, /expected_current:\n\s+description: [^\n]*previous head[^\n]*\n\s+required: true/);
  assert.match(promote, /\[\[ "\$\{TARGET_SHA\}" =~ \^\[0-9a-f\]\{40\}\$ && "\$\{EXPECTED_CURRENT\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  const validated = promote.indexOf('[[ "${CURRENT}" == "${EXPECTED_CURRENT}" ]]');
  const gate = promote.indexOf('require-green-ci.mjs --sha "$TARGET_SHA"');
  const push = promote.indexOf('git push ');
  assert.ok(validated > 0 && gate > validated && push > gate, 'previous-head check, then the CI gate, then the push');
  assert.equal(promote.split('git push ').length - 1, 1, 'one push');
  assert.match(promote, /git push --force-with-lease="refs\/heads\/deploy\/ovh-production:\$\{EXPECTED_CURRENT\}" \\\n\s+origin "\$\{TARGET_SHA\}:refs\/heads\/deploy\/ovh-production"/);
  assert.doesNotMatch(promote, /git push (--force |-f )|--force-with-lease origin|--force-with-lease\s*\\?\n/,
    'never a bare force, and never a lease without an expected value (that trusts whatever was fetched)');
  // The lease alone would let a matching ref move backward, so direction is decided next to the push.
  const step = promote.slice(promote.indexOf('- name: Promote deployment ref'), promote.indexOf('- name: Summary'));
  const direction = step.indexOf('git merge-base --is-ancestor "${EXPECTED_CURRENT}" "${TARGET_SHA}"');
  assert.ok(direction > 0 && direction < step.indexOf('git push '), 'forward-only is enforced in the push step itself');
  assert.match(step, /if \[\[ "\$\{ALLOW_ROLLBACK\}" != "true" \]\]; then\n\s+git merge-base --is-ancestor "\$\{EXPECTED_CURRENT\}" "\$\{TARGET_SHA\}" \|\| \{[^}]*exit 3/);
  // Inputs reach the shell through the environment only.
  assert.deepEqual([...promote.matchAll(/\$\{\{ ([^}]+) \}\}/g)].map((match) => match[1]).filter((value) => !/^(inputs\.(sha|expected_current|allow_rollback|confirm)( == 'PROMOTE_OVH')?|github\.token)$/.test(value)), []);
  for (const line of promote.split('\n').filter((value) => /\$\{\{/.test(value))) assert.match(line, /^\s+([A-Z_]+|if): /, `not interpolated into a script: ${line.trim()}`);

  // GitHub starts no workflow from a GITHUB_TOKEN push, so deploy-ovh-core.yml's
  // push-triggered check never runs for a promotion made here. This job does.
  assert.match(verify, /needs: promote/);
  assert.match(verify, /permissions: \{\}/, 'the verification holds no permission');
  assert.match(verify, /timeout-minutes: 35/);
  assert.match(verify, /https:\/\/core\.mccluster\.org\/health/);
  assert.match(verify, /deployment_sha/);
  assert.match(verify, /deadline=\$\(\(SECONDS \+ 1800\)\)/);
  assert.match(verify, /while \(\( SECONDS < deadline \)\)/);
  assert.match(verify, /--max-time 15/);
  assert.doesNotMatch(verify, /secrets\.|github\.token|OVH_SSH_KEY|ssh |rsync |uses: |git push/);
  // A rollback must never wait behind the previous promotion's verification.
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /concurrency:/);
  assert.match(promote, /\n    concurrency:\n      group: promote-ovh-production\n      cancel-in-progress: false\n/);
  assert.doesNotMatch(verify, /concurrency:/);
});
