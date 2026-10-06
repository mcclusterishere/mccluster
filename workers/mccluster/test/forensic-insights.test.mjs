/* Control Analytics > Forensics > Flows and Errors. The aggregation is pure
   and tested on rows shaped like production; the routes are tested for the
   things that matter on owner-only telemetry: the owner gate comes before
   any read, the window is clamped, and only the narrow columns and the
   error/friction event names are ever asked for. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAnalyticsRequest } from '../src/analytics/router.js';
import { summarizeFlows, summarizeErrors, errorOrigin, errorFingerprint } from '../src/analytics/forensic-insights.js';

const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const STRANGER = { id: '523e4567-e89b-42d3-a456-426614174444', email: 'someone@example.com' };
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G71 Instagram 395.0.0.27.151';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}
function backend({ role = 'owner', lean = [], events = [] } = {}) {
  const calls = [];
  const handler = async (url) => {
    const u = new URL(String(url));
    const path = u.pathname.replace('/rest/v1/', '');
    calls.push({ path, query: u.searchParams });
    if (path === 'orgs') return reply([{ id: ORG, slug: 'mccluster' }]);
    if (path === 'org_members') return reply(role ? [{ org_id: ORG, profile_id: u.searchParams.get('profile_id').slice(3), role }] : []);
    if (path === 'events_lean') return reply(lean);
    if (path === 'events') return reply(events);
    return reply({ message: `unexpected ${path}` }, 500);
  };
  return { calls, handler };
}
const get = (path, user = OWNER) => handleAnalyticsRequest(new Request(`https://api.mccluster.org${path}`), env, user);

const t = (s) => `2026-10-05T12:00:${String(s).padStart(2, '0')}Z`;
const pv = (session, s, path, device = 'd-' + session) => ({ session_id: session, device_id: device, at: t(s), name: 'page_view', path });

test('flows: entries, exits, bounces, transitions, next steps and outcomes per page', () => {
  const rows = [
    pv('a', 1, 'album.html'), pv('a', 5, 'account.html'), pv('a', 9, 'album.html'),
    { session_id: 'a', at: t(6), name: 'account_created', path: 'account.html' },
    { session_id: 'a', at: t(4), name: 'page_leave', path: 'album.html', visible_s: 30, depth: 40 },
    pv('b', 1, 'album.html'), { session_id: 'b', at: t(2), name: 'album_play', path: 'album.html' },
    { session_id: 'b', at: t(3), name: 'page_leave', path: 'album.html', visible_s: 90, depth: 80 },
    pv('c', 1, 'index.html'), pv('c', 2, 'listen.html'), pv('c', 3, 'listen.html'),
    { session_id: 'c', at: t(4), name: 'dead_click', path: 'listen.html' },
    { session_id: null, at: t(1), name: 'page_view', path: 'album.html' }
  ];
  const f = summarizeFlows(rows);
  assert.equal(f.sessions, 3);
  assert.equal(f.bounced, 1, 'b saw one page');
  assert.equal(f.bounce_rate, 33);
  assert.deepEqual(f.pages_per_session, { 1: 1, 2: 1, 3: 1, 4: 0, '5+': 0 });
  assert.deepEqual(f.entries[0], { path: 'album.html', sessions: 2, bounce_rate: 50, played_pct: 50, signup_pct: 50 });
  assert.equal(f.transitions.find((x) => x.from === 'album.html' && x.to === 'account.html').sessions, 1);
  assert.equal(f.transitions.find((x) => x.from === 'index.html').to, 'listen.html', 'a reload of the same page is not a step');
  const album = f.pages.find((p) => p.path === 'album.html');
  assert.equal(album.views, 3);
  assert.equal(album.median_visible_s, 60);
  assert.equal(album.avg_depth, 60);
  assert.equal(album.exits, 2);
  assert.ok(album.next.some((n) => n.path === '(left)'), 'leaving is a next step too');
  assert.ok(f.paths.some((p) => p.path === 'album.html → account.html → album.html'));
});

test('errors: classified by origin, grouped by fingerprint, site errors first', () => {
  const rows = [
    { at: t(1), name: 'js_error', path: 'album.html', session_id: 's1', device_id: 'd1', user_agent: IG,
      props: { msg: "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')", src: 'https://matthew.mccluster.org/album.html?x=1', line: 1, col: 704 } },
    { at: t(2), name: 'js_error', path: 'album.html', session_id: 's2', device_id: 'd2', user_agent: IG,
      props: { msg: "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')", src: 'https://matthew.mccluster.org/album.html?y=2', line: 1, col: 681 } },
    { at: t(3), name: 'js_error', path: 'album.html', session_id: 's3', device_id: 'd3', user_agent: SAFARI, props: { msg: 'Script error.', src: '' } },
    { at: t(4), name: 'js_rejection', path: 'album.html', session_id: 's3', device_id: 'd3', user_agent: SAFARI, props: { msg: 'Unable to decode audio data' } },
    { at: t(5), name: 'dead_click', path: 'album.html', session_id: 's4', device_id: 'd4', user_agent: IG, props: { el: 'button#playAll.alb__play', text: 'Play' } },
    { at: t(6), name: 'dead_click', path: 'album.html', session_id: 's4', device_id: 'd4', user_agent: IG, props: { el: 'button#playAll.alb__play', text: 'Play' } },
    { at: t(7), name: 'signup_blocked', path: 'account.html', session_id: 's5', device_id: 'd5', user_agent: SAFARI, props: { reason: 'missing_first' } },
    { at: t(8), name: 'click', path: 'album.html', session_id: 's6', props: {} }
  ];
  const out = summarizeErrors(rows);
  assert.equal(out.totals.errors, 4);
  assert.equal(out.totals.injected_errors, 2);
  assert.equal(out.totals.site_errors, 1);
  assert.equal(out.errors[0].origin, 'site', 'the site’s own error leads');
  assert.equal(out.errors[0].message, 'Unable to decode audio data');
  const injected = out.errors.find((e) => e.origin === 'injected');
  assert.equal(injected.count, 2, 'same message from two page URLs is one error');
  assert.equal(injected.sessions, 2);
  assert.equal(injected.browsers[0].browser, 'iOS · instagram');
  assert.equal(injected.source, 'https://matthew.mccluster.org/album.html', 'click ids and query strings never reach the owner view');
  assert.equal(out.errors.find((e) => e.message === 'Script error.').origin, 'opaque');
  assert.deepEqual(out.friction[0], {
    kind: 'dead_click', target: 'button#playAll.alb__play', text: 'Play', count: 2, first_at: t(5), last_at: t(6),
    sessions: 1, devices: 1, pages: [{ path: 'album.html', count: 2 }], browsers: [{ browser: 'iOS · instagram', count: 2 }], sample_sessions: ['s4']
  });
  assert.equal(out.journey[0].detail, 'missing_first');
});

test('origin and fingerprint rules match the collector', () => {
  assert.equal(errorOrigin({ msg: 'x', src: 'iabjs://navigation_performance_logger_android' }), 'injected');
  assert.equal(errorOrigin({ msg: "Can't find variable: _AutofillCallbackHandler" }), 'injected');
  assert.equal(errorOrigin({ msg: 'boom', src: 'https://cdn.example.net/x.js' }), 'third_party');
  assert.equal(errorOrigin({ msg: 'boom', src: 'https://matthew.mccluster.org/js/x.js' }), 'site');
  assert.equal(errorOrigin({ msg: 'boom', origin: 'injected' }), 'injected', 'a recorded origin wins');
  assert.equal(errorFingerprint('js_error', { msg: 'Failed at 12 for "abc"', src: 'https://x/js/a.js?v=1' }),
    errorFingerprint('js_error', { msg: 'Failed at 99 for "zzz"', src: 'https://x/js/a.js?v=2' }));
});

test('flows and errors are owner-only and read nothing before the gate', async () => {
  for (const path of ['/v1/analytics/flows', '/v1/analytics/errors']) {
    const { handler, calls } = backend({ role: 'member' });
    await withFetch(handler, async () => {
      await assert.rejects(() => get(path, STRANGER), (err) => err.status === 403);
    });
    assert.ok(!calls.some((c) => c.path === 'events' || c.path === 'events_lean'), `${path} read telemetry before the owner check`);
  }
});

test('flows read narrow columns from events_lean, clamped to 31 days', async () => {
  const { handler, calls } = backend({ lean: [pv('a', 1, 'album.html')] });
  const res = await withFetch(handler, () => get('/v1/analytics/flows?since=2026-01-01T00:00:00Z&until=2026-10-06T00:00:00Z'));
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.range.clamped, true);
  assert.equal(out.range.since, '2026-09-05T00:00:00.000Z');
  const q = calls.find((c) => c.path === 'events_lean').query;
  assert.equal(q.get('select'), 'session_id,device_id,at,name,path,visible_s,depth');
  assert.match(q.get('name'), /^in\.\(page_view,page_leave,/);
  assert.equal(q.get('is_bot'), 'is.false');
  assert.equal(out.flows.sessions, 1);
});

test('errors read only error and friction event names', async () => {
  const { handler, calls } = backend({ events: [] });
  const res = await withFetch(handler, () => get('/v1/analytics/errors'));
  const out = await res.json();
  assert.equal(out.ok, true);
  const q = calls.find((c) => c.path === 'events').query;
  assert.equal(q.get('name'), 'in.(js_error,js_rejection,dead_click,rage_click,play_failed,signup_blocked,gated_preview_end,checkout_retired_link)');
  assert.equal(q.get('select'), 'at,name,path,props,session_id,device_id,user_agent');
  assert.deepEqual(out.totals, { errors: 0, site_errors: 0, injected_errors: 0, friction: 0, journey: 0, sessions_affected: 0 });
});
