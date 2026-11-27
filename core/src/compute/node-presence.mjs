// Mirrors the three-minute eligibility window in compute_claim_task. This is
// presence evidence, not a check for a particular capability, GPU or free slot.
export const COMPUTE_HEARTBEAT_WINDOW_MS = 180_000;
const INACTIVE = new Set(['disabled', 'draining', 'revoked', 'quarantined']);

export function computeNodePresence(node, { nowMs = Date.now() } = {}) {
  const configuredState = String(node?.state || node?.status || '').trim().toLowerCase();
  const seen = Date.parse(node?.last_seen_at || '');
  const age = Number.isFinite(seen) ? Math.max(0, nowMs - seen) : null;
  let state;
  if (INACTIVE.has(configuredState)) state = 'inactive';
  else if (configuredState === 'offline') state = 'offline';
  else if (configuredState !== 'online' || age === null) state = 'unknown';
  else state = age <= COMPUTE_HEARTBEAT_WINDOW_MS ? 'online' : 'stale';
  return { state, heartbeat_age_ms: age };
}
