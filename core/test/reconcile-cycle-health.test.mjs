/*
 * How Core reads the reconciler's cycle receipts (incident #510).
 *
 * scripts/mccluster-vps-reconcile.sh leaves one receipt per cycle under
 * /var/lib/mccluster/reconcile. Core turns them into deployment.reconcile in the
 * host_health output: verified, stale, failed or unverified, with the transport
 * and trigger of the cycles that succeeded. These tests hold the reading side:
 * a receipt that is malformed, foreign, from the future or self-contradicting is
 * not evidence; "authenticated" never reads true for an anonymous fetch; and a
 * host whose reconciler writes no receipts is "unverified", never degraded.
 * The receipts themselves are written and tested in reconcile-cycle-receipt.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RECONCILE_AUTHENTICATED_MEANS,
  RECONCILE_STALE_AFTER_MS,
  RECONCILE_START_LIMIT_MS,
  RECONCILE_TIMER_JITTER_MS,
  RECONCILE_TIMER_PERIOD_MS,
  summarizeReconcileCycles,
  verifiedReconcileCycle,
} from '../src/reconciler-source-receipt.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-09T22:10:00.000Z');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const FP = `SHA256:${'A'.repeat(43)}`;

function receipt(over = {}) {
  return {
    schema_version: 'mccluster-reconcile-cycle/v1', repository: 'mcclusterishere/mccluster', promoted_ref: 'deploy/ovh-production',
    cycle_id: 'c'.repeat(32), trigger: 'timer', timer_trigger_monotonic_usec: '7200000000',
    outcome: 'verified_no_change', stage: 'complete', exit_code: 0, interrupted: false,
    transport: 'ssh', ssh_host_key_pinned: true, ssh_key_fingerprint: FP, https_credential_configured: false,
    github_main_sha: A, github_promoted_sha: B, deployed_sha: B,
    started_at: iso(NOW - 125_000), finished_at: iso(NOW - 120_000), ...over,
  };
}
function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
const failure = (over = {}) => receipt({ outcome: 'failed', stage: 'fetch', exit_code: 128, github_main_sha: '', github_promoted_sha: '', ...over });
const https = (over = {}) => receipt({ transport: 'https', ssh_host_key_pinned: false, ssh_key_fingerprint: '', ...over });

test('malformed, foreign, future and self-contradicting cycle receipts fail closed', () => {
  const ok = verifiedReconcileCycle(receipt(), { nowMs: NOW });
  assert.equal(ok.authenticated, true);
  assert.equal(ok.success, true);
  for (const changed of [
    { schema_version: 'mccluster-reconcile-git-source/v1' }, { repository: 'untrusted/repo' }, { promoted_ref: 'main' },
    { outcome: 'ok' }, { trigger: 'cron' }, { trigger: 'systemd_unattributed' }, { transport: 'git' }, { stage: 'Fetch!' }, { stage: 7 },
    { cycle_id: 'short' }, { cycle_id: null }, { interrupted: 'false' }, { ssh_host_key_pinned: 'true' }, { https_credential_configured: 1 },
    { ssh_key_fingerprint: 'SHA256:short' }, { ssh_key_fingerprint: null },
    { finished_at: 'not a date' }, { finished_at: '2026-11-09 22:08:00' }, { started_at: iso(NOW - 60_000) }, { finished_at: iso(NOW + 31_000) },
    { github_main_sha: 'main' }, { github_promoted_sha: A }, { deployed_sha: '' }, { github_main_sha: '' },
    { exit_code: 1 }, { exit_code: '0' }, { exit_code: 256 }, { exit_code: null }, { interrupted: true },
    // A success that names another transport's evidence contradicts itself.
    { transport: 'https' }, { transport: 'other' }, { https_credential_configured: true },
  ]) assert.equal(verifiedReconcileCycle(receipt(changed), { nowMs: NOW }), null, JSON.stringify(changed));
  for (const value of [null, undefined, 'text', 7, [], [receipt()]]) assert.equal(verifiedReconcileCycle(value, { nowMs: NOW }), null);
  // Failures and deferrals carry the status they ended with, or say they were cut short.
  assert.equal(verifiedReconcileCycle(failure(), { nowMs: NOW }).success, false);
  assert.equal(verifiedReconcileCycle(failure({ exit_code: 0 }), { nowMs: NOW }), null);
  assert.equal(verifiedReconcileCycle(failure({ exit_code: null }), { nowMs: NOW }), null);
  assert.equal(verifiedReconcileCycle(failure({ exit_code: null, interrupted: true }), { nowMs: NOW }).interrupted, true);
  assert.equal(verifiedReconcileCycle(failure({ exit_code: 143, interrupted: true }), { nowMs: NOW }), null);
  assert.equal(verifiedReconcileCycle(receipt({ outcome: 'deferred', stage: 'deploy', exit_code: 75 }), { nowMs: NOW }).outcome, 'deferred');
  assert.equal(verifiedReconcileCycle(receipt({ outcome: 'deferred', stage: 'deploy', exit_code: 1 }), { nowMs: NOW }), null);
});

test('authenticated is true only for a successful SSH cycle with a pinned host key and a named key', () => {
  const view = (over) => verifiedReconcileCycle(receipt(over), { nowMs: NOW });
  assert.equal(view({}).authenticated, true);
  assert.equal(view({ ssh_host_key_pinned: false }).authenticated, false);
  assert.equal(view({ ssh_key_fingerprint: '' }).authenticated, false);
  assert.equal(verifiedReconcileCycle(https(), { nowMs: NOW }).authenticated, false);
  assert.equal(verifiedReconcileCycle(https({ https_credential_configured: true }), { nowMs: NOW }).authenticated, false,
    'a public repository never asks HTTPS for the credential');
  assert.equal(verifiedReconcileCycle(receipt({ transport: 'other', ssh_host_key_pinned: false, ssh_key_fingerprint: '' }), { nowMs: NOW }).authenticated, false);
  // A cycle whose fetch failed authenticated nothing, whatever it was configured to use.
  assert.equal(verifiedReconcileCycle(failure(), { nowMs: NOW }).authenticated, false);
  assert.equal(verifiedReconcileCycle(failure({ stage: 'deploy', exit_code: 1, github_main_sha: A, github_promoted_sha: B }), { nowMs: NOW }).authenticated, false);
  assert.match(RECONCILE_AUTHENTICATED_MEANS, /not_proof_of_repository_deploy_key_or_read_only/);
});

test('the summary separates verified, stale, failed and unverified, and counts distinct cycles', () => {
  const times = (minutesAgo) => ({ started_at: iso(NOW - minutesAgo * 60_000 - 5000), finished_at: iso(NOW - minutesAgo * 60_000) });
  const at = (minutesAgo, over = {}) => receipt({ ...times(minutesAgo), ...over });
  const history = [
    at(12, { cycle_id: '1'.repeat(32) }),
    at(12, { cycle_id: '1'.repeat(32) }),
    at(10, { cycle_id: '2'.repeat(32), trigger: 'other', timer_trigger_monotonic_usec: '' }),
    https({ ...times(8), cycle_id: '3'.repeat(32) }),
    at(6, { cycle_id: '', trigger: 'other', timer_trigger_monotonic_usec: '' }),
    at(4, { cycle_id: '4'.repeat(32), trigger: 'timer_inferred' }),
    at(2, { cycle_id: '5'.repeat(32), outcome: 'deployed' }),
  ].map((entry) => JSON.stringify(entry)).concat(['not json', '{"schema_version":"mccluster-reconcile-cycle/v1"}']).join('\n');
  const latest = at(2, { cycle_id: '5'.repeat(32), outcome: 'deployed' });
  const ok = summarizeReconcileCycles({ latest, verified: latest, history }, { nowMs: NOW });
  assert.equal(ok.status, 'verified');
  assert.equal(ok.transport, 'ssh');
  assert.equal(ok.authenticated, true);
  assert.equal(ok.authenticated_means, RECONCILE_AUTHENTICATED_MEANS);
  assert.equal(ok.last_verified_at, latest.finished_at);
  assert.equal(ok.last_verified_cycle.cycle_id, '5'.repeat(32));
  assert.equal(ok.last_cycle.outcome, 'deployed');
  assert.equal(ok.age_ms, 120_000);
  assert.equal(ok.consecutive_failed_cycles, 0);
  assert.deepEqual(ok.recent_successful.map((cycle) => cycle.cycle_id), ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(32)),
    'a repeated id counts once and a cycle with no id is not counted');
  assert.equal(ok.distinct_successful_cycles, 5);
  assert.equal(ok.distinct_successful_timer_cycles, 4, 'a start by hand is not a timer cycle');
  assert.equal(ok.distinct_authenticated_timer_cycles, 3, 'an anonymous HTTPS cycle is not an authenticated one');
  assert.deepEqual(Object.keys(ok.recent_successful[0]), ['cycle_id', 'trigger', 'outcome', 'transport', 'authenticated', 'ssh_key_fingerprint', 'deployed_sha', 'finished_at']);
  assert.deepEqual(ok.recent_successful[2], { cycle_id: '3'.repeat(32), trigger: 'timer', outcome: 'verified_no_change', transport: 'https', authenticated: false, ssh_key_fingerprint: null, deployed_sha: B, finished_at: iso(NOW - 8 * 60_000) });

  const none = summarizeReconcileCycles({}, { nowMs: NOW });
  assert.equal(none.status, 'unverified');
  assert.equal(none.last_cycle, null);
  assert.equal(none.last_verified_cycle, null);
  assert.equal(none.distinct_successful_cycles, 0);
  assert.deepEqual(none.recent_successful, []);
  assert.equal(summarizeReconcileCycles({ latest: { schema_version: 'x' }, verified: 'text', history: 'garbage\n' }, { nowMs: NOW }).status, 'unverified',
    'unusable receipts are not evidence of failure either');

  const failed = summarizeReconcileCycles({ latest: failure({ cycle_id: '9'.repeat(32), started_at: iso(NOW - 65_000), finished_at: iso(NOW - 60_000) }), verified: latest, history }, { nowMs: NOW });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.last_cycle.stage, 'fetch');
  assert.equal(failed.last_cycle.exit_code, 128);
  assert.equal(failed.consecutive_failed_cycles, 1);
  assert.equal(failed.last_verified_cycle.cycle_id, '5'.repeat(32));
  assert.equal(failed.distinct_authenticated_timer_cycles, 3, 'earlier proof is not erased by a later failure');

  const deferred = summarizeReconcileCycles({ latest: receipt({ outcome: 'deferred', stage: 'deploy', exit_code: 75, started_at: iso(NOW - 65_000), finished_at: iso(NOW - 60_000) }), verified: latest }, { nowMs: NOW });
  assert.equal(deferred.status, 'verified', 'a deferral is not a failure while the last success is fresh');
  assert.equal(deferred.last_cycle.outcome, 'deferred');
  const deferring = summarizeReconcileCycles({ latest: receipt({ outcome: 'deferred', stage: 'deploy', exit_code: 75, started_at: iso(NOW - 65_000), finished_at: iso(NOW - 60_000) }), verified: at(26) }, { nowMs: NOW });
  assert.equal(deferring.status, 'stale', 'a deploy that keeps deferring past the window is reported');
});

test('repeated failures are counted, and a lost write never hides the newest receipt', () => {
  const at = (minutesAgo, over = {}) => ({ started_at: iso(NOW - minutesAgo * 60_000 - 5000), finished_at: iso(NOW - minutesAgo * 60_000), ...over });
  const good = receipt(at(10, { cycle_id: '1'.repeat(32) }));
  const bad = (minutesAgo, id) => failure(at(minutesAgo, { cycle_id: id.repeat(32) }));
  const history = [good, bad(8, '2'), bad(6, '3'), bad(4, '4'), bad(2, '5')].map((entry) => JSON.stringify(entry)).join('\n');
  const outage = summarizeReconcileCycles({ latest: bad(2, '5'), verified: good, history }, { nowMs: NOW });
  assert.equal(outage.status, 'failed');
  assert.equal(outage.consecutive_failed_cycles, 4);
  assert.equal(outage.last_verified_at, good.finished_at);
  // last-cycle.json was not replaced, but the log holds the newer failure: it still decides.
  assert.equal(summarizeReconcileCycles({ latest: good, verified: good, history }, { nowMs: NOW }).status, 'failed');
  // last-verified-cycle.json was not replaced, but last-cycle.json is a newer success.
  const newer = receipt(at(1, { cycle_id: '6'.repeat(32) }));
  const recovered = summarizeReconcileCycles({ latest: newer, verified: good, history }, { nowMs: NOW });
  assert.equal(recovered.status, 'verified');
  assert.equal(recovered.last_verified_cycle.cycle_id, '6'.repeat(32));
  assert.equal(recovered.consecutive_failed_cycles, 0);
  assert.deepEqual(recovered.recent_successful.map((cycle) => cycle.cycle_id), ['1'.repeat(32), '6'.repeat(32)]);
  // The log is read from its end and within a bound.
  const long = Array.from({ length: 500 }, (_, index) => JSON.stringify(receipt(at(600 - index, { cycle_id: index.toString(16).padStart(32, '0') })))).join('\n');
  const bounded = summarizeReconcileCycles({ history: long }, { nowMs: NOW });
  assert.equal(bounded.recent_successful.length, 5);
  assert.equal(bounded.recent_successful.at(-1).cycle_id, (499).toString(16).padStart(32, '0'));
  assert.equal(summarizeReconcileCycles({ history: `${'x'.repeat(5000)}\n${JSON.stringify(good)}` }, { nowMs: NOW }).status, 'verified', 'an oversized line is skipped');
});

test('the staleness threshold follows the timer period and the unit start limit', () => {
  const timer = read('core/systemd/mccluster-vps-reconcile.timer');
  const service = read('core/systemd/mccluster-vps-reconcile.service');
  const minutes = (text, key) => { const match = text.match(new RegExp(`^${key}=(\\d+)min$`, 'm')); assert.ok(match, key); return Number(match[1]) * 60_000; };
  const seconds = (text, key) => { const match = text.match(new RegExp(`^${key}=(\\d+)s$`, 'm')); assert.ok(match, key); return Number(match[1]) * 1000; };
  assert.equal(minutes(timer, 'OnUnitActiveSec'), RECONCILE_TIMER_PERIOD_MS);
  assert.equal(seconds(timer, 'RandomizedDelaySec'), RECONCILE_TIMER_JITTER_MS);
  assert.equal(minutes(service, 'TimeoutStartSec'), RECONCILE_START_LIMIT_MS);
  assert.match(service, /^Type=oneshot$/m);
  const longestHealthyGap = RECONCILE_TIMER_PERIOD_MS + RECONCILE_TIMER_JITTER_MS + RECONCILE_START_LIMIT_MS;
  assert.equal(longestHealthyGap, 22 * 60_000 + 20_000);
  assert.equal(RECONCILE_STALE_AFTER_MS, 25 * 60_000);
  assert.ok(RECONCILE_STALE_AFTER_MS > longestHealthyGap, 'a deploy that runs to the start limit is not stale');
  assert.ok(RECONCILE_STALE_AFTER_MS - longestHealthyGap <= 5 * 60_000, 'and a dead reconciler is reported within one more health run');
  const one = receipt({ started_at: iso(NOW - 5000), finished_at: iso(NOW) });
  const status = (afterMs) => summarizeReconcileCycles({ latest: one, verified: one }, { nowMs: NOW + afterMs }).status;
  assert.equal(status(longestHealthyGap), 'verified');
  assert.equal(status(RECONCILE_STALE_AFTER_MS), 'verified');
  assert.equal(status(RECONCILE_STALE_AFTER_MS + 1000), 'stale');
  assert.equal(summarizeReconcileCycles({ latest: one, verified: one }, { nowMs: NOW + 26 * 60_000 }).stale_after_ms, 25 * 60_000);
});

// ---- What the health collector does with them ------------------------------

// The collector reads these when it loads and when it runs. The fixtures below
// assume the canonical repository and ref, whatever this process inherited.
delete process.env.MCCLUSTER_CANONICAL_REPOSITORY;
delete process.env.MCCLUSTER_OVH_DEPLOY_REF;
const { boundedTextFile, githubSource, reconcileEvidence } = await import('../src/executors/host-health-collect.mjs');
const { aggregateSystemHealth } = await import('../src/system-health.mjs');

const github = (answers) => async (url) => {
  const ref = decodeURIComponent(String(url).split('/commits/')[1]);
  const answer = answers[ref];
  if (answer instanceof Error) throw answer;
  return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
};
const sourceReceipt = (ageMs) => JSON.stringify({
  schema_version: 'mccluster-reconcile-git-source/v1', repository: 'mcclusterishere/mccluster', promoted_ref: 'deploy/ovh-production',
  github_main_sha: A, github_promoted_sha: B, observed_at: new Date(Date.now() - ageMs).toISOString(),
});

test('the REST error behind a receipt fallback is kept, and no fallback is reported when REST answered', async () => {
  let reads = 0;
  const readText = (text) => async (path) => { reads += 1; assert.equal(path, '/var/lib/mccluster/reconcile/last-source-fetch.json'); return text; };
  const ok = await githubSource({ fetchImpl: github({ main: { status: 200, body: { sha: A } }, 'deploy/ovh-production': { status: 200, body: { sha: B } } }), readText: readText(sourceReceipt(60_000)) });
  assert.equal(ok.verification_method, 'github_rest_api');
  assert.equal(ok.error, null);
  assert.equal('rest_error' in ok, false);
  assert.equal(reads, 0, 'the receipt is not consulted while REST answers');
  assert.equal(reconcileEvidence({ source: ok }).source_fallback, null);

  // A private repository answers the anonymous REST read with 404 Not Found.
  const notFound = github({ main: { status: 404, body: { message: 'Not Found' } }, 'deploy/ovh-production': { status: 404, body: { message: 'Not Found' } } });
  const fallback = await githubSource({ fetchImpl: notFound, readText: readText(sourceReceipt(60_000)) });
  assert.equal(fallback.verification_method, 'ovh_reconciler_git_fetch_receipt');
  assert.equal(fallback.error, null);
  assert.equal(fallback.github_promoted_sha, B);
  assert.equal(fallback.rest_error, 'main: Not Found; deploy/ovh-production: Not Found');
  assert.deepEqual(reconcileEvidence({ source: fallback }).source_fallback, { github_rest_error: 'main: Not Found; deploy/ovh-production: Not Found' });

  // One ref timing out is a different fact behind the same fallback, and it stays distinguishable.
  const timeout = github({ main: new Error('The operation was aborted due to timeout'), 'deploy/ovh-production': { status: 200, body: { sha: B } } });
  const partial = await githubSource({ fetchImpl: timeout, readText: readText(sourceReceipt(60_000)) });
  assert.equal(partial.verification_method, 'ovh_reconciler_git_fetch_receipt');
  assert.equal(partial.rest_error, 'main: The operation was aborted due to timeout');

  // A stale or missing receipt never hides the REST error.
  for (const text of [sourceReceipt(11 * 60_000), null, 'not json']) {
    const failed = await githubSource({ fetchImpl: notFound, readText: readText(text) });
    assert.equal(failed.verification_method, 'github_rest_api');
    assert.equal(failed.error, 'main: Not Found; deploy/ovh-production: Not Found');
    assert.equal(failed.github_promoted_sha, null);
    assert.equal(reconcileEvidence({ source: failed }).source_fallback, null);
  }
});

test('host health carries the cycle summary and the fallback reason under deployment and leaves the source block as it was', () => {
  const cycle = receipt({ started_at: iso(Date.now() - 65_000), finished_at: iso(Date.now() - 60_000) });
  const source = { repository: 'mcclusterishere/mccluster', github_main_sha: A, github_promoted_sha: B, promoted_ref: 'deploy/ovh-production',
    observed_at: new Date().toISOString(), verification_method: 'ovh_reconciler_git_fetch_receipt', error: null, rest_error: 'main: Not Found' };
  const evidence = reconcileEvidence({ lastCycleText: JSON.stringify(cycle), lastVerifiedCycleText: JSON.stringify(cycle), cycleLogText: `${JSON.stringify(cycle)}\n`, source });
  assert.equal(evidence.reconcile.status, 'verified');
  assert.equal(evidence.reconcile.authenticated, true);
  assert.equal(evidence.reconcile.distinct_authenticated_timer_cycles, 1);
  const report = aggregateSystemHealth({ source, deployment: { deployed_sha: B, last_success: { deployed_sha: B, deployed_at: '2026-11-07T13:59:29Z' }, ...evidence } });
  assert.deepEqual(Object.keys(report.source), ['repository', 'github_main_sha', 'github_promoted_sha', 'promoted_ref', 'observed_at', 'verification_method', 'error']);
  assert.deepEqual(report.deployment.source_fallback, { github_rest_error: 'main: Not Found' });
  assert.equal(report.deployment.reconcile.last_verified_cycle.cycle_id, 'c'.repeat(32));
  assert.equal(report.deployment.last_success.deployed_at, '2026-11-07T13:59:29Z', 'last_success stays the last deploy');
  assert.equal(report.deployment.sha_match, true);
  // A host whose reconciler predates the receipts: no files, no claim, no degradation from this block.
  const old = reconcileEvidence({ source: { ...source, verification_method: 'github_rest_api', rest_error: undefined } });
  assert.equal(old.reconcile.status, 'unverified');
  assert.equal(old.source_fallback, null);
  assert.equal(reconcileEvidence().reconcile.status, 'unverified');
  // Receipts for another ref or repository are not this host's evidence.
  assert.equal(reconcileEvidence({ lastCycleText: JSON.stringify(cycle), source: { ...source, promoted_ref: 'deploy/other' } }).reconcile.status, 'unverified');
});

test('receipt files are read only when they are small regular files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mcc-bounded-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'small.json'), '{"ok":true}\n');
  writeFileSync(join(dir, 'large.jsonl'), 'x'.repeat(5000));
  mkdirSync(join(dir, 'directory'));
  assert.equal(await boundedTextFile(join(dir, 'small.json'), 4096), '{"ok":true}');
  assert.equal(await boundedTextFile(join(dir, 'large.jsonl'), 4096), null);
  assert.equal(await boundedTextFile(join(dir, 'large.jsonl'), 5000), 'x'.repeat(5000));
  assert.equal(await boundedTextFile(join(dir, 'directory'), 4096), null);
  assert.equal(await boundedTextFile(join(dir, 'missing'), 4096), null);
});
