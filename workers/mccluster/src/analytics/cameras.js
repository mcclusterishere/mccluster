/* Owner Analytics reads the existing Halo bridge. No upstream URL or token is
   accepted from a browser. Catalog and verified image counts are independent. */
import { cleanSource, HALO_DEFAULT_BASE } from '../world-cctv.js';
import { Buffer } from 'node:buffer';

const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const CAMERA_CHECK_BATCH = 4;

async function boundedBody(response, max) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('Response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

async function haloRead(env, path, consume, fetchImpl) {
  if (!env.HALO_INTERNAL_TOKEN) throw Object.assign(new Error('Halo connection is not configured'), { status: 503, cameraCode: 'halo_not_configured' });
  const url = new URL(env.HALO_API_BASE || HALO_DEFAULT_BASE);
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('Invalid Halo connection'), {cameraCode:'halo_configuration_invalid',status:503});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetchImpl(url.origin + path, {
      redirect: 'manual', signal: controller.signal,
      headers: { 'x-halo-internal': env.HALO_INTERNAL_TOKEN, accept: path.includes('/frame/') ? 'image/*' : 'application/json' }
    });
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error('Halo request failed'), { status: 502, cameraCode: response.status===401||response.status===403?'halo_authorization_failed':'halo_upstream_unavailable' });
    }
    return await consume(response);
  } catch(error) { if(controller.signal.aborted)throw Object.assign(new Error('Halo timed out'),{status:504,cameraCode:'halo_timeout'});throw error; } finally { clearTimeout(timer); }
}

export function summarizeCatalog(data, now = new Date().toISOString()) {
  if (!Array.isArray(data?.sources)) throw new Error('Camera catalog missing');
  const seen = new Set(); const cameras = [];
  let duplicate = 0, invalid = 0;
  for (const raw of data.sources) {
    const item = cleanSource(raw);
    if (!item) { invalid++; continue; }
    if (seen.has(item.id)) { duplicate++; continue; }
    seen.add(item.id);
    cameras.push({ ...item, pack: String(raw.pack || raw.provider || 'Unknown').slice(0, 120),
      catalog_fetched_at: Number.isFinite(Date.parse(raw.catalogFetchedAt)) ? raw.catalogFetchedAt : null,
      stale: raw.stale === true });
  }
  const packs = new Map();
  for (const camera of cameras) {
    if (!packs.has(camera.pack)) packs.set(camera.pack, { name: camera.pack, cameras: 0, stale: 0 });
    const p = packs.get(camera.pack); p.cameras++; if (camera.stale) p.stale++;
  }
  for (const [name, raw] of Object.entries(data.packs || {})) {
    if (!packs.has(name)) packs.set(name, { name, cameras: 0, stale: 0 });
    Object.assign(packs.get(name), { status: ['ok', 'stale', 'failed', 'pending'].includes(raw.status) ? raw.status : 'unknown',
      fetched_at: Number.isFinite(Date.parse(raw.fetchedAt)) ? raw.fetchedAt : null });
  }
  return { ok: true, retrieved_at: now, catalog_count: cameras.length, stale_count: cameras.filter(c => c.stale).length,
    excluded: { invalid, duplicate }, packs: [...packs.values()], cameras, check_batch_size: CAMERA_CHECK_BATCH };
}

export async function loadCameraCatalog(env, fetchImpl = fetch) {
  const data = await haloRead(env, '/api/cctv/sources', async r => JSON.parse(new TextDecoder().decode(await boundedBody(r, MAX_JSON_BYTES))), fetchImpl);
  return summarizeCatalog(data);
}

/* Check a complete raster response, not a placeholder, HTML error, video link,
   Content-Type alone or a provider's declared "online" flag. The browser also
   decodes the returned preview before labeling it a verified image. */
export function rasterType(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && String.fromCharCode(...bytes.slice(-8,-4)) === 'IEND') return 'image/png';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

function base64(bytes) {
  // Native encoding avoids expanding every image byte into JS call arguments
  // and a second binary string, which exhausted CPU during sustained checks.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export async function checkCamera(env, id, fetchImpl = fetch) {
  const checked_at = new Date().toISOString();
  try {
    return await haloRead(env, '/api/cctv/frame/' + encodeURIComponent(id), async response => {
      if (response.headers.get('x-cctv-source') !== 'upstream-image') throw new Error('No upstream image');
      const bytes = await boundedBody(response, MAX_FRAME_BYTES), type = rasterType(bytes);
      if (!type || !String(response.headers.get('content-type')).startsWith(type)) throw new Error('Invalid image');
      return { id, checked_at, status: 'image_received', captured_at: response.headers.get('x-cctv-captured-at') || response.headers.get('last-modified') || null,
        image: 'data:' + type + ';base64,' + base64(bytes) };
    }, fetchImpl);
  } catch { return { id, checked_at, status: 'unavailable' }; }
}

export function createCameraRoutes({ requireOwner, json, fetchImpl = fetch }) {
  return async function route(request, env, user, url, path) {
    if (path !== '/v1/analytics/cameras' && path !== '/v1/analytics/cameras/check') return null;
    try {
      await requireOwner(env, user);
      if (path.endsWith('/check')) {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
        // Read at most 4 KiB, even for chunked requests.
        let input;
        try { input = JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096))); }
        catch { return json({ error: 'Invalid camera batch' }, 400); }
        if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > CAMERA_CHECK_BATCH ||
            input.ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:~-]{1,160}$/.test(id))) return json({ error: 'Invalid camera batch' }, 400);
        const ids = [...new Set(input.ids)];
        // Halo itself resolves IDs against its authoritative catalog; no browser URLs.
        const checks = [];
        for (let i = 0; i < ids.length; i += 2) checks.push(...await Promise.all(ids.slice(i,i+2).map(id => checkCamera(env,id,fetchImpl))));
        return json({ ok: true, checks });
      }
      if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
      return json(await loadCameraCatalog(env, fetchImpl));
    } catch (error) {
      const messages={halo_not_configured:'The Halo camera connection has not been configured. An operator must connect the existing Halo service before this catalog can be read.',halo_configuration_invalid:'The Halo service address is invalid. An operator must correct the existing connection settings.',halo_authorization_failed:'Halo rejected the camera connection. An operator must renew the existing service authorization.',halo_upstream_unavailable:'Halo could not supply the camera catalog. Retry when the camera service is available.',halo_timeout:'Halo took too long to return the camera catalog. Try again.'};
      const code=error.cameraCode||'camera_unavailable';
      return json({ok:false,error:error.status===401||error.status===403?error.message:messages[code]||'Camera measurement unavailable. Try again.',code,retryable:!['halo_not_configured','halo_configuration_invalid','halo_authorization_failed'].includes(code)},error.status||502);
    }
  };
}
