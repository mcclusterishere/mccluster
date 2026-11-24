/* WHAT THE MUSIC PLAYERS MEASURE (music slice M3 follow-up; review RL-9).

   The names this house measures are its reviewed measurement dictionary
   (workers/mccluster/src/analytics/measurement-dictionary.js, analytics-dictionary/2026-10-21.1, kept equal to the
   reviewed taxonomy migration by workers/mccluster/test/analytics-event-inventory-dictionary.test.mjs; the rule is
   docs/control-plane/ANALYTICS-EVENT-INVENTORY-20261021.md: a name nobody reviewed stays unclassified and is never
   silently mapped). Music slice M3 added music_interrupted (a read that failed or was cut off on the way: reason,
   second, try, path), sent by the listen engine and the album once per failed read, up to six per drop, and it made
   music_error go out once per failed read too. Neither is in the dictionary.

   Until Matthew approves it, music_interrupted waits in one place, js/analytics.js: the players still name it, and
   nothing called music_interrupted leaves the browser. music_error (the engine sent it before M3) goes out once per
   failed song or drop episode, with its code (scripts/test/music-playback-races.test.mjs counts it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `could not find ${from} ... ${to}`);
  return src.slice(a, b);
}

/* the real first-party sender out of js/analytics.js (its privacy gate, its outbox and the MCC_TRACK it returns),
   with the browser stood in: consent given, a quiet clock, every request recorded */
function sender() {
  const src = read('js/analytics.js');
  const code = slice(src, 'var MCC_PRIVACY_REQUIRED_VERSION', '/* EVENT_OUTBOX_FACTORY_END */') +
    slice(src, 'window.MCC_TRACK = (function () {', '\n/* ============================================================\n   MCC_MODEL');
  const area = () => {
    const m = new Map();
    return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  const localStorage = area(), sessionStorage = area();
  localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: '2026-11-23T00:00:00Z' }));
  localStorage.setItem('mcc_acq', JSON.stringify({ src: 'direct', med: 'none', cmp: '', plug: '', at: '2026-11-23' }));
  const docListeners = {}, sent = [];
  const document = { referrer: '', cookie: '', visibilityState: 'visible', currentScript: null,
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); } };
  const context = {
    document, localStorage, sessionStorage, URL, URLSearchParams, Intl, Uint8Array,
    navigator: { onLine: true, language: 'en-US', platform: 'test', userAgent: 'test', vendor: '', maxTouchPoints: 0 },
    screen: { width: 390, height: 844, availWidth: 390, availHeight: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }), addEventListener() {},
    location: { pathname: '/listen.html', search: '', hostname: 'matthew.mccluster.org', origin: 'https://matthew.mccluster.org', href: 'https://matthew.mccluster.org/listen.html' },
    crypto: { randomUUID }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, console,
    fetch: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, clone: () => ({ json: async () => ({ ok: true }) }) };
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'js/analytics.js (the first-party sender)' });
  return {
    track: (name, params) => context.MCC_TRACK(name, params),
    /* the page is hidden: the queue goes at once (js/analytics.js flushes on visibilitychange) */
    async flush() {
      document.visibilityState = 'hidden';
      (docListeners.visibilitychange || []).forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    },
    names: () => sent.flatMap((s) => s.body.events.map((e) => e.name)),
    sent
  };
}

test('music_interrupted waits for approval: a player names it and nothing sends it; the reviewed and existing names still go', async () => {
  const s = sender();
  s.track('music_interrupted', { reason: 'error', at_s: 42, attempt: 1, path: 'public', track: 'Who Did The Shoot' });
  s.track('music_error', { code: 2, track: 'Who Did The Shoot' });
  s.track('music_play', { source: 'discovery', track: 'Who Did The Shoot' });
  await s.flush();
  assert.ok(s.sent.length >= 1, 'the queue went out');
  const names = s.names();
  assert.ok(!names.includes('music_interrupted'), 'music_interrupted is not sent until Matthew approves it: ' + names.join(', '));
  /* the artist view's name (2026-11-24) waits the same way */
  const s2 = sender();
  s2.track('music_artist_view', { artist: 'los-fidel', tracks: 1 });
  s2.track('music_play', { source: 'discovery', track: 'Please Set Me Free' });
  await s2.flush();
  assert.deepEqual(s2.names().filter((n) => /^music_/.test(n)), ['music_play'], 'music_artist_view is not sent until Matthew approves it');
  assert.deepEqual(names.filter((n) => /^music_/.test(n)).sort(), ['music_error', 'music_play']);
});

test('the one place to approve it: held in js/analytics.js, not in the measurement dictionary, and ready in both players', async () => {
  const src = read('js/analytics.js');
  const held = slice(src, 'var AWAITING_APPROVAL = {', '};');
  assert.deepEqual([...held.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]), ['music_interrupted', 'music_artist_view'], 'two names wait, and only those');
  assert.match(held, /waiting for Matthew's approval/, 'it says what it waits for');
  const { EVENT_DICTIONARY } = await import('../../workers/mccluster/src/analytics/measurement-dictionary.js');
  assert.equal(EVENT_DICTIONARY.some((e) => e.event_name === 'music_interrupted'), false, 'not reviewed yet: approving it adds its row there and deletes its line here');
  assert.equal(EVENT_DICTIONARY.some((e) => e.event_name === 'music_artist_view'), false, 'nor is the artist view');
  assert.match(read('js/music-artist.js'), /root\.MCC_TRACK\("music_artist_view", \{ artist: v\.slug, tracks: v\.total \}\)/);
  /* every music_ name a page calls is either reviewed into the dictionary or waiting here: none goes out unreviewed */
  const known = new Set([...EVENT_DICTIONARY.map((e) => e.event_name), ...[...held.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])]);
  for (const f of ['js/music-artist.js', 'js/music-community.js', 'js/music-credits.js', 'js/listen.js']) {
    for (const m of read(f).matchAll(/MCC_TRACK\("([a-z_]+)"/g)) assert.ok(known.has(m[1]), `${f}: ${m[1]} is reviewed or held`);
  }
  /* the players keep calling it, so approving it is that one line */
  assert.match(read('js/music-engine.js'), /trackEvent\("music_interrupted", \{ reason: why/);
  assert.match(read('album.html'), /window\.MCC_TRACK\("music_interrupted", \{ track:/);
});
