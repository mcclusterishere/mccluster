/*
 * Owner finding: "Fix rollback recovery when Core fails to start. Restoring
 * files must also restart the service and verify restored health."
 *
 * These tests run the REAL rollback() function from scripts/deploy-ovh-core.sh
 * and the REAL shared probe in scripts/ovh-core-health.sh against a temp tree,
 * with `systemctl` and `curl` replaced by fakes on PATH. Nothing touches a
 * live host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const deployPath = join(repo, 'scripts/deploy-ovh-core.sh');
const healthLib = join(repo, 'scripts/ovh-core-health.sh');
const deploy = readFileSync(deployPath, 'utf8');

const SERVICES = [
  'mccluster-core-tool-broker.service',
  'mccluster-compute-gateway.service',
  'mccluster-ollama-adapter.service',
  'mccluster-compute-node.service',
  'mccluster-core-runner.service',
  'mccluster-preview-gateway.service',
];
const PREVIEW = 'http://127.0.0.1:4799/health';
const ADAPTER = 'http://127.0.0.1:4790/health';
const READY = 'http://127.0.0.1:4790/ready';

function rollbackSource() {
  const start = deploy.indexOf('rollback() {');
  const end = deploy.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'rollback() not found in deploy-ovh-core.sh');
  return deploy.slice(start, end + 3);
}

const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
S="$FAKE_STATE"
echo "systemctl $*" >> "$S/calls.log"
[[ "$1" == --no-pager ]] && shift
[[ "$1" == --lines=* ]] && shift
cmd="$1"; shift
case "$cmd" in
  list-unit-files)
    [[ -e "$S/installed/$1" ]] && echo "$1 enabled enabled"; exit 0 ;;
  show) echo inactive; exit 0 ;;
  is-active)
    [[ "$1" == --quiet ]] && shift
    [[ -e "$S/active/$1" ]]; exit $? ;;
  restart|start)
    [[ "$1" == --no-block ]] && shift
    if [[ -e "$S/fail-start/$1" ]]; then rm -f "$S/active/$1"; exit 1; fi
    if [[ -e "$S/crash-after-start/$1" ]]; then rm -f "$S/active/$1"; exit 0; fi
    touch "$S/active/$1"; exit 0 ;;
  *) exit 0 ;;
esac
`;
// A URL listed in "down" refuses the connection. Any other URL answers the HTTP
// status listed for it in "http-status" (200 when it is not listed). As curl
// does: --fail turns a status of 400 or more into exit 22, and --write-out
// '%{http_code}' prints the status (000 when there was no response).
const FAKE_CURL = `#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_STATE/calls.log"
url="\${!#}"
fail=0; status_only=0
for arg in "$@"; do
  case "$arg" in --fail) fail=1 ;; --write-out) status_only=1 ;; esac
done
if grep -Fxq "$url" "$FAKE_STATE/down" 2>/dev/null; then
  (( status_only )) && printf '000'
  echo "curl: (7) Failed to connect to $url" >&2; exit 7
fi
code="$(awk -v url="$url" '$1 == url { print $2 }' "$FAKE_STATE/http-status" 2>/dev/null)"
code="\${code:-200}"
(( status_only )) && printf '%s' "$code"
if (( fail && code >= 400 )); then echo "curl: (22) The requested URL returned error: $code" >&2; exit 22; fi
exit 0
`;

function sandbox({ installed = SERVICES, down = [], failStart = [], crash = [], previous = true, httpStatus = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mcc-rollback-'));
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  for (const dir of ['installed', 'active', 'fail-start', 'crash-after-start']) mkdirSync(join(state, dir), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(bin, 'systemctl'), FAKE_SYSTEMCTL); chmodSync(join(bin, 'systemctl'), 0o755);
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  if (spawnSync('bash', ['-c', 'command -v rsync']).status !== 0) {
    // Production always has rsync (the deployer requires it); shim the one
    // form rollback uses when this machine lacks it.
    writeFileSync(join(bin, 'rsync'), '#!/usr/bin/env bash\n[[ "$1 $2" == "-a --delete" ]] || exit 1\nfind "$4" -mindepth 1 -delete && cp -a "$3." "$4"\n');
    chmodSync(join(bin, 'rsync'), 0o755);
  }
  writeFileSync(join(state, 'calls.log'), '');
  writeFileSync(join(state, 'down'), down.join('\n') + (down.length ? '\n' : ''));
  writeFileSync(join(state, 'http-status'), Object.entries(httpStatus).map(([url, code]) => `${url} ${code}\n`).join(''));
  for (const unit of installed) writeFileSync(join(state, 'installed', unit), '');
  for (const unit of failStart) writeFileSync(join(state, 'fail-start', unit), '');
  for (const unit of crash) writeFileSync(join(state, 'crash-after-start', unit), '');
  // The failed release crashed on start: nothing is active when rollback runs.

  const core = join(root, 'opt/core');
  const backup = join(root, 'releases/predeploy-test');
  const units = join(root, 'systemd');
  mkdirSync(core, { recursive: true });
  mkdirSync(units, { recursive: true });
  writeFileSync(join(core, 'runner.mjs'), 'broken new release\n');
  writeFileSync(join(core, 'only-in-new.mjs'), 'new\n');
  if (previous) {
    mkdirSync(join(backup, 'core'), { recursive: true });
    mkdirSync(join(backup, 'units'), { recursive: true });
    writeFileSync(join(backup, 'core/runner.mjs'), 'previous good release\n');
    writeFileSync(join(backup, 'units/mccluster-core-runner.service'), '[Service]\nExecStart=old\n');
    writeFileSync(join(units, 'mccluster-core-runner.service'), '[Service]\nExecStart=new\n');
  } else {
    mkdirSync(backup, { recursive: true });
  }
  return { root, state, bin, core, backup, units };
}

function runRollback(box, { failRc = 1 } = {}) {
  const script = `
set -Eeuo pipefail
CORE_TARGET=${JSON.stringify(box.core)}
BACKUP_DIR=${JSON.stringify(box.backup)}
SYSTEMD_DIR=${JSON.stringify(box.units)}
RECONCILE_TARGET=${JSON.stringify(join(box.root, 'reconcile'))}
RECONCILE_SCRIPT="\${RECONCILE_TARGET}/mccluster-vps-reconcile.sh"
MCC_HEALTH_RETRIES=0
source ${JSON.stringify(healthLib)}
${rollbackSource()}
trap rollback ERR
LIVE_TOUCHED=1
(exit ${failRc})
echo "unreachable"
`;
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_STATE: box.state },
  });
  const calls = readFileSync(join(box.state, 'calls.log'), 'utf8');
  return { ...result, calls };
}

test('rollback restores files, restarts the stopped units, and verifies health', (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box, { failRc: 7 });

  assert.equal(out.status, 7, 'a recovered rollback still reports the deploy failure rc');
  assert.doesNotMatch(out.stdout, /unreachable/);
  assert.equal(readFileSync(join(box.core, 'runner.mjs'), 'utf8'), 'previous good release\n');
  assert.equal(existsSync(join(box.core, 'only-in-new.mjs')), false);
  assert.match(readFileSync(join(box.units, 'mccluster-core-runner.service'), 'utf8'), /ExecStart=old/);

  // Every deploy-restarted unit is restarted for real (try-restart would no-op
  // on a unit the failed release left stopped), after the daemon reload.
  const reload = out.calls.indexOf('systemctl daemon-reload');
  assert.ok(reload >= 0);
  const startCommand = (unit) => unit === 'mccluster-core-runner.service' ? 'start' : unit === 'mccluster-compute-node.service' ? 'start' : 'restart';
  for (const unit of SERVICES) {
    const restart = out.calls.indexOf(`systemctl ${startCommand(unit)} ${unit}`);
    assert.ok(restart > reload, `${unit} not restarted after daemon-reload`);
    assert.ok(out.calls.indexOf(`systemctl reset-failed ${unit}`) > reload, `${unit} failed state not cleared`);
  }
  assert.doesNotMatch(out.calls, /try-restart/);

  // Same health probe as the deploy gate, after the restarts.
  const lastRestart = Math.max(...SERVICES.map((unit) => out.calls.indexOf(`systemctl ${startCommand(unit)} ${unit}`)));
  for (const url of [PREVIEW, ADAPTER]) {
    const probe = out.calls.lastIndexOf(url);
    assert.ok(probe > lastRestart, `${url} not probed after restart`);
  }
  assert.match(out.calls, /curl --fail --silent --show-error --retry 0 --retry-connrefused --retry-delay 1 --max-time 5 http:\/\/127\.0\.0\.1:4790\/health/);
  for (const unit of ['mccluster-core-runner.service', 'mccluster-core-tool-broker.service', 'mccluster-ollama-adapter.service', 'mccluster-compute-node.service']) {
    assert.match(out.calls, new RegExp(`systemctl is-active --quiet ${unit.replace(/\./g, '\\.')}`));
  }
  assert.match(out.stderr, /restored release restarted and verified healthy/);
});

test('rollback fails loudly when the restored release does not answer its health probe', (t) => {
  const box = sandbox({ down: [ADAPTER] });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 3, 'unhealthy restored release must exit MCC_ROLLBACK_UNHEALTHY_RC');
  assert.match(out.stderr, /resident AI adapter http:\/\/127\.0\.0\.1:4790\/health did not answer/);
  assert.match(out.stderr, /ROLLBACK FAILED: the restored release is NOT healthy/);
  assert.match(out.stderr, /restored release is unhealthy/);
  // Files are still restored even though recovery failed.
  assert.equal(readFileSync(join(box.core, 'runner.mjs'), 'utf8'), 'previous good release\n');
});

// The adapter gained /ready after the release OVH runs today. The adapters at
// 9c5b7503 and on main answer /health and 404 for every other path. Rolling
// back onto one of them used to end "ROLLBACK FAILED ... NOT healthy" (exit 3)
// with the previous release restored and serving, and the reconciler then
// retried the whole deploy, drain included, every two minutes.
test('rollback onto a release whose adapter predates /ready is a recovered rollback', (t) => {
  const box = sandbox({ httpStatus: { [READY]: 404 } });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box, { failRc: 7 });
  assert.equal(out.status, 7, 'the deploy failure rc, not MCC_ROLLBACK_UNHEALTHY_RC');
  assert.match(out.stderr, /resident AI adapter has no \/ready route \(HTTP 404: the restored release predates it\); liveness on http:\/\/127\.0\.0\.1:4790\/health accepted/);
  assert.match(out.stderr, /rollback: restored release restarted and verified healthy/);
  assert.match(out.stderr, /deploy failed \(rc=7\); previous release restored from .* and healthy/);
  assert.doesNotMatch(out.stderr, /ROLLBACK FAILED|is not ready|restored release is unhealthy/);
  assert.equal(readFileSync(join(box.core, 'runner.mjs'), 'utf8'), 'previous good release\n');
  // Liveness is still required first, readiness is still asked for, and only then is the status read once.
  const health = out.calls.lastIndexOf(`--max-time 5 ${ADAPTER}`);
  const ready = out.calls.lastIndexOf(`curl --fail --silent --show-error --retry 0 --retry-connrefused --retry-delay 1 --max-time 5 ${READY}`);
  const status = out.calls.indexOf(`curl --silent --output /dev/null --write-out %{http_code} --max-time 5 ${READY}`);
  assert.ok(health >= 0 && ready > health && status > ready, 'health, then ready, then the one status read');
  assert.equal(out.calls.split('--write-out').length - 1, 1);
  for (const unit of ['mccluster-core-runner.service', 'mccluster-compute-node.service']) {
    assert.match(out.calls, new RegExp(`systemctl start ${unit.replace(/\./g, '\\.')}`), `${unit} resumed`);
  }
});

test('a restored adapter that has /ready and is not ready, or cannot be asked, still fails the rollback', (t) => {
  for (const [name, options] of [
    ['503 not ready', { httpStatus: { [READY]: 503 } }],
    ['500', { httpStatus: { [READY]: 500 } }],
    ['403', { httpStatus: { [READY]: 403 } }],
    ['connection refused', { down: [READY] }],
  ]) {
    const box = sandbox(options);
    t.after(() => rmSync(box.root, { recursive: true, force: true }));
    const out = runRollback(box, { failRc: 7 });
    assert.equal(out.status, 3, `${name}: unhealthy restored release must exit MCC_ROLLBACK_UNHEALTHY_RC`);
    assert.match(out.stderr, /resident AI adapter http:\/\/127\.0\.0\.1:4790\/ready is not ready/, name);
    assert.match(out.stderr, /ROLLBACK FAILED: the restored release is NOT healthy/, name);
    assert.match(out.stderr, /restored release is unhealthy/, name);
    assert.doesNotMatch(out.stderr, /no \/ready route|verified healthy/, name);
  }
  // A missing /health is never excused: 404 there means the adapter is not the adapter.
  const box = sandbox({ httpStatus: { [ADAPTER]: 404, [READY]: 404 } });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 3);
  assert.match(out.stderr, /resident AI adapter http:\/\/127\.0\.0\.1:4790\/health did not answer/);
});

test('rollback fails loudly when a restored unit will not start', (t) => {
  const box = sandbox({ failStart: ['mccluster-core-runner.service'] });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 3);
  assert.match(out.stderr, /FAILED to start mccluster-core-runner\.service/);
  assert.match(out.stderr, /mccluster-core-runner\.service is not active/);
  assert.match(out.calls, /systemctl --no-pager --lines=20 status mccluster-core-runner\.service/);
});

test('rollback catches a restored unit that starts and then dies', (t) => {
  const box = sandbox({ crash: ['mccluster-compute-node.service'] });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 3);
  assert.match(out.stderr, /mccluster-compute-node\.service is not active/);
});

test('rollback skips optional units the previous release never installed', (t) => {
  const installed = SERVICES.filter((unit) => unit !== 'mccluster-compute-gateway.service');
  const box = sandbox({ installed });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 1);
  assert.doesNotMatch(out.calls, /systemctl restart mccluster-compute-gateway\.service/);
  assert.match(out.stderr, /verified healthy/);
});

test('rollback fails loudly when the previous files cannot be restored', (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  writeFileSync(join(box.bin, 'rsync'), '#!/usr/bin/env bash\necho "rsync: disk full" >&2\nexit 11\n');
  chmodSync(join(box.bin, 'rsync'), 0o755);
  const out = runRollback(box);
  assert.equal(out.status, 3);
  assert.match(out.stderr, /ROLLBACK FAILED: could not restore Core files/);
});

test('first deploy with no previous release fails loudly instead of claiming recovery', (t) => {
  const box = sandbox({ previous: false });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runRollback(box);
  assert.equal(out.status, 3);
  assert.match(out.stderr, /no previous Core release was captured/);
  assert.doesNotMatch(out.calls, /systemctl restart/);
});

test('a failure before the live install changed does not restart anything', (t) => {
  const box = sandbox();
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const script = `
set -Eeuo pipefail
BACKUP_DIR=${JSON.stringify(box.backup)}
LIVE_TOUCHED=0
source ${JSON.stringify(healthLib)}
${rollbackSource()}
trap rollback ERR
(exit 5)
`;
  const out = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_STATE: box.state },
  });
  assert.equal(out.status, 5);
  assert.match(out.stderr, /nothing to roll back/);
  assert.equal(readFileSync(join(box.state, 'calls.log'), 'utf8'), '');
});

test('the forward deploy gate uses the same shared probe in strict mode', (t) => {
  assert.match(deploy, /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/ovh-core-health\.sh"/);
  assert.match(deploy, /\nmcc_verify_core_health strict\n/);
  assert.ok(deploy.indexOf('mcc_verify_core_health strict') < deploy.indexOf('grep -Fq "\\"commit_sha'));
  assert.match(deploy, /diff --quiet HEAD -- core scripts\/deploy-ovh-core\.sh scripts\/ovh-core-health\.sh/);

  // Strict mode refuses a missing required unit even though rollback mode skips it.
  const box = sandbox({ installed: SERVICES.filter((unit) => unit !== 'mccluster-compute-node.service') });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  for (const unit of SERVICES) writeFileSync(join(box.state, 'active', unit), '');
  const run = (mode) => spawnSync('bash', ['-c', `set -Eeuo pipefail; MCC_HEALTH_RETRIES=0; source ${JSON.stringify(healthLib)}; rm -f "$FAKE_STATE/active/mccluster-compute-node.service"; mcc_verify_core_health ${mode}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_STATE: box.state },
  });
  assert.notEqual(run('strict').status, 0);
  assert.equal(run('installed').status, 0);
});

test('the forward deploy gate still requires /ready: a 404 there is a release that must not be stamped', (t) => {
  const box = sandbox({ httpStatus: { [READY]: 404 } });
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  for (const unit of SERVICES) writeFileSync(join(box.state, 'active', unit), '');
  const run = (mode) => {
    writeFileSync(join(box.state, 'calls.log'), '');
    const result = spawnSync('bash', ['-c', `set -Eeuo pipefail; MCC_HEALTH_RETRIES=0; source ${JSON.stringify(healthLib)}; mcc_verify_core_health ${mode}`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_STATE: box.state },
    });
    return { ...result, calls: readFileSync(join(box.state, 'calls.log'), 'utf8') };
  };
  const strict = run('strict');
  assert.notEqual(strict.status, 0);
  assert.match(strict.stderr, /resident AI adapter http:\/\/127\.0\.0\.1:4790\/ready is not ready/);
  assert.doesNotMatch(strict.stderr, /no \/ready route/);
  assert.doesNotMatch(strict.calls, /--write-out/, 'strict mode does not even ask whether the route exists');
  const installed = run('installed');
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stderr, /no \/ready route/);
  // With no argument the gate is strict.
  assert.notEqual(run('').status, 0);
  const health = readFileSync(healthLib, 'utf8');
  assert.match(health, /if \[\[ "\$\{mode\}" != strict \]\] && mcc_route_absent "\$\{MCC_ADAPTER_READY_URL\}"; then/);
  assert.match(health, /\[\[ "\$\{code\}" == 404 \]\]/);
});

/* Close-out (2026-11-10), audit finding C6: the forward deploy probes /ready BEFORE it resumes the producers,
   so a release whose adapter has no usable model never hands a job to the runner or the compute node. That
   order was guarded only by a regex over the script text. These run the REAL lines of deploy-ovh-core.sh,
   from the adapter /health probe through `mcc_verify_core_health strict`, with the fake systemctl and curl. */
const PRODUCERS = ['mccluster-core-runner.service', 'mccluster-compute-node.service'];

function forwardGateSource() {
  const first = '\nmcc_probe "${MCC_ADAPTER_HEALTH_URL}"\n';
  const last = '\nmcc_verify_core_health strict\n';
  const start = deploy.indexOf(first);
  const end = deploy.indexOf(last, start);
  assert.ok(start >= 0 && end > start, 'forward health gate not found in deploy-ovh-core.sh');
  const source = deploy.slice(start + 1, end + last.length);
  assert.match(source, /\nmcc_resume_producers\n/, 'the gate resumes the producers');
  return source;
}

function runForwardGate(box) {
  // Both producers were drained before the live install changed; the rest of Core is up.
  for (const unit of SERVICES.filter((unit) => !PRODUCERS.includes(unit))) writeFileSync(join(box.state, 'active', unit), '');
  const script = `
set -Eeuo pipefail
MCC_HEALTH_RETRIES=0
source ${JSON.stringify(healthLib)}
LIVE_TOUCHED=1
MCC_RUNNER_WAS_ACTIVE=1
MCC_NODE_WAS_ACTIVE=1
${forwardGateSource()}
echo "forward gate passed"
`;
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_STATE: box.state },
  });
  return { ...result, calls: readFileSync(join(box.state, 'calls.log'), 'utf8') };
}

test('C6: the forward deploy resumes neither producer when /ready fails after /health passes', (t) => {
  for (const [name, options] of [
    ['503 not ready', { httpStatus: { [READY]: 503 } }],
    ['404 no route', { httpStatus: { [READY]: 404 } }],
    ['connection refused', { down: [READY] }],
  ]) {
    const box = sandbox(options);
    t.after(() => rmSync(box.root, { recursive: true, force: true }));
    const out = runForwardGate(box);
    assert.notEqual(out.status, 0, `${name}: the deploy must fail (and the ERR trap roll back)`);
    assert.doesNotMatch(out.stdout, /forward gate passed/, name);
    const health = out.calls.indexOf(`--max-time 5 ${ADAPTER}`);
    const ready = out.calls.indexOf(`--max-time 5 ${READY}`);
    assert.ok(health >= 0 && ready > health, `${name}: liveness, then readiness`);
    for (const unit of PRODUCERS) {
      assert.doesNotMatch(out.calls, new RegExp(`systemctl (?:reset-failed|start)\\b[^\\n]* ${unit.replace(/\./g, '\\.')}`), `${name}: ${unit} must not be resumed`);
    }
  }
  // Control: the same lines against a ready adapter resume both producers, after /ready, and pass strict.
  const box = sandbox();
  t.after(() => rmSync(box.root, { recursive: true, force: true }));
  const out = runForwardGate(box);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /forward gate passed/);
  const ready = out.calls.indexOf(`--max-time 5 ${READY}`);
  for (const unit of PRODUCERS) {
    assert.ok(out.calls.indexOf(`systemctl start ${unit}`) > ready, `${unit} resumed only after /ready answered`);
  }
});
