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
