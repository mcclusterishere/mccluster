// Shared, side-effect-free handoff validation. Authorization and persistence
// MUST be performed by the authenticated control-plane endpoint, never here.
const MAX_LAYERS = 24;
const ID = /^[a-zA-Z0-9_-]{1,96}$/;
export function validateHaloContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('invalid context');
  const keys = Object.keys(input);
  if (keys.some(k => !['version','investigation_id','start','end','viewport','layers'].includes(k))) throw new TypeError('unexpected context field');
  if (input.version !== 1 || !ID.test(input.investigation_id || '')) throw new TypeError('invalid investigation');
  const start = Date.parse(input.start), end = Date.parse(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end-start > 366*86400000) throw new TypeError('invalid time window');
  if (new Date(start).toISOString() !== input.start || new Date(end).toISOString() !== input.end) throw new TypeError('noncanonical timestamp');
  const layers = input.layers ?? [];
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS || layers.some(x => typeof x !== 'string' || !ID.test(x))) throw new TypeError('invalid layers');
  let viewport = null;
  if (input.viewport != null) {
    const v = input.viewport;
    if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).some(k=>!['lat','lon','height'].includes(k))) throw new TypeError('invalid viewport');
    if (![v.lat,v.lon,v.height].every(Number.isFinite) || v.lat < -90 || v.lat > 90 || v.lon < -180 || v.lon > 180 || v.height < 1 || v.height > 50000000) throw new TypeError('invalid viewport');
    viewport = {lat:v.lat,lon:v.lon,height:v.height};
  }
  return Object.freeze({version:1,investigation_id:input.investigation_id,start:input.start,end:input.end,viewport,layers:Object.freeze([...new Set(layers)])});
}
