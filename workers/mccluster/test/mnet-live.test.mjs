/* Governed Action Network live rooms.
   Host access is an explicit cohort/client-project/staff capability, room
   context survives into the session/feed post, viewers are measured through
   a private service-side heartbeat, and Cloudflare's WHIP publish credential
   never enters the database. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlatformApi, reapStaleLiveSessions } from '../src/platform-api.js';

const BASE = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const ENV = { ...BASE, CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'tok' };
const HOST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const MUID = '55555555-5555-4555-8555-555555555555';
const OTHER_MUID = '66666666-6666-4666-8666-666666666666';
const ROOM = '77777777-7777-4777-8777-777777777777';
const MISSION = '88888888-8888-4888-8888-888888888888';
const MUSIC = '99999999-9999-4999-8999-999999999999';
const COHORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GRANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WHIP = 'https://customer-x.cloudflarestream.com/SECRET/webRTC/publish';
const WHEP = 'https://customer-x.cloudflarestream.com/in1/webRTC/play';
const CATEGORIES = [
  { key: 'music', label: 'Music', description: 'Perform', sort: 10 },
  { key: 'build', label: 'Build', description: 'Make', sort: 20 },
  { key: 'learn', label: 'Learn', description: 'Teach', sort: 30 },
  { key: 'field', label: 'Field', description: 'Do', sort: 40 },
  { key: 'forum', label: 'Forum', description: 'Discuss', sort: 50 }
];
const ROOM_ROW = {
  id: ROOM, slug: 'equity-uprise-situation-room', owner_m_uid: MUID,
  title: 'Equity Uprise Situation Room', description: 'Work in public',
  room_kind: 'mission', category_key: 'field', action_mission_id: MISSION,
  cohort_id: null, music_object_id: MUSIC, seat_limit: 4,
  support_enabled: false, status: 'active'
};
const SESSION_ROW = {
  id: SESSION, host_user_id: HOST, host_m_uid: MUID, title: 'Working the mission',
  status: 'starting', cf_input_uid: 'in1', whep_url: WHEP, post_id: null,
  room_id: ROOM, room_kind: 'mission', category_key: 'field',
  action_mission_id: MISSION, music_object_id: MUSIC, cohort_id: null,
  seat_limit: 4, support_enabled: false,
  started_at: new Date().toISOString(), last_seen_at: new Date().toISOString()
};
const MISSION_ROW = { id: MISSION, campaign_id: 'cobalt', title: 'Document the supply chain', description: 'Do the work', domain: 'field', status: 'open' };
const MUSIC_ROW = { id: MUSIC, catalog_key: 'here:pull-up', album_slug: 'here', album_title: 'HERE', track_title: 'Pull Up', artist_name: 'McCluster', credit_line: '', artwork_path: 'art.jpg', canonical_url: 'https://matthew.mccluster.org/album.html?album=here&t=Pull%20Up' };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function ok(d, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
}

function fake({
  me = HOST,
  canHost = true,
  basis = 'owner',
  allowed = ['music', 'build', 'learn', 'field', 'forum'],
  maxSeats = 8,
  admin = false,
  open = [],
  status = 'starting',
  room = ROOM_ROW,
  directory = null,
  grantRows = []
} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    const raw = init.body ? String(init.body) : '';
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}
    calls.push({ u, m, body, raw });

    if (u.endsWith('/auth/v1/user')) return ok({ id: me });
    if (u.includes('/rpc/live_host_context')) return ok({
      can_host: canHost, basis: canHost ? basis : 'none',
      allowed_categories: canHost ? allowed : [], max_stage_seats: canHost ? maxSeats : 0,
      support_allowed: false
    });
    if (u.includes('/rpc/eu_is_admin')) return ok(admin);

    if (u.includes('/m_auth_user_links?m_uid=in.')) {
      return ok([{ m_uid: MUID, auth_user_id: HOST }]);
    }
    if (u.includes('/m_auth_user_links?auth_user_id=')) return ok([{ m_uid: me === HOST ? MUID : OTHER_MUID }]);
    if (u.includes('/m_auth_user_links?m_uid=eq.')) return ok([{ auth_user_id: HOST }]);
    if (u.includes('/network_profiles?m_uid=in.')) return ok([{ m_uid: MUID, display_name: 'Kofi', avatar_url: '', verification_state: 'verified' }]);
    if (u.includes('/network_profiles?m_uid=eq.')) return ok([{ m_uid: MUID, display_name: 'Kofi', visibility: 'public' }]);
    if (u.includes('/platform_profiles?user_id=in.')) return ok([{ user_id: HOST, mccluster_id: 'kofi' }]);
    if (u.includes(`/platform_profiles?user_id=eq.${HOST}`)) return ok([{ user_id: HOST, display_name: 'Kofi', mccluster_id: 'kofi' }]);

    if (u.includes('/network_live_categories')) {
      const key = new URL(u).searchParams.get('key');
      if (key && key.startsWith('eq.')) {
        const wanted = key.slice(3);
        return ok(CATEGORIES.filter((x) => x.key === wanted));
      }
      return ok(CATEGORIES);
    }

    if (u.includes('/network_live_host_grants')) {
      if (m === 'POST') return ok([{ id: GRANT, ...(body || {}), status: 'active' }], 201);
      if (m === 'PATCH') return ok([{ id: GRANT, ...(grantRows[0] || {}), ...(body || {}) }]);
      return ok(grantRows);
    }

    if (u.includes('/action_missions')) return ok([MISSION_ROW]);
    if (u.includes('/music_catalog_objects')) return ok([MUSIC_ROW]);

    if (u.includes('/network_live_rooms')) {
      if (m === 'POST') return ok([{ ...ROOM_ROW, ...(body || {}), id: ROOM, status: 'active' }], 201);
      if (u.includes('id=eq.')) return ok(room ? [room] : []);
      if (u.includes('owner_m_uid=eq.')) return ok(room ? [room] : []);
      return ok(room ? [room] : []);
    }

    if (u.includes('/rpc/network_live_session_metrics')) return ok([{
      session_id: SESSION, unique_viewers: 18, engaged_viewers: 11,
      joined: 6, submitted: 4, verified: 3, score: 0.08,
      score_basis: 'verified_actions_per_viewer'
    }]);

    if (u.includes('/network_live_audience') && m === 'POST') return ok([], 201);

    if (u.includes('/network_live_sessions') && m === 'GET' && u.includes('status=in.')) return ok(open);
    if (u.includes('/network_live_sessions') && m === 'GET' && u.includes('status=eq.live') && u.includes('last_seen_at=gt.')) {
      return ok(directory == null ? [{ ...SESSION_ROW, status: 'live' }] : directory);
    }
    if (u.includes('/network_live_sessions') && m === 'GET') {
      return ok([{ ...SESSION_ROW, status }]);
    }
    if (u.endsWith('/network_live_sessions') && m === 'POST') {
      return ok([{ ...SESSION_ROW, ...(body || {}), id: SESSION, status: 'starting' }], 201);
    }
    if (u.includes('/network_live_sessions') && m === 'PATCH') return ok([]);

    if (u.includes('/platform_apps')) return ok([{ id: 'app1' }]);
    if (u.endsWith('/network_posts') && m === 'POST') return ok([{ id: 'post1' }], 201);

    if (u.startsWith('https://api.cloudflare.com/')) {
      if (m === 'POST') return ok({ success: true, result: { uid: 'in1', webRTC: { url: WHIP }, webRTCPlayback: { url: WHEP } } });
      if (m === 'GET') return ok({ success: true, result: { uid: 'in1', webRTC: { url: WHIP } } });
      return ok({ success: true, result: null });
    }

    return ok([]);
  };
  return calls;
}

const call = (path, method = 'GET', body, env = ENV) => handlePlatformApi(
  new Request(`https://api.test${path}`, {
    method,
    headers: { authorization: 'Bearer user', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }),
  env
);

test('an ungranted member cannot go live, and Cloudflare is never asked', async () => {
  const calls = fake({ canHost: false });
  const res = await call('/v1/mnet/live', 'POST', { title: 'Hi', room_kind: 'home', category_key: 'forum' });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /cohort, client-project or staff grant/i);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);
});

test('eligibility exposes bounded categories and transport truthfully', async () => {
  fake({ canHost: true, basis: 'grant', allowed: ['music'], maxSeats: 4 });
  const res = await call('/v1/mnet/live/eligibility');
  const data = await res.json();
  assert.equal(data.can_host, true);
  assert.deepEqual(data.allowed_categories, ['music']);
  assert.equal(data.max_stage_seats, 4);
  assert.equal(data.stage_transport, 'single_host_stream');
  assert.equal(data.support_allowed, false);
});

test('live options expose only two room kinds and do not pretend multi-seat transport is active', async () => {
  fake({ canHost: true, basis: 'grant', allowed: ['field'], maxSeats: 4 });
  const res = await call('/v1/mnet/live/options');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.room_kinds.map((x) => x.key), ['home', 'mission']);
  assert.deepEqual(data.stage.roles, ['cohost', 'guest']);
  assert.equal(data.stage.multi_seat_ready, false);
  assert.equal(data.music[0].id, MUSIC);
  assert.equal(data.missions[0].id, MISSION);
});

test('without Stream secrets, an eligible host gets a clear 503 before a live input exists', async () => {
  const calls = fake();
  const res = await call('/v1/mnet/live', 'POST', { title: 'Hi', room_kind: 'home', category_key: 'forum' }, BASE);
  assert.equal(res.status, 503);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);
});

test('a new governed Home room snapshots category and never stores the WHIP credential', async () => {
  const calls = fake({ open: [{ id: OLD, cf_input_uid: 'old-input' }] });
  const res = await call('/v1/mnet/live', 'POST', {
    title: 'Building live', room_title: 'Build Lab', room_kind: 'home',
    category_key: 'build', music_object_id: MUSIC
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.whip_url, WHIP);
  assert.equal(data.session.category_key, 'build');
  assert.equal(data.session.room_kind, 'home');
  const roomInsert = calls.find((c) => c.u.endsWith('/network_live_rooms') && c.m === 'POST');
  assert.equal(roomInsert.body.support_enabled, false);
  const insert = calls.find((c) => c.u.endsWith('/network_live_sessions') && c.m === 'POST');
  assert.ok(insert, 'session written');
  assert.equal(insert.body.room_id, ROOM);
  assert.equal(insert.body.music_object_id, MUSIC);
  assert.ok(!insert.raw.includes('SECRET'), 'WHIP publish URL never enters the database');
  assert.ok(calls.some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/old-input')));
});

test('a host cannot use a category outside the explicit grant', async () => {
  const calls = fake({ basis: 'grant', allowed: ['music'] });
  const res = await call('/v1/mnet/live', 'POST', { title: 'Field work', room_kind: 'home', category_key: 'field' });
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);
});

test('a Mission room requires an open mission before Cloudflare is asked', async () => {
  let calls = fake({ basis: 'grant', allowed: ['field'] });
  let res = await call('/v1/mnet/live', 'POST', { title: 'Mission time', room_kind: 'mission', category_key: 'field' });
  assert.equal(res.status, 400);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);

  calls = fake({ basis: 'grant', allowed: ['field'] });
  res = await call('/v1/mnet/live', 'POST', {
    title: 'Mission time', room_kind: 'mission', category_key: 'field', action_mission_id: MISSION
  });
  assert.equal(res.status, 201);
  const sessionInsert = calls.find((c) => c.u.endsWith('/network_live_sessions') && c.m === 'POST');
  assert.equal(sessionInsert.body.action_mission_id, MISSION);
  assert.equal(sessionInsert.body.room_kind, 'mission');
});

test('even the owner desk cannot silently broadcast from another person\'s persistent room', async () => {
  const calls = fake({ basis: 'owner', room: { ...ROOM_ROW, owner_m_uid: OTHER_MUID } });
  const res = await call('/v1/mnet/live', 'POST', { title: 'No', room_id: ROOM });
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);
});

test('the live directory returns sanitized room/song/mission context plus aggregate outcomes', async () => {
  fake();
  const res = await call('/v1/mnet/live/directory?kind=mission&category=field');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sessions.length, 1);
  const s = data.sessions[0];
  assert.equal(s.mission.id, MISSION);
  assert.equal(s.music.id, MUSIC);
  assert.equal(s.metrics.verified, 3);
  assert.equal(s.metrics.unique_viewers, 18);
  assert.equal(Object.hasOwn(s, 'viewer_m_uid'), false);
});

test('a signed-in non-host watch heartbeat records private audience presence', async () => {
  const calls = fake({ me: OTHER });
  const res = await call(`/v1/mnet/live/${SESSION}/watch`, 'POST', {});
  assert.equal(res.status, 200);
  const write = calls.find((c) => c.u.endsWith('/network_live_audience') && c.m === 'POST');
  assert.ok(write);
  assert.equal(write.body.session_id, SESSION);
  assert.equal(write.body.viewer_m_uid, OTHER_MUID);
  assert.equal(Object.hasOwn(write.body, 'first_seen_at'), false, 'upsert preserves original first touch');
});

test('the host does not count as their own audience viewer', async () => {
  const calls = fake({ me: HOST });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/watch`, 'POST', {})).status, 200);
  assert.ok(!calls.some((c) => c.u.endsWith('/network_live_audience') && c.m === 'POST'));
});

test('only the host can put a broadcast on air, heartbeat it, or fetch its publish URL', async () => {
  for (const act of [['on-air', 'POST'], ['heartbeat', 'POST'], ['publish', 'GET']]) {
    const calls = fake({ me: OTHER });
    const res = await call(`/v1/mnet/live/${SESSION}/${act[0]}`, act[1]);
    assert.equal(res.status, 404, act[0]);
    assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0, act[0]);
    assert.ok(!calls.some((c) => c.m === 'PATCH'), act[0]);
  }
});

test('on air feed metadata carries room, mission, category and first-class song identity', async () => {
  const calls = fake();
  const res = await call(`/v1/mnet/live/${SESSION}/on-air`, 'POST');
  assert.equal(res.status, 200);
  const post = calls.find((c) => c.u.endsWith('/network_posts') && c.m === 'POST');
  const liveMeta = post && post.body.metadata.live;
  assert.deepEqual(
    [liveMeta.session_id, liveMeta.room_id, liveMeta.room_kind, liveMeta.category_key, liveMeta.mission_id, liveMeta.music_object_id],
    [SESSION, ROOM, 'mission', 'field', MISSION, MUSIC]
  );
});

test('the desk issues one explicit cohort/category live capability and can revoke it', async () => {
  let calls = fake({ admin: true, grantRows: [] });
  let res = await call('/v1/mnet/live/admin/grants', 'POST', {
    m_uid: MUID, basis: 'cohort', cohort_id: COHORT, category: 'music', max_stage_seats: 4
  });
  assert.equal(res.status, 201);
  let insert = calls.find((c) => c.u.endsWith('/network_live_host_grants') && c.m === 'POST');
  assert.deepEqual(insert.body.allowed_categories, ['music']);
  assert.equal(insert.body.support_allowed, false);

  calls = fake({ admin: true, grantRows: [{ id: GRANT, m_uid: MUID, basis: 'cohort', cohort_id: COHORT, org_id: null, allowed_categories: ['music'], status: 'active' }] });
  res = await call(`/v1/mnet/live/admin/grants/${GRANT}`, 'DELETE');
  assert.equal(res.status, 200);
  const patch = calls.find((c) => c.u.includes('/network_live_host_grants') && c.m === 'PATCH');
  assert.equal(patch.body.status, 'revoked');
});

test('a stranger cannot end a broadcast; the desk can, and the Stream input is deleted', async () => {
  let calls = fake({ me: OTHER, admin: false, status: 'live' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/end`, 'POST')).status, 404);
  assert.equal(calls.filter((c) => c.u.startsWith('https://api.cloudflare.com/')).length, 0);

  calls = fake({ me: OTHER, admin: true, status: 'live' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/end`, 'POST')).status, 200);
  assert.ok(calls.some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/in1')));
  const patch = calls.find((c) => c.m === 'PATCH' && c.u.includes('/network_live_sessions'));
  assert.equal(patch.body.end_reason, 'desk');
});

test('an ended broadcast cannot be re-published', async () => {
  fake({ status: 'ended' });
  assert.equal((await call(`/v1/mnet/live/${SESSION}/publish`)).status, 410);
});

test('the cron ends broadcasts with no heartbeat and deletes their Stream inputs', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? String(init.body) : '' });
    if (u.includes('/network_live_sessions') && m === 'GET') return ok([{ id: SESSION, cf_input_uid: 'gone1' }]);
    if (u.startsWith('https://api.cloudflare.com/')) return ok({ success: true, result: null });
    return ok([]);
  };
  const out = await reapStaleLiveSessions(ENV);
  assert.equal(out.ended, 1);
  const q = calls.find((c) => c.u.includes('/network_live_sessions') && c.m === 'GET').u;
  assert.match(q, /status=in\.\(starting,live\)/);
  assert.match(q, /last_seen_at\.lt\./);
  assert.ok(calls.some((c) => c.m === 'DELETE' && c.u.endsWith('/live_inputs/gone1')));
  assert.equal(JSON.parse(calls.find((c) => c.m === 'PATCH').body).end_reason, 'stale');
});
