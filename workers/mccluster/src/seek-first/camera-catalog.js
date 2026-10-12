// Audited catalog metadata only. Never scrape camera frames or infer private feeds.
const COLUMN_ALIASES = Object.freeze({
  id: ['camera id','camera_id','cameraid','id'],
  name: ['camera name','camera_name','name','location name','description'],
  lat: ['latitude','lat','y'],
  lon: ['longitude','lon','lng','x'],
  url: ['camera url','camera_url','url','website','web link'],
  location: ['location','point','geometry']
});
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function columns(meta) {
  const fields = meta?.view?.columns || [];
  const out = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    out[key] = fields.findIndex(c => aliases.some(a => norm(c.fieldName || c.name) === norm(a)));
  }
  return out;
}
function coords(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return coords(JSON.parse(value)); } catch { return null; }
  }
  if (value.type === 'Point' && Array.isArray(value.coordinates)) return { lon: Number(value.coordinates[0]), lat: Number(value.coordinates[1]) };
  if (Array.isArray(value.coordinates)) return { lon: Number(value.coordinates[0]), lat: Number(value.coordinates[1]) };
  if (value.latitude != null && value.longitude != null) return { lat: Number(value.latitude), lon: Number(value.longitude) };
  return null;
}
export function normalizeAustinCameraCatalog(payload, { bbox = null, limit = 250 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid camera limit');
  if (bbox && (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(x => !Number.isFinite(x)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) throw new RangeError('Invalid camera bbox');
  const index = columns(payload?.meta);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set(), records = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const get = key => index[key] >= 0 ? row[index[key]] : null;
    const rawLat = get('lat'), rawLon = get('lon');
    const p = coords(get('location')) || { lat: rawLat == null || rawLat === '' ? NaN : Number(rawLat), lon: rawLon == null || rawLon === '' ? NaN : Number(rawLon) };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || (p.lat === 0 && p.lon === 0)) continue;
    if (bbox && (p.lon < bbox[0] || p.lon > bbox[2] || p.lat < bbox[1] || p.lat > bbox[3])) continue;
    const id = String(get('id') || row[0] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rawUrl = String(get('url') || '');
    let catalogUrl = null;
    try { const u = new URL(rawUrl); if (u.protocol === 'https:') catalogUrl = u.toString(); } catch {}
    records.push({
      kind: 'entity', external_id: 'austin:cctv:' + id,
      entity_type: 'public_traffic_camera', name: String(get('name') || 'Austin traffic camera').slice(0, 180),
      point: p, source_url: catalogUrl || 'https://data.austintexas.gov/d/b4k4-adkb',
      properties: { operator: 'City of Austin', feed_status: 'unverified', stream_url: null, catalog_url: catalogUrl, source_class: 'public_catalog', frame_reuse_authorized: false }
    });
    if (records.length >= limit) break;
  }
  return records;
}

/**
 * Provider-neutral normalization for explicitly authorized public catalog rows.
 * This is catalog metadata, never an invitation to fetch private video endpoints.
 */
export function normalizeCameraProviders(providers, { bbox = null, limit = 500 } = {}) {
  if (!Array.isArray(providers) || !Number.isInteger(limit) || limit < 1 || limit > 2000) throw new RangeError('Invalid registry request');
  if (bbox && (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(x => !Number.isFinite(x)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) throw new RangeError('Invalid camera bbox');
  const seen = new Set(), output = [];
  for (const provider of providers) {
    if (!provider || !provider.id || !provider.operator || !Array.isArray(provider.cameras)) continue;
    for (const camera of provider.cameras) {
      if (!camera || !camera.id || camera.lat == null || camera.lon == null || camera.lat === '' || camera.lon === '') continue;
      const lat = Number(camera.lat), lon = Number(camera.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
      if (bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3])) continue;
      const id = String(provider.id).slice(0, 80) + ':' + String(camera.id).slice(0, 120);
      if (seen.has(id)) continue;
      seen.add(id);
      let sourceUrl = null;
      try {
        const url = new URL(String(camera.source_url || provider.source_url || ''));
        if (url.protocol === 'https:') sourceUrl = url.toString();
      } catch {}
      output.push({
        kind: 'entity', external_id: id, entity_type: 'public_traffic_camera',
        name: String(camera.name || 'Public traffic camera').slice(0, 180),
        point: { lat, lon }, source_url: sourceUrl,
        properties: {
          operator: String(provider.operator).slice(0, 120),
          jurisdiction: String(provider.jurisdiction || '').slice(0, 120),
          feed_status: 'unverified', stream_url: null,
          catalog_url: sourceUrl, frame_reuse_authorized: false
        }
      });
      if (output.length >= limit) return output;
    }
  }
  return output;
}

export function cameraCoverage(records, cellDegrees = 1) {
  if (!Array.isArray(records) || !Number.isFinite(cellDegrees) || cellDegrees <= 0 || cellDegrees > 20) throw new RangeError('Invalid coverage');
  const cells = new Map();
  for (const record of records) {
    const p = record?.point;
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const lat = Math.floor(p.lat / cellDegrees) * cellDegrees;
    const lon = Math.floor(p.lon / cellDegrees) * cellDegrees;
    const key = lat + ',' + lon;
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  return [...cells.entries()].map(([key, count]) => {
    const [lat, lon] = key.split(',').map(Number);
    return { lat, lon, count, cell_degrees: cellDegrees };
  }).sort((a, b) => b.count - a.count);
}
