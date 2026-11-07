import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const health = fileURLToPath(new URL('../../scripts/ovh-core-health.sh', import.meta.url));
const deploy = readFileSync(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url), 'utf8');
const rollback = deploy.slice(deploy.indexOf('rollback() {'), deploy.indexOf('\n}\n', deploy.indexOf('rollback() {')) + 3);
const phaseStart = deploy.indexOf('if ! mcc_verify_reconcile_recovery_budget; then');
const phase = deploy.slice(phaseStart, deploy.indexOf('\nfi\n', phaseStart) + 4);
const content = '# McCluster recovery-timeout bootstrap v1; timeout only.\n[Service]\nTimeoutStopSec=20min\n';

function box(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcc-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const dropin = join(root, 'unit.d/90-mccluster-recovery-timeout-bootstrap.conf');
  writeFileSync(join(root, 'grace'), '1min 30s\n');
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
set -eu
echo "systemctl $*" >> "$BOX/calls"
cmd="$1"; shift
value() {
 case "$1" in
 InvocationID) echo "\${INVOCATION_ID}" ;;
 ActiveState) echo "\${FAKE_STATE:-activating}" ;;
 TimeoutStopUSec) cat "$BOX/grace" ;;
 KillMode) echo "\${FAKE_KILL_MODE:-control-group}" ;;
 TimeoutStartFailureMode) echo terminate ;;
 TimeoutStartUSec) echo 20min ;;
 esac
}
case "$cmd" in
 show)
  if [[ "$*" == *--value* ]]; then
    for arg in "$@"; do [[ "$arg" != --property=* ]] || value "\${arg#*=}"; done
  else
    for key in InvocationID ActiveState TimeoutStopUSec KillMode TimeoutStartFailureMode TimeoutStartUSec; do printf '%s=' "$key"; value "$key"; done
  fi ;;
 cat)
  printf '# /etc/systemd/system/mccluster-vps-reconcile.service\n[Service]\nTimeoutStartSec=20min\n'
  if [[ "\${FOREIGN_TIMEOUT:-0}" == 1 ]]; then printf '# /etc/systemd/system/mccluster-vps-reconcile.service.d/operator.conf\n[Service]\nTimeoutStopSec=90s\n'; fi
  if [[ -f "$DROPIN" ]]; then printf '# %s\n' "$DROPIN"; cat "$DROPIN"; fi ;;
 daemon-reload)
  if [[ -f "$DROPIN" ]]; then
    if [[ "\${FAIL_RELOAD:-0}" == 1 ]]; then exit 1; fi
    if [[ "\${IGNORE_OVERRIDE:-0}" != 1 ]]; then echo 20min > "$BOX/grace"; fi
    if [[ "\${TERM_RELOAD:-0}" == 1 ]]; then kill -TERM "$PPID"; exit 143; fi
    if [[ "\${BLOCK_RELOAD:-0}" == 1 ]]; then touch "$BOX/ready"; exec sleep 30; fi
  else
    [[ "\${FAIL_RESTORE:-0}" != 1 ]] || exit 1
    echo '1min 30s' > "$BOX/grace"
  fi ;;
 *) echo UNSAFE_COMMAND >> "$BOX/calls"; exit 92 ;;
esac
`);
  chmodSync(join(bin, 'systemctl'), 0o755);
  writeFileSync(join(bin, 'systemd-analyze'), '#!/usr/bin/env bash\n[[ \"$*\" == unit-paths ]] || exit 1\nprintf \"%s\\n\" \"$BOX/unit-root\"\n');
  chmodSync(join(bin, 'systemd-analyze'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOX: root, DROPIN: dropin, INVOCATION_ID: 'invocation-one' };
  const script = join(root, 'deploy.sh');
  writeFileSync(script, `#!/usr/bin/env bash
set -Eeuo pipefail
LIVE_TOUCHED=0
DRAIN_STARTED=0
source ${JSON.stringify(health)}
MCC_TIMEOUT_BOOTSTRAP_DROPIN="$DROPIN"
${rollback}
trap rollback ERR
trap 'rollback 143' TERM
trap 'rollback 130' INT
trap 'rollback 129' HUP
${phase}
echo MODEL_PULL_AND_DRAIN >> "$BOX/calls"
`);
  return { root, bin, dropin, env, script };
}
function run(b, env = {}) {
  return spawnSync('bash', ['-c', `set -e; bash ${JSON.stringify(b.script)}; echo STAMP_DEPLOYED >> "$BOX/calls"`], {
    env: { ...b.env, ...env }, encoding: 'utf8', timeout: 20000,
  });
}
const log = (b) => readFileSync(join(b.root, 'calls'), 'utf8');
const assertNoWork = (b) => assert.doesNotMatch(log(b), /MODEL_PULL|DRAIN|STAMP|UNSAFE|systemctl (start|stop|restart|kill|enable)/);

test('first pass atomically changes only timeout and exits; next invocation independently passes the guard', (t) => {
  const b = box(t);
  const first = run(b);
  assert.equal(first.status, 75, first.stderr);
  assert.equal(readFileSync(b.dropin, 'utf8'), content);
  assert.equal(readFileSync(join(b.root, 'grace'), 'utf8').trim(), '20min');
  assertNoWork(b);
  assert.deepEqual(readdirSync(join(b.root, 'unit.d')), [b.dropin.split('/').at(-1)]);
  assert.doesNotMatch(content, /KillMode|ReadWritePaths|Environment|Protect|ExecStart/);
  writeFileSync(join(b.root, 'calls'), '');
  const second = run(b, { INVOCATION_ID: 'invocation-two' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(log(b), /--property=TimeoutStopUSec --value/);
  assert.match(log(b), /MODEL_PULL_AND_DRAIN/);
  assert.match(log(b), /STAMP_DEPLOYED/);
  assert.doesNotMatch(log(b), /daemon-reload/);
});

test('a manager reload failure removes only this invocation’s new override', (t) => {
  const b = box(t);
  const out = run(b, { FAIL_RELOAD: '1' });
  assert.equal(out.status, 1, out.stderr);
  assert.equal(existsSync(b.dropin), false);
  assert.equal(readFileSync(join(b.root, 'grace'), 'utf8').trim(), '1min 30s');
  assertNoWork(b);
  assert.deepEqual(readdirSync(join(b.root, 'unit.d')), []);
});

test('an interrupted prior atomic install is idempotently reloaded, then still exits for a fresh pass', (t) => {
  const b = box(t); mkdirSync(join(b.root, 'unit.d')); writeFileSync(b.dropin, content);
  assert.equal(run(b).status, 75);
  assert.equal(readFileSync(b.dropin, 'utf8'), content);
  assertNoWork(b);
});

test('failed reload does not delete a preexisting owned override', (t) => {
  const b = box(t); mkdirSync(join(b.root, 'unit.d')); writeFileSync(b.dropin, content);
  assert.equal(run(b, { FAIL_RELOAD: '1' }).status, 1);
  assert.equal(readFileSync(b.dropin, 'utf8'), content);
  assertNoWork(b);
});

test('foreign target contents and symlinks are never overwritten', (t) => {
  const b = box(t); mkdirSync(join(b.root, 'unit.d')); writeFileSync(b.dropin, 'operator owns this');
  assert.equal(run(b).status, 75);
  assert.equal(readFileSync(b.dropin, 'utf8'), 'operator owns this');
  rmSync(b.dropin); writeFileSync(join(b.root, 'operator'), content); symlinkSync(join(b.root, 'operator'), b.dropin);
  assert.equal(run(b).status, 75);
  assert.equal(readFileSync(join(b.root, 'operator'), 'utf8'), content);
  assertNoWork(b);
  assert.doesNotMatch(log(b), /daemon-reload/);
});

test('conflicting foreign timeout assignment is refused without creating the directory', (t) => {
  const b = box(t);
  assert.equal(run(b, { FOREIGN_TIMEOUT: '1' }).status, 75);
  assert.equal(existsSync(join(b.root, 'unit.d')), false);
  assertNoWork(b);
  assert.doesNotMatch(log(b), /daemon-reload/);
});

test('unknown timeout, incompatible kill mode and stopping lifecycle remain fail-closed', (t) => {
  const b = box(t);
  writeFileSync(join(b.root, 'grace'), '10min\n');
  assert.equal(run(b).status, 75);
  writeFileSync(join(b.root, 'grace'), '1min 30s\n');
  assert.equal(run(b, { FAKE_KILL_MODE: 'process' }).status, 75);
  assert.equal(run(b, { FAKE_STATE: 'deactivating' }).status, 75);
  assert.equal(existsSync(join(b.root, 'unit.d')), false);
  assertNoWork(b);
});

test('an atomic-install race never overwrites or removes the competing file', (t) => {
  const b = box(t);
  writeFileSync(join(b.bin, 'ln'), '#!/usr/bin/env bash\nprintf foreign > "$DROPIN"\nexec /usr/bin/ln "$@"\n');
  chmodSync(join(b.bin, 'ln'), 0o755);
  assert.equal(run(b).status, 1);
  assert.equal(readFileSync(b.dropin, 'utf8'), 'foreign');
  assertNoWork(b);
  assert.doesNotMatch(log(b), /daemon-reload/);
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(path, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) { if (Date.now() > deadline) throw new Error(`Timed out: ${path}`); await pause(10); }
}

test('TERM to wrapper, bootstrap and bounded reload rolls back the timeout without touching workloads', async (t) => {
  const b = box(t);
  const wrapper = spawn('bash', ['-c', `set -e; bash ${JSON.stringify(b.script)}; echo STAMP_DEPLOYED >> "$BOX/calls"`], {
    env: { ...b.env, BLOCK_RELOAD: '1' }, detached: true, stdio: 'ignore',
  });
  t.after(() => { try { process.kill(-wrapper.pid, 'SIGKILL'); } catch {} });
  await waitFor(join(b.root, 'ready'));
  process.kill(-wrapper.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (existsSync(b.dropin) || readFileSync(join(b.root, 'grace'), 'utf8').trim() !== '1min 30s') {
    if (Date.now() > deadline) assert.fail('bootstrap did not roll back after TERM');
    await pause(10);
  }
  assertNoWork(b);
});

test('the next invocation cannot trust the installed file when effective grace is still old', (t) => {
  const b = box(t);
  assert.equal(run(b).status, 75);
  writeFileSync(join(b.root, 'grace'), '1min 30s\n');
  writeFileSync(join(b.root, 'calls'), '');
  assert.equal(run(b, { INVOCATION_ID: 'invocation-two' }).status, 75);
  assertNoWork(b);
});

test('a successful reload without effective allowance is rolled back and never proceeds', (t) => {
  const b = box(t);
  const out = run(b, { IGNORE_OVERRIDE: '1' });
  assert.equal(out.status, 75, out.stderr);
  assert.equal(existsSync(b.dropin), false);
  assertNoWork(b);
});

test('a stuck reload CLI is bounded and its new override is rolled back', (t) => {
  const b = box(t); const started = Date.now();
  const out = run(b, { BLOCK_RELOAD: '1' });
  assert.equal(out.status, 1, out.stderr);
  assert.ok(Date.now() - started < 10000);
  assert.equal(existsSync(b.dropin), false);
  assert.equal(readFileSync(join(b.root, 'grace'), 'utf8').trim(), '1min 30s');
  assertNoWork(b);
});

test('unverifiable manager rollback is reported as recovery failure, without workload actions', (t) => {
  const b = box(t);
  const out = run(b, { IGNORE_OVERRIDE: '1', FAIL_RESTORE: '1' });
  assert.equal(out.status, 3, out.stderr);
  assert.match(out.stderr, /TIMEOUT BOOTSTRAP RECOVERY FAILED/);
  assert.equal(existsSync(b.dropin), false);
  assertNoWork(b);
});

for (const suffix of ['service.d', 'mccluster-.service.d', 'mccluster-vps-.service.d', 'mccluster-vps-reconcile.service.d']) {
  test(`unloaded foreign timeout in ${suffix} is refused before any write`, (t) => {
    const b = box(t);
    const dir = join(b.root, 'unit-root', suffix); mkdirSync(dir, { recursive: true });
    const path = join(dir, 'operator.conf'); writeFileSync(path, '[Service]\nTimeoutSec=90s\n');
    const out = run(b);
    assert.equal(out.status, 75, out.stderr);
    assert.equal(existsSync(join(b.root, 'unit.d')), false);
    assert.equal(readFileSync(path, 'utf8'), '[Service]\nTimeoutSec=90s\n');
    assertNoWork(b);
    assert.doesNotMatch(log(b), /daemon-reload/);
  });
}

test('symlinked or excessive on-disk configuration fails closed', (t) => {
  const symlink = box(t);
  const dir = join(symlink.root, 'unit-root/mccluster-vps-reconcile.service.d');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(symlink.root, 'operator.conf'), '[Service]\nNice=10\n');
  symlinkSync(join(symlink.root, 'operator.conf'), join(dir, 'operator.conf'));
  assert.equal(run(symlink).status, 75);
  assert.equal(existsSync(symlink.dropin), false);
  assertNoWork(symlink);
  const excessive = box(t);
  const many = join(excessive.root, 'unit-root/service.d'); mkdirSync(many, { recursive: true });
  for (let i = 0; i < 129; i++) writeFileSync(join(many, `${i}.conf`), '[Service]\nNice=10\n');
  assert.equal(run(excessive).status, 75);
  assert.equal(existsSync(excessive.dropin), false);
  assertNoWork(excessive);
});
