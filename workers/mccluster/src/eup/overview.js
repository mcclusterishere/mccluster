/* E=Up → Overview: module state, selected geography, campaign drafts, queue
   counts, freshness and concrete blockers. Owner-only through ./router.js.
   States are read from the canonical plane where a module has storage and are
   otherwise the documented release posture as of 2026-11-09 (see
   docs/control-plane/deep-audit-20261109/HANDOFF.md). Nothing here is a claim
   that a feature is live: 'held', 'dormant' and 'partial' are honest states.

   Two different facts per module, never merged:
     state   the documented release posture (draft / planned / held / dormant / partial / unknown)
     policy  the PERSISTED module policy read from the store on this request (./modules.js): installed,
             enabled / draining / disabled, revision. It is null for a module no policy unit governs, and
             { installed: null, state: 'unknown' } when the read failed. A failed read is never shown as enabled.

   A module governed by the intake unit also carries import_runs, the open import runs read on this request:
     { queued, running, running_expired, lease_expires_at }
   running_expired counts running runs whose lease has run out (no live holder), so a drain of intake has
   settled when running - running_expired is 0. Every count is null when the read failed or answered anything
   else: a missing count is never shown as zero. import_run_counts says whether the read worked.

   The League's own facts come from one owner read (eup_league_command 'overview', shape SHAPES.overview of
   ./league-contract.js) on this request, never cached:
     campaigns  { drafts, released, paused, withdrawn }                       (top level, as before)
     queues     { applications, proofs, reviews, appeals, media_due }        (top level, as before)
     league     { status, reason, missions { drafts, released },
                  policy { present, valid, media_enabled, revision },        the League CONFIGURATION (not module state)
                  audience { invited_campaigns, open_grants }, latest_change }
   A count the read did not return (or returned as anything but a count) is null, never zero; the SQL itself
   answers null for a queue it does not compute yet. Blockers name what stops a member run: no League policy,
   an invalid one, media not enabled, no campaign open to invited testers, no open tester grant. */
import { leagueCommand } from './league.js';
import { moduleControl } from './modules.js';
import { readRunCounts } from './intake.js';

const MODULES = [
  { id: 'league', label: 'Environmental Justice League', state: 'draft', detail: 'Private admin intake (pending eup_league_v1.sql). Campaign/mission/application/proof/review/consent loop; no points, payment, publication or broadcast.' },
  { id: 'civic', label: 'Civic League', state: 'planned', detail: 'Offices, terms, legislation, elections from official sources into private intake; public civic rows stay a separate release surface.' },
  { id: 'companies', label: 'Companies & Finance', state: 'planned', detail: 'SEC/GLEIF identity, sourced locations, filings, federal awards; market quotes only under a verified licence.' },
  { id: 'sources', label: 'Sources & Review', state: 'planned', detail: 'Connector registry (all disabled), rights/configuration, review queue, bounded refresh/pause.' },
  { id: 'consumer_environment', label: 'Consumer environment globe', state: 'held', detail: '20261107120000_world_environment_v1.sql and 20261108120000_world_environment_proofs_v1.sql are held for admin-only scope; no member join/proof activation.' },
  { id: 'arcade', label: 'City Arcade cloud', state: 'dormant', detail: 'Schema applied as 20261109181623_city_arcade_v1; ARCADE_CLOUD_ENABLED absent; startKey-aware Worker not deployed.' },
  { id: 'c5', label: 'Core-signed replay protection', state: 'partial', detail: 'Nonce table applied as 20261109180829_core_signed_nonces_v1; CORE_REPLAY_STORE not configured; paid-operation claim and uncertain-provider reconciliation open.' }
];
/* Which persisted policy unit governs each Overview module. Civic, Companies and Sources share the intake unit. */
const POLICY_UNIT = Object.freeze({ league: 'league', civic: 'intake', companies: 'intake', sources: 'intake', consumer_environment: 'environment', arcade: null, c5: null });
const POLICY_UNKNOWN = Object.freeze({ installed: null, state: 'unknown', revision: null, updated_at: null });

/* The persisted policy of every unit, or the reason it could not be read. One service read, no cache. */
async function modulePolicies(env, ctx) {
  try {
    const control = await moduleControl(env, ctx.fetchImpl, ctx.fail, ctx.user.id, 1);
    return { status: 'available', reason: null, units: new Map(control.modules.map((m) => [m.moduleId, { installed: m.installed, state: m.state, revision: m.revision, updated_at: m.updated_at }])) };
  } catch (error) {
    const reason = error?.reason || 'unavailable';
    return { status: reason === 'schema_not_applied' ? 'schema_not_applied' : 'unavailable', reason, units: null };
  }
}

const RUNS_UNKNOWN = Object.freeze({ queued: null, running: null, running_expired: null, lease_expires_at: null });
const count = (value) => Number.isSafeInteger(value) && value >= 0;
/* The open import runs of the intake unit. One service read, never guarded, no cache. */
async function importRunCounts(env, ctx) {
  try {
    const c = await readRunCounts(env, ctx);
    if (!c || typeof c !== 'object' || Array.isArray(c) || !count(c.queued) || !count(c.running) || !count(c.running_expired) || c.running_expired > c.running) {
      return { status: 'unavailable', reason: 'storage_unavailable', counts: RUNS_UNKNOWN };
    }
    return { status: 'available', reason: null, counts: { queued: c.queued, running: c.running, running_expired: c.running_expired, lease_expires_at: typeof c.lease_expires_at === 'string' ? c.lease_expires_at : null } };
  } catch (error) {
    return { status: 'unavailable', reason: error?.reason || 'unavailable', counts: RUNS_UNKNOWN };
  }
}

/* The League read. Counts are taken only when they are counts; flags only when they are booleans. */
const LEAGUE_COUNTS = Object.freeze({
  campaigns: ['drafts', 'released', 'paused', 'withdrawn'],
  missions: ['drafts', 'released'],
  queues: ['applications', 'proofs', 'reviews', 'appeals', 'media_due'],
  audience: ['invited_campaigns', 'open_grants']
});
const countsOf = (value, keys) => Object.fromEntries(keys.map((k) => [k, value && typeof value === 'object' && count(value[k]) ? value[k] : null]));
const flagOf = (value) => (typeof value === 'boolean' ? value : null);
function leagueFacts(o) {
  const p = o && typeof o.policy === 'object' ? o.policy : null;
  return {
    campaigns: countsOf(o?.campaigns, LEAGUE_COUNTS.campaigns), missions: countsOf(o?.missions, LEAGUE_COUNTS.missions),
    queues: countsOf(o?.queues, LEAGUE_COUNTS.queues), audience: countsOf(o?.audience, LEAGUE_COUNTS.audience),
    policy: { present: flagOf(p?.present), valid: flagOf(p?.valid), media_enabled: flagOf(p?.media_enabled), revision: count(p?.revision) ? p.revision : null },
    latest_change: typeof o?.latest_change === 'string' ? o.latest_change : null
  };
}
async function leagueOverview(env, ctx) {
  try {
    const o = await leagueCommand(env, ctx.fetchImpl, ctx.fail, { action: 'overview', actor: ctx.user.id, timeoutMs: ctx.rpcTimeoutMs });
    return { status: 'available', reason: null, ...leagueFacts(o) };
  } catch (error) {
    const reason = error?.reason || 'unavailable';
    return { status: reason === 'schema_not_applied' ? 'schema_not_applied' : 'unavailable', reason, ...leagueFacts(null) };
  }
}
/* What stops a member run, from a League read that worked. Readiness first (one blocker: the first that applies),
   then the released audience. Fixed text: no value from the store is put in a sentence. */
function leagueBlockers(l) {
  const out = [];
  if (l.policy.present === false) out.push({ id: 'league_policy_missing', text: 'No League policy is set. Until the owner sets one (entitlement, media, retention and notices), every member mutation answers policy_unavailable; reads still answer.', gate: 'owner_decision' });
  else if (l.policy.valid === false) out.push({ id: 'league_policy_invalid', text: 'The stored League policy is not valid, so every member mutation answers policy_unavailable until the owner sets a valid one.', gate: 'owner_decision' });
  else if (l.policy.media_enabled === false) out.push({ id: 'league_media_disabled', text: 'Media is not enabled in the League policy: audio and video uploads answer policy_unavailable. The written accommodation path does not need media.', gate: 'owner_decision' });
  if (l.audience.invited_campaigns === 0) out.push({ id: 'league_audience_admin_preview', text: 'No campaign is open to invited testers: every campaign is admin_preview, so only house owners see released missions. A member run needs a campaign set to invited and a tester grant.', gate: 'owner_decision' });
  else if (l.audience.open_grants === 0) out.push({ id: 'league_audience_no_grants', text: 'A campaign is set to invited, but no account holds an open grant on it, so no tester can take part yet.', gate: 'owner_decision' });
  return out;
}

export async function handleOverview(_request, env, ctx) {
  const { now } = ctx;
  const blockers = [];
  const freshness = [];
  let league = MODULES[0];
  const l = await leagueOverview(env, ctx);
  if (l.status === 'available') {
    freshness.push({ id: 'league', label: 'League intake', updated_at: l.latest_change, state: l.latest_change ? 'current' : 'empty' });
    blockers.push(...leagueBlockers(l));
  } else {
    league = { ...league, state: l.status === 'schema_not_applied' ? 'draft' : 'unknown', detail: `${league.detail} (${l.reason})` };
    blockers.push({ id: 'league_schema', text: l.status === 'schema_not_applied' ? 'Apply supabase/pending/eup_league_v1.sql (owner-reviewed) before League intake works.' : `League intake unreadable: ${l.reason}`, gate: 'schema' });
    freshness.push({ id: 'league', label: 'League intake', updated_at: null, state: 'unknown' });
  }
  let sources = null;
  try {
    const mod = await import('./sources.js');
    if (typeof mod.sourcesSummary === 'function') sources = await mod.sourcesSummary(env, ctx);
  } catch { sources = null; }
  const policies = await modulePolicies(env, ctx);
  const runs = await importRunCounts(env, ctx);
  const modules = MODULES.map((m) => {
    if (m.id === 'league') return league;
    if (m.id === 'sources' && sources) return { ...m, state: sources.state || m.state, detail: sources.detail || m.detail };
    return m;
  }).map((m) => {
    const unit = POLICY_UNIT[m.id] ?? null;
    return { ...m, policy_module: unit, policy: unit ? (policies.units ? policies.units.get(unit) || POLICY_UNKNOWN : POLICY_UNKNOWN) : null, import_runs: unit === 'intake' ? runs.counts : null };
  });
  if (policies.status === 'schema_not_applied') blockers.push({ id: 'module_policy_schema', text: 'Apply supabase/pending/eup_module_policy_v1.sql (owner-reviewed) before any module can be installed or enabled; until then no module policy exists and none is reported enabled.', gate: 'schema' });
  else if (policies.status !== 'available') blockers.push({ id: 'module_policy_unreadable', text: `Module policy unreadable: ${policies.reason}. No module is reported enabled.`, gate: 'storage' });
  if (!sources) blockers.push({ id: 'sources_not_implemented', text: 'Source registry and private intake are not implemented; connectors stay disabled.', gate: 'implementation' });
  blockers.push(
    { id: 'consumer_environment_held', text: 'Consumer environment SQL is held; the public globe keeps its current authorized behavior.', gate: 'owner_scope' },
    { id: 'points_payment_unset', text: 'Points, payment, agency commission and publication policies are unset; no reward or payout can be computed.', gate: 'owner_decision' }
  );
  return {
    ok: true,
    scope: 'house_owner',
    generated_at: new Date(now()).toISOString(),
    modules,
    module_policy: { status: policies.status, reason: policies.reason },
    import_run_counts: { status: runs.status, reason: runs.reason },
    geography: { selected: null, note: 'No pilot geography chosen; Connecticut/Bridgeport is a proposal, not a decision.' },
    campaigns: l.campaigns,
    queues: l.queues,
    league: { status: l.status, reason: l.reason, missions: l.missions, policy: l.policy, audience: l.audience, latest_change: l.latest_change },
    freshness,
    sources: sources || { state: 'not_implemented' },
    blockers
  };
}
