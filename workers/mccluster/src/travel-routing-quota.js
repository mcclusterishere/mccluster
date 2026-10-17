// One provider's public-service quota is one coordination atom. Store only
// quota times/counts in the existing DO, never endpoints, identity or IPs.
export function reserveRoutingQuota(previous = {}, now = Date.now()) {
  const day = Math.floor(now / 86400000), count = previous.day === day ? previous.count || 0 : 0;
  const until = Math.max(previous.nextAt || 0, previous.activeUntil || 0);
  if (until > now) return { allowed: false, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
  if (count >= 1000) return { allowed: false, retryAfter: Math.ceil(((day + 1) * 86400000 - now) / 1000), daily: true };
  return { allowed: true, state: { day, count: count + 1, nextAt: now + 1100, activeUntil: now + 20000 } };
}
export function releaseRoutingQuota(state, now = Date.now(), retryAfter = 0) {
  return { ...state, activeUntil: 0, nextAt: now + Math.max(1100, Math.min(86400, retryAfter) * 1000) };
}
