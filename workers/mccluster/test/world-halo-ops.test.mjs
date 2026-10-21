/* HALO OPERATIONS ON THE ADMIN GLOBE (./src/world-halo-ops.js): the owner's
   missions and people from Supabase (service role), and NOAA CO-OPS water
   levels. The release guard is proved in world-release.test.mjs; here the
   handler's own owner check, the answers' shapes, status mapping, review
   counting, ordering, caps, string capping, https-only avatars, the people
   privacy rule (no location, presence or contact key anywhere), the
   k-anonymous online total, and the tides normalisation, cache, stale and
   unavailable answers. Fake fetch only; no network. NOAA fixture shapes are
   the providers' answers as probed live on 2026-10-21. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleHaloOps, haloMissions, haloPeople, houseOwnerOf, httpsUrl, onlineOf, normalizeStation, normalizeWaterLevel, waterLevelAnswer, waterLevelUrl,
  HALO_MISSIONS_PATH, HALO_PEOPLE_PATH, TIDES_LAYER_PATH, MISSION_STATUS, TIDES
} from '../src/world-halo-ops.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const ORIGIN = 'https://matthew.mccluster.org';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ALLOWED_ORIGINS: ORIGIN };
const OWNER = '11111111-1111-4111-8111-111111111111';
const HOUSE = '00000000-0000-4000-8000-0000000000aa';
const req = (path, { method = 'GET', token = 'owner' } = {}) => new Request(`https://api.mccluster.org${path}`, { method, headers: { origin: ORIGIN, ...(token ? { authorization: 'Bearer ' + token } : {}) } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const headersOk = (r) => {
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('vary'), 'origin, authorization');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
};
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }
function age(cache, seconds) {
  for (const [k, v] of cache.raw) { const b = JSON.parse(v); b.fetched_at = new Date(Date.parse(b.fetched_at) - seconds * 1000).toISOString(); cache.raw.set(k, JSON.stringify(b)); }
}
/* every key anywhere in a JSON value */
function keysOf(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

/* ---------- ids and time ---------- */
const NOW = Date.now();
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M = (n) => id('aaaaaaaa', n), P = (n) => id('bbbbbbbb', n), U = (n) => id('cccccccc', n), A = (n) => id('dddddddd', n), PR = (n) => id('eeeeeeee', n);
const MA = M(1), MB = M(2), MC = M(3), MD = M(4), ME = M(5), MF = M(6);

/* ---------- a fake Supabase, keyed on the URL ---------- */
const inIds = (v) => { const m = /^in\.\((.*)\)$/.exec(v || ''); return m ? m[1].split(',') : null; };
function supabase(data = {}, { owner = true, fail = [], calls = [] } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const h = new Headers(init.headers || {});
    calls.push({ url: url.toString(), path: url.pathname, query: url.searchParams, method: init.method || 'GET', apikey: h.get('apikey'), authorization: h.get('authorization') });
    if (url.hostname !== 'sb.test') return data.other ? data.other(url, init) : Promise.reject(new Error('unexpected host ' + url));
    if (url.pathname === '/auth/v1/user') return h.get('authorization') === 'Bearer owner' || h.get('authorization') === 'Bearer member' ? json({ id: OWNER }) : json({}, 401);
    const table = url.pathname.replace('/rest/v1/', '');
    if (/^(action_globe_member_regions|action_globe_presence|fan_profiles|world_location_consents)$/.test(table)) throw new Error('privacy: ' + table + ' must never be read');
    if (fail.includes(table)) return json({ code: 'PGRST205', message: 'not found' }, 404);
    const q = url.searchParams;
    switch (table) {
      case 'orgs': return json([{ id: HOUSE }]);
      case 'org_members':
        if (q.get('role') === 'eq.owner') return json(owner && q.get('profile_id') === 'eq.' + OWNER ? [{ role: 'owner' }] : []);
        return json(data.house || []);
      case 'action_missions': return json(data.missions || []);
      case 'rpc/action_mission_stats': return json(data.stats || []);
      case 'rpc/action_globe_public_online_total': return json(data.online === undefined ? null : data.online);
      case 'action_mission_assignments': {
        if (q.get('user_id')) { const ids = inIds(q.get('user_id')); return json((data.memberAssignments || []).filter((a) => ids.includes(a.user_id))); }
        if (q.get('or')) return json(data.recent || []);
        return json(data.assignments || []);
      }
      case 'action_proofs': return json(data.proofs || []);
      case 'action_globe_mission_regions': return json(data.places || []);
      case 'm_auth_user_links': { const ids = inIds(q.get('auth_user_id')); return json((data.links || []).filter((l) => ids.includes(l.auth_user_id))); }
      case 'network_profiles': { const ids = inIds(q.get('m_uid')); return json((data.profiles || []).filter((p) => ids.includes(p.m_uid))); }
      case 'action_skill_progress': { const ids = inIds(q.get('m_uid')); return json((data.skills || []).filter((s) => ids.includes(s.m_uid))); }
      default: throw new Error('unexpected table ' + table);
    }
  };
}

/* ---------- mission fixtures ---------- */
const mission = (mid, status, minutesAgo, extra = {}) => ({ id: mid, campaign_id: 'equity-003', title: 'Mission ' + mid.slice(-2), description: 'Do the thing.', domain: 'community', kind: 'civic', skills: ['writing'], capacity: null, status, starts_at: null, ends_at: null, created_at: ago(minutesAgo + 100), updated_at: ago(minutesAgo), ...extra });
const MISSIONS = [
  mission(MA, 'open', 10, { title: 'T'.repeat(300), description: 'line one\u0000\u0007 line two ' + 'D'.repeat(1000), capacity: 20, skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'a'], starts_at: ago(1000), ends_at: 'not a date' }),
  mission(MB, 'open', 2 * 1440, { domain: 'Not A Word!', kind: null }),
  mission(MC, 'paused', 60),
  mission(MD, 'draft', 5, { capacity: -3 }),
  mission(ME, 'closed', 30),
  mission(MF, 'open', 1440),
  { id: 'not-a-uuid', title: 'bad id', status: 'open' },
  mission(M(7), 'archived', 1),
  mission(M(8), 'open', 1, { title: '   ' })
];
const STATS = [
  { mission_id: MA, capacity: 20, joined: 14, in_progress: 10, submitted: 2, verified: 1, rejected: 1, slots_left: 6 },
  { mission_id: MB, joined: 0, in_progress: 0, submitted: 0, verified: 0, rejected: 0 },
  { mission_id: MC, joined: 1, in_progress: 0, submitted: 1, verified: 0, rejected: 0 },
  { mission_id: ME, joined: 2, in_progress: 0, submitted: 0, verified: 2, rejected: 0 },
  { mission_id: MF, joined: 1, in_progress: 0, submitted: 1, verified: 0, rejected: 0 }
];
/* fourteen people on A, the newest first by their latest event; one withdrawn; one with no m_uid on the row */
const ASSIGNMENTS = [
  ...Array.from({ length: 13 }, (_, i) => ({ id: A(i + 1), mission_id: MA, m_uid: P(i + 1), user_id: U(i + 1), status: i < 9 ? 'in_progress' : 'joined', joined_at: ago(100 + i * 10), submitted_at: null, verified_at: null })),
  { id: A(14), mission_id: MA, m_uid: null, user_id: U(14), status: 'submitted', joined_at: ago(500), submitted_at: ago(2), verified_at: null },
  { id: A(15), mission_id: MA, m_uid: P(15), user_id: U(15), status: 'withdrawn', joined_at: ago(1), submitted_at: null, verified_at: null },
  { id: A(16), mission_id: MD, m_uid: P(1), user_id: U(1), status: 'joined', joined_at: ago(3), submitted_at: null, verified_at: null },
  { id: A(17), mission_id: MC, m_uid: P(2), user_id: U(2), status: 'submitted', joined_at: ago(300), submitted_at: ago(200), verified_at: null }
];
const proof = (n, mid, status, minutesAgo, extra = {}) => ({ id: PR(n), assignment_id: A(n), user_id: U(n), proof_type: 'text', status, statement: 'Proof ' + n, created_at: ago(minutesAgo), reviewed_at: status === 'pending' ? null : ago(minutesAgo - 1), proof_url: 'https://private.example/media/' + n, action_mission_assignments: { mission_id: mid, m_uid: P(n) }, ...extra });
const PROOFS = [
  ...Array.from({ length: 8 }, (_, i) => proof(i + 1, MA, i === 0 ? 'verified' : 'rejected', 20 + i, i === 1 ? { statement: 'S'.repeat(500) + '\u0001' } : {})),
  proof(9, MA, 'pending', 1, { proof_type: 'hologram' }),
  proof(10, MC, 'pending', 200, { action_mission_assignments: [{ mission_id: MC, m_uid: P(2) }] }),
  proof(11, MF, 'pending', 300),
  proof(12, MF, 'pending', 301),
  proof(14, MA, 'verified', 2, { action_mission_assignments: { mission_id: MA, m_uid: null } })
];
const PLACES = [
  { mission_id: MA, updated_at: ago(5), action_globe_regions: { region_label: 'Elsewhere', country_code: 'GB', centroid_lat: 51, centroid_lon: 0 } },
  { mission_id: MA, updated_at: ago(1), action_globe_regions: { region_label: 'Connecticut', country_code: 'us', centroid_lat: 41.6, centroid_lon: -72.7 } },
  { mission_id: MB, updated_at: ago(1), action_globe_regions: { region_label: 'Nowhere', country_code: 'US', centroid_lat: 200, centroid_lon: 0 } },
  { mission_id: ME, updated_at: ago(1), action_globe_regions: [{ region_label: 'Lagos', country_code: 'NGA', centroid_lat: 6.5, centroid_lon: 3.4 }] }
];
const PROFILES = [
  ...Array.from({ length: 15 }, (_, i) => ({ m_uid: P(i + 1), display_name: 'Person ' + (i + 1), avatar_url: `https://cdn.example/a${i + 1}.png`, headline: 'Organiser', location_text: 'Hartford, CT', email: `p${i + 1}@mail.example`, phone: '+1 555 0100' })),
  { m_uid: P(16), display_name: 'Linked Through Auth', avatar_url: '', headline: '' }
];
PROFILES[0].display_name = 'N'.repeat(200);
PROFILES[1].avatar_url = 'http://cdn.example/insecure.png';
PROFILES[3].avatar_url = 'javascript:alert(1)';
PROFILES[4].avatar_url = 'https://user:pw@cdn.example/a.png';
PROFILES[5].display_name = '  ';
const LINKS = [{ auth_user_id: U(14), m_uid: P(16) }];
const MISSION_DATA = { missions: MISSIONS, stats: STATS, assignments: ASSIGNMENTS, proofs: PROOFS, places: PLACES, profiles: PROFILES, links: LINKS };

/* ---------- the routes and the handler's own owner check ---------- */
test('the routes are exactly the four Halo operations paths, GET and HEAD only', async () => {
  const never = () => { throw new Error('no call'); };
  for (const p of ['/v1/world/halo', '/v1/world/halo/mission', '/v1/world/halo/missions/x', '/v1/world/layers/quakes', '/v1/world/layers/tidesx', '/v1/world/tides', '/v1/world/tide/8518750', '/v1/world/geocode']) {
    assert.equal(await handleHaloOps(req(p), ENV, { fetchImpl: never }), null, p);
  }
  assert.deepEqual([HALO_MISSIONS_PATH, HALO_PEOPLE_PATH, TIDES_LAYER_PATH], ['/v1/world/halo/missions', '/v1/world/halo/people', '/v1/world/layers/tides']);
  for (const p of [HALO_MISSIONS_PATH, HALO_PEOPLE_PATH, TIDES_LAYER_PATH, '/v1/world/tides/8518750']) {
    const r = await handleHaloOps(req(p, { method: 'POST' }), ENV, { fetchImpl: never });
    assert.equal(r.status, 405, p); headersOk(r);
  }
});

test('each handler re-checks the house owner itself: guests, members and an unreachable Supabase are refused, and nothing is read', async () => {
  for (const p of [HALO_MISSIONS_PATH, HALO_PEOPLE_PATH, TIDES_LAYER_PATH, '/v1/world/tides/8518750', '/v1/world/tides/bad']) {
    /* a guest, a signed-in member who is not the owner, a bearer Supabase rejects, and the owner while Supabase is unreachable */
    for (const [token, owner, offline] of [[null, true, false], ['member', false, false], ['nobody', true, false], ['owner', true, true]]) {
      const calls = [];
      const impl = offline ? async (u) => { calls.push({ url: String(u) }); throw new Error('offline'); } : supabase(MISSION_DATA, { owner, calls });
      const r = await handleHaloOps(req(p, { token }), ENV, { fetchImpl: impl, cacheImpl: memoryCache() });
      assert.equal(r.status, 403, `${p} ${token}`); headersOk(r);
      const b = await r.json();
      assert.equal(b.code, 'owner_only'); assert.equal(b.ok, false);
      assert.ok(!calls.some((c) => /action_|network_profiles|noaa/.test(c.url)), `${p} ${token}: no data read before the owner check`);
    }
  }
  /* without the service role the bearer cannot even be verified: refused */
  const r = await handleHaloOps(req(HALO_MISSIONS_PATH), { ALLOWED_ORIGINS: ORIGIN }, { fetchImpl: supabase(MISSION_DATA) });
  assert.equal(r.status, 403);
  assert.equal(await houseOwnerOf(req(HALO_MISSIONS_PATH), ENV, supabase({})).then((u) => u && u.id), OWNER);
  assert.equal(await houseOwnerOf(req(HALO_MISSIONS_PATH), ENV, supabase({}, { owner: false })), null);
});

/* ---------- missions ---------- */
test('missions: the answer shape, status mapping, review counting and order', async () => {
  const calls = [];
  const r = await handleHaloOps(req(HALO_MISSIONS_PATH), ENV, { fetchImpl: supabase(MISSION_DATA, { calls }) });
  assert.equal(r.status, 200); headersOk(r);
  const b = await r.json();
  assert.equal(b.schema, 'halo-missions/v1'); assert.ok(Date.parse(b.generated_at));
  assert.deepEqual(MISSION_STATUS, { open: 'active', draft: 'planned', paused: 'blocked', closed: 'completed' });
  assert.deepEqual(b.counts, { active: 3, planned: 1, blocked: 1, review: 2, completed: 1 }, 'bad id, unknown status and a blank title are dropped');
  assert.equal(b.total, 6); assert.equal(b.truncated, false);
  assert.deepEqual(b.missions.map((m) => m.id), [MC, MF, MA, MB, MD, ME], 'review first (newest updated first), then active, blocked, planned, completed');
  assert.deepEqual(b.missions.map((m) => m.status), ['blocked', 'active', 'active', 'active', 'planned', 'completed']);
  assert.deepEqual(b.missions.map((m) => m.review), [true, true, false, false, false, false]);
  assert.deepEqual(b.sources, { missions: 'ok', stats: 'ok', assignments: 'ok', proofs: 'ok', places: 'ok', profiles: 'ok' });
  for (const m of b.missions) {
    assert.deepEqual(Object.keys(m), ['id', 'title', 'description', 'campaign_id', 'domain', 'kind', 'skills', 'status', 'review', 'place', 'starts_at', 'ends_at', 'created_at', 'updated_at', 'capacity', 'counts', 'team', 'evidence', 'path']);
    assert.deepEqual(Object.keys(m.counts), ['joined', 'in_progress', 'submitted', 'verified', 'rejected', 'pending_proofs']);
  }
  /* service role on every Supabase read; never the anon key */
  const sb = calls.filter((c) => c.url.startsWith('https://sb.test/rest/v1/'));
  assert.ok(sb.length >= 6);
  for (const c of sb) { assert.equal(c.apikey, 'service-key', c.url); assert.equal(c.authorization, 'Bearer service-key', c.url); }
  assert.ok(!calls.some((c) => c.apikey === 'anon-key' || c.authorization === 'Bearer anon-key'));
  const mcall = calls.find((c) => c.path === '/rest/v1/action_missions');
  assert.equal(mcall.query.get('select'), 'id,campaign_id,title,description,domain,kind,skills,capacity,status,starts_at,ends_at,created_at,updated_at');
  assert.equal(calls.find((c) => c.path === '/rest/v1/rpc/action_mission_stats').method, 'POST');
  assert.equal(calls.find((c) => c.path === '/rest/v1/action_mission_assignments').query.get('status'), 'neq.withdrawn');
  assert.doesNotMatch(calls.find((c) => c.path === '/rest/v1/action_proofs').query.get('select'), /proof_url|metadata|review_note/, 'proof media and reviewer notes are never read');
});

test('missions: counts, team, evidence, place, path and string caps', async () => {
  const b = await haloMissions(ENV, supabase(MISSION_DATA));
  const by = Object.fromEntries(b.missions.map((m) => [m.id, m]));
  const a = by[MA];
  assert.equal(a.title.length, 160);
  assert.equal(a.description.length, 280); assert.ok(a.description.startsWith('line one'), a.description.slice(0, 20)); assert.doesNotMatch(a.description, /[\u0000-\u001f\u007f-\u009f]/, 'control characters stripped');
  assert.deepEqual(a.skills, ['a', 'b', 'c', 'd', 'e', 'f'], 'six skills, no repeats');
  assert.equal(a.capacity, 20); assert.equal(by[MD].capacity, null, 'a capacity below one is null');
  assert.equal(a.starts_at, MISSIONS[0].starts_at); assert.equal(a.ends_at, null, 'an unparseable time is null');
  assert.equal(a.domain, 'community'); assert.equal(a.kind, 'civic'); assert.equal(by[MB].domain, null); assert.equal(by[MB].kind, null);
  assert.deepEqual(a.counts, { joined: 14, in_progress: 10, submitted: 2, verified: 1, rejected: 1, pending_proofs: 0 }, 'from action_mission_stats; the hologram proof is not a proof type');
  assert.deepEqual(by[MD].counts, { joined: 1, in_progress: 1, submitted: 0, verified: 0, rejected: 0, pending_proofs: 0 }, 'a draft the RPC hides is counted from its assignments');
  assert.equal(by[MF].counts.pending_proofs, 2); assert.equal(by[MC].counts.pending_proofs, 1);
  /* team: non-withdrawn, most recent activity first, 12 at most */
  assert.equal(a.team.length, 12);
  assert.ok(!a.team.some((t) => t.m_uid === P(15)), 'the withdrawn assignment is not on the team');
  assert.deepEqual(a.team[0], { m_uid: P(16), name: 'Linked Through Auth', avatar_url: null, status: 'submitted', since: ASSIGNMENTS[13].joined_at }, 'the row without an m_uid is named through m_auth_user_links; its submission is the newest activity');
  assert.deepEqual(a.team.slice(1).map((t) => t.m_uid), Array.from({ length: 11 }, (_, i) => P(i + 1)));
  assert.equal(a.team[1].name.length, 80, 'names capped at 80');
  assert.equal(a.team[2].avatar_url, null, 'an http avatar is dropped');
  assert.equal(a.team[3].avatar_url, 'https://cdn.example/a3.png');
  assert.equal(a.team[4].avatar_url, null, 'a javascript: avatar is dropped');
  assert.equal(a.team[5].avatar_url, null, 'an avatar with credentials is dropped');
  assert.equal(a.team[6].name, null, 'a blank display name is null, never invented');
  for (const t of a.team) assert.deepEqual(Object.keys(t), ['m_uid', 'name', 'avatar_url', 'status', 'since']);
  /* evidence: newest first, 6 at most, statement capped, no media */
  assert.equal(a.evidence.length, 6);
  assert.deepEqual(a.evidence.map((e) => e.id), [PR(14), PR(1), PR(2), PR(3), PR(4), PR(5)]);
  assert.equal(a.evidence[0].by, 'Linked Through Auth');
  assert.equal(a.evidence[0].m_uid, P(16), "the submitter's m_uid, through m_auth_user_links when the row has none");
  assert.deepEqual(a.evidence.slice(1).map((e) => e.m_uid), [P(1), P(2), P(3), P(4), P(5)]);
  assert.equal(a.evidence[2].statement.length, 140);
  assert.deepEqual(Object.keys(a.evidence[0]), ['id', 'type', 'status', 'created_at', 'reviewed_at', 'by', 'm_uid', 'statement']);
  assert.doesNotMatch(JSON.stringify(b), /private\.example/, 'proof URLs never leave');
  /* place: the region's label, country and centroid; the newest row wins; bad centroids are null */
  assert.deepEqual(a.place, { label: 'Connecticut', country: 'US', lat: 41.6, lon: -72.7 });
  assert.equal(by[MB].place, null); assert.equal(by[MC].place, null);
  assert.deepEqual(by[ME].place, { label: 'Lagos', country: null, lat: 6.5, lon: 3.4 }, 'a country code that is not two letters is null');
  /* path: the public mission page, never for a draft */
  assert.equal(a.path, `mnet.html?mission=${MA}`); assert.equal(by[MD].path, null); assert.equal(by[ME].path, `mnet.html?mission=${ME}`);
});

test('missions: a failed read degrades only its own field, honestly', async () => {
  const noStats = await haloMissions(ENV, supabase(MISSION_DATA, { fail: ['rpc/action_mission_stats'] }));
  assert.equal(noStats.sources.stats, 'unavailable');
  const a = noStats.missions.find((m) => m.id === MA);
  assert.deepEqual(a.counts, { joined: 14, in_progress: 13, submitted: 1, verified: 0, rejected: 0, pending_proofs: 0 }, 'counted from the assignments read');
  const noProofs = await haloMissions(ENV, supabase(MISSION_DATA, { fail: ['action_proofs'] }));
  assert.equal(noProofs.counts.review, null); assert.equal(noProofs.sources.proofs, 'unavailable');
  for (const m of noProofs.missions) { assert.equal(m.review, null); assert.equal(m.evidence, null); assert.equal(m.counts.pending_proofs, null); }
  assert.deepEqual(noProofs.missions.map((m) => m.id), [MA, MF, MB, MC, MD, ME], 'with review unknown, status order alone (newest updated first)');
  const noAssign = await haloMissions(ENV, supabase(MISSION_DATA, { fail: ['action_mission_assignments', 'rpc/action_mission_stats'] }));
  for (const m of noAssign.missions) { assert.equal(m.team, null); assert.equal(m.counts.joined, null); }
  const noPlaces = await haloMissions(ENV, supabase(MISSION_DATA, { fail: ['action_globe_mission_regions', 'network_profiles'] }));
  assert.ok(noPlaces.missions.every((m) => m.place === null)); assert.equal(noPlaces.sources.places, 'unavailable'); assert.equal(noPlaces.sources.profiles, 'unavailable');
  assert.ok(noPlaces.missions.find((m) => m.id === MA).team.every((t) => t.name === null && t.avatar_url === null));
  const down = await haloMissions(ENV, supabase(MISSION_DATA, { fail: ['action_missions'] }));
  assert.equal(down.unavailable, true); assert.equal(down.upstream_error, 'supabase_unavailable');
  assert.deepEqual(down.missions, []); assert.deepEqual(down.counts, { active: 0, planned: 0, blocked: 0, review: 0, completed: 0 });
});

test('missions: at most 200, the review ones kept first; truncation said', async () => {
  const many = Array.from({ length: 250 }, (_, i) => mission(M(100 + i), 'closed', i));
  many.push(mission(M(999), 'paused', 99999));
  const pending = [proof(1, M(999), 'pending', 1)];
  const b = await haloMissions(ENV, supabase({ missions: many, proofs: pending }));
  assert.equal(b.missions.length, 200); assert.equal(b.total, 251); assert.equal(b.truncated, true);
  assert.equal(b.missions[0].id, M(999), 'the oldest mission is first because it waits for review');
  assert.equal(b.counts.completed, 250); assert.equal(b.counts.review, 1);
});

/* ---------- people ---------- */
const STAFF = id('99999999', 2), VIEWER = id('99999999', 3), UNLINKED = id('99999999', 4), UQ = U(50);
const PEOPLE_DATA = {
  house: [{ profile_id: OWNER, role: 'owner' }, { profile_id: STAFF, role: 'staff' }, { profile_id: VIEWER, role: 'viewer' }, { profile_id: UNLINKED, role: 'viewer' }, { profile_id: 'nope', role: 'owner' }],
  links: [{ auth_user_id: OWNER, m_uid: P(90) }, { auth_user_id: STAFF, m_uid: P(91) }, { auth_user_id: VIEWER, m_uid: P(92) }, { auth_user_id: UQ, m_uid: P(50) }],
  recent: [
    { id: A(1), mission_id: MA, m_uid: P(91), user_id: STAFF, status: 'in_progress', joined_at: ago(120), submitted_at: null, verified_at: null, action_missions: { title: 'Write a memo', status: 'open' }, action_proofs: null },
    { id: A(2), mission_id: MA, m_uid: P(1), user_id: U(1), status: 'submitted', joined_at: ago(600), submitted_at: ago(60), verified_at: null, action_missions: { title: 'Write a memo', status: 'open' }, action_proofs: { status: 'pending', reviewed_at: null } },
    { id: A(3), mission_id: MB, m_uid: P(2), user_id: U(2), status: 'verified', joined_at: ago(9000), submitted_at: ago(5000), verified_at: ago(3 * 1440), action_missions: [{ title: 'Give a ride', status: 'open' }], action_proofs: [{ status: 'verified', reviewed_at: ago(3 * 1440) }] },
    { id: A(4), mission_id: MB, m_uid: P(3), user_id: U(3), status: 'rejected', joined_at: ago(9000), submitted_at: ago(600), verified_at: null, action_missions: { title: 'Give a ride', status: 'open' }, action_proofs: { status: 'rejected', reviewed_at: ago(30) } },
    { id: A(5), mission_id: MC, m_uid: null, user_id: UQ, status: 'joined', joined_at: ago(10), submitted_at: null, verified_at: null, action_missions: { title: 'T'.repeat(400), status: 'paused' } },
    ...Array.from({ length: 7 }, (_, i) => ({ id: A(10 + i), mission_id: M(10 + i), m_uid: P(6), user_id: U(6), status: 'verified', joined_at: ago(20000), submitted_at: ago(15000), verified_at: ago((5 + i) * 1440), action_missions: { title: 'Mission ' + i, status: 'closed' } })),
    { id: A(20), mission_id: MA, m_uid: P(7), user_id: U(7), status: 'withdrawn', joined_at: ago(5), action_missions: { title: 'x', status: 'open' } },
    { id: A(21), mission_id: MA, m_uid: null, user_id: U(99), status: 'joined', joined_at: ago(5), action_missions: { title: 'x', status: 'open' } }
  ],
  memberAssignments: [
    { id: A(30), mission_id: ME, m_uid: P(90), user_id: OWNER, status: 'verified', joined_at: ago(300 * 1440), submitted_at: ago(250 * 1440), verified_at: ago(200 * 1440), action_missions: { title: 'Old mission', status: 'closed' } },
    { id: A(1), mission_id: MA, m_uid: P(91), user_id: STAFF, status: 'in_progress', joined_at: ago(120), submitted_at: null, verified_at: null, action_missions: { title: 'Write a memo', status: 'open' } }
  ],
  profiles: [
    { m_uid: P(1), display_name: 'Ada', avatar_url: 'https://cdn.example/ada.png', headline: 'H'.repeat(300), location_text: 'Hartford, CT', email: 'ada@mail.example', phone: '+1 555 0100' },
    { m_uid: P(2), display_name: 'Bo', avatar_url: 'http://cdn.example/bo.png', headline: '' },
    { m_uid: P(90), display_name: 'The Owner', avatar_url: null, headline: 'Founder' },
    { m_uid: P(91), display_name: 'Staff Person', avatar_url: 'https://cdn.example/s.png', headline: 'Desk' }
  ],
  skills: [
    ...['research', 'writing', 'policy', 'design', 'film', 'audio', 'code', 'law'].map((skill, i) => ({ m_uid: P(1), skill, xp: 100 - i * 10 })),
    { m_uid: P(1), skill: 'tiny', xp: 1 }, { m_uid: P(2), skill: 'driving', xp: 'lots' }
  ],
  online: 4
};

test('people: house members and recent participants, with roles, state, skills and missions', async () => {
  const calls = [];
  const r = await handleHaloOps(req(HALO_PEOPLE_PATH), ENV, { fetchImpl: supabase(PEOPLE_DATA, { calls }) });
  assert.equal(r.status, 200); headersOk(r);
  const b = await r.json();
  assert.equal(b.schema, 'halo-people/v1'); assert.ok(Date.parse(b.generated_at));
  assert.deepEqual(b.counts, { people: 8, on_mission: 2, available: 5, awaiting_review: 1 });
  assert.equal(b.online, null, 'under five online, the total is null');
  assert.equal(b.unresolved, 2, 'a house member and a participant with no M Account link are counted, not shown');
  assert.deepEqual(b.people.map((p) => p.m_uid), [P(50), P(91), P(1), P(3), P(2), P(6), P(90), P(92)], 'on mission, awaiting review, available; latest activity first');
  const by = Object.fromEntries(b.people.map((p) => [p.m_uid, p]));
  assert.deepEqual([by[P(90)].role, by[P(91)].role, by[P(92)].role, by[P(1)].role], ['owner', 'admin', 'member', 'participant'], 'owner; staff reads as admin; viewer as member; everyone else a participant');
  assert.deepEqual([by[P(50)].state, by[P(91)].state, by[P(1)].state, by[P(3)].state], ['on_mission', 'on_mission', 'awaiting_review', 'available']);
  assert.deepEqual([by[P(50)].last_activity, by[P(91)].last_activity, by[P(1)].last_activity, by[P(3)].last_activity, by[P(2)].last_activity, by[P(90)].last_activity, by[P(92)].last_activity], ['joined', 'started', 'submitted', 'rejected', 'verified', 'verified', null]);
  assert.equal(by[P(3)].last_activity_at, PEOPLE_DATA.recent[3].action_proofs.reviewed_at, 'a rejection is dated by the review');
  assert.equal(by[P(90)].last_activity_at, PEOPLE_DATA.memberAssignments[0].verified_at, "a house member's older assignment is read too");
  assert.equal(by[P(92)].last_activity_at, null);
  assert.deepEqual(by[P(1)].skills, ['research', 'writing', 'policy', 'design', 'film', 'audio'], 'the top six by XP');
  assert.deepEqual(by[P(2)].skills, ['driving']);
  assert.equal(by[P(6)].missions.length, 5, 'five missions at most');
  assert.deepEqual(by[P(50)].missions, [{ id: MC, title: 'T'.repeat(160), status: 'joined' }]);
  assert.deepEqual(by[P(1)].missions, [{ id: MA, title: 'Write a memo', status: 'submitted' }]);
  assert.equal(by[P(1)].name, 'Ada'); assert.equal(by[P(1)].headline.length, 120); assert.equal(by[P(1)].avatar_url, 'https://cdn.example/ada.png');
  assert.equal(by[P(2)].avatar_url, null, 'an http avatar is dropped'); assert.equal(by[P(2)].headline, null);
  assert.equal(by[P(50)].name, null, 'no profile, no name: never invented');
  for (const p of b.people) {
    assert.deepEqual(Object.keys(p), ['m_uid', 'name', 'avatar_url', 'headline', 'role', 'skills', 'missions', 'state', 'last_activity_at', 'last_activity', 'location_shared']);
    assert.equal(p.location_shared, false);
  }
  assert.deepEqual(b.sources, { house: 'ok', assignments: 'ok', reviewed: 'ok', member_assignments: 'ok', profiles: 'ok', skills: 'ok', online: 'ok' });
  /* the 90-day window and the service role */
  const recent = calls.find((c) => c.path === '/rest/v1/action_mission_assignments' && c.query.get('or'));
  assert.match(recent.query.get('or'), /^\(joined_at\.gte\."[^",]+",submitted_at\.gte\."[^",]+",verified_at\.gte\."[^",]+"\)$/, 'timestamps quoted: PostgREST reserves : and . in or=()');
  const since = Date.parse(recent.query.get('or').match(/joined_at\.gte\."([^"]+)",/)[1]);
  assert.ok(Math.abs(Date.now() - since - 90 * 86400000) < 60000, 'ninety days');
  for (const c of calls.filter((c) => c.url.startsWith('https://sb.test/rest/v1/'))) assert.equal(c.apikey, 'service-key');
});

test('people: PRIVACY. No per-person location, presence, contact or region anywhere in the answer, and none of it is read', async () => {
  const calls = [];
  const b = await haloPeople(ENV, supabase({ ...PEOPLE_DATA, online: 7 }, { calls }));
  const keys = [...keysOf(b)];
  const forbidden = keys.filter((k) => /region|presence|seen|^lat$|^lon$|lng|latitude|longitude|coord|geo|^location(?!_shared$)|address|email|phone|city|country|postal/i.test(k));
  assert.deepEqual(forbidden, [], 'forbidden keys: ' + forbidden.join(', '));
  const text = JSON.stringify(b);
  assert.doesNotMatch(text, /Hartford|mail\.example|555 0100/, 'location text, email and phone never leave');
  assert.ok(b.people.every((p) => p.location_shared === false));
  assert.equal(b.online, 7, 'the k-anonymous total at five or more');
  const profileRead = calls.find((c) => c.path === '/rest/v1/network_profiles');
  assert.equal(profileRead.query.get('select'), 'm_uid,display_name,avatar_url,headline', 'location_text is not even read');
  assert.ok(!calls.some((c) => /action_globe_member_regions|action_globe_presence|action_globe_regions|fan_profiles/.test(c.url)), 'member regions and presence are never read');
  assert.ok(calls.some((c) => c.path === '/rest/v1/rpc/action_globe_public_online_total' && c.method === 'POST'));
});

test('people: the online total is null under five, null when the RPC fails, and never negative or fractional', async () => {
  assert.equal(onlineOf(null), null); assert.equal(onlineOf(4), null); assert.equal(onlineOf(5), 5); assert.equal(onlineOf('12'), 12); assert.equal(onlineOf(-9), null); assert.equal(onlineOf(Infinity), null); assert.equal(onlineOf([6]), 6);
  const down = await haloPeople(ENV, supabase(PEOPLE_DATA, { fail: ['rpc/action_globe_public_online_total'] }));
  assert.equal(down.online, null); assert.equal(down.sources.online, 'unavailable');
  const quiet = await haloPeople(ENV, supabase({ ...PEOPLE_DATA, online: null }));
  assert.equal(quiet.online, null); assert.equal(quiet.sources.online, 'ok', 'null under five is an answer, not a failure');
});

test('people: at most 200; degraded reads are said; both sources down is unavailable', async () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ id: A(1000 + i), mission_id: MA, m_uid: P(1000 + i), user_id: U(1000 + i), status: 'verified', joined_at: ago(5000), submitted_at: ago(4000), verified_at: ago(i + 1), action_missions: { title: 'm', status: 'open' } }));
  const b = await haloPeople(ENV, supabase({ recent: many }));
  assert.equal(b.people.length, 200); assert.equal(b.total, 250); assert.equal(b.truncated, true); assert.equal(b.counts.people, 250);
  assert.equal(b.people[0].m_uid, P(1000), 'most recent activity first');
  const noSkills = await haloPeople(ENV, supabase(PEOPLE_DATA, { fail: ['action_skill_progress', 'network_profiles'] }));
  assert.ok(noSkills.people.every((p) => p.skills === null && p.name === null));
  assert.equal(noSkills.sources.skills, 'unavailable'); assert.equal(noSkills.sources.profiles, 'unavailable');
  const noHouse = await haloPeople(ENV, supabase(PEOPLE_DATA, { fail: ['org_members'] }));
  assert.equal(noHouse.sources.house, 'unavailable');
  assert.ok(noHouse.people.every((p) => p.role === 'participant'));
  const down = await haloPeople(ENV, supabase(PEOPLE_DATA, { fail: ['org_members', 'action_mission_assignments'] }));
  assert.equal(down.unavailable, true); assert.deepEqual(down.people, []); assert.deepEqual(down.counts, { people: 0, on_mission: 0, available: 0, awaiting_review: 0 });
});

test('avatars are kept only as https URLs without credentials', () => {
  assert.equal(httpsUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
  for (const v of ['http://cdn.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', 'https://u:p@cdn.example/a', 'https://cdn.example:8443/a', '//cdn.example/a', '', null, 42, 'https://' + 'a'.repeat(600)]) assert.equal(httpsUrl(v), null, String(v));
});

test('a participant whose only recent activity is a reviewed proof is in the People window (Codex #588)', async () => {
  const OLD = { id: A(40), mission_id: MB, m_uid: P(40), user_id: U(40), status: 'rejected', joined_at: ago(200 * 1440), submitted_at: ago(150 * 1440), verified_at: null, action_missions: { title: 'Give a ride', status: 'open' }, action_proofs: { status: 'rejected', reviewed_at: ago(10 * 1440) } };
  const calls = [];
  const b = await haloPeople(ENV, supabase({ ...PEOPLE_DATA, proofs: [{ assignment_id: A(40) }, { assignment_id: A(2) }, { assignment_id: 'nope' }], assignments: [OLD] }, { calls }));
  const p = b.people.find((x) => x.m_uid === P(40));
  assert.ok(p, 'the rejected participant is listed');
  assert.equal(p.last_activity, 'rejected');
  assert.equal(p.last_activity_at, OLD.action_proofs.reviewed_at, 'dated by the review, inside the window');
  const byId = calls.filter((c) => c.path === '/rest/v1/action_mission_assignments' && c.query.get('id'));
  assert.equal(byId.length, 1);
  assert.equal(byId[0].query.get('id'), 'in.(' + A(40) + ')', 'only the assignments not already read are asked for, by valid id');
  assert.match(calls.find((c) => c.path === '/rest/v1/action_proofs').query.get('reviewed_at'), /^gte\.\d{4}-/);
  assert.equal(b.sources.reviewed, 'ok');
});

/* ---------- NOAA water levels ---------- */
const STATIONS = { count: 7, units: null, self: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels', stations: [
  { tidal: true, greatlakes: false, state: 'NY', timezone: 'EST', id: '8518750', name: 'The Battery', lat: 40.7006, lng: -74.0142, affiliations: 'NWLON', details: { self: 'https://api.tidesandcurrents.noaa.gov/x' } },
  { id: 8443970, name: 'Boston', lat: 42.3539, lng: -71.0503, state: 'MA' },
  { id: '123', name: 'Short id', lat: 1, lng: 1, state: 'XX' },
  { id: '9999999', name: 'Off the Earth', lat: 95, lng: 1, state: 'XX' },
  { id: '8518750', name: 'Duplicate', lat: 1, lng: 1 },
  { id: '1611400', name: 'N'.repeat(300) + '\u0000', lat: 21.954, lng: -159.356, state: 'United States of America and its territories, at length' },
  { id: '9410170', name: '', lat: '32.71', lng: '-117.17', state: null }
] };
const minute = (msAgo) => { const d = new Date(Math.floor((NOW - msAgo) / 60000) * 60000); return d.toISOString().slice(0, 16).replace('T', ' '); };
function water({ id: sid = '8518750', rows = 240, newestMinutesAgo = 6, extra = [] } = {}) {
  const data = Array.from({ length: rows }, (_, i) => ({ t: minute((newestMinutesAgo + (rows - 1 - i) * 6) * 60000), v: (1 + i / 1000).toFixed(3), s: '0.03', f: '1,0,0,0', q: i % 2 ? 'p' : 'v' }));
  return { metadata: { id: sid, name: 'The Battery', lat: '40.7006', lon: '-74.0142' }, data: [...data, ...extra] };
}
function noaa(handler) {
  return supabase({ other: (url) => handler(url) });
}
function tidesFetch(body, { status = 200 } = {}) {
  return workersFetch(noaa((url) => {
    if (url.hostname !== 'api.tidesandcurrents.noaa.gov') throw new Error('unexpected ' + url);
    if (status !== 200) return new Response('down', { status });
    return json(typeof body === 'function' ? body(url) : body);
  }));
}

test('tides stations: seven-digit ids, valid positions, capped names, one call per 24 h', async () => {
  const cache = memoryCache(), fetchImpl = tidesFetch(STATIONS);
  const r = await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(r.status, 200); headersOk(r);
  const b = await r.json();
  assert.equal(b.layer, 'tides'); assert.equal(b.credit, 'NOAA CO-OPS'); assert.equal(b.stale, false); assert.ok(Date.parse(b.fetched_at));
  assert.equal(b.license, 'Public domain (U.S. Government work)'); assert.equal(b.attribution_url, 'https://tidesandcurrents.noaa.gov');
  assert.deepEqual(b.stations.map((s) => s[0]), ['8518750', '8443970', '1611400', '9410170'], 'short ids, off-Earth positions and duplicates are dropped; a numeric id is read');
  assert.deepEqual(b.stations[0], ['8518750', 'The Battery', -74.0142, 40.7006, 'NY']);
  assert.equal(b.stations[2][1].length, 120); assert.equal(b.stations[2][4].length, 40);
  assert.deepEqual(b.stations[3], ['9410170', '9410170', -117.17, 32.71, null], 'a nameless station is named by its id; string coordinates are read');
  assert.equal(b.count, 4); assert.equal(b.total, 7);
  const noaaCalls = fetchImpl.calls.filter((c) => c.url.includes('noaa'));
  assert.deepEqual(noaaCalls.map((c) => c.url), [TIDES.stationsUrl]);
  for (const c of noaaCalls) assert.equal(c.init.redirect, 'manual');
  age(cache, TIDES.stationsTtl - 60);
  await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl, cacheImpl: cache });
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('noaa')).length, 1, 'inside the 24 h window NOAA is not asked again');
  assert.equal(normalizeStation({ id: '12345678', lat: 1, lng: 1 }), null);
  assert.equal(normalizeStation({ id: '1234567', lat: null, lng: 1 }), null);
});

test('tides stations: down serves the last good list stale; nothing kept is unavailable and nothing stored', async () => {
  const cache = memoryCache();
  const good = await (await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl: tidesFetch(STATIONS), cacheImpl: cache })).json();
  age(cache, TIDES.stationsTtl + 60);
  const stale = await (await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl: tidesFetch(null, { status: 503 }), cacheImpl: cache })).json();
  assert.equal(stale.stale, true); assert.equal(stale.upstream_error, 'upstream_http'); assert.deepEqual(stale.stations, good.stations);
  const fresh = memoryCache();
  const empty = await (await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl: tidesFetch(null, { status: 503 }), cacheImpl: fresh })).json();
  assert.equal(empty.unavailable, true); assert.equal(empty.count, 0); assert.deepEqual(empty.stations, []); assert.equal(empty.fetched_at, null); assert.equal(empty.credit, 'NOAA CO-OPS');
  assert.equal(fresh.raw.size, 0);
  const junk = await (await handleHaloOps(req(TIDES_LAYER_PATH), ENV, { fetchImpl: tidesFetch({ stations: 'no' }), cacheImpl: memoryCache() })).json();
  assert.equal(junk.unavailable, true); assert.equal(junk.upstream_error, 'upstream_invalid_json');
});

test('water level: a malformed station id is a 400 and NOAA is not asked', async () => {
  for (const bad of ['12345', 'abcdefg', '12345678', '851875%30', '8518750x', '-851875']) {
    const fetchImpl = tidesFetch(water());
    const r = await handleHaloOps(req('/v1/world/tides/' + bad), ENV, { fetchImpl, cacheImpl: memoryCache() });
    assert.equal(r.status, 400, bad); headersOk(r);
    assert.equal((await r.json()).code, 'invalid_station');
    assert.ok(!fetchImpl.calls.some((c) => c.url.includes('noaa')), bad);
  }
});

test('water level: observed, MLLW, metres; quality mapped; bad, future and repeated readings dropped; oldest first; the latest alone', async () => {
  const extra = [
    { t: minute(3 * 60000), v: '', q: 'p' }, { t: minute(3 * 60000), v: 'abc', q: 'p' }, { t: '2026-13-40 99:99', v: '1.0', q: 'p' },
    { t: minute(-120 * 60000), v: '1.0', q: 'p' }, { t: minute(4 * 60000), v: '150', q: 'p' }, { t: 'yesterday', v: '1', q: 'v' },
    { t: minute(1 * 60000), v: '0.5', q: 'x' }, { t: minute(1 * 60000), v: '0.6', q: 'p' }
  ];
  const fetchImpl = tidesFetch(water({ extra }));
  const r = await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl, cacheImpl: memoryCache() });
  assert.equal(r.status, 200); headersOk(r);
  const b = await r.json();
  assert.deepEqual(fetchImpl.calls.filter((c) => c.url.includes('noaa')).map((c) => c.url), [waterLevelUrl('8518750')]);
  assert.equal(waterLevelUrl('8518750'), 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=mccluster&station=8518750&datum=MLLW&units=metric&time_zone=gmt&format=json&range=24');
  assert.equal(b.schema, 'halo-water-level/v1'); assert.equal(b.product, 'observed_water_level'); assert.equal(b.datum, 'MLLW'); assert.equal(b.units, 'm');
  assert.equal(b.note, 'Observed water level, not a tide prediction.');
  assert.deepEqual(b.station, { id: '8518750', name: 'The Battery', lat: 40.7006, lon: -74.0142 });
  assert.equal(b.stale, false); assert.equal(b.stale_reason, undefined); assert.ok(Date.parse(b.fetched_at));
  assert.equal(b.dropped, 7, 'blank, non-numeric, malformed, future, out-of-range, unparseable and repeated readings');
  assert.equal(b.count, 241); assert.equal(b.observations.length, 241);
  for (let i = 1; i < b.observations.length; i += 1) assert.ok(b.observations[i - 1][0] < b.observations[i][0], 'oldest first');
  for (const [iso, v, q] of b.observations) { assert.ok(Date.parse(iso)); assert.ok(Number.isFinite(v)); assert.ok(['preliminary', 'verified', 'unknown'].includes(q)); }
  assert.deepEqual(b.latest, { value: 0.5, observed_at: b.observations[240][0], quality: 'unknown' }, "the first of two readings at a minute is kept; quality 'x' is unknown");
  assert.equal(b.observations[0][2], 'verified'); assert.equal(b.observations[1][2], 'preliminary');
  assert.equal(b.credit, 'NOAA CO-OPS'); assert.equal(b.source_url, 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8518750');
});

test('water level: at most 300 observations, the newest kept', () => {
  const out = normalizeWaterLevel(water({ rows: 400 }), '8518750', NOW);
  assert.equal(out.observations.length, 300); assert.equal(out.truncated, true); assert.equal(out.total, 400);
  assert.throws(() => normalizeWaterLevel(water({ rows: 501 }), '8518750', NOW), (e) => e.code === 'upstream_invalid_json', 'over 500 rows is not the answer asked for');
  assert.throws(() => normalizeWaterLevel(water({ id: '8443970' }), '8518750', NOW), (e) => e.code === 'upstream_invalid_station');
  assert.throws(() => normalizeWaterLevel({ ...water(), metadata: { id: '8518750', lat: 'x', lon: '1' } }, '8518750', NOW), (e) => e.code === 'upstream_invalid_station');
  assert.throws(() => normalizeWaterLevel({ error: { message: 'No data was found. This product may not be offered at this station at the requested time.' } }, '8518750', NOW), (e) => e.code === 'upstream_no_data');
  assert.throws(() => normalizeWaterLevel({ error: { message: ' The station is not a valid station or there is system error.' } }, '8518750', NOW), (e) => e.code === 'upstream_error_payload');
  assert.throws(() => normalizeWaterLevel(water({ rows: 0 }), '8518750', NOW), (e) => e.code === 'upstream_empty');
});

test('water level: an observation older than 30 minutes is stale, said so', async () => {
  const b = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: tidesFetch(water({ newestMinutesAgo: 90 })), cacheImpl: memoryCache() })).json();
  assert.equal(b.stale, true); assert.equal(b.stale_reason, 'observation_older_than_30_minutes'); assert.equal(b.upstream_error, undefined);
  assert.ok(b.latest && b.observations.length);
});

test('water level: kept 6 minutes per station; provider down serves the last good answer stale for an hour, then unavailable', async () => {
  const cache = memoryCache(), up = tidesFetch(water());
  const good = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: up, cacheImpl: cache })).json();
  assert.ok([...cache.raw.keys()].includes('https://cache.mccluster.internal/world/layers/tides/8518750'), 'one cache entry per station');
  age(cache, TIDES.waterTtl - 30);
  await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: up, cacheImpl: cache });
  assert.equal(up.calls.filter((c) => c.url.includes('noaa')).length, 1, 'inside 6 minutes NOAA is not asked again');
  age(cache, 60);
  const down = tidesFetch(null, { status: 503 });
  const stale = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: down, cacheImpl: cache })).json();
  assert.equal(stale.stale, true); assert.equal(stale.stale_reason, 'provider_unavailable'); assert.equal(stale.upstream_error, 'upstream_http');
  assert.deepEqual(stale.observations, good.observations); assert.deepEqual(stale.latest, good.latest);
  age(cache, 3600);
  const gone = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: down, cacheImpl: cache })).json();
  assert.equal(gone.unavailable, true, "past Halo's one-hour limit the kept answer is not served");
  assert.equal(gone.latest, null); assert.deepEqual(gone.observations, []); assert.equal(gone.stale, false);
  const fresh = memoryCache();
  const none = await (await handleHaloOps(req('/v1/world/tides/8443970'), ENV, { fetchImpl: down, cacheImpl: fresh })).json();
  assert.deepEqual(none.station, { id: '8443970', name: null, lat: null, lon: null });
  assert.equal(none.unavailable, true); assert.equal(none.latest, null); assert.equal(none.fetched_at, null); assert.equal(none.upstream_error, 'upstream_http');
  assert.equal(none.note, 'Observed water level, not a tide prediction.');
  assert.equal(fresh.raw.size, 0, 'a failure is never stored');
  const empty = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: tidesFetch(water({ rows: 0 })), cacheImpl: memoryCache() })).json();
  assert.equal(empty.unavailable, true); assert.equal(empty.upstream_error, 'upstream_empty', 'no usable reading is unavailable, never zero');
  const other = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: tidesFetch(water({ id: '8443970' })), cacheImpl: memoryCache() })).json();
  assert.equal(other.unavailable, true); assert.equal(other.upstream_error, 'upstream_invalid_station');
});

test('water level: the answer helper never invents a reading', () => {
  const none = waterLevelAnswer('8518750', { unavailable: true, upstream_error: 'upstream_timeout' }, false, NOW);
  assert.equal(none.latest, null); assert.equal(none.unavailable, true); assert.equal(none.upstream_error, 'upstream_timeout');
  const odd = waterLevelAnswer('8518750', { fetched_at: new Date(NOW).toISOString(), station: { id: '8518750', name: 'x', lat: 1, lon: 1 }, observations: [] }, false, NOW);
  assert.equal(odd.unavailable, true, 'a kept answer without observations is not a reading');
});

test('a too-large NOAA answer is refused, not parsed', async () => {
  const big = { metadata: { id: '8518750', name: 'x', lat: '1', lon: '1' }, data: [], pad: 'x'.repeat(300000) };
  const b = await (await handleHaloOps(req('/v1/world/tides/8518750'), ENV, { fetchImpl: tidesFetch(big), cacheImpl: memoryCache() })).json();
  assert.equal(b.unavailable, true); assert.equal(b.upstream_error, 'upstream_too_large');
});
