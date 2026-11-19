/* THE ACCOUNTS PLANE: a stand-in for the auth server, PostgREST, the music
   Edge function and the API Worker, for scripts/e2e/music-accounts.e2e.mjs.

   Everything is local. https://matthew.mccluster.org/* is served from the
   checkout on disk under its real origin (so the pages behave as they do on
   Matthew's property), the Supabase project and api.mccluster.org are
   answered below, and every other request is aborted and counted. Nothing
   reaches a live host.

   The answers follow production as the accounts lane read it on 2026-11-19
   (the music map, lane 04): a refused or expired bearer is a guest to the
   gate (GET answers 200 with the guest body), a 401 everywhere a session is
   required, and the gated record's rule SQL is not applied, so the gate says
   gate_not_ready to everyone but the house operator. Refresh tokens rotate
   the way the auth server rotates them: a used token answers the active
   descendant inside a short reuse window, refresh_token_already_used after
   it. Ported from the lane's probe stub (probes/accounts/lib.cjs). */
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export const HOUSE = 'https://matthew.mccluster.org';
export const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
export const API = 'https://api.mccluster.org';
export const ANON = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
export const SBKEY = 'sb-zmnhbrjyhxzhkxmhkexs-auth-token';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.vtt': 'text/vtt' };

const NOW = () => Math.floor(Date.now() / 1000);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Invented fixtures, no real member data. */
export const PEOPLE = {
  member: { uid: '00000000-0000-4000-8000-0000000000a1', muid: '10000000-0000-4000-8000-0000000000a1', label: 'fixture-listener', name: 'Fixture Listener', creator: false, owner: false },
  creator: { uid: '00000000-0000-4000-8000-0000000000a2', muid: '10000000-0000-4000-8000-0000000000a2', label: 'fixture-artist', name: 'Fixture Artist', creator: true, owner: false, handle: 'fixture-artist' },
  owner: { uid: '00000000-0000-4000-8000-0000000000a3', muid: '10000000-0000-4000-8000-0000000000a3', label: 'fixture-owner', name: 'Fixture Owner', creator: true, owner: true, handle: 'fixture-owner' }
};

/* A fixture JWT. Its signature segment is base64url of a real signature's length (supabase-js checks the shape),
   and its payload is padded until its base64url has no '-' or '_', so a client that decodes with plain atob() is not
   tripped here: that defect has its own test (scripts/test/music-accounts.test.mjs, ACC-9). */
function jwt(sub, label, exp, n) {
  const sig = Buffer.from('fixture-signature-' + label + '-' + n + '-' + exp).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').padEnd(43, 'A').slice(0, 43);
  let pad = '';
  for (let i = 0; i < 64; i++) {
    const p = b64u({ aud: 'authenticated', exp, sub, email: label, role: 'authenticated', session_id: sub.slice(0, 8) + '-0000-4000-8000-000000000000', user_metadata: { name: label }, n, pad });
    if (!/[-_]/.test(p)) return b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + p + '.' + sig;
    pad += 'x';
  }
  throw new Error('could not pad the fixture token');
}

export function makePlane(opts = {}) {
  const log = [];
  const tokens = {};       // access token -> { who, exp }
  const refresh = {};      // refresh token -> { who, state, child, revokedAt, family }
  const refused = new Set();
  const reuseMs = opts.reuseMs == null ? 10000 : opts.reuseMs;
  let refreshDelayMs = opts.refreshDelayMs || 0;
  let n = 0;

  function issue(who, life) {
    const exp = NOW() + (life == null ? 3600 : life);
    const at = jwt(PEOPLE[who].uid, PEOPLE[who].label, exp, ++n);
    tokens[at] = { who, exp };
    return { at, exp };
  }
  function newRefresh(who, family) {
    const rt = 'rt-' + who + '-' + (++n);
    refresh[rt] = { who, state: 'active', child: null, revokedAt: 0, family: family || rt };
    return rt;
  }
  function user(who) {
    const p = PEOPLE[who];
    return { id: p.uid, aud: 'authenticated', role: 'authenticated', email: p.label, user_metadata: { name: p.name }, app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] };
  }
  function session(who, life, rt) {
    const t = issue(who, life);
    return { access_token: t.at, refresh_token: rt || newRefresh(who), expires_in: Math.max(0, t.exp - NOW()), expires_at: t.exp, token_type: 'bearer', user: user(who) };
  }
  /* What a member's browser holds: the session as js/mcc-auth.js writes it (life < 0: stored long ago, expired). */
  function storedSession(who, life) {
    const t = issue(who, life);
    return { access_token: t.at, refresh_token: newRefresh(who), expires_at: t.exp, expires_in: Math.max(0, t.exp - NOW()), token_type: 'bearer', user: { id: PEOPLE[who].uid, email: PEOPLE[who].label } };
  }
  function bearerOf(req) {
    const h = req.headers();
    const m = /^bearer\s+(.+)$/i.exec(h.authorization || '');
    return m ? m[1] : '';
  }
  function classify(tok) {
    if (!tok) return 'none';
    if (tok === ANON) return 'anon';
    const t = tokens[tok];
    if (!t) return 'unknown';
    return (t.exp > NOW() && !refused.has(tok) ? 'fresh:' : 'expired:') + t.who;
  }
  function whoFresh(tok) { const c = classify(tok); return c.startsWith('fresh:') ? c.slice(6) : null; }
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });

  async function onSupabase(route, req, url) {
    const p = url.pathname, method = req.method(), tok = bearerOf(req);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/auth/v1/settings') return json(route, 200, { external: { google: false, apple: false, facebook: false, x: false, email: true } });
    if (p === '/auth/v1/user' && method === 'GET') {
      const w = whoFresh(tok);
      return w ? json(route, 200, user(w)) : json(route, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: token is expired' });
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      if (grant === 'password') {
        const who = Object.keys(PEOPLE).find((k) => PEOPLE[k].label === String(body.email || '').toLowerCase());
        return who ? json(route, 200, session(who)) : json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (grant === 'refresh_token') {
        if (refreshDelayMs) await new Promise((r) => setTimeout(r, refreshDelayMs));
        const rt = refresh[body.refresh_token];
        if (!rt || rt.state === 'family_revoked') return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        if (rt.state === 'active') {
          rt.state = 'revoked'; rt.revokedAt = Date.now();
          rt.child = newRefresh(rt.who, rt.family);
          return json(route, 200, session(rt.who, null, rt.child));
        }
        if (Date.now() - rt.revokedAt <= reuseMs) {
          let c = rt.child; while (refresh[c] && refresh[c].state === 'revoked' && refresh[c].child) c = refresh[c].child;
          return json(route, 200, session(rt.who, null, c));
        }
        return json(route, 400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' });
      }
      return json(route, 400, { error_code: 'unsupported_grant_type' });
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.slice('/rest/v1/rpc/'.length);
      if (name === 'm_touch_app') return json(route, 200, {});
      if (tok && tok !== ANON && !whoFresh(tok)) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const w = whoFresh(tok);
      if (name === 'm_my_uid' || name === 'current_m_uid') return json(route, 200, w ? PEOPLE[w].muid : null);
      if (name === 'music_creator_state') {
        if (!w) return json(route, 200, { ok: false, error: 'not_signed_in' });
        const pp = PEOPLE[w];
        return json(route, 200, pp.creator
          ? { ok: true, creator: true, created: false, profile: { handle: pp.handle, artist_name: pp.name, status: 'active', verification_state: 'unverified', avatar_url: '', banner_url: '' }, missing: [], problems: {} }
          : { ok: true, creator: false, created: false, missing: [], problems: {}, prefill: { artist_name: pp.name, handle: pp.label, has_bio: false, has_website: false, avatar_url: null } });
      }
      return json(route, 200, null);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      if (tok && tok !== ANON && !whoFresh(tok)) return json(route, 401, { code: 'PGRST301', message: 'JWT expired' });
      const w = whoFresh(tok);
      if (method !== 'GET' && method !== 'HEAD') {
        if (/return=representation/.test(req.headers().prefer || '')) {
          let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
          return json(route, 200, [Object.assign({ m_uid: w ? PEOPLE[w].muid : null, settings: {}, updated_at: new Date().toISOString() }, body)]);
        }
        return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
      }
      if (table === 'music_creator_profiles') {
        const handle = (url.searchParams.get('handle') || '').replace(/^eq\./, '');
        const muid = (url.searchParams.get('m_uid') || '').replace(/^eq\./, '');
        const all = !handle && !muid;
        const rows = Object.keys(PEOPLE).filter((k) => PEOPLE[k].creator && (all || PEOPLE[k].handle === handle || PEOPLE[k].muid === muid)).map((k) => {
          const pp = PEOPLE[k];
          return { m_uid: pp.muid, handle: pp.handle, artist_name: pp.name, bio: 'Fixture biography.', avatar_url: '', banner_url: '', website_url: '', verification_state: 'unverified', status: 'active', payout_state: 'not_started', settings: {}, updated_at: new Date().toISOString() };
        });
        return json(route, 200, rows);
      }
      if (table === 'creator_tracks') return json(route, 200, opts.creatorTracks || []);
      if (table === 'network_profiles') return json(route, 200, w ? [{ display_name: PEOPLE[w].name, headline: '', bio: '', website_url: '', avatar_url: '', banner_url: '', visibility: 'public' }] : []);
      return json(route, 200, []);
    }
    if (p.startsWith('/functions/v1/')) {
      const fn = p.slice('/functions/v1/'.length);
      if (fn === 'music-direct-checkout') return json(route, 200, { offers: [] });
      if (fn === 'music-access') {
        if (!whoFresh(tok)) return json(route, 401, { code: 401, message: 'Invalid JWT' });
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
        if (body.action === 'stream') return json(route, 200, { url: HOUSE + '/assets/audio/here.mp3', expires_in: 3600 });
        return json(route, 200, {});
      }
      return json(route, 200, {});
    }
    if (p.startsWith('/storage/')) return route.fulfill({ status: 404, body: '' });
    return json(route, 404, { error: 'plane: no such supabase path' });
  }

  async function onApi(route, req, url) {
    const p = url.pathname.replace(/\/+$/, ''), method = req.method(), tok = bearerOf(req);
    const w = whoFresh(tok);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/v1/status') return w && PEOPLE[w].owner ? json(route, 200, { ok: true, owner: true }) : json(route, 403, { error: 'house owner only' });
    if (p === '/v1/music/gates/niggy-nigg' && method === 'GET') {
      if (w && PEOPLE[w].owner) return json(route, 200, { ok: true, gate: { allowed: true, operator: true } });
      return json(route, 200, { ok: true, gate: { mode: 'rule', rule: 'gated_track_niggy_nigg', track: 'niggy-nigg', allowed: false, claimed: false, preview_only: true, reason: 'gate_not_ready', missing: ['gate_not_ready'] } });
    }
    if (/^\/v1\/music\/gates\/[a-z0-9-]+\/play$/.test(p)) {
      if (!w) return json(route, 401, { error: 'Sign in to count your listens' });
      return json(route, 403, { error: 'Locked', locked: true, gate: { mode: 'rule', allowed: false, reason: 'gate_not_ready', missing: ['gate_not_ready'] } });
    }
    if (p === '/v1/music/listens' && method === 'POST') return w ? json(route, 200, { ok: true, listen_id: '20000000-0000-4000-8000-0000000000' + String(++n).padStart(2, '0').slice(-2), counts: true, min_seconds: 100 }) : json(route, 401, { error: 'Sign in to count your listens' });
    if (/^\/v1\/music\/listens\/[^/]+\/(beat|finish)$/.test(p)) return w ? json(route, 200, { ok: true, counted: true, heard_seconds: 15 }) : json(route, 401, { error: 'Sign in to count your listens' });
    if (p === '/v1/mnet/bootstrap') return w ? json(route, 200, { next_step: 'done', identity: { mccluster_id: PEOPLE[w].label }, profile: { display_name: PEOPLE[w].name } }) : json(route, 401, { error: 'sign in' });
    if (p.startsWith('/v1/analytics/my-')) return w ? json(route, 200, { ok: true, totals: {}, tracks: [] }) : json(route, 401, { error: 'sign in' });
    if (p.startsWith('/v1/creator-billing/entitlement')) return w ? json(route, 200, { paid: false, workspaces: [] }) : json(route, 401, { error: 'Sign in required' });
    if (p === '/v1/collect' || p.startsWith('/v1/analytics')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    return json(route, 404, { error: 'plane: no such api path' });
  }

  async function serveFile(route, root, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel === '/__blank') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' });
    const file = normalize(join(root, rel));
    if (!file.startsWith(normalize(root + sep))) return route.fulfill({ status: 403, body: '' });
    let body;
    try { body = await readFile(file); } catch (e) { return route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }); }
    return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] || 'application/octet-stream', body });
  }

  const blocked = {};
  async function install(context, root) {
    await context.route('**/*', async (route) => {
      const req = route.request();
      let url;
      try { url = new URL(req.url()); } catch (e) { return route.abort(); }
      const entry = { t: Date.now(), method: req.method(), origin: url.origin, path: url.pathname, auth: classify(bearerOf(req)) };
      try { entry.page = new URL(req.frame().url()).pathname; } catch (e) {}
      if (url.pathname === '/auth/v1/token') { try { const b = JSON.parse(req.postData() || '{}'); entry.grant = url.searchParams.get('grant_type'); entry.rt = b.refresh_token || null; } catch (e) {} }
      if (url.pathname === '/functions/v1/music-access') { try { entry.action = JSON.parse(req.postData() || '{}').action; } catch (e) {} }
      try {
        if (url.origin === HOUSE) return await serveFile(route, root, url);
        if (url.origin === SB) { log.push(entry); return await onSupabase(route, req, url); }
        if (url.origin === API) { log.push(entry); return await onApi(route, req, url); }
        if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
        blocked[url.host] = (blocked[url.host] || 0) + 1;
        return route.abort();
      } catch (e) {
        try { return await route.abort(); } catch (_) {}
      }
    });
  }

  return {
    log, tokens, refresh, blocked, install, session, storedSession, issue, classify, user,
    /* the server's clock moves on: every token issued so far for this person is now expired there */
    expireAll(who) { for (const [at, t] of Object.entries(tokens)) if (t.who === who) refused.add(at); },
    setRefreshDelay(ms) { refreshDelayMs = ms; }
  };
}
