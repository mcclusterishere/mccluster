/* Current release policy: world-release.js requires live house-owner preview
   before dispatch. packages/release-policy/globe.mjs maps every path below to
   an owner-only globe feature ('halo-ops', 'tides'); nothing in this file
   publishes a feed, and every handler re-checks the house owner itself. */
/* HITMAN'S HALO OPERATIONS ON THE ADMIN GLOBE: the house owner's missions,
   people and coastal water levels, served through the canonical Worker
   (owner direction 2026-10-16: Halo belongs to internal intelligence, not a
   public or paid globe; docs/control-plane/HALO-ADMIN-GLOBE.md).

     GET /v1/world/halo/missions     every mission: team, evidence, place     Supabase, service role   feature 'halo-ops'
     GET /v1/world/halo/people       house members and recent participants    Supabase, service role   feature 'halo-ops'
     GET /v1/world/layers/tides      NOAA water-level stations                NOAA CO-OPS metadata     feature 'tides'
     GET /v1/world/tides/:station    one station's observed water level, 24 h NOAA CO-OPS data         feature 'tides'

   OWNER ONLY, TWICE. The release guard refuses everyone but the house owner
   before dispatch (403 admin_preview). Each handler then verifies the bearer
   with Supabase itself (bearerUser) and asks isHouseOwner again (org_members
   owner of 'mccluster'), so a route reached any other way still refuses (403
   owner_only) and fails closed when Supabase cannot answer. Every answer is
   `private, no-store`, varying on Origin and Authorization, with the CORS of
   the sibling handlers. Supabase is read with the service role, never the
   anon key: GET reads and two read-only RPCs. Nothing here writes.

   Nothing read is trusted further than a provider: numbers are finite and
   range-checked, strings are control-character stripped and length-capped
   (names 80, titles 160, descriptions 280, statements 140), ids must be
   UUIDs, timestamps must parse, and an avatar is kept only when it is an
   https URL. A read that fails degrades only its own field, to null, and
   `sources` says which read it was; the answer is never invented.

   MISSIONS (schema halo-missions/v1). action_missions (at most 1000 read,
   newest updated first), with each mission's counts from the
   action_mission_stats RPC (which hides drafts from the service role, so a
   draft's counts come from its assignments), its non-withdrawn
   action_mission_assignments (team: most recent activity first, 12 at most),
   its action_proofs (evidence: newest first, 6 at most; the proof URL and
   any media are never returned), and its place from
   action_globe_mission_regions joined to action_globe_regions: the region's
   label, country code and centroid, never a member's location. Status:
   open is active, draft is planned, paused is blocked, closed is completed.
   A mission with at least one pending proof is `review`. Order: review first,
   then active, blocked, planned, completed, newest updated first within each;
   200 at most. `path` is the public mission page (mnet.html?mission=<id>, as
   the World links one) for every mission but a draft, which has none.

   PEOPLE (schema halo-people/v1). The house organization's members (orgs
   'mccluster' -> org_members; profile_id -> m_uid through the primary
   m_auth_user_links row) and everyone with a non-withdrawn assignment that
   joined, was submitted or was verified in the last 90 days. 200 at most.
   Names, avatars and headlines from network_profiles; skills, the top six by
   XP, from action_skill_progress. House roles: owner is owner; admin, or
   staff (the desk's read-and-reply role; org_members has no admin), is
   admin; viewer is member; anyone else is a participant. state: on_mission
   (an assignment joined or in progress) before awaiting_review (one
   submitted) before available. last_activity is the latest of joined (or
   started, for an assignment in progress, dated by joined_at: the table
   keeps no start time), submitted, verified and rejected (the proof's review
   time).

   PRIVACY, NON-NEGOTIABLE. Members consented only to regional aggregates
   with at least five people in them (action_globe_member_regions,
   action_globe_presence). The people answer reads neither table and carries
   no per-person region, presence, last-seen time, coordinate, location text,
   email or phone number. `location_shared` is always false. `online` is only
   the k-anonymous total from action_globe_public_online_total(), null under
   five, never per person.

   TIDES, ported from Hitman's Halo (src/sources/tides.js) with its honesty
   rules. NOAA CO-OPS data are U.S. Government works in the public domain.
   The station list (stations.json?type=waterlevels) is kept 24 h; a row is
   [id, name, lon, lat, state], the id seven digits. A station's observed
   water level (datagetter, product water_level, MLLW, metres, GMT, the last
   24 h) is kept 6 minutes per station. A reading must have a parseable GMT
   minute, a finite value within +-100 m, and not lie more than a minute in
   the future, or it is dropped and counted; the station NOAA names must be
   the one asked for. Quality 'p' is preliminary, 'v' verified, anything else
   unknown. At most 300 observations, oldest first, the latest also given
   alone. It is an observation, never a prediction or a navigation
   clearance, and it says so. stale is true when the provider is down and
   the last good answer (kept at most one hour, Halo's limit) is served, or
   when the latest observation is more than 30 minutes old; stale_reason
   says which. With nothing kept the answer is an honest `unavailable`, never
   an invented reading. A malformed station id is a 400. Both NOAA hosts are
   api.tidesandcurrents.noaa.gov, fetched through `upstream` (redirects only
   to that host, over https), and each body is read with a size bound. */
import { fail, reply } from './lib/http.js';
import { UpstreamError } from './lib/safe-fetch.js';
import { bearerUser, cachedLayer, upstream } from './world-layers.js';
import { isHouseOwner } from './world-access.js';
import { service, uuid } from './world-cctv.js';
import { clip, latOf, lonOf, within } from './world-halo-layers.js';

export const HALO_MISSIONS_PATH = '/v1/world/halo/missions';
export const HALO_PEOPLE_PATH = '/v1/world/halo/people';
export const TIDES_LAYER_PATH = '/v1/world/layers/tides';
const TIDE_STATION_PATH = /^\/v1\/world\/tides\/([^/]+)$/;
export const STATION_ID = /^\d{7}$/;

export const HALO_OPS_LIMITS = Object.freeze({
  missions: 200, missionsRead: 1000, rowsRead: 5000, team: 12, evidence: 6,
  people: 200, peopleWindowDays: 90, personMissions: 5, personSkills: 6,
  idChunk: 100, idChunks: 10
});

/* ---------- small, strict readers ---------- */
/* an ISO timestamp from a Postgres one, within 1900 to 2200; anything else is null */
function isoOf(v) {
  if (typeof v !== 'string' || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > -2208988800000 && ms < 7258118400000 ? new Date(ms).toISOString() : null;
}
const msOf = (iso) => (iso ? Date.parse(iso) : -Infinity);
const idOf = (v) => (uuid(v) ? String(v).toLowerCase() : null);
/* a non-negative whole count, or null */
const countOf = (v) => within(v, 0, 1e9, 0);
/* an avatar is kept only when it is an https URL without credentials */
export function httpsUrl(v, max = 500) {
  if (typeof v !== 'string' || !v || v.length > max) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    return u.href;
  } catch {
    return null;
  }
}
/* a lower-case word (domain, kind): letters, digits, underscores */
function wordOf(v, max = 40) {
  const s = clip(v, max);
  return s && /^[a-z0-9_]+$/.test(s) ? s : null;
}
/* PostgREST embeds a to-one relation as an object; tolerate a one-row array too */
const one = (v) => (Array.isArray(v) ? v[0] || null : v && typeof v === 'object' ? v : null);

/* ---------- owner-only answers ---------- */
function send(request, env, body, status = 200) {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
function refuse(request, env, message, status) {
  const res = fail(request, env, message, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}

/* the handler's own check, behind the release guard: the bearer is the house owner's */
export async function houseOwnerOf(request, env, fetchImpl = fetch) {
  const user = await bearerUser(request, env, fetchImpl);
  if (!user || !uuid(user.id)) return null;
  return (await isHouseOwner(env, user.id, fetchImpl)) ? user : null;
}

/* ---------- Supabase, service role, read only ---------- */
/* a read whose failure degrades one field to null, never the whole answer */
async function soft(promise) {
  try { return await promise; } catch { return null; }
}
async function rpc(env, name, body, fetchImpl) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error('supabase rpc ' + res.status), { status: res.status });
  return data;
}
/* rows whose `column` is one of `ids`, asked in chunks short enough for a URL */
async function byIds(env, table, column, ids, rest, fetchImpl) {
  const { idChunk, idChunks } = HALO_OPS_LIMITS;
  const list = [...new Set(ids.map(idOf).filter(Boolean))].slice(0, idChunk * idChunks);
  const chunks = [];
  for (let i = 0; i < list.length; i += idChunk) chunks.push(list.slice(i, i + idChunk));
  const pages = await Promise.all(chunks.map((c) => service(env, `${table}?${column}=in.(${c.join(',')})&${rest}`, fetchImpl)));
  return pages.flat();
}
/* auth user id -> m_uid, through the primary link (as world-access.js does) */
async function linksFor(env, authIds, fetchImpl) {
  if (!authIds.length) return new Map();
  const rows = await soft(byIds(env, 'm_auth_user_links', 'auth_user_id', authIds, 'is_primary=eq.true&select=auth_user_id,m_uid', fetchImpl));
  const map = new Map();
  for (const r of rows || []) { const a = idOf(r && r.auth_user_id), m = idOf(r && r.m_uid); if (a && m) map.set(a, m); }
  return map;
}
/* m_uid -> { name, avatar_url, headline } from network_profiles; null when the read failed */
async function profilesFor(env, mUids, fetchImpl, { headline = false } = {}) {
  if (!mUids.length) return new Map();
  const rows = await soft(byIds(env, 'network_profiles', 'm_uid', mUids, `select=m_uid,display_name,avatar_url${headline ? ',headline' : ''}`, fetchImpl));
  if (!rows) return null;
  const map = new Map();
  for (const r of rows) {
    const m = idOf(r && r.m_uid);
    if (m) map.set(m, { name: clip(r.display_name, 80), avatar_url: httpsUrl(r.avatar_url), headline: headline ? clip(r.headline, 120) : null });
  }
  return map;
}
const sourceOf = (v) => (v === null ? 'unavailable' : 'ok');

/* ---------- assignments ---------- */
const ASSIGNMENT_STATUSES = new Set(['joined', 'in_progress', 'submitted', 'verified', 'rejected']);
/* one non-withdrawn assignment row, trusted no further than its types; null when unusable */
function assignmentOf(r) {
  if (!r || typeof r !== 'object' || !ASSIGNMENT_STATUSES.has(r.status)) return null;
  const id = idOf(r.id), mission = idOf(r.mission_id);
  if (!id || !mission) return null;
  const a = {
    id, mission_id: mission, m_uid: idOf(r.m_uid), user_id: idOf(r.user_id), status: r.status,
    joined_at: isoOf(r.joined_at), submitted_at: isoOf(r.submitted_at), verified_at: isoOf(r.verified_at)
  };
  const m = one(r.action_missions);
  if (m) a.mission = { title: clip(m.title, 160), status: MISSION_STATUS[m.status] || null };
  const p = one(r.action_proofs);
  if (p) a.proof = { status: p.status, reviewed_at: isoOf(p.reviewed_at) };
  return a;
}
/* the assignment's latest event: [ms, label]. joined_at dates an in-progress
   assignment's start (the table keeps no start time); a rejection is dated by
   the proof's review */
function lastEvent(a) {
  const events = [[msOf(a.joined_at), a.status === 'in_progress' ? 'started' : 'joined'], [msOf(a.submitted_at), 'submitted']];
  if (a.status === 'verified') events.push([msOf(a.verified_at), 'verified']);
  if (a.status === 'rejected') events.push([msOf((a.proof && a.proof.reviewed_at) || a.verified_at), 'rejected']);
  let best = [-Infinity, null];
  for (const e of events) if (Number.isFinite(e[0]) && e[0] >= best[0]) best = e;
  return best;
}
const byActivity = (a, b) => lastEvent(b)[0] - lastEvent(a)[0] || (a.id < b.id ? -1 : 1);
/* the five counts the action_mission_stats RPC gives, from assignment rows (non-withdrawn) */
function countAssignments(list) {
  const c = { joined: 0, in_progress: 0, submitted: 0, verified: 0, rejected: 0 };
  for (const a of list) {
    c.joined += 1;
    if (a.status === 'joined' || a.status === 'in_progress') c.in_progress += 1;
    else c[a.status] += 1;
  }
  return c;
}

/* ---------- missions ---------- */
export const MISSION_STATUS = Object.freeze({ open: 'active', draft: 'planned', paused: 'blocked', closed: 'completed' });
const MISSION_ORDER = Object.freeze({ active: 1, blocked: 2, planned: 3, completed: 4 });
const PROOF_TYPES = new Set(['video', 'photo', 'link', 'text', 'artifact']);
const PROOF_STATUSES = new Set(['pending', 'verified', 'rejected']);
const MISSION_COLUMNS = 'id,campaign_id,title,description,domain,kind,skills,capacity,status,starts_at,ends_at,created_at,updated_at';
const ZERO_MISSION_COUNTS = Object.freeze({ active: 0, planned: 0, blocked: 0, review: 0, completed: 0 });

function placeOf(row) {
  const r = one(row && row.action_globe_regions);
  if (!r) return null;
  const lat = latOf(r.centroid_lat), lon = lonOf(r.centroid_lon);
  if (lat === null || lon === null) return null;
  const cc = typeof r.country_code === 'string' ? r.country_code.trim().toUpperCase() : '';
  return { label: clip(r.region_label, 120), country: /^[A-Z]{2}$/.test(cc) ? cc : null, lat, lon };
}
function skillsOf(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const s of v) { const k = clip(s, 40); if (k && !out.includes(k)) out.push(k); if (out.length >= 6) break; }
  return out;
}

export async function haloMissions(env, fetchImpl = fetch) {
  const L = HALO_OPS_LIMITS;
  const generated_at = new Date().toISOString();
  let rows;
  try {
    rows = await service(env, `action_missions?select=${MISSION_COLUMNS}&order=updated_at.desc&limit=${L.missionsRead}`, fetchImpl);
  } catch {
    return { ok: true, schema: 'halo-missions/v1', generated_at, unavailable: true, upstream_error: 'supabase_unavailable', counts: { ...ZERO_MISSION_COUNTS }, total: 0, truncated: false, missions: [] };
  }
  const [stats, assignmentRows, proofRows, placeRows] = await Promise.all([
    soft(rpc(env, 'action_mission_stats', { p_campaign: null }, fetchImpl)),
    soft(service(env, `action_mission_assignments?status=neq.withdrawn&select=id,mission_id,m_uid,user_id,status,joined_at,submitted_at,verified_at&order=joined_at.desc&limit=${L.rowsRead}`, fetchImpl)),
    soft(service(env, `action_proofs?select=id,assignment_id,user_id,proof_type,status,statement,created_at,reviewed_at,action_mission_assignments(mission_id,m_uid)&order=created_at.desc&limit=${L.rowsRead}`, fetchImpl)),
    soft(service(env, `action_globe_mission_regions?select=mission_id,updated_at,action_globe_regions(region_label,country_code,centroid_lat,centroid_lon)&order=updated_at.desc&limit=${L.rowsRead}`, fetchImpl))
  ]);
  const statsOk = Array.isArray(stats);
  const statBy = new Map();
  for (const s of statsOk ? stats : []) { const id = idOf(s && s.mission_id); if (id) statBy.set(id, s); }
  const assignmentsBy = new Map();
  for (const r of assignmentRows || []) {
    const a = assignmentOf(r);
    if (!a) continue;
    if (!assignmentsBy.has(a.mission_id)) assignmentsBy.set(a.mission_id, []);
    assignmentsBy.get(a.mission_id).push(a);
  }
  const proofsBy = new Map();
  for (const r of proofRows || []) {
    const owner = one(r && r.action_mission_assignments);
    const id = idOf(r && r.id), mission = idOf(owner && owner.mission_id);
    if (!id || !mission || !PROOF_TYPES.has(r.proof_type) || !PROOF_STATUSES.has(r.status)) continue;
    if (!proofsBy.has(mission)) proofsBy.set(mission, []);
    proofsBy.get(mission).push({ id, type: r.proof_type, status: r.status, created_at: isoOf(r.created_at), reviewed_at: isoOf(r.reviewed_at), statement: clip(r.statement, 140), m_uid: idOf(owner.m_uid), user_id: idOf(r.user_id) });
  }
  /* one place per mission: the most recently updated pin row (a mission may gain several) */
  const placeBy = new Map(), placeAt = new Map();
  for (const r of placeRows || []) {
    const id = idOf(r && r.mission_id), at = msOf(isoOf(r && r.updated_at));
    if (id && (!placeBy.has(id) || at > placeAt.get(id))) { placeBy.set(id, placeOf(r)); placeAt.set(id, at); }
  }

  const missions = [];
  const counts = { ...ZERO_MISSION_COUNTS };
  for (const m of rows) {
    const id = idOf(m && m.id), status = m && MISSION_STATUS[m.status];
    const title = clip(m && m.title, 160);
    if (!id || !status || !title) continue;
    const assigned = assignmentsBy.get(id) || [];
    const proofs = proofsBy.get(id) || [];
    const pending = proofRows ? proofs.filter((p) => p.status === 'pending').length : null;
    const s = statBy.get(id);
    const base = s ? { joined: countOf(s.joined), in_progress: countOf(s.in_progress), submitted: countOf(s.submitted), verified: countOf(s.verified), rejected: countOf(s.rejected) }
      : assignmentRows ? countAssignments(assigned)
        : { joined: null, in_progress: null, submitted: null, verified: null, rejected: null };
    const review = pending === null ? null : pending > 0;
    counts[status] += 1;
    if (review) counts.review += 1;
    missions.push({
      id, title, description: clip(m.description, 280), campaign_id: clip(m.campaign_id, 80), domain: wordOf(m.domain), kind: wordOf(m.kind), skills: skillsOf(m.skills),
      status, review, place: placeBy.get(id) || null,
      starts_at: isoOf(m.starts_at), ends_at: isoOf(m.ends_at), created_at: isoOf(m.created_at), updated_at: isoOf(m.updated_at),
      capacity: within(m.capacity, 1, 1e9, 0),
      counts: { ...base, pending_proofs: pending },
      team: assignmentRows ? [...assigned].sort(byActivity).slice(0, L.team) : null,
      evidence: proofRows ? [...proofs].sort((x, y) => msOf(y.created_at) - msOf(x.created_at) || (x.id < y.id ? -1 : 1)).slice(0, L.evidence) : null,
      path: status === 'planned' ? null : `mnet.html?mission=${id}`
    });
  }
  if (!proofRows) counts.review = null;
  missions.sort((a, b) => (a.review ? 0 : MISSION_ORDER[a.status]) - (b.review ? 0 : MISSION_ORDER[b.status]) || msOf(b.updated_at) - msOf(a.updated_at) || (a.id < b.id ? -1 : 1));
  const shown = missions.slice(0, L.missions);

  /* names only for the people shown: team members and evidence authors */
  const unlinked = [];
  for (const m of shown) for (const x of [...(m.team || []), ...(m.evidence || [])]) if (!x.m_uid && x.user_id) unlinked.push(x.user_id);
  const links = await linksFor(env, unlinked, fetchImpl);
  const mUidOf = (x) => x.m_uid || (x.user_id && links.get(x.user_id)) || null;
  const people = new Set();
  for (const m of shown) for (const x of [...(m.team || []), ...(m.evidence || [])]) { const u = mUidOf(x); if (u) people.add(u); }
  const profiles = await profilesFor(env, [...people], fetchImpl);
  const who = (u) => (u && profiles && profiles.get(u)) || null;
  for (const m of shown) {
    if (m.team) m.team = m.team.map((a) => { const u = mUidOf(a), p = who(u); return { m_uid: u, name: p ? p.name : null, avatar_url: p ? p.avatar_url : null, status: a.status, since: a.joined_at }; });
    if (m.evidence) m.evidence = m.evidence.map((e) => { const u = mUidOf(e), p = who(u); return { id: e.id, type: e.type, status: e.status, created_at: e.created_at, reviewed_at: e.reviewed_at, by: p ? p.name : null, m_uid: u, statement: e.statement }; });
  }
  return {
    ok: true, schema: 'halo-missions/v1', generated_at, counts, total: missions.length,
    truncated: missions.length > shown.length || rows.length >= L.missionsRead,
    sources: { missions: 'ok', stats: statsOk ? 'ok' : 'unavailable', assignments: sourceOf(assignmentRows), proofs: sourceOf(proofRows), places: sourceOf(placeRows), profiles: sourceOf(profiles) },
    missions: shown
  };
}

/* ---------- people ---------- */
const PERSON_STATE_ORDER = Object.freeze({ on_mission: 0, awaiting_review: 1, available: 2 });
const ROLE_ORDER = Object.freeze({ owner: 0, admin: 1, member: 2, participant: 3 });
const HOUSE_ROLE = Object.freeze({ owner: 'owner', admin: 'admin', staff: 'admin', viewer: 'member' });
const PEOPLE_ASSIGNMENT_SELECT = 'id,mission_id,m_uid,user_id,status,joined_at,submitted_at,verified_at,action_missions(title,status),action_proofs(status,reviewed_at)';
const ZERO_PEOPLE_COUNTS = Object.freeze({ people: 0, on_mission: 0, available: 0, awaiting_review: 0 });

/* the k-anonymous online total, null under five; never per person */
export function onlineOf(v) {
  const n = countOf(Array.isArray(v) ? v[0] : v);
  return n === null || n < 5 ? null : n;
}

export async function haloPeople(env, fetchImpl = fetch, now = Date.now()) {
  const L = HALO_OPS_LIMITS;
  const generated_at = new Date(now).toISOString();
  /* quoted in the or=() filter: PostgREST reserves ':' and '.' there */
  const since = new Date(now - L.peopleWindowDays * 86400000).toISOString();
  const houseRead = (async () => {
    const orgs = await service(env, 'orgs?slug=eq.mccluster&select=id&limit=1', fetchImpl);
    const houseId = orgs[0] && orgs[0].id;
    return houseId ? service(env, `org_members?org_id=eq.${encodeURIComponent(houseId)}&select=profile_id,role&limit=500`, fetchImpl) : [];
  })();
  const [house, recent, onlineRaw] = await Promise.all([
    soft(houseRead),
    soft(service(env, `action_mission_assignments?status=neq.withdrawn&or=(joined_at.gte."${since}",submitted_at.gte."${since}",verified_at.gte."${since}")&select=${PEOPLE_ASSIGNMENT_SELECT}&order=joined_at.desc&limit=${L.rowsRead}`, fetchImpl)),
    /* wrapped: the RPC answers null under five, which is not a failure */
    soft(rpc(env, 'action_globe_public_online_total', {}, fetchImpl).then((value) => ({ value })))
  ]);
  const online = onlineRaw ? onlineOf(onlineRaw.value) : null;
  if (house === null && recent === null) {
    return { ok: true, schema: 'halo-people/v1', generated_at, unavailable: true, upstream_error: 'supabase_unavailable', counts: { ...ZERO_PEOPLE_COUNTS }, online, total: 0, truncated: false, people: [] };
  }
  /* the house members' own assignments, whenever they were made */
  const members = [];
  for (const r of house || []) { const p = idOf(r && r.profile_id); if (p) members.push({ profile_id: p, role: HOUSE_ROLE[r.role] || 'member' }); }
  const memberRows = members.length ? await soft(byIds(env, 'action_mission_assignments', 'user_id', members.map((m) => m.profile_id), `status=neq.withdrawn&select=${PEOPLE_ASSIGNMENT_SELECT}&order=joined_at.desc&limit=1000`, fetchImpl)) : [];
  const assignments = new Map();
  for (const r of [...(recent || []), ...(memberRows || [])]) { const a = assignmentOf(r); if (a && !assignments.has(a.id)) assignments.set(a.id, a); }

  const needLinks = [...members.map((m) => m.profile_id), ...[...assignments.values()].filter((a) => !a.m_uid && a.user_id).map((a) => a.user_id)];
  const links = await linksFor(env, needLinks, fetchImpl);
  const people = new Map();
  let unresolved = 0;
  const person = (mUid) => {
    if (!people.has(mUid)) people.set(mUid, { m_uid: mUid, role: 'participant', assignments: [] });
    return people.get(mUid);
  };
  for (const m of members) {
    const u = links.get(m.profile_id);
    if (!u) { unresolved += 1; continue; }
    const p = person(u);
    if (ROLE_ORDER[m.role] < ROLE_ORDER[p.role]) p.role = m.role;
  }
  for (const a of assignments.values()) {
    const u = a.m_uid || (a.user_id && links.get(a.user_id));
    if (!u) { unresolved += 1; continue; }
    person(u).assignments.push(a);
  }

  const ids = [...people.keys()];
  const [profiles, skillRows] = await Promise.all([
    profilesFor(env, ids, fetchImpl, { headline: true }),
    soft(byIds(env, 'action_skill_progress', 'm_uid', ids, `select=m_uid,skill,xp&order=xp.desc&limit=${L.rowsRead}`, fetchImpl))
  ]);
  const skills = new Map();
  for (const r of [...(skillRows || [])].sort((a, b) => (countOf(b && b.xp) || 0) - (countOf(a && a.xp) || 0))) {
    const u = idOf(r && r.m_uid), k = clip(r && r.skill, 40);
    if (!u || !k) continue;
    if (!skills.has(u)) skills.set(u, []);
    const list = skills.get(u);
    if (list.length < L.personSkills && !list.includes(k)) list.push(k);
  }

  const out = [];
  const counts = { ...ZERO_PEOPLE_COUNTS };
  for (const p of people.values()) {
    const list = p.assignments.sort(byActivity);
    const state = list.some((a) => a.status === 'joined' || a.status === 'in_progress') ? 'on_mission' : list.some((a) => a.status === 'submitted') ? 'awaiting_review' : 'available';
    const last = list.length ? lastEvent(list[0]) : [-Infinity, null];
    const prof = profiles && profiles.get(p.m_uid);
    counts.people += 1;
    counts[state] += 1;
    out.push({
      m_uid: p.m_uid, name: prof ? prof.name : null, avatar_url: prof ? prof.avatar_url : null, headline: prof ? prof.headline : null,
      role: p.role, skills: skillRows ? skills.get(p.m_uid) || [] : null,
      missions: list.slice(0, L.personMissions).map((a) => ({ id: a.mission_id, title: a.mission ? a.mission.title : null, status: a.status })),
      state, last_activity_at: Number.isFinite(last[0]) ? new Date(last[0]).toISOString() : null, last_activity: last[1],
      location_shared: false
    });
  }
  out.sort((a, b) => PERSON_STATE_ORDER[a.state] - PERSON_STATE_ORDER[b.state] || msOf(b.last_activity_at) - msOf(a.last_activity_at)
    || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || String(a.name || '￿').localeCompare(String(b.name || '￿')) || (a.m_uid < b.m_uid ? -1 : 1));
  const shown = out.slice(0, L.people);
  return {
    ok: true, schema: 'halo-people/v1', generated_at, counts, online, total: out.length,
    truncated: out.length > shown.length || (recent || []).length >= L.rowsRead, unresolved,
    sources: { house: sourceOf(house), assignments: sourceOf(recent), member_assignments: sourceOf(memberRows), profiles: sourceOf(profiles), skills: sourceOf(skillRows), online: sourceOf(onlineRaw) },
    people: shown
  };
}

/* ---------- NOAA CO-OPS water levels ---------- */
export const TIDES = Object.freeze({
  stationsUrl: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
  stationsTtl: 86400, stationsMax: 2000, stationsBytes: 4000000,
  waterTtl: 360, waterMax: 300, waterRows: 500, waterBytes: 256000,
  staleLimitS: 3600, oldObservationS: 1800
});
export const TIDES_BASE = Object.freeze({
  attribution: 'NOAA Center for Operational Oceanographic Products and Services (CO-OPS)',
  attribution_url: 'https://tidesandcurrents.noaa.gov', credit: 'NOAA CO-OPS', license: 'Public domain (U.S. Government work)'
});
const WATER_NOTE = 'Observed water level, not a tide prediction.';
export function waterLevelUrl(id) {
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=mccluster&station=${id}&datum=MLLW&units=metric&time_zone=gmt&format=json&range=24`;
}

/* a JSON body read with a size bound, inside upstream's timeout */
function boundedJson(maxBytes) {
  return async (res) => {
    if (Number(res.headers.get('content-length')) > maxBytes) throw new UpstreamError('upstream_too_large', 'provider answer is too large');
    let text = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new UpstreamError('upstream_too_large', 'provider answer is too large'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await res.text();
      if (text.length > maxBytes) throw new UpstreamError('upstream_too_large', 'provider answer is too large');
    }
    try { return JSON.parse(text); } catch { throw new UpstreamError('upstream_invalid_json', 'provider returned invalid JSON'); }
  };
}

export function normalizeStation(s) {
  if (!s || typeof s !== 'object') return null;
  const id = typeof s.id === 'string' || typeof s.id === 'number' ? String(s.id).trim() : '';
  if (!STATION_ID.test(id)) return null;
  const lat = latOf(s.lat), lon = lonOf(s.lng !== undefined ? s.lng : s.lon);
  if (lat === null || lon === null) return null;
  return [id, clip(s.name, 120) || id, lon, lat, clip(s.state, 40)];
}

export async function fetchTideStations(env, fetchImpl = fetch) {
  const data = await upstream(TIDES.stationsUrl, {}, fetchImpl, boundedJson(TIDES.stationsBytes), 15000);
  if (!data || !Array.isArray(data.stations)) throw new UpstreamError('upstream_invalid_json', 'NOAA answer has no station list');
  const seen = new Set(), stations = [];
  for (const s of data.stations) {
    const row = normalizeStation(s);
    if (!row || seen.has(row[0])) continue;
    seen.add(row[0]);
    if (stations.length < TIDES.stationsMax) stations.push(row);
  }
  return { coverage: 'NOAA CO-OPS water-level stations: U.S. coasts, the Great Lakes and territories', total: data.stations.length, truncated: seen.size > stations.length, count: stations.length, stations };
}

const QUALITY = Object.freeze({ p: 'preliminary', v: 'verified' });
/* one datagetter answer to the station and its observations, oldest first (Halo's rules) */
export function normalizeWaterLevel(payload, id, now = Date.now()) {
  if (payload && payload.error) {
    const msg = String((payload.error && payload.error.message) || '');
    throw new UpstreamError(/no data/i.test(msg) ? 'upstream_no_data' : 'upstream_error_payload', 'NOAA answered with an error');
  }
  if (!payload || !Array.isArray(payload.data) || payload.data.length > TIDES.waterRows) throw new UpstreamError('upstream_invalid_json', 'NOAA answer has no usable data list');
  const md = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const lat = latOf(md.lat), lon = lonOf(md.lon);
  if (String(md.id) !== id || lat === null || lon === null) throw new UpstreamError('upstream_invalid_station', 'NOAA answered for another or an unplaced station');
  let dropped = 0;
  const seen = new Set(), rows = [];
  for (const r of payload.data) {
    const value = within(r && r.v, -100, 100, 3);
    const iso = r && typeof r.t === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.t) ? `${r.t.replace(' ', 'T')}:00.000Z` : '';
    const ms = Date.parse(iso);
    if (value === null || !Number.isFinite(ms) || new Date(ms).toISOString() !== iso || ms > now + 60000 || seen.has(iso)) { dropped += 1; continue; }
    seen.add(iso);
    rows.push([iso, value, QUALITY[r.q] || 'unknown']);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!rows.length) throw new UpstreamError('upstream_empty', 'NOAA returned no usable observation');
  const observations = rows.slice(-TIDES.waterMax);
  return { station: { id, name: clip(md.name, 120) || id, lat, lon }, total: payload.data.length, dropped, truncated: rows.length > observations.length, count: observations.length, observations };
}

/* the cached body (or its absence) to the halo-water-level/v1 answer */
export function waterLevelAnswer(id, body, stale, now = Date.now()) {
  const fixed = { ok: true, schema: 'halo-water-level/v1', product: 'observed_water_level', datum: 'MLLW', units: 'm' };
  const tail = { note: WATER_NOTE, ...TIDES_BASE, source_url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}` };
  const keptTooLong = stale && !(now - Date.parse(body.fetched_at) <= TIDES.staleLimitS * 1000);
  const obs = Array.isArray(body.observations) ? body.observations : [];
  if (body.unavailable || keptTooLong || !obs.length || !body.station) {
    return { ...fixed, station: { id, name: null, lat: null, lon: null }, fetched_at: null, stale: false, unavailable: true, upstream_error: body.upstream_error || 'upstream_error', latest: null, observations: [], count: 0, ...tail };
  }
  const last = obs[obs.length - 1];
  const latest = { value: last[1], observed_at: last[0], quality: last[2] };
  const old = now - Date.parse(latest.observed_at) > TIDES.oldObservationS * 1000;
  const reason = stale ? 'provider_unavailable' : old ? 'observation_older_than_30_minutes' : null;
  return {
    ...fixed, station: body.station, fetched_at: body.fetched_at, stale: Boolean(reason), ...(reason ? { stale_reason: reason } : {}),
    ...(stale ? { upstream_error: body.upstream_error || 'upstream_error' } : {}),
    latest, observations: obs, count: obs.length, dropped: countOf(body.dropped), truncated: body.truncated === true, ...tail
  };
}

/* ---------- the routes ---------- */
export async function handleHaloOps(request, env, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const station = path.match(TIDE_STATION_PATH);
  const route = path === HALO_MISSIONS_PATH ? 'missions' : path === HALO_PEOPLE_PATH ? 'people' : path === TIDES_LAYER_PATH ? 'tides' : station ? 'water' : null;
  if (!route) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(request, env, 'Method not allowed', 405);
  /* defence in depth: the guard already refused everyone else; refuse again here */
  if (!(await houseOwnerOf(request, env, fetchImpl))) return send(request, env, { ok: false, code: 'owner_only', error: 'Only the house owner may see this.' }, 403);
  if (route === 'missions') return send(request, env, await haloMissions(env, fetchImpl));
  if (route === 'people') return send(request, env, await haloPeople(env, fetchImpl));
  if (route === 'tides') {
    const { body, stale } = await cachedLayer({ layer: 'tides', ttl: TIDES.stationsTtl, base: TIDES_BASE, rows: 'stations', fetcher: fetchTideStations }, env, fetchImpl, cacheImpl);
    return send(request, env, { ...body, stale: !!stale });
  }
  const id = station[1];
  if (!STATION_ID.test(id)) return send(request, env, { ok: false, code: 'invalid_station', error: 'station must be a seven-digit NOAA CO-OPS id' }, 400);
  const { body, stale } = await cachedLayer({
    layer: 'water_level', key: `tides/${id}`, ttl: TIDES.waterTtl, base: TIDES_BASE, rows: 'observations',
    fetcher: async (e, f) => normalizeWaterLevel(await upstream(waterLevelUrl(id), {}, f, boundedJson(TIDES.waterBytes), 10000), id)
  }, env, fetchImpl, cacheImpl);
  return send(request, env, waterLevelAnswer(id, body, !!stale));
}
