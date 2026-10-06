// Control Analytics > Forensics > Flows and Errors.
//
// Pure aggregation over rows the router reads, so it is testable without a
// database. Flows come from events_lean (narrow rows: one page view costs a
// few dozen bytes, not the ~1.4 KB of a full event); errors and friction come
// from events, because their message, source and target live in props. Both
// keep sample sessions so every number in Control opens onto the journeys
// behind it.

// Errors the site did not write: in-app browsers inject their own scripts into
// every page (Instagram, Facebook), extensions run from their own schemes, and
// a cross-origin failure arrives as a bare "Script error.". Older events have
// no origin of their own, so the same rules the collector now applies are
// applied here to classify them.
const INJECTED_MSG = /webkit\.messageHandlers|Java object is gone|_AutofillCallbackHandler|__gCrWeb|instantSearchSDKJSBridge|zaloJSV2|ucbrowser|vivoNewsDetailPage/i;
const INJECTED_SRC = /^(iabjs|chrome-extension|moz-extension|safari-extension|safari-web-extension|webkit-masked-url|resource):/i;

export function errorOrigin(props, siteHost = 'matthew.mccluster.org') {
  const p = props && typeof props === 'object' ? props : {};
  if (['site', 'injected', 'third_party', 'opaque'].includes(p.origin)) return p.origin;
  const msg = String(p.msg || p.message || '');
  const src = String(p.src || p.file || '');
  if (/^script error\.?$/i.test(msg.trim()) && !src) return 'opaque';
  if (INJECTED_SRC.test(src) || INJECTED_MSG.test(msg)) return 'injected';
  if (src) {
    try {
      const u = new URL(src);
      if (u.hostname && u.hostname !== siteHost && !/(^|\.)mccluster\.org$/i.test(u.hostname)) return 'third_party';
    } catch { /* relative or odd: treat as the site's own */ }
  }
  return 'site';
}

export function inAppBrowser(ua) {
  ua = String(ua || '');
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'tiktok';
  if (/Snapchat/i.test(ua)) return 'snapchat';
  if (/LinkedInApp/i.test(ua)) return 'linkedin';
  return null;
}

function platform(ua) {
  ua = String(ua || '');
  const app = inAppBrowser(ua);
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows NT/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux|CrOS/.test(ua) ? 'Linux' : 'Other';
  return app ? `${os} · ${app}` : os;
}

export function pageName(path) {
  const p = String(path || '').replace(/^\/+/, '').replace(/\?.*$/, '');
  return !p || p === 'index.html' ? 'index.html' : p;
}

// What makes two errors "the same": the message without volatile numbers,
// URLs and quoted values, plus the file it came from.
export function errorFingerprint(name, props) {
  const p = props && typeof props === 'object' ? props : {};
  const msg = String(p.msg || p.message || '(no message)')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(["'`]).{1,60}?\1/g, '"…"')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  let file = String(p.src || p.file || '');
  try { file = file ? new URL(file).pathname.split('/').pop() || file : ''; } catch { file = file.split('/').pop().split('?')[0]; }
  return `${name}|${msg}|${file}`;
}

function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }
function topOf(map, limit, label = 'key') {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit).map(([k, v]) => ({ [label]: k, count: v }));
}
function addSample(set, id, cap = 5) { if (id && set.size < cap) set.add(id); }

// ---------------------------------------------------------------- flows
// rows: events_lean rows { session_id, device_id, at, name, path, visible_s,
// depth } for page_view / page_leave plus the outcome and friction names.
export function summarizeFlows(rows, { limit = 12 } = {}) {
  const sessions = new Map();
  for (const r of rows || []) {
    if (!r || !r.session_id) continue;
    let s = sessions.get(r.session_id);
    if (!s) { s = { id: r.session_id, device: r.device_id || null, pages: [], plays: 0, signup: false, friction: 0, start: r.at, leaves: [] }; sessions.set(r.session_id, s); }
    if (r.at < s.start) s.start = r.at;
    if (r.name === 'page_view') s.pages.push({ at: r.at, path: pageName(r.path) });
    else if (r.name === 'page_leave') s.leaves.push({ path: pageName(r.path), visible: Number(r.visible_s), depth: Number(r.depth) });
    else if (r.name === 'album_play' || r.name === 'music_play' || r.name === 'song_start') s.plays++;
    else if (r.name === 'account_created') s.signup = true;
    else if (r.name === 'dead_click' || r.name === 'rage_click' || r.name === 'js_error' || r.name === 'js_rejection') s.friction++;
  }

  const pages = new Map();   // per page: views, sessions, entries, exits, next, time, depth, friction
  const page = (p) => {
    let x = pages.get(p);
    if (!x) { x = { path: p, views: 0, sessions: new Set(), entries: 0, exits: 0, bounces: 0, next: new Map(), visible: [], depth: [], friction: 0, played: new Set(), signed: new Set() }; pages.set(p, x); }
    return x;
  };
  const transitions = new Map();
  const pathsTop = new Map();
  const depthBuckets = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  const samples = new Map();  // `${from}>${to}` -> sessions
  let counted = 0, bounced = 0;

  for (const s of sessions.values()) {
    s.pages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const seq = [];
    for (const v of s.pages) if (seq[seq.length - 1] !== v.path) seq.push(v.path);
    for (const v of s.pages) page(v.path).views++;
    for (const l of s.leaves) {
      const x = page(l.path);
      if (Number.isFinite(l.visible) && l.visible >= 0 && l.visible < 6 * 3600) x.visible.push(l.visible);
      if (Number.isFinite(l.depth) && l.depth >= 0) x.depth.push(Math.min(100, l.depth));
    }
    if (!seq.length) continue;
    counted++;
    seq.forEach((p) => {
      const x = page(p);
      x.sessions.add(s.id);
      if (s.plays) x.played.add(s.id);
      if (s.signup) x.signed.add(s.id);
    });
    page(seq[0]).entries++;
    page(seq[seq.length - 1]).exits++;
    if (seq.length === 1) { bounced++; page(seq[0]).bounces++; }
    for (let i = 0; i < seq.length - 1; i++) {
      const key = `${seq[i]}\u0000${seq[i + 1]}`;
      bump(transitions, key);
      bump(page(seq[i]).next, seq[i + 1]);
      if (!samples.has(key)) samples.set(key, new Set());
      addSample(samples.get(key), s.id, 3);
    }
    bump(page(seq[seq.length - 1]).next, '(left)');
    const bucket = seq.length >= 5 ? '5+' : String(seq.length);
    depthBuckets[bucket]++;
    bump(pathsTop, seq.slice(0, 5).join(' → ') + (seq.length > 5 ? ' → …' : ''));
  }

  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  };
  const pageRows = [...pages.values()].map((x) => {
    const sessionsN = x.sessions.size;
    const nextTotal = [...x.next.values()].reduce((a, b) => a + b, 0) || 1;
    return {
      path: x.path, views: x.views, sessions: sessionsN, entries: x.entries, exits: x.exits, bounces: x.bounces,
      exit_rate: sessionsN ? Math.round((x.exits / sessionsN) * 100) : 0,
      bounce_rate: x.entries ? Math.round((x.bounces / x.entries) * 100) : 0,
      median_visible_s: median(x.visible), avg_depth: avg(x.depth),
      played_pct: sessionsN ? Math.round((x.played.size / sessionsN) * 100) : 0,
      signup_pct: sessionsN ? Math.round((x.signed.size / sessionsN) * 100) : 0,
      next: topOf(x.next, 5, 'path').map((r) => ({ ...r, pct: Math.round((r.count / nextTotal) * 100) }))
    };
  }).filter((x) => x.sessions > 0).sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path));

  return {
    sessions: counted,
    bounced,
    bounce_rate: counted ? Math.round((bounced / counted) * 100) : 0,
    pages_per_session: depthBuckets,
    entries: pageRows.filter((p) => p.entries).sort((a, b) => b.entries - a.entries).slice(0, limit)
      .map((p) => ({ path: p.path, sessions: p.entries, bounce_rate: p.bounce_rate, played_pct: p.played_pct, signup_pct: p.signup_pct })),
    exits: pageRows.filter((p) => p.exits).sort((a, b) => b.exits - a.exits).slice(0, limit)
      .map((p) => ({ path: p.path, sessions: p.exits, exit_rate: p.exit_rate })),
    transitions: [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2).map(([k, v]) => {
      const [from, to] = k.split('\u0000');
      return { from, to, sessions: v, sample_sessions: [...(samples.get(k) || [])] };
    }),
    paths: topOf(pathsTop, limit, 'path').map((r) => ({ path: r.path, sessions: r.count })),
    pages: pageRows.slice(0, limit * 3)
  };
}

// ---------------------------------------------------------------- errors
const ERROR_NAMES = new Set(['js_error', 'js_rejection']);
const FRICTION_NAMES = new Set(['dead_click', 'rage_click']);
const JOURNEY_NAMES = new Set(['play_failed', 'signup_blocked', 'gated_preview_end', 'checkout_retired_link']);

// rows: events rows { at, name, path, props, session_id, device_id, user_agent }
export function summarizeErrors(rows, { limit = 40 } = {}) {
  const errors = new Map(), friction = new Map(), journey = new Map();
  const totals = { errors: 0, site_errors: 0, injected_errors: 0, friction: 0, journey: 0, sessions: new Set() };

  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const p = r.props && typeof r.props === 'object' ? r.props : {};
    let bucket, key, base;
    if (ERROR_NAMES.has(r.name)) {
      const origin = errorOrigin(p);
      key = errorFingerprint(r.name, p);
      bucket = errors;
      base = () => ({ kind: r.name, origin, message: String(p.msg || p.message || '(no message)').slice(0, 200),
        // The page URL an error came from carries campaign and click ids
        // (fbclid, utm_*); the script path is all that locates the error.
        source: String(p.src || p.file || '').replace(/[?#].*$/, '').slice(0, 160) || null, line: p.line ?? null, name: p.name || null,
        stack: p.stack || null });
      totals.errors++;
      if (origin === 'site') totals.site_errors++;
      if (origin === 'injected') totals.injected_errors++;
    } else if (FRICTION_NAMES.has(r.name)) {
      const target = String(p.el || p.target || '?').slice(0, 120);
      key = `${r.name}|${pageName(r.path)}|${target}`;
      bucket = friction;
      base = () => ({ kind: r.name, target, text: p.text ? String(p.text).slice(0, 80) : null });
      totals.friction++;
    } else if (JOURNEY_NAMES.has(r.name)) {
      const detail = r.name === 'play_failed' ? `${p.error || 'Error'} · ${p.track || '?'}`
        : r.name === 'signup_blocked' ? String(p.reason || '?')
          : r.name === 'gated_preview_end' ? `${p.track || '?'} · ${p.gate || '?'}`
            : String(p.to || 'retired link');
      key = `${r.name}|${detail}`;
      bucket = journey;
      base = () => ({ kind: r.name, detail });
      totals.journey++;
    } else continue;

    let g = bucket.get(key);
    if (!g) {
      g = { ...base(), count: 0, sessions: new Set(), devices: new Set(), pages: new Map(), browsers: new Map(),
        first_at: r.at, last_at: r.at, samples: new Set() };
      bucket.set(key, g);
    }
    g.count++;
    if (r.session_id) { g.sessions.add(r.session_id); totals.sessions.add(r.session_id); addSample(g.samples, r.session_id, 5); }
    if (r.device_id) g.devices.add(r.device_id);
    bump(g.pages, pageName(r.path));
    bump(g.browsers, platform(r.user_agent));
    if (r.at < g.first_at) g.first_at = r.at;
    if (r.at > g.last_at) g.last_at = r.at;
  }

  const shape = (g) => {
    const { sessions, devices, pages, browsers, samples, ...rest } = g;
    return { ...rest, sessions: sessions.size, devices: devices.size, pages: topOf(pages, 5, 'path'),
      browsers: topOf(browsers, 5, 'browser'), sample_sessions: [...samples] };
  };
  const ORIGIN_RANK = { site: 0, third_party: 1, opaque: 2, injected: 3 };
  return {
    totals: { errors: totals.errors, site_errors: totals.site_errors, injected_errors: totals.injected_errors,
      friction: totals.friction, journey: totals.journey, sessions_affected: totals.sessions.size },
    errors: [...errors.values()].map(shape)
      .sort((a, b) => (ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin]) || b.sessions - a.sessions || b.count - a.count)
      .slice(0, limit),
    friction: [...friction.values()].map(shape).sort((a, b) => b.sessions - a.sessions || b.count - a.count).slice(0, limit),
    journey: [...journey.values()].map(shape).sort((a, b) => b.sessions - a.sessions || b.count - a.count).slice(0, limit)
  };
}

export const FLOW_EVENT_NAMES = ['page_view', 'page_leave', 'album_play', 'music_play', 'song_start', 'account_created',
  'dead_click', 'rage_click', 'js_error', 'js_rejection'];
export const ERROR_EVENT_NAMES = [...ERROR_NAMES, ...FRICTION_NAMES, ...JOURNEY_NAMES];
