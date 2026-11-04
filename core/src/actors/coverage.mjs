import { digest } from './evidence.mjs';
import { selectedPersonas } from './persona.mjs';
import { PROMPT_VERSION } from './generate.mjs';

// Proposed preview budgets only. Existing publication limits/timers are untouched.
export const DEFAULT_COVERAGE_POLICY = Object.freeze({ schema: 'actor-coverage/v1', enabled: false,
  mode: 'preview', purpose: 'ordinary_own_platform_commentary', surfaces: ['news', 'song', 'post'], max_batch: 3, max_pending: 6,
  max_daily: 12, max_per_actor_daily: 3, max_attempts: 2, backfill: false });
const key = item => `${item.kind}:${item.id}`;
const stamp = item => {
  const v = item.discovered_at || item.created_at || item.updated_at || item.published_at || '';
  return Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : '';
};
const position = item => ({ at: stamp(item), id: item.id });
const compare = (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);

export function coverageJobId(orgId, item) {
  // Actor and config versions deliberately excluded: changing cast cannot flood
  // the same item with another automatically scheduled character.
  const h = digest(`actor-coverage/v1:${orgId}:${key(item)}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function validatePolicy(p) {
  if (p.schema !== 'actor-coverage/v1' || p.mode !== 'preview' || typeof p.enabled !== 'boolean' ||
      p.purpose !== 'ordinary_own_platform_commentary' || p.audience_targeting || p.political_objective || p.campaign_objective ||
      !Array.isArray(p.surfaces) || !p.surfaces.length || new Set(p.surfaces).size !== p.surfaces.length || p.surfaces.some(s => !['news', 'song', 'post'].includes(s))) throw new Error('Only bounded own-platform preview coverage is supported');
  for (const [name, max] of [['max_batch', 6], ['max_pending', 12], ['max_daily', 24], ['max_per_actor_daily', 6], ['max_attempts', 2]]) {
    if (!Number.isInteger(p[name]) || p[name] < 1 || p[name] > max) throw new Error(`Invalid coverage limit: ${name}`);
  }
  if (p.backfill !== false && (!p.backfill || !Number.isInteger(p.backfill.max_items) || p.backfill.max_items < 1 || p.backfill.max_items > 100 || !Number.isFinite(Date.parse(p.backfill.since)))) throw new Error('Backfill requires an explicit bounded window and item budget');
}

// Pure plan used by new-item signals and scheduled reconciliation alike. Durable
// state remains ops_agent_jobs/input/output, not a parallel queue or local store.
// No timer or production trigger invokes this planner in this change.
export function planActorCoverage({ orgId, items = [], personaConfig, policy = DEFAULT_COVERAGE_POLICY,
  existing = [], checkpoint = {}, load = {}, now = new Date() }) {
  validatePolicy(policy);
  if (!orgId || !Array.isArray(items) || items.length > 100) throw new Error('Coverage requires a house org and at most 100 canonical items');
  const result = { schema: 'actor-coverage-plan/v1', mode: 'preview', enabled: policy.enabled, jobs: [], outcomes: [],
    checkpoint: { surface_cursor: checkpoint.surface_cursor || 0, after: { ...(checkpoint.after || {}) }, scanned: checkpoint.scanned || 0 },
    counts: { planned: 0, skipped: 0, deferred: 0 }, dispatchable: false,
    dispatch_blocker: 'Owner batch or atomic shared budget reservation required before scheduling' };
  if (!policy.enabled) return result;
  const cast = Object.fromEntries(policy.surfaces.map(s => [s, selectedPersonas(personaConfig, s)]));
  const nonnegative = n => Number.isInteger(n) && n >= 0;
  if (!nonnegative(load.pending) || !nonnegative(load.daily) || !load.per_actor ||
      Object.values(load.per_actor).some(n => !nonnegative(n))) throw new Error('Complete bounded load snapshot required');
  const since = policy.backfill ? Date.parse(policy.backfill.since) : now.getTime() - 86400000;
  if (since > now.getTime()) throw new Error('Coverage window starts in future');
  let capacity = Math.max(0, Math.min(policy.max_batch, policy.max_pending - load.pending, policy.max_daily - load.daily));
  let budget = policy.backfill ? Math.max(0, policy.backfill.max_items - result.checkpoint.scanned) : 100;
  const previous = new Map(existing.map(e => [`${e.kind}:${e.item_id}`, e]));
  const seen = new Set(), bins = Object.fromEntries(policy.surfaces.map(s => [s, []]));
  for (const item of items) {
    if (!bins[item.kind] || typeof item.id !== 'string' || !item.id || !Number.isFinite(Date.parse(stamp(item)))) continue;
    if (seen.has(key(item))) continue; seen.add(key(item));
    if (Date.parse(stamp(item)) < since || Date.parse(stamp(item)) > now.getTime()) continue;
    if (checkpoint.after?.[item.kind] && compare(position(item), checkpoint.after[item.kind]) <= 0) continue;
    bins[item.kind].push(item);
  }
  Object.values(bins).forEach(bin => bin.sort((a, b) => compare(position(a), position(b))));
  const perActor = { ...load.per_actor };
  const blockedSurfaces = new Set();
  let cursor = result.checkpoint.surface_cursor % policy.surfaces.length, empty = 0;
  while (budget > 0 && empty < policy.surfaces.length) {
    const kind = policy.surfaces[cursor], item = blockedSurfaces.has(kind) ? null : bins[kind][0];
    cursor = (cursor + 1) % policy.surfaces.length;
    if (!item) { empty++; continue; } empty = 0;
    const prior = previous.get(key(item));
    let reason = prior ? (prior.attempts >= policy.max_attempts && prior.status === 'failed' ? 'retry_exhausted' : 'already_tracked') : null;
    if (item.visibility && item.visibility !== 'public' || item.deleted_at || item.group_id || item.status === 'archived') reason = 'not_public_or_removed';
    const eligible = cast[kind].filter(p => (perActor[p.actor_key] || 0) < policy.max_per_actor_daily);
    if (!reason && !capacity) {
      for (const [surface, bin] of Object.entries(bins)) if (!blockedSurfaces.has(surface)) {
        for (const pending of bin) result.outcomes.push({ kind: surface, item_id: pending.id, status: 'deferred', reason: 'preview_capacity' });
        result.counts.deferred += bin.length;
      }
      break;
    }
    if (!reason && (!cast[kind].length || !eligible.length)) {
      for (const pending of bins[kind]) result.outcomes.push({ kind, item_id: pending.id, status: 'deferred', reason: cast[kind].length ? 'actor_capacity' : 'awaiting_approved_selected_persona' });
      result.counts.deferred += bins[kind].length;
      blockedSurfaces.add(kind); continue;
    }
    bins[kind].shift(); budget--; result.checkpoint.scanned++;
    result.checkpoint.after[kind] = position(item); result.checkpoint.surface_cursor = cursor;
    if (reason) { result.outcomes.push({ kind, item_id: item.id, status: 'skipped', reason }); result.counts.skipped++; continue; }
    const score = p => p.topics.filter(t => (item.topics || []).includes(t)).length;
    eligible.sort((a, b) => score(b) - score(a) || (perActor[a.actor_key] || 0) - (perActor[b.actor_key] || 0) ||
      digest(key(item) + a.actor_key).localeCompare(digest(key(item) + b.actor_key)));
    const chosen = eligible[0]; perActor[chosen.actor_key] = (perActor[chosen.actor_key] || 0) + 1;
    result.jobs.push({ jobId: coverageJobId(orgId, item), orgId, jobType: 'actor_comment_preview', targetType: 'platform_actor',
      targetId: chosen.actor_key, priority: 10, maxAttempts: policy.max_attempts,
      input: { kind, item_id: item.id, expected_revision: item.revision || item.updated_at || null,
        persona_config_version: personaConfig.version, persona_digest: digest(chosen), prompt_version: PROMPT_VERSION,
        coverage_key: key(item), trigger: item.trigger === 'created' ? 'created' : 'reconciliation', preview_only: true } });
    result.outcomes.push({ kind, item_id: item.id, actor_key: chosen.actor_key, status: 'planned' });
    result.counts.planned++; capacity--;
  }
  return result;
}

export function coverageStatus(jobs = []) {
  return jobs.map(j => ({ job_id: j.id, actor_key: j.target_id, kind: j.input?.kind, item_id: j.input?.item_id,
    status: j.status === 'completed' ? (j.output?.status || 'needs_review') : j.status,
    attempts: j.attempts || 0, reason: j.output?.reason || null, evidence_sha256: j.output?.provenance?.evidence_sha256 || null,
    review: j.output?.review || null, metrics: j.output?.metrics || null, published: j.output?.published === true }));
}
