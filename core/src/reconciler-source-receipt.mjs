// A GitHub private repo returns HTTP 404 to public REST ref queries. OVH's
// outbound reconciler, not the running Core process, performs authenticated
// Git reads. Trust only a fresh on-host receipt created after both ref fetches
// and the production ancestry gate have succeeded. This file contains no keys.
const SHA40 = /^[0-9a-f]{40}$/;

export function verifiedReconcilerGitSource(receipt, {
  repository = 'mcclusterishere/mccluster',
  promotedRef = 'deploy/ovh-production',
  nowMs = Date.now(),
  maxAgeMs = 10 * 60_000,
} = {}) {
  if (!receipt || typeof receipt !== 'object'
    || receipt.schema_version !== 'mccluster-reconcile-git-source/v1'
    || receipt.repository !== repository
    || receipt.promoted_ref !== promotedRef
    || !SHA40.test(String(receipt.github_main_sha || ''))
    || !SHA40.test(String(receipt.github_promoted_sha || ''))
    || typeof receipt.observed_at !== 'string') return null;

  const observedMs = Date.parse(receipt.observed_at);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)
    || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
    || observedMs > nowMs + 30_000
    || nowMs - observedMs > maxAgeMs) return null;

  return {
    repository,
    github_main_sha: receipt.github_main_sha,
    github_promoted_sha: receipt.github_promoted_sha,
    promoted_ref: promotedRef,
    observed_at: receipt.observed_at,
    verification_method: 'ovh_reconciler_git_fetch_receipt',
    error: null,
  };
}

// One receipt per reconcile cycle (scripts/mccluster-vps-reconcile.sh,
// mcc_cycle_receipt). The fetch receipt above says both refs were read. It does
// not say how, by what, what started the cycle or how the cycle ended. These
// do. They still hold no key material: a public-key fingerprint at most.
const CYCLE_SCHEMA = 'mccluster-reconcile-cycle/v1';
const HEX32 = /^[0-9a-f]{32}$/;
const KEY_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const UTC_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CYCLE_STAGE = /^[a-z_]{1,32}$/;
const CYCLE_OUTCOMES = new Set(['verified_no_change', 'deployed', 'deferred', 'failed']);
const CYCLE_SUCCESS = new Set(['verified_no_change', 'deployed']);
const CYCLE_TRIGGERS = new Set(['timer', 'timer_inferred', 'other']);
const TIMER_TRIGGERS = new Set(['timer', 'timer_inferred']);
const CYCLE_TRANSPORTS = new Set(['ssh', 'https', 'other']);
const CYCLE_LOG_MAX_BYTES = 64 * 1024;
const CYCLE_LOG_MAX_LINES = 60;
const RECENT_SUCCESSFUL = 5;

// Timing of core/systemd/mccluster-vps-reconcile.timer and .service. A test
// reads both unit files and fails if they stop matching these numbers.
export const RECONCILE_TIMER_PERIOD_MS = 2 * 60_000; // OnUnitActiveSec=2min
export const RECONCILE_TIMER_JITTER_MS = 20_000; // RandomizedDelaySec=20s
// AccuracySec is not set, so systemd's default applies: the timer may elapse
// up to one minute after it is due, which systemd uses to coalesce wakeups.
export const RECONCILE_TIMER_ACCURACY_MS = 60_000; // AccuracySec unset: 1min
export const RECONCILE_START_LIMIT_MS = 20 * 60_000; // TimeoutStartSec=20min
// A healthy host can go this long between two successful cycles and no longer:
// one cycle succeeds, the next starts within the period plus its jitter plus
// the timer's accuracy, and is a deploy that runs to the unit's start limit
// (tests, drain, restart, gates). That is 23 min 20 s. The threshold adds a
// margin; anything older is stale.
export const RECONCILE_STALE_AFTER_MS = 25 * 60_000;

// What "authenticated" means on a cycle, stated in the data so a reader of one
// row cannot take it for more. GitHub answers an HTTPS fetch of a public
// repository from anyone, so HTTPS never counts, credential helper or not. Over
// SSH GitHub only answers a key registered with it, and the reconciler names
// the one key it offered and proves the host key was pinned. That shows a
// registered key was accepted. While the repository is public it does NOT show
// that the key is this repository's deploy key or that it is read-only: those
// are proved on the host by `scripts/ovh-private-repo-ssh.sh status`.
export const RECONCILE_AUTHENTICATED_MEANS = 'ssh_fetch_succeeded_with_pinned_github_host_key_and_one_named_key; not_proof_of_repository_deploy_key_or_read_only';

const sha40 = (value) => (typeof value === 'string' && SHA40.test(value) ? value : null);

export function verifiedReconcileCycle(receipt, {
  repository = 'mcclusterishere/mccluster',
  promotedRef = 'deploy/ovh-production',
  nowMs = Date.now(),
} = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schema_version !== CYCLE_SCHEMA
    || receipt.repository !== repository
    || receipt.promoted_ref !== promotedRef
    || !CYCLE_OUTCOMES.has(receipt.outcome)
    || !CYCLE_TRIGGERS.has(receipt.trigger)
    || !CYCLE_TRANSPORTS.has(receipt.transport)
    || typeof receipt.stage !== 'string' || !CYCLE_STAGE.test(receipt.stage)
    || typeof receipt.cycle_id !== 'string' || (receipt.cycle_id !== '' && !HEX32.test(receipt.cycle_id))
    || typeof receipt.interrupted !== 'boolean'
    || typeof receipt.ssh_host_key_pinned !== 'boolean'
    || typeof receipt.https_credential_configured !== 'boolean'
    || typeof receipt.ssh_key_fingerprint !== 'string'
    || (receipt.ssh_key_fingerprint !== '' && !KEY_FINGERPRINT.test(receipt.ssh_key_fingerprint))
    || typeof receipt.started_at !== 'string' || !UTC_SECOND.test(receipt.started_at)
    || typeof receipt.finished_at !== 'string' || !UTC_SECOND.test(receipt.finished_at)) return null;
  for (const key of ['github_main_sha', 'github_promoted_sha', 'deployed_sha']) {
    if (typeof receipt[key] !== 'string' || (receipt[key] !== '' && !SHA40.test(receipt[key]))) return null;
  }
  const exitCode = receipt.exit_code;
  if (exitCode !== null && !(Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255)) return null;

  const startedMs = Date.parse(receipt.started_at);
  const finishedMs = Date.parse(receipt.finished_at);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || !Number.isFinite(nowMs)
    || startedMs > finishedMs || finishedMs > nowMs + 30_000) return null;

  // A receipt that contradicts itself is not evidence of anything.
  const success = CYCLE_SUCCESS.has(receipt.outcome);
  const ssh = receipt.transport === 'ssh';
  if (!ssh && (receipt.ssh_host_key_pinned || receipt.ssh_key_fingerprint !== '')) return null;
  if (receipt.transport !== 'https' && receipt.https_credential_configured) return null;
  if (success) {
    // A successful cycle fetched both refs, passed the ancestry gate and left
    // the host on the promoted commit, so it names all three and they agree.
    if (exitCode !== 0 || receipt.interrupted
      || !sha40(receipt.github_main_sha) || !sha40(receipt.github_promoted_sha) || !sha40(receipt.deployed_sha)
      || receipt.github_promoted_sha !== receipt.deployed_sha) return null;
  } else if (receipt.outcome === 'deferred') {
    if (exitCode !== 75 || receipt.interrupted) return null;
  } else if (receipt.interrupted ? exitCode !== null : !(Number.isInteger(exitCode) && exitCode >= 1)) {
    return null;
  }

  const fingerprint = ssh && receipt.ssh_key_fingerprint !== '' ? receipt.ssh_key_fingerprint : null;
  return {
    cycle_id: receipt.cycle_id || null,
    trigger: receipt.trigger,
    timer_triggered: TIMER_TRIGGERS.has(receipt.trigger),
    outcome: receipt.outcome,
    success,
    stage: receipt.stage,
    exit_code: exitCode,
    interrupted: receipt.interrupted,
    transport: receipt.transport,
    ssh_host_key_pinned: ssh && receipt.ssh_host_key_pinned,
    ssh_key_fingerprint: fingerprint,
    https_credential_configured: receipt.transport === 'https' && receipt.https_credential_configured,
    // See RECONCILE_AUTHENTICATED_MEANS. Never true for HTTPS, for an unpinned
    // host key, for an unnamed key, or for a cycle whose fetch did not succeed.
    authenticated: success && ssh && receipt.ssh_host_key_pinned && Boolean(fingerprint),
    github_main_sha: sha40(receipt.github_main_sha),
    github_promoted_sha: sha40(receipt.github_promoted_sha),
    deployed_sha: sha40(receipt.deployed_sha),
    started_at: receipt.started_at,
    finished_at: receipt.finished_at,
  };
}

function parseCycleLog(text, options) {
  if (typeof text !== 'string' || !text) return [];
  const cycles = [];
  for (const line of text.slice(-CYCLE_LOG_MAX_BYTES).split('\n').slice(-CYCLE_LOG_MAX_LINES)) {
    if (!line || line.length > 1024) continue;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch { continue; }
    const cycle = verifiedReconcileCycle(parsed, options);
    if (cycle) cycles.push(cycle);
  }
  return cycles.sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at));
}

const newer = (a, b) => (!b || (a && Date.parse(a.finished_at) > Date.parse(b.finished_at)) ? a : b);

// What Core health reports under deployment.reconcile.
//   verified    the newest cycle did not fail and a cycle succeeded within the window
//   failed      the newest cycle failed (or was terminated before it finished)
//   stale       no cycle has succeeded within the window
//   unverified  the host has no cycle receipts: its reconciler predates them.
//               Neither a failure nor a success, and never a degradation.
export function summarizeReconcileCycles({ latest = null, verified = null, history = '' } = {}, {
  repository = 'mcclusterishere/mccluster',
  promotedRef = 'deploy/ovh-production',
  nowMs = Date.now(),
  staleAfterMs = RECONCILE_STALE_AFTER_MS,
} = {}) {
  const options = { repository, promotedRef, nowMs };
  const log = parseCycleLog(history, options);
  const latestCycle = verifiedReconcileCycle(latest, options);
  const verifiedCandidate = verifiedReconcileCycle(verified, options);
  // The three files are written one after another. If one write was lost, the
  // newest valid receipt in any of them still decides.
  let last = latestCycle;
  let lastVerified = verifiedCandidate?.success ? verifiedCandidate : null;
  for (const cycle of log) {
    last = newer(cycle, last);
    if (cycle.success) lastVerified = newer(cycle, lastVerified);
  }
  if (lastVerified) last = newer(lastVerified, last);
  if (last?.success) lastVerified = newer(last, lastVerified);

  // Distinct by systemd invocation id. A cycle with no id (run from a shell,
  // outside systemd) cannot be told apart from another and is not counted.
  const byId = new Map();
  for (const cycle of log) if (cycle.success && cycle.cycle_id) byId.set(cycle.cycle_id, cycle);
  if (lastVerified?.cycle_id && !byId.has(lastVerified.cycle_id)) byId.set(lastVerified.cycle_id, lastVerified);
  const recent = [...byId.values()]
    .sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at))
    .slice(-RECENT_SUCCESSFUL);
  const timerCycles = recent.filter((cycle) => cycle.timer_triggered);

  let consecutiveFailed = 0;
  if (last && last.outcome === 'failed') {
    consecutiveFailed = 1;
    for (let index = log.length - 1; index >= 0; index -= 1) {
      const cycle = log[index];
      if (cycle.finished_at === last.finished_at && cycle.cycle_id === last.cycle_id) continue;
      if (cycle.outcome !== 'failed') break;
      consecutiveFailed += 1;
    }
  }

  const ageMs = lastVerified ? Math.max(0, nowMs - Date.parse(lastVerified.finished_at)) : null;
  let status = 'unverified';
  if (last) {
    if (last.outcome === 'failed') status = 'failed';
    else if (ageMs === null || ageMs > staleAfterMs) status = 'stale';
    else status = 'verified';
  }
  return {
    status,
    last_cycle: last,
    last_verified_cycle: lastVerified,
    last_verified_at: lastVerified?.finished_at || null,
    age_ms: ageMs,
    stale_after_ms: staleAfterMs,
    transport: lastVerified?.transport || null,
    authenticated: lastVerified?.authenticated === true,
    authenticated_means: RECONCILE_AUTHENTICATED_MEANS,
    consecutive_failed_cycles: consecutiveFailed,
    // Counted over recent_successful: the newest distinct successful cycles on record.
    distinct_successful_cycles: recent.length,
    distinct_successful_timer_cycles: timerCycles.length,
    distinct_authenticated_timer_cycles: timerCycles.filter((cycle) => cycle.authenticated).length,
    recent_successful: recent.map((cycle) => ({
      cycle_id: cycle.cycle_id,
      trigger: cycle.trigger,
      outcome: cycle.outcome,
      transport: cycle.transport,
      authenticated: cycle.authenticated,
      ssh_key_fingerprint: cycle.ssh_key_fingerprint,
      deployed_sha: cycle.deployed_sha,
      finished_at: cycle.finished_at,
    })),
  };
}
