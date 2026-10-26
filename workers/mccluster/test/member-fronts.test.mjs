/* EVERY ACCOUNT'S FRONT PAGE (owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this
   exact same experience"). The routes in src/member-fronts.js and the shared check in packages/front-config. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleMemberFronts } from '../src/member-fronts.js';
import { validateFront, mediaPrefix, frontHref } from '../../../packages/front-config/index.mjs';

const SB = 'https://sb.test';
const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-SECRET', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const BENJI = '22222222-2222-4222-8222-222222222222', BENJI_M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '11111111-1111-4111-8111-111111111111', HOUSE = '33333333-3333-4333-8333-333333333333';
const PREFIX = `${SB}/storage/v1/object/public/front-media/${BENJI}/`;
const req = (path, { method = 'GET', token = '', body } = {}) => new Request('https://api.mccluster.org' + path, { method, headers: { origin: 'https://matthew.mccluster.org', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

/* the database, as PostgREST answers these reads and writes */
function db(seed = {}) {
  const t = { member_fronts: seed.fronts || [], profiles: seed.profiles || [{ m_uid: BENJI_M, display_name: 'Benji Chase', avatar_url: '', headline: 'Hitman', visibility: 'public' }] };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url)), h = new Headers(init.headers || {}), method = init.method || 'GET';
    calls.push({ path: u.pathname, search: u.search, method, body: init.body ? JSON.parse(init.body) : null, auth: h.get('authorization') });
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/auth/v1/user') return h.get('authorization') === 'Bearer benji' ? json({ id: BENJI }) : h.get('authorization') === 'Bearer owner' ? json({ id: OWNER }) : json({}, 401);
    if (u.pathname === '/rest/v1/m_auth_user_links') return json(u.searchParams.get('auth_user_id') === 'eq.' + BENJI ? [{ m_uid: BENJI_M }] : []);
    if (u.pathname === '/rest/v1/platform_profiles') return json(u.searchParams.get('user_id') === 'eq.' + BENJI ? [{ mccluster_id: seed.handle === undefined ? 'benji.chase' : seed.handle, display_name: 'Benji Chase', avatar_url: '' }] : []);
    if (u.pathname === '/rest/v1/orgs') return json([{ id: HOUSE }]);
    if (u.pathname === '/rest/v1/org_members') return json(u.searchParams.get('profile_id') === 'eq.' + OWNER ? [{ role: 'owner' }] : []);
    if (u.pathname === '/rest/v1/network_profiles') return json(t.profiles.filter((p) => 'eq.' + p.m_uid === u.searchParams.get('m_uid')));
    if (u.pathname === '/rest/v1/member_fronts') {
      if (method === 'GET') {
        let rows = t.member_fronts.slice();
        const m = u.searchParams.get('m_uid'), hd = u.searchParams.get('handle');
        if (m) rows = rows.filter((r) => 'eq.' + r.m_uid === m);
        if (hd) rows = rows.filter((r) => 'eq.' + r.handle === hd);
        if (u.searchParams.get('removed_at') === 'is.null') rows = rows.filter((r) => !r.removed_at);
        if (u.searchParams.get('published') === 'not.is.null') rows = rows.filter((r) => r.published);
        return json(rows);
      }
      const b = init.body ? JSON.parse(init.body) : {};
      if (method === 'POST') { const i = t.member_fronts.findIndex((r) => r.m_uid === b.m_uid); if (i >= 0) t.member_fronts[i] = { ...t.member_fronts[i], ...b }; else t.member_fronts.push({ removed_at: null, published: null, ...b }); return new Response(null, { status: 201 }); }
      if (method === 'PATCH') { const m = u.searchParams.get('m_uid'), hd = u.searchParams.get('handle'); t.member_fronts = t.member_fronts.map((r) => ('eq.' + r.m_uid === m || 'eq.' + r.handle === hd) ? { ...r, ...b } : r); return new Response(null, { status: 204 }); }
    }
    return json({ message: 'unexpected ' + u.pathname }, 404);
  };
  return { fetchImpl, calls, t };
}
const call = (d, path, opts) => handleMemberFronts(req(path, opts), ENV, { fetchImpl: d.fetchImpl });
const FILM = (name, n = 120) => ({ base: `${PREFIX}${name}/`, count: n, ext: 'webp', sm: true });
const CONFIG = {
  words: { title1: 'HITMAN', title2: 'BENJI', eyebrow: 'Producer · Atlanta', door1: { label: 'Hear the tape', href: 'https://example.com/tape' }, door2: { label: 'Book me', href: 'javascript:alert(1)' } },
  media: { hero: FILM('hero'), scene1: FILM('s1', 96), cabin: { src: PREFIX + 'cabin.mp4', kind: 'video', poster: PREFIX + 'cabin.jpg' }, sound: { src: PREFIX + 'beat.mp3' }, night: { base: 'https://evil.example/frames/', count: 120, ext: 'webp' } },
  vr: { hold: false, spots: [{ yaw: 10, pitch: 0, label: 'My studio', href: 'studio.html' }] },
  links: [{ label: 'Instagram', href: 'https://instagram.com/hitmanbenji' }, { label: 'x', href: 'data:text/html,1' }],
  scroll: { duration: 9 }
};

test('an account saves its draft: only what passes is stored, its own media only, and it says what it dropped', async () => {
  const d = db();
  const res = await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  assert.equal(body.handle, 'benji.chase');
  assert.equal(body.url, 'front.html?u=benji.chase');
  assert.deepEqual(body.draft.words, { title1: 'HITMAN', title2: 'BENJI', eyebrow: 'Producer · Atlanta', door1: { label: 'Hear the tape', href: 'https://example.com/tape' } });
  assert.deepEqual(Object.keys(body.draft.media).sort(), ['cabin', 'hero', 'scene1', 'sound'], 'a film from anywhere but its own folder is not kept');
  assert.equal(body.draft.links.length, 1);
  assert.equal(body.draft.scroll.duration, undefined, 'out of bounds: the page keeps its own');
  for (const name of ['words.door2', 'media.night', 'links.1', 'scroll.duration']) assert.ok(body.dropped.includes(name), name);
  assert.equal(body.published, null, 'saving is not publishing');
  const row = d.t.member_fronts[0];
  assert.equal(row.m_uid, BENJI_M);
  assert.equal(row.auth_user_id, BENJI);
  assert.equal(row.handle, 'benji.chase');
  assert.deepEqual(row.draft, body.draft);
  const write = d.calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/member_fronts');
  assert.equal(write.auth, 'Bearer service-SECRET', 'the table is written by the Worker, never the browser');
});

test('publishing makes the page public at its handle; visitors never see a draft', async () => {
  const d = db();
  await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG } });
  assert.equal((await call(d, '/v1/fronts/benji.chase')).status, 404, 'saved, not published');
  const pub = await (await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } })).json();
  assert.ok(pub.published && pub.published_at);
  const res = await call(d, '/v1/fronts/benji.chase');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const page = await res.json();
  assert.equal(page.name, 'Benji Chase');
  assert.equal(page.config.words.title1, 'HITMAN');
  assert.equal(page.config.media.hero.base, PREFIX + 'hero/');
  /* a newer draft does not change what visitors get until it is published */
  await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: { words: { title1: 'NEW' } } } });
  assert.equal((await (await call(d, '/v1/fronts/benji.chase')).json()).config.words.title1, 'HITMAN');
  const me = await (await call(d, '/v1/fronts/me', { token: 'benji' })).json();
  assert.equal(me.draft.words.title1, 'NEW');
  assert.equal(me.published.words.title1, 'HITMAN');
  assert.equal(me.media_prefix, PREFIX, 'the editor is told its own folder');
});

test('private and missing profiles can save drafts, but cannot claim a public publication', async () => {
  for (const profiles of [[], [{ m_uid: BENJI_M, visibility: 'private' }]]) {
    const d = db({ profiles });
    const code = profiles.length ? 'private_profile' : 'profile_required';
    const me = await (await call(d, '/v1/fronts/me', { token: 'benji' })).json();
    assert.equal(me.publish_blocker, code);
    assert.equal(me.publicly_available, false);
    assert.equal((await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG } })).status, 200);
    const writes = d.calls.filter(x => x.method === 'POST').length;
    const publish = await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } });
    assert.equal(publish.status, 409);
    assert.equal((await publish.json()).detail.code, code);
    assert.equal(d.calls.filter(x => x.method === 'POST').length, writes, 'refused publication has no writes');
    assert.equal(d.t.member_fronts[0].published, null);
    // A settings change is made outside the publisher, then the same draft can be published.
    d.t.profiles = [{ m_uid: BENJI_M, visibility: 'public' }];
    const recovered = await (await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } })).json();
    assert.equal(recovered.publicly_available, true);
    assert.equal((await call(d, '/v1/fronts/benji.chase')).status, 200);
    d.t.profiles = [];
    assert.equal((await call(d, '/v1/fronts/benji.chase')).status, 404, 'a missing profile must fail closed');
  }
});

test('a caller-supplied identity cannot replace another member\'s page', async () => {
  const other = { m_uid: HOUSE, auth_user_id: OWNER, handle: 'another.creator', draft: { words: { title1: 'OTHER' } }, published: null };
  const d = db({ fronts: [other] });
  const result = await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { m_uid: HOUSE, auth_user_id: OWNER, handle: other.handle, config: CONFIG, publish: true } });
  assert.equal(result.status, 200);
  assert.deepEqual(d.t.member_fronts.find(x => x.m_uid === HOUSE), other);
  assert.equal(d.t.member_fronts.find(x => x.m_uid === BENJI_M).handle, 'benji.chase');
});

test('a published page is checked again on the way out: a row can only show its own account\'s media', async () => {
  const d = db({ fronts: [{ m_uid: BENJI_M, auth_user_id: BENJI, handle: 'benji.chase', draft: {}, published: { media: { hero: { base: `${SB}/storage/v1/object/public/front-media/${OWNER}/hero/`, count: 100, ext: 'webp' } }, words: { title1: 'OK' } }, published_at: '2026-10-21T00:00:00Z', removed_at: null }] });
  const page = await (await call(d, '/v1/fronts/benji.chase')).json();
  assert.equal(page.config.media.hero, undefined);
  assert.equal(page.config.words.title1, 'OK');
});

test('taking a page down, by the account or by the house', async () => {
  const d = db();
  await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } });
  assert.equal((await call(d, '/v1/fronts/me/published', { method: 'DELETE', token: 'benji' })).status, 200);
  assert.equal((await call(d, '/v1/fronts/benji.chase')).status, 404);
  await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } });
  assert.equal((await call(d, '/v1/fronts/benji.chase/takedown', { method: 'POST', token: 'benji', body: { reason: 'x' } })).status, 403, 'only the house owner');
  assert.equal((await call(d, '/v1/fronts/benji.chase/takedown', { method: 'POST', token: 'owner', body: { reason: 'Reported content' } })).status, 200);
  assert.equal((await call(d, '/v1/fronts/benji.chase')).status, 404);
  const again = await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG, publish: true } });
  assert.equal(again.status, 403, 'a removed page cannot be republished');
  assert.equal((await again.json()).detail.code, 'removed');
  assert.equal((await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: CONFIG } })).status, 200, 'the draft can still be kept');
});

test('no session, no handle, a private profile, a bad method: each refused plainly', async () => {
  const d = db();
  assert.equal((await call(d, '/v1/fronts/me')).status, 401);
  assert.equal((await call(d, '/v1/fronts/me', { token: 'nobody' })).status, 401);
  const noHandle = await call(db({ handle: '' }), '/v1/fronts/me', { token: 'benji' });
  assert.equal(noHandle.status, 409);
  assert.equal((await noHandle.json()).detail.code, 'handle_required');
  const priv = db({ profiles: [{ m_uid: BENJI_M, display_name: 'B', visibility: 'private' }], fronts: [{ m_uid: BENJI_M, auth_user_id: BENJI, handle: 'benji.chase', draft: {}, published: { words: {} }, removed_at: null }] });
  assert.equal((await call(priv, '/v1/fronts/benji.chase')).status, 404);
  assert.equal((await call(d, '/v1/fronts/me', { method: 'PATCH', token: 'benji' })).status, 405);
  assert.equal((await call(d, '/v1/fronts/BAD HANDLE')).status, 404);
  assert.equal(await handleMemberFronts(req('/v1/frontsx'), ENV, { fetchImpl: d.fetchImpl }), null);
  const huge = await call(d, '/v1/fronts/me', { method: 'POST', token: 'benji', body: { config: { vr: { spots: Array.from({ length: 5 }, () => ({ label: 'x'.repeat(60), href: 'a'.repeat(300) })) }, links: Array.from({ length: 4 }, () => ({ label: 'y'.repeat(40), href: 'b'.repeat(300) })) } } });
  assert.equal(huge.status, 200, 'everything within bounds fits the size cap');
});

test('the shared check: bounds, links, media folders, and nothing it does not know', () => {
  assert.equal(mediaPrefix(SB, BENJI), PREFIX);
  assert.equal(mediaPrefix(SB, 'not-a-uuid'), '');
  for (const ok of ['hire.html', 'mnet.html?view=profile&handle=a.b', 'https://instagram.com/x']) assert.equal(frontHref(ok), ok);
  for (const bad of ['javascript:alert(1)', '//evil.com', 'data:text/html,1', 'mailto:a@b', 'https://x.y/"onerror']) assert.equal(frontHref(bad), undefined, bad);
  const r = validateFront({ scenes: { night: false, extra: true }, vr: { band: [0.5, 0.51], yaw: 30 }, night: { arrive: 0.8 }, unknown: { x: 1 }, media: { hero: { base: PREFIX + '../x/', count: 100, ext: 'webp' }, cabin: { src: PREFIX + 'c.mp4', kind: 'gif' } } }, { mediaPrefix: PREFIX });
  assert.deepEqual(r.config.scenes, { night: false });
  assert.equal(r.config.vr.band, undefined, 'a band thinner than 4% is not a cabin');
  assert.equal(r.config.vr.yaw, 30);
  assert.equal(r.config.night.arrive, 0.8);
  assert.equal(r.config.unknown, undefined);
  assert.equal(r.config.media.hero, undefined, 'no climbing out of the folder');
  assert.equal(r.config.media.cabin, undefined);
  assert.equal(r.config.schema, 'mccluster-front/v1');
});

test('the routes are wired before the platform gate, and the browser may ask first', () => {
  const entry = readFileSync(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.ok(entry.indexOf('handleMemberFronts(request, env)') > 0 && entry.indexOf('handleMemberFronts(request, env)') < entry.indexOf('handlePlatformApi(request, env)'));
  assert.match(readFileSync(new URL('../src/preflight.js', import.meta.url), 'utf8'), /'\/v1\/fronts'/);
  const sql = readFileSync(new URL('../../../supabase/pending/member_fronts_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all on table public\.member_fronts from public, anon, authenticated;/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.match(sql, /'front-media',\s*'front-media',\s*true,/);
});

test('before the table exists, the routes say front pages are not on yet, never the database\'s words', async () => {
  const d = db();
  const missing = async (url, init) => (String(url).includes('/rest/v1/member_fronts')
    ? new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.member_fronts' in the schema cache" }), { status: 404, headers: { 'content-type': 'application/json' } })
    : d.fetchImpl(url, init));
  for (const [path, opts] of [['/v1/fronts/me', { token: 'benji' }], ['/v1/fronts/benji.chase', {}]]) {
    await assert.rejects(handleMemberFronts(req(path, opts), ENV, { fetchImpl: missing }), (e) => e.status === 503 && e.message === 'Front pages are not switched on yet');
  }
});
