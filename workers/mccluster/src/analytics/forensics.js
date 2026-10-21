// Control Analytics > Forensics: sessions, visitors, flows and errors,
// owner-only.
//
// The router hands in its own helpers so this module shares the exact same
// database client, owner gate and device summarizer instead of a copy.
import { summarizeFlows, summarizeErrors, FLOW_EVENT_NAMES, ERROR_EVENT_NAMES } from './forensic-insights.js';

export function createForensicRoutes({ json, sbJson, sbRows, sbRowsPaged, finiteDate, publicDeviceSummary, requireHouseOwner }) {
  /* SESSION FORENSICS. Forensics used to be the latest raw events in one
     table. These routes return sessions you can open and the visitors they
     belong to, aggregated in Postgres (analytics_session_list /
     analytics_visitor_list, service role only). Every route is house-owner
     only: the rows carry IPs, places, devices and signed-in identities. */
  const SESSION_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;
  const VISITOR_KEY_RE = /^(u:[0-9a-f-]{36}|d:[A-Za-z0-9._:-]{4,128})$/i;
  const SESSION_FILTERS = new Set(['all', 'identified', 'music', 'signup', 'converted', 'friction', 'returning', 'engaged', 'bots']);
  const SESSION_SORTS = new Set(['recent', 'engaged', 'events', 'friction', 'oldest']);
  const VISITOR_FILTERS = new Set(['all', 'identified', 'returning', 'music', 'signup', 'friction', 'engaged', 'bots']);
  const VISITOR_SORTS = new Set(['recent', 'sessions', 'engaged', 'first_seen']);
  const HISTORY_DAYS = 180;
  const SESSION_EVENT_CAP = 2000;
  const EVENT_SELECT = [
    'at', 'name', 'path', 'props', 'uid', 'device_id', 'session_id', 'ip', 'user_agent', 'referrer',
    'country', 'region', 'city', 'postal', 'latitude', 'longitude', 'timezone', 'asn', 'asn_org', 'device', 'is_bot'
  ].join(',');

  function forensicWindow(url, defaultDays = 7) {
    const until = finiteDate(url.searchParams.get('until'), new Date());
    const since = finiteDate(url.searchParams.get('since'), new Date(until.getTime() - defaultDays * 86400000));
    if (!(since < until)) throw Object.assign(new Error('Invalid analytics range'), { status: 400 });
    return { since, until };
  }

  function intParam(url, name, fallback, min, max) {
    const n = Math.trunc(Number(url.searchParams.get(name)));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function pick(value, allowed, fallback) {
    const v = String(value || '').trim().toLowerCase();
    return allowed.has(v) ? v : fallback;
  }

  function searchParam(url) {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
    return q || null;
  }

  function forensicSession(s) {
    return s && typeof s === 'object' ? { ...s, device: publicDeviceSummary(s.device) } : s;
  }

  async function sessionList(env, body) {
    const out = await sbJson(env, 'rpc/analytics_session_list', { method: 'POST', body: JSON.stringify(body) });
    return out && typeof out === 'object' ? out : { total: 0, counts: {}, sessions: [] };
  }

  async function devicesForUser(env, uid) {
    const rows = await sbRows(env,
      `events?uid=eq.${encodeURIComponent(uid)}&device_id=not.is.null&site_id=is.null&select=device_id&order=at.desc&limit=1000`);
    return [...new Set(rows.map((r) => String(r.device_id || '')).filter((d) => SESSION_ID_RE.test(d)))].slice(0, 20);
  }

  async function profileFor(env, uid) {
    if (!uid) return null;
    const rows = await sbRows(env,
      `platform_profiles?user_id=eq.${encodeURIComponent(uid)}&select=display_name,primary_email,mccluster_id,avatar_url,created_at&limit=1`);
    const p = rows[0];
    return p ? { display_name: p.display_name || null, email: p.primary_email || null, handle: p.mccluster_id || null,
      avatar_url: p.avatar_url || null, created_at: p.created_at || null } : null;
  }

  async function handleSessionList(request, env, user, url) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const { since, until } = forensicWindow(url);
    const out = await sessionList(env, {
      p_since: since.toISOString(), p_until: until.toISOString(),
      p_limit: intParam(url, 'limit', 40, 1, 100), p_offset: intParam(url, 'offset', 0, 0, 20000),
      p_filter: pick(url.searchParams.get('filter'), SESSION_FILTERS, 'all'),
      p_sort: pick(url.searchParams.get('sort'), SESSION_SORTS, 'recent'),
      p_q: searchParam(url)
    });
    return json({ ok: true, range: { since: since.toISOString(), until: until.toISOString() },
      total: Number(out.total) || 0, counts: out.counts || {}, unsessioned_events: out.unsessioned_events ?? null,
      sessions: (out.sessions || []).map(forensicSession) });
  }

  async function handleSessionDetail(request, env, user, sessionId) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const events = await sbRows(env,
      `events?session_id=eq.${encodeURIComponent(sessionId)}&site_id=is.null&select=${EVENT_SELECT}&order=at.asc&limit=${SESSION_EVENT_CAP}`);
    if (!events.length) return json({ ok: false, error: 'Session not found' }, 404);
    const first = new Date(events[0].at), last = new Date(events[events.length - 1].at);
    const summary = await sessionList(env, {
      p_since: first.toISOString(), p_until: new Date(last.getTime() + 1).toISOString(),
      p_limit: 1, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_sessions: [sessionId]
    });
    const session = forensicSession((summary.sessions || [])[0] || null);
    const deviceId = session?.device_id || events.find((e) => e.device_id)?.device_id || null;
    const uid = session?.uid || events.find((e) => e.uid)?.uid || null;
    const devices = uid ? await devicesForUser(env, uid) : [];
    if (deviceId && !devices.includes(deviceId)) devices.unshift(deviceId);
    const now = new Date();
    const history = devices.length ? await sessionList(env, {
      p_since: new Date(Math.min(first.getTime(), now.getTime() - HISTORY_DAYS * 86400000)).toISOString(),
      p_until: now.toISOString(), p_limit: 60, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_devices: devices
    }) : { total: 0, sessions: [] };
    return json({
      ok: true,
      session,
      events: events.map((e) => ({ ...e, device: publicDeviceSummary(e.device) })),
      truncated: events.length >= SESSION_EVENT_CAP,
      visitor: {
        key: uid ? `u:${uid}` : deviceId ? `d:${deviceId}` : null,
        uid, devices, profile: await profileFor(env, uid),
        total: Number(history.total) || 0,
        sessions: (history.sessions || []).map(forensicSession)
      }
    });
  }

  async function handleVisitorList(request, env, user, url) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const { since, until } = forensicWindow(url);
    const out = await sbJson(env, 'rpc/analytics_visitor_list', {
      method: 'POST',
      body: JSON.stringify({
        p_since: since.toISOString(), p_until: until.toISOString(),
        p_limit: intParam(url, 'limit', 40, 1, 100), p_offset: intParam(url, 'offset', 0, 0, 20000),
        p_filter: pick(url.searchParams.get('filter'), VISITOR_FILTERS, 'all'),
        p_sort: pick(url.searchParams.get('sort'), VISITOR_SORTS, 'recent'),
        p_q: searchParam(url)
      })
    });
    return json({ ok: true, range: { since: since.toISOString(), until: until.toISOString() },
      total: Number(out?.total) || 0, counts: out?.counts || {},
      visitors: (out?.visitors || []).map((v) => ({ ...v, device: publicDeviceSummary(v.device) })) });
  }

  async function handleVisitorDetail(request, env, user, key) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const uid = key.startsWith('u:') ? key.slice(2).toLowerCase() : null;
    const devices = uid ? await devicesForUser(env, uid) : [key.slice(2)];
    const now = new Date();
    const history = devices.length ? await sessionList(env, {
      p_since: new Date(now.getTime() - HISTORY_DAYS * 86400000).toISOString(), p_until: now.toISOString(),
      p_limit: 100, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_devices: devices
    }) : { total: 0, sessions: [] };
    const sessions = (history.sessions || []).map(forensicSession);
    if (!uid && !sessions.length) return json({ ok: false, error: 'Visitor not found' }, 404);
    return json({ ok: true, visitor: { key, uid, devices, profile: await profileFor(env, uid),
      history_days: HISTORY_DAYS, total: Number(history.total) || 0, sessions } });
  }


  /* FLOWS AND ERRORS. Across every session in the range rather than one at a
     time: how people move between pages, where they enter, leave and stall,
     and every error and friction point grouped with the journeys that hit
     it. Bounded to 31 days and a fixed row budget so the read stays cheap;
     flows read events_lean (narrow), errors read only the handful of event
     names that carry an error or friction signal. */
  const INSIGHT_MAX_DAYS = 31;
  const FLOW_ROW_BUDGET = 60000;
  const ERROR_ROW_BUDGET = 20000;

  function insightWindow(url) {
    const { since, until } = forensicWindow(url);
    const floor = new Date(until.getTime() - INSIGHT_MAX_DAYS * 86400000);
    return { since: since < floor ? floor : since, until, clamped: since < floor };
  }

  async function handleFlows(request, env, user, url) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const { since, until, clamped } = insightWindow(url);
    const q = new URLSearchParams({
      site_id: 'is.null', is_bot: 'is.false', session_id: 'not.is.null',
      name: `in.(${FLOW_EVENT_NAMES.join(',')})`,
      select: 'session_id,device_id,at,name,path,visible_s,depth', order: 'at.asc'
    });
    q.append('at', `gte.${since.toISOString()}`);
    q.append('at', `lt.${until.toISOString()}`);
    const rows = await sbRowsPaged(env, `events_lean?${q.toString()}`, FLOW_ROW_BUDGET);
    return json({ ok: true, range: { since: since.toISOString(), until: until.toISOString(), clamped },
      rows_read: rows.length, truncated: rows.length >= FLOW_ROW_BUDGET, flows: summarizeFlows(rows) });
  }

  async function handleErrors(request, env, user, url) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const { since, until, clamped } = insightWindow(url);
    const q = new URLSearchParams({
      site_id: 'is.null', is_bot: 'not.is.true',
      name: `in.(${ERROR_EVENT_NAMES.join(',')})`,
      select: 'at,name,path,props,session_id,device_id,user_agent', order: 'at.desc'
    });
    q.append('at', `gte.${since.toISOString()}`);
    q.append('at', `lt.${until.toISOString()}`);
    const rows = await sbRowsPaged(env, `events?${q.toString()}`, ERROR_ROW_BUDGET);
    return json({ ok: true, range: { since: since.toISOString(), until: until.toISOString(), clamped },
      rows_read: rows.length, truncated: rows.length >= ERROR_ROW_BUDGET, ...summarizeErrors(rows) });
  }

  async function route(request, env, user, url, path) {
    if (path === '/v1/analytics/flows') return handleFlows(request, env, user, url);
    if (path === '/v1/analytics/errors') return handleErrors(request, env, user, url);
    if (path === '/v1/analytics/sessions') return handleSessionList(request, env, user, url);
    if (path === '/v1/analytics/visitors') return handleVisitorList(request, env, user, url);
    if (!/^\/v1\/analytics\/(sessions|visitors)\//.test(path)) return null;
    let decoded;
    try { decoded = decodeURIComponent(path); }
    catch { return json({ ok: false, error: 'Invalid path' }, 400); }
    const forensic = decoded.match(/^\/v1\/analytics\/(sessions|visitors)\/([^/]+)$/);
    if (!forensic) return null;
    const [, kind, id] = forensic;
    if (kind === 'sessions') {
      if (!SESSION_ID_RE.test(id)) return json({ ok: false, error: 'Invalid session id' }, 400);
      return handleSessionDetail(request, env, user, id);
    }
    if (!VISITOR_KEY_RE.test(id)) return json({ ok: false, error: 'Invalid visitor key' }, 400);
    return handleVisitorDetail(request, env, user, id);
  }

  return { route, SESSION_ID_RE, VISITOR_KEY_RE };
}
