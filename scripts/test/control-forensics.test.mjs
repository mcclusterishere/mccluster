/* Control Analytics > Forensics UI. What matters: a session reads as a
   journey (events grouped per page visit, written as sentences, background
   noise hidden until asked for), the list asks the Worker for one page of
   sessions at a time instead of dumping raw rows, recorded text is escaped,
   and the stylesheet keeps the repo's mobile-first rules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (p) => readFile(p, 'utf8');

async function load() {
  const context = { window: { CR: {} }, document: { activeElement: null }, console, URL, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(await read('js/control-room/forensics.js'), context);
  return context.window.CR.forensics;
}
const host = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const EVENTS = [
  { at: '2026-10-05T12:00:00Z', name: 'acquired', path: 'album.html', props: { src: 'instagram', med: 'trial_reel', cmp: 'launch' } },
  { at: '2026-10-05T12:00:01Z', name: 'page_view', path: 'album.html', props: { title: 'I AM HERE' } },
  { at: '2026-10-05T12:00:03Z', name: 'device_power', path: 'album.html', props: { level: 0.5 } },
  { at: '2026-10-05T12:00:20Z', name: 'album_play', path: 'album.html', props: { track: 'Docket 516R', album: 'I AM HERE' } },
  { at: '2026-10-05T12:00:40Z', name: 'scroll_depth', path: 'album.html', props: { pct: 50 } },
  { at: '2026-10-05T12:00:50Z', name: 'scroll_depth', path: 'album.html', props: { pct: 80 } },
  { at: '2026-10-05T12:01:00Z', name: 'page_leave', path: 'album.html', props: { visible_s: 55, depth: 75 } },
  { at: '2026-10-05T12:02:00Z', name: 'page_view', path: 'account.html', props: { title: '<img src=x onerror=alert(1)>' } },
  { at: '2026-10-05T12:02:05Z', name: 'rage_click', path: 'account.html', props: { text: 'Save' } },
  { at: '2026-10-05T12:02:30Z', name: 'account_created', path: 'account.html', props: { track: 'Docket 516R', source: 'instagram' } },
  { at: '2026-10-05T12:02:31Z', name: 'mystery_thing', path: 'account.html', props: {} }
];

test('events read as sentences in the right category', async () => {
  const F = await load();
  const by = (i) => F.describe(EVENTS[i]);
  assert.equal(by(1).cat, 'nav');
  assert.equal(by(1).text, 'Opened “I AM HERE”');
  assert.equal(by(0).cat, 'arrive');
  assert.match(by(0).text, /^Arrived from instagram/);
  assert.match(by(0).detail, /trial_reel · launch/);
  assert.equal(by(2).cat, 'system');
  assert.equal(by(2).text, 'Battery 50%');
  assert.equal(by(3).cat, 'music');
  assert.equal(by(3).text, 'Played “Docket 516R”');
  assert.equal(by(8).cat, 'friction');
  assert.equal(by(8).text, 'Rage-tapped “Save”');
  assert.equal(by(9).cat, 'convert');
  assert.equal(by(9).text, 'Created an account after hearing “Docket 516R”');
  assert.equal(by(10).cat, 'action', 'an unknown event still renders, as a generic action');
  assert.equal(by(10).text, 'Mystery thing');
  assert.doesNotThrow(() => F.describe({ name: 'page_view', props: null }));
});

test('a session groups into page visits with time on screen and how far they read', async () => {
  const F = await load();
  const groups = F.pageVisits(EVENTS);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].path, 'album.html');
  assert.equal(groups[0].title, 'I AM HERE');
  assert.equal(groups[0].visible, 55, 'page_leave reports visible seconds');
  assert.equal(groups[0].depth, 75, 'page_leave depth is the final word on how far they read');
  assert.equal(groups[0].events.length, 7);
  assert.equal(groups[1].path, 'account.html');
  assert.equal(groups[1].events.length, 4);
  const wandered = F.pageVisits([
    { at: '2026-10-05T12:00:00Z', name: 'click', path: 'a.html', props: {} },
    { at: '2026-10-05T12:00:05Z', name: 'click', path: 'b.html', props: {} },
    { at: '2026-10-05T12:00:06Z', name: 'scroll_depth', path: 'b.html', props: { pct: 40 } }
  ]);
  assert.equal(wandered.length, 2, 'a new path starts a new visit even without a page_view');
  assert.equal(wandered[1].depth, 40);
  assert.equal(F.pageVisits(null).length, 0);
});

test('user agents name the app they ran inside before the browser engine', async () => {
  const F = await load();
  const ig = F.uaInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92');
  assert.equal(ig.os, 'iPhone');
  assert.equal(ig.app, 'Instagram app');
  assert.equal(ig.label, 'iPhone · Instagram app');
  const android = F.uaInfo('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36');
  assert.equal(android.label, 'Android · Chrome');
  assert.equal(F.uaInfo('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)').bot, true);
  assert.equal(F.uaInfo(null).label, '');
});

test('the list asks for one page of sessions and renders cards, not raw rows', async () => {
  const F = await load();
  const asked = [];
  const sessions = [{
    session_id: 'sess-jane0001', device_id: 'dev-jane-phone', started_at: '2026-10-05T12:00:00Z', ended_at: '2026-10-05T12:06:52Z',
    duration_s: 412, events: 31, pages: ['album.html', 'album.html', 'listen.html', 'account.html'], display_name: 'Jane Doe', email: 'jane@example.com',
    city: 'Hartford', region: 'Connecticut', country: 'US', plays: 3, friction: 2, rage_clicks: 2, signed_up: true, source: 'instagram', visit_number: 3
  }];
  const h = host();
  F.mount(h, {
    request: (path) => { asked.push(path); return Promise.resolve({ total: 120, counts: { all: 120, visitors: 80, identified: 9 }, unsessioned_events: 5, sessions }); },
    range: { since: '2026-09-28T00:00:00.000Z', until: '2026-10-05T23:59:59.999Z', label: 'Last 7 days' }
  });
  assert.match(h.innerHTML, /aria-busy="true"/, 'paints a skeleton while the first page loads');
  await tick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0], '/v1/analytics/sessions?since=2026-09-28T00%3A00%3A00.000Z&until=2026-10-05T23%3A59%3A59.999Z&limit=40&offset=0&filter=all&sort=recent');
  assert.match(h.innerHTML, /data-crf-session="sess-jane0001"/);
  assert.match(h.innerHTML, /Jane Doe/);
  assert.match(h.innerHTML, /<i>album<\/i><b aria-hidden="true">→<\/b><i>listen<\/i>/, 'the page strip collapses repeats');
  assert.match(h.innerHTML, /120 sessions from 80 devices in last 7 days\./);
  assert.match(h.innerHTML, /5 more events came from visitors who declined identifiers/);
  assert.match(h.innerHTML, /Showing 1 of 120/);
  assert.match(h.innerHTML, /data-crf-more>Show 40 more/);
  assert.doesNotMatch(h.innerHTML, /<table/, 'no row dump');
  F.mount(h, { request: (path) => { asked.push(path); return Promise.resolve({}); }, range: { since: '2026-09-28T00:00:00.000Z', until: '2026-10-05T23:59:59.999Z' } });
  assert.equal(asked.length, 1, 'repainting the tab with the same range does not refetch');
});

test('an opened session is a journey: KPIs, cards, page visits, background noise hidden, text escaped', async () => {
  const F = await load();
  F.state.stack = [{ type: 'session', id: 'sess-jane0001' }];
  F.state.detail = {
    session: {
      session_id: 'sess-jane0001', device_id: 'dev-jane-phone', started_at: EVENTS[0].at, ended_at: EVENTS[10].at, duration_s: 151, engaged_s: 120,
      page_views: 2, clicks: 1, plays: 1, friction: 1, rage_clicks: 1, signed_up: true, tracks: ['Docket 516R'], entry_path: 'album.html', exit_path: 'account.html',
      city: 'Hartford', country: 'US', ip: '203.0.113.9', latitude: 41.76, longitude: -72.68, user_agent: 'Mozilla/5.0 (iPhone) Instagram 330', device: { platform: 'iPhone', mobile: true, screen: '390×844' }
    },
    events: EVENTS,
    visitor: { key: 'd:dev-jane-phone', devices: ['dev-jane-phone'], total: 1, sessions: [{ session_id: 'sess-jane0001', started_at: EVENTS[0].at, entry_path: 'album.html', pages: ['album.html'] }] }
  };
  const html = F.render();
  assert.match(html, /class="crf crf--open"/);
  assert.equal((html.match(/class="crf-kpi"/g) || []).length, 7);
  for (const title of ['Who', 'Arrived', 'Where', 'Device', 'Journey', 'Music heard']) assert.match(html, new RegExp('<h3>' + title));
  assert.match(html, /2 page visits, 11 events/);
  assert.match(html, /data-crf-jump="0"><b>album<\/b>/);
  assert.match(html, /id="crf-visit-1"/);
  assert.match(html, /1m later/, 'the gap between page visits is shown');
  assert.match(html, /Played “Docket 516R”/);
  assert.match(html, /Created an account after hearing “Docket 516R”/);
  assert.match(html, /trial_reel/, 'arrival medium comes from the acquired event');
  assert.match(html, /openstreetmap\.org\/\?mlat=41\.76&mlon=-72\.68/);
  assert.match(html, /Their journey begins/);
  assert.doesNotMatch(html, /Battery 50%/, 'device and background events are hidden by default');
  assert.match(html, /Show 1 device &amp; background events/);
  assert.doesNotMatch(html, /<img src=x/, 'recorded text is escaped');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /class="crf-raw"/, 'raw JSON stays closed until a step is tapped');
  F.state.showSystem = true;
  F.state.raw = { 3: true };
  const open = F.render();
  assert.match(open, /Battery 50%/);
  assert.match(open, /Hide device &amp; background events/);
  assert.match(open, /<pre class="crf-raw">[^<]*&quot;name&quot;: &quot;album_play&quot;/);
});

test('a visitor profile shows every session and their activity over time', async () => {
  const F = await load();
  const now = new Date();
  const s = (i, extra = {}) => ({ session_id: 'sess-v' + i, device_id: 'dev-a', started_at: new Date(now - i * 864e5).toISOString(), ended_at: new Date(now - i * 864e5 + 6e4).toISOString(), engaged_s: 60, plays: 1, pages: ['home'], entry_path: 'home', ...extra });
  F.state.stack = [{ type: 'visitor', key: 'u:723e4567-e89b-42d3-a456-426614174777' }];
  F.state.detail = { visitor: { key: 'u:723e4567-e89b-42d3-a456-426614174777', uid: '723e4567-e89b-42d3-a456-426614174777', devices: ['dev-a', 'dev-b'], total: 3, history_days: 180,
    profile: { display_name: 'Jane Doe', email: 'jane@example.com', created_at: '2026-09-01T00:00:00Z' }, sessions: [s(0, { signed_up: true }), s(1), s(9)] } };
  const html = F.render();
  assert.match(html, /<h2>Jane Doe<\/h2>/);
  assert.match(html, /2 devices/);
  assert.match(html, /Signed up/);
  assert.equal((html.match(/class="crf-kpi"/g) || []).length, 7);
  assert.match(html, /<h3>Activity/);
  assert.match(html, /class="crf-heat"/);
  assert.equal((html.match(/data-crf-session="sess-v/g) || []).length, 3);
  assert.match(html, /<h3>Every session/);
});

test('the forensics stylesheet keeps the mobile-first rules', async () => {
  const css = await read('css/control-forensics.css');
  const queries = css.match(/@media[^{]+/g) || [];
  assert.ok(queries.length >= 2);
  for (const q of queries) assert.match(q, /^@media \(min-width:\d+rem\)\s*$/, 'breakpoints only add: ' + q);
  assert.doesNotMatch(css.replace(/minmax\(0,1fr\)/g, ''), /\b1fr\b/, 'never a bare 1fr');
  assert.match(css, /\.crf-search input,\.crf-sort select\{[^}]*font-size:max\(16px,/);
  assert.match(css, /\.crf--open \.crf-list\{display:none\}/, 'on a phone an open session takes the screen');
});
