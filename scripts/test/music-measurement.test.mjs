/* WHAT THE MUSIC PLAYERS MEASURE (music slice M3 follow-up; review RL-9).

   The names this house measures are its reviewed measurement dictionary
   (workers/mccluster/src/analytics/measurement-dictionary.js, analytics-dictionary/2026-10-21.1, kept equal to the
   reviewed taxonomy migration by workers/mccluster/test/analytics-event-inventory-dictionary.test.mjs; the rule is
   docs/control-plane/ANALYTICS-EVENT-INVENTORY-20261021.md: a name nobody reviewed stays unclassified and is never
   silently mapped). Music slice M3 added music_interrupted (a read that failed or was cut off on the way: reason,
   second, try, path), and the M3 follow-up held it in js/analytics.js until Matthew approved it. He approved it and
   music_error on 2026-11-23 ("For 6, I approved them"; docs/music/MUSIC-RELEASE-20261119.md, "Quick wins"): both are
   reviewed rows in the dictionary now, and each goes out once per drop or failed song, never once
   per read (scripts/test/music-quick-wins.test.mjs counts them; scripts/test/music-playback-races.test.mjs counts
   music_error). */
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

test('approved (2026-11-23): music_interrupted and music_error leave the browser with the names already measured', async () => {
  const s = sender();
  s.track('music_interrupted', { reason: 'error', at_s: 42, attempt: 0, path: 'public', track: 'Who Did The Shoot' });
  s.track('music_artist_view', { artist: 'los-fidel', tracks: 1 });
  s.track('music_error', { code: 2, track: 'Who Did The Shoot' });
  s.track('music_play', { source: 'discovery', track: 'Who Did The Shoot' });
  await s.flush();
  assert.ok(s.sent.length >= 1, 'the queue went out');
  assert.deepEqual(s.names().filter((n) => /^music_/.test(n)).sort(), ['music_error', 'music_interrupted', 'music_play']);
});

test('playback failures are reviewed; the catalogue view awaits approval', async () => {
  const { EVENT_DICTIONARY } = await import('../../workers/mccluster/src/analytics/measurement-dictionary.js');
  assert.equal(EVENT_DICTIONARY.some((e) => e.event_name === 'music_artist_view'), false);
  assert.match(read('js/music-artist.js'), /root\.MCC_TRACK\("music_artist_view", \{ artist: v\.slug, tracks: v\.total \}\)/);
  const reviewed = new Set(EVENT_DICTIONARY.map((e) => e.event_name));
  for (const file of ['js/music-artist.js', 'js/music-community.js', 'js/music-credits.js', 'js/listen.js']) {
    for (const event of read(file).matchAll(/MCC_TRACK\("([a-z_]+)"/g)) {
      assert.ok(reviewed.has(event[1]) || event[1] === 'music_artist_view', file + ': ' + event[1]);
    }
  }
  for (const n of ['music_interrupted', 'music_error']) assert.ok(EVENT_DICTIONARY.some((e) => e.event_name === n), n + ' is a reviewed row');
  assert.match(read('js/music-engine.js'), /if \(fresh\) trackEvent\("music_interrupted", \{ reason: why/);
  assert.match(read('album.html'), /if \(fresh && window\.MCC_TRACK\) window\.MCC_TRACK\("music_interrupted", \{ track:/);
});
