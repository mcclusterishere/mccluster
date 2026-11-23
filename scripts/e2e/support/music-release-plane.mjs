/* THE RELEASE PLANE: what a release meets between a creator's Submit and its artist page, for
   scripts/e2e/music-creator-release.e2e.mjs (music slice M6, 2026-11-19).

   It sits on the accounts plane (scripts/e2e/support/music-accounts-plane.mjs): the same people, tokens, auth server
   and pages. This file answers only what a release needs and hands everything else back to it (route.fallback):

     PostgREST     creator_tracks, read, inserted, changed and deleted under the rules the applied SQL sets
                   (supabase/migrations/20260920041011_music_creator_platform_v1.sql row policies and
                   20261030001000_music_release_payment_integrity_v1.sql public.music_track_guard, proven against
                   PostgreSQL in supabase/tests/music_creator_releases.behaviour.sql): a creator sees and changes only
                   their own rows, sets status only to draft or pending_review, deletes only draft, rejected and
                   archived rows, and cannot delete a release whose audio the reviewer verified (the pinned version's
                   foreign key); a change to a reviewed release sends it back to review. The vault_* tables are not
                   there (404 PGRST205), as in production on 2026-11-19.
     Storage       signed uploads, public and signed reads (with ranges), removal.
     music-access  creator-upload-url, operator-dashboard, operator-review-prepare (the master's real SHA-256),
                   operator-review (the Edge function's own refusals, then public.music_operator_review's), stream.
     the collector POST /v1/collect and the Supabase fallback, every event kept with the page that sent it.
     Control Room  /v1/workspaces/me for the owner, and an empty answer for the rest of its desk.

   Every row, file and person is invented. Nothing reaches a live host. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { SB, API, PEOPLE } from './music-accounts-plane.mjs';

export const WORLD = 'https://mccluster.org';
const REVIEW_STATES = ['pending_review', 'approved', 'published', 'rejected'];
const PUBLIC_BUCKETS = ['creator-previews', 'creator-artwork'];
/* the API paths the accounts plane answers itself */
const BASE_API = [/^\/v1\/status$/, /^\/v1\/music\//, /^\/v1\/mnet\/bootstrap$/, /^\/v1\/analytics\/my-/, /^\/v1\/creator-billing\//];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

export function makeReleasePlane(base) {
  const tracks = new Map();     // id -> creator_tracks row
  const objects = new Map();    // "bucket/path" -> Buffer
  const grants = new Map();     // upload token -> { bucket, path, uid }
  const expected = new Map();   // file name -> the bytes the test hands the page
  const pinned = new Map();     // track id -> { version_id, sha256, size_bytes }
  const calls = [];             // every music-access call: { action, who, body, status }
  const events = [];            // every analytics event received: { name, page, origin, props }
  const collects = [];          // every collector request: { origin, page, count }
  const writes = [];            // every creator_tracks write: { method, who, query, body, status, rows }
  const dialogs = [];
  let tick = Date.parse('2026-11-19T12:00:00.000Z'), n = 0;
  /* updated_at as PostgreSQL sends it, a little later every write (microseconds and the +00:00 a URL must encode) */
  const stamp = () => { tick += 1000 + (++n); return new Date(tick).toISOString().replace('Z', String(n % 1000).padStart(3, '0') + '+00:00'); };

  const json = (route, status, body, headers) => route.fulfill({ status, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*' }, headers || {}), body: body === undefined ? '' : JSON.stringify(body) });
  const bearer = (req) => { const m = /^bearer\s+(.+)$/i.exec(req.headers().authorization || ''); return m ? m[1] : ''; };
  const whoOf = (req) => { const c = base.classify(bearer(req)); return c.startsWith('fresh:') ? c.slice(6) : null; };
  const body = (req) => { try { return JSON.parse(req.postData() || '{}'); } catch (_) { return {}; } };
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  const publicUrl = (bucket, path) => SB + '/storage/v1/object/public/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/');

  /* ---------- PostgREST filters, as the pages write them ---------- */
  function splitTop(s) {
    const out = []; let depth = 0, quote = false, cur = '';
    for (const ch of s) {
      if (ch === '"') quote = !quote;
      if (!quote && ch === '(') depth++;
      if (!quote && ch === ')') depth--;
      if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const unquote = (v) => v.replace(/^"(.*)"$/, '$1');
  function test(row, col, op, value) {
    const have = row[col] == null ? null : String(row[col]);
    if (op === 'eq') return have === value;
    if (op === 'neq') return have !== value;
    if (op === 'is') return value === 'null' ? have === null : have === value;
    if (op === 'in') return splitTop(value.replace(/^\((.*)\)$/, '$1')).map(unquote).includes(have);
    throw new Error('release plane: no filter ' + op);
  }
  function matches(row, params) {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      if (k === 'or') {
        const any = splitTop(v.replace(/^\((.*)\)$/, '$1')).some((c) => { const m = /^([a-z_]+)\.([a-z]+)\.(.*)$/.exec(c); return m && test(row, m[1], m[2], m[3]); });
        if (!any) return false;
        continue;
      }
      const m = /^([a-z]+)\.(.*)$/.exec(v);
      if (!m || !test(row, k, m[1], m[2])) return false;
    }
    return true;
  }
  function order(rows, params) {
    const o = params.get('order');
    if (o) {
      const [col, dir] = o.split(',')[0].split('.');
      rows.sort((a, b) => String(a[col] || '').localeCompare(String(b[col] || '')) * (dir === 'desc' ? -1 : 1));
    }
    const limit = Number(params.get('limit') || 0);
    return limit ? rows.slice(0, limit) : rows;
  }
  /* row security: the public sees published releases; a member also their own; the service role everything */
  const canSee = (row, who) => row.status === 'published' || (who && PEOPLE[who].muid === row.m_uid);
  const own = (row, who) => !!who && PEOPLE[who].muid === row.m_uid;
  const CONTENT = ['title', 'artist', 'description', 'genre', 'audio_url', 'poster_url', 'preview_path', 'master_path', 'access_mode', 'music_video_url', 'lyrics_url', 'experience'];

  /* public.music_track_guard, for a creator's own write */
  function guard(next, old, who) {
    const p = PEOPLE[who];
    next.uid = p.uid; next.m_uid = p.muid;
    if (!['draft', 'pending_review'].includes(next.status)) next.status = old ? old.status : 'draft';
    if (!['incomplete', 'attested'].includes(next.rights_status)) next.rights_status = old ? old.rights_status : 'incomplete';
    for (const k of ['moderation_note', 'published_at']) next[k] = old ? old[k] : (k === 'moderation_note' ? '' : null);
    for (const k of ['master_path', 'preview_path']) {
      const bucket = k === 'master_path' ? 'creator-masters' : 'creator-previews';
      if (next[k] && (!old || next[k] !== old[k]) && !(String(next[k]).startsWith(p.uid + '/') && objects.has(bucket + '/' + next[k]))) {
        const e = new Error('creator_asset_not_owned'); e.code = 'P0001'; throw e;
      }
    }
    if (old && ['approved', 'published'].includes(old.status) && CONTENT.some((k) => JSON.stringify(next[k]) !== JSON.stringify(old[k]))) {
      next.status = 'pending_review';
      if (old.rights_status === 'cleared') next.rights_status = 'review';
      next.published_at = null;
    }
    next.updated_at = stamp();
    return next;
  }

  async function onTracks(route, req, url) {
    const method = req.method(), who = whoOf(req), params = url.searchParams;
    const prefer = req.headers().prefer || '';
    const rep = /return=representation/.test(prefer);
    const log = { method, who, query: url.search, body: method === 'GET' ? null : body(req) };
    const answer = (status, rows) => { log.status = status; log.rows = rows ? rows.length : 0; if (method !== 'GET') writes.push(log); return rep || method === 'GET' ? json(route, status, rows || []) : route.fulfill({ status: status === 200 ? 204 : status, headers: { 'access-control-allow-origin': '*' }, body: '' }); };
    if (method === 'GET' || method === 'HEAD') {
      return answer(200, order([...tracks.values()].filter((r) => canSee(r, who) && matches(r, params)).map((r) => ({ ...r })), params));
    }
    if (!who) return json(route, 401, { code: '42501', message: 'permission denied for table creator_tracks' });
    try {
      if (method === 'POST') {
        const input = log.body;
        const row = guard({ id: randomUUID(), created_at: stamp(), status: 'draft', rights_status: 'incomplete', ...input }, null, who);
        tracks.set(row.id, row);
        return answer(201, [{ ...row }]);
      }
      const hit = [...tracks.values()].filter((r) => own(r, who) && matches(r, params));
      if (method === 'PATCH') {
        const out = hit.map((old) => { const next = guard({ ...old, ...log.body }, old, who); tracks.set(old.id, next); return { ...next }; });
        return answer(200, out);
      }
      if (method === 'DELETE') {
        const gone = hit.filter((r) => ['draft', 'rejected', 'archived'].includes(r.status));
        const held = gone.find((r) => pinned.has(r.id));
        if (held) {
          log.status = 409; writes.push(log);
          return json(route, 409, { code: '23503', details: 'Key is still referenced from table "music_asset_versions".', hint: null, message: 'update or delete on table "creator_tracks" violates foreign key constraint "music_asset_versions_track_id_fkey" on table "music_asset_versions"' });
        }
        gone.forEach((r) => tracks.delete(r.id));
        return answer(200, gone.map((r) => ({ ...r })));
      }
    } catch (e) {
      log.status = 400; writes.push(log);
      return json(route, 400, { code: e.code || 'P0001', details: null, hint: null, message: e.message });
    }
    return json(route, 405, { message: 'release plane: no such method' });
  }

  /* ---------- music-access ---------- */
  function reviewRow(t) {
    const pick = ['id', 'm_uid', 'title', 'artist', 'status', 'rights_status', 'access_mode', 'genre', 'music_video_url', 'lyrics_url', 'experience', 'created_at', 'updated_at', 'published_at', 'moderation_note'];
    return Object.fromEntries(pick.map((k) => [k, t[k] == null ? null : t[k]]));
  }
  async function onMusicAccess(route, req) {
    const who = whoOf(req), b = body(req), action = b.action;
    const say = (status, out) => { calls.push({ action, who, body: b, status, answer: out }); return json(route, status, out); };
    if (!['creator-upload-url', 'operator-dashboard', 'operator-review-prepare', 'operator-review', 'stream'].includes(action)) return route.fallback();
    if (!who) return say(401, { code: 401, message: 'Invalid JWT' });
    const p = PEOPLE[who];
    if (action === 'creator-upload-url') {
      if (!p.creator) return say(403, { error: 'active creator profile required' });
      if (!['creator-previews', 'creator-masters', 'creator-artwork'].includes(b.bucket)) return say(400, { error: 'unsupported bucket' });
      const file = String(b.file_name || '').replace(/[^a-zA-Z0-9._-]+/g, '-');
      const path = p.uid + '/' + randomUUID() + '-' + file;
      const token = 'fixture-upload-' + (++n);
      grants.set(token, { bucket: b.bucket, path, uid: p.uid, file });
      return say(200, { ok: true, bucket: b.bucket, path, token, signed_url: null });
    }
    if (action === 'stream') {
      const t = tracks.get(String(b.track_id || ''));
      if (!t || (!own(t, who) && t.status !== 'published')) return say(404, { error: 'track unavailable' });
      return say(200, { ok: true, url: SB + '/storage/v1/object/sign/creator-masters/' + t.master_path + '?token=fixture-stream', expires_in: 3600 });
    }
    if (!p.owner) return say(403, { error: 'operator permission required' });
    if (action === 'operator-dashboard') {
      const rows = [...tracks.values()].filter((t) => REVIEW_STATES.includes(t.status)).sort((a, c) => String(c.created_at).localeCompare(String(a.created_at))).map(reviewRow);
      const creators = Object.values(PEOPLE).filter((x) => x.creator).map((x) => ({ m_uid: x.muid, handle: x.handle, artist_name: x.name, verification_state: 'unverified', payout_state: 'not_started', status: 'active', settings: {} }));
      return say(200, { ok: true, tracks: rows, creators, offers: [] });
    }
    const t = tracks.get(String(b.track_id || ''));
    if (action === 'operator-review-prepare') {
      if (!t || !REVIEW_STATES.includes(t.status)) return say(409, { error: 'this release is not waiting for review' });
      const bytes = objects.get('creator-masters/' + t.master_path);
      if (!bytes) return say(409, { error: "this release's master file is missing" });
      const was = pinned.get(t.id);
      const v = was || { version_id: randomUUID(), sha256: sha(bytes), size_bytes: bytes.length };
      pinned.set(t.id, v);
      return say(200, { ok: true, track_id: t.id, version_id: v.version_id, sha256: v.sha256, sha256_short: v.sha256.slice(0, 12) + '…' + v.sha256.slice(-4), size_bytes: v.size_bytes, hashed_now: !was, expected_updated_at: t.updated_at, listen_url: SB + '/storage/v1/object/sign/creator-masters/' + t.master_path + '?token=fixture-listen', expires_in: 900 });
    }
    if (action === 'operator-review') {
      const decision = String(b.decision || ''), expectedAt = String(b.expected_updated_at || ''), expectedSha = String(b.expected_master_sha256 || '').toLowerCase();
      /* the Edge function's own refusals, word for word (supabase/functions/music-access/index.ts) */
      if (!b.track_id || !['publish', 'approve', 'reject', 'review'].includes(decision)) return say(400, { error: 'invalid review request' });
      if ((decision === 'publish' || decision === 'approve') && !expectedAt) return say(400, { error: 'expected_updated_at required: reload the queue and review again' });
      if ((decision === 'publish' || decision === 'approve') && !/^[0-9a-f]{64}$/.test(expectedSha)) return say(400, { error: 'expected_master_sha256 required: verify the audio and review again' });
      /* public.music_operator_review */
      if (!t || (expectedAt && t.updated_at !== expectedAt)) return say(409, { error: 'the release changed since you loaded it: reload and review it again' });
      if (decision === 'publish' || decision === 'approve') {
        const v = pinned.get(t.id);
        if (!v) return say(409, { error: 'verify the audio before approving it' });
        if (v.sha256 !== expectedSha) return say(409, { error: 'the audio is not the version you listened to: verify it again' });
      }
      const next = { ...t, moderation_note: String(b.note || ''), updated_at: stamp() };
      next.status = { publish: 'published', approve: 'approved', reject: 'rejected', review: 'pending_review' }[decision];
      next.rights_status = { publish: 'cleared', approve: 'cleared', reject: 'disputed', review: 'review' }[decision];
      if (decision === 'publish') next.published_at = t.published_at || stamp();
      tracks.set(t.id, next);
      return say(200, { ok: true, track: { ...reviewRow(next), master_sha256: pinned.get(t.id) ? pinned.get(t.id).sha256 : null } });
    }
    return route.fallback();
  }

  /* ---------- Storage ---------- */
  function filePart(buf, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!buf || !m) return buf && buf.length ? buf : null;
    const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
    let at = buf.indexOf(boundary);
    while (at !== -1) {
      const next = buf.indexOf(boundary, at + boundary.length);
      if (next === -1) break;
      const part = buf.subarray(at + boundary.length + 2, next - 2);
      const split = part.indexOf('\r\n\r\n');
      if (split !== -1 && /filename=|name=""/i.test(part.subarray(0, split).toString('latin1')) && !/name="cacheControl"/i.test(part.subarray(0, split).toString('latin1'))) return part.subarray(split + 4);
      at = next;
    }
    return null;
  }
  function serveBytes(route, req, bytes, type) {
    const head = { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
    if (!m) return route.fulfill({ status: 200, contentType: type, headers: head, body: bytes });
    const a = +m[1], z = m[2] ? Math.min(+m[2], bytes.length - 1) : bytes.length - 1;
    return route.fulfill({ status: 206, contentType: type, headers: { ...head, 'content-range': `bytes ${a}-${z}/${bytes.length}` }, body: bytes.subarray(a, z + 1) });
  }
  async function onStorage(route, req, url) {
    const method = req.method(), p = decodeURIComponent(url.pathname);
    let m = /^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(p);
    if (m && (method === 'PUT' || method === 'POST')) {
      const g = grants.get(url.searchParams.get('token') || '');
      if (!g || g.bucket !== m[1] || g.path !== m[2]) return json(route, 400, { statusCode: '400', error: 'InvalidSignature', message: 'invalid signature' });
      let bytes = null;
      try { bytes = filePart(req.postDataBuffer(), req.headers()['content-type']); } catch (_) {}
      /* a browser may not hand a test the bytes of a file part: then they are the ones the test gave the page */
      if (!bytes || !bytes.length) bytes = expected.get(g.file) || null;
      if (!bytes) return json(route, 400, { statusCode: '400', error: 'release plane', message: 'no bytes for ' + g.file });
      objects.set(g.bucket + '/' + g.path, Buffer.from(bytes));
      grants.delete(url.searchParams.get('token'));
      return json(route, 200, { Key: g.bucket + '/' + g.path, Id: randomUUID() });
    }
    m = /^\/storage\/v1\/object\/(public|sign)\/([^/]+)\/(.+)$/.exec(p);
    if (m && (method === 'GET' || method === 'HEAD')) {
      if (m[1] === 'public' && !PUBLIC_BUCKETS.includes(m[2])) return json(route, 400, { error: 'not public' });
      const bytes = objects.get(m[2] + '/' + m[3]);
      if (!bytes) return json(route, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return serveBytes(route, req, bytes, /\.wav$/i.test(m[3]) ? 'audio/wav' : 'application/octet-stream');
    }
    m = /^\/storage\/v1\/object\/([^/]+)$/.exec(p);
    if (m && method === 'DELETE') {
      const who = whoOf(req), prefixes = body(req).prefixes || [];
      const removed = prefixes.filter((x) => who && String(x).startsWith(PEOPLE[who].uid + '/') && objects.delete(m[1] + '/' + x));
      return json(route, 200, removed.map((name) => ({ name, bucket_id: m[1] })));
    }
    return json(route, 404, { error: 'release plane: no such storage path' });
  }

  /* ---------- the collector ---------- */
  function onCollect(route, req, url) {
    const b = body(req), list = Array.isArray(b.events) ? b.events : [];
    let page = '', origin = '';
    try { const f = new URL(req.frame().url()); page = f.pathname; origin = f.origin; } catch (_) {}
    collects.push({ origin, page, count: list.length, via: url.origin === API ? 'api' : 'fallback' });
    for (const ev of list) events.push({ name: ev && ev.name, path: ev && ev.path, props: ev && ev.props, page, origin });
    return json(route, 200, { ok: true, accepted: list.length });
  }

  async function serveFile(route, root, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel === '/__blank') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' });
    const file = normalize(join(root, rel));
    if (!file.startsWith(normalize(root + sep))) return route.fulfill({ status: 403, body: '' });
    try { return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] || 'application/octet-stream', body: await readFile(file) }); }
    catch (_) { return route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' }); }
  }

  async function install(context, root) {
    /* registered after the accounts plane, so it is asked first; what it does not answer goes back to that plane */
    await context.route('**/*', async (route) => {
      const req = route.request();
      let url;
      try { url = new URL(req.url()); } catch (_) { return route.fallback(); }
      const p = url.pathname, method = req.method();
      try {
        if (method === 'OPTIONS' && (url.origin === SB || url.origin === API)) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        /* a copy of these pages on a World host, to prove what the shared bar does there */
        if (url.origin === WORLD) return await serveFile(route, root, url);
        if (url.origin === SB) {
          if (p === '/rest/v1/creator_tracks') return await onTracks(route, req, url);
          if (/^\/rest\/v1\/vault_[a-z_]+$/.test(p)) return json(route, 404, { code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public." + p.slice(9) + "' in the schema cache" });
          if (p === '/rest/v1/music_rights_attestations' && method === 'POST') return whoOf(req) ? route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' }) : json(route, 401, { message: 'JWT expired' });
          if (p === '/functions/v1/music-access') return await onMusicAccess(route, req);
          if (p === '/functions/v1/collect') return onCollect(route, req, url);
          if (p.startsWith('/storage/')) return await onStorage(route, req, url);
          return route.fallback();
        }
        if (url.origin === API) {
          if (p === '/v1/collect') return onCollect(route, req, url);
          if (BASE_API.some((r) => r.test(p))) return route.fallback();
          const who = whoOf(req);
          if (p === '/v1/workspaces/me') return who && PEOPLE[who].owner ? json(route, 200, { ok: true, profile: { id: PEOPLE[who].uid }, default_org_id: 'o1', workspaces: [{ org_id: 'o1', slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] }) : json(route, 401, { error: 'sign in' });
          /* the rest of the owner's desk, quiet: nothing in it is about a release */
          return json(route, 200, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], items: [], rows: [], total: 0 });
        }
        return route.fallback();
      } catch (e) {
        try { return await json(route, 500, { error: 'release plane: ' + e.message }); } catch (_) {}
      }
    });
    context.on('page', (page) => page.on('dialog', (d) => { dialogs.push({ type: d.type(), message: d.message(), page: page.url() }); d.type() === 'confirm' ? d.accept() : d.dismiss(); }));
  }

  return {
    install, tracks, objects, pinned, calls, events, collects, writes, dialogs, sha, publicUrl,
    /* the bytes of a file the test is about to hand the page, by its name */
    expectFile(name, bytes) { expected.set(String(name).replace(/[^a-zA-Z0-9._-]+/g, '-'), Buffer.from(bytes)); },
    byTitle(title) { return [...tracks.values()].find((t) => t.title === title) || null; }
  };
}
