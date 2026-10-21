/* Metadata only. A catalog status is not a frame/stream health check. */
export function normalizeAustinCameras(payload, limit = 100) {
  const columns = payload?.meta?.view?.columns;
  if (!Array.isArray(columns) || !Array.isArray(payload?.data)) return [];
  const names = columns.map(c => String(c.fieldName || c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const out = [], seen = new Set();
  const number = value => value == null || String(value).trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  for (const values of payload.data) {
    if (!Array.isArray(values)) continue;
    const row = Object.fromEntries(names.map((name, i) => [name, values[i]]));
    const id = String(row.camera_id ?? row.cameraid ?? row.cam_id ?? row.device_id ?? '').trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    let lat = number(row.latitude ?? row.lat ?? row.camera_latitude), lon = number(row.longitude ?? row.lon ?? row.camera_longitude);
    for (const value of [row.location, row.coordinates, row.the_geom, row.point, row.geocoded_column]) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        lat = number(value.latitude ?? value.lat); lon = number(value.longitude ?? value.lon);
      } else if (typeof value === 'string') {
        const m = value.match(/^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i);
        if (m) { lon = number(m[1]); lat = number(m[2]); }
      }
      if (lat !== null && lon !== null) break;
    }
    const valid = lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    out.push({kind:'entity',entity_type:'traffic_camera',external_id:id,
      name:String(row.camera_name || row.location_name || row.intersection_name || row.description || row.name || `Austin camera ${id}`).slice(0,300),
      point:valid ? {lat,lon} : null,observed_at:null,
      properties:{provider:'Austin Transportation & Public Works',catalog_status:String(row.camera_status || 'unknown'),stream_health:'not_checked'},
      source_url:'https://data.austintexas.gov/d/b4k4-adkb'});
    if(out.length >= Math.min(500,Math.max(1,Number(limit)||100))) break;
  }
  return out;
}
