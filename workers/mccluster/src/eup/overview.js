/* E=Up → Overview: module state, selected geography, campaign drafts, queue
   counts, freshness and concrete blockers. Owner-only through ./router.js.
   States are read from the canonical plane where a module has storage and are
   otherwise the documented release posture as of 2026-11-09 (see
   docs/control-plane/deep-audit-20261109/HANDOFF.md). Nothing here is a claim
   that a feature is live: 'held', 'dormant' and 'partial' are honest states. */
import { leagueCommand } from './league.js';

const MODULES = [
  { id: 'league', label: 'Environmental Justice League', state: 'draft', detail: 'Private admin intake (pending eup_league_v1.sql). Campaign/mission/application/proof/review/consent loop; no points, payment, publication or broadcast.' },
  { id: 'civic', label: 'Civic League', state: 'planned', detail: 'Offices, terms, legislation, elections from official sources into private intake; public civic rows stay a separate release surface.' },
  { id: 'companies', label: 'Companies & Finance', state: 'planned', detail: 'SEC/GLEIF identity, sourced locations, filings, federal awards; market quotes only under a verified licence.' },
  { id: 'sources', label: 'Sources & Review', state: 'planned', detail: 'Connector registry (all disabled), rights/configuration, review queue, bounded refresh/pause.' },
  { id: 'consumer_environment', label: 'Consumer environment globe', state: 'held', detail: '20261107120000_world_environment_v1.sql and 20261108120000_world_environment_proofs_v1.sql are held for admin-only scope; no member join/proof activation.' },
  { id: 'arcade', label: 'City Arcade cloud', state: 'dormant', detail: 'Schema applied as 20261109181623_city_arcade_v1; ARCADE_CLOUD_ENABLED absent; startKey-aware Worker not deployed.' },
  { id: 'c5', label: 'Core-signed replay protection', state: 'partial', detail: 'Nonce table applied as 20261109180829_core_signed_nonces_v1; CORE_REPLAY_STORE not configured; paid-operation claim and uncertain-provider reconciliation open.' }
];

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
  const modules = MODULES.map((m) => {
    if (m.id === 'league') return league;
    if (m.id === 'sources' && sources) return { ...m, state: sources.state || m.state, detail: sources.detail || m.detail };
    return m;
  });
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
    geography: { selected: null, note: 'No pilot geography chosen; Connecticut/Bridgeport is a proposal, not a decision.' },
    campaigns,
    queues,
    freshness,
    sources: sources || { state: 'not_implemented' },
    blockers
  };
}
