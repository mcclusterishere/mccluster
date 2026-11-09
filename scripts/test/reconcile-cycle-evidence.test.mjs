/*
 * The whole OVH reconciler, run for real against a fixture.
 *
 * scripts/mccluster-vps-reconcile.sh runs as root on the production host every
 * two minutes. Incident #510 needs each cycle to leave a receipt, and that
 * receipt must never be able to fail, delay or change the cycle. These tests
 * run the REAL script, start to finish, in a temporary directory:
 *   - the remote is a local bare Git repository with main and
 *     deploy/ovh-production, read by the real git;
 *   - the deployer the script calls is a fixture inside that repository;
 *   - systemctl, rsync and ssh-keygen are fakes on PATH;
 *   - two lines of the script are rewritten in the copy under test: the root
 *     check, and the systemd unit directory it compares against. The test
 *     refuses to run if either rewrite did not apply.
 * Nothing touches a live host, a network or a real key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { summarizeReconcileCycles, verifiedReconcileCycle } from '../../core/src/reconciler-source-receipt.mjs';

const source = readFileSync(new URL('../mccluster-vps-reconcile.sh', import.meta.url), 'utf8');
const ROOT_CHECK = 'if [[ "${EUID}" -ne 0 ]]; then';
const UNIT_DIR = '/etc/systemd/system/';
const SSH_URL = 'git@github.com:mcclusterishere/mccluster.git';
const RECEIPTS = ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl'];

const FIXTURE_DEPLOYER = `#!/usr/bin/env bash
# Fixture stand-in for scripts/deploy-ovh-core.sh: same arguments, same exit-status contract.
set -Eeuo pipefail
SOURCE_DIR="$1"; DEPLOY_SHA="$2"
echo "fixture deployer \${DEPLOY_SHA}"
if [[ -n "\${FIXTURE_DEPLOY_SLEEP:-}" ]]; then echo started > "\${FIXTURE_STATE}/deploy-started"; sleep "\${FIXTURE_DEPLOY_SLEEP}"; fi
if [[ "\${FIXTURE_DEPLOY_RC:-0}" != 0 ]]; then echo "fixture deployer failing rc=\${FIXTURE_DEPLOY_RC}" >&2; exit "\${FIXTURE_DEPLOY_RC}"; fi
mkdir -p "\${MCCLUSTER_LIVE_CORE}" "\${FIXTURE_UNIT_DIR}"
cp -a "\${SOURCE_DIR}/core/." "\${MCCLUSTER_LIVE_CORE}/"
printf '{"commit_sha":"%s"}\\n' "\${DEPLOY_SHA}" > "\${MCCLUSTER_LIVE_CORE}/.mccluster-deploy.json"
cp "\${SOURCE_DIR}"/core/systemd/* "\${FIXTURE_UNIT_DIR}/"
`;
const FAKES = {
  systemctl: `#!/usr/bin/env bash
echo "systemctl $*" >> "$FIXTURE_STATE/calls.log"
case "$*" in --version) echo "systemd 255 (fixture)" ;; esac
exit 0
`,
  rsync: `#!/usr/bin/env bash
echo "rsync $*" >> "$FIXTURE_STATE/calls.log"
[[ -e "$FIXTURE_STATE/rsync-drift" ]] && echo ">f.st...... app.mjs"
exit 0
`,
  'ssh-keygen': `#!/usr/bin/env bash
echo "ssh-keygen $*" >> "$FIXTURE_STATE/calls.log"
exit 1
`,
};

function host(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcc-reconcile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = (...parts) => join(root, ...parts);
  for (const dir of ['bin', 'home', 'state', 'units', 'seed/core/systemd', 'seed/scripts']) mkdirSync(p(dir), { recursive: true });
  for (const [name, body] of Object.entries(FAKES)) { writeFileSync(p('bin', name), body); chmodSync(p('bin', name), 0o755); }
  writeFileSync(p('state', 'calls.log'), '');
  // Git sees only this configuration: nothing from the machine running the test.
  writeFileSync(p('home', '.gitconfig'), '[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n');
  const gitEnv = {
    PATH: `${p('bin')}:${process.env.PATH}`, HOME: p('home'), LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: p('home', '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid',
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: p('seed'), env: gitEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  writeFileSync(p('seed/core/app.mjs'), 'export const version = 1;\n');
  writeFileSync(p('seed/core/systemd/fixture.service'), '[Service]\nExecStart=/bin/true\n');
  writeFileSync(p('seed/scripts/deploy-ovh-core.sh'), FIXTURE_DEPLOYER);
  git('init', '-q', '.');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture release one');
  git('branch', 'deploy/ovh-production');
  git('clone', '-q', '--bare', p('seed'), p('remote.git'));

  // The copy under test: the real script with the two host-only lines redirected.
  assert.ok(source.includes(ROOT_CHECK) && source.includes(UNIT_DIR), 'the lines this harness redirects exist');
  const copy = source.replace(ROOT_CHECK, 'if false; then').replaceAll(UNIT_DIR, `${p('units')}/`);
  assert.ok(!copy.includes('/etc/systemd/system') && !copy.includes('"${EUID}"'), 'the copy cannot reach the real unit directory');
  assert.equal(copy.split('\n').length, source.split('\n').length);
  writeFileSync(p('reconcile.sh'), copy);

  const env = (extra = {}) => ({
    ...gitEnv, MCCLUSTER_REPO_URL: p('remote.git'), MCCLUSTER_RECONCILE_STATE_ROOT: p('reconcile'), MCCLUSTER_LIVE_CORE: p('live-core'),
    FIXTURE_STATE: p('state'), FIXTURE_UNIT_DIR: p('units'), ...extra,
  });
  const file = (name) => (existsSync(p('reconcile', name)) ? readFileSync(p('reconcile', name), 'utf8') : null);
  const box = {
    root, p, env, file, git,
    json: (name) => { const text = file(name); return text === null ? null : JSON.parse(text); },
    log: () => (file('cycles.jsonl') || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    run: (extra = {}) => spawnSync('/bin/bash', [p('reconcile.sh')], { env: env(extra), encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' }),
    start: (extra = {}) => spawn('/bin/bash', [p('reconcile.sh')], { env: env(extra), detached: true, stdio: 'ignore' }),
    promote(content, { onMain = true } = {}) {
      writeFileSync(p('seed/core/app.mjs'), content);
      git('add', '-A');
      git('commit', '-q', '-m', 'fixture release');
      if (onMain) git('push', '-q', p('remote.git'), 'HEAD:refs/heads/main');
      git('push', '-q', '-f', p('remote.git'), 'HEAD:refs/heads/deploy/ovh-production');
      return git('rev-parse', 'HEAD');
    },
    timer: (digit) => ({ INVOCATION_ID: digit.repeat(32), TRIGGER_UNIT: 'mccluster-vps-reconcile.timer', TRIGGER_TIMER_MONOTONIC_USEC: `${digit}000000000` }),
  };
  return box;
}

test('a deploy cycle and two timer cycles each leave a receipt, and the deploy marker keeps its meaning', (t) => {
  const box = host(t);
  const first = box.run({ INVOCATION_ID: '1'.repeat(32) });
  assert.equal(first.status, 0, first.stderr);
  const sha = box.git('rev-parse', 'HEAD');
  assert.match(first.stdout, new RegExp(`reconciled OVH to ${sha} from deploy/ovh-production\\n$`));
  assert.equal(box.file('deployed_sha'), `${sha}\n`);
  const deployMarker = box.file('last-success.json');
  assert.match(deployMarker, new RegExp(`^\\{"deployed_sha":"${sha}","deploy_ref":"deploy/ovh-production","deployed_at":"[^"]+"\\}\\n$`));
  let last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.trigger, last.cycle_id], ['deployed', 'complete', 0, 'other', '1'.repeat(32)]);
  assert.deepEqual([last.github_main_sha, last.github_promoted_sha, last.deployed_sha], [sha, sha, sha]);
  assert.deepEqual(box.json('last-verified-cycle.json'), last);

  for (const digit of ['2', '3']) {
    const cycle = box.run(box.timer(digit));
    assert.equal(cycle.status, 0, cycle.stderr);
    assert.match(cycle.stdout, new RegExp(`already deployed and attested ${sha}\\n$`));
    last = box.json('last-cycle.json');
    assert.deepEqual([last.outcome, last.stage, last.exit_code, last.trigger, last.cycle_id], ['verified_no_change', 'complete', 0, 'timer', digit.repeat(32)]);
    assert.deepEqual(box.json('last-verified-cycle.json'), last, 'a no-change cycle that verified the ref is a recorded success');
  }
  assert.equal(box.file('last-success.json'), deployMarker, 'last-success.json is still the last DEPLOY: no-change cycles never rewrite it');
  assert.equal(box.log().length, 3);
  // The fixture remote is a local path, so no claim about SSH or HTTPS is made.
  assert.deepEqual([last.transport, last.ssh_host_key_pinned, last.ssh_key_fingerprint, last.https_credential_configured], ['other', false, '', false]);

  const summary = summarizeReconcileCycles({ latest: box.json('last-cycle.json'), verified: box.json('last-verified-cycle.json'), history: box.file('cycles.jsonl') });
  assert.equal(summary.status, 'verified');
  assert.equal(summary.distinct_successful_cycles, 3);
  assert.equal(summary.distinct_successful_timer_cycles, 2, 'two distinct timer-triggered cycles are provable from the files alone');
  assert.equal(summary.distinct_authenticated_timer_cycles, 0);
  assert.equal(summary.authenticated, false);
  assert.deepEqual(readdirSync(box.p('reconcile')).sort(), ['cycles.jsonl', 'deployed_sha', 'last-cycle.json', 'last-source-fetch.json', 'last-success.json', 'last-verified-cycle.json', 'reconcile.lock', 'source']);
});

test('the pinned SSH configuration proves nothing when Git rewrites the URL: the receipt follows the effective remote', (t) => {
  const box = host(t);
  mkdirSync(box.p('reconcile/ssh'), { recursive: true });
  writeFileSync(box.p('reconcile/ssh/github_deploy_ed25519.pub'), 'ssh-ed25519 FIXTURE-PUBLIC-HALF-NOT-A-KEY fixture\n');
  writeFileSync(box.p('reconcile/ssh/github_known_hosts'), 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
  const pinned = `/usr/bin/ssh -F /dev/null -i ${box.p('reconcile/ssh/github_deploy_ed25519')} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${box.p('reconcile/ssh/github_known_hosts')} -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no`;
  // The unit is configured exactly as the SSH setup script leaves it, but a
  // url.*.insteadOf rule sends the fetch somewhere else (here: the fixture).
  writeFileSync(box.p('home', '.gitconfig'), `[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n[url "${box.p('remote.git')}"]\n\tinsteadOf = ${SSH_URL}\n`);
  const cycle = box.run({ MCCLUSTER_REPO_URL: SSH_URL, GIT_SSH_COMMAND: pinned, ...box.timer('4') });
  assert.equal(cycle.status, 0, cycle.stderr);
  assert.match(cycle.stdout, /reconciled OVH to [0-9a-f]{40} from deploy\/ovh-production\n$/);
  const last = box.json('last-cycle.json');
  assert.equal(last.outcome, 'deployed');
  assert.deepEqual([last.transport, last.ssh_host_key_pinned, last.ssh_key_fingerprint], ['other', false, ''], 'configuration alone is not evidence of the transport');
  assert.equal(verifiedReconcileCycle(last).authenticated, false);
  assert.doesNotMatch(readFileSync(box.p('state', 'calls.log'), 'utf8'), /ssh-keygen/, 'no key is fingerprinted for a transport that was not used');
});

test('failures keep their exit status and output, name their stage, and never replace the last verified cycle', (t) => {
  const box = host(t);
  assert.equal(box.run(box.timer('1')).status, 0);
  const verified = box.file('last-verified-cycle.json');
  const deployedSha = box.file('deployed_sha');
  const deployMarker = box.file('last-success.json');

  const next = box.promote('export const version = 2;\n');
  const failed = box.run({ ...box.timer('2'), FIXTURE_DEPLOY_RC: '1' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /fixture deployer failing rc=1\n$/);
  let last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.interrupted, last.cycle_id], ['failed', 'deploy', 1, false, '2'.repeat(32)]);
  assert.equal(last.github_promoted_sha, next);
  assert.equal(`${last.deployed_sha}\n`, deployedSha, 'the host is still on the previous release');

  const deferred = box.run({ ...box.timer('3'), FIXTURE_DEPLOY_RC: '75' });
  assert.equal(deferred.status, 75, 'a deferral keeps EX_TEMPFAIL');
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code], ['deferred', 'deploy', 75]);

  const rollback = box.run({ ...box.timer('4'), FIXTURE_DEPLOY_RC: '3' });
  assert.equal(rollback.status, 3);
  assert.deepEqual([box.json('last-cycle.json').outcome, box.json('last-cycle.json').exit_code], ['failed', 3]);
  assert.equal(box.file('last-verified-cycle.json'), verified);
  assert.equal(box.file('deployed_sha'), deployedSha);
  assert.equal(box.file('last-success.json'), deployMarker);

  // The ancestry gate: a promoted commit that is not contained in main.
  const stray = box.promote('export const version = 3;\n', { onMain: false });
  const refused = box.run(box.timer('5'));
  assert.equal(refused.status, 3);
  assert.equal(refused.stderr.trim().split('\n').at(-1), `refusing deploy: ${stray} is not contained in origin/main`);
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.github_promoted_sha, last.github_main_sha], ['failed', 'ancestry', 3, stray, '']);

  // An unapproved deployment ref is refused, and its commit is never named under the approved label.
  box.git('push', '-q', box.p('remote.git'), 'HEAD:refs/heads/main', 'HEAD:refs/heads/other');
  const unapproved = box.run({ ...box.timer('6'), MCCLUSTER_DEPLOY_REF: 'other' });
  assert.equal(unapproved.status, 3);
  assert.match(unapproved.stderr, /refusing source attestation for unapproved deployment ref\n$/);
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.github_promoted_sha, last.promoted_ref], ['failed', 'ancestry', '', 'deploy/ovh-production']);

  // The October failure: the remote cannot be read at all.
  const unreadable = box.run({ ...box.timer('7'), MCCLUSTER_REPO_URL: box.p('no-such-remote.git') });
  assert.equal(unreadable.status, 128);
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.github_promoted_sha], ['failed', 'fetch', 128, '']);
  assert.equal(box.file('last-verified-cycle.json'), verified);

  const summary = summarizeReconcileCycles({ latest: last, verified: JSON.parse(verified), history: box.file('cycles.jsonl') });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.last_cycle.stage, 'fetch');
  assert.equal(summary.consecutive_failed_cycles, 4, 'four failures in a row; the deferral before them is not one');
  assert.equal(summary.last_verified_cycle.cycle_id, '1'.repeat(32));

  // And the pending release deploys once the remote is readable again.
  const recovered = box.run(box.timer('8'));
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(box.json('last-cycle.json').outcome, 'deployed');
  assert.equal(box.file('deployed_sha'), `${stray}\n`);
  assert.notEqual(box.file('last-success.json'), deployMarker);
});

test('a run that cannot take the lock exits 0 as before and records nothing', (t) => {
  const box = host(t);
  assert.equal(box.run(box.timer('1')).status, 0);
  const before = RECEIPTS.map((name) => box.file(name));
  const held = spawnSync('/bin/bash', ['-c', 'exec 8>"$1"; flock -n 8 || exit 99; /bin/bash "$2"', 'lock', box.p('reconcile/reconcile.lock'), box.p('reconcile.sh')],
    { env: box.env(box.timer('2')), encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  assert.equal(held.status, 0, held.stderr);
  assert.equal(held.stdout, 'reconcile already running\n');
  assert.deepEqual(RECEIPTS.map((name) => box.file(name)), before);
});

test('a cycle terminated mid-deploy still dies by the signal, and says so in its receipt', async (t) => {
  const box = host(t);
  assert.equal(box.run(box.timer('1')).status, 0);
  const verified = box.file('last-verified-cycle.json');
  const deployedSha = box.file('deployed_sha');
  box.promote('export const version = 2;\n');
  const child = box.start({ ...box.timer('2'), FIXTURE_DEPLOY_SLEEP: '60' });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } });
  const exited = once(child, 'exit');
  for (let waited = 0; !existsSync(box.p('state', 'deploy-started')); waited += 50) {
    assert.ok(waited < 20_000 && child.exitCode === null, 'the fixture deployer started');
    await sleep(50);
  }
  // systemd's KillMode=control-group signals the wrapper and the deployer together.
  const signalled = Date.now();
  process.kill(-child.pid, 'SIGTERM');
  const [code, signal] = await exited;
  assert.ok(Date.now() - signalled < 15_000, 'the receipt does not hold the wrapper back');
  assert.deepEqual([code, signal], [null, 'SIGTERM'], 'the wrapper still ends by the signal, not by an exit status of its own');
  const last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.cycle_id], ['failed', 'deploy', '2'.repeat(32)]);
  // Either the shell saw its own termination first, or it saw the deployer die of the same signal.
  assert.ok((last.interrupted === true && last.exit_code === null) || (last.interrupted === false && last.exit_code === 143), JSON.stringify(last));
  assert.equal(box.file('last-verified-cycle.json'), verified);
  assert.equal(box.file('deployed_sha'), deployedSha, 'an interrupted deploy is not stamped');
  assert.equal(summarizeReconcileCycles({ latest: last, verified: JSON.parse(verified), history: box.file('cycles.jsonl') }).status, 'failed');
});

test('when evidence cannot be written the cycle is exactly what it was without it', (t) => {
  const box = host(t);
  assert.equal(box.run(box.timer('1')).status, 0);
  const normal = box.run(box.timer('2'));
  for (const name of RECEIPTS) {
    rmSync(box.p('reconcile', name), { force: true });
    mkdirSync(box.p('reconcile', name));
    writeFileSync(box.p('reconcile', name, 'occupied'), '');
  }
  const blocked = box.run(box.timer('3'));
  assert.equal(blocked.status, normal.status);
  assert.equal(blocked.stdout, normal.stdout);
  assert.equal(blocked.stderr, RECEIPTS.map((name) => `mccluster-vps-reconcile: cycle evidence not written: ${name}\n`).join(''));
  const failing = box.run({ ...box.timer('4'), MCCLUSTER_REPO_URL: box.p('no-such-remote.git') });
  assert.equal(failing.status, 128, 'and a failing cycle fails with the same status');
  for (const name of RECEIPTS) assert.deepEqual(readdirSync(box.p('reconcile', name)), ['occupied']);
});
