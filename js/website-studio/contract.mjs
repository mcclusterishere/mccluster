/** Website Studio v1: data contract, NOT account or publishing authorization.
 * Shared by editor and server. References resolve through canonical services;
 * URLs, credentials, public visibility and commerce prices are never inferred.
 */
export const SCHEMA = 'website-studio/v1';
const KINDS = ['music', 'native_video', 'immersive360'];
const own = (v) => v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function ensure(ok, message) { if (!ok) throw new TypeError(message); }
function shape(v, keys, label) {
  ensure(own(v), `${label}: expected object`);
  ensure(Object.keys(v).every(k => keys.includes(k)), `${label}: unsupported field`);
}
function text(v, max, label, required = false) {
  ensure(typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0)
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v), `${label}: invalid text`);
}
function key(v, label) {
  ensure(typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/.test(v), `${label}: invalid reference`);
}
function ref(v, types, label) {
  shape(v, ['type', 'key'], label);
  ensure(types.includes(v.type), `${label}: unsupported type`); key(v.key, label);
}
function point(v, label) {
  shape(v, ['x', 'y'], label);
  ensure([v.x, v.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1), `${label}: focal point out of range`);
}
function transition(v) {
  shape(v, ['asset_ref', 'in_ms', 'out_ms', 'pace', 'focal'], 'transition');
  ref(v.asset_ref, ['media_asset'], 'transition asset');
  ensure(Number.isSafeInteger(v.in_ms) && Number.isSafeInteger(v.out_ms)
    && v.in_ms >= 0 && v.out_ms <= 600000
    && v.out_ms - v.in_ms >= 1000 && v.out_ms - v.in_ms <= 12000,
  'transition: choose a 1–12 second segment within the first ten minutes');
  ensure(['quick', 'standard', 'cinematic'].includes(v.pace), 'transition: invalid pace');
  shape(v.focal, ['desktop', 'mobile'], 'focal');
  point(v.focal.desktop, 'desktop crop'); point(v.focal.mobile, 'phone crop');
}
export function assertDocument(v) {
  shape(v, ['schema_version', 'template_key', 'template_version', 'title', 'mode', 'tiles'], 'website');
  ensure(v.schema_version === SCHEMA && v.template_key === 'motion-portfolio'
    && v.template_version === 1, 'website: unsupported template version');
  text(v.title, 120, 'title', true);
  ensure(['standard', 'cinematic'].includes(v.mode), 'website: invalid mode');
  ensure(Array.isArray(v.tiles) && v.tiles.length === 3, 'website: exactly three tiles required');
  const ids = new Set(); let immersive = 0;
  for (const t of v.tiles) {
    shape(t, ['id', 'kind', 'headline', 'body', 'source_ref', 'transition', 'playback', 'action'], 'tile');
    key(t.id, 'tile ID'); ensure(!ids.has(t.id), 'tile: duplicate ID'); ids.add(t.id);
    ensure(KINDS.includes(t.kind), 'tile: unsupported content kind');
    text(t.headline, 120, 'headline'); text(t.body, 2000, 'body');
    ensure(['manual', 'enter_after_consent'].includes(t.playback), 'tile: unsupported playback intent');
    if (t.kind === 'immersive360') {
      immersive++; ensure(t.playback === 'manual', '360: explicit entry required');
    }
    const types = t.kind === 'music' ? ['music_recording', 'media_asset']
      : t.kind === 'native_video' ? ['network_post', 'media_asset'] : ['media_asset'];
    if (t.source_ref !== null) ref(t.source_ref, types, 'content');
    if (t.transition !== null) transition(t.transition);
    if (t.action !== null) {
      shape(t.action, ['kind', 'label', 'url', 'offer_ref'], 'action');
      text(t.action.label, 60, 'action label', true);
      if (t.action.kind === 'link') {
        ensure(!('offer_ref' in t.action), 'link: purchase reference is not allowed');
        text(t.action.url, 2048, 'action URL', true);
        let u; try { u = new URL(t.action.url); } catch { throw new TypeError('action: invalid URL'); }
        ensure(u.protocol === 'https:' && !u.username && !u.password, 'action: HTTPS without credentials required');
      } else {
        ensure(t.action.kind === 'purchase' && t.kind === 'music' && !('url' in t.action), 'action: invalid purchase');
        ref(t.action.offer_ref, ['commerce_offer'], 'purchase offer');
      }
    }
  }
  ensure(immersive <= 1, 'website: at most one 360 tile');
  ensure(new TextEncoder().encode(JSON.stringify(v)).byteLength <= 32768, 'website: document too large');
  return v;
}
/** The same ordered plan must feed preview and public rendering. Three content
 * tiles remain stable; up to three optional transition slots are separate.
 * The host still resolves authorized media before displaying anything.
 */
export function renderPlan(document, { reducedMotion = false } = {}) {
  assertDocument(document);
  return document.tiles.flatMap(tile => {
    const content = { segment: 'content', tile_id: tile.id, tile: structuredClone(tile) };
    return document.mode === 'cinematic' && !reducedMotion && tile.transition
      ? [{ segment: 'transition', tile_id: tile.id, transition: structuredClone(tile.transition) }, content]
      : [content];
  });
}
export function resourceBindings(document, { activeOnly = false } = {}) {
  assertDocument(document); const out = [];
  for (const t of document.tiles) {
    if (t.source_ref) out.push({ tile_id: t.id, role: 'content', kind: t.kind, ref: t.source_ref });
    if (t.transition && (!activeOnly || document.mode === 'cinematic')) out.push({ tile_id: t.id, role: 'transition', kind: 'video', ref: t.transition.asset_ref,
      in_ms: t.transition.in_ms, out_ms: t.transition.out_ms });
    if (t.action?.kind === 'purchase') out.push({ tile_id: t.id, role: 'offer', kind: 'commerce_offer',
      ref: t.action.offer_ref, recording_ref: t.source_ref });
  }
  return structuredClone(out);
}
/** SERVER ONLY. authorize must be a trusted closure bound to the verified M
 * Account/workspace, not a client callback. It must check ownership/grants,
 * actual media type, removed/private posts, duration/projection, offer-recording
 * association, rights, quotas and publication eligibility. No route calls this
 * yet. This function neither publishes nor awards rights/entitlement.
 */
export async function checkPublicationReadiness(document, authorize) {
  assertDocument(document); ensure(typeof authorize === 'function', 'authorization adapter required');
  ensure(document.tiles.every(t => t.source_ref), 'all content tiles need a source');
  for (const binding of resourceBindings(document, { activeOnly: true })) {
    const result = await authorize(binding, { purpose: 'publish' });
    ensure(result?.allowed === true && result.ready === true && result.publicApproved === true
      && result.removed !== true, 'resource unavailable for publication');
  }
  return { ready: true, schema_version: SCHEMA };
}
/** Processing identity excludes words, tile order and view-mode switches. It
 * stays tenant-scoped, so deduplication never grants cross-tenant media access.
 * Hash this string at the trusted job service; never treat it as a signed URL.
 */
export function processingIdentity({ tenant_key, source_sha256, in_ms, out_ms, width, height,
  sample_fps, focal_x, focal_y, processor_version }) {
  key(tenant_key, 'tenant'); key(processor_version, 'processor');
  ensure(/^[a-f0-9]{64}$/.test(source_sha256), 'verified source SHA-256 required');
  ensure([in_ms, out_ms, width, height, sample_fps].every(Number.isSafeInteger)
    && in_ms >= 0 && out_ms <= 600000 && out_ms - in_ms >= 1000 && out_ms - in_ms <= 12000
    && width >= 10 && width <= 2000 && height >= 10 && height <= 2000
    && sample_fps >= 1 && sample_fps <= 30, 'invalid preparation settings');
  point({ x: focal_x, y: focal_y }, 'preparation crop');
  return JSON.stringify(['studio-preparation/v1', tenant_key, source_sha256, in_ms, out_ms,
    width, height, sample_fps, focal_x, focal_y, processor_version]);
}
