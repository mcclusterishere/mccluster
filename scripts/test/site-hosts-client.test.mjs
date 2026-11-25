/* THE PAGES READ THEIR HOSTS FROM window.MCC_SITE (SPEC-PLATFORM 2.3, the client lane of P0).

     node --test scripts/test/site-hosts-client.test.mjs

   Every page script that named a site host in code now reads it from the generated block at the top of js/shell-boot.js
   (tools/build-site-hosts.mjs, from data/seo/domain-architecture.json). For each converted file this runs the file's own
   code (the whole file where it runs outside a browser, its named helper where it needs a page) and holds:
   - with today's table it answers exactly what the literal it replaced answered (the values are written out below);
   - with a table whose hosts are elsewhere, the answer moves with the table (the value is read, never written in);
   - with the equityuprise rewrite (SPEC-PLATFORM 2.10: platform.origin https://equityuprise.com, mccluster.org McCluster
     Corp's own tenant) and with a later stage, platform addresses follow the platform while Whip Equipped and Matthew's
     own pages stay on his host and the company page and its news stay on mccluster.org;
   - a page that loads one of these files without js/shell-boot.js first gets today's value from the file's fallback
     (js/live-content.js), and every other file is loaded only after js/shell-boot.js, on every published page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, shippedSite, stageSite, equityupriseSite, elsewhereSite, NEXT, COMPANY, PROFILE } from './support/mcc-site.mjs';
import { hostLiterals } from '../../tools/build-site-hosts.mjs';
import { publishedFilter } from '../e2e/platform-hosts.e2e.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/* TODAY: P0's table, the values these files named before they read the table (their fallbacks still answer them); the
   table that ships is P1's (SHIPPED: the record's edge.now) */
const TODAY = stageSite('P0');
const SHIPPED = shippedSite();
const P1 = stageSite('P1');
const F = equityupriseSite('P1');
const ELSEWHERE = elsewhereSite('P0');
const ID = '0e1f0000-0000-4000-8000-000000000001';

/* the text of a named function: from `function name(` to its matching brace (the helpers read here keep braces out of
   their strings and regular expressions) */
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
/* the named helpers of a page script, run with a window of our own */
function helpers(file, names, window) {
  const src = read(file);
  const ctx = vm.createContext({ window, URL });
  vm.runInContext(names.map((n) => fnSource(src, n)).join('\n'), ctx);
  return Object.fromEntries(names.map((n) => [n, ctx[n]]));
}

test('every published page that loads a converted file runs js/shell-boot.js first, or the file keeps today\'s value as its fallback', () => {
  const published = publishedFilter(ROOT);
  const pages = [];
  (function walk(dir) {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (!published(rel)) continue;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.html')) pages.push(rel);
    }
  })('');
  assert.ok(pages.length > 150, `the published tree (${pages.length} pages)`);
  /* loaded by a page's own script tag */
  const DIRECT = ['js/action-globe.js', 'js/control-room/clipping.js', 'js/control-room/music-direct-sales.js', 'js/mnet.js',
    'js/news-brief.js', 'js/travel/world-travel.mjs', 'js/world-environment-mccluster.mjs', 'js/world-source-profile.js'];
  const loads = new Map(), noBootFallback = [];
  for (const page of pages) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]).map((attrs) => {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!src || /^https?:/i.test(src[1])) return null;
      const path = src[1].split(/[?#]/)[0];
      return { src: path.startsWith('/') ? path.slice(1) : posix.normalize(posix.join(posix.dirname(page), path)), late: /type\s*=\s*["']module|\bdefer\b/i.test(attrs), async: /\basync\b/i.test(attrs) };
    }).filter(Boolean);
    const boot = scripts.findIndex((s) => s.src === 'js/shell-boot.js');
    for (const [i, s] of scripts.entries()) {
      if (DIRECT.includes(s.src)) {
        (loads.get(s.src) || loads.set(s.src, []).get(s.src)).push(page);
        assert.ok(boot !== -1 && !scripts[boot].late && !scripts[boot].async && (boot < i || s.late), `${page} loads ${s.src} without js/shell-boot.js first`);
      }
      if (s.src === 'js/live-content.js' && (boot === -1 || boot > i)) noBootFallback.push(page);
    }
  }
  for (const f of DIRECT) assert.ok(loads.get(f), `${f} is loaded by a published page`);
  /* loaded by another script, which is itself loaded after js/shell-boot.js */
  const loaders = (needle) => readdirSync(join(ROOT, 'js'), { recursive: true }).map(String).filter((f) => /\.m?js$/.test(f))
    .filter((f) => !f.endsWith(needle) && read(`js/${f}`).includes(needle)).map((f) => `js/${f}`).sort();
  assert.deepEqual(loaders('halo/halo.js').filter((f) => !f.startsWith('js/halo/')), ['js/action-globe.js'], 'js/halo/halo.js is loaded by js/action-globe.js alone');
  assert.deepEqual(loaders('whip-booking.mjs'), ['js/travel/world-travel.mjs'], 'js/travel/whip-booking.mjs is imported by js/travel/world-travel.mjs alone');
  /* js/live-content.js is in the head of pages that do not load js/shell-boot.js: its fallback answers today's value there */
  assert.ok(noBootFallback.length > 0, 'some published page loads js/live-content.js without js/shell-boot.js (the fallback is needed)');
  assert.ok(noBootFallback.includes('embed.html'), 'embed.html, framed on other sites, is one');
});

test('the converted files name no site host in code but js/live-content.js\'s one fallback', () => {
  const counts = Object.fromEntries(['js/action-globe.js', 'js/control-room/clipping.js', 'js/control-room/music-direct-sales.js', 'js/halo/halo.js',
    'js/live-content.js', 'js/mnet.js', 'js/news-brief.js', 'js/travel/whip-booking.mjs', 'js/travel/world-travel.mjs',
    'js/world-environment-mccluster.mjs', 'js/world-source-profile.js'].map((f) => [f, hostLiterals(read(f), f).length]));
  assert.deepEqual(counts, {
    'js/action-globe.js': 0, 'js/control-room/clipping.js': 0, 'js/control-room/music-direct-sales.js': 0, 'js/halo/halo.js': 0,
    'js/live-content.js': 1, 'js/mnet.js': 0, 'js/news-brief.js': 0, 'js/travel/whip-booking.mjs': 0, 'js/travel/world-travel.mjs': 0,
    'js/world-environment-mccluster.mjs': 0, 'js/world-source-profile.js': 0
  });
});

test('every converted file still parses the way the browser reads it (a classic script as a script, a module as a module)', () => {
  const broken = [];
  for (const f of ['js/action-globe.js', 'js/control-room/clipping.js', 'js/control-room/music-direct-sales.js', 'js/halo/halo.js',
    'js/live-content.js', 'js/mnet.js', 'js/news-brief.js', 'js/world-source-profile.js']) {
    try { new vm.Script(read(f), { filename: f }); } catch (e) { broken.push(`${f}: ${e.message}`); }
  }
  for (const f of ['js/travel/whip-booking.mjs', 'js/travel/world-travel.mjs', 'js/world-environment-mccluster.mjs']) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) broken.push(`${f}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'does not parse'}`);
  }
  assert.deepEqual(broken, []);
});

/* ---------- js/live-content.js: the privacy answer's shared cookie ---------- */

function privacyCookie(host, site) {
  const src = read('js/live-content.js');
  const end = src.indexOf('/* ============================================================\n   LIVE CONTENT');
  assert.ok(end > 0, 'the privacy block ends where live content begins');
  const version = /var VERSION = "([^"]+)";/.exec(src)[1];
  const store = (seed) => { const m = new Map(Object.entries(seed)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const writes = [];
  const node = () => ({ setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {}, appendChild: (c) => c, classList: { add() {}, remove() {}, toggle() {} } });
  const document = { readyState: 'complete', documentElement: node(), head: node(), body: node(), createElement: node, getElementById: () => null, querySelector: () => null, addEventListener() {} };
  Object.defineProperty(document, 'cookie', { get: () => '', set: (v) => writes.push(String(v)) });
  /* answered before (seen), so no notice is drawn; agreeing then writes the shared cookie */
  const window = { localStorage: store({ mcc_privacy_seen: JSON.stringify({ version, seen_at: '2026-11-23T00:00:00.000Z' }) }), sessionStorage: store({}), addEventListener() {} };
  window.top = window;
  if (site) window.MCC_SITE = site;
  vm.runInNewContext(src.slice(0, end), {
    window, document, location: { pathname: '/press.html', hostname: host, hash: '', reload() {} },
    fetch: () => Promise.resolve({ ok: true }), atob, JSON, Date, Promise, String, Number, Object, isNaN, Error, setTimeout, clearTimeout
  });
  writes.length = 0;
  window.MCC_PRIVACY.acknowledge();
  const ack = writes.find((w) => w.startsWith('mcc_privacy_ack='));
  assert.ok(ack, `${host}: the agreement is written`);
  return (/;\s*Domain=([^;]+)/i.exec(ack) || [])[1] || null;
}

test('js/live-content.js: the privacy cookie is shared under the table\'s cookie domain, and today\'s domain without the table', () => {
  const today = { 'matthew.mccluster.org': 'mccluster.org', 'mccluster.org': 'mccluster.org', 'www.mccluster.org': 'mccluster.org', 'api.mccluster.org': 'mccluster.org',
    'MATTHEW.MCCLUSTER.ORG': 'mccluster.org', 'humanuprise.com': null, 'evilmccluster.org': null, 'mccluster.org.example': null, localhost: null, 'equityuprise.com': null };
  for (const [host, domain] of Object.entries(today)) {
    assert.equal(privacyCookie(host, TODAY), domain, `${host}: today's table`);
    assert.equal(privacyCookie(host, null), domain, `${host}: a page without js/shell-boot.js keeps today's domain`);
  }
  /* stage F: the cookie stays Matthew's registrable domain; the new platform asks once (SPEC-PLATFORM 2.10) */
  assert.equal(privacyCookie('equityuprise.com', F), null);
  assert.equal(privacyCookie('mccluster.org', F), 'mccluster.org');
  assert.equal(privacyCookie('matthew.mccluster.org', F), 'mccluster.org');
  /* read from the table, never from the literal */
  assert.equal(privacyCookie('me.profile.example', ELSEWHERE), 'profile.example');
  assert.equal(privacyCookie('matthew.mccluster.org', ELSEWHERE), null);
});

/* ---------- js/halo/halo.js: the World door of the owner's Halo ---------- */

test('js/halo/halo.js: the Halo\'s World link keeps a door on one of the site\'s origins or a page of this site', () => {
  const feed = (site, world) => {
    const window = { MCC_SITE: site, MCC_BAR: world === undefined ? undefined : { navigation: { world } } };
    return helpers('js/halo/halo.js', ['siteAddress', 'feedHref'], window).feedHref();
  };
  const FALLBACK = 'mnet.html?view=feed';
  /* what the bar gives today (js/tabbar.js worldAt("?view=feed")) and what the literal kept */
  for (const kept of ['https://mccluster.org/?view=feed', 'https://www.mccluster.org/?view=feed', 'https://matthew.mccluster.org/mnet.html?view=feed', 'mnet.html?view=feed', 'action-globe.html?explore=1']) {
    assert.equal(feed(TODAY, kept), kept, kept);
  }
  for (const refused of ['https://evil.example/?view=feed', 'https://mccluster.org.evil.example/', 'javascript:alert(1)', 'http://mccluster.org/?view=feed', '//mccluster.org/', '', undefined, 'https://equityuprise.com/?view=feed']) {
    assert.equal(feed(TODAY, refused), FALLBACK, String(refused));
  }
  assert.equal(feed(null, 'https://mccluster.org/?view=feed'), FALLBACK, 'without the table only a page of this site is kept');
  assert.equal(feed(null, 'mnet.html?view=feed'), 'mnet.html?view=feed');
  /* stage F: the new platform's World is a door of the site, the company's host stays one of its origins */
  assert.equal(feed(F, 'https://equityuprise.com/?view=feed'), 'https://equityuprise.com/?view=feed');
  assert.equal(feed(F, 'https://mccluster.org/company'), 'https://mccluster.org/company');
  assert.equal(feed(ELSEWHERE, 'https://mccluster.org/?view=feed'), FALLBACK, 'a host the table does not name is not the site\'s');
});

/* ---------- js/action-globe.js: Whip Equipped's driver sign-up ---------- */

test('js/action-globe.js: the Whip driver sign-up is Whip\'s own app on the host that serves it', () => {
  const statement = /const WHIP_DRIVER_SIGNUP=[^;\n]+;/.exec(read('js/action-globe.js'));
  assert.ok(statement, 'js/action-globe.js defines WHIP_DRIVER_SIGNUP in one statement');
  const signup = (site) => vm.runInNewContext(`${statement[0]}\nWHIP_DRIVER_SIGNUP`, { window: { MCC_SITE: site } });
  assert.equal(signup(TODAY), 'https://matthew.mccluster.org/whip/driver/', 'today\'s address');
  assert.equal(signup(P1), 'https://matthew.mccluster.org/whip/driver/', 'Whip Equipped lives only on Matthew\'s host, at every stage');
  assert.equal(signup(F), 'https://matthew.mccluster.org/whip/driver/');
  assert.equal(signup(ELSEWHERE), 'https://me.profile.example/whip/driver/');
});

/* ---------- js/mnet.js and js/news-brief.js: the World's links ---------- */

test('js/mnet.js: the newsroom article, a member\'s front page and the walkthrough address come from the table', () => {
  const src = read('js/mnet.js');
  assert.ok(/link\.href = siteHref\("\/news\/" \+ id\);/.test(src), 'a newsroom post links its article through siteHref');
  assert.ok(/esc\(siteHref\('\/member-front\.html\?handle='\+encodeURIComponent\(String\(id\.mccluster_id\|\|handle\)\.toLowerCase\(\)\)\)\)\+'">Open '/.test(src), 'a member\'s front page through siteHref');
  assert.ok(/if \(tourAddress\(raw\)\) return '<a class="mn__tour-cta"/.test(src), 'the walkthrough address through tourAddress');
  const at = (site) => helpers('js/mnet.js', ['siteHref', 'tourAddress'], { MCC_SITE: site });
  const today = at(TODAY);
  assert.equal(today.siteHref(`/news/${ID}`), `https://mccluster.org/news/${ID}`);
  assert.equal(today.siteHref('/member-front.html?handle=ana.sings'), 'https://matthew.mccluster.org/member-front.html?handle=ana.sings');
  for (const yes of ['https://mccluster.org/mnet.html?tour=1', 'https://matthew.mccluster.org/mnet.html?tour=1']) assert.equal(today.tourAddress(yes), true, yes);
  for (const no of ['https://www.mccluster.org/mnet.html?tour=1', 'https://mccluster.org/mnet.html?tour=12', 'http://mccluster.org/mnet.html?tour=1',
    'https://evil.example/mnet.html?tour=1', 'https://mccluster.org/index.html?tour=1', 'https://equityuprise.com/mnet.html?tour=1']) assert.equal(today.tourAddress(no), false, no);
  assert.equal(at(P1).siteHref('/member-front.html?handle=ana.sings'), 'https://mccluster.org/member-front.html?handle=ana.sings', 'P1: the platform serves it');
  const f = at(F);
  assert.equal(f.siteHref(`/news/${ID}`), `https://mccluster.org/news/${ID}`, 'stage F: the company\'s news stays on its host');
  assert.equal(f.siteHref('/member-front.html?handle=ana.sings'), 'https://equityuprise.com/member-front.html?handle=ana.sings');
  for (const yes of ['https://equityuprise.com/mnet.html?tour=1', 'https://mccluster.org/mnet.html?tour=1', 'https://matthew.mccluster.org/mnet.html?tour=1']) assert.equal(f.tourAddress(yes), true, `F: ${yes}`);
  assert.equal(at(ELSEWHERE).siteHref(`/news/${ID}`), `https://platform.example/news/${ID}`);
  const none = at(undefined);
  assert.equal(none.siteHref(`/news/${ID}`), `/news/${ID}`, 'without the table a link stays on this host');
  assert.equal(none.tourAddress('https://mccluster.org/mnet.html?tour=1'), false);
});

test('js/news-brief.js: a brief published to the newsroom links its article where the company answers it', () => {
  const src = read('js/news-brief.js');
  assert.ok(/a\.href = siteHref\("\/news\/" \+ id\);/.test(src));
  const href = (site) => helpers('js/news-brief.js', ['siteHref'], { MCC_SITE: site }).siteHref(`/news/${ID}`);
  assert.equal(href(TODAY), `https://mccluster.org/news/${ID}`);
  assert.equal(href(F), `https://mccluster.org/news/${ID}`);
  assert.equal(href(ELSEWHERE), `https://platform.example/news/${ID}`);
  assert.equal(href(undefined), `/news/${ID}`);
});

/* ---------- js/travel/*: Whip Equipped's rentals and drivers ---------- */

test('js/travel/whip-booking.mjs: the driver application link is Whip\'s own, on Matthew\'s host', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'js/travel/whip-booking.mjs')).href);
  assert.equal(typeof mod.whipDriverHref, 'function', 'whipDriverHref is exported');
  const before = globalThis.window;
  try {
    for (const [site, want] of [[TODAY, 'https://matthew.mccluster.org/whip/driver/'], [P1, 'https://matthew.mccluster.org/whip/driver/'], [F, 'https://matthew.mccluster.org/whip/driver/'],
      [ELSEWHERE, 'https://me.profile.example/whip/driver/'], [undefined, '/whip/driver/']]) {
      globalThis.window = { MCC_SITE: site };
      assert.equal(mod.whipDriverHref(), want);
    }
  } finally {
    if (before === undefined) delete globalThis.window; else globalThis.window = before;
  }
  assert.match(read('js/travel/whip-booking.mjs'), /<a href="\$\{whipDriverHref\(\)\}" id="weBookDriver">/);
});

test('js/travel/world-travel.mjs: "See all" and each car\'s Reserve open Whip\'s rentals app on Matthew\'s host', () => {
  const src = read('js/travel/world-travel.mjs');
  const helper = /const whipHref = [^\n]+;/.exec(src);
  assert.ok(helper, 'world-travel.mjs defines whipHref in one statement');
  assert.ok(/<a href="\$\{esc\(whipHref\('\/whip\/rentals\/'\)\)\}" target="_blank" rel="noopener">See all ›<\/a>/.test(src));
  assert.ok(/<a class="wt-car-go" href="\$\{esc\(whipHref\('\/whip\/rentals\/\?vehicle=' \+ encodeURIComponent\(car\.id\)\)\)\}"/.test(src));
  const whipHref = (site) => vm.runInNewContext(`${helper[0]}\nwhipHref`, { window: { MCC_SITE: site } });
  assert.equal(whipHref(TODAY)('/whip/rentals/'), 'https://matthew.mccluster.org/whip/rentals/');
  assert.equal(whipHref(TODAY)('/whip/rentals/?vehicle=we-rental-isabeata-2024'), 'https://matthew.mccluster.org/whip/rentals/?vehicle=we-rental-isabeata-2024', 'the address the World e2e expects');
  assert.equal(whipHref(F)('/whip/rentals/'), 'https://matthew.mccluster.org/whip/rentals/', 'stage F: Whip stays on his host');
  assert.equal(whipHref(ELSEWHERE)('/whip/rentals/'), 'https://me.profile.example/whip/rentals/');
  assert.equal(whipHref(undefined)('/whip/rentals/'), '/whip/rentals/');
});

/* ---------- js/world-environment-mccluster.mjs: the installation's app origin ---------- */

test('js/world-environment-mccluster.mjs: the installation\'s app origin is the page\'s own, else the platform\'s', () => {
  const expr = /appOrigin:([^,\n]+),/.exec(read('js/world-environment-mccluster.mjs'));
  assert.ok(expr, 'the adapter names appOrigin');
  const appOrigin = (w) => vm.runInNewContext(`(${expr[1]})`, { w });
  assert.equal(appOrigin({ location: { origin: 'https://mccluster.org' }, MCC_SITE: TODAY }), 'https://mccluster.org');
  assert.equal(appOrigin({ location: { origin: 'https://matthew.mccluster.org' }, MCC_SITE: TODAY }), 'https://matthew.mccluster.org', 'a page\'s own origin first');
  assert.equal(appOrigin({ MCC_SITE: TODAY }), 'https://mccluster.org', 'no location: today\'s platform');
  assert.equal(appOrigin({ MCC_SITE: F }), NEXT, 'stage F: the new platform');
  assert.equal(appOrigin({ MCC_SITE: ELSEWHERE }), 'https://platform.example');
});

/* ---------- js/world-source-profile.js: the mission source's page ---------- */

function sourceProfile(site) {
  const window = site === undefined ? {} : { MCC_SITE: site };
  vm.runInNewContext(read('js/world-source-profile.js'), { window, URL, URLSearchParams });
  return window.MCC_SOURCE_PROFILE;
}

test('js/world-source-profile.js: the World path by host, the shared link and the company page come from the table', () => {
  const t = sourceProfile(TODAY);
  assert.equal(t.SHARE_ORIGIN, 'https://mccluster.org/');
  assert.equal(t.shareLink('project-drawdown'), 'https://mccluster.org/?source=project-drawdown');
  for (const host of ['mccluster.org', 'www.mccluster.org', 'humanuprise.com', 'www.humanuprise.com', 'MCCLUSTER.ORG']) assert.equal(t.worldPath(host), '/', host);
  for (const host of ['matthew.mccluster.org', '127.0.0.1', 'api.mccluster.org', 'mccluster.org.example', '']) assert.equal(t.worldPath(host), '/mnet.html', host);
  assert.equal(t.KITS.drawdown.changeHref, 'https://mccluster.org/company');
  assert.equal(t.KITS.drawdown.credit.askHref, 'https://mccluster.org/company');
  const f = sourceProfile(F);
  assert.equal(f.SHARE_ORIGIN, `${NEXT}/`, 'stage F: a shared link names the new platform\'s World');
  assert.equal(f.worldPath('equityuprise.com'), '/');
  assert.equal(f.worldPath('mccluster.org'), '/mnet.html', 'stage F: mccluster.org is the company\'s tenant, no longer a World host');
  assert.equal(f.KITS.drawdown.changeHref, `${COMPANY}/company`, 'the company page stays on the company\'s host');
  const e = sourceProfile(ELSEWHERE);
  assert.equal(e.SHARE_ORIGIN, 'https://platform.example/');
  assert.equal(e.worldPath('platform.example'), '/');
  assert.equal(e.worldPath('mccluster.org'), '/mnet.html');
  assert.equal(e.KITS.drawdown.changeHref, 'https://platform.example/company');
  const none = sourceProfile(undefined);
  assert.equal(none.shareLink('project-drawdown'), '', 'without the table there is no address to share');
  assert.equal(none.worldPath('mccluster.org'), '/mnet.html');
});

/* ---------- Control: the clipping form and direct sales ---------- */

async function clippingForm(site) {
  const window = { MCC_SITE: site };
  vm.runInNewContext(read('js/control-room/clipping.js'), { window, document: { getElementById: () => null, querySelectorAll: () => [] }, confirm: () => true, prompt: () => '' });
  const ui = window.CR.clipping;
  ui.init({ org: () => ({ id: 'org-1' }), render() {}, supa: async () => [] });
  ui.state.tab = 'new';
  ui.state.sourceType = 'action';
  return /id="clDestination" type="url" placeholder="([^"]*)"/.exec(ui.render())[1];
}

test('js/control-room/clipping.js: the destination example is the platform\'s action pages', async () => {
  assert.equal(await clippingForm(TODAY), 'https://mccluster.org/action/…');
  assert.equal(await clippingForm(F), `${NEXT}/action/…`);
  assert.equal(await clippingForm(ELSEWHERE), 'https://platform.example/action/…');
  assert.equal(await clippingForm(undefined), '/action/…');
});

function directSalesHead(site) {
  const window = { MCC_SITE: site };
  vm.runInNewContext(read('js/control-room/music-direct-sales.js'), { window, document: {}, URL, Promise, setTimeout });
  return /Sell your own recordings straight from ([^.<]+(?:\.[a-z]+)*)\. Set a price/.exec(window.CR.musicDirect.render())[1];
}

test('js/control-room/music-direct-sales.js: direct sales names the host the album is served on', () => {
  assert.equal(directSalesHead(TODAY), 'matthew.mccluster.org', 'today: the album is on Matthew\'s host');
  assert.equal(directSalesHead(P1), 'mccluster.org', 'P1: the platform serves the album');
  assert.equal(directSalesHead(F), 'equityuprise.com');
  assert.equal(directSalesHead(ELSEWHERE), 'me.profile.example');
  assert.equal(directSalesHead(undefined), 'this site');
});

test('the tables used here are the generated ones: P0\'s (the values before P1), P1\'s (the table that ships), the rewrite on the next platform', () => {
  assert.equal(TODAY.stage, 'P0');
  assert.equal(SHIPPED.stage, 'P1', 'the table every page reads is P1\'s');
  assert.deepEqual(JSON.parse(JSON.stringify(SHIPPED)), JSON.parse(JSON.stringify(P1)), 'and it is today\'s record at P1');
  assert.equal(TODAY.platform.origin, COMPANY);
  assert.equal(TODAY.profile.origin, PROFILE);
  assert.equal(P1.switches.platform_serves, 'everything');
  assert.equal(F.platform.origin, NEXT);
  assert.equal(ELSEWHERE.cookie_domain, 'profile.example');
});
