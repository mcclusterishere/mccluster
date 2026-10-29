// Control Analytics > Forensics: sessions, visitors, flows and errors,
// owner-only.
//
// The router hands in its own helpers so this module shares the exact same
// database client, owner gate and device summarizer instead of a copy.
import { summarizeFlows, summarizeErrors, FLOW_EVENT_NAMES, ERROR_EVENT_NAMES } from './forensic-insights.js';

export function createForensicRoutes({ json, sbJson, sbRows, sbRowsPaged, finiteDate, publicDeviceSummary, requireHouseOwner }) {
  /* SESSION FORENSICS. Forensics used to be the latest raw events in one
     table. These routes return sessions you can open and the visitors they
     can be associated with, using event-bound Postgres evidence
     (analytics_session_evidence_v6 / analytics_visitor_list_v6, service role only). Every route is house-owner
     only: the rows carry IPs, places, devices and signed-in identities. */
  const SESSION_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;
  const VISITOR_KEY_RE = /^(u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|d:[A-Za-z0-9._:-]{4,128})$/i;
  const SESSION_FILTERS = new Set(['all', 'identified', 'music', 'signup', 'converted', 'friction', 'returning', 'engaged', 'bots']);
  const SESSION_SORTS = new Set(['recent', 'engaged', 'events', 'friction', 'oldest']);
  const VISITOR_FILTERS = new Set(['all', 'identified', 'returning', 'music', 'signup', 'friction', 'engaged', 'bots']);
  const VISITOR_SORTS = new Set(['recent', 'sessions', 'engaged', 'first_seen']);
  const HISTORY_DAYS = 180;
  const SESSION_EVENT_CAP = 2000;
  const EVENT_SELECT = [
    'id', 'at', 'name', 'path', 'props', 'uid', 'device_id', 'session_id', 'ip', 'user_agent', 'referrer',
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

  async function evidenceRpc(env, name, body) {
    try {
      const out = await sbJson(env, 'rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
      if (!out || typeof out !== 'object' || out.total == null || !Number.isFinite(Number(out.total))) {
        throw Object.assign(new Error('Analytics identity read returned an invalid response'), { status: 502 });
      }
      return out;
    } catch (err) {
      if (['PGRST202', '42883'].includes(err.db_code)) {
        throw Object.assign(new Error('Analytics identity upgrade is required before this view can load. Retry after the upgrade is available.'),
          { status: 503, code: 'analytics_identity_schema_required', db_code: err.db_code });
      }
      throw err;
    }
  }

  async function sessionList(env, body) {
    const out = await evidenceRpc(env, 'analytics_session_evidence_v6', body);
    if (!Array.isArray(out.sessions)) throw Object.assign(new Error('Analytics session evidence is unavailable'), { status: 502 });
    return out;
  }

  function historyWindow() {
    const now = new Date();
    return { p_since: new Date(now.getTime() - HISTORY_DAYS * 86400000).toISOString(), p_until: now.toISOString() };
  }

  function eventIdentityBuckets(events) {
    const buckets = new Map();
    for (const event of events) {
      const key = event.uid ? 'u:' + event.uid : event.device_id ? 'd:' + event.device_id : null;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets].map(([key, events]) => ({ key, events })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
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
      measurement_version: out.measurement_version, identity_basis: out.identity_basis,
      total: Number(out.total) || 0, counts: out.counts || {}, unsessioned_events: out.unsessioned_events ?? null,
      sessions: (out.sessions || []).map(forensicSession) });
  }

  async function handleSessionDetail(request, env, user, sessionId, includeHistory = false, scope = null) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const q = new URLSearchParams({ session_id: 'eq.' + sessionId, site_id: 'is.null',
      select: EVENT_SELECT, order: 'at.asc,id.asc', limit: String(SESSION_EVENT_CAP + 1) });
    if (scope) {
      q.set('uid', scope.startsWith('u:') ? 'eq.' + scope.slice(2).toLowerCase() : 'is.null');
      q.set('device_id', scope.startsWith('d:') ? 'eq.' + scope.slice(2) : 'not.is.null');
    }
    const rows = await sbRows(env, 'events?' + q.toString());
    if (!rows.length) return json({ ok: false, error: 'Session evidence not found in this scope' }, 404);
    const truncated = rows.length > SESSION_EVENT_CAP, events = rows.slice(0, SESSION_EVENT_CAP);
    const first = new Date(events[0].at), last = new Date(events[events.length - 1].at);
    const summary = await sessionList(env, {
      p_since: first.toISOString(), p_until: new Date(last.getTime() + 1).toISOString(),
      p_limit: 1, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_sessions: [sessionId], p_visitor_key: scope
    });
    const session = forensicSession(summary.sessions[0]);
    if (!session) throw Object.assign(new Error('Recorded session events have no projected summary. Retry the analytics read.'), { status: 502 });
    const buckets = eventIdentityBuckets(events);
    const selectedKey = scope || (!truncated && buckets.length === 1 ? buckets[0].key : null);
    const uid = selectedKey?.startsWith('u:') ? selectedKey.slice(2).toLowerCase() : null;
    // A session can cross account and anonymous boundaries. Never turn its
    // first/latest login into the owner of every row, including capped reads.
    session.uid = uid; session.email = null; session.display_name = null; session.handle = null;
    session.identity_status = buckets.length > 1 ? 'mixed' : uid ? 'event_bound_account' : 'device_only';
    if (summary.identity_missing_events) session.identity_status = 'partial_identity';
    if (truncated && !scope) session.identity_status = 'partial_identity';
    const history = includeHistory && selectedKey ? await sessionList(env, {
      ...historyWindow(), p_limit: 60, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_visitor_key: selectedKey
    }) : null;
    return json({
      ok: true, measurement_version: summary.measurement_version, identity_basis: summary.identity_basis,
      scope: scope ? { visitor_key: scope, kind: 'event_bound_subset' } : null,
      session, events: events.map((e) => ({ ...e, device: publicDeviceSummary(e.device) })), truncated,
      visitor: {
        key: selectedKey, uid, devices: history?.devices || summary.devices || [], profile: await profileFor(env, uid),
        identity_status: session.identity_status, identity_buckets: buckets,
        identity_missing_events: Number(summary.identity_missing_events) || 0,
        history_status: !selectedKey ? 'choose_identity' : includeHistory ? 'ready' : 'not_loaded',
        history_days: HISTORY_DAYS, total: history ? Number(history.total) : null,
        sessions: history ? history.sessions.map(forensicSession) : null
      }
    });
  }

  async function handleVisitorList(request, env, user, url) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const { since, until } = forensicWindow(url);
    const out = await evidenceRpc(env, 'analytics_visitor_list_v6', {
        p_since: since.toISOString(), p_until: until.toISOString(),
        p_limit: intParam(url, 'limit', 40, 1, 100), p_offset: intParam(url, 'offset', 0, 0, 20000),
        p_filter: pick(url.searchParams.get('filter'), VISITOR_FILTERS, 'all'),
        p_sort: pick(url.searchParams.get('sort'), VISITOR_SORTS, 'recent'),
        p_q: searchParam(url)
    });
    if (!Array.isArray(out.visitors)) throw Object.assign(new Error('Analytics visitor evidence is invalid'), { status: 502 });
    return json({ ok: true, range: { since: since.toISOString(), until: until.toISOString() },
      measurement_version: out.measurement_version, identity_basis: out.identity_basis,
      total: Number(out.total), counts: out.counts || {},
      visitors: out.visitors.map((v) => ({ ...v, device: publicDeviceSummary(v.device) })) });
  }

  async function handleVisitorDetail(request, env, user, key) {
    await requireHouseOwner(env, user);
    if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
    const uid = key.startsWith('u:') ? key.slice(2).toLowerCase() : null;
    const history = await sessionList(env, {
      ...historyWindow(), p_limit: 100, p_offset: 0, p_filter: 'any', p_sort: 'recent', p_visitor_key: key
    });
    const profile = await profileFor(env, uid);
    if (!Number(history.total) && !profile) return json({ ok: false, error: 'Visitor evidence not found' }, 404);
    return json({ ok: true, measurement_version: history.measurement_version, identity_basis: history.identity_basis,
      visitor: { key, uid, devices: history.devices || [], profile,
        identity_status: uid ? 'event_bound_account' : 'device_only',
        identity_missing_events: Number(history.identity_missing_events) || 0,
        history_status: 'ready', history_days: HISTORY_DAYS, total: Number(history.total),
        sessions: history.sessions.map(forensicSession) } });
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
      let key = url.searchParams.get('visitor_key');
      if (key) key = /^u:/i.test(key) ? key.toLowerCase() : key.replace(/^d:/i, 'd:');
      if (key && !VISITOR_KEY_RE.test(key)) return json({ ok: false, error: 'Invalid visitor key' }, 400);
      return handleSessionDetail(request, env, user, id, url.searchParams.get('include_history') === '1', key);

    }
    if (!VISITOR_KEY_RE.test(id)) return json({ ok: false, error: 'Invalid visitor key' }, 400);
    return handleVisitorDetail(request, env, user, /^u:/i.test(id) ? id.toLowerCase() : id.replace(/^d:/i, 'd:'));
  }

  return { route, SESSION_ID_RE, VISITOR_KEY_RE };
}
