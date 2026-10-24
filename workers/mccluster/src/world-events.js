/* Real event adapters for Halo. Locations are reported points or alert areas,
   never an inferred storm centre. No credentials or provider URLs from clients. */
import { upstream } from './world-layers.js';
import { UpstreamError } from './lib/safe-fetch.js';

const text = (x, n = 180) => typeof x === 'string' ? x.slice(0, n) : '';
const point = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const iso = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
export async function boundedEventJson(response, limit = 8 * 1024 * 1024) {
  if (!response.body) throw new UpstreamError('upstream_invalid_json', 'Empty event response');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new UpstreamError('upstream_invalid_json', 'Event response exceeds size budget'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new UpstreamError('upstream_invalid_json', 'Invalid event JSON'); }
}
export function eventKind(value) {
  const s = String(value || '').toLowerCase();
  for (const [kind, re] of [['tornado', /tornado|waterspout/], ['cyclone', /hurricane|cyclone|typhoon|tropical/], ['quake', /earthquake/], ['volcano', /volcano/], ['flood', /flood|surge/], ['snow', /snow|winter|blizzard|freeze|cold|avalanche/], ['ice', /sea.?lake.?ice|iceberg|ice/], ['fire', /wildfire/], ['heat', /heat|drought|temperature/], ['dust', /dust|sand|haze|smoke|air.quality/], ['landslide', /landslide|debris/], ['storm', /thunder|lightning|severe.?storm/], ['wind', /wind|gale/], ['wave', /surf|marine|tsunami|wave/], ['rain', /rain/]]) if (re.test(s)) return kind;
  return 'alert';
}
export function eventGeometry(g) {
  if (g?.type === 'Point' && point(g.coordinates)) return { lon: g.coordinates[0], lat: g.coordinates[1], location_kind: 'reported_point', polygons: [] };
  const raw = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  const ringPoints = ring => {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point)) return [];
    const step = Math.max(1, Math.ceil(ring.length / 512)), out = ring.filter((_, i) => i % step === 0).map(p => p.slice(0, 2));
    if (out.length && (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])) out.push(out[0]);
    return out;
  };
  const polygons = (Array.isArray(raw) ? raw : []).slice(0, 32).flatMap(poly => {
    if (!Array.isArray(poly)) return [];
    const outer = ringPoints(poly[0]);
    // A valid hole cannot become an exterior if the exterior is malformed.
    if (outer.length < 4) return [];
    return [[outer, ...poly.slice(1, 24).map(ringPoints).filter(r => r.length >= 4)]];
  });
  // A boundary vertex is a truthful label anchor, not a claimed event position.
  const anchor = polygons[0]?.[0]?.[0];
  return { lon: anchor?.[0] ?? null, lat: anchor?.[1] ?? null, location_kind: anchor ? 'area_label' : 'unmapped', polygons };
}
export function normalizeAlert(f, now = Date.now()) {
  const p = f?.properties;
  if (!p || p.status !== 'Actual' || p.messageType === 'Cancel') return null;
  const ends = [iso(p.ends), iso(p.expires)].filter(Boolean).sort();
  const expires = ends[0], onset = iso(p.onset || p.effective);
  if (!expires || Date.parse(expires) <= now) return null;
  const event = text(p.event), id = text(p.id || f.id, 240);
  if (!id || !event) return null;
  return { id, name: text(p.headline) || event, event, kind: eventKind(event), provenance: 'warning', ...eventGeometry(f.geometry),
    area: text(p.areaDesc, 300), severity: text(p.severity, 30), certainty: text(p.certainty, 30), urgency: text(p.urgency, 30),
    observed_at: iso(p.sent), starts_at: onset, expires_at: expires, description: text(p.description, 3000), instructions: text(p.instruction, 2000),
    url: /^https:\/\/api\.weather\.gov\/alerts\//.test(id) ? id : '', source: 'NOAA NWS' };
}
export async function fetchWeather(_env, fetchImpl = fetch) {
  const data = await upstream('https://api.weather.gov/alerts/active?status=actual', { headers: { accept: 'application/geo+json' } }, fetchImpl, boundedEventJson);
  if (!Array.isArray(data?.features)) throw new UpstreamError('upstream_invalid_json', 'NWS answer has no feature collection');
  const events = data.features.map(f => normalizeAlert(f)).filter(Boolean).slice(0, 1500);
  return { events, count: events.length, mapped: events.filter(e => e.location_kind !== 'unmapped').length, coverage: 'U.S. NWS active alerts. Zone-only alerts remain in the list without a fabricated map location.', truncated: data.features.length > 1500 };
}
export function normalizeNatural(e) {
  if (!e?.id || e.closed) return null;
  const geometry = (Array.isArray(e.geometry) ? e.geometry : []).filter(g => iso(g.date)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!geometry) return null;
  const categories = (e.categories || []).map(c => text(c.title || c.id, 80)).filter(Boolean);
  const categoryKind = eventKind(categories.join(' ')), namedKind = eventKind(e.title);
  const kind = categoryKind === 'storm' && ['cyclone', 'tornado'].includes(namedKind) ? namedKind : categoryKind;
  return { id: text(e.id, 100), name: text(e.title), event: categories.join(' · '), kind, provenance: 'reported',
    ...eventGeometry(geometry), observed_at: iso(geometry.date), expires_at: null, description: text(e.description, 2000), source: 'NASA EONET',
    magnitude: Number.isFinite(geometry.magnitudeValue) ? geometry.magnitudeValue : null, unit: text(geometry.magnitudeUnit, 60),
    url: 'https://eonet.gsfc.nasa.gov/api/v3/events/' + encodeURIComponent(text(e.id, 100)) };
}
export async function fetchNatural(_env, fetchImpl = fetch) {
  const data = await upstream('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=500', {}, fetchImpl, boundedEventJson);
  if (!Array.isArray(data?.events)) throw new UpstreamError('upstream_invalid_json', 'EONET answer has no event collection');
  const events = data.events.map(normalizeNatural).filter(Boolean).slice(0, 500);
  return { events, count: events.length, mapped: events.filter(e => e.location_kind !== 'unmapped').length, coverage: 'NASA EONET open event reports in the last 30 days. Latest reported geometry; not a live measurement of event extent.', truncated: data.events.length >= 500 };
}
