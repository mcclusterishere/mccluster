/* NO SCREEN FLASHES (owner, 2026-10-20: "I see a lot of shit flashing in between moving screens. I'll see like other
   screens flash up instead of just a smooth transition from screen to screen. We need to fix that.")

   Every transition was filmed frame by frame; these pin what was fixed, so it cannot quietly come back:
   the World ships as the World (never the Live room, never a blank page), its bar is in the page, the globe frame is
   dressed before it paints, the Music page's World frame says nothing for its first moment, the bar leaves at once with a
   veil in the colour of where it goes, a carried sign-in is taken without a reload, the album's premiere is up from the
   first paint, and the day/night look remembers the last place it knew. The browser suites film the same things. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the World ships as the World: its own room open, Live shut, the app shell visible, the bar in the page', () => {
  const html = read('mnet.html');
  assert.match(html, /<section class="mn__app" id="mnApp">/, 'the World shell is not hidden in the markup');
  assert.match(html, /<section class="mn__view" id="mnFeedView">/, 'the World\'s own room ships open');
  assert.match(html, /<section class="mn__view" id="mnLiveView" hidden>/, 'the Live room ships shut');
  for (const id of ['mnClipsView', 'mnMissionsView', 'mnDiscoverView', 'mnGroupsView', 'mnMessagesView', 'mnProfileView'])
    assert.match(html, new RegExp(`id="${id}"[^>]*hidden`), `${id} ships shut`);
  assert.match(html, /<html[^>]*class="[^"]*\bmn-world-on\b/, 'the World layout applies from the first paint');
  assert.match(html, /<div class="mn__feed" id="mnFeed" aria-live="polite"><!--[^>]*--><div class="mn__skel"/, 'the feed shows the shapes of posts until it answers');
  /* the bar is written into the page; tabbar.js adopts it */
  const bar = /<nav class="appbar" aria-label="Sections">([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(bar, 'mnet.html carries the bar');
  assert.deepEqual([...bar[1].matchAll(/data-appnav="([a-z]+)"/g)].map((m) => m[1]), ['music', 'home', 'world']);
  assert.match(bar[1], /class="appbar__tab appbar__world is-here"/);
  assert.ok(html.indexOf('<nav class="appbar"') < html.indexOf('<script src="js/tabbar.js'));
  /* the Travel module never holds the World's boot (DOMContentLoaded) */
  assert.match(html, /<script type="module" async src="js\/travel\/world-travel\.mjs/);
});

test('before any script asks the network, the head of mnet.html already knows a guest, a sign-in form and the Music frame', () => {
  const html = read('mnet.html');
  const head = html.slice(0, html.indexOf('</head>'));
  const script = /<script>(\(function\(\)\{var h=document\.documentElement[\s\S]*?)<\/script>/.exec(head);
  assert.ok(script, 'the boot hints run in the head');
  let said = [];
  const run = (o) => runWith(o, () => {});
  const runWith = ({ session = null, hash = '', search = '', framed = false, referrer = '' }, onView) => {
    const classes = new Set();
    said = [];
    const store = new Map(session ? [['mccdb_session', JSON.stringify(session)]] : []);
    const ctx = { URL, document: { referrer, documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, setAttribute: (n, v) => { if (n === 'data-boot-view') onView(v); } } }, localStorage: { getItem: (k) => store.get(k) ?? null },
      location: { hash, search },
      PerformanceObserver: class { constructor(cb) { this.cb = cb; } observe() { this.cb({ getEntriesByName: (n) => n === 'first-contentful-paint' ? [{}] : [] }); } } };
    ctx.window = framed ? { parent: { postMessage: (m, o) => said.push([m.channel, m.type, o, Object.keys(m).length]) } } : null; if (!framed) { ctx.window = {}; ctx.window.parent = ctx.window; }
    vm.runInNewContext(script[1], ctx);
    return [...classes].sort();
  };
  assert.deepEqual(run({}), ['mn-guest'], 'no stored sign-in: the guest World paints from the start');
  assert.deepEqual(run({ search: '?view=feed&signin=1' }), ['mn-boot-signin', 'mn-guest'], 'the sign-in form, not the World first');
  assert.deepEqual(run({ session: { access_token: 'x' } }), [], 'a member: the member World');
  assert.deepEqual(run({ hash: '#mcc_handoff=abc' }), [], 'a sign-in being carried in is a member, not a guest first');
  /* a member's room asked for by address is painted first; a guest's World is the World */
  const boot = (o) => { let at = null; const r = runWith(o, (h) => { at = h; }); return { classes: r, view: at }; };
  assert.deepEqual(boot({ session: { access_token: 'x' }, search: '?view=profile' }), { classes: [], view: 'profile' });
  assert.deepEqual(boot({ search: '?view=profile' }), { classes: ['mn-guest'], view: null });
  assert.deepEqual(boot({ session: { access_token: 'x' }, search: '?view=groups&group=fixture-group' }), { classes: [], view: null });
  assert.deepEqual(boot({ session: { access_token: 'x' }, search: '?view=feed' }), { classes: [], view: null });
  const css = read('css/mnet.css');
  assert.match(css, /html\[data-boot-view\] #mnFeedView \{ display: none !important; \}/);
  assert.match(css, /html\[data-boot-view="profile"\] #mnProfileView \{ display: block !important; \}/, "beats .mn [hidden], which is itself important");
  const mnet = read('js/mnet.js');
  assert.equal((mnet.match(/document\.documentElement\.removeAttribute\("data-boot-view"\);/g) || []).length, 3, 'showGate, setView and peekView take the room over');
  assert.deepEqual(run({ session: { access_token: 'x' }, search: '?view=feed&mcc_audio=1', framed: true }), ['mn-music-frame'], 'inside the Music page, the Music page keeps the bar');
  assert.deepEqual(said, [], 'nothing is said to a page that is not one of the houses');
  run({ session: { access_token: 'x' }, search: '?view=feed&mcc_audio=1', framed: true, referrer: 'https://matthew.mccluster.org/' });
  assert.deepEqual(said, [['mcc-world-audio-v1', 'alive', 'https://matthew.mccluster.org', 2], ['mcc-world-audio-v1', 'painted', 'https://matthew.mccluster.org', 2]],
    'the Music page hears, with no data, that the World is alive and then that it has painted');
  run({ session: { access_token: 'x' }, search: '?view=feed&mcc_audio=1', framed: true, referrer: 'https://example.com/' });
  assert.deepEqual(said, []);
  assert.match(read('css/mnet.css'), /html\.mn-guest \.mn__guest-bar\[hidden\] \{ display: flex !important; \}/, 'a guest\'s way in is in the header from the first paint');
  assert.match(read('css/mnet.css'), /\.mn-boot-signin #mnApp \{ display: none !important; \}/);
  assert.match(read('css/style.css'), /html\.mn-music-frame \.appbar\{display:none!important\}/);
  const js = read('js/mnet.js');
  assert.match(js, /document\.documentElement\.classList\.remove\("mn-boot-signin"\);/, 'showGate ends the hold');
});

test('a member\'s World opens on the World (or the room asked for), and rooms switch without a blank frame', () => {
  const js = read('js/mnet.js'), css = read('css/mnet.css');
  assert.match(js, /if \(\(stored && stored\.access_token\) \|\| handoff\.pending\) \{ showGate\("app"\); if \(DEEP_VIEW\) peekView\(DEEP_VIEW\); \}/);
  assert.match(js, /if \(!DEEP_VIEW \|\| state\.currentView !== DEEP_VIEW\) setView\("feed"\);/, 'a room asked for by address is not covered by the World first');
  assert.match(css, /\.mn__view:not\(\[hidden\]\) \{ animation: none; \}/, 'a room is never faded up from nothing');
  assert.doesNotMatch(css, /\.mn__empty \{[^}]*animation/, 'an empty room never fades up through grey');
  assert.match(js, /window\.scrollTo\(0,0\);\n    sizeWorld\(\);/, 'the new room starts at its top at once, not with a smooth scroll');
  /* the feed keeps its loading shapes until its own read answers */
  assert.match(js, /if \(!append && !state\.feedAnswered && !\(state\.feedScope === "local" && state\.placeScope\.enabled\)\) return;/);
  /* lists keep what they show while they refresh, and load as the shape of what is coming */
  assert.match(js, /function skeletonRows\(n\)/);
  assert.match(js, /function skeletonCards\(n\)/);
  assert.doesNotMatch(js, /setStatus\(\$\("mnMessageStatus"\),"Loading…"\)/, 'Messages refreshes every 15s; it never blanks to "Loading…"');
  assert.doesNotMatch(js, /Loading rooms…/);
  const day = read('css/daylight.css');
  assert.match(day, /html\[data-daylight="day"\]\.hu-editorial :is\(\.mn__panel, \.mn__empty\) \{ background:#ffffff;/, 'the profile panels and empty cards by day');
  assert.match(day, /html\[data-daylight="day"\] \.mn__skel i \{/);
});

test('a sign-in carried in is taken in place: the World waits for it and the bar does not reload the page', () => {
  const bar = read('js/tabbar.js'), js = read('js/mnet.js'), palette = read('js/control-palette.js');
  assert.match(bar, /if \(emit\("mcc:handoff", \{ ok: true \}, true\)\) \{ emit\("mcc:auth-changed", \{ signed_in: true, carried: true \}\); return true; \}\n        location\.reload\(\);/,
    'a page that takes the session cancels mcc:handoff; every other page still reloads signed in');
  assert.match(bar, /ev = new CustomEvent\(n, \{ detail: d \|\| \{\}, cancelable: !!cancelable \}\);/);
  assert.match(js, /handoff\.pending = \/\(\?:\^#\|&\)mcc_handoff=\[\^&\]\/\.test\(location\.hash\) && !JSON\.parse\(localStorage\.getItem\("mccdb_session"\) \|\| "null"\);/,
    'read before tabbar.js scrubs the fragment, on the same test tabbar.js uses');
  assert.match(js, /if \(handoff\.ok && handoff\.pending && e\.cancelable\) e\.preventDefault\(\);/);
  assert.ok(js.indexOf('window.addEventListener("mcc:handoff"') < js.indexOf('function boot()'), 'listening from the moment mnet.js runs, before tabbar.js');
  assert.match(palette, /if \(e && e\.detail && e\.detail\.carried\) return;/, 'the owner\'s palette does not reload a World that took the session in place');
});

test('the bar leaves at once, in the colour of where it goes, and a hop inside one host cross-fades', () => {
  const bar = read('js/tabbar.js'), style = read('css/style.css');
  assert.doesNotMatch(bar, /sail\([^)]*, 460\)/, 'no tab holds the page 460ms before asking for the next');
  assert.match(bar, /\}, wait \|\| 0\);/);
  assert.match(bar, /if \(!\(CROSS_FADE && url && url\.origin === location\.origin\)\) veilOn\(dest\);/);
  assert.match(bar, /root\.classList\.toggle\("pt-to-day", phase === "day"\);/);
  assert.match(bar, /daylightCore\.setAttribute\("data-daylight-core", ""\);/, 'the house loads the Sun arithmetic only');
  assert.match(style, /html\.pt-to-day \.pt-veil\{background:#ffffff\}/);
  assert.match(style, /html\.pt-to-night \.pt-veil\{background:#090b0d\}/);
  assert.match(style, /@view-transition\{navigation:auto\}/);
  assert.doesNotMatch(read('index.html'), /@view-transition/, 'index.html is not edited for this: the shared stylesheet carries it');
});

test('a member without a photo wears their initial in the middle tab, never this page as a broken image', () => {
  const bar = read('js/tabbar.js');
  const clean = bar.slice(bar.indexOf('function cleanPerspective(p)'), bar.indexOf('function currentSubject()'));
  const ctx = { location: { href: 'https://matthew.mccluster.org/listen.html' }, URL, String, out: null };
  vm.runInNewContext('var HANDLE_RE=/^[a-z0-9][a-z0-9._-]{2,39}$/;' + clean + ';out=[cleanPerspective({kind:"member",handle:"fixture.you",name:"Fixture You",avatar:""}),cleanPerspective({kind:"member",handle:"fixture.you",name:"Fixture You"}),cleanPerspective({kind:"member",handle:"fixture.you",name:"Fixture You",avatar:"https://cdn.example/a.png"})];', ctx);
  assert.equal(ctx.out[0].avatar, '', 'an empty avatar is no avatar');
  assert.equal(ctx.out[1].avatar, '', 'a missing avatar is no avatar');
  assert.equal(ctx.out[2].avatar, 'https://cdn.example/a.png');
  assert.match(read('css/style.css'), /\.appbar__tab>span\.appbar__m--initial\{position:static;width:1\.75rem;height:1\.75rem;/, 'the initial is drawn, not hidden as a label');
  for (const page of ['listen.html', 'album.html']) {
    const html = read(page), nav = /<nav class="appbar" aria-label="Sections">([\s\S]*?)<\/nav>/.exec(html)[1];
    assert.deepEqual([...nav.matchAll(/data-appnav="([a-z]+)"/g)].map((m) => m[1]), ['music', 'home', 'world'], `${page} paints the Globe, not a retired Profile tab`);
  }
});

test('the globe frame is dressed before it paints: its standalone deck never shows inside the World', () => {
  const html = read('action-globe.html');
  const script = /<script>\/\*[^<]*?\*\/\/\*[^<]*?\*\/(\(function\(\)\{[^<]*?\}\)\(\);)<\/script>/.exec(html);
  assert.ok(script, 'the head script');
  const run = (search, framed = true, parentClasses = null) => {
    const classes = new Set(); let replaced = null;
    const ctx = { URLSearchParams, document: { documentElement: { classList: { add: (c) => classes.add(c) } } }, location: { search, replace: (u) => { replaced = u; } } };
    ctx.window = framed ? { parent: parentClasses ? { document: { documentElement: { classList: { contains: (c) => parentClasses.includes(c) } } } } : {} } : null; if (!framed) { ctx.window = {}; ctx.window.parent = ctx.window; }
    vm.runInNewContext(script[1], ctx);
    return { classes: [...classes].sort(), replaced };
  };
  assert.deepEqual(run('?embedded=1&surface=network&missions=0&v=1').classes, ['globe-editorial', 'globe-embedded', 'globe-no-missions', 'globe-surface-network']);
  assert.deepEqual(run('?embedded=1&surface=network&missions=0', true, ['hu-social-only']).classes, ['globe-editorial', 'globe-embedded', 'globe-no-missions', 'globe-surface-network']);
  assert.deepEqual(run('?embedded=1&surface=network&missions=0', true, ['hu-editorial']).classes, ['globe-editorial', 'globe-embedded', 'globe-surface-network'],
    'the house owner\'s World (no hu-social-only, js/world-owner-modes.js) keeps the missions, as js/action-globe.js decides');
  assert.deepEqual(run('?embedded=1&surface=analytics').classes, ['globe-embedded', 'globe-surface-analytics']);
  assert.deepEqual(run('?explore=1&missions=0', false).classes, ['globe-editorial', 'globe-explore', 'globe-no-missions']);
  assert.equal(run('?song=x', false).replaced, 'mnet.html?view=feed&song=x', 'the bare route still hands over to the World');
  const css = read('css/globe-editorial.css');
  assert.match(css, /\.globe-editorial body > :is\(\.globe-controls,\.globe-data\) \{visibility:hidden;\}/);
  assert.match(css, /\.globe-editorial \.osm-credit:not\(\.is-editorial\) \{visibility:hidden;\}/);
  assert.match(read('js/action-globe.js'), /credit\.classList\.add\('is-editorial'\)/);
});

test('the Music page\'s World frame stands in the World\'s colour, says nothing at first, and is ready only once painted', () => {
  const js = read('js/world-audio-continuity.js'), css = read('css/world-audio-continuity.css');
  assert.match(js, /var QUIET_MS = 1500, ALIVE_MS = 6000;/);
  assert.match(js, /shell\.classList\.toggle\("is-day", worldPhase\(\) === "day"\);/);
  assert.match(js, /whenPainted\(function \(\) \{\n      if \(channelId !== data\.id\) return;\n      root\.parent\.postMessage\(\{channel:CHANNEL, type:"ready", id:channelId\}, parentOrigin\);/);
  assert.match(css, /\.world-audio-status\.is-quiet > \* \{ visibility:hidden; \}/);
  assert.match(css, /#mccWorldAudioShell\.is-day, #mccWorldAudioShell\.is-day #mccWorldAudioFrame, #mccWorldAudioShell\.is-day \.world-audio-status \{ background:#ffffff;/);
  assert.match(js, /if \(d\.type === "alive"\) \{ frameAlive = true; return; \}/);
  assert.match(js, /if \(d\.type === "painted"\) \{ frameAlive = true; if \(!frameReady\) \{ status\.hidden = true; clearTimeout\(quietTimer\); \} return; \}/);
  assert.ok(js.indexOf('if (d.type === "painted")') > js.indexOf('if (!frame || e.source !== frame.contentWindow || e.origin !== frameOrigin) return;'), 'only the World frame itself can say it');
  /* a tap that leaves the World does not start its song on the way out */
  assert.match(js, /var LEAVING = "\.appbar,\.mcc-auth-chip";/);
  assert.match(js, /e\.target\.closest\?\.\("#mccWorldAudioControls,#mnWorldPlay,video,audio," \+ LEAVING\)\) return;/);
});

test('the album\'s premiere is up from the first paint, on the same test chamber.js uses', () => {
  const html = read('album.html'), chamber = read('js/chamber.js');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /if\(!matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches&&sessionStorage\.getItem\("mcc_premiere"\)!=="1"\)document\.documentElement\.classList\.add\("prem-due"\)/);
  assert.match(html, /html\.prem-due body::after \{ content: ""; position: fixed; inset: 0; z-index: 400; background: #050403;/);
  assert.match(html, /#prem, html\.prem-due body::after \{ display: none; \}/);
  assert.match(chamber, /if \(CALM \|\| seen \|\| !h1\) \{ groundDown\(\); setType\(\); \}/);
  assert.match(chamber, /document\.body\.appendChild\(prem\);\n    groundDown\(\);/);
});

test('day or night: the last place is remembered, so a returning visitor\'s World paints the right phase first', () => {
  const src = read('js/daylight.js');
  const FIXED = Date.parse('2026-10-20T21:40:00Z'); // 17:40 EDT in New Haven: the Sun is up; the time zone's meridian says night
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } getTimezoneOffset() { return 240; } }
  const visit = (stored, granted) => {
    const store = new Map(Object.entries(stored)), html = { dataset: {}, classList: { add() {}, remove() {} } };
    let answer = null;
    const ctx = { Date: FixedDate, Math, JSON, isFinite, Number, URLSearchParams, CustomEvent: class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } },
      setInterval() {}, setTimeout() {}, clearTimeout() {},
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      location: { search: '' },
      navigator: { permissions: { query: () => Promise.resolve({ state: granted ? 'granted' : 'prompt' }) },
        geolocation: { getCurrentPosition: (ok) => { answer = ok; } } } };
    ctx.document = { documentElement: html, currentScript: null, body: {}, hidden: false, addEventListener() {} };
    ctx.window = ctx; ctx.dispatchEvent = () => {};
    vm.runInNewContext(src, ctx);
    return { first: html.dataset.daylight, html, store, answer: (lat, lon) => answer && answer({ coords: { latitude: lat, longitude: lon } }) };
  };
  const first = visit({}, true);
  assert.equal(first.first, 'night', 'a first visit knows only the time zone');
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    first.answer(41.3083, -72.9279);
    assert.equal(first.html.dataset.daylight, 'day', 'the device\'s answer corrects it');
    assert.deepEqual(JSON.parse(first.store.get('mcc_daylight_place')), { lat: 41.3, lon: -72.9 }, 'kept coarse, on this device only');
    const again = visit(Object.fromEntries(first.store), true);
    assert.equal(again.first, 'day', 'the next visit paints day from its first frame');
    const revoked = visit(Object.fromEntries(first.store), false);
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      assert.equal(revoked.store.has('mcc_daylight_place'), false, 'forgotten once location is no longer granted');
      assert.equal(revoked.html.dataset.daylightSource, 'timezone', 'and the look goes back to the time zone (twilight keeps the phase it had)');
    });
  });
});
