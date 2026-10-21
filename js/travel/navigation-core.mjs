/**
 * Free travel planning primitives. No network, storage, GPS, auth or purchases.
 * Reuses the external-directions approach reviewed in PR #451 without importing
 * its stale World UI or database ledger. URLs are navigation handoffs, NOT route
 * geometry, flight status, reservations, driver assignments or evidence of travel.
 * Coordinates use GeoJSON order [longitude, latitude].
 */
const MODES = Object.freeze({
  drive: 'driving', walk: 'walking', cycle: 'cycling', transit: 'transit',
});
const KINDS = new Set([...Object.keys(MODES), 'flight', 'train', 'bus', 'stay']);
const MAX_LEGS = 32;

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) {
    throw new TypeError(`${name} must be a 1-80 character identifier`);
  }
  return value;
}

/** A location is either a user-entered place query OR numeric coordinates. */
export function normalizePlace(input) {
  record(input, 'place');
  const hasQuery = Object.hasOwn(input, 'query');
  const hasCoordinates = Object.hasOwn(input, 'coordinates');
  if (hasQuery === hasCoordinates) throw new TypeError('Provide query or coordinates, not both');
  if (hasQuery) {
    if (typeof input.query !== 'string' || /[\u0000-\u001f\u007f]/u.test(input.query)) {
      throw new TypeError('Place query must be text without control characters');
    }
    const query = input.query.trim().replace(/\s+/gu, ' ');
    if (!query || query.length > 240) throw new RangeError('Place query must contain 1-240 characters');
    return Object.freeze({ query });
  }
  const c = input.coordinates;
  if (!Array.isArray(c) || c.length !== 2 || ![c[0], c[1]].every(n => typeof n === 'number' && Number.isFinite(n))
      || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) {
    throw new TypeError('Coordinates must be finite [longitude, latitude] in geographic bounds');
  }
  // Actual zero coordinates are valid. Missing/null/boolean values never become zero.
  return Object.freeze({ coordinates: Object.freeze([...c]) });
}

function placeParameter(place) {
  return Object.hasOwn(place, 'query') ? place.query : `${place.coordinates[1]},${place.coordinates[0]}`;
}

/**
 * Build a URL only. Caller must offer a clearly labelled, user-initiated link
 * with rel="noopener noreferrer". Omit origin to let the selected map app ask
 * the user; never request location just to construct a link. The selected app
 * receives these endpoints when the link is opened and may keep its own history.
 * Apple uses unified Maps URLs (iOS 18.4+); real-device QA is a release gate.
 */
export function directionsLink(options) {
  record(options, 'options');
  const { provider, origin = null, destination, mode = 'driving', navigate = false } = options;
  if (typeof navigate !== 'boolean') throw new TypeError('navigate must be boolean');
  if (!['google', 'apple'].includes(provider)) throw new TypeError('Unknown map provider');
  if (!Object.values(MODES).includes(mode)) throw new TypeError('Unsupported ground travel mode');
  const dest = normalizePlace(destination);
  const from = origin === null ? null : normalizePlace(origin);
  const google = provider === 'google';
  const url = new URL(google ? 'https://www.google.com/maps/dir/' : 'https://maps.apple.com/directions');
  if (google) url.searchParams.set('api', '1');
  if (google && navigate) url.searchParams.set('dir_action', 'navigate');
  url.searchParams.set('destination', placeParameter(dest));
  if (from) url.searchParams.set(google ? 'origin' : 'source', placeParameter(from));
  url.searchParams.set(google ? 'travelmode' : 'mode', google && mode === 'cycling' ? 'bicycling' : mode);
  // Never silently truncate destinations, swap a mode or drop a leg to fit a URL.
  if (url.href.length > 2048) throw new RangeError('Directions URL exceeds the supported length');
  return url.href;
}

/**
 * An in-memory DRAFT itinerary, not an authoritative booking/dispatch record.
 * Server-side authorization and persistence are deliberately NOT implemented.
 * Unknown client fields (including booking status and passenger identifiers) are
 * not carried over. Every leg stays unconfirmed and has no fabricated ETA/fare.
 */
export function createPlan(input) {
  record(input, 'plan');
  const id = identifier(input.id, 'plan id');
  if (!Array.isArray(input.legs) || input.legs.length < 1 || input.legs.length > MAX_LEGS) {
    throw new RangeError(`A plan needs 1-${MAX_LEGS} legs`);
  }
  const ids = new Set();
  const legs = Array.from(input.legs, leg => {
    record(leg, 'leg');
    const legId = identifier(leg.id, 'leg id');
    if (ids.has(legId)) throw new TypeError('Duplicate leg id');
    ids.add(legId);
    if (!KINDS.has(leg.kind)) throw new TypeError('Unsupported leg kind');
    const origin = leg.origin == null ? null : normalizePlace(leg.origin);
    if (leg.kind !== 'stay' && !origin) throw new TypeError('Travel legs need an explicit planned origin');
    return Object.freeze({
      id: legId, kind: leg.kind, origin, destination: normalizePlace(leg.destination),
      status: 'unconfirmed', eta: null, price: null,
    });
  });
  return Object.freeze({ version: 1, id, status: 'draft', dataKind: 'user_plan', legs: Object.freeze(legs) });
}

/**
 * Get a handoff for ONE chosen ground leg; never turn a flight or booked train
 * into a road route. Transit handoffs are generic route searches, not tickets or
 * matching of a specific scheduled bus/train. startHere omits the planned origin
 * only when a caller explicitly supplies true following a user action.
 */
export function legHandoff(input, legId, provider, { startHere = false } = {}) {
  if (typeof startHere !== 'boolean') throw new TypeError('startHere must be boolean');
  const plan = createPlan(input);
  identifier(legId, 'leg id');
  const leg = plan.legs.find(item => item.id === legId);
  if (!leg) throw new RangeError('Leg not found');
  if (!['google', 'apple'].includes(provider)) throw new TypeError('Unknown map provider');
  if (!Object.hasOwn(MODES, leg.kind)) {
    return Object.freeze({ available: false, reason: 'not_a_ground_route', url: null, legId });
  }
  return Object.freeze({
    available: true, kind: 'external_directions', legId,
    url: directionsLink({ provider, origin: startHere ? null : leg.origin,
      destination: leg.destination, mode: MODES[leg.kind] }),
    routeGeometry: null, eta: null, price: null,
  });
}
