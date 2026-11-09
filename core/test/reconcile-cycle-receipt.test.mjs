/*
 * Incident #510 closure evidence. A reconcile cycle must leave a receipt that
 * says which systemd invocation ran it, what started it, how it ended and how
 * the repository was really read, and that receipt must never be able to fail,
 * delay or change the cycle that wrote it.
 *
 * The shell tests run the REAL evidence functions from
 * scripts/mccluster-vps-reconcile.sh (everything above its root check) in a
 * temporary state root, with git, ssh-keygen and systemctl replaced by fakes on
 * PATH. Nothing touches a live host, a network or a real key: the "keys" are
 * marker strings. The full script, against a fixture Git remote, is exercised
 * by scripts/test/reconcile-cycle-evidence.test.mjs. How Core reads the
 * receipts is in reconcile-cycle-health.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync, symlinkSync, lstatSync, statSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifiedReconcileCycle } from '../src/reconciler-source-receipt.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const script = read('scripts/mccluster-vps-reconcile.sh');
const ROOT_CHECK = 'if [[ "${EUID}" -ne 0 ]]; then';
const head = script.slice(0, script.indexOf(ROOT_CHECK));
const flow = script.slice(script.indexOf(ROOT_CHECK));

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const FP = `SHA256:${'A'.repeat(43)}`;
const SSH_URL = 'git@github.com:mcclusterishere/mccluster.git';
const HTTPS_URL = 'https://github.com/mcclusterishere/mccluster.git';
const HOST_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const PRIVATE_MARKER = 'FIXTURE-PRIVATE-HALF-NOT-A-KEY';
const TOKEN_MARKER = 'fixture-token-never-print';

const FAKE_GIT = `#!/usr/bin/env bash
echo "git $*" >> "$FIXTURE_STATE/calls.log"
case "$*" in
  *"remote get-url origin"*) [[ -n "\${FAKE_ORIGIN_URL:-}" ]] || exit 2; printf '%s\\n' "$FAKE_ORIGIN_URL" ;;
  *"ls-remote --get-url"*) printf '%s\\n' "\${FAKE_REWRITTEN_URL:-\${!#}}" ;;
  *"config --get-regexp"*) [[ "\${FAKE_CREDENTIAL_CONFIG:-0}" == 1 ]] || exit 1; echo "credential.helper ${TOKEN_MARKER}" ;;
  *) echo "unexpected git call: $*" >&2; exit 64 ;;
esac
`;
const FAKE_SSH_KEYGEN = `#!/usr/bin/env bash
echo "ssh-keygen $*" >> "$FIXTURE_STATE/calls.log"
for arg in "$@"; do
  if [[ "$arg" == *.pub ]]; then echo "256 \${FAKE_KEY_FINGERPRINT:-${FP}} fixture-not-a-real-key (ED25519)"; exit 0; fi
done
echo "the fixture refuses anything but a public key" >&2
exit 1
`;
const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
echo "systemctl $*" >> "$FIXTURE_STATE/calls.log"
[[ -n "\${FAKE_SYSTEMCTL_HANG:-}" ]] && exec sleep "$FAKE_SYSTEMCTL_HANG"
case "$*" in
  --version) echo "systemd \${FAKE_SYSTEMD_VERSION:-255} (fixture)"; echo "+PAM +AUDIT" ;;
  *"--property=InvocationID --property=ExecMainStartTimestampMonotonic"*)
    echo "InvocationID=\${FAKE_UNIT_INVOCATION:-}"; echo "ExecMainStartTimestampMonotonic=\${FAKE_START_US:-0}" ;;
  *"--property=LastTriggerUSecMonotonic --value"*) echo "\${FAKE_TIMER_US:-0}" ;;
  *) echo "unexpected systemctl call: $*" >&2; exit 64 ;;
esac
`;

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcc-cycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, 'reconcile');
  for (const dir of ['bin', 'fixture', 'home', 'reconcile/ssh', 'reconcile/source/.git']) mkdirSync(join(root, dir), { recursive: true });
  for (const [name, body] of [['git', FAKE_GIT], ['ssh-keygen', FAKE_SSH_KEYGEN], ['systemctl', FAKE_SYSTEMCTL]]) {
    writeFileSync(join(root, 'bin', name), body);
    chmodSync(join(root, 'bin', name), 0o755);
  }
  writeFileSync(join(root, 'fixture/calls.log'), '');
  writeFileSync(join(state, 'ssh/github_deploy_ed25519'), `${PRIVATE_MARKER}\n`);
  writeFileSync(join(state, 'ssh/github_deploy_ed25519.pub'), 'ssh-ed25519 FIXTURE-PUBLIC-HALF-NOT-A-KEY fixture\n');
  writeFileSync(join(state, 'ssh/github_known_hosts'), `${HOST_KEY}\n`);
  writeFileSync(join(state, 'deployed_sha'), `${B}\n`);
  const pinned = `/usr/bin/ssh -F /dev/null -i ${state}/ssh/github_deploy_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${state}/ssh/github_known_hosts -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no`;
  const box = {
    root, state, pinned,
    ssh: { MCCLUSTER_REPO_URL: SSH_URL, FAKE_ORIGIN_URL: SSH_URL, GIT_SSH_COMMAND: pinned },
    https: { MCCLUSTER_REPO_URL: HTTPS_URL, FAKE_ORIGIN_URL: HTTPS_URL },
    timer: (id) => ({ INVOCATION_ID: id.repeat(32), TRIGGER_UNIT: 'mccluster-vps-reconcile.timer', TRIGGER_TIMER_MONOTONIC_USEC: '7200000000' }),
    file: (name) => (existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8') : null),
    json: (name) => { const text = box.file(name); return text === null ? null : JSON.parse(text); },
    log: () => (box.file('cycles.jsonl') || '').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    calls: () => readFileSync(join(root, 'fixture/calls.log'), 'utf8'),
    // Runs the script's own head (variables and evidence functions), then body.
    run(env = {}, body = 'mcc_cycle_receipt verified_no_change 0 || true', { path } = {}) {
      const prelude = [
        // Never let a harness mistake reach a real state directory.
        `[[ "\${STATE_ROOT}" == ${JSON.stringify(state)} ]] || { echo "state root is not the sandbox" >&2; exit 97; }`,
        `CYCLE_MAIN_SHA=${A}; CYCLE_PROMOTED_SHA=${B}; CYCLE_STAGE=complete; CYCLE_OWNS_LOCK=1`,
      ].join('\n');
      return spawnSync('/bin/bash', ['-c', `${head}\n${prelude}\n${body}\n`], {
        encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
        env: {
          PATH: path || `${join(root, 'bin')}:${process.env.PATH}`, HOME: join(root, 'home'), LC_ALL: 'C',
          MCCLUSTER_RECONCILE_STATE_ROOT: state, FIXTURE_STATE: join(root, 'fixture'), ...env,
        },
      });
    },
  };
  return box;
}

test('the evidence block is everything the function-level tests need, and nothing in it runs a command at load', () => {
  assert.ok(script.indexOf(ROOT_CHECK) > 0 && head.includes('mcc_cycle_on_exit() {') && head.includes('mcc_cycle_receipt_write() {'));
  assert.ok(!flow.includes('mcc_cycle_receipt_write() {'), 'the evidence functions are defined before the cycle starts');
  // Outside function bodies the head only assigns variables: sourcing it does nothing.
  let depth = 0;
  for (const line of head.split('\n')) {
    if (/^[a-z_]+\(\) \{$/.test(line)) { depth = 1; continue; }
    if (depth) { if (line === '}') depth = 0; continue; }
    assert.match(line, /^(#.*|[A-Z_]+=.*|set -Eeuo pipefail|)$/, `unexpected top-level statement: ${line}`);
  }
});

test('a timer-started SSH cycle records the invocation, the trigger, the transport and the deploy key fingerprint', (t) => {
  const box = sandbox(t);
  const result = box.run({ ...box.ssh, ...box.timer('f') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const last = box.json('last-cycle.json');
  assert.deepEqual(last, {
    schema_version: 'mccluster-reconcile-cycle/v1', repository: 'mcclusterishere/mccluster', promoted_ref: 'deploy/ovh-production',
    cycle_id: 'f'.repeat(32), trigger: 'timer', timer_trigger_monotonic_usec: '7200000000',
    outcome: 'verified_no_change', stage: 'complete', exit_code: 0, interrupted: false,
    transport: 'ssh', ssh_host_key_pinned: true, ssh_key_fingerprint: FP, https_credential_configured: false,
    github_main_sha: A, github_promoted_sha: B, deployed_sha: B, started_at: last.started_at, finished_at: last.finished_at,
  });
  assert.match(last.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(box.json('last-verified-cycle.json'), last, 'a verified no-change cycle is a successful reconciliation');
  assert.deepEqual(box.log(), [last]);
  const view = verifiedReconcileCycle(last);
  assert.equal(view.authenticated, true);
  assert.equal(view.timer_triggered, true);
  for (const name of ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl']) {
    assert.equal(statSync(join(box.state, name)).mode & 0o777, 0o644, `${name} is world-readable, owner-writable`);
  }
  assert.deepEqual(readdirSync(box.state).filter((name) => name.includes('.tmp')), [], 'no temporary file is left behind');
});

test('the private key is never opened and no key or token text reaches any output', (t) => {
  const box = sandbox(t);
  const result = box.run({ ...box.ssh, ...box.timer('e') });
  const keygen = box.calls().split('\n').filter((line) => line.startsWith('ssh-keygen '));
  assert.deepEqual(keygen, [`ssh-keygen -lf ${box.state}/ssh/github_deploy_ed25519.pub -E sha256`], 'only the public half is fingerprinted');
  const everything = [result.stdout, result.stderr, box.file('last-cycle.json'), box.file('cycles.jsonl'), box.calls()].join('\n');
  assert.doesNotMatch(everything, new RegExp(PRIVATE_MARKER));
  assert.doesNotMatch(head, /cat\s+"\$\{key\}"|<\s*"\$\{key\}"\s|ssh-keygen[^\n]*-y/, 'nothing reads or derives from the private half');
  assert.doesNotMatch(head, /\bgit (fetch|clone|pull|push)\b|\bcurl\b|\bwget\b|ls-remote(?! --get-url)/, 'evidence adds no network call');
  assert.match(head, /mcc_cycle_bounded git ls-remote --get-url "\$\{REPO_URL\}"/, 'the one ls-remote resolves a URL and contacts nothing');
});

test('the transport is the URL Git resolves, not the URL the unit configured', (t) => {
  const box = sandbox(t);
  // Configured for SSH with the pinned command, but a url.*.insteadOf rewrite sends the fetch over HTTPS.
  box.run({ ...box.ssh, FAKE_ORIGIN_URL: HTTPS_URL, ...box.timer('1') });
  let last = box.json('last-cycle.json');
  assert.equal(last.transport, 'https');
  assert.equal(last.ssh_host_key_pinned, false);
  assert.equal(last.ssh_key_fingerprint, '');
  assert.equal(verifiedReconcileCycle(last).authenticated, false, 'an anonymous fetch is never recorded as authenticated');
  // A rewrite to any other host or form is "other": no claim is made about it.
  for (const url of ['git@github.example:mcclusterishere/mccluster.git', 'ssh://git@github.com/mcclusterishere/mccluster.git',
    'git@github.com:mcclusterishere/mccluster', 'https://github.com/mcclusterishere/mccluster.git/', 'https://evil.example/x@github.com/mcclusterishere/mccluster.git',
    'file:///srv/mirror/mccluster.git', '/srv/mirror/mccluster.git']) {
    box.run({ ...box.ssh, FAKE_ORIGIN_URL: url, FAKE_REWRITTEN_URL: url, ...box.timer('2') });
    last = box.json('last-cycle.json');
    assert.equal(last.transport, 'other', url);
    assert.equal(last.ssh_host_key_pinned, false, url);
    assert.equal(last.ssh_key_fingerprint, '', url);
    assert.equal(verifiedReconcileCycle(last).authenticated, false, url);
  }
  // No checkout yet (a failed first clone): the configured URL is resolved without contacting the remote.
  rmSync(join(box.state, 'source'), { recursive: true });
  box.run({ ...box.ssh, FAKE_ORIGIN_URL: '', ...box.timer('3') });
  assert.equal(box.json('last-cycle.json').transport, 'ssh');
  assert.match(box.calls(), new RegExp(`git ls-remote --get-url ${SSH_URL.replace(/[.]/g, '\\.')}`));
});

test('a pinned host key and a named key need the exact installed command and the exact known-hosts line', (t) => {
  const box = sandbox(t);
  const known = join(box.state, 'ssh/github_known_hosts');
  const variants = [
    ['a second identity', { GIT_SSH_COMMAND: `${box.pinned} -i /root/.ssh/id_ed25519` }],
    ['trust on first use', { GIT_SSH_COMMAND: box.pinned.replace('StrictHostKeyChecking=yes', 'StrictHostKeyChecking=accept-new') }],
    ['an agent identity', { GIT_SSH_COMMAND: box.pinned.replace(' -o IdentitiesOnly=yes', '') }],
    ['the system known-hosts file', { GIT_SSH_COMMAND: box.pinned.replace(' -o GlobalKnownHostsFile=/dev/null', '') }],
    ['a user ssh config', { GIT_SSH_COMMAND: box.pinned.replace('-F /dev/null ', '') }],
    ['no command at all', { GIT_SSH_COMMAND: '' }],
  ];
  for (const [name, env] of variants) {
    box.run({ ...box.ssh, ...box.timer('4'), ...env });
    const last = box.json('last-cycle.json');
    assert.equal(last.transport, 'ssh', name);
    assert.equal(last.ssh_host_key_pinned, false, name);
    assert.equal(last.ssh_key_fingerprint, '', name);
    assert.equal(verifiedReconcileCycle(last).authenticated, false, name);
  }
  const hosts = [
    ['a second host key', `${HOST_KEY}\ngithub.com ssh-ed25519 AAAAFIXTUREOTHERKEY\n`],
    ['a certificate authority line', `${HOST_KEY}\n@cert-authority * ssh-ed25519 AAAAFIXTURECA\n`],
    ['a different key', 'github.com ssh-ed25519 AAAAFIXTUREOTHERKEY\n'],
    ['a wildcard host', `* ${HOST_KEY.split(' ').slice(1).join(' ')}\n`],
    ['padding that hides a later line', `${HOST_KEY}\n${'\n'.repeat(500)}@cert-authority * ssh-ed25519 AAAAFIXTURECA\n`],
    ['an empty file', ''],
  ];
  for (const [name, content] of hosts) {
    writeFileSync(known, content);
    box.run({ ...box.ssh, ...box.timer('5') });
    const last = box.json('last-cycle.json');
    assert.equal(last.ssh_host_key_pinned, false, name);
    assert.equal(last.ssh_key_fingerprint, FP, `${name}: the offered key is still named`);
    assert.equal(verifiedReconcileCycle(last).authenticated, false, name);
  }
  rmSync(known);
  symlinkSync(join(box.root, 'fixture/elsewhere'), known);
  writeFileSync(join(box.root, 'fixture/elsewhere'), `${HOST_KEY}\n`);
  box.run({ ...box.ssh, ...box.timer('6') });
  assert.equal(box.json('last-cycle.json').ssh_host_key_pinned, false, 'a symlinked known-hosts file is not the pinned file');
  rmSync(known);
  writeFileSync(known, HOST_KEY);
  box.run({ ...box.ssh, ...box.timer('7') });
  assert.equal(box.json('last-cycle.json').ssh_host_key_pinned, true, 'the exact line without a final newline is still exactly that line');
  // The fingerprint comes from the public half only, and only when it looks like one.
  for (const value of ['SHA256:short', 'MD5:aa:bb', `SHA256:${'A'.repeat(43)}","x":"y`]) {
    box.run({ ...box.ssh, ...box.timer('8'), FAKE_KEY_FINGERPRINT: value });
    assert.equal(box.json('last-cycle.json').ssh_key_fingerprint, '', value);
  }
  rmSync(join(box.state, 'ssh/github_deploy_ed25519.pub'));
  box.run({ ...box.ssh, ...box.timer('9') });
  assert.equal(box.json('last-cycle.json').ssh_key_fingerprint, '', 'without a public half there is no fingerprint');
  assert.equal(box.json('last-cycle.json').ssh_host_key_pinned, true);
});

test('anonymous HTTPS is never authenticated, and a configured credential is one boolean and nothing more', (t) => {
  const box = sandbox(t);
  box.run({ ...box.https, ...box.timer('a') });
  let last = box.json('last-cycle.json');
  assert.equal(last.transport, 'https');
  assert.equal(last.https_credential_configured, false);
  assert.equal(verifiedReconcileCycle(last).authenticated, false);

  const withHelper = box.run({ ...box.https, ...box.timer('b'), FAKE_CREDENTIAL_CONFIG: '1' });
  last = box.json('last-cycle.json');
  assert.equal(last.https_credential_configured, true);
  assert.equal(verifiedReconcileCycle(last).authenticated, false, 'a public repository answers HTTPS without asking for the credential');

  const embedded = `https://x-access-token:${TOKEN_MARKER}@github.com/mcclusterishere/mccluster.git`;
  const withToken = box.run({ MCCLUSTER_REPO_URL: embedded, FAKE_ORIGIN_URL: embedded, ...box.timer('c') });
  last = box.json('last-cycle.json');
  assert.equal(last.transport, 'https');
  assert.equal(last.https_credential_configured, true);
  for (const [name, env] of [['an askpass helper', { GIT_ASKPASS: '/usr/local/bin/fixture-askpass' }]]) {
    box.run({ ...box.https, ...box.timer('d'), ...env });
    assert.equal(box.json('last-cycle.json').https_credential_configured, true, name);
  }
  writeFileSync(join(box.root, 'home/.netrc'), `machine github.com login x password ${TOKEN_MARKER}\n`);
  box.run({ ...box.https, ...box.timer('e') });
  assert.equal(box.json('last-cycle.json').https_credential_configured, true, 'a netrc file');
  const outputs = [withHelper.stdout, withHelper.stderr, withToken.stdout, withToken.stderr, box.file('cycles.jsonl'), box.file('last-cycle.json')].join('\n');
  assert.doesNotMatch(outputs, new RegExp(TOKEN_MARKER), 'no credential text is ever written or printed');
  assert.doesNotMatch(outputs, /x-access-token|askpass/);
});

test('systemd 252 and later: only its own TRIGGER_UNIT statement makes a timer cycle', (t) => {
  const box = sandbox(t);
  const near = { FAKE_UNIT_INVOCATION: '1'.repeat(32), FAKE_TIMER_US: '1000000000', FAKE_START_US: '1000000500' };
  const trigger = (env) => { box.run({ ...box.ssh, ...env }); return box.json('last-cycle.json'); };
  assert.equal(trigger({ ...box.timer('1') }).trigger, 'timer');
  // Started by hand: systemd would have said so if the timer had started it. No inference.
  const manual = trigger({ INVOCATION_ID: '1'.repeat(32), FAKE_SYSTEMD_VERSION: '255', ...near });
  assert.equal(manual.trigger, 'other');
  assert.equal(manual.cycle_id, '1'.repeat(32));
  assert.equal(manual.timer_trigger_monotonic_usec, '');
  assert.equal(trigger({ INVOCATION_ID: '1'.repeat(32), FAKE_SYSTEMD_VERSION: '252', ...near }).trigger, 'other');
  assert.equal(trigger({ INVOCATION_ID: '2'.repeat(32), TRIGGER_UNIT: 'some-other.timer', TRIGGER_TIMER_MONOTONIC_USEC: '5' }).trigger, 'other');
  assert.equal(trigger({ INVOCATION_ID: '2'.repeat(32), TRIGGER_UNIT: 'mccluster-vps-reconcile.path' }).trigger, 'other');
  // Outside systemd there is no invocation: a copied variable proves nothing.
  const shell = trigger({ TRIGGER_UNIT: 'mccluster-vps-reconcile.timer', TRIGGER_TIMER_MONOTONIC_USEC: '5' });
  assert.equal(shell.trigger, 'other');
  assert.equal(shell.cycle_id, '');
  assert.equal(shell.timer_trigger_monotonic_usec, '');
});

test('older systemd: a timer cycle is inferred only for this invocation, inside the window, once per timer elapse', (t) => {
  const box = sandbox(t);
  const old = (id, extra) => {
    box.run({ ...box.ssh, INVOCATION_ID: id.repeat(32), FAKE_UNIT_INVOCATION: id.repeat(32), FAKE_SYSTEMD_VERSION: '249', ...extra });
    return box.json('last-cycle.json');
  };
  const near = old('1', { FAKE_TIMER_US: '1000000000', FAKE_START_US: '1000040000' });
  assert.equal(near.trigger, 'timer_inferred');
  assert.equal(near.timer_trigger_monotonic_usec, '1000000000');
  assert.equal(verifiedReconcileCycle(near).timer_triggered, true);
  // The same elapse cannot start a second cycle: a start by hand right after a fast timer cycle is not a timer cycle.
  const again = old('2', { FAKE_TIMER_US: '1000000000', FAKE_START_US: '1001500000' });
  assert.equal(again.trigger, 'other');
  assert.equal(again.timer_trigger_monotonic_usec, '');
  // Nor a third: the elapse is looked up in the whole retained history, not only in the last receipt.
  assert.equal(old('a', { FAKE_TIMER_US: '1000000000', FAKE_START_US: '1001900000' }).trigger, 'other');
  rmSync(join(box.state, 'last-cycle.json'));
  assert.equal(old('b', { FAKE_TIMER_US: '1000000000', FAKE_START_US: '1001950000' }).trigger, 'other', 'the log alone remembers the elapse');
  assert.equal(old('3', { FAKE_TIMER_US: '2000000000', FAKE_START_US: '2002000000' }).trigger, 'timer_inferred', 'the edge of the window');
  assert.equal(old('4', { FAKE_TIMER_US: '3000000000', FAKE_START_US: '3002000001' }).trigger, 'other', 'one microsecond past the window');
  assert.equal(old('5', { FAKE_TIMER_US: '4000000000', FAKE_START_US: '3999999999' }).trigger, 'other', 'the timer elapsed again after this cycle started');
  assert.equal(old('6', { FAKE_TIMER_US: '5000000000', FAKE_START_US: '5000000100', FAKE_UNIT_INVOCATION: 'f'.repeat(32) }).trigger, 'other', 'the unit is running another invocation');
  for (const [timer, start] of [['0', '100'], ['', ''], ['n/a', '6000000100'], ['6000000000', '06000000100'], ['-5', '5'], ['6000000000', '6000000100; touch x']]) {
    assert.equal(old('7', { FAKE_TIMER_US: timer, FAKE_START_US: start }).trigger, 'other', `${timer} / ${start}`);
  }
  for (const version of ['', 'abc', '0249', '25', '2490', '251x']) {
    assert.equal(old('8', { FAKE_SYSTEMD_VERSION: version, FAKE_TIMER_US: '7000000000', FAKE_START_US: '7000000100' }).trigger, 'other', `version ${version}`);
  }
  assert.equal(old('9', { FAKE_SYSTEMD_VERSION: '251', FAKE_TIMER_US: '8000000000', FAKE_START_US: '8000000100' }).trigger, 'timer_inferred', 'the last version without TRIGGER_UNIT');
});

test('evidence is bounded: a helper that hangs costs the budget, never the cycle', (t) => {
  const box = sandbox(t);
  const started = Date.now();
  const result = box.run({ ...box.ssh, INVOCATION_ID: '1'.repeat(32), FAKE_SYSTEMD_VERSION: '249', FAKE_SYSTEMCTL_HANG: '30', FAKE_UNIT_INVOCATION: '1'.repeat(32) },
    'CYCLE_EVIDENCE_BUDGET=1\nmcc_cycle_receipt verified_no_change 0 || true\necho after');
  const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'after\n');
  assert.ok(elapsed < 8000, `a 30 second hang must be cut at the budget (took ${elapsed} ms)`);
  const last = box.json('last-cycle.json');
  assert.equal(last.trigger, 'other', 'an unanswered question is recorded as unknown, not guessed');
  assert.equal(last.outcome, 'verified_no_change');
  assert.equal(last.cycle_id, '1'.repeat(32));
  assert.match(head, /CYCLE_EVIDENCE_BUDGET=10\n/);
  assert.match(head, /timeout --foreground --signal=TERM --kill-after=1s "\$\{left\}s" "\$@" <\/dev\/null 2>\/dev\/null/);
});

test('without coreutils timeout no evidence command is run at all, and the cycle outcome is still recorded', (t) => {
  const box = sandbox(t);
  const tools = join(box.root, 'tools');
  mkdirSync(tools);
  for (const name of ['env', 'bash', 'date', 'rm', 'chmod', 'mv', 'tail', 'sleep']) {
    const found = spawnSync('/bin/bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(found, `${name} is available`);
    symlinkSync(found, join(tools, name));
  }
  const result = box.run({ ...box.ssh, ...box.timer('1') }, 'mcc_cycle_receipt verified_no_change 0 || true\necho after', { path: `${join(box.root, 'bin')}:${tools}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'after\n');
  assert.equal(box.calls(), '', 'git, ssh-keygen and systemctl were never started unbounded');
  const last = box.json('last-cycle.json');
  assert.equal(last.transport, 'other');
  assert.equal(last.ssh_host_key_pinned, false);
  assert.equal(last.trigger, 'timer', 'what systemd itself put in the environment needs no command');
  assert.equal(last.outcome, 'verified_no_change');
});

test('the cycle log is bounded and keeps only receipt lines', (t) => {
  const box = sandbox(t);
  const line = (index) => JSON.stringify({
    schema_version: 'mccluster-reconcile-cycle/v1', repository: 'mcclusterishere/mccluster', promoted_ref: 'deploy/ovh-production',
    cycle_id: index.toString(16).padStart(32, '0'), trigger: 'timer', timer_trigger_monotonic_usec: String(1_000_000 + index),
    outcome: 'verified_no_change', stage: 'complete', exit_code: 0, interrupted: false,
    transport: 'ssh', ssh_host_key_pinned: true, ssh_key_fingerprint: FP, https_credential_configured: false,
    github_main_sha: A, github_promoted_sha: B, deployed_sha: B, started_at: '2026-11-09T22:00:00Z', finished_at: '2026-11-09T22:00:02Z',
  });
  const old = Array.from({ length: 120 }, (_, index) => line(index));
  writeFileSync(join(box.state, 'cycles.jsonl'), [
    ...old.slice(0, 60), 'not json at all', '{"schema_version":"something-else/v1"}',
    `{"schema_version":"mccluster-reconcile-cycle/v1","padding":"${'x'.repeat(2000)}"}`, '', ...old.slice(60),
  ].join('\n') + '\n');
  box.run({ ...box.ssh, ...box.timer('f') });
  const text = box.file('cycles.jsonl');
  const lines = text.trimEnd().split('\n');
  assert.equal(lines.length, 40);
  assert.ok(text.length < 40 * 1024);
  for (const entry of lines) assert.equal(JSON.parse(entry).schema_version, 'mccluster-reconcile-cycle/v1');
  assert.equal(JSON.parse(lines.at(-1)).cycle_id, 'f'.repeat(32), 'the newest cycle is last');
  assert.equal(JSON.parse(lines[0]).cycle_id, (81).toString(16).padStart(32, '0'), 'the oldest lines are dropped');
  // An oversized or foreign file is not read into the log at all.
  writeFileSync(join(box.state, 'cycles.jsonl'), `${'z'.repeat(200_000)}\n`);
  box.run({ ...box.ssh, ...box.timer('e') });
  assert.equal(box.log().length, 1);
  assert.match(head, /CYCLE_LOG_KEEP=40\n/);
  assert.match(head, /tail -c 65536 -- "\$\{CYCLE_LOG\}"/);
});

test('receipts are replaced by rename, never written through a planted link', (t) => {
  const box = sandbox(t);
  const victim = join(box.root, 'fixture/victim');
  writeFileSync(victim, 'untouched\n');
  for (const name of ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl']) {
    symlinkSync(victim, join(box.state, `${name}.tmp`));
    symlinkSync(victim, join(box.state, name));
  }
  const result = box.run({ ...box.ssh, ...box.timer('1') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(victim, 'utf8'), 'untouched\n');
  for (const name of ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl']) {
    assert.ok(lstatSync(join(box.state, name)).isFile(), `${name} is a regular file again`);
    assert.equal(existsSync(join(box.state, `${name}.tmp`)), false);
  }
  assert.equal(box.json('last-cycle.json').cycle_id, '1'.repeat(32));
  assert.equal(box.log().length, 1, 'a linked log is not read');
  assert.match(head, /set -o noclobber; printf '%s\\n' "\$@" > "\$\{tmp\}"/, 'the temporary file is created exclusively');
  assert.match(head, /mv -f -- "\$\{tmp\}" "\$\{target\}"/, 'and renamed over the target');
  assert.equal(head.split('> "${').length - 1, 1, 'every receipt file goes through that one writer');
});

test('nothing from the environment, a file or a helper reaches the receipt unvalidated', (t) => {
  const box = sandbox(t);
  writeFileSync(join(box.state, 'deployed_sha'), 'not-a-sha","deployed":"injected\n');
  const result = box.run({
    MCCLUSTER_REPO_URL: `https://user:${TOKEN_MARKER}@evil.example/x.git`, FAKE_ORIGIN_URL: 'https://evil.example/"},{"injected":"1',
    INVOCATION_ID: 'not-hex","injected":"1', TRIGGER_UNIT: 'evil","x":"y', TRIGGER_TIMER_MONOTONIC_USEC: '1","z":"2',
    GIT_SSH_COMMAND: '/usr/bin/ssh -i /root/.ssh/id_ed25519 "$(touch injected)" `touch injected`',
  }, [
    'CYCLE_STAGE=\'x";injected\'', 'CYCLE_MAIN_SHA=\'main","injected":"1\'', 'CYCLE_PROMOTED_SHA="$(printf \'%s\' zzzz)"', 'CYCLE_STARTED_AT=\'yesterday","injected":"1\'',
    'mcc_cycle_receipt failed \'7","injected":"1\' || true',
  ].join('\n'));
  assert.equal(result.status, 0, result.stderr);
  const text = box.file('last-cycle.json');
  const last = JSON.parse(text);
  assert.doesNotMatch(text, /injected|evil|id_ed25519|zzzz|yesterday/);
  assert.doesNotMatch(text, new RegExp(TOKEN_MARKER));
  assert.equal(last.cycle_id, '');
  assert.equal(last.trigger, 'other');
  assert.equal(last.timer_trigger_monotonic_usec, '');
  assert.equal(last.transport, 'other');
  assert.equal(last.stage, 'unknown');
  assert.equal(last.exit_code, null);
  assert.equal(last.github_main_sha, '');
  assert.equal(last.github_promoted_sha, '');
  assert.equal(last.deployed_sha, '');
  assert.equal(last.started_at, last.finished_at, 'an unusable start time falls back to the finish time');
  assert.equal(existsSync(join(box.root, 'injected')), false);
  // Unknown outcomes and exit codes outside 0..255 are not written as given.
  box.run({ ...box.https }, 'mcc_cycle_receipt succeeded 0 || true');
  assert.equal(box.json('last-cycle.json').outcome, 'failed', 'an unknown outcome writes nothing new');
  box.run({ ...box.https }, 'mcc_cycle_receipt failed 256 || true');
  assert.equal(box.json('last-cycle.json').exit_code, null);
  box.run({ ...box.https }, 'mcc_cycle_receipt failed 007 || true');
  assert.equal(box.json('last-cycle.json').exit_code, null, 'not a JSON number: left out');
  // A ref that is not the approved deployment ref is never named under its label.
  box.run({ ...box.https, MCCLUSTER_DEPLOY_REF: 'other' }, 'CYCLE_STAGE=ancestry\nmcc_cycle_receipt failed 3 || true');
  assert.equal(box.json('last-cycle.json').github_promoted_sha, '');
  assert.equal(box.json('last-cycle.json').github_main_sha, '');
});

test('the exit handler records failures and deferrals, keeps the exit status and writes nothing without the lock', (t) => {
  const box = sandbox(t);
  const arm = 'trap \'mcc_cycle_on_exit "$?" || true\' EXIT';
  box.run({ ...box.ssh, ...box.timer('a') });
  const failed = box.run({ ...box.ssh, ...box.timer('b') }, `${arm}\nCYCLE_STAGE=fetch\nCYCLE_MAIN_SHA=""\nCYCLE_PROMOTED_SHA=""\n(exit 128)\necho unreachable`);
  assert.equal(failed.status, 128);
  assert.doesNotMatch(failed.stdout, /unreachable/);
  let last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.interrupted], ['failed', 'fetch', 128, false]);
  assert.equal(last.github_promoted_sha, '');
  assert.equal(box.json('last-verified-cycle.json').cycle_id, 'a'.repeat(32), 'a failure never replaces the last verified cycle');

  const deferred = box.run({ ...box.ssh, ...box.timer('c') }, `${arm}\nCYCLE_STAGE=deploy\n(exit 75)`);
  assert.equal(deferred.status, 75);
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code], ['deferred', 'deploy', 75]);

  const explicit = box.run({ ...box.ssh, ...box.timer('d') }, `${arm}\nCYCLE_STAGE=ancestry\necho refusing >&2\nexit 3`);
  assert.equal(explicit.status, 3);
  assert.equal(explicit.stderr, 'refusing\n');
  assert.deepEqual([box.json('last-cycle.json').outcome, box.json('last-cycle.json').exit_code], ['failed', 3]);

  const unlocked = box.run({ ...box.ssh, ...box.timer('e') }, `CYCLE_OWNS_LOCK=0\n${arm}\n(exit 2)`);
  assert.equal(unlocked.status, 2);
  assert.equal(box.json('last-cycle.json').cycle_id, 'd'.repeat(32), 'a run that never held the lock writes nothing');

  const recorded = box.run({ ...box.ssh, ...box.timer('f') }, `${arm}\nmcc_cycle_receipt verified_no_change 0 || true\necho done\nexit 0`);
  assert.equal(recorded.status, 0);
  assert.equal(recorded.stdout, 'done\n');
  assert.equal(box.log().filter((cycle) => cycle.cycle_id === 'f'.repeat(32)).length, 1, 'one receipt per cycle');
  assert.equal(box.json('last-verified-cycle.json').cycle_id, 'f'.repeat(32));

  // The shell reaches its exit handler with status 0 and nothing recorded only when it is being terminated.
  const terminated = box.run({ ...box.ssh, ...box.timer('0') }, 'CYCLE_STAGE=deploy\nmcc_cycle_on_exit 0');
  assert.equal(terminated.status, 0);
  last = box.json('last-cycle.json');
  assert.deepEqual([last.outcome, last.stage, last.exit_code, last.interrupted], ['failed', 'deploy', null, true]);
  assert.equal(box.json('last-verified-cycle.json').cycle_id, 'f'.repeat(32));
  assert.equal(verifiedReconcileCycle(last).interrupted, true);
});

test('evidence that cannot be written, or a broken evidence writer, changes nothing about the cycle', (t) => {
  const box = sandbox(t);
  for (const name of ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl']) {
    mkdirSync(join(box.state, name));
    writeFileSync(join(box.state, name, 'occupied'), '');
  }
  const blocked = box.run({ ...box.ssh, ...box.timer('1') }, 'mcc_cycle_receipt verified_no_change 0 || true\necho "already deployed"\nexit 0');
  assert.equal(blocked.status, 0);
  assert.equal(blocked.stdout, 'already deployed\n');
  assert.equal(blocked.stderr, ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl'].map((name) => `mccluster-vps-reconcile: cycle evidence not written: ${name}\n`).join(''));
  for (const name of ['last-cycle.json', 'last-verified-cycle.json', 'cycles.jsonl']) {
    assert.deepEqual(readdirSync(join(box.state, name)), ['occupied'], `${name} was left alone`);
  }
  // nounset, errexit and a failing helper inside the writer end the writer's subshell, not the script.
  const arm = 'trap \'mcc_cycle_on_exit "$?" || true\' EXIT';
  for (const sabotage of [
    'unset CYCLE_LOG CYCLE_FILE CYCLE_VERIFIED_FILE CYCLE_LOG_KEEP CYCLE_LINE_MAX CHECKOUT STATE_FILE DEPLOY_REF REPO_URL',
    'date() { return 1; }', 'mcc_cycle_put() { exit 9; }', 'mcc_cycle_bounded() { kill -KILL "$BASHPID"; }', 'mcc_cycle_receipt_write() { set -e; false; }',
    'mcc_cycle_receipt_write() { echo "${UNBOUND_FIXTURE_VARIABLE}"; }',
  ]) {
    const ok = box.run({ ...box.ssh, ...box.timer('2') }, `${sabotage}\n${arm}\nmcc_cycle_receipt verified_no_change 0 || true\necho "already deployed"\nexit 0`);
    assert.equal(ok.status, 0, `${sabotage}: ${ok.stderr}`);
    assert.equal(ok.stdout, 'already deployed\n', sabotage);
    const bad = box.run({ ...box.ssh, ...box.timer('3') }, `${sabotage}\n${arm}\nCYCLE_STAGE=deploy\n(exit 75)\necho unreachable`);
    assert.equal(bad.status, 75, `${sabotage}: the deployer's status survives a broken writer`);
    assert.equal(bad.stdout, '', sabotage);
  }
});

test('the reconciler arms the handler after the lock, records success before each exit and adds no trap that changes signals', () => {
  const at = (needle) => { const index = script.indexOf(needle); assert.ok(index >= 0, `missing: ${needle}`); return index; };
  const lock = at('flock -n 9 ||');
  const owns = at('\nCYCLE_OWNS_LOCK=1\n');
  const armed = at('trap \'mcc_cycle_on_exit "$?" || true\' EXIT');
  const fetch = at('git fetch --prune origin');
  const ancestry = at('if ! git merge-base --is-ancestor');
  const noChange = at('mcc_cycle_receipt verified_no_change 0 || true');
  const earlyExit = at('echo "already deployed and attested');
  const deployer = at('bash "${CHECKOUT}/scripts/deploy-ovh-core.sh" "${CHECKOUT}" "${TARGET_SHA}"');
  const stamped = at('"${STATE_ROOT}/last-success.json"');
  const deployed = at('mcc_cycle_receipt deployed 0 || true');
  assert.ok(lock < owns && owns < armed && armed < fetch, 'nothing is recorded for a run that did not take the lock');
  assert.ok(ancestry < noChange && noChange < earlyExit, 'a no-change success is recorded after the gates and before the early exit');
  assert.ok(earlyExit < deployer && deployer < stamped && stamped < deployed, 'a deploy is recorded only after it is stamped');
  // Every evidence call in the cycle is guarded, and there are exactly two.
  assert.deepEqual(flow.match(/^.*mcc_cycle_receipt .*$/gm).map((line) => line.trim()),
    ['mcc_cycle_receipt verified_no_change 0 || true', 'mcc_cycle_receipt deployed 0 || true']);
  // The cycle itself only assigns evidence variables: no evidence command sits on its path.
  for (const line of flow.split('\n').filter((value) => /CYCLE_/.test(value) && !/mcc_cycle_receipt/.test(value))) {
    assert.match(line, /^\s*(CYCLE_[A-Z_]+="[^"$]*"|CYCLE_(PROMOTED|MAIN)_SHA="\$\{(TARGET|MAIN)_SHA\}"|CYCLE_OWNS_LOCK=1)$/, line);
  }
  assert.deepEqual(script.match(/^.*mcc_cycle_receipt_write .*$/gm).filter((line) => !line.startsWith('#')).map((line) => line.trim()),
    ['( mcc_cycle_receipt_write "$@" ) || true'], 'the writer, which turns errexit and nounset off, only ever runs in its own subshell');
  const handler = head.slice(head.indexOf('mcc_cycle_on_exit() {'), head.indexOf('\n}\n', head.indexOf('mcc_cycle_on_exit() {')));
  assert.doesNotMatch(handler, /\bexit\b/, 'the handler never sets the exit status');
  assert.deepEqual(script.match(/^\s*trap .*$/gm).map((line) => line.trim()), ['trap - EXIT ERR', 'trap \'mcc_cycle_on_exit "$?" || true\' EXIT'],
    'no TERM, INT or HUP trap: a signal still ends the wrapper exactly as before');
  // last-success.json keeps its deploy-only meaning: written once, after the deployer.
  assert.equal(script.split('last-success.json"').length - 1, 1);
  assert.match(script, /printf '\{"deployed_sha":"%s","deploy_ref":"%s","deployed_at":"%s"\}\\n'/);
});

test('the reconciler recognises exactly the command and host key the SSH setup script installs', () => {
  const setup = read('scripts/ovh-private-repo-ssh.sh');
  const constant = (source, name) => { const match = source.match(new RegExp(`^\\s*(?:local )?${name}="(.*)"$`, 'm')); assert.ok(match, name); return match[1]; };
  assert.equal(constant(head, 'CYCLE_GITHUB_HOST_KEY'), constant(setup, 'GITHUB_HOST_KEY'));
  assert.equal(constant(setup, 'KEY_DIR=/var/lib/mccluster/reconcile/ssh\nKEY'), '${KEY_DIR}/github_deploy_ed25519');
  assert.equal(constant(setup, 'KNOWN'), '${KEY_DIR}/github_known_hosts');
  assert.match(head, /local key="\$\{STATE_ROOT\}\/ssh\/github_deploy_ed25519" known="\$\{STATE_ROOT\}\/ssh\/github_known_hosts"/);
  assert.match(head, /STATE_ROOT="\$\{MCCLUSTER_RECONCILE_STATE_ROOT:-\/var\/lib\/mccluster\/reconcile\}"/);
  const installed = constant(setup, 'SSH_COMMAND').replaceAll('${KEY}', '${key}').replaceAll('${KNOWN}', '${known}');
  assert.equal(head.match(/^\s*pinned_command="(.*)"$/m)?.[1], installed);
});
