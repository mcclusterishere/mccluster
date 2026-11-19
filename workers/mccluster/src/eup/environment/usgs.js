/* E=UP environmental event timeline, slice S3 (docs/control-plane/EUP-EVENT-TIMELINE.md): the USGS earthquake reader for
   the event store's ingest (./ingest.js). Pure: no network, no store, no clock. Its own normaliser, because the store needs
   what the public layers' first hop drops: `normalizeQuake` (../../world-halo-layers.js) keeps id, mag, place, time,
   coordinates, url, tsunami and alert, and the owner's Halo layer and the news pairing read it, so it stays untouched.

   SOURCE. U.S. Geological Survey, Earthquake Hazards Program: the real-time GeoJSON summary feeds
   (https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php, "updated every minute"; USGS asks automated apps to
   prefer them) and, for single events and the daily sweep, the FDSN event service
   (https://earthquake.usgs.gov/fdsnws/event/1/). Public domain (U.S. Government work); credit "U.S. Geological Survey".

   WHAT A USGS EVENT BECOMES (the shape the store's eup_environment_usgs_input checks, field by field;
   supabase/pending/20261119100000_eup_environment_events_v1_03.sql):
     provider_id        the preferred id (feature.id, which equals net + code); it may change over time
     aliases            every id USGS associates with the event (the `ids` list), the preferred id first, at most 50
     status             automatic | reviewed | deleted (a deletion carries only its id, aliases and USGS update time)
     observed_at        the origin time; source_updated_at: USGS `updated` (moves on DYFI, PAGER and other products too, so
                        the store keeps it and shows it but never makes a revision of it alone: decision D6)
     lon, lat, depth_km the hypocentre; magnitude and magnitude_type; place and title; source_url (the USGS event page)
     significance, alert (PAGER), tsunami, net, code
   Anything USGS sends outside these ranges is left out (a field) or the row is dropped and counted (no id, no status, no
   origin time, no position): the store would refuse it anyway, and a refused row is a count, never a guess. */

export const USGS_HOST = 'earthquake.usgs.gov';
export const USGS_FDSN = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
/* the summary feeds the ingest reads, by the lowest magnitude each carries (past day, origin time) */
export const USGS_FEEDS = Object.freeze({ '2.5_day': 2.5, '1.0_day': 1, all_day: null });
export const USGS_FEED_WINDOW_MS = 24 * 3600 * 1000;
export const USGS_MAX_ALIASES = 50;

/* the store's own id pattern (eup_environment_usgs_input): lower-case letters, digits and underscores */
const ID = /^[a-z0-9][a-z0-9_]{1,63}$/;
const EVENT_PAGE = /^https:\/\/earthquake[.]usgs[.]gov\/[A-Za-z0-9/_.?=&%-]*$/;
const MAG_TYPE = /^[a-z][a-z0-9_]{0,11}$/;
const NET = /^[a-z0-9]{1,10}$/;
const CODE = /^[a-z0-9_]{1,40}$/;
const ALERTS = new Set(['green', 'yellow', 'orange', 'red']);
const STATUSES = new Set(['automatic', 'reviewed', 'deleted']);
const CONTROL = /[\u0000-\u001f\u007f]/g;

export const usgsFeedUrl = (name) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${name}.geojson`;
export const usgsEventPage = (id) => `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
/* one event by any of its ids; jsonerror=true makes a deleted event (409) and an unknown id (404) a readable JSON answer */
export const usgsLookupUrl = (id) => `${USGS_FDSN}?eventid=${encodeURIComponent(id)}&format=geojson&jsonerror=true`;
/* the daily sweep: what USGS updated since `updatedAfter`, deletions included, origins since `startTime` */
export function usgsSweepUrl({ updatedAfter, startTime, minMagnitude = null, limit = 2000 }) {
  const url = new URL(USGS_FDSN);
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('updatedafter', isoSeconds(updatedAfter));
  url.searchParams.set('starttime', isoSeconds(startTime));
  url.searchParams.set('includedeleted', 'true');
  if (Number.isFinite(minMagnitude)) url.searchParams.set('minmagnitude', String(minMagnitude));
  url.searchParams.set('orderby', 'time');
  url.searchParams.set('limit', String(limit));
  return url.toString();
}
const isoSeconds = (t) => new Date(typeof t === 'number' ? t : Date.parse(t)).toISOString().slice(0, 19);

/* The feed that carries every event the owner's rule can publish: the M2.5+ day unless the rule's minimum magnitude
   is lower (then the M1.0+ day, or every magnitude below M1.0). Significance above 600, a PAGER alert and a tsunami flag
   are read only at or above the feed's floor: in the week lane 06 read, PAGER alerts began at M4.9, significance above
   600 at M5.3, and no event carried a tsunami flag. */
export function usgsFeedFor(rule) {
  const min = rule && typeof rule === 'object' ? Number(rule.min_magnitude) : NaN;
  if (!Number.isFinite(min) || min >= 2.5) return { name: '2.5_day', floor: 2.5 };
  if (min >= 1) return { name: '1.0_day', floor: 1 };
  return { name: 'all_day', floor: null };
}

/* ",a,b," -> ['a', 'b'], only ids the store accepts */
export function splitIds(ids) {
  if (typeof ids !== 'string') return [];
  return ids.split(',').map((s) => s.trim().toLowerCase()).filter((s) => ID.test(s));
}

const isoMs = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 8.0e12 ? new Date(Math.round(v)).toISOString() : null);
const within = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
function text(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max).trim() : null;
}
const lowerMatch = (v, re) => (typeof v === 'string' && re.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);

/* One USGS GeoJSON event (a summary-feed row or an FDSN answer, which carries the same properties plus `products`) to the
   store's input, or { ok: false, reason }. The values are the event's own properties, never a product's: an FDSN answer
   by id lists every origin (and, with includesuperseded, every superseded version of each), and the event's properties
   are the ones USGS prefers now. */
export function normalizeUsgsEvent(feature) {
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return { ok: false, reason: 'not_a_feature' };
  const p = feature.properties;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'no_properties' };
  const fromNetCode = typeof p.net === 'string' && typeof p.code === 'string' ? `${p.net}${p.code}` : '';
  const id = lowerMatch(typeof feature.id === 'string' && feature.id ? feature.id : fromNetCode, ID);
  if (!id) return { ok: false, reason: 'id' };
  const status = typeof p.status === 'string' ? p.status.trim().toLowerCase() : '';
  if (!STATUSES.has(status)) return { ok: false, reason: 'status' };
  const aliases = [id, ...splitIds(p.ids).filter((a) => a !== id)].filter((a, i, all) => all.indexOf(a) === i).slice(0, USGS_MAX_ALIASES);
  const sourceUpdatedAt = isoMs(p.updated);
  if (status === 'deleted') return { ok: true, event: { provider_id: id, aliases, status, source_updated_at: sourceUpdatedAt } };
  const observedAt = isoMs(p.time);
  if (!observedAt) return { ok: false, reason: 'observed_at' };
  const c = feature.geometry && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [];
  const lon = within(c[0], -180, 180), lat = within(c[1], -90, 90);
  if (lon === null || lat === null) return { ok: false, reason: 'coordinates' };
  const place = text(p.place, 200);
  /* a deleted or placeless record's title ends in a bare dash ("M 3.8 - "): keep the words, drop the dash */
  const title = text(typeof p.title === 'string' ? p.title.replace(/\s*-\s*$/, '') : null, 200);
  const url = typeof p.url === 'string' && p.url.length <= 300 && EVENT_PAGE.test(p.url) ? p.url : usgsEventPage(id);
  const sig = typeof p.sig === 'number' && Number.isInteger(p.sig) && p.sig >= 0 && p.sig <= 10000 ? p.sig : null;
  const alert = typeof p.alert === 'string' && ALERTS.has(p.alert.trim().toLowerCase()) ? p.alert.trim().toLowerCase() : null;
  return {
    ok: true,
    event: {
      provider_id: id, aliases, status, observed_at: observedAt, source_updated_at: sourceUpdatedAt,
      lon, lat, depth_km: within(c[2], -10, 800), magnitude: within(p.mag, -2, 10.5), magnitude_type: lowerMatch(p.magType, MAG_TYPE),
      place, title, source_url: url, significance: sig, alert,
      tsunami: p.tsunami === 1 || p.tsunami === true, net: lowerMatch(p.net, NET), code: lowerMatch(p.code, CODE)
    }
  };
}

/* A summary feed (or an FDSN search answer) to { generatedAt, events, dropped, total }. Throws on anything that is not a
   FeatureCollection: a shape USGS did not send is never read as "no events". */
export function parseUsgsCollection(body) {
  if (!body || typeof body !== 'object' || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
    throw Object.assign(new Error('USGS answer is not a FeatureCollection'), { code: 'invalid_data' });
  }
  const events = [];
  const refusals = {};
  for (const feature of body.features) {
    const r = normalizeUsgsEvent(feature);
    if (r.ok) events.push(r.event);
    else refusals[r.reason] = (refusals[r.reason] || 0) + 1;
  }
  const generatedAt = isoMs(body.metadata && body.metadata.generated);
  return { generatedAt, events, dropped: body.features.length - events.length, refusals, total: body.features.length };
}

/* An FDSN answer for one id, asked with jsonerror=true (or its plain status): the event (the preferred one, whichever of
   its ids was asked), a deletion (409: "The requested event has been deleted"), not found (404, or 204 "no data"), or
   invalid. */
export function readUsgsLookup(body, httpStatus = 200) {
  if (httpStatus === 409) return { kind: 'deleted' };
  if (httpStatus === 404 || httpStatus === 204) return { kind: 'not_found' };
  if (body && typeof body === 'object' && body.type === 'Feature' && body.properties && typeof body.properties === 'object') {
    const r = normalizeUsgsEvent(body);
    return r.ok ? { kind: r.event.status === 'deleted' ? 'deleted' : 'event', event: r.event } : { kind: 'invalid', reason: r.reason };
  }
  const status = body && typeof body === 'object' && body.metadata && typeof body.metadata === 'object' ? body.metadata.status : null;
  if (status === 409) return { kind: 'deleted' };
  if (status === 404 || status === 204) return { kind: 'not_found' };
  return { kind: 'invalid', reason: 'shape' };
}
