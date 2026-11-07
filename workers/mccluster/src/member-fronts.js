/* EVERY ACCOUNT'S FRONT PAGE (owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this
   exact same experience ... my front page with a VR, with the scroll dependent video, all this").

   One page per account, front.html?u=<handle>, run by the same scroll engine as the house's front page (js/main.js), with
   the account's own words and media. The settings are the house page's own JSON shape (packages/front-config), stored in
   public.member_fronts (supabase/pending/member_fronts_v1.sql) through these routes only:

     GET    /v1/fronts/:handle        anyone: the published page of that account (never a draft, never a removed one)
     GET    /v1/fronts/me             the signed-in account: its draft, what is published, and its media folder
     POST   /v1/fronts/me             the signed-in account: save the draft ({config}); {publish:true} also publishes it
     DELETE /v1/fronts/me/published   the signed-in account: take its page down (the draft stays)
     POST   /v1/fronts/:handle/takedown   the house owner only: remove a page ({reason}); the account cannot republish it

   An account's media must sit in its own folder of the public front-media bucket (its auth uid), so a page can never
   show another account's uploads or a file from anywhere else. Nothing here reads or writes the media itself: the
   account's browser uploads to its folder with its own session (the bucket's policies), and cuts its films into frames
   before they leave the device. */
import { reply, fail } from './lib/http.js';
import { validateFront, mediaPrefix, FRONT_MAX_BYTES } from '../../../packages/front-config/index.mjs';
import { isHouseOwner } from './world-access.js';
import {siteModuleProjection} from './customer-site-modules.js';

export const FRONTS_PREFIX = '/v1/fronts';
const HANDLE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

function headers(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json', 'content-type': 'application/json', ...extra };
}
async function service(env, path, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: headers(env, init.headers || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  /* before supabase/pending/member_fronts_v1.sql is applied the table is not there: front pages are simply not on yet */
  if (!res.ok && data && (data.code === 'PGRST205' || data.code === '42P01')) throw Object.assign(new Error('Front pages are not switched on yet'), { status: 503 });
  if (!res.ok) throw Object.assign(new Error((data && (data.message || data.error)) || 'Database request failed'), { status: res.status >= 500 ? 503 : res.status });
  return data;
}
async function sessionUser(request, env, fetchImpl) {
  const h = request.headers.get('authorization') || '';
  if (!/^bearer\s+\S+/i.test(h)) return null;
  const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: h } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && /^[0-9a-f-]{36}$/i.test(String(u.id || '')) ? u : null;
}
/* the account behind a session: its m_uid, its handle (platform_profiles.mccluster_id) and its public name */
async function account(env, user, fetchImpl) {
  const [links, profiles] = await Promise.all([
    service(env, `m_auth_user_links?auth_user_id=eq.${user.id}&is_primary=eq.true&select=m_uid&limit=1`, {}, fetchImpl),
    service(env, `platform_profiles?user_id=eq.${user.id}&select=mccluster_id,display_name,avatar_url&limit=1`, {}, fetchImpl)
  ]);
  const m_uid = links && links[0] && links[0].m_uid, p = (profiles && profiles[0]) || {};
  const handle = String(p.mccluster_id || '').toLowerCase();
  return { m_uid: m_uid || null, handle: HANDLE.test(handle) ? handle : null, name: p.display_name || '', avatar: p.avatar_url || '' };
}
function send(request, env, body, status = 200, cache = 'private, no-store') {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', cache);
  res.headers.set('vary', 'origin, authorization');
  return res;
}
function refuse(request, env, message, status, detail) {
  const res = fail(request, env, message, status, detail);
  res.headers.set('cache-control', 'private, no-store');
  return res;
}

export async function handleMemberFronts(request, env, { fetchImpl = fetch, expectedAuthUserId = null } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== FRONTS_PREFIX && !path.startsWith(FRONTS_PREFIX + '/')) return null;
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return refuse(request, env, 'Front pages are not configured', 503);
  const rest = path.slice(FRONTS_PREFIX.length + 1);

  /* ---------- the signed-in account's own page ---------- */
  if (rest === 'me' || rest === 'me/published') {
    const user = await sessionUser(request, env, fetchImpl);
    if (!user) return refuse(request, env, 'Sign in to build your front page', 401);
    const acct = await account(env, user, fetchImpl);
    if (!acct.m_uid || !acct.handle) return refuse(request, env, 'Finish your account first: your front page lives at your handle', 409, { code: 'handle_required' });
    const prefix = mediaPrefix(env.SUPABASE_URL, user.id);
    const rows = await service(env, `member_fronts?m_uid=eq.${acct.m_uid}&select=draft,published,published_at,updated_at,removed_at,handle&limit=1`, {}, fetchImpl);
    const row = (rows && rows[0]) || null;
    // Publishing must not claim success for a page the public read route hides.
    // Never change the member's profile visibility as a side effect of publishing.
    const profiles = await service(env, `network_profiles?m_uid=eq.${acct.m_uid}&select=visibility&limit=1`, {}, fetchImpl);
    const profile = profiles && profiles[0];
    const publishBlocker = row?.removed_at ? 'removed' : !profile ? 'profile_required' : profile.visibility !== 'public' ? 'private_profile' : null;
    const availability = { profile_visibility: profile?.visibility || null, publish_blocker: publishBlocker,
      publicly_available: Boolean(row?.published && !publishBlocker) };

    if (rest === 'me' && request.method === 'GET') {
      return send(request, env, { ok: true, handle: acct.handle, name: acct.name, avatar: acct.avatar, media_prefix: prefix, max_bytes: FRONT_MAX_BYTES,
        draft: row ? row.draft : null, published: row ? row.published : null, published_at: row ? row.published_at : null,
        updated_at: row ? row.updated_at : null, removed: !!(row && row.removed_at), ...availability, url: `front.html?u=${encodeURIComponent(acct.handle)}` });
    }
    if (rest === 'me' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return refuse(request, env, 'The front page must be JSON', 400); }
      if (!body || typeof body !== 'object') return refuse(request, env, 'The front page must be JSON', 400);
      const checked = validateFront(body.config, { mediaPrefix: prefix, blockedMediaPrefixes: [prefix + "projects/"] });
      if (!checked.ok) return refuse(request, env, 'The front page is too large', 413, { size: checked.size, max: FRONT_MAX_BYTES });
      const publish = body.publish === true;
      if (publish && row && row.removed_at) return refuse(request, env, 'This front page was taken down by McCluster and cannot be published', 403, { code: 'removed' });
      if (publish && publishBlocker) return refuse(request, env,
        publishBlocker === 'private_profile' ? 'Your profile is private. Change its visibility before publishing your front page.' : 'Complete your profile before publishing your front page.',
        409, { code: publishBlocker, recovery_url: publishBlocker === 'private_profile' ? 'mccluster-creator-studio.html' : 'mnet.html?view=profile' });
      const now = new Date().toISOString();
      const fields = { m_uid: acct.m_uid, auth_user_id: user.id, handle: acct.handle, draft: checked.config, updated_at: now };
      if (publish) { fields.published = checked.config; fields.published_at = now; }
      await service(env, 'member_fronts?on_conflict=m_uid', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(fields) }, fetchImpl);
      return send(request, env, { ok: true, handle: acct.handle, draft: checked.config, published: publish ? checked.config : (row ? row.published : null),
        published_at: publish ? now : (row ? row.published_at : null), ...availability,
        publicly_available: !publishBlocker && (publish || Boolean(row?.published)),
        dropped: checked.dropped, url: `front.html?u=${encodeURIComponent(acct.handle)}` });
    }
    if (rest === 'me/published' && request.method === 'DELETE') {
      if (row) await service(env, `member_fronts?m_uid=eq.${acct.m_uid}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ published: null, published_at: null, updated_at: new Date().toISOString() }) }, fetchImpl);
      return send(request, env, { ok: true, published: null });
    }
    return refuse(request, env, 'Method not allowed', 405);
  }

  /* ---------- the house's takedown ---------- */
  const takedown = rest.match(/^([a-z0-9][a-z0-9._-]{2,39})\/takedown$/);
  if (takedown) {
    if (request.method !== 'POST') return refuse(request, env, 'Method not allowed', 405);
    const user = await sessionUser(request, env, fetchImpl);
    if (!user || !(await isHouseOwner(env, user.id, fetchImpl))) return refuse(request, env, 'McCluster house owner access required', 403);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    await service(env, `member_fronts?handle=eq.${takedown[1]}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ removed_at: new Date().toISOString(), removed_reason: reason || null, published: null, published_at: null }) }, fetchImpl);
    return send(request, env, { ok: true, handle: takedown[1], removed: true });
  }

  /* ---------- anyone: a published page ---------- */
  if (HANDLE.test(rest)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(request, env, 'Method not allowed', 405);
    const rows = await service(env, `member_fronts?handle=eq.${rest}${expectedAuthUserId ? `&auth_user_id=eq.${encodeURIComponent(expectedAuthUserId)}` : ""}&removed_at=is.null&published=not.is.null&select=m_uid,auth_user_id,handle,published,published_at&limit=1`, {}, fetchImpl);
    const row = rows && rows[0];
    if (!row || (expectedAuthUserId && row.auth_user_id !== expectedAuthUserId)) return refuse(request, env, 'No front page here yet', 404, { code: 'no_front' });
    /* a private profile has no public front page either */
    const prof = await service(env, `network_profiles?m_uid=eq.${row.m_uid}&select=display_name,avatar_url,headline,visibility&limit=1`, {}, fetchImpl);
    const p = (prof && prof[0]) || {};
    if (!prof?.length || p.visibility !== 'public') return refuse(request, env, 'No front page here yet', 404, { code: 'no_front' });
    /* checked again on the way out: a row can only ever show its own account's media */
    const checked = validateFront(row.published, { mediaPrefix: mediaPrefix(env.SUPABASE_URL, row.auth_user_id), blockedMediaPrefixes: [mediaPrefix(env.SUPABASE_URL, row.auth_user_id) + "projects/"] });
    if (!checked.ok) return refuse(request, env, 'No front page here yet', 404, { code: 'no_front' });
    return send(request, env, { ok: true, handle: row.handle, name: p.display_name || row.handle, avatar: p.avatar_url || '', headline: p.headline || '',
      config: checked.config, published_at: row.published_at, site_modules:await siteModuleProjection(env,row.auth_user_id,'front','me',fetchImpl) }, 200, env.CUSTOMER_SITE_OFFER_ENABLED==='true'?'private, no-store':'public, max-age=60');
  }
  return refuse(request, env, 'Not found', 404);
}
