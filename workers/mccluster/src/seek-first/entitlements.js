import { GeoAdapterError } from './adapters.js';
import { PERSISTENCE, SOURCE_CLASSES, sourceByKey } from './source-registry.js';

/*
  The licensing firewall.

  We obtain spatial data through several legitimate eligibility lanes, and some
  provider terms forbid the lanes from mixing. Planet's education-and-research
  imagery must never end up as a dependency of a commercial Whip build, and a
  nonprofit-rate feed must not quietly subsidise unrelated commercial work.

  A CONSUMER declares the lane it is asking on behalf of. A SOURCE declares the
  class of licence it was obtained under. This module decides whether that pair
  is allowed, and what the consumer may then do with the rows.

  A row in public.seek_first_source_entitlements narrows or widens the default for one
  org; the defaults below are what applies when the owner has not written one.
  Defaults never invent a permission the source class does not already imply.
*/

export const LANES = Object.freeze({
  PUBLIC_OPEN: 'PUBLIC_OPEN',
  ACADEMIC: 'ACADEMIC',
  NONPROFIT: 'NONPROFIT',
  COMMERCIAL: 'COMMERCIAL',
  INTERNAL: 'INTERNAL',
  RESTRICTED: 'RESTRICTED'
});

const LANE_VALUES = new Set(Object.values(LANES));

// INTERNAL is McCluster's own operations console and research desk: it may read
// every lane precisely because it is the one consumer that never redistributes.
const CONSUMABLE_BY = Object.freeze({
  [SOURCE_CLASSES.PUBLIC_OPEN]: [LANES.PUBLIC_OPEN, LANES.ACADEMIC, LANES.NONPROFIT, LANES.COMMERCIAL, LANES.INTERNAL, LANES.RESTRICTED],
  [SOURCE_CLASSES.ACADEMIC]: [LANES.ACADEMIC, LANES.INTERNAL],
  [SOURCE_CLASSES.NONPROFIT]: [LANES.NONPROFIT, LANES.INTERNAL],
  [SOURCE_CLASSES.COMMERCIAL]: [LANES.COMMERCIAL, LANES.INTERNAL],
  [SOURCE_CLASSES.INTERNAL]: [LANES.INTERNAL],
  [SOURCE_CLASSES.RESTRICTED]: [LANES.INTERNAL]
});

export function normalizeLane(value, fallback = LANES.INTERNAL) {
  if (value === undefined || value === null || value === '') return fallback;
  const lane = String(value).trim().toUpperCase();
  if (!LANE_VALUES.has(lane)) {
    throw new GeoAdapterError(`lane must be one of ${[...LANE_VALUES].join(', ')}`, 400, 'invalid_lane');
  }
  return lane;
}

export function defaultEntitlement(source) {
  const open = source.sourceClass === SOURCE_CLASSES.PUBLIC_OPEN;
  const persistable = source.persistence === PERSISTENCE.PERSISTENT;
  return {
    source_key: source.key,
    origin: 'registry_default',
    enabled: true,
    lane: source.lane,
    source_class: source.sourceClass,
    consumable_by: CONSUMABLE_BY[source.sourceClass] || [LANES.INTERNAL],
    commercial_use: source.sourceClass === SOURCE_CLASSES.COMMERCIAL || open,
    public_display: open,
    redistribution: false,
    persistence_allowed: persistable,
    derived_use: true,
    attribution_required: Boolean(source.attribution),
    attribution: source.attribution,
    expires_at: null
  };
}

function applyRow(base, row) {
  if (!row) return base;
  return {
    ...base,
    origin: 'org_entitlement',
    enabled: row.enabled !== false,
    lane: row.lane || base.lane,
    commercial_use: Boolean(row.commercial_use),
    public_display: Boolean(row.public_display),
    redistribution: Boolean(row.redistribution),
    persistence_allowed: Boolean(row.persistence_allowed) && base.persistence_allowed,
    terms_acknowledged_at: row.terms_acknowledged_at || null,
    expires_at: row.expires_at || null
  };
}

export function effectiveEntitlement(source, row) {
  return applyRow(defaultEntitlement(source), row);
}

/*
  Fail closed. An expired grant, a disabled grant, or a lane the source class
  does not cover is a 403 that names the reason — never a silent downgrade to a
  lane the provider did not licence.
*/
export function assertConsumable(entitlement, lane) {
  if (!entitlement.enabled) {
    throw new GeoAdapterError(`${entitlement.source_key} is disabled for this organization`, 403, 'entitlement_disabled', {
      source: entitlement.source_key
    });
  }
  if (entitlement.expires_at && Date.parse(entitlement.expires_at) <= Date.now()) {
    throw new GeoAdapterError(`${entitlement.source_key} entitlement expired`, 403, 'entitlement_expired', {
      source: entitlement.source_key,
      expires_at: entitlement.expires_at
    });
  }
  if (!entitlement.consumable_by.includes(lane)) {
    throw new GeoAdapterError(
      `${entitlement.source_key} is licensed under ${entitlement.source_class} and cannot be consumed on the ${lane} lane`,
      403,
      'entitlement_lane_denied',
      { source: entitlement.source_key, source_class: entitlement.source_class, requested_lane: lane, consumable_by: entitlement.consumable_by }
    );
  }
  if (lane === LANES.COMMERCIAL && !entitlement.commercial_use) {
    throw new GeoAdapterError(`${entitlement.source_key} does not permit commercial use`, 403, 'entitlement_commercial_denied', {
      source: entitlement.source_key
    });
  }
  return entitlement;
}

export function entitlementCatalog(rowsByKey = new Map(), lane = LANES.INTERNAL) {
  return (source) => {
    const entitlement = effectiveEntitlement(source, rowsByKey.get(source.key));
    let allowed = true;
    let denied_reason = null;
    try {
      assertConsumable(entitlement, lane);
    } catch (error) {
      allowed = false;
      denied_reason = error.code;
    }
    return { ...entitlement, requested_lane: lane, allowed, denied_reason };
  };
}

export function sourceOrThrow(key) {
  const source = sourceByKey(key);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  return source;
}
