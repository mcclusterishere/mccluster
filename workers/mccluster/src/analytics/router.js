import { requireCapability } from '../lib/capabilities.js';
import { engagementScore, validateUserPage, groupUserEvents } from './users-utils.js';
import { createForensicRoutes } from './forensics.js';
import { createAudienceScienceRoutes } from './audience-science.js';
import { createExperienceAnalyticsRoutes } from './experience.js';
import { loadCommerceSummary } from '../commerce/summary.js';
import { createCameraRoutes } from './cameras.js';
import { dataCoverage, boundedReads, DATASETS } from './coverage.js';
import {cleanInventory, socialCoverage} from './event-inventory.js';
import { measurementContext } from './measurement.js';
import { readAnalyticsPages } from './paged-reads.js';
import { loadBusinessEventCounts } from './business-event-counts.js';
import { databaseErrorMetadata, readFailureDiagnostics, successfulReadDiagnostics, visibleBusinessSnapshot } from './read-diagnostics.js';
import { DICTIONARY_VERSION, DICTIONARY_SOURCE, EVENT_DICTIONARY, METRIC_DICTIONARY } from './measurement-dictionary.js';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const HOUSE_SLUG = 'mccluster';
/* A creator sees where their page was read from by country only; a country
   with fewer views than this is folded into "elsewhere" (never named). */
const AUDIENCE_MIN_VIEWS = 5;
const MAX_AUTH_PAGES = 100;
const AUTH_PAGE_SIZE = 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sb(env, path, init = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...(init.headers || {})
  };
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function sbJson(env, path, init = {}) {
  const res = await sb(env, path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error('Analytics database read failed'), {
    status: 502, detail: body, ...databaseErrorMetadata(res, body)
  });
  return body;
}

function countFromRange(value) {
  const total = String(value || '').split('/').pop();
  const n = Number(total);
  if (!/^\d+$/.test(total) || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid analytics count response');
  return n;
}

async function sbCount(env, table, column = 'id', sinceIso = null, untilIso = null) {
  return sbCountFiltered(env, table, column, {}, sinceIso, 'created_at', untilIso);
}

async function sbCountFiltered(env, table, column = 'id', filters = {}, sinceIso = null, timeColumn = 'created_at', untilIso = null) {
  const q = new URLSearchParams({ select: column });
  Object.entries(filters || {}).forEach(([name, value]) => {
    if (value != null && value !== '') q.set(name, String(value));
  });
  if (sinceIso) q.append(timeColumn, `gte.${sinceIso}`);
  if (untilIso) q.append(timeColumn, `lt.${untilIso}`);
  const res = await sb(env, `${table}?${q.toString()}`, {
    headers: { prefer: 'count=exact', range: '0-0' }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(detail); } catch {}
    throw Object.assign(new Error(`Could not count ${table}`), {
      status: 502, ...databaseErrorMetadata(res, body)
    });
  }
  return countFromRange(res.headers.get('content-range'));
}

async function sbRows(env, path) {
  const rows = await sbJson(env, path);
  return Array.isArray(rows) ? rows : [];
}

async function sbRowsPaged(env, path, maxRows = 100000) {
  return readAnalyticsPages((pagePath, start, end) => sbJson(env, pagePath, {
    headers: { range: `${start}-${end}` }
  }), path, maxRows);
}

function finiteDate(value, fallback) {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? new Date(n) : fallback;
}

function normalizedTrack(row, trackMap = new Map()) {
  const props = row?.props && typeof row.props === 'object' ? row.props : {};
  const creatorId = String(props.creator_track_id || '').trim();
  if (creatorId && trackMap.has(creatorId)) return trackMap.get(creatorId);
  let raw = String(props.track || props.song || creatorId || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'whodidtheshoot') raw = 'who did the shoot';
  return raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function acquisitionSource(row) {
  const props = row?.props && typeof row.props === 'object' ? row.props : {};
  const direct = String(props.source || props.src || '').trim();
  if (direct) return direct;
  const acq = String(props.acq || '').trim();
  if (acq) return acq.split('/')[0] || 'direct';
  const ref = String(row?.referrer || '').trim();
  if (!ref) return 'direct';
  try { return new URL(ref).hostname || 'direct'; }
  catch { return ref.slice(0, 120); }
}

function publicDeviceSummary(device) {
  const d = device && typeof device === 'object' ? device : {};
  return {
    platform: d.platform || null,
    mobile: typeof d.mobile === 'boolean' ? d.mobile : null,
    screen: d.w && d.h ? `${d.w}×${d.h}` : null,
    viewport: d.vw && d.vh ? `${d.vw}×${d.vh}` : null,
    dpr: d.dpr ?? null,
    cpu: d.cpu ?? null,
    memory_gb_bucket: d.mem ?? null,
    touch_points: d.touch ?? null,
    language: d.lang || null,
    timezone: d.tz || null,
    standalone: typeof d.standalone === 'boolean' ? d.standalone : null,
    network: d.network || null
  };
}

function chunks(values, size = 50) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function identityAnalytics(env, sinceIso, untilIso) {
  const now = new Date();
  const until = finiteDate(untilIso, now);
  const since = finiteDate(sinceIso, new Date(until.getTime() - 7 * 86400000));
  if (!(since < until)) throw Object.assign(new Error('Invalid analytics range'), { status: 400 });

  const users = await listAuthUsers(env);
  const created = users.filter((u) => {
    const at = Date.parse(u?.created_at || '');
    return Number.isFinite(at) && at >= since.getTime() && at < until.getTime();
  });
  const userIds = created.map((u) => String(u.id)).filter(Boolean);
  const eventSelect = [
    'id','at','name','path','props','uid','device_id','session_id','ip','user_agent','referrer',
    'country','region','city','postal','latitude','longitude','timezone','asn','asn_org','device','edge'
  ].join(',');

  const direct = await sbRowsPaged(env,
    `events?site_id=is.null&name=eq.account_created&at=gte.${encodeURIComponent(since.toISOString())}` +
    `&at=lt.${encodeURIComponent(until.toISOString())}&select=${eventSelect}&order=at.asc,id.asc`,
    25000
  );
  const readDatasets = { account_creation_events: direct };

  /* Historical reconstruction is bounded by the actual accounts in the
     selected window. We never scan the first N global bridge rows: that was
     the stale donor bug that could silently miss newer identities. */
  const bridges = [];
  const bridgeSince = new Date(since.getTime() - 7 * 86400000).toISOString();
  const bridgeUntil = new Date(until.getTime() + 7 * 86400000).toISOString();
  for (const ids of chunks(userIds)) {
    if (!ids.length) continue;
    const batch = await sbRowsPaged(env,
      `events?site_id=is.null&uid=in.(${ids.join(',')})&device_id=not.is.null` +
      `&at=gte.${encodeURIComponent(bridgeSince)}&at=lt.${encodeURIComponent(bridgeUntil)}` +
      `&select=${eventSelect}&order=at.desc,id.desc`,
      100000
    );
    readDatasets['identity_bridge_' + Object.keys(readDatasets).length] = batch;
    bridges.push(...batch);
  }

  const directByUser = new Map();
  for (const e of direct) {
    // signup_user_id is a client claim; only the collector-verified uid can
    // attach account evidence. Anonymous signup reports remain raw evidence.
    const uid = String(e?.uid || '');
    if (uid) directByUser.set(uid, e);
  }
  const bridgeByUser = new Map();
  for (const e of bridges) {
    if (!e?.uid || !e?.device_id) continue;
    const key = String(e.uid);
    const list = bridgeByUser.get(key) || [];
    list.push(e); bridgeByUser.set(key, list);
  }

  const deviceIds = new Set();
  for (const u of created) {
    const d = directByUser.get(String(u.id));
    if (d?.device_id) deviceIds.add(String(d.device_id));
    const list = bridgeByUser.get(String(u.id)) || [];
    for (const e of list) if (e?.device_id) deviceIds.add(String(e.device_id));
  }

  const behaviorSince = new Date(since.getTime() - 7 * 86400000).toISOString();
  const behavior = [];
  for (const ids of chunks([...deviceIds])) {
    if (!ids.length) continue;
    const batch = await sbRowsPaged(env,
      `events?site_id=is.null&device_id=in.(${ids.join(',')})` +
      `&at=gte.${encodeURIComponent(behaviorSince)}&at=lt.${encodeURIComponent(until.toISOString())}` +
      '&name=in.(album_play,music_play,music_preview_play,music_full_play,music_complete,song_start,track_start,acquired)' +
      `&select=${eventSelect}&order=at.asc,id.asc`,
      100000
    );
    readDatasets['behavior_' + Object.keys(readDatasets).length] = batch;
    behavior.push(...batch);
  }

  const tracks = await sbRows(env, 'creator_tracks?select=id,title,artist,slug');
  const trackMap = new Map((tracks || []).map((t) => [
    String(t.id), String(t.title || t.slug || t.id) + (t.artist ? ` · ${t.artist}` : '')
  ]));
  const byDevice = new Map();
  for (const e of behavior) {
    if (!e?.device_id) continue;
    const key = String(e.device_id);
    const list = byDevice.get(key) || [];
    list.push(e); byDevice.set(key, list);
  }

  let contentReadStatus = 'observed_complete';
  const contentRows = await sbJson(env, 'rpc/analytics_content', {
    method: 'POST',
    body: JSON.stringify({
      p_since: since.toISOString(), p_until: until.toISOString(), p_site: null
    })
  }).catch(() => { contentReadStatus = 'unavailable'; return []; });
  const listenerByTrack = new Map((Array.isArray(contentRows) ? contentRows : []).map((r) => [
    String(r.track || '').trim().toLowerCase(), Number(r.listeners) || 0
  ]));

  const journeys = [];
  for (const u of created) {
    const createdAt = Date.parse(u.created_at || '');
    const directEvent = directByUser.get(String(u.id)) || null;
    const candidates = (bridgeByUser.get(String(u.id)) || []).filter((e) => e.device_id);
    const bridge = candidates.find((e) => Date.parse(e.at || '') >= createdAt) || candidates[0] || null;
    const deviceId = String(directEvent?.device_id || bridge?.device_id || '') || null;
    const all = deviceId ? (byDevice.get(deviceId) || []) : [];
    const pre = all.filter((e) => {
      const at = Date.parse(e.at || '');
      return String(e.uid || '') === String(u.id) && Number.isFinite(at) &&
        at <= createdAt && at >= createdAt - 7 * 86400000;
    });
    const music = pre.filter((e) => normalizedTrack(e, trackMap));
    const lastMusic = music.length ? music[music.length - 1] : null;
    const assisted = [...new Set(music.map((e) => normalizedTrack(e, trackMap)).filter(Boolean))];
    // Browser-stored signup context can belong to a previous person on this
    // device. Do not turn its claimed last track into account listening.
    const lastTrack = lastMusic ? normalizedTrack(lastMusic, trackMap) : null;
    const lastTrackAt = lastMusic?.at || null;
    const lastAt = Date.parse(lastTrackAt || '');
    const acquired = pre.filter((e) => e.name === 'acquired');
    const sourceEvent = acquired.length ? acquired[acquired.length - 1] : null;
    const loc = directEvent || [...pre].reverse().find((e) => e.ip || e.city || e.latitude != null) || bridge || null;
    const meta = u?.user_metadata && typeof u.user_metadata === 'object' ? u.user_metadata : {};

    journeys.push({
      user_id: u.id,
      email: u.email || null,
      first_name: meta.first_name || null,
      last_name: meta.last_name || null,
      created_at: u.created_at,
      confirmed_at: u.email_confirmed_at || u.confirmed_at || null,
      device_id: deviceId,
      session_id: directEvent?.session_id || lastMusic?.session_id || loc?.session_id || null,
      source: sourceEvent ? acquisitionSource(sourceEvent) : 'unknown',
      attribution_status: lastTrack ? 'event_bound_account_evidence' : 'unknown_no_account_bound_touch',
      unattributed_device_events: all.filter((e) => !e.uid).length,
      last_track: lastTrack || null,
      last_track_at: lastTrackAt,
      minutes_after_last_track: Number.isFinite(lastAt)
        ? Math.max(0, Math.round((createdAt - lastAt) / 60000)) : null,
      assisted_tracks: assisted,
      ip: loc?.ip || null, country: loc?.country || null, region: loc?.region || null,
      city: loc?.city || null, postal: loc?.postal || null,
      latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null,
      timezone: loc?.timezone || null, asn: loc?.asn ?? null, network: loc?.asn_org || null,
      user_agent: loc?.user_agent || null, device: publicDeviceSummary(loc?.device)
    });
  }

  const stats = new Map(), sourceEdges = new Map();
  for (const j of journeys) {
    for (const track of j.assisted_tracks || []) {
      const key = String(track).toLowerCase();
      const cur = stats.get(key) || {
        track, listeners: listenerByTrack.get(key) ?? null,
        assisted_accounts: 0, last_touch_accounts: 0, timed_last_touch_accounts: 0, total_minutes_to_signup: 0
      };
      cur.assisted_accounts++; stats.set(key, cur);
    }
    if (j.last_track) {
      const key = String(j.last_track).toLowerCase();
      const cur = stats.get(key) || {
        track:j.last_track, listeners:listenerByTrack.get(key) ?? null,
        assisted_accounts:0,last_touch_accounts:0,timed_last_touch_accounts:0,total_minutes_to_signup:0
      };
      cur.last_touch_accounts++;
      if (j.minutes_after_last_track != null) {
        cur.total_minutes_to_signup += j.minutes_after_last_track;
        cur.timed_last_touch_accounts++;
      }
      stats.set(key, cur);
      const edgeKey = `${j.source || 'direct'}\u0000${j.last_track}`;
      sourceEdges.set(edgeKey, (sourceEdges.get(edgeKey) || 0) + 1);
    }
  }

  const trackStats = [...stats.values()].map((x) => ({
    track:x.track, listeners:x.listeners, assisted_accounts:x.assisted_accounts,
    last_touch_accounts:x.last_touch_accounts,
    // Attribution can reach seven days before this listener window and links
    // accounts rather than devices. These are not compatible rate populations.
    signup_rate_pct:null,
    avg_minutes_to_signup:x.timed_last_touch_accounts
      ? Math.round(x.total_minutes_to_signup / x.timed_last_touch_accounts) : null
  })).sort((a,b) => b.last_touch_accounts-a.last_touch_accounts ||
    b.assisted_accounts-a.assisted_accounts || b.listeners-a.listeners);

  return {
    range:{since:since.toISOString(),until:until.toISOString(),attribution_window_days:7},
    measurement:measurementContext({metricVersion:'identity-attribution/v3',
      since:since.toISOString(),until:until.toISOString(),datasets:readDatasets,
      unit:'accounts',identityBasis:'auth.users.id_with_event_bound_account_evidence'}),
    methodology:{population:'Accounts created in the window; descriptive attribution may look back seven days.',
      signup_rate:'unavailable_without_ordered_matching_cohort',
      listener_read:contentReadStatus,
      note:'Only events carrying this account uid can contribute music/source attribution. Anonymous device history and client signup-context claims are not assigned to an account; missing evidence stays unknown. Association is not causation.'},
    coverage:{
      accounts:created.length,
      bridged_accounts:journeys.filter((j)=>j.device_id).length,
      attributed_accounts:journeys.filter((j)=>j.last_track).length,
      accounts_with_ip:journeys.filter((j)=>j.ip).length,
      accounts_with_location:journeys.filter((j)=>j.city || j.latitude != null).length
    },
    tracks:trackStats,
    source_track_edges:[...sourceEdges.entries()].map(([key,accounts])=>{
      const [source,track]=key.split('\u0000'); return {source,track,accounts};
    }).sort((a,b)=>b.accounts-a.accounts),
    journeys:journeys.sort((a,b)=>Date.parse(b.created_at||'')-Date.parse(a.created_at||''))
  };
}

async function handleIdentityAnalytics(request, env, user, url) {
  await requireHouseOwner(env, user);
  if (request.method !== 'GET') return json({ok:false,error:'GET only'},405);
  return json({ok:true,...await identityAnalytics(env,url.searchParams.get('since'),url.searchParams.get('until'))});
}

/* STATES / PROVINCES inside one country, for the owner's analytics globe
   (owner, 2026-10-16). House owner only, like identity and forensics. It
   reads public.analytics_region_totals (supabase/pending/analytics_region_v1.sql,
   service_role only): country, region code, region name and counts, with any
   region under 5 page views already folded by the database. Never city,
   postal code, coordinates or IP. Until that read is applied the route says
   so (pending: true) and the globe shows "not collected yet". */
const REGION_MIN_VIEWS = 5;
async function handleRegionAnalytics(request, env, user, url) {
  await requireHouseOwner(env, user);
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const country = String(url.searchParams.get('country') || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return json({ ok: false, error: 'country must be an ISO 3166-1 alpha-2 code' }, 400);
  const until = finiteDate(url.searchParams.get('until'), new Date());
  const since = finiteDate(url.searchParams.get('since'), new Date(until.getTime() - 86400000));
  if (!(since < until)) return json({ ok: false, error: 'Invalid analytics range' }, 400);
  const siteRaw = String(url.searchParams.get('site') || '').trim();
  if (siteRaw && !/^[0-9a-f-]{36}$/i.test(siteRaw)) return json({ ok: false, error: 'Invalid site' }, 400);
  const res = await sb(env, 'rpc/analytics_region_totals', { method: 'POST',
    body: JSON.stringify({ p_country: country, p_since: since.toISOString(), p_until: until.toISOString(), p_site: siteRaw || null }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const missing = res.status === 404 || /PGRST202|could not find the function|does not exist/i.test(JSON.stringify(body || ''));
    if (missing) return json({ ok: true, pending: true, country, regions: [], folded: 0, unknown: 0,
      note: 'Region counts need analytics_region_v1 (written, not applied).' });
    return json({ ok: false, error: 'Region analytics read failed' }, 502);
  }
  const rows = Array.isArray(body) ? body : [];
  const regions = [];
  let folded = 0, unknown = 0;
  for (const r of rows) {
    const pv = Number(r.page_views) || 0;
    const code = /^[A-Z0-9]{1,4}$/.test(String(r.region_code || '')) ? String(r.region_code) : null;
    const name = r.region ? String(r.region).slice(0, 80) : null;
    if (r.folded) { folded += pv; continue; }
    if (!code && !name) { unknown += pv; continue; }
    /* the database folds; this is the second wall */
    if (pv < REGION_MIN_VIEWS) { folded += pv; continue; }
    regions.push({ code, name, page_views: pv, visitors: r.visitors == null ? null : Number(r.visitors) || 0 });
  }
  return json({ ok: true, pending: false, country, range: { since: since.toISOString(), until: until.toISOString() }, min: REGION_MIN_VIEWS, regions, folded, unknown });
}

async function handleForensics(request, env, user, url) {
  await requireHouseOwner(env, user);
  if (request.method !== 'GET') return json({ok:false,error:'GET only'},405);
  const until = finiteDate(url.searchParams.get('until'), new Date());
  const since = finiteDate(url.searchParams.get('since'), new Date(until.getTime()-7*86400000));
  if (!(since < until)) return json({ok:false,error:'Invalid analytics range'},400);
  const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit')||100),250));
  const select=[
    'at','name','path','props','uid','device_id','session_id','ip','user_agent','referrer',
    'country','region','city','postal','latitude','longitude','timezone','asn','asn_org','device','edge'
  ].join(',');
  const rows=await sbRows(env,
    `events?site_id=is.null&at=gte.${encodeURIComponent(since.toISOString())}`+
    `&at=lt.${encodeURIComponent(until.toISOString())}&select=${select}&order=at.desc&limit=${limit}`);
  return json({ok:true,range:{since:since.toISOString(),until:until.toISOString()},
    events:rows.map((e)=>({...e,device:publicDeviceSummary(e.device)}))});
}

function cleanTxt(value) {
  return String(value || '').replace(/^"|"$/g, '').replace(/"\s+"/g, '').replace(/\\(["\\])/g, '$1');
}

async function houseMembership(env, user) {
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const orgs = await sbJson(env, `orgs?slug=eq.${HOUSE_SLUG}&select=id,slug&limit=1`);
  const org = Array.isArray(orgs) ? orgs[0] : null;
  if (!org?.id) throw Object.assign(new Error('McCluster organization is not configured'), { status: 503 });

  const memberships = await sbJson(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user.id)}&select=org_id,profile_id,role&limit=1`
  );
  const membership = Array.isArray(memberships) ? memberships[0] : null;
  return { org, membership };
}

async function requireHouseOps(env, user) {
  const { org, membership } = await houseMembership(env, user);
  await requireCapability(env, membership, 'ops.use');
  return { org, membership };
}

async function requireHouseOwner(env, user) {
  const { org, membership } = await houseMembership(env, user);
  if (membership?.role !== 'owner') {
    throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
  }
  return { org, membership };
}

async function listAuthUsers(env) {
  const users = [];
  for (let page = 1; page <= MAX_AUTH_PAGES; page++) {
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json'
      }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('Auth user summary is unavailable'), { status: 502, detail: data });
    const pageUsers = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
    users.push(...pageUsers);
    if (pageUsers.length < AUTH_PAGE_SIZE) return users;
  }
  throw Object.assign(new Error('Auth user summary exceeded the safe pagination limit'), { status: 503 });
}

function durationMs(amount, unit) {
  if (unit.startsWith('hour') || unit === 'h') return amount * 60 * 60 * 1000;
  if (unit.startsWith('week') || unit === 'w') return amount * 7 * 24 * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function parseBusinessWindow(value, now = new Date()) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  let amount;
  let unit;
  let m = raw.match(/^(\d{1,4})\s*(h|d|w)$/);
  if (m) {
    amount = Number(m[1]);
    unit = m[2];
  } else {
    m = raw.match(/\b(?:last|past|previous|from\s+the\s+last)\s+(\d{1,4})\s*(hours?|days?|weeks?)\b/);
    if (!m) return null;
    amount = Number(m[1]);
    unit = m[2];
  }

  if (!Number.isFinite(amount) || amount < 1) return null;
  const max = unit.startsWith('hour') || unit === 'h' ? 24 * 365 : unit.startsWith('week') || unit === 'w' ? 260 : 1825;
  amount = Math.min(amount, max);
  const ms = durationMs(amount, unit);
  const since = new Date(now.getTime() - ms);
  const noun = unit.startsWith('hour') || unit === 'h' ? 'hour' : unit.startsWith('week') || unit === 'w' ? 'week' : 'day';
  return {
    amount,
    unit: noun,
    label: `last ${amount} ${noun}${amount === 1 ? '' : 's'}`,
    since: since.toISOString(),
    until: now.toISOString(),
    rolling: true
  };
}

function localDay(iso, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(iso));
    const vals = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${vals.year}-${vals.month}-${vals.day}`;
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

export async function businessSnapshot(env, windowSpec = null) {
  const users = await listAuthUsers(env);
  const sinceMs = windowSpec ? Date.parse(windowSpec.since) : null;
  const untilMs = windowSpec ? Date.parse(windowSpec.until) : null;
  const inWindow = (row) => {
    if (!windowSpec) return true;
    const at = Date.parse(row?.created_at || '');
    return Number.isFinite(at) && Number.isFinite(sinceMs) && Number.isFinite(untilMs) &&
      at >= sinceMs && at < untilMs;
  };
  const createdUsers = users.filter(inWindow);
  const confirmed = users.filter((u) => Boolean(u?.email_confirmed_at || u?.confirmed_at));
  const unconfirmed = users.filter((u) => !u?.email_confirmed_at && !u?.confirmed_at);
  const confirmedCreated = createdUsers.filter((u) => Boolean(u?.email_confirmed_at || u?.confirmed_at));
  const unconfirmedCreated = createdUsers.filter((u) => !u?.email_confirmed_at && !u?.confirmed_at);
  const activeUsers = windowSpec
    ? users.filter((u) => {
        const at = Date.parse(u?.last_sign_in_at || '');
        return Number.isFinite(at) && at >= sinceMs && at < untilMs;
      })
    : [];

  const timeZone = env.MCCLUSTER_TIMEZONE || 'America/New_York';
  const byDayMap = new Map();
  for (const user of createdUsers) {
    const day = localDay(user.created_at, timeZone);
    byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
  }

  const since = windowSpec?.since || null;
  const until = windowSpec?.until || null;
  const readErrors = {};
  const readDiagnostics = {};
  const [
    postsTotal, followsTotal, reactionsTotal, profilesTotal,
    postsWindow, followsWindow, reactionsWindow, profilesWindow,
    eventCounts, creatorProfilesTotal, creatorProfilesWindow,
    creatorTracksTotal, creatorTracksWindow, publishedTracksTotal, activeOffersTotal,
    paidOrdersTotal, paidOrdersWindow, entitlementsTotal, entitlementsWindow, paidOrderRows
  ] = await boundedReads([
    {key: 'postsTotal', run: () => sbCount(env, 'network_posts')},
    {key: 'followsTotal', run: () => sbCount(env, 'network_follows', 'follower_m_uid')},
    {key: 'reactionsTotal', run: () => sbCount(env, 'network_reactions', 'post_id')},
    {key: 'profilesTotal', run: () => sbCount(env, 'network_profiles', 'm_uid')},
    {key: 'postsWindow', run: () => since ? sbCount(env, 'network_posts', 'id', since, until) : Promise.resolve(null)},
    {key: 'followsWindow', run: () => since ? sbCount(env, 'network_follows', 'follower_m_uid', since, until) : Promise.resolve(null)},
    {key: 'reactionsWindow', run: () => since ? sbCount(env, 'network_reactions', 'post_id', since, until) : Promise.resolve(null)},
    {key: 'profilesWindow', run: () => since ? sbCount(env, 'network_profiles', 'm_uid', since, until) : Promise.resolve(null)},
    {key: 'eventCounts', run: () => loadBusinessEventCounts((path, init) => sbJson(env, path, init), {since, until})},
    {key: 'creatorProfilesTotal', run: () => sbCount(env, 'music_creator_profiles', 'm_uid')},
    {key: 'creatorProfilesWindow', run: () => since ? sbCount(env, 'music_creator_profiles', 'm_uid', since, until) : Promise.resolve(null)},
    {key: 'creatorTracksTotal', run: () => sbCount(env, 'creator_tracks')},
    {key: 'creatorTracksWindow', run: () => since ? sbCount(env, 'creator_tracks', 'id', since, until) : Promise.resolve(null)},
    {key: 'publishedTracksTotal', run: () => sbCountFiltered(env, 'creator_tracks', 'id', { status: 'eq.published' })},
    {key: 'activeOffersTotal', run: () => sbCountFiltered(env, 'music_license_offers', 'id', { active: 'eq.true', checkout_enabled: 'eq.true' })},
    {key: 'paidOrdersTotal', run: () => sbCountFiltered(env, 'music_orders', 'id', { status: 'eq.paid' })},
    {key: 'paidOrdersWindow', run: () => since ? sbCountFiltered(env, 'music_orders', 'id', { status: 'eq.paid' }, since, 'created_at', until) : Promise.resolve(null)},
    {key: 'entitlementsTotal', run: () => sbCountFiltered(env, 'music_entitlements', 'id', { revoked_at: 'is.null' })},
    {key: 'entitlementsWindow', run: () => since ? sbCountFiltered(env, 'music_entitlements', 'id', { revoked_at: 'is.null' }, since, 'created_at', until) : Promise.resolve(null)},
    {key: 'paidOrderRows', run: () => sbRows(env, 'music_orders?status=eq.paid&select=amount_cents,platform_fee_cents,creator_net_cents,created_at')}
  ].map(task => async () => {
    const started = Date.now();
    try {
      const value = await task.run();
      readDiagnostics[task.key] = successfulReadDiagnostics(Date.now() - started,
        value === null && (task.key.endsWith('Window') || task.key === 'paidOrderRows') && !since);
      return value;
    } catch (error) {
      readErrors[task.key] = 'Data read unavailable';
      readDiagnostics[task.key] = readFailureDiagnostics(error, Date.now() - started);
      return null;
    }
  }), 3); // Keep owner business reads below the dashboard's concurrent RPC load.
  // A failed aggregate leaves its family unknown; never substitute zero.
  // The readErrors.eventCounts key identifies the single server-side read.
  const eventCount = key => eventCounts == null ? null : eventCounts[key];
  const eventsTotal = eventCount('events_total');
  const eventsWindow = eventCount('events_window');
  const pageViewsTotal = eventCount('page_views_total');
  const pageViewsWindow = eventCount('page_views_window');
  const clicksTotal = eventCount('clicks_total');
  const clicksWindow = eventCount('clicks_window');
  const acquiredTotal = eventCount('acquired_total');
  const acquiredWindow = eventCount('acquired_window');
  const legacyPlaysTotal = eventCount('legacy_plays_total');
  const legacyPlaysWindow = eventCount('legacy_plays_window');
  const musicPlaysTotal = eventCount('music_plays_total');
  const musicPlaysWindow = eventCount('music_plays_window');
  const previewPlaysTotal = eventCount('preview_plays_total');
  const previewPlaysWindow = eventCount('preview_plays_window');
  const fullPlaysTotal = eventCount('full_plays_total');
  const fullPlaysWindow = eventCount('full_plays_window');
  const completesTotal = eventCount('completes_total');
  const completesWindow = eventCount('completes_window');

  /* Verified Stripe sales and bookings from the commerce reconciler, live
     only, net of refunds; test-mode money is reported apart (commerce/
     summary.js). A failure here leaves the rest of the snapshot intact. */
  const commerceStarted = Date.now();
  let commerceFailure = null;
  const commerce = await loadCommerceSummary((path) => sbRows(env, path), windowSpec)
    .catch((err) => {
      commerceFailure = err;
      return { available: false, reason: 'Verified commerce read unavailable' };
    });

  if (commerce.available === false) {
    readErrors.commerce = 'Verified commerce read unavailable';
    readDiagnostics.commerce = readFailureDiagnostics(commerceFailure, Date.now() - commerceStarted);
  } else {
    readDiagnostics.commerce = successfulReadDiagnostics(Date.now() - commerceStarted);
  }
  const paidRowsInWindow = since
    ? paidOrderRows?.filter((row) => {
        const at = Date.parse(row.created_at || '');
        return at >= Date.parse(since) && at < Date.parse(until);
      })
    : paidOrderRows;
  const sum = (rows, field) => rows == null ? null : rows.reduce((n, row) => n + Number(row?.[field] || 0), 0);

  return {
    generated_at: new Date().toISOString(),
    read_errors: readErrors,
    read_diagnostics: readDiagnostics,
    partial: Object.keys(readErrors).length > 0,
    timezone: timeZone,
    window: windowSpec,
    users: {
      total: users.length,
      created_in_window: windowSpec ? createdUsers.length : null,
      confirmed_total: confirmed.length,
      unconfirmed_total: unconfirmed.length,
      confirmed_in_window: windowSpec ? confirmedCreated.length : null,
      unconfirmed_in_window: windowSpec ? unconfirmedCreated.length : null,
      active_in_window: windowSpec ? activeUsers.length : null,
      percent_created_in_window: windowSpec && users.length
        ? Math.round((createdUsers.length / users.length) * 1000) / 10
        : null,
      created_by_day: windowSpec
        ? [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }))
        : []
    },
    platform: {
      events: { total: eventsTotal, in_window: eventsWindow },
      page_views: { total: pageViewsTotal, in_window: pageViewsWindow },
      clicks: { total: clicksTotal, in_window: clicksWindow },
      acquisitions: { total: acquiredTotal, in_window: acquiredWindow }
    },
    mnet: {
      profiles: { total: profilesTotal, created_in_window: profilesWindow },
      posts: { total: postsTotal, created_in_window: postsWindow },
      follows: { total: followsTotal, created_in_window: followsWindow },
      reactions: { total: reactionsTotal, created_in_window: reactionsWindow }
    },
    commerce,
    music: {
      legacy_album_plays: { total: legacyPlaysTotal, in_window: legacyPlaysWindow },
      inline_plays: { total: musicPlaysTotal, in_window: musicPlaysWindow },
      plays: {
        total: legacyPlaysTotal == null || musicPlaysTotal == null ? null : Number(legacyPlaysTotal) + Number(musicPlaysTotal),
        in_window: windowSpec && legacyPlaysWindow != null && musicPlaysWindow != null ? Number(legacyPlaysWindow) + Number(musicPlaysWindow) : null
      },
      preview_plays: { total: previewPlaysTotal, in_window: previewPlaysWindow },
      full_plays: { total: fullPlaysTotal, in_window: fullPlaysWindow },
      completions: { total: completesTotal, in_window: completesWindow },
      creators: { total: creatorProfilesTotal, created_in_window: creatorProfilesWindow },
      creator_tracks: { total: creatorTracksTotal, created_in_window: creatorTracksWindow },
      published_tracks: publishedTracksTotal,
      active_license_offers: activeOffersTotal,
      paid_orders: { total: paidOrdersTotal, in_window: paidOrdersWindow },
      entitlements: { total: entitlementsTotal, created_in_window: entitlementsWindow },
      revenue: {
        gross_cents: sum(paidOrderRows, 'amount_cents'),
        platform_fee_cents: sum(paidOrderRows, 'platform_fee_cents'),
        creator_net_cents: sum(paidOrderRows, 'creator_net_cents'),
        gross_cents_in_window: windowSpec ? sum(paidRowsInWindow, 'amount_cents') : null,
        platform_fee_cents_in_window: windowSpec ? sum(paidRowsInWindow, 'platform_fee_cents') : null,
        creator_net_cents_in_window: windowSpec ? sum(paidRowsInWindow, 'creator_net_cents') : null
      }
    }
  };
}
function metricLabel(subject) {
  if (subject === 'posts') return 'Mnet posts';
  if (subject === 'follows') return 'Mnet follows';
  if (subject === 'reactions') return 'Mnet reactions';
  if (subject === 'profiles') return 'Mnet profiles';
  return 'users';
}

export function answerBusinessQuestion(question, snapshot) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();
  if (!q) return { understood: false, error: 'question is required' };

  const wantsDaily = /\b(by day|daily|each day|per day)\b/.test(lower);
  const wantsPercent = /%|\bpercent(?:age)?\b|\bwhat share\b/.test(lower);
  const windowed = Boolean(snapshot.window);
  const unavailable = (metric) => ({ understood: true, available: false, metric, value: null,
    answer: 'That measurement is unavailable because its data read failed. Retry after checking the data connection.',
    context: { window: snapshot.window } });
  const temporalIntent = /\b(joined|new|created|signed\s*up|recent|today|yesterday|week|month|day|hour)\b/.test(lower);

  if (temporalIntent && !windowed) {
    return {
      understood: false,
      answer: 'I understood that as a time-scoped question, but not the window. Use a rolling window like "last 24 hours", "last 5 days", or "last 2 weeks".',
      supported_window_examples: ['24h', '5d', '2w']
    };
  }

  if (/\b(music|songs?|tracks?|streams?|plays?|previews?|creators?|licenses?|licensing|revenue|sales?|orders?|entitlements?)\b/.test(lower)) {
    const w = windowed ? 'in_window' : 'total';
    let metric;
    let value;
    let label;

    if (/\bplatform fee|platform revenue\b/.test(lower)) {
      metric = windowed ? 'music.revenue.platform_fee_cents_in_window' : 'music.revenue.platform_fee_cents';
      value = windowed ? snapshot.music.revenue.platform_fee_cents_in_window : snapshot.music.revenue.platform_fee_cents;
      label = '$' + (value == null ? 'unavailable' : (Number(value) / 100).toFixed(2)) + ' platform music revenue';
    } else if (/\brevenue\b|\bgross\b/.test(lower)) {
      metric = windowed ? 'music.revenue.gross_cents_in_window' : 'music.revenue.gross_cents';
      value = windowed ? snapshot.music.revenue.gross_cents_in_window : snapshot.music.revenue.gross_cents;
      label = '$' + (value == null ? 'unavailable' : (Number(value) / 100).toFixed(2)) + ' gross music revenue';
    } else if (/\bpreview/.test(lower)) {
      metric = 'music.preview_plays.' + w;
      value = snapshot.music.preview_plays[w];
      label = value + ' preview plays';
    } else if (/\bfull\b/.test(lower) && /\b(play|stream)/.test(lower)) {
      metric = 'music.full_plays.' + w;
      value = snapshot.music.full_plays[w];
      label = value + ' full-track plays';
    } else if (/\bcomplete|completion/.test(lower)) {
      metric = 'music.completions.' + w;
      value = snapshot.music.completions[w];
      label = value + ' completed plays';
    } else if (/\bcreator/.test(lower) && /\b(track|song|release)/.test(lower)) {
      const k = windowed ? 'created_in_window' : 'total';
      metric = 'music.creator_tracks.' + k;
      value = snapshot.music.creator_tracks[k];
      label = value + ' creator tracks';
    } else if (/\bcreator/.test(lower)) {
      const k = windowed ? 'created_in_window' : 'total';
      metric = 'music.creators.' + k;
      value = snapshot.music.creators[k];
      label = value + ' creator profiles';
    } else if (/\bpublished\b/.test(lower) && /\b(track|song|release)/.test(lower)) {
      metric = 'music.published_tracks';
      value = snapshot.music.published_tracks;
      label = value + ' published creator tracks';
    } else if (/\b(license|licensing|sale|order)/.test(lower)) {
      metric = 'music.paid_orders.' + w;
      value = snapshot.music.paid_orders[w];
      label = value + ' paid music-license orders';
    } else if (/\b(entitlement|download)/.test(lower)) {
      const k = windowed ? 'created_in_window' : 'total';
      metric = 'music.entitlements.' + k;
      value = snapshot.music.entitlements[k];
      label = value + ' active music entitlements';
    } else {
      metric = 'music.plays.' + w;
      value = snapshot.music.plays[w];
      label = value + ' music plays';
    }

    if (value == null) return unavailable(metric);
    return {
      understood: true,
      metric,
      value,
      answer: windowed ? label + ' in the ' + snapshot.window.label + '.' : 'There are ' + label + '.',
      context: { window: snapshot.window, music: snapshot.music }
    };
  }

  if (/\b(page views?|clicks?|acquisitions?|analytics events?|site events?)\b/.test(lower)) {
    const w = windowed ? 'in_window' : 'total';
    const bucket = /\bpage views?\b/.test(lower) ? 'page_views'
      : /\bclicks?\b/.test(lower) ? 'clicks'
        : /\bacquisitions?\b/.test(lower) ? 'acquisitions'
          : 'events';
    const value = snapshot.platform[bucket][w];
    if (value == null) return unavailable('platform.' + bucket + '.' + w);
    return {
      understood: true,
      metric: 'platform.' + bucket + '.' + w,
      value,
      answer: windowed
        ? value + ' platform ' + bucket.replace(/_/g, ' ') + ' in the ' + snapshot.window.label + '.'
        : 'There are ' + value + ' total platform ' + bucket.replace(/_/g, ' ') + '.',
      context: { window: snapshot.window }
    };
  }

  if (/\b(users?|accounts?|signups?|members?)\b/.test(lower)) {
    let metric = 'users.total';
    let value = snapshot.users.total;

    if (/\bunconfirmed\b|\bunverified\b|not confirmed/.test(lower)) {
      metric = windowed ? 'users.unconfirmed_in_window' : 'users.unconfirmed_total';
      value = windowed ? snapshot.users.unconfirmed_in_window : snapshot.users.unconfirmed_total;
    } else if (/\bconfirmed\b|\bverified\b/.test(lower)) {
      metric = windowed ? 'users.confirmed_in_window' : 'users.confirmed_total';
      value = windowed ? snapshot.users.confirmed_in_window : snapshot.users.confirmed_total;
    } else if (windowed) {
      metric = 'users.created_in_window';
      value = snapshot.users.created_in_window;
    }

    if (wantsDaily && windowed) {
      return {
        understood: true,
        metric: 'users.created_by_day',
        value: snapshot.users.created_by_day,
        answer: snapshot.users.created_in_window + ' users joined in the ' + snapshot.window.label + '.',
        context: { total_users: snapshot.users.total, window: snapshot.window }
      };
    }

    const percent = windowed ? snapshot.users.percent_created_in_window : null;
    let response = metric === 'users.total'
      ? 'There are ' + value + ' total users.'
      : value + ' users match that question for the ' + snapshot.window.label + '.';
    if (windowed && (wantsPercent || metric === 'users.created_in_window')) {
      response += ' That is ' + percent + '% of ' + snapshot.users.total + ' total users.';
    }
    return { understood: true, metric, value, answer: response, context: { total_users: snapshot.users.total, percent, window: snapshot.window } };
  }

  const subject = /\bposts?\b/.test(lower) ? 'posts'
    : /\bfollows?|followers?\b/.test(lower) ? 'follows'
      : /\breactions?|likes?\b/.test(lower) ? 'reactions'
        : /\bprofiles?\b/.test(lower) ? 'profiles'
          : null;

  if (subject) {
    const bucket = snapshot.mnet[subject];
    const value = windowed ? bucket.created_in_window : bucket.total;
    const metric = 'mnet.' + subject + '.' + (windowed ? 'created_in_window' : 'total');
    if (value == null) return unavailable(metric);
    return {
      understood: true,
      metric,
      value,
      answer: windowed
        ? value + ' ' + metricLabel(subject) + ' were created in the ' + snapshot.window.label + '.'
        : 'There are ' + value + ' total ' + metricLabel(subject) + '.',
      context: { total: bucket.total, window: snapshot.window }
    };
  }

  return {
    understood: false,
    answer: 'I can answer platform growth, Mnet, music, creator, licensing, and first-party traffic questions without guessing.',
    supported_examples: [
      'How many users do we have?',
      'How many users joined in the last 5 days?',
      'How many Mnet posts were created in the last 30 days?',
      'How many music plays were there in the last 7 days?',
      'How many creator profiles do we have?',
      'How much music revenue did we make in the last 30 days?',
      'How many page views were there in the last 24 hours?'
    ]
  };
}
async function handleBusinessSnapshot(request, env, user, url) {
  const { membership } = await requireHouseOps(env, user);
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const rawWindow = url.searchParams.get('window') || '';
  const rawSince = url.searchParams.get('since') || '';
  const rawUntil = url.searchParams.get('until') || '';
  let windowSpec = rawWindow ? parseBusinessWindow(rawWindow) : null;
  if (rawWindow && !windowSpec) return json({ ok: false, error: 'Invalid window. Use values like 24h, 5d, or 2w.' }, 400);
  if (!rawWindow && (rawSince || rawUntil)) {
    const until = finiteDate(rawUntil, new Date());
    const since = finiteDate(rawSince, new Date(until.getTime() - 7 * 86400000));
    if (!(since < until)) return json({ ok:false, error:'Invalid explicit analytics range' },400);
    windowSpec = {
      label: url.searchParams.get('label') || 'selected range',
      since: since.toISOString(), until: until.toISOString(), rolling:false
    };
  }
  return json({ ok: true, snapshot: visibleBusinessSnapshot(
    await businessSnapshot(env, windowSpec), membership?.role === 'owner'
  ) });
}

async function handleBusinessQuestion(request, env, user) {
  await requireHouseOps(env, user);
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const question = String(body?.question || '').trim();
  if (!question) return json({ ok: false, error: 'question is required' }, 400);
  const explicitWindow = String(body?.window || '').trim();
  const windowSpec = explicitWindow
    ? parseBusinessWindow(explicitWindow)
    : parseBusinessWindow(question);
  if (explicitWindow && !windowSpec) return json({ ok: false, error: 'Invalid window. Use values like 24h, 5d, or 2w.' }, 400);

  const snapshot = await businessSnapshot(env, windowSpec);
  const result = answerBusinessQuestion(question, snapshot);
  return json({ ok: true, question, ...result, generated_at: snapshot.generated_at });
}

/* Session forensics lives in its own module: owner-only routes that return
   per-person rows (IP, place, signed-in email), kept apart from the business
   analytics above, which must stay aggregate. */
const forensics = createForensicRoutes({ json, sbJson, sbRows, sbRowsPaged, finiteDate, publicDeviceSummary, requireHouseOwner });
const audienceScience = createAudienceScienceRoutes({ json, sbRowsPaged, finiteDate, requireHouseOwner });
const experienceAnalytics = createExperienceAnalyticsRoutes({ json, sbRows, sbRowsPaged, finiteDate, requireHouseOwner });
const cameraAnalytics = createCameraRoutes({ json, requireOwner: requireHouseOwner });


/* Bounded owner-only account explorer. Events are matched by authenticated uid
   only; shared device IDs must never be treated as proof of identity. */
async function handleUserExplorer(request, env, user, url) {
  await requireHouseOwner(env, user);
  if (request.method !== 'GET') return json({ok:false,error:'GET only'},405);
  const paging=validateUserPage(url);
  if(!paging)return json({ok:false,error:'Invalid pagination'},400);
  const {limit,page}=paging;
  const res=await fetch(env.SUPABASE_URL+'/auth/v1/admin/users?page='+page+'&per_page='+limit,{
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,
      authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,accept:'application/json'}
  });
  if(!res.ok)throw Object.assign(new Error('Account listing unavailable'),{status:502});
  const data=await res.json();
  const accounts=Array.isArray(data?.users)?data.users:[];
  const ids=accounts.map(u=>String(u.id||'')).filter(id=>/^[0-9a-f-]{36}$/i.test(id));
  const allEvents=[];
  // Per-account bounds prevent one prolific account from starving others.
  // Histories remain explicitly sampled, with at most 100 events per UID.
  // Bound concurrent PostgREST requests while retaining independent per-UID caps.
  // Promise.all preserves account order; one failed query fails the owner request.
  const EVENT_QUERY_CONCURRENCY = 5;
  for (let offset = 0; offset < ids.length; offset += EVENT_QUERY_CONCURRENCY) {
    const batches = await Promise.all(ids.slice(offset, offset + EVENT_QUERY_CONCURRENCY).map(id =>
      sbRows(env, 'events?site_id=is.null&uid=eq.' + encodeURIComponent(id) +
        '&select=uid,at,name,path,session_id,referrer&order=at.desc&limit=100')
    ));
    for (const rows of batches) allEvents.push(...rows);
  }
  const eventsById=groupUserEvents(allEvents,new Set(ids));
  const users=[];
  for(const u of accounts){
    const id=String(u.id||'');
    if(!eventsById.has(id))continue;
    const events=eventsById.get(id);
    const activity=engagementScore(events);
    const meta=u.user_metadata&&typeof u.user_metadata==='object'?u.user_metadata:{};
    users.push({
      id,display_name:[meta.first_name,meta.last_name].filter(Boolean).join(' ')||u.email||id,
      email:u.email||null,segment:activity.events?'Active in last 30 days':'No recent recorded activity',
      attributes:{created_at:u.created_at||null,email_confirmed_at:u.email_confirmed_at||null,
        first_name:meta.first_name||null,last_name:meta.last_name||null,
        observed_events_sample:events.length,observed_sessions_sample:activity.sessions},
      events:events.map(e=>({at:e.at,name:e.name,path:e.path,source:e.referrer})),
      scores:{engagement:{value:activity.value,window_days:30,
        explanation:'4 points per meaningful event plus 3 per observed session, capped at 100; based on latest 100 authenticated events.'}}
    });
  }
  return json({ok:true,users,page,limit,has_more:accounts.length===limit,
    scoring:'Engagement is a preliminary descriptive activity index; other dimensions require validated conversion and retention signals.'});
}


/* Self-service dashboards: never use caller-provided user or creator IDs. */
async function handleSelfMusicAnalytics(request,env,user,url,path){
 if(!user?.id)throw Object.assign(new Error('Authentication required'),{status:401});
 if(request.method!=='GET')return json({ok:false,error:'GET only'},405);
 const since=new Date(Date.now()-30*86400000).toISOString();
 if(path==='/v1/analytics/my-listening'){
   const rows=await sbRows(env,'events?site_id=is.null&uid=eq.'+encodeURIComponent(user.id)+
     '&at=gte.'+encodeURIComponent(since)+
     '&name=in.(album_play,music_play,music_full_play,music_preview_play,music_complete,song_start,track_share)'+
     '&select=at,name,path,props&order=at.desc&limit=500');
   const counts={};for(const e of rows)counts[e.name]=(counts[e.name]||0)+1;
   return json({ok:true,window_days:30,sample_limited:rows.length===500,
     counts,activity:rows.slice(0,60).map(e=>({at:e.at,name:e.name,
       track:String(e.props?.track||e.props?.song||'').slice(0,120)}))});
 }
 const links=await sbRows(env,'m_auth_user_links?auth_user_id=eq.'+encodeURIComponent(user.id)+
   '&is_primary=eq.true&select=m_uid&limit=1');
 const mUid=links[0]?.m_uid;
 if(!mUid)return json({ok:true,creator:false,window_days:30,tracks:[],counts:{}});
 const tracks=await sbRows(env,'creator_tracks?m_uid=eq.'+encodeURIComponent(mUid)+
   '&select=id,title,status,published_at&limit=200');
 const ids=new Set(tracks.map(t=>String(t.id)));
 const counts={};
 const profiles=await sbRows(env,'music_creator_profiles?m_uid=eq.'+encodeURIComponent(mUid)+
   '&select=handle&limit=1');
 const candidateHandle=String(profiles[0]?.handle||'');
 const handle=/^[a-z0-9][a-z0-9._-]{2,39}$/.test(candidateHandle)?candidateHandle:'';
 const pageScope='(props->>creator_handle.eq.'+handle+',props->>url.like.*music-creator.html?*handle='+handle+'*,path.like.music-creator.html?*handle='+handle+'*)';
 const trafficRows=handle?await sbRows(env,'events?site_id=is.null&at=gte.'+encodeURIComponent(since)+
   '&or='+encodeURIComponent(pageScope)+
   '&name=in.(page_view,pageview)&select=at,path,referrer,session_id,props,country&order=at.desc&limit=1000'):[];
 const traffic=trafficRows.filter(e=>{
   const raw=String(e.path||'');
   if(raw==='music-creator.html'&&e.props?.creator_handle===handle)return true;
   // Older page views retained the creator URL in props while path lost its query.
   for(const value of [e.props?.url,raw]){
     try{
       if(typeof value!=='string')continue;
       const u=new URL(value,'https://matthew.mccluster.org/');
       if(u.pathname==='/music-creator.html'&&u.searchParams.get('handle')===handle)return true;
     }catch{}
   }
   return false;
 });
 const daily={};const sources={};const sessions=new Set();
 for(const e of traffic){
   const day=String(e.at||'').slice(0,10);
   if(/^\d{4}-\d{2}-\d{2}$/.test(day))daily[day]=(daily[day]||0)+1;
   if(e.session_id)sessions.add(e.session_id);
   let source='Direct / unknown';
   try{if(e.referrer){const u=new URL(e.referrer);source=u.hostname;}}catch{}
   sources[source]=(sources[source]||0)+1;
 }
 const pageTraffic={views:traffic.length,approximate_sessions:sessions.size,
   daily,sources,sample_limited:trafficRows.length===1000};
 // The creator-only audience layer on the World globe: views of this
 // creator's own page by country. Country only, never region, city, postal
 // code or coordinates; small countries are folded into "elsewhere".
 const byCountry={};let unknownViews=0;
 for(const e of traffic){
   const c=String(e.country||'').toUpperCase();
   if(/^[A-Z]{2}$/.test(c)&&c!=='XX'&&c!=='T1')byCountry[c]=(byCountry[c]||0)+1;else unknownViews++;
 }
 const countries=[];let elsewhere=0;
 for(const [country,views] of Object.entries(byCountry)){if(views>=AUDIENCE_MIN_VIEWS)countries.push({country,views});else elsewhere+=views;}
 countries.sort((a,b)=>b.views-a.views||a.country.localeCompare(b.country));
 const audience={countries,elsewhere_views:elsewhere,unknown_views:unknownViews,min_views:AUDIENCE_MIN_VIEWS,
   sample_limited:trafficRows.length===1000};
 const perTrack=new Map(tracks.map(t=>[String(t.id),{id:t.id,title:t.title,status:t.status,
   plays:0,completions:0,shares:0}]));
 if(ids.size){
   // Scope to owned catalog IDs in the database before limiting the sample.
   // Keep the in-memory ownership check as well.
   const rows=await sbRows(env,'events?site_id=is.null&at=gte.'+encodeURIComponent(since)+
     '&name=in.(music_play,music_full_play,music_preview_play,music_complete,song_start,track_share)'+
     '&props->>creator_track_id=in.('+[...ids].map(encodeURIComponent).join(',')+')'+
     '&select=name,props&order=at.desc&limit=1000');
   for(const e of rows){
     const id=String(e.props?.creator_track_id||'');
     const item=perTrack.get(id);if(!item)continue;
     if(['music_play','song_start'].includes(e.name))item.plays++;
     if(e.name==='music_complete')item.completions++;
     if(e.name==='track_share')item.shares++;
     counts[e.name]=(counts[e.name]||0)+1;
   }
 }
 // A creator is someone with a music profile or tracks, not every linked member.
 return json({ok:true,creator:!!handle||tracks.length>0,window_days:30,sample_limited:true,
   disclaimer:'Observed matching events only; counts may be incomplete due to event sampling.',
   counts,page_traffic:pageTraffic,audience,tracks:[...perTrack.values()]});
}

export async function handleAnalyticsRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  const cameraResponse = await cameraAnalytics(request, env, user, url, path);
  if (cameraResponse) return cameraResponse;
  if (path === '/v1/analytics/measurement-contract') {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
    return json({ ok:true, version:DICTIONARY_VERSION, source:DICTIONARY_SOURCE,
      unknown_event_policy:'unclassified', events:EVENT_DICTIONARY,
      metrics:METRIC_DICTIONARY, datasets:DATASETS });
  }
  if (path === '/v1/analytics/event-inventory') {
    // All event names (including operations and unknown stages) are owner-only.
    const {org}=await requireHouseOwner(env,user);
    if(request.method!=='GET')return json({ok:false,error:'GET required'},405);
    const events=cleanInventory(await sbRows(env,
      'rpc/analytics_event_inventory_v1',));
    const safeOrg=encodeURIComponent(org.id);
    // One complete source-scoped aggregate: no unordered or capped account
    // fetch, and no false zero when one backend source fails.
    let provider;
    try {
      const counts=await sbRows(env,
        'rpc/analytics_instagram_source_status_v1?p_org='+safeOrg);
      provider=socialCoverage(Array.isArray(counts)&&counts.length===1?counts[0]:null);
    } catch {
      provider=socialCoverage(null);
    }
    return json({ok:true,measured_at:new Date().toISOString(),...events,providers:provider,
      partial:provider.instagram.status==='unavailable'});
  }
  if (path === '/v1/analytics/coverage') {
    if (request.method !== 'GET') return json({ error: 'GET required' }, 405);
    try {
      const { org } = await requireHouseOwner(env, user);
      return json(await dataCoverage(env, org.id, url));
    } catch (error) { return json({ error: error.message }, error.status || 502); }
  }

  if (path === '/v1/analytics/my-listening' || path === '/v1/analytics/my-creator')
    return handleSelfMusicAnalytics(request,env,user,url,path);
  if (path === '/v1/analytics/users') return handleUserExplorer(request, env, user, url);
  if (path === '/v1/analytics/business') {
    return handleBusinessSnapshot(request, env, user, url);
  }
  if (path === '/v1/analytics/ask') {
    return handleBusinessQuestion(request, env, user);
  }
  if (path === '/v1/analytics/identity') {
    return handleIdentityAnalytics(request, env, user, url);
  }
  if (path === '/v1/analytics/regions') {
    return handleRegionAnalytics(request, env, user, url);
  }
  if (path === '/v1/analytics/forensics') {
    return handleForensics(request, env, user, url);
  }
  const experienceResponse = await experienceAnalytics.route(request, env, user, url, path);
  if (experienceResponse) return experienceResponse;

  const audienceScienceResponse = await audienceScience.route(request, env, user, url, path);
  if (audienceScienceResponse) return audienceScienceResponse;

  const forensicResponse = await forensics.route(request, env, user, url, path);
  if (forensicResponse) return forensicResponse;

  const match = path.match(/^\/v1\/analytics\/domains\/([0-9a-f-]{36})\/verify$/i);
  if (!match) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!user?.id) return json({ ok: false, error: 'Authentication required' }, 401);

  const domainId = match[1];
  const domainRes = await sb(env,
    `analytics_site_domains?id=eq.${encodeURIComponent(domainId)}&select=id,site_id,hostname,verification_token,verified_at,verification_method&limit=1`
  );
  if (!domainRes.ok) return json({ ok: false, error: 'Domain lookup failed' }, 502);
  const domains = await domainRes.json();
  const domain = domains[0];
  if (!domain) return json({ ok: false, error: 'Domain not found' }, 404);

  const siteRes = await sb(env,
    `analytics_sites?id=eq.${encodeURIComponent(domain.site_id)}&select=id,owner_user_id,status&limit=1`
  );
  if (!siteRes.ok) return json({ ok: false, error: 'Site lookup failed' }, 502);
  const sites = await siteRes.json();
  const site = sites[0];
  if (!site || site.owner_user_id !== user.id) return json({ ok: false, error: 'Forbidden' }, 403);
  if (site.status !== 'active') return json({ ok: false, error: 'Site is not active' }, 409);

  if (domain.verified_at) {
    return json({ ok: true, verified: true, hostname: domain.hostname, method: domain.verification_method });
  }

  const qname = `_mccluster-analytics.${domain.hostname}`;
  let dns;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(qname)}&type=TXT`, {
      headers: { accept: 'application/dns-json' }
    });
    if (!r.ok) throw new Error(`dns ${r.status}`);
    dns = await r.json();
  } catch {
    return json({ ok: false, error: 'DNS verification unavailable' }, 502);
  }

  const answers = Array.isArray(dns?.Answer) ? dns.Answer : [];
  const found = answers.some((answer) => cleanTxt(answer?.data) === domain.verification_token);
  if (!found) {
    return json({
      ok: true,
      verified: false,
      hostname: domain.hostname,
      record: { type: 'TXT', name: qname, value: domain.verification_token }
    });
  }

  const verifiedAt = new Date().toISOString();
  const patch = await sb(env, `analytics_site_domains?id=eq.${encodeURIComponent(domain.id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ verified_at: verifiedAt, verification_method: 'dns', updated_at: verifiedAt })
  });
  if (!patch.ok) return json({ ok: false, error: 'Could not save verification' }, 502);

  return json({ ok: true, verified: true, hostname: domain.hostname, method: 'dns', verified_at: verifiedAt });
}
