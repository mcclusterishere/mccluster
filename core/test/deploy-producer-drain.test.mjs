import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const health = fileURLToPath(new URL('../../scripts/ovh-core-health.sh', import.meta.url));
const deploy = readFileSync(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
const rollback = deploy.slice(deploy.indexOf('rollback() {'), deploy.indexOf('\n}\n', deploy.indexOf('rollback() {')) + 3);
const runner = 'mccluster-core-runner.service';
const compute = 'mccluster-compute-node.service';

function box(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcc-drain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  mkdirSync(join(root, 'backup'));
  writeFileSync(join(root, runner), ''); writeFileSync(join(root, compute), '');
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
set -eu
echo "$*" >> "$BOX/calls"
cmd="$1"; shift
case "$cmd" in
  list-unit-files) echo "$1 enabled enabled" ;;
  is-active) [[ "$1" == --quiet ]] && shift; test -f "$BOX/$1" ;;
  show) if [[ "$*" == *--property=InvocationID* ]]; then echo test-invocation;
    elif [[ "$*" == *--property=TimeoutStopUSec* ]]; then echo "\${RECONCILE_GRACE:-20min}";
    elif [[ "$*" == *--property=KillMode* ]]; then echo control-group;
    elif [[ "$*" == *--property=TimeoutStartFailureMode* ]]; then echo terminate;
    elif [[ "$*" == *mccluster-vps-reconcile.service* ]]; then echo "\${RECONCILE_STATE:-activating}";
    elif [[ "$*" == *--property=Restart* ]]; then echo no;
    elif [[ "$*" == *--property=Result* ]]; then echo success;
    elif [[ "\${UNSTABLE:-0}" == 1 ]]; then echo activating; elif [[ -f "$BOX/\${!#}" ]]; then echo active; else echo inactive; fi ;;
  kill) [[ -f "$MCC_RUNNER_DRAIN_DROPIN" ]] || exit 90
    if [[ "\${HOLD_RUNNER:-0}" != 1 ]]; then rm -f "$BOX/${runner}"; fi ;;
  stop) [[ "$1" == '${compute}' && -f "$BOX/fenced" && ! -f "$BOX/busy" ]] || exit 91
    rm -f "$BOX/$1" ;;
  start) [[ "$1" == --no-block ]] && shift; touch "$BOX/$1" ;;
  daemon-reload|reset-failed) : ;;
  *) exit 92 ;;
esac
`);
  chmodSync(join(bin, 'systemctl'), 0o755);
  return { root, bin, dropin: join(root, 'run/runner.d/drain.conf') };
}
function run(box, script, env = {}) {
  const setup = `set -Eeuo pipefail
BACKUP_DIR="$BOX/backup"
LIVE_TOUCHED=0
SOURCE_DIR="$BOX/source"
source ${JSON.stringify(health)}
mcc_node_drain() {
  echo "node-drain $1" >> "$BOX/calls"
  case "$1" in
    begin)
      echo '{}' > "$MCC_NODE_DRAIN_RECEIPT"
      touch "$BOX/fenced"
      if [[ "\${BEGIN_TERM:-0}" == 1 ]]; then kill -TERM $$; return 143; fi
      [[ "\${BEGIN_LOST:-0}" != 1 ]] ;;
    check) [[ ! -e "$BOX/busy" ]] || return 10 ;;
    end) rm -f "$BOX/fenced" "$MCC_NODE_DRAIN_RECEIPT" ;;
  esac
}
${rollback}
trap rollback ERR
trap 'rollback 143' TERM
trap 'rollback 130' INT
trap 'rollback 129' HUP
`;
  return spawnSync('bash', ['-c', setup + script], {
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, BOX: box.root,
      MCC_RUNNER_DRAIN_DROPIN: box.dropin, MCC_DRAIN_TIMEOUT: '1', ...env },
    encoding: 'utf8', timeout: 8000,
  });
}
const calls = (b) => readFileSync(join(b.root, 'calls'), 'utf8');

test('real drain signals only runner main PID then fences leases before stopping compute', (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_drain_producers\necho REPLACE_DEPENDENCIES >> "$BOX/calls"\nmcc_resume_producers\n');
  assert.equal(out.status, 0, out.stderr);
  const log = calls(b);
  const sequence = ['daemon-reload', 'kill --kill-whom=main --signal=SIGTERM', 'node-drain begin', 'node-drain check', `stop ${compute}`, 'REPLACE_DEPENDENCIES', `start ${compute}`, 'node-drain end', `start --no-block ${runner}`];
  let last = -1;
  for (const command of sequence) { const pos = log.indexOf(command, last + 1); assert.ok(pos > last, command); last = pos; }
  assert.doesNotMatch(log, /stop mccluster-core-runner|restart|SIGKILL/);
  assert.equal(existsSync(b.dropin), false);
  assert.equal(existsSync(join(b.root, 'fenced')), false);
});

test('runner timeout leaves its live work and dependencies untouched and restores restart', (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_drain_producers\necho UNSAFE_DEPENDENCY_CHANGE\n', { HOLD_RUNNER: '1' });
  assert.equal(out.status, 75, out.stderr);
  assert.doesNotMatch(out.stdout, /UNSAFE/);
  assert.doesNotMatch(calls(b), /node-drain begin|stop |restart/);
  assert.match(calls(b), new RegExp(`start --no-block ${runner}`));
  assert.equal(existsSync(b.dropin), false);
  assert.equal(existsSync(join(b.root, runner)), true);
});

test('compute timeout restores online and runner without stopping active leases', (t) => {
  const b = box(t); writeFileSync(join(b.root, 'busy'), '');
  const out = run(b, '\nmcc_drain_producers\necho UNSAFE_DEPENDENCY_CHANGE\n');
  assert.equal(out.status, 75, out.stderr);
  assert.doesNotMatch(out.stdout, /UNSAFE/);
  assert.doesNotMatch(calls(b), /stop |restart/);
  assert.match(calls(b), /node-drain end/);
  assert.equal(existsSync(join(b.root, compute)), true);
  assert.equal(existsSync(join(b.root, 'fenced')), false);
});

for (const mode of ['BEGIN_TERM', 'BEGIN_LOST']) test(`${mode}: receipt allows recovery after an interrupted or ambiguous canonical write`, (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_drain_producers\necho UNSAFE_DEPENDENCY_CHANGE\n', { [mode]: '1' });
  assert.equal(out.status, mode === 'BEGIN_TERM' ? 143 : 1, out.stderr);
  assert.doesNotMatch(out.stdout, /UNSAFE/);
  assert.match(calls(b), /node-drain end/);
  assert.equal(existsSync(join(b.root, 'fenced')), false);
  assert.equal(existsSync(b.dropin), false);
});

test('a foreign or stale runner override is never overwritten', (t) => {
  const b = box(t); mkdirSync(join(b.root, 'run/runner.d'), { recursive: true });
  writeFileSync(b.dropin, 'foreign');
  const out = run(b, '\nmcc_drain_producers\n');
  assert.notEqual(out.status, 0);
  assert.equal(readFileSync(b.dropin, 'utf8'), 'foreign');
  assert.doesNotMatch(calls(b), /kill |stop |node-drain/);
});

test('invalid drain budgets fail before any runtime action', (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_drain_producers\n', { MCC_DRAIN_TIMEOUT: 'not-a-number' });
  assert.equal(out.status, 2);
  assert.equal(calls(b), '');
});

test('deployer drains before touching live files and keeps downloads outside maintenance', () => {
  const drain = deploy.indexOf('\nmcc_drain_producers\n');
  const touched = deploy.indexOf('\nLIVE_TOUCHED=1\n');
  assert.ok(drain > deploy.indexOf('\nmcc_pull_extra_models\n'));
  assert.ok(touched > drain);
  assert.ok(deploy.indexOf('"${SOURCE_DIR}/core/" "${CORE_TARGET}/"') > touched);
  assert.match(deploy, /flock -n 8/);
  for (const [signal, rc] of [['TERM', 143], ['INT', 130], ['HUP', 129]]) assert.ok(deploy.includes(`trap 'rollback ${rc}' ${signal}`));
});

test('an auto-restarting producer defers deployment before sending signals', (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_drain_producers\n', { UNSTABLE: '1' });
  assert.equal(out.status, 75, out.stderr);
  assert.doesNotMatch(calls(b), /kill |stop |node-drain/);
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForFile(path, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) { if (Date.now() > deadline) throw new Error(`Timed out: ${path}`); await pause(10); }
}

test('control-group-like TERM reaches wrapper, deployer and helper; recovery survives another TERM', async (t) => {
  const b = box(t);
  const blocked = join(b.root, 'blocked.mjs');
  const recover = join(b.root, 'recover.mjs');
  const childPath = join(b.root, 'deploy.sh');
  writeFileSync(blocked, `import fs from 'node:fs';
fs.writeFileSync(process.env.BOX + '/receipt', 'pending write');
fs.writeFileSync(process.env.BOX + '/ready', '');
setInterval(() => {}, 1000);`);
  const drainModule = new URL('../../scripts/ovh-core-compute-drain.mjs', import.meta.url).href;
  writeFileSync(recover, `import fs from 'node:fs';
import { protectRecoverySignals } from ${JSON.stringify(drainModule)};
protectRecoverySignals();
if (!fs.existsSync(process.env.BOX + '/receipt')) process.exit(8);
fs.writeFileSync(process.env.BOX + '/recovering', '');
setTimeout(() => { fs.unlinkSync(process.env.BOX + '/receipt'); fs.writeFileSync(process.env.BOX + '/recovered', ''); }, 250);`);
  writeFileSync(childPath, `#!/usr/bin/env bash
set -Eeuo pipefail
LIVE_TOUCHED=0
DRAIN_STARTED=1
MCC_ROLLBACK_UNHEALTHY_RC=3
mcc_log() { echo "$*" >&2; }
mcc_resume_producers() { node ${JSON.stringify(recover)}; }
mcc_restore_timeout_bootstrap() { return 0; }
${rollback}
trap rollback ERR
trap 'rollback 143' TERM
node ${JSON.stringify(blocked)}
`);
  const wrapper = spawn('bash', ['-c', `bash ${JSON.stringify(childPath)}; echo wrapper-finished`], {
    detached: true, stdio: 'ignore', env: { ...process.env, BOX: b.root },
  });
  t.after(() => { try { process.kill(-wrapper.pid, 'SIGKILL'); } catch {} });
  await waitForFile(join(b.root, 'ready'));
  process.kill(-wrapper.pid, 'SIGTERM');
  await waitForFile(join(b.root, 'recovering'));
  process.kill(-wrapper.pid, 'SIGTERM');
  await waitForFile(join(b.root, 'recovered'));
  assert.equal(existsSync(join(b.root, 'receipt')), false);
});

test('optional model pulls share one deadline and leave the next model for a later deploy', (t) => {
  const b = box(t);
  mkdirSync(join(b.root, 'source/core/systemd'), { recursive: true });
  writeFileSync(join(b.root, 'source/core/systemd/mccluster-ollama-adapter.service'), 'Environment=MCCLUSTER_OLLAMA_DEPLOY_PULL=model:one,model:two\n');
  writeFileSync(join(b.bin, 'curl'), `#!/usr/bin/env bash
echo "curl $*" >> "$BOX/calls"
if [[ "$*" == *api/pull* ]]; then sleep 1.1; exit 28; fi
echo '{"models":[]}'
`);
  chmodSync(join(b.bin, 'curl'), 0o755);
  const start = deploy.indexOf('mcc_pull_extra_models() {');
  const method = deploy.slice(start, deploy.indexOf('\n}\n', start) + 3);
  const out = run(b, `\n${method}\nmcc_pull_extra_models 1\necho FINISHED\n`);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /FINISHED/);
  const log = calls(b);
  assert.equal(log.split('\n').filter((line) => line.includes('api/pull')).length, 1);
  assert.match(log, /--max-time 1/);
  assert.doesNotMatch(log, /model:two/);
  assert.doesNotMatch(log, /systemctl|node-drain/);
});

test('supervisor uses a bounded cleanup allowance without weakening cgroup containment', () => {
  const unit = readFileSync(new URL('../systemd/mccluster-vps-reconcile.service', import.meta.url), 'utf8');
  assert.match(unit, /^TimeoutStartSec=20min$/m);
  assert.match(unit, /^TimeoutStopSec=20min$/m);
  assert.match(unit, /^KillMode=control-group$/m);
  assert.doesNotMatch(unit, /KillMode=(none|process)|SendSIGKILL=no|TimeoutStopSec=infinity/);
  assert.match(rollback, /trap '' HUP INT TERM/);
});

test('first rollout fails closed under the old effective supervisor stop grace', (t) => {
  const b = box(t);
  const out = run(b, '\nmcc_verify_reconcile_recovery_budget\nmcc_drain_producers\n', {
    INVOCATION_ID: 'test-invocation', RECONCILE_GRACE: '1min 30s',
  });
  assert.equal(out.status, 75, out.stderr);
  assert.match(out.stderr, /install\/reload the reviewed timeout allowance/);
  assert.doesNotMatch(calls(b), /kill |stop |node-drain|daemon-reload/);
  assert.equal(existsSync(b.dropin), false);
});

test('verified effective recovery grace permits deployment but a stopping unit does not', (t) => {
  const b = box(t);
  assert.equal(run(b, '\nmcc_verify_reconcile_recovery_budget\n', { INVOCATION_ID: 'test-invocation' }).status, 0);
  assert.equal(run(b, '\nmcc_verify_reconcile_recovery_budget\n', {
    INVOCATION_ID: 'test-invocation', RECONCILE_STATE: 'deactivating',
  }).status, 75);
  const guard = deploy.indexOf('if ! mcc_verify_reconcile_recovery_budget; then');
  assert.ok(guard > 0 && guard < deploy.indexOf('\nmcc_drain_producers\n'));
});
