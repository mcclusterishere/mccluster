import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('a promotion names the head it replaces, moves the ref only from that head and watches the public serving SHA', async () => {
  const workflow = await read('.github/workflows/promote-ovh-production.yml');
  const promoteStart = workflow.indexOf('\n  promote:');
  const verifyStart = workflow.indexOf('\n  observe:');
  assert.ok(promoteStart > 0 && verifyStart > promoteStart, 'promote and observe jobs exist');
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
  assert.match(verify, /permissions: \{\}/, 'the observation holds no permission');
  assert.match(verify, /timeout-minutes: 55/);
  assert.match(verify, /\n {10}url=https:\/\/core\.mccluster\.org\/health\n/);
  assert.match(verify, /deployment_sha/);
  assert.match(verify, /\n {10}converge_seconds=1800\n {10}hold_seconds=1200\n {10}poll_seconds=10\n/);
  assert.match(verify, /--max-time 15/);
  assert.doesNotMatch(verify, /secrets\.|github\.token|OVH_SSH_KEY|ssh |rsync |uses: |git push/);
  // A rollback must never wait behind the previous promotion's observation.
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /concurrency:/);
  assert.match(promote, /\n    concurrency:\n      group: promote-ovh-production\n      cancel-in-progress: false\n/);
  assert.doesNotMatch(verify, /concurrency:/);
});

/*
 * WF-1. deploy-ovh-core.sh writes the target's manifest and restarts the tool
 * broker BEFORE its health gate runs, and the broker reads that manifest once,
 * at its start (core/src/runtime-revision.mjs). Public /health therefore serves
 * the target from that restart even for a release that fails the gate and is
 * rolled back. A job that passes on the first sighting goes green for a
 * rolled-back release. The tests below run the job's own run: block, as GitHub
 * runs it, against a loopback /health; only the URL and the timing constants
 * are changed in the copy.
 */
const PUBLIC_HEALTH = 'https://core.mccluster.org/health';
const TARGET = 'a'.repeat(40);
const PREVIOUS = '9c5b75032d1794c47d8b6db05acf16e3965faa74';

async function observeBlock() {
  const lines = (await read('.github/workflows/promote-ovh-production.yml')).split('\n');
  const needs = lines.indexOf('    needs: promote');
  const run = lines.findIndex((line, index) => index > needs && line.trim() === 'run: |');
  assert.ok(needs > 0 && run > needs, 'the job that runs after the promotion has a run: block');
  const block = [];
  for (let index = run + 1; index < lines.length && (lines[index].startsWith('          ') || lines[index] === ''); index++) block.push(lines[index].slice(10));
  return block.join('\n');
}

// /health as the broker answers it unauthenticated. answer(n) is the commit the
// n-th request is served, or null for no answer (503).
async function loopbackHealth(t, answer) {
  let requests = 0;
  const server = http.createServer((request, response) => {
    const sha = answer(requests++);
    if (request.url !== '/health' || sha === null) { response.writeHead(503); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'mccluster-core-tool-broker', deployment_sha: sha }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}/health`, requests: () => requests };
}

// Runs the block as GitHub does (bash --noprofile --norc -eo pipefail <file>),
// with converge, hold and poll shortened to seconds.
async function observe(t, answer, { converge = 3, hold = 2, poll = 0.2 } = {}) {
  const health = await loopbackHealth(t, answer);
  let script = await observeBlock();
  assert.equal(script.split(PUBLIC_HEALTH).length - 1, 1, 'the block reads one public URL');
  script = script.replace(PUBLIC_HEALTH, health.url);
  for (const [name, value] of [['converge_seconds', converge], ['hold_seconds', hold], ['poll_seconds', poll]]) {
    script = script.replace(new RegExp(`^${name}=\\d+$`, 'm'), `${name}=${value}`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'mcc-observe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'observe.sh'), `${script}\n`);
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(dir, 'observe.sh')], {
      env: { PATH: process.env.PATH, TARGET_SHA: TARGET }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
  });
  return { ...result, ms: Date.now() - started, requests: health.requests() };
}

test('the promotion observation fails when the target is served and then the previous release again', async (t) => {
  // A failing attempt: the broker restarted on the target, the gate failed, rollback restarted it on the previous release.
  const result = await observe(t, (n) => (n < 3 ? TARGET : PREVIOUS));
  assert.equal(result.status, 1, `a release that was rolled back is not a success:\n${result.stdout}${result.stderr}`);
  assert.doesNotMatch(result.stdout, /Observed|Verified/);
  assert.match(result.stderr, new RegExp(`public /health served ${PREVIOUS} \\d+s after it first served ${TARGET}: the release failed its deploy gate and was rolled back`));
  assert.equal(result.requests, 4, 'it fails on the first answer that names another commit, not at the end of the hold');
});

test('the promotion observation passes only after the target stayed served for the whole hold, and says it is not acceptance', async (t) => {
  const result = await observe(t, (n) => (n < 2 ? PREVIOUS : TARGET));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = result.stdout.split('\n');
  const first = lines.findIndex((line) => line === `Attempt 3: public /health serves ${TARGET}; it must keep serving it for 2s`);
  const observed = lines.findIndex((line) => new RegExp(`^Observed: public /health served ${TARGET} for [2-9]s and no other commit after it\\.$`).test(line));
  assert.ok(first > 0 && observed > first, result.stdout);
  assert.equal(lines[observed + 1], 'This is not acceptance. Runbook step 5 is: host_health deployed_sha equal to the serving SHA, and runtime_verification verified.');
  assert.ok(result.requests >= 5, `the target was asked for again during the hold (${result.requests} requests)`);
});

test('the promotion observation does not pass on a target that stops answering during the hold', async (t) => {
  const result = await observe(t, (n) => (n < 2 ? TARGET : null));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`public /health served ${TARGET} but did not answer with it again after the 2s hold`));
  assert.match(result.stdout, /got <none>/);
});

test('the promotion observation fails when the target is never served', async (t) => {
  const result = await observe(t, () => PREVIOUS);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`public /health did not serve ${TARGET} within 3s`));
  assert.match(result.stdout, new RegExp(`Attempt 1: expected ${TARGET}, got ${PREVIOUS}`));
});

test('the promotion observation holds longer than one failing deploy attempt, and never calls itself verification', async () => {
  const [workflow, health] = await Promise.all([read('.github/workflows/promote-ovh-production.yml'), read('scripts/ovh-core-health.sh')]);
  const block = await observeBlock();
  const constant = (name) => Number(block.match(new RegExp(`^${name}=(\\d+)$`, 'm'))?.[1]);
  const deployDefault = (name) => Number(health.match(new RegExp(`^${name}="\\$\\{${name}:-(\\d+)\\}"$`, 'm'))?.[1]);
  const [converge, hold, poll] = ['converge_seconds', 'hold_seconds', 'poll_seconds'].map(constant);
  const [drain, retries, timeout] = ['MCC_DRAIN_TIMEOUT', 'MCC_HEALTH_RETRIES', 'MCC_HEALTH_TIMEOUT'].map(deployDefault);
  assert.deepEqual([converge, hold, poll], [1800, 1200, 10]);
  assert.deepEqual([drain, retries, timeout], [660, 5, 5], 'the deployer bounds this hold is measured against');
  // One failing attempt serves the target from the broker restart until rollback restarts the broker:
  // the gate's five probes (adapter /health and /ready, then the strict check's preview, /health and /ready),
  // each up to (retries + 1) requests of `timeout` seconds and a one-second delay between them, then the
  // rollback's producer drain, then up to three minutes waiting for Ollama when its drop-in is restored.
  const probe = (retries + 1) * timeout + retries;
  assert.ok(hold > 5 * probe + drain + 180, `hold ${hold}s must outlast one failing attempt (${5 * probe + drain + 180}s of bounded waits)`);
  const minutes = Number(workflow.match(/\n  observe:\n(?:    .*\n)*?    timeout-minutes: (\d+)\n/)?.[1]);
  assert.ok(minutes * 60 >= converge + hold + 2 * (poll + 15) + 60, `timeout-minutes ${minutes} leaves room for the whole observation`);
  // An observation, not a verification: a deferred rollback keeps serving the target, which no poll can tell apart.
  const job = workflow.slice(workflow.indexOf('\n  observe:'));
  assert.doesNotMatch(job, /^\s+(name|- name):.*[Vv]erif/m);
  assert.doesNotMatch(job, /echo "Verified/);
  assert.match(workflow, /A green run is not acceptance: runbook step 5 is\./);
});
