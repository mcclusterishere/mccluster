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
             { installed: null, state: 'unknown' } when the read failed. A failed read is never shown as enabled. */
import { leagueCommand } from './league.js';
import { moduleControl } from './modules.js';

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

export async function handleOverview(_request, env, ctx) {
  const { fail, fetchImpl, now } = ctx;
  const blockers = [];
  const freshness = [];
  let campaigns = { drafts: 0, released: 0, paused: 0, withdrawn: 0 };
  let queues = { applications: 0, proofs: 0, reviews: 0 };
  let league = MODULES[0];
  try {
    const o = await leagueCommand(env, fetchImpl, fail, { action: 'overview', actor: ctx.user.id });
    campaigns = { ...campaigns, ...(o?.campaigns || {}) };
    queues = { ...queues, ...(o?.queues || {}) };
    freshness.push({ id: 'league', label: 'League intake', updated_at: o?.latest_change || null, state: o?.latest_change ? 'current' : 'empty' });
  } catch (error) {
    league = { ...league, state: error?.reason === 'schema_not_applied' ? 'draft' : 'unknown', detail: `${league.detail} (${error?.reason || 'unavailable'})` };
    blockers.push({ id: 'league_schema', text: error?.reason === 'schema_not_applied' ? 'Apply supabase/pending/eup_league_v1.sql (owner-reviewed) before League intake works.' : `League intake unreadable: ${error?.reason || 'unavailable'}`, gate: 'schema' });
    freshness.push({ id: 'league', label: 'League intake', updated_at: null, state: 'unknown' });
  }
  let sources = null;
  try {
    const mod = await import('./sources.js');
    if (typeof mod.sourcesSummary === 'function') sources = await mod.sourcesSummary(env, ctx);
  } catch { sources = null; }
  const policies = await modulePolicies(env, ctx);
  const modules = MODULES.map((m) => {
    if (m.id === 'league') return league;
    if (m.id === 'sources' && sources) return { ...m, state: sources.state || m.state, detail: sources.detail || m.detail };
    return m;
  }).map((m) => {
    const unit = POLICY_UNIT[m.id] ?? null;
    return { ...m, policy_module: unit, policy: unit ? (policies.units ? policies.units.get(unit) || POLICY_UNKNOWN : POLICY_UNKNOWN) : null };
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
    geography: { selected: null, note: 'No pilot geography chosen; Connecticut/Bridgeport is a proposal, not a decision.' },
    campaigns,
    queues,
    freshness,
    sources: sources || { state: 'not_implemented' },
    blockers
  };
}
