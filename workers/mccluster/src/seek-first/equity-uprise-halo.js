import { entitlementCatalog, LANES } from './entitlements.js';
import { sourceByKey, sourceCatalog } from './source-registry.js';
import { entitlementRows, resolveHouseOrg } from './store.js';

/*
  Equity Uprise Halo Globe public projection.

  This is intentionally NOT a public alias for /v1/seek-first/*.
  The full Seek First/Halo plane stays house-owner protected.

  This projection answers only:
    - which layers may be publicly DISPLAYED under the effective house-org
      entitlement;
    - what non-secret display metadata the Floor 6 globe may use;
    - which UI access tier the caller occupies.

  It returns no stored entities, raw provider responses, secrets, credential
  binding names, audit state, owner health, ingestion controls, or write tools.
*/

const ROLE_TIERS = Object.freeze({
  visitor: 'public',
  member: 'member',
  host: 'member',
  client: 'member',
  editor: 'staff',
  admin: 'staff',
  owner: 'owner-admin'
});

export function haloAccessTier(role) {
  return ROLE_TIERS[String(role || 'visitor').toLowerCase()] || 'public';
}

function safeLayer(entry, decision) {
  const credentialed = Boolean(entry.credential_required);
  return {
    key: entry.key,
    name: entry.name,
    capabilities: entry.capabilities,
    attribution: entry.attribution || null,
    transport: entry.transport,
    persistence: entry.persistence,
    availability: credentialed
      ? (entry.configured ? 'configured' : 'provider-configuration-required')
      : 'keyless',
    display_access: 'read-only'
  };
}

export async function buildEquityUpriseHaloProjection(env, { role = 'visitor' } = {}) {
  const org = await resolveHouseOrg(env);
  const rows = await entitlementRows(env, org.id);
  const decorate = entitlementCatalog(rows, LANES.PUBLIC_OPEN);

  const layers = [];
  for (const entry of sourceCatalog(env)) {
    const source = sourceByKey(entry.key);
    if (!source) continue;
    const decision = decorate(source);

    // Public projection is deliberately stricter than "the owner can read it".
    // Both legal consumption on PUBLIC_OPEN and explicit public_display are
    // required. An expired/disabled source never appears.
    if (!decision.allowed || decision.public_display !== true) continue;
    layers.push(safeLayer(entry, decision));
  }

  const accessTier = haloAccessTier(role);
  return {
    schema_version: '1.0.0',
    service: 'equity-uprise-halo-globe',
    mode: 'sanitized-public-projection',
    read_only: true,
    source_of_truth: 'mccluster-seek-first',
    client_runtime: 'mcclusterishere/hitmans-halo',
    access: {
      role,
      tier: accessTier,
      globe_visible: true,
      projection_interactive: false,
      owner_operational_handoff: accessTier === 'owner-admin'
        ? 'https://api.mccluster.org/internal/seek-first'
        : null
    },
    layer_policy: {
      requested_lane: LANES.PUBLIC_OPEN,
      public_display_required: true,
      provider_terms_still_apply: true,
      no_raw_entity_payloads: true,
      no_credentials: true,
      no_write_controls: true
    },
    layers
  };
}
