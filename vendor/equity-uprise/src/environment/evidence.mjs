/* Public government evidence contract extracted from the existing implementation.
   All I/O and cache ownership are injected; this module never reads credentials. */
export function clip(v, max) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return s ? s.slice(0, max).trim() : null;
}
export const ENVIRONMENT_PATH = '/v1/world/environment';
export const ENVIRONMENT_TEAM = 'environmental-justice-team';
export const ENVIRONMENT_ACTIONS = Object.freeze([
  Object.freeze({ id: 'resource-check', title: 'Verify accessible local support', description: 'Check an official public relief, cooling, clean-air or shelter resource relevant to this event. Record its published hours, accessibility, eligibility and contact route, and flag gaps for review. Do this remotely; do not travel into the affected area.', proof: 'A dated official source link, the resource details you verified, and any unresolved accessibility gaps. No recipient names or private contact details.', safety: 'Follow emergency authorities. Never enter a hazard area, promise aid, or film anyone without informed consent. A listing is not confirmation of current capacity.' }),
  Object.freeze({ id: 'evidence-brief', title: 'Document an environmental access gap', description: 'Compare this official event report with a public local preparedness or response notice. Write a sourced brief identifying a specific gap in language access, disability access or public information and a practical correction for review.', proof: 'Two public source links with dates, a clear distinction between fact and interpretation, and one proposed correction. No allegations about individuals or private personal information.', safety: 'Work remotely from public records. Do not infer injustice from a hazard marker alone. Do not trespass, investigate victims, or publish unverified accusations.' })
]);
export const ENVIRONMENT_SOURCES = Object.freeze([
  { id: 'nws', label: 'NOAA NWS', url: 'https://www.weather.gov/', ttl: 120, rows: 'events', coverage: 'United States active alerts' },
  { id: 'eonet', label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/', ttl: 600, rows: 'events', coverage: 'Global open event reports in the last 30 days; not exhaustive' },
  { id: 'usgs', label: 'USGS', url: 'https://earthquake.usgs.gov/', ttl: 120, rows: 'quakes', coverage: 'Global earthquakes reported in the past day' },
  { id: 'nhc', label: 'NOAA NHC', url: 'https://www.nhc.noaa.gov/', ttl: 600, rows: 'cyclones', coverage: 'Atlantic, eastern and central Pacific; not global cyclone coverage' }
].map(Object.freeze));
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
function safeSourceUrl(value, fallback) {
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['api.weather.gov','www.weather.gov','eonet.gsfc.nasa.gov','earthquake.usgs.gov','www.nhc.noaa.gov'].includes(u.hostname)) return u.href; } catch {}
  return fallback;
}
/* A small display contract, not another interpretation of the provider feed.
 * Missing numbers stay missing. In particular, NHC classification is not an
 * inferred Saffir–Simpson category and a missing tsunami flag is not an all-clear. */
export function environmentFacts(source, row) {
  const facts = [];
  const text = (label, value, max = 120) => {
    const safe = typeof value === 'string' ? clip(value, max) : null;
    if (safe) facts.push({ label, value: safe });
  };
  const number = (label, value, unit = '') => {
    if (typeof value === 'number' && Number.isFinite(value)) facts.push({ label, value: `${value}${unit ? ' ' + unit : ''}` });
  };
  if (source === 'nws') {
    text('Severity', row.severity, 30);
    text('Certainty', row.certainty, 30);
    text('Urgency', row.urgency, 30);
    text('Area', row.area, 300);
  } else if (source === 'eonet') {
    number('Reported magnitude', row.magnitude, typeof row.unit === 'string' ? clip(row.unit, 60) || '' : '');
  } else if (source === 'usgs') {
    number('Magnitude', row.mag);
    number('Depth', row.depth_km, 'km');
    if (row.tsunami === true) facts.push({ label: 'USGS tsunami flag', value: 'Flagged by source; consult official warnings' });
  } else if (source === 'nhc') {
    number('Maximum sustained wind', row.intensity_kt, 'kt');
    text('Classification', row.classification, 4);
  }
  return facts;
}
export async function environmentFeed({ readSource, now = () => Date.now() }) {
  if (typeof readSource !== 'function' || typeof now !== 'function') throw new TypeError('An installation-owned public source adapter is required.');
  const samples = await Promise.all(ENVIRONMENT_SOURCES.map(async spec => {
    let body, stale;
    try { ({ body, stale } = await readSource(spec)); } catch { body = { unavailable:true, fetched_at:null }; stale=false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = { unavailable:true, fetched_at:null };
    return { spec, body, stale };
  }));
  // Evaluate after all asynchronous provider work, never against request-start
  // time that may already predate an alert's expiry.
  const currentTime=now();
  if(!Number.isFinite(currentTime))throw new TypeError('A valid clock is required.');
  const results=samples.map(({spec,body,stale})=>{
    const rows = Array.isArray(body[spec.rows]) ? body[spec.rows].filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
    const source = { id: spec.id, label: spec.label, url: spec.url, status: body.unavailable ? 'unavailable' : stale ? 'stale' : 'available', fetched_at: body.fetched_at, observed_at: iso(body.observed_at), coverage: body.coverage || spec.coverage, stale: !!stale };
    const events = rows.slice(0, 150).map(row => {
      const observed = iso(row.observed_at || row.time);
      const expires = iso(row.expires_at);
      const age = observed ? currentTime - Date.parse(observed) : NaN;
      const old = !Number.isFinite(age) || age < -60000 || age > (spec.id === 'eonet' ? 30 * 86400000 : 86400000);
      const actionable = !body.unavailable && !stale && !old && (!expires || Date.parse(expires) > currentTime);
      return { id: clip(`${spec.id}:${row.id}`, 300), title: clip(row.name || row.place, 180) || 'Environmental event',
        lat: row.lat ?? null, lon: row.lon ?? null, category: row.kind || (spec.id === 'usgs' ? 'quake' : 'cyclone'),
        location_kind: row.location_kind || 'reported_point', observed_at: observed, expires_at: expires,
        source: { id: spec.id, label: spec.label, url: safeSourceUrl(row.url || row.advisory_url, spec.url) },
        fetched_at: body.fetched_at, stale: !!body.unavailable || !!stale || old, description: clip(row.description, 2000) || '',
        facts: environmentFacts(spec.id, row),
        instructions: spec.id === 'nws' ? clip(row.instructions, 2000) || '' : '',
        actions: actionable ? ENVIRONMENT_ACTIONS : [],
        notice: 'A hazard report is not proof of environmental injustice. Follow local official instructions.' };
    });
    return { source, events, truncated: rows.length > 150 || body.truncated === true };
  });
  return { ok: true, schema: 'world-environment/v1', sources: results.map(r => r.source), events: results.flatMap(r => r.events), truncated: results.some(r => r.truncated) };
}
