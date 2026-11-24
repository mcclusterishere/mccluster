/* THE BAR, THE WORLD OVER MUSIC AND THE MUSIC SHELL READ THEIR HOSTS FROM window.MCC_SITE (SPEC-PLATFORM 4, P1).

     node --test scripts/test/site-hosts-engine.test.mjs

   js/tabbar.js, js/world-audio-continuity.js and js/music-shell.js are the music engine build's files. P1 changes only
   their host decisions, each in a small named function read from the one table (the generated block at the top of
   js/shell-boot.js): which origin a link points at, whether the World is local, the fragment hand-off writer, the carry
   and the installed app's move card. Each function is run here as written, with a window of our own:
   - with the table that ships (P1): on the platform (mccluster.org) the bar is local, Music listen.html, the M
     index.html, the Globe /; on Matthew's host the Globe points at the platform's World and the M at his own root, and
     until P3 the bar's doors to the music pages the one player keeps a song across (Music, an artist's page, the
     account) stay on his host, as at P0 (the P1 amendment of 2026-11-24, SPEC-PLATFORM 4: a door to another origin is a
     page load, which would end the song playing on his album or artist page); every other page is the platform's; the
     World is / and /mnet.html only, never /index.html; on a page itself the bar's door to that page is this page, on
     either host (Listen keeps the player's own Play and Pause); the writer is off; the carry runs on the platform
     alone, and loads there for a waiting offer of kept songs too; the move card only on his host, in the installed app;
   - with P0's table the same functions answer what the literals they replaced answered;
   - with the equityuprise rewrite and with a table whose hosts are elsewhere the answers move with the table;
   - with no table a link stays on its own host and nothing crosses.
   Browser evidence: scripts/e2e/carry.e2e.mjs, scripts/e2e/human-uprise-door.e2e.mjs, scripts/e2e/music-world-continuity.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, shippedSite, stageSite, equityupriseSite, elsewhereSite, NEXT, COMPANY, PROFILE } from './support/mcc-site.mjs';
import { hostLiterals, readPending } from '../../tools/build-site-hosts.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SHIPPED = shippedSite();
const P0 = stageSite('P0');
const P1 = stageSite('P1');
const F = equityupriseSite('P1');
const ELSEWHERE = elsewhereSite('P1');
const PLAT = COMPANY;
const FILES = ['js/tabbar.js', 'js/world-audio-continuity.js', 'js/music-shell.js'];

/* the text of a named function: from `function name(` to its matching brace */
function fnSource(src, name) {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  assert.ok(start !== -1, `${name}() is defined`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name}(): no closing brace`);
}
function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
/* a page at `href`, with the table `site`, running the named helpers of `file` */
function page(file, names, { site, href, root = null, local = {}, standalone = false, parent = null, extra = {} }) {
  const u = new URL(href);
  const window = { MCC_SITE: site === undefined ? undefined : site, localStorage: storage(local), navigator: { standalone },
    matchMedia: (q) => ({ matches: standalone && /display-mode:\s*standalone/.test(q) }) };
  window.window = window;
  window.parent = parent || window;
  window.top = parent ? parent : window;
  const location = { href: u.href, origin: u.origin, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, protocol: u.protocol };
  window.location = location;
  const ctx = vm.createContext({ window, root: window, location, localStorage: window.localStorage, navigator: window.navigator, URL, JSON,
    ROOT: root || `${u.origin}/`, ...extra });
  const src = read(file);
  vm.runInContext(names.map((n) => fnSource(src, n)).join('\n'), ctx);
  return Object.fromEntries(names.map((n) => [n, ctx[n]]));
}
const BAR = ['onWorldHost', 'isWorldPath', 'pageBase', 'pageHref', 'samePath', 'onPage', 'pageOrHere', 'worldBase', 'worldAt', 'worldScreen',
  'crossesHouse', 'handoffWriterOn', 'houseBound', 'readAuthSession', 'storedSessionUsable', 'carryWanted', 'carryPending', 'moveCardWanted'];
const bar = (opts) => page('js/tabbar.js', BAR, opts);

test('the table that ships is P1\'s, and these files name no host of their own any more', () => {
  assert.equal(SHIPPED.stage, 'P1');
  assert.equal(SHIPPED.switches.platform_serves, 'everything');
  assert.equal(SHIPPED.switches.carry, true);
  for (const f of FILES) assert.deepEqual(hostLiterals(read(f), f), [], `${f} reads its hosts from window.MCC_SITE`);
  assert.deepEqual(readPending(ROOT).engine.files, [], 'the engine\'s pending list is empty: its three files left it');
  for (const f of FILES) assert.ok(readPending(ROOT).engine.owned_files.includes(f), `${f} is still the engine build's file`);
});

test('P1 on the platform: the bar is local (Music listen.html, the M index.html, the Globe /), the World is / and /mnet.html only', () => {
  for (const at of ['/listen.html', '/index.html', '/', '/walls/cover-art.html']) {
    const b = bar({ site: SHIPPED, href: PLAT + at });
    assert.equal(b.onWorldHost(), true, at);
    assert.equal(b.pageHref('listen.html'), `${PLAT}/listen.html`, `${at}: Music is this host's`);
    assert.equal(b.pageHref('index.html'), `${PLAT}/index.html`, `${at}: the M is the HERE front door on this host`);
    assert.equal(b.pageHref('index.html?front=house'), `${PLAT}/index.html?front=house`);
    assert.equal(b.pageHref('control.html#home'), `${PLAT}/control.html#home`);
    assert.equal(b.pageHref('music-creator.html'), `${PLAT}/music-creator.html`);
    assert.equal(b.pageHref('album.html'), `${PLAT}/album.html`);
    assert.equal(b.worldAt('?view=feed'), `${PLAT}/?view=feed`, `${at}: the Globe is this host's root`);
    assert.equal(b.pageBase('listen.html'), `${PLAT}/`);
  }
  const b = bar({ site: SHIPPED, href: `${PLAT}/listen.html` });
  assert.equal(b.isWorldPath('/'), true);
  assert.equal(b.isWorldPath('/mnet.html'), true);
  assert.equal(b.isWorldPath('/index.html'), false, 'the HERE front door is never the World');
  assert.equal(b.isWorldPath('/listen.html'), false);
  for (const [u, want] of [[`${PLAT}/`, true], [`${PLAT}/?view=feed`, true], [`${PLAT}/mnet.html`, true], [`${PLAT}/index.html`, false], [`${PLAT}/index.html?album=here`, false],
    ['https://www.mccluster.org/', true], [`${PROFILE}/mnet.html`, false], [`${PROFILE}/`, false], ['https://evil.example/', false]]) {
    assert.equal(b.worldScreen(new URL(u)), want, `worldScreen(${u})`);
  }
  /* a page the platform does not serve (Whip Equipped, Matthew's separate company) is linked on his host outright */
  for (const [path, want] of [['/whip.html', true], ['/whip/driver/', true], ['/prayer-closet.html', true], ['/listen.html', false], ['/index.html', false], ['/', false],
    ['/mnet.html', false], ['/news/a-1', false], ['/company', false], ['/account.html', false], ['/js/tabbar.js', false], ['/matthew-mccluster.html', false]]) {
    assert.equal(b.houseBound(new URL(PLAT + path)), want, `houseBound(${path})`);
  }
  assert.equal(b.houseBound(new URL(`${PROFILE}/whip.html`)), false, 'another origin is never this host\'s link');
});

test('P1 on Matthew\'s host: the Globe points at the platform\'s World, the M at his own root; Music, an artist\'s page and the account stay his until P3, every other page is the platform\'s', () => {
  /* CHANGED ON PURPOSE (the P1 amendment of 2026-11-24, SPEC-PLATFORM 4; review VP1-3). Until this round this test said
     Music, the account and an artist's page pointed at the platform from his host. A door to another origin is a page
     load (js/music-shell.js decide()), so a song playing on his album or artist page stopped on the bar's Music tab and
     on the account chip, which P0 kept playing by opening them as views. Matthew: "We must prepare without breaking
     anything to do that" and "I want a singular fucking music engine with 1 fucking player at all times". So until his
     host answers 301s (P3), the bar's doors to the pages the one player keeps a song across stay on his host, exactly as
     at P0. Pages that were page loads at P0 (the album from Listen, Music Videos, Control, Games, Hire, a member's front
     page) are the platform's from P1, as before this round. */
  for (const at of ['/index.html', '/', '/listen.html', '/album.html?album=here', '/music-creator.html?handle=probe-artist', '/matthew-mccluster.html']) {
    const b = bar({ site: SHIPPED, href: PROFILE + at });
    assert.equal(b.onWorldHost(), false, at);
    assert.equal(b.pageHref('listen.html'), `${PROFILE}/listen.html`, `${at}: Music stays on his host until P3`);
    assert.equal(b.pageHref('account.html'), `${PROFILE}/account.html`, `${at}: the account (the chip) stays on his host until P3`);
    assert.equal(b.pageHref('account.html?stay=1'), `${PROFILE}/account.html?stay=1`, `${at}: the World wing's Account room too`);
    assert.equal(b.pageHref('music-creator.html?handle=probe-artist'), `${PROFILE}/music-creator.html?handle=probe-artist`, `${at}: an artist's page (the M of an artist's perspective) too`);
    assert.equal(b.pageBase('listen.html'), `${PROFILE}/`, `${at}: the bar's navigation.house, which the installed dock's player opens`);
    assert.equal(b.pageHref('album.html'), `${PLAT}/album.html`, `${at}: the album is the platform's (from Listen it was a page load at P0 too; on the album itself pageOrHere keeps it)`);
    assert.equal(b.pageHref('music-videos.html'), `${PLAT}/music-videos.html`);
    assert.equal(b.pageHref('control.html#home'), `${PLAT}/control.html#home`, 'Control is a platform page');
    assert.equal(b.pageHref('game-hub.html'), `${PLAT}/game-hub.html`);
    assert.equal(b.pageHref('hire.html'), `${PLAT}/hire.html`);
    assert.equal(b.pageHref('member-front.html?handle=probe-member'), `${PLAT}/member-front.html?handle=probe-member`, 'a member\'s front page was a page load at P0 too');
    assert.equal(b.pageHref('index.html'), `${PROFILE}/index.html`, `${at}: the M is his own root`);
    assert.equal(b.pageHref('index.html?front=house'), `${PROFILE}/index.html?front=house`);
    assert.equal(b.worldAt('?view=feed'), `${PLAT}/?view=feed`, `${at}: the Globe is the platform's World, cross-origin as at P0`);
    assert.equal(b.isWorldPath('/'), false, 'his root is his HERE page');
    assert.equal(b.isWorldPath('/mnet.html'), true);
    assert.equal(b.houseBound(new URL(`${PROFILE}/listen.html`)), false, 'his host serves every page until P3');
  }
  /* the account reads this host's own session: the chip and the profile tab go there through sessionRoom */
  const acct = page('js/tabbar.js', [...BAR, 'sessionRoom'], { site: SHIPPED, href: `${PROFILE}/album.html?album=here` });
  assert.equal(acct.sessionRoom('account.html'), `${PROFILE}/account.html`, 'the signed-out chip on his album is his account page, a view over the album');
  assert.equal(acct.sessionRoom('account.html?stay=1'), `${PROFILE}/account.html?stay=1`);
  /* the platform is unchanged: everything stays on it */
  const plat = page('js/tabbar.js', [...BAR, 'sessionRoom'], { site: SHIPPED, href: `${PLAT}/album.html?album=here` });
  for (const p of ['listen.html', 'account.html', 'account.html?stay=1', 'music-creator.html?handle=probe-artist', 'album.html', 'index.html']) {
    assert.equal(plat.pageHref(p), `${PLAT}/${p}`, `the platform: ${p} stays on it`);
  }
  assert.equal(plat.sessionRoom('account.html'), `${PLAT}/account.html`, 'the platform\'s chip is the platform\'s account page');
  assert.equal(plat.pageBase('listen.html'), `${PLAT}/`);
});

test('P3 ends the exception: once Matthew\'s host answers 301s, his bar points Music and the account at the platform', () => {
  const P3 = stageSite('P3');
  assert.equal(P3.switches.profile_host_routed, true, 'P3 routes his host');
  const b = page('js/tabbar.js', [...BAR, 'sessionRoom'], { site: P3, href: `${PROFILE}/album.html?album=here` });
  assert.equal(b.pageHref('listen.html'), `${PLAT}/listen.html`, 'P3: Music is the platform\'s (his host would answer its own copy with a 301)');
  assert.equal(b.pageHref('account.html'), `${PLAT}/account.html`);
  assert.equal(b.pageHref('music-creator.html?handle=probe-artist'), `${PLAT}/music-creator.html?handle=probe-artist`);
  assert.equal(b.sessionRoom('account.html'), `${PLAT}/account.html`);
  assert.equal(b.pageHref('index.html'), `${PROFILE}/index.html`, 'the M stays his own root');
  /* P0's table: the same answers the literals gave (his host for all of them) */
  const p0 = page('js/tabbar.js', [...BAR, 'sessionRoom'], { site: P0, href: `${PROFILE}/album.html?album=here` });
  for (const p of ['listen.html', 'account.html', 'music-creator.html?handle=probe-artist', 'album.html']) assert.equal(p0.pageHref(p), `${PROFILE}/${p}`, `P0: ${p}`);
  assert.equal(p0.sessionRoom('account.html'), `${PROFILE}/account.html`);
});

test('P1, the page you are on: the bar\'s door to a page is that page itself when you stand on it, on either host, so Listen on Matthew\'s host keeps the player\'s Play and Pause', () => {
  /* the wing doors (the Music tab among them) resolve through pageOrHere: on his Listen itself the Music tab is this
     page (the player's own Play and Pause). CHANGED ON PURPOSE (the P1 amendment of 2026-11-24, review VP1-3): from his
     album, an artist page or any other of his pages, Music stays on his host until P3 too, so a song playing on his
     album keeps playing when Listen opens over it as a view (it pointed at the platform's Listen, a page load). */
  const listen = bar({ site: SHIPPED, href: `${PROFILE}/listen.html` });
  assert.equal(listen.pageOrHere('listen.html'), `${PROFILE}/listen.html`, 'on his Listen the Music tab is this page');
  assert.equal(listen.pageHref('listen.html'), `${PROFILE}/listen.html`, 'linked from his host, Listen is his host\'s until P3');
  assert.equal(listen.pageOrHere('album.html'), `${PLAT}/album.html`, 'another page (a page load at P0 too): where the table serves it');
  const album = bar({ site: SHIPPED, href: `${PROFILE}/album.html?t=2` });
  assert.equal(album.pageOrHere('listen.html'), `${PROFILE}/listen.html`, 'from his album, Music is his Listen, a view over the album');
  assert.equal(album.pageOrHere('album.html'), `${PROFILE}/album.html`, 'the album\'s own door, standing on it');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/` }).pageOrHere('index.html'), `${PROFILE}/index.html`, 'his root is his HERE page');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/hire.html` }).pageOrHere('listen.html'), `${PROFILE}/listen.html`);
  const wall = bar({ site: SHIPPED, href: `${PROFILE}/walls/cover-art.html`, root: '../' });
  assert.equal(wall.pageOrHere('listen.html'), `${PROFILE}/listen.html`, 'a page in a folder on his host: Music is his');
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/listen.html` }).pageOrHere('listen.html'), `${PLAT}/listen.html`, 'the platform: local');
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/album.html` }).pageOrHere('listen.html'), `${PLAT}/listen.html`);
  assert.equal(bar({ site: P0, href: `${PROFILE}/listen.html` }).pageOrHere('listen.html'), `${PROFILE}/listen.html`, 'P0: as the literals had it');
  assert.equal(bar({ site: undefined, href: 'http://127.0.0.1:4173/listen.html', root: 'http://127.0.0.1:4173/' }).pageOrHere('album.html'), 'http://127.0.0.1:4173/album.html', 'no table: beside this page');
  const tabbar = read('js/tabbar.js');
  assert.match(fnSource(tabbar, 'resolveRoom'), /wing === "world" \? sessionRoom\(path\) : pageOrHere\(path\)/, 'every wing door outside the World resolves through pageOrHere');
});

test('P1: the fragment hand-off writer is off on every host; the carry runs on the platform alone, once, and never in a frame of its own host', () => {
  const usable = { mccdb_session: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 4102444800 }) };
  const marked = { mcc_carry_v1: JSON.stringify({ v: 1, result: 'none', at: new Date().toISOString() }) };
  for (const href of [`${PLAT}/listen.html`, `${PROFILE}/listen.html`, `${PLAT}/`]) {
    const b = bar({ site: SHIPPED, href });
    assert.equal(b.handoffWriterOn(), false, `${href}: no token in any link`);
    assert.equal(b.crossesHouse(new URL(href.startsWith(PLAT) ? `${PROFILE}/x` : `${PLAT}/x`)), true, 'the other host is still the site\'s');
  }
  const fresh = bar({ site: SHIPPED, href: `${PLAT}/listen.html` });
  assert.equal(fresh.carryWanted(), true, 'a platform page with no session loads js/carry.js');
  assert.equal(fresh.carryPending(), true, 'and, never asked before, the World waits for it');
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/listen.html`, local: usable }).carryWanted(), false, 'a usable session here: nothing to carry');
  const after = bar({ site: SHIPPED, href: `${PLAT}/account.html`, local: marked });
  assert.equal(after.carryWanted(), true, 'asked before: js/carry.js still loads, for the clear line');
  assert.equal(after.carryPending(), false, 'but asks nothing and nobody waits');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/listen.html` }).carryWanted(), false, 'Matthew\'s host is the one asked, never the asker');
  assert.equal(bar({ site: SHIPPED, href: 'https://www.mccluster.org/' }).carryWanted(), false, 'a door serves no page');
  const sameOriginParent = { location: { origin: PLAT } };
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/action-globe.html`, parent: sameOriginParent }).carryWanted(), false, 'the globe inside the World: the World asks');
  const otherHost = { get location() { throw new Error('SecurityError: cross-origin'); } };
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/?mcc_audio=1`, parent: otherHost }).carryWanted(), true, 'the World framed over Music on Matthew\'s host asks for itself');
  /* P0: the writer is on and the carry off, as before */
  const p0 = bar({ site: P0, href: `${PLAT}/` });
  assert.equal(p0.handoffWriterOn(), true);
  assert.equal(p0.carryWanted(), false);
  /* no table: nothing crosses, nothing is written, nothing carried */
  const none = bar({ site: undefined, href: `${PLAT}/listen.html` });
  assert.equal(none.handoffWriterOn(), false);
  assert.equal(none.crossesHouse(new URL(`${PROFILE}/x`)), false);
  assert.equal(none.carryWanted(), false);
});

test('P1: songs kept at the old address wait for their offer on a top-level platform page, signed in or not (SPEC-PLATFORM 2.7, review VP1-1)', () => {
  /* the carry brings the paths of the songs kept on his host (mcc_carry_kept_v1); js/carry.js says the one line and
     keeps them here on a tap. A member the carry signed in has a usable session on the next page, where carryWanted() is
     false, so the bar loads js/carry.js for a waiting offer too, and only there */
  const KEPT = { mcc_carry_kept_v1: JSON.stringify(['/assets/audio/iot.mp3']) };
  const usable = { mccdb_session: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 4102444800 }) };
  const names = ['readAuthSession', 'storedSessionUsable', 'carryWanted', 'keptWaiting'];
  const at = (href, local, extra = {}) => page('js/tabbar.js', names, { site: SHIPPED, href, local, ...extra });
  const member = at(`${PLAT}/listen.html`, { ...usable, ...KEPT });
  assert.equal(member.carryWanted(), false, 'signed in here: nothing to carry');
  assert.equal(member.keptWaiting(), true, 'but the offer of kept songs is still to be said');
  assert.equal(at(`${PLAT}/listen.html`, usable).keptWaiting(), false, 'no kept songs: nothing waits');
  assert.equal(at(`${PROFILE}/listen.html`, KEPT).keptWaiting(), false, 'never on his host, which kept them');
  assert.equal(at('https://www.mccluster.org/', KEPT).keptWaiting(), false, 'never on a door');
  assert.equal(at(`${PLAT}/?mcc_audio=1`, KEPT, { parent: { get location() { throw new Error('SecurityError: cross-origin'); } } }).keptWaiting(), false, 'never in a frame (the World framed over Music on his host): the top page says it');
  assert.equal(page('js/tabbar.js', names, { site: P0, href: `${PLAT}/listen.html`, local: KEPT }).keptWaiting(), false, 'P0: the carry is off');
  assert.equal(page('js/tabbar.js', names, { site: undefined, href: `${PLAT}/listen.html`, local: KEPT }).keptWaiting(), false, 'no table: nothing');
  assert.match(fnSource(read('js/tabbar.js'), 'startCarry'), /if \(!carryWanted\(\) && !keptWaiting\(\)\) return;/, 'the bar loads js/carry.js for either');
});

test('P1: the installed app\'s move card is for Matthew\'s host in standalone mode alone, once', () => {
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/index.html`, standalone: true }).moveCardWanted(), true, 'his app, launched from the Home Screen');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/index.html`, standalone: false }).moveCardWanted(), false, 'his host in a browser tab');
  assert.equal(bar({ site: SHIPPED, href: `${PLAT}/index.html`, standalone: true }).moveCardWanted(), false, 'the platform\'s own app');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/index.html`, standalone: true, local: { mcc_app_moved_v1: '2026-11-24T00:00:00.000Z' } }).moveCardWanted(), false, 'shown once');
  assert.equal(bar({ site: SHIPPED, href: `${PROFILE}/index.html`, standalone: true, parent: { location: { origin: PROFILE } } }).moveCardWanted(), false, 'never in a frame');
  assert.equal(bar({ site: P0, href: `${PROFILE}/index.html`, standalone: true }).moveCardWanted(), false, 'not before P1');
  assert.equal(bar({ site: undefined, href: `${PROFILE}/index.html`, standalone: true }).moveCardWanted(), false, 'not without the table');
  const src = read('js/tabbar.js');
  const card = fnSource(src, 'showMoveCard');
  assert.match(card, /The app now lives at ' \+ textOf\(S\.platform\.host\) \+ '\./, 'the host is the table\'s');
  assert.match(card, /Open it there and add it to your Home Screen; your sign-in and kept songs come with you\./);
  assert.match(card, /className = "dk-peek"/, 'the bar\'s own peek card, no new look');
  assert.doesNotMatch(read('index.html'), /mccAppMoved|showMoveCard/, 'index.html is not edited: the bar draws the card');
});

test('P0\'s table: the same functions answer what the literals they replaced answered', () => {
  const plat = bar({ site: P0, href: `${PLAT}/` });
  assert.equal(plat.pageHref('listen.html'), `${PROFILE}/listen.html`, 'on the World\'s host Music and the M were Matthew\'s site outright');
  assert.equal(plat.pageHref('index.html'), `${PROFILE}/index.html`);
  assert.equal(plat.worldAt('?view=feed'), `${PLAT}/?view=feed`);
  assert.equal(plat.houseBound(new URL(`${PLAT}/listen.html`)), true);
  assert.equal(plat.houseBound(new URL(`${PLAT}/account.html`)), false, 'a World room');
  assert.equal(plat.houseBound(new URL(`${PLAT}/company`)), false, 'the company page');
  assert.equal(plat.houseBound(new URL(`${PLAT}/`)), false);
  assert.equal(plat.houseBound(new URL(`${PLAT}/mnet.html`)), false);
  const prof = bar({ site: P0, href: `${PROFILE}/listen.html` });
  assert.equal(prof.pageHref('listen.html'), `${PROFILE}/listen.html`);
  assert.equal(prof.worldAt('?view=feed'), `${PLAT}/?view=feed`, 'from Matthew\'s site the Globe went to the company\'s root');
  const door = bar({ site: P0, href: 'https://humanuprise.com/' });
  assert.equal(door.pageHref('listen.html'), `${PROFILE}/listen.html`);
  assert.equal(door.worldAt('?view=feed'), 'https://humanuprise.com/?view=feed', 'the World door\'s own root');
  const local = bar({ site: P0, href: 'http://127.0.0.1:4173/listen.html', root: 'http://127.0.0.1:4173/' });
  assert.equal(local.pageHref('listen.html'), 'http://127.0.0.1:4173/listen.html', 'a host that is not the site\'s keeps its links');
  assert.equal(local.worldAt('?view=feed'), `${PLAT}/?view=feed`);
});

test('the equityuprise rewrite and a table elsewhere: every answer moves with the table; no table keeps every link on its own host', () => {
  const next = bar({ site: F, href: `${NEXT}/listen.html` });
  assert.equal(next.pageHref('listen.html'), `${NEXT}/listen.html`);
  assert.equal(next.worldAt('?view=feed'), `${NEXT}/?view=feed`);
  assert.equal(next.houseBound(new URL(`${NEXT}/whip.html`)), true, 'Whip stays on Matthew\'s host');
  /* from his host the platform's pages move with the table; Music stays on his host until P3 (the P1 amendment of
     2026-11-24: changed on purpose from the platform's Listen, review VP1-3), whatever the table names his host */
  const his = bar({ site: F, href: `${PROFILE}/index.html` });
  assert.equal(his.pageHref('listen.html'), `${PROFILE}/listen.html`);
  assert.equal(his.pageHref('album.html'), `${NEXT}/album.html`);
  assert.equal(his.pageHref('index.html'), `${PROFILE}/index.html`);
  assert.equal(his.worldAt('?view=feed'), `${NEXT}/?view=feed`);
  const e = bar({ site: ELSEWHERE, href: 'https://me.profile.example/index.html' });
  assert.equal(e.pageHref('listen.html'), 'https://me.profile.example/listen.html');
  assert.equal(e.pageHref('album.html'), 'https://platform.example/album.html');
  assert.equal(e.worldAt(''), 'https://platform.example/');
  const none = bar({ site: undefined, href: `${PROFILE}/walls/x.html`, root: `${PROFILE}/` });
  assert.equal(none.pageHref('listen.html'), `${PROFILE}/listen.html`);
  assert.equal(none.worldAt('?view=feed'), `${PROFILE}/mnet.html?view=feed`, 'the World on this host');
  assert.equal(none.onWorldHost(), false);
});

/* ---------- js/world-audio-continuity.js: the World over Music ---------- */

const WAC = ['site', 'worldOrigins', 'houseOrigin', 'trustedOrigins', 'worldHome', 'musicOrigins', 'musicHome', 'isWorldDocument', 'urlOf', 'worldURL', 'musicURL'];
const wac = (opts) => page('js/world-audio-continuity.js', WAC, opts);

test('the World over Music on the platform is same-origin with Music; on Matthew\'s host it is the platform\'s World, as before', () => {
  const plat = wac({ site: SHIPPED, href: `${PLAT}/listen.html` });
  const frame = plat.worldURL(bar({ site: SHIPPED, href: `${PLAT}/listen.html` }).worldAt('?view=feed'));
  assert.equal(frame.origin, PLAT, 'the frame the Globe opens over Music is the platform\'s own origin');
  assert.equal(frame.href, `${PLAT}/?view=feed`);
  const prof = wac({ site: SHIPPED, href: `${PROFILE}/listen.html` });
  assert.equal(prof.worldURL(bar({ site: SHIPPED, href: `${PROFILE}/listen.html` }).worldAt('?view=feed')).href, `${PLAT}/?view=feed`, 'from his host: the platform\'s World, cross-origin, as before');
  assert.equal(prof.worldURL(`${PROFILE}/mnet.html?view=feed&embedded=1`).href, `${PLAT}/?view=feed`, 'his copy of the World is the platform\'s');
  assert.equal(plat.worldURL(`${PLAT}/index.html`), null, 'the HERE front door is never the World');
  assert.equal(plat.worldURL(`${PLAT}/index.html?view=feed`), null);
  assert.equal(plat.worldURL('https://www.mccluster.org/?view=feed').href, `${PLAT}/?view=feed`, 'www is the apex');
  assert.equal(plat.worldURL(`${PROFILE}/action-globe.html?halo=1`), null, 'the owner\'s Halo is not the World');
  assert.deepEqual([...plat.trustedOrigins()], [PROFILE, PLAT, 'https://www.mccluster.org', 'https://humanuprise.com', 'https://www.humanuprise.com'], 'the same origins the bridge trusted');
  assert.equal(plat.isWorldDocument({ origin: PLAT, pathname: '/' }), true);
  assert.equal(plat.isWorldDocument({ origin: PLAT, pathname: '/index.html' }), false, 'the front door is not the World');
  assert.equal(plat.isWorldDocument({ origin: PROFILE, pathname: '/mnet.html' }), true);
  assert.equal(plat.isWorldDocument({ origin: PROFILE, pathname: '/' }), false);
  assert.equal(plat.musicURL(`${PLAT}/listen.html`), true, 'Music on the platform is Music');
  assert.equal(plat.musicURL(`${PROFILE}/listen.html`), true, 'and on his host until P3');
  assert.equal(plat.musicURL(`${PLAT}/listen.html?track=1`), false);
  assert.equal(plat.musicHome(), `${PLAT}/listen.html`);
  assert.equal(plat.worldHome(), `${PLAT}/`);
  /* the World's transport, its title tapped with the World closed, goes to Music: on his host his own Listen until P3, a
     view over his album or artist page (the P1 amendment of 2026-11-24, review VP1-3), never the platform's copy, a page
     load that would end the song; the bar's own rule (js/tabbar.js pageBase) */
  assert.equal(prof.musicHome(), `${PROFILE}/listen.html`, 'from his host: his own Listen');
  assert.equal(wac({ site: SHIPPED, href: `${PROFILE}/album.html?album=here` }).musicHome(), bar({ site: SHIPPED, href: `${PROFILE}/album.html?album=here` }).pageHref('listen.html'), 'the same answer as the bar\'s Music tab');
  assert.equal(wac({ site: stageSite('P3'), href: `${PROFILE}/album.html?album=here` }).musicHome(), `${PLAT}/listen.html`, 'P3: the platform\'s Listen');
});

test('the World over Music with P0\'s table, the equityuprise rewrite and no table', () => {
  const p0 = wac({ site: P0, href: `${PROFILE}/listen.html` });
  assert.equal(p0.musicURL(`${PLAT}/listen.html`), false, 'P0: Music is Matthew\'s alone');
  assert.equal(p0.musicURL(`${PROFILE}/listen.html`), true);
  assert.equal(p0.musicHome(), `${PROFILE}/listen.html`);
  assert.equal(p0.worldURL(`${PROFILE}/mnet.html`).href, `${PLAT}/`);
  const f = wac({ site: F, href: `${PROFILE}/listen.html` });
  assert.equal(f.worldHome(), `${NEXT}/`);
  assert.equal(f.worldURL(`${PROFILE}/mnet.html?view=feed`).href, `${NEXT}/?view=feed`);
  assert.ok(f.trustedOrigins().includes(NEXT));
  /* changed on purpose (the P1 amendment of 2026-11-24, review VP1-3): standing on Matthew's host before P3, Music stays
     on his host under any platform name, as the bar's Music tab does; the new platform's Listen would be a page load
     that ends the song playing here. Matthew: "I want a singular fucking music engine with 1 fucking player at all
     times". Was `${NEXT}/listen.html`. */
  assert.equal(f.musicHome(), `${PROFILE}/listen.html`);
  assert.equal(wac({ site: F, href: `${NEXT}/listen.html` }).musicHome(), `${NEXT}/listen.html`, 'on the new platform its own Listen');
  const none = wac({ site: undefined, href: `${PROFILE}/listen.html` });
  assert.deepEqual([...none.trustedOrigins()], [], 'an array of the page\'s own realm, spread into this one');
  assert.equal(none.worldURL(`${PLAT}/?view=feed`), null);
  assert.equal(none.musicURL(`${PROFILE}/listen.html`), false);
});

/* ---------- js/music-shell.js: the World is / and /mnet.html, never /index.html ---------- */

test('the music shell sends the World to the Music-to-World path and the front door to a page load', () => {
  const at = (site) => page('js/music-shell.js', ['worldHost', 'world'], { site, href: `${PLAT}/listen.html` });
  const s = at(SHIPPED);
  for (const [u, want] of [[`${PLAT}/`, true], [`${PLAT}/?view=feed`, true], [`${PLAT}/mnet.html?join=1`, true], [`${PLAT}/index.html`, false],
    ['https://www.mccluster.org/', true], [`${PROFILE}/mnet.html`, true], [`${PROFILE}/`, false], [`${PROFILE}/index.html`, false],
    [`${PLAT}/action-globe.html`, true], [`${PLAT}/action-globe.html?halo=1`, false], [`${PLAT}/listen.html`, false]]) {
    assert.equal(s.world(new URL(u)), want, u);
  }
  assert.equal(at(F).world(new URL(`${NEXT}/`)), true, 'stage F: the new platform\'s root');
  assert.equal(at(F).world(new URL(`${PLAT}/`)), false, 'stage F: mccluster.org is the company\'s tenant, not a World host');
  assert.equal(at(undefined).world(new URL(`${PLAT}/`)), false, 'no table, no World host');
  assert.equal(at(undefined).world(new URL(`${PLAT}/mnet.html`)), true, 'the World\'s document is the World on any host');
});
