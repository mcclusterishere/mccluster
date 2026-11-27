/* P1, THE PLATFORM SERVES EVERYTHING (SPEC-PLATFORM 4), WITH THE TABLE THAT SHIPS.

   The generated table (src/platform/hosts.generated.js, from data/seo/domain-architecture.json, edge.now.stage P1) is
   what Worker mccluster runs. Every host of the site, every path class, every method:
   - the platform (mccluster.org) answers every published page at its path, the World at / and the HERE front door at
     /index.html; a World query on /index.html (view=, mission=) and /mnet.html still answer 301 to /; Whip Equipped and
     the owner-decision pages (url_ownership.profile_only) answer 301 to Matthew's host, path and query kept;
   - no page the platform serves carries the World rooms' old noindex header (the canonicals say where pages live, and
     they do not move until P2);
   - www.mccluster.org sends every path to the apex; humanuprise.com and its www (once routed) send every path to the
     platform;
   - Matthew's host is unchanged: not routed to this Worker (P3 is the owner's Cloudflare step), so a request that ever
     reached it is handed to GitHub Pages untouched;
   - the files on both hosts answer on the platform: embed.html framed by anyone, carry.html framed by the platform only,
     manifest.json with the platform app's own start (the owner's default of 2026-11-23: the app added from mccluster.org
     opens on the World), sw.js and the static files as they are;
   - a return that names no site origin lands on the platform.
   Nothing here reaches the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, RETURN_FALLBACK_ORIGIN } from '../src/platform/hosts.generated.js';
import { routeFor, createSiteRouter } from '../src/platform/router.js';
import { COMPANY_PARTS } from '../src/company-site/router.js';
import { WORLD_DOOR_PARTS } from '../src/human-uprise/router.js';
import { readRecord } from '../../../tools/build-site-hosts.mjs';
import { handleCreatorCheckout } from '../src/creator-billing.js';

const PLAT = 'https://mccluster.org';
const WWW = 'https://www.mccluster.org';
const PROF = 'https://matthew.mccluster.org';
const HU = 'https://humanuprise.com';
const HUW = 'https://www.humanuprise.com';
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
const READS = new Set(['GET', 'HEAD']);
const record = readRecord();
const PAGES = ['platform', 'profile', 'profile_only'].flatMap((set) => record.url_ownership[set].map((path) => ({ path, set })));
const route = (url, init = {}) => routeFor(SITE, new URL(url), { doorFiles: WORLD_DOOR_PARTS.paths, ...init });
const router = createSiteRouter({ site: SITE, company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS });
const framingOf = (path) => (path === '/embed.html' ? 'anyone' : path === '/carry.html' ? 'platform' : 'site');

test('the table that ships is P1: the platform serves everything, the carry is on, returns fall back to the platform, Matthew\'s host is not routed', () => {
  assert.equal(record.edge.now.stage, 'P1', 'the record says P1 is live');
  assert.equal(SITE.stage, 'P1', 'and the generated table is P1\'s');
  assert.deepEqual({ ...SITE.switches }, { platform_serves: 'everything', profile_host_routed: false, carry: true, returns_fallback: 'platform', metadata: 'today' });
  assert.equal(RETURN_FALLBACK_ORIGIN, PLAT);
  assert.ok(PAGES.length > 170, `every published page (${PAGES.length})`);
});

test('the platform answers every published page at its path, every method; Whip and the owner-decision pages 301 to Matthew\'s host', () => {
  let answered = 0;
  for (const { path, set } of PAGES) {
    for (const method of METHODS) {
      for (const query of ['', '?from=p1&x=1']) {
        const url = PLAT + path + query;
        const r = route(url, { method });
        assert.ok(r, `${method} ${url}: the router answers`);
        if (path === '/') {
          assert.deepEqual(r, READS.has(method) ? { kind: 'world', origin: PLAT, head: 'platform' } : { kind: 'refused' }, `${method} ${url}`);
        } else if (path === '/mnet.html') {
          assert.deepEqual(r, { kind: 'moved', location: `${PLAT}/${query}` }, `${method} ${url}: the World's document name is the root`);
        } else if (set === 'profile_only') {
          assert.deepEqual(r, { kind: 'moved', location: PROF + path + query }, `${method} ${url}: only Matthew's host serves it`);
        } else if (!READS.has(method)) {
          assert.deepEqual(r, { kind: 'refused' }, `${method} ${url}: a page answers GET and HEAD`);
        } else {
          assert.equal(r.kind, 'pass', `${method} ${url}: served at its path`);
          assert.equal(r.path, path, `${url}: the same path`);
          assert.equal(r.noindex, false, `${url}: its canonical says where it lives; no noindex header`);
          assert.equal(r.framing, framingOf(path), `${url}: its framing class`);
        }
        answered += 1;
      }
    }
  }
  assert.ok(answered > 2000, `${answered} answers`);
  /* the deploy-promoted runtime (PRIM3 Site 0) and a directory without its slash ride the same way */
  assert.equal(route(`${PLAT}/site0/`).kind, 'pass');
  assert.equal(route(`${PLAT}/site0/index.html?level=1`).kind, 'pass');
  /* a directory without its slash: the router answers GitHub's slash itself, on this host (P1 review: an address is read
     the way the static origin reads it) */
  assert.deepEqual(route(`${PLAT}/engineering`), { kind: 'moved', location: `${PLAT}/engineering/` });
  assert.deepEqual(route(`${PLAT}/whip/`), { kind: 'moved', location: `${PROF}/whip/` });
  /* plain http is one hop to https on the platform, whatever the path */
  for (const { path } of PAGES.slice(0, 40)) assert.deepEqual(route(`http://mccluster.org${path}?q=1`), { kind: 'moved', location: `${PLAT}${path}?q=1` });
});

test('the HERE front door is /index.html on the platform; a World query on it still lands on the World at /', () => {
  const door = { kind: 'pass', path: '/index.html', noindex: false, framing: 'site' };
  for (const q of ['', '?album=here', '?front=house', '?track=1&t=Lightroom']) assert.deepEqual(route(`${PLAT}/index.html${q}`), door, `/index.html${q}`);
  for (const q of ['?view=feed', '?view=missions&mission=m1', '?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264&src=x', '?album=here&view=feed']) {
    assert.deepEqual(route(`${PLAT}/index.html${q}`), { kind: 'moved', location: `${PLAT}/${q}` }, `/index.html${q}`);
    for (const method of ['POST', 'DELETE']) assert.deepEqual(route(`${PLAT}/index.html${q}`, { method }), { kind: 'moved', location: `${PLAT}/${q}` });
  }
  for (const q of ['', '?view=feed', '?mission=m1']) assert.deepEqual(route(`${PLAT}/${q}`), { kind: 'world', origin: PLAT, head: 'platform' }, `/${q} is the World`);
});

test('the company\'s own pages, its news and its crawler files are still the platform\'s own; /company/ folds to /company', () => {
  for (const path of ['/company', '/robots.txt', '/sitemap.xml', '/llms.txt', '/news', '/news/', '/news/a-headline-123', '/news/feed.xml']) {
    assert.deepEqual(route(PLAT + path), { kind: 'own', origin: PLAT, host: 'platform' }, path);
  }
  assert.deepEqual(route(`${PLAT}/company/?ref=x`), { kind: 'moved', location: `${PLAT}/company?ref=x` });
});

test('the files on both hosts answer on the platform: the static files, embed.html for anyone, carry.html for the platform, sw.js and manifest.json', () => {
  for (const path of ['/js/tabbar.js', '/js/carry.js', '/css/style.css', '/assets/img/icon-192.png', '/data/albums.json', '/vendor/gsap.min.js',
    '/sw.js', '/manifest.json', '/.well-known/security.txt', '/.well-known/acme-challenge/token', '/tracks/i-am-here.mp3', '/favicon.ico']) {
    for (const method of ['GET', 'HEAD']) {
      const r = route(PLAT + path, { method });
      assert.equal(r.kind, 'pass', `${method} ${path}`);
      assert.equal(r.noindex, false, path);
    }
    assert.deepEqual(route(PLAT + path, { method: 'POST' }), { kind: 'refused' }, `POST ${path}`);
  }
  assert.equal(route(`${PLAT}/embed.html?album=here`).framing, 'anyone');
  assert.equal(route(`${PLAT}/carry.html`).framing, 'platform');
});

/* where the platform itself answers an address with a 301 (the World's other addresses, Whip and the owner-decision pages,
   the company page's slash, another spelling of a page), a door sends the visitor straight there: one hop (P1 review,
   P1A-3), as P0's www did */
const STRAIGHT = {
  '/index.html?view=feed': `${PLAT}/?view=feed`, '/mnet.html?mission=m1': `${PLAT}/?mission=m1`, '/company/': `${PLAT}/company`,
  '/whip.html': `${PROF}/whip.html`, '/whip/rider': `${PROF}/whip/rider/`, '/prayer-closet?x=1': `${PROF}/prayer-closet.html?x=1`,
  '/listen': `${PLAT}/listen.html`, '//album.html?album=here': `${PLAT}/album.html?album=here`, '/engineering': `${PLAT}/engineering/`
};
test('www.mccluster.org sends every path to the apex, path and query kept, any scheme and method, in one hop', () => {
  for (const scheme of ['https', 'http']) {
    for (const path of ['/', '/?view=feed', '/index.html', '/news/a-1', '/robots.txt', '/listen.html?track=1', '/album.html?album=here',
      '/matthew-mccluster.html', '/js/x.js', '/embed.html', '/carry.html', '/nope.html', ...Object.keys(STRAIGHT)]) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        assert.deepEqual(route(`${scheme}://www.mccluster.org${path}`, { method }), { kind: 'moved', location: STRAIGHT[path] || PLAT + path }, `${method} ${scheme} www${path}`);
      }
    }
  }
});

test('humanuprise.com and its www (inert until the owner routes them) send every path to the platform, path and query kept, in one hop', () => {
  const straight = { ...STRAIGHT, '/mnet.html?view=feed': `${PLAT}/?view=feed` };
  for (const origin of [HU, HUW, 'http://humanuprise.com', 'http://www.humanuprise.com']) {
    for (const path of ['/', '/?view=missions', '/robots.txt', '/sitemap.xml', '/account.html', '/listen.html?track=1', '/js/mnet.js', ...Object.keys(straight)]) {
      for (const method of ['GET', 'POST']) assert.deepEqual(route(origin + path, { method }), { kind: 'moved', location: straight[path] || PLAT + path }, `${method} ${origin}${path}`);
    }
  }
});

test('Matthew\'s host is unchanged: not routed, so whatever reached the Worker would go to GitHub Pages untouched', () => {
  for (const path of ['/', '/?view=feed', '/index.html', '/listen.html', '/account.html', '/whip.html', '/js/tabbar.js', '/manifest.json', '/sw.js', '/carry.html', '/nope.html', '/robots.txt']) {
    for (const method of METHODS) assert.deepEqual(route(PROF + path, { method }), { kind: 'origin', classes: false }, `${method} ${PROF}${path}`);
  }
  for (const u of ['https://api.mccluster.org/v1/health', 'https://here.mccluster.org/listen.html', 'https://equityuprise.com/', 'https://mccluster.org.evil.example/']) {
    assert.equal(route(u), null, `${u} is not the router's`);
  }
});

test('no page the platform serves sends the visitor to a document on Matthew\'s host, but Whip and the owner-decision pages', () => {
  const profileOnly = new Set(record.url_ownership.profile_only);
  for (const { path } of PAGES) {
    for (const q of ['', '?view=feed', '?album=here']) {
      let url = new URL(PLAT + path + q);
      for (let hop = 0; hop < 3; hop += 1) {
        const r = route(url.href);
        if (!r || r.kind !== 'moved') break;
        url = new URL(r.location);
      }
      if (url.origin === PROF) assert.ok(profileOnly.has(path), `${path}${q} lands on Matthew's host (${url.href})`);
      else assert.equal(url.origin, PLAT, `${path}${q} stays on the platform`);
    }
  }
});

/* ---------- P1 review (P1A-1, SEC-P1-2, P1A-2): another spelling of an address is that address ----------
   GitHub Pages answers a page at more addresses than its name: the name without .html, behind a doubled slash, with a
   letter or its dot escaped, a directory without its slash (Measured live on 2026-11-24: /whip, //whip.html,
   /whip%2Ehtml, /%77hip.html, /whip/rider/operator, /fbi, /prayer-closet, /closet/sent all answer 200 with the page).
   The router reads an address the same way before it classifies it: Whip Equipped and the owner-decision pages never
   open on the platform at any spelling, the World's other spellings land on its root, and another spelling of any other
   page answers 301 to that page on the platform, all in one hop. */
function spellings(page) {
  const out = ['/' + page, page.replace(/\//g, '//'), '/x/..%2F' + page.slice(1), '/%' + page.charCodeAt(1).toString(16).toUpperCase() + page.slice(2)];
  if (page.endsWith('.html')) out.push(page.slice(0, -5), page.slice(0, -5) + '%2Ehtml', page.slice(0, -5) + '%2ehtml', page.replace(/\//g, '%2F').replace(/^%2F/, '/'));
  else out.push(page.slice(0, -1), page + 'index', '/' + page + 'index.html');
  return out;
}
test('Whip Equipped and the owner-decision pages answer 301 to Matthew\'s host at every spelling of their address, never served here', () => {
  let asked = 0;
  for (const page of record.url_ownership.profile_only) {
    for (const spelled of spellings(page)) {
      for (const q of ['', '?from=qr']) {
        const r = route(PLAT + spelled + q);
        assert.equal(r && r.kind, 'moved', `${spelled}${q}: ${JSON.stringify(r)}`);
        const at = new URL(r.location);
        assert.equal(at.origin, PROF, `${spelled}${q} goes to Matthew's host (${r.location})`);
        assert.equal(at.search, q, `${spelled}${q}: the query kept`);
        assert.equal(SITE.pageSet(at.pathname), 'profile_only', `${spelled}${q}: to the page itself (${at.pathname})`);
        /* and in that one hop: his host serves the address it names */
        assert.equal(route(PROF + at.pathname).kind, 'origin');
        asked += 1;
      }
    }
  }
  assert.ok(asked >= 200, `${asked} spellings`);
  /* exactly where: the page's own address */
  for (const [spelled, page] of [['/whip', '/whip.html'], ['//whip.html', '/whip.html'], ['/whip%2Ehtml', '/whip.html'], ['/%77hip.html', '/whip.html'],
    ['/whip/rider/operator', '/whip/rider/operator.html'], ['/whip/rider', '/whip/rider/'], ['/whip/driver/index', '/whip/driver/index.html'],
    ['/fbi', '/fbi.html'], ['/%66bi.html', '/fbi.html'], ['/inner-room', '/inner-room.html'], ['/prayer-closet', '/prayer-closet.html'], ['/merch', '/merch.html'],
    ['/we-manufacture', '/we-manufacture.html'], ['/closet/sent', '/closet/sent.html'], ['/closet/commission', '/closet/commission.html'],
    ['/whip%2Frider%2Foperator.html', '/whip/rider/operator.html'], ['/js/..%2Fwhip.html', '/whip.html']]) {
    assert.deepEqual(route(PLAT + spelled + '?x=1'), { kind: 'moved', location: `${PROF}${page}?x=1` }, spelled);
  }
  /* everything under Whip Equipped's directories is his host's: its apps' scripts, manifests and images */
  for (const path of ['/whip/driver/app.js', '/whip/rider/manifest.webmanifest', '/whip/assets/hero.svg', '//whip/driver/sw.js', '/whip%2Frentals%2Fapp.js']) {
    const r = route(PLAT + path);
    assert.equal(r.kind, 'moved', path);
    assert.equal(new URL(r.location).origin, PROF, path);
    assert.match(new URL(r.location).pathname, /^\/whip\//, path);
  }
});

test('the World\'s other spellings land on the World\'s root, query kept, in one hop', () => {
  for (const spelled of ['/mnet', '//mnet.html', '/mnet%2Ehtml', '/%6Dnet.html', '/x/..%2Fmnet.html', '/index', '//index.html', '/%69ndex.html', '/index%2Ehtml']) {
    for (const q of ['?view=feed', '?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264&src=x', '?view=missions&mission=m1']) {
      assert.deepEqual(route(PLAT + spelled + q), { kind: 'moved', location: `${PLAT}/${q}` }, spelled + q);
      for (const method of ['HEAD', 'POST']) assert.deepEqual(route(PLAT + spelled + q, { method }), { kind: 'moved', location: `${PLAT}/${q}` });
    }
  }
  /* the World's document name without a World query is the World too; the old root name without one is the HERE front door */
  for (const spelled of ['/mnet', '//mnet.html', '/%6Dnet.html']) assert.deepEqual(route(PLAT + spelled), { kind: 'moved', location: `${PLAT}/` }, spelled);
  for (const spelled of ['/index', '//index.html', '/%69ndex.html']) assert.deepEqual(route(PLAT + spelled + '?album=here'), { kind: 'moved', location: `${PLAT}/index.html?album=here` }, spelled);
  assert.deepEqual(route(`${PLAT}//?view=feed`), { kind: 'moved', location: `${PLAT}/?view=feed` });
});

test('another spelling of any other page answers 301 to that page on the platform, query kept; its exact address is served', () => {
  for (const [spelled, page] of [['/listen', '/listen.html'], ['//listen.html', '/listen.html'], ['/%6Cisten.html', '/listen.html'], ['/listen%2Ehtml', '/listen.html'],
    ['/album', '/album.html'], ['/engineering', '/engineering/'], ['/engineering/index', '/engineering/index.html'], ['//engineering/', '/engineering/'],
    ['/walls', '/walls.html'], ['/action/league', '/action/league.html'], ['/demos/shiloh', '/demos/shiloh/'], ['/site0', '/site0/'],
    ['/js//tabbar.js', '/js/tabbar.js'], ['//company', '/company'], ['/embed', '/embed.html'], ['/carry', '/carry.html']]) {
    assert.deepEqual(route(PLAT + spelled + '?a=1'), { kind: 'moved', location: `${PLAT}${page}?a=1` }, spelled);
    assert.notEqual(route(PLAT + page).kind, 'moved', `${page} itself is answered where it is`);
  }
});

test('a path the table does not name is passed through only as long as the static origin answers it with no document', async () => {
  for (const path of ['/nope.html', '/nope', '/favicon.ico', '/feed.xml', '/whip%2.html', '/Whip.html', '/whip.html/', '/WHIP']) {
    assert.deepEqual(route(PLAT + path), { kind: 'pass', path, noindex: false, framing: 'site', unnamed: true }, path);
  }
  const seen = [];
  const origin = (status, type) => async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    seen.push({ url: req.url, inm: req.headers.get('if-none-match'), ims: req.headers.get('if-modified-since') });
    return new Response(req.method === 'HEAD' ? null : (/html/.test(type) ? '<!doctype html><title>a page</title>' : 'x'), { status, headers: { 'content-type': type, etag: '"e"' } });
  };
  /* a 404 stays a 404 here, with the site's 404 page */
  let r = await router(new Request(`${PLAT}/nope.html?x=1`), {}, origin(404, 'text/html; charset=utf-8'));
  assert.equal(r.status, 404);
  /* a file is passed through */
  r = await router(new Request(`${PLAT}/favicon.ico`), {}, origin(200, 'image/x-icon'));
  assert.equal(r.status, 200);
  r = await router(new Request(`${PLAT}/feed.xml`), {}, origin(200, 'application/rss+xml'));
  assert.equal(r.status, 200);
  /* a document the router could not name (a spelling GitHub reads and the router does not) is never served here: Matthew's
     host answers it, as before P1; it is asked for whole, never revalidated */
  for (const method of ['GET', 'HEAD']) {
    seen.length = 0;
    r = await router(new Request(`${PLAT}/whip.html;jsessionid=1?q=2`, { method, headers: { 'if-none-match': '"old"', 'if-modified-since': 'Fri, 20 Nov 2026 22:29:26 GMT' } }), {}, origin(200, 'text/html; charset=utf-8'));
    assert.deepEqual([r.status, r.headers.get('location')], [301, `${PROF}/whip.html;jsessionid=1?q=2`], method);
    assert.deepEqual(seen, [{ url: `${PROF}/whip.html;jsessionid=1?q=2`, inm: null, ims: null }], `${method}: asked whole`);
  }
  /* a page the table names keeps its validators */
  seen.length = 0;
  await router(new Request(`${PLAT}/listen.html`, { headers: { 'if-none-match': '"old"' } }), {}, origin(200, 'text/html; charset=utf-8'));
  assert.equal(seen[0].inm, '"old"');
});

/* ---------- P1 review (P1A-5): the documents the platform passes through are kept at the edge for 60 s ---------- */
test('documents the table names are cached at the edge for 60 s (the carry page aside); files keep the static origin\'s caching', async () => {
  const MNET = await readFile(new URL('../../../mnet.html', import.meta.url), 'utf8');
  const calls = [];
  const origin = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push({ path: new URL(req.url).pathname, cf: init && init.cf ? { ...init.cf } : null });
    const html = new URL(req.url).pathname === '/mnet.html' ? MNET : '<!doctype html><title>x</title>';
    return new Response(req.method === 'HEAD' ? null : html, { status: 200, headers: { 'content-type': /\.(html|\/)$/.test(req.url) || req.url.endsWith('/') ? 'text/html; charset=utf-8' : 'application/javascript' } });
  };
  const cached = { cacheTtl: 60, cacheEverything: true };
  for (const [path, want] of [['/listen.html', cached], ['/index.html', cached], ['/engineering/', cached], ['/account.html?x=1', cached], ['/embed.html', cached],
    ['/carry.html', null], ['/js/tabbar.js', null], ['/manifest.json', null], ['/sw.js', null], ['/nope.html', null]]) {
    calls.length = 0;
    await router(new Request(PLAT + path), {}, origin);
    assert.deepEqual(calls.at(-1).cf, want, path);
  }
  /* the World: its document is kept a minute, and its head is written after, per answer, so it is always the platform's */
  for (const q of ['', '?view=feed']) {
    calls.length = 0;
    const r = await router(new Request(`${PLAT}/${q}`), {}, origin);
    assert.deepEqual(calls.at(-1), { path: '/mnet.html', cf: cached }, `/${q}`);
    const html = await r.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/mccluster\.org\/">/, `/${q}: the platform's head on the cached body`);
    assert.match(html, /<meta property="og:site_name" content="McCluster Corp">/);
  }
});

/* GitHub Pages as the Worker reaches it, for the answers that read a body */
const MANIFEST = JSON.parse(await readFile(new URL('../../../manifest.json', import.meta.url), 'utf8'));
function github(asked = []) {
  return async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    const u = new URL(req.url);
    asked.push({ url: req.url, redirect: req.redirect });
    if (u.pathname === '/manifest.json') return new Response(req.method === 'HEAD' ? null : JSON.stringify(MANIFEST), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: '"gh-manifest"', 'cache-control': 'max-age=600' } });
    if (u.pathname === '/index.html') return new Response(req.method === 'HEAD' ? null : '<!doctype html><html><head><title>HERE</title><link rel="canonical" href="https://matthew.mccluster.org/"></head><body>HERE</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (/\.html$/.test(u.pathname)) return new Response(req.method === 'HEAD' ? null : `<!doctype html><title>${u.pathname}</title>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response(null, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}

test('the platform\'s manifest.json starts the app added from mccluster.org on the World; names Equity Quantized, keeps its other members, and Matthew\'s copy is his', async () => {
  assert.equal(SITE.platform.app_start_path, record.platform.app_start_path, 'the table carries the record\'s app start');
  assert.equal(record.platform.app_start_path, '/', 'the owner\'s default of 2026-11-23 (owner_decisions.platform_app_start): the World');
  assert.match(record.owner_decisions.platform_app_start.decision, /^On the World\./);
  const asked = [];
  const r = await router(new Request(`${PLAT}/manifest.json`), {}, github(asked));
  assert.equal(r.status, 200);
  assert.equal(asked.at(-1).url, `${PROF}/manifest.json`, 'fetched from the static origin');
  assert.equal(asked.at(-1).redirect, 'manual');
  assert.match(r.headers.get('content-type'), /json/);
  assert.equal(r.headers.get('etag'), null, 'the body changed, so the upstream validator does not describe it');
  const body = await r.json();
  assert.equal(body.start_url, '/', 'the World, the platform\'s root');
  assert.equal(body.name, 'Equity Quantized');
  assert.equal(body.short_name, 'Equity Quantized');
  assert.match(body.description, /verified action/);
  assert.deepEqual({ ...body, start_url: MANIFEST.start_url, name: MANIFEST.name, short_name: MANIFEST.short_name, description: MANIFEST.description }, MANIFEST, 'every other member as published');
  assert.equal(MANIFEST.start_url, './index.html', 'the file itself, which Matthew\'s host serves, still opens his HERE page');
  const head = await router(new Request(`${PLAT}/manifest.json`, { method: 'HEAD' }), {}, github());
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  /* a manifest the static origin does not answer with 200 JSON is handed on as it came */
  const gone = await router(new Request(`${PLAT}/manifest.json`), {}, async () => new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } }));
  assert.equal(gone.status, 404);
  const odd = await router(new Request(`${PLAT}/manifest.json`), {}, async () => new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.equal(odd.status, 200);
  assert.equal(await odd.text(), '{not json', 'a body that is not a manifest is never rewritten');
});

test('the front door and a moved page come through with the file\'s own head and the site\'s headers, and no noindex', async () => {
  for (const path of ['/index.html', '/listen.html', '/account.html', '/matthew-mccluster.html']) {
    const r = await router(new Request(PLAT + path), {}, github());
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('x-robots-tag'), null, `${path}: no noindex header`);
    assert.equal(r.headers.get('content-security-policy'), `frame-ancestors ${SITE.frame_ancestors.join(' ')}`, path);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', path);
  }
  const door = await (await router(new Request(`${PLAT}/index.html`), {}, github())).text();
  assert.match(door, /<link rel="canonical" href="https:\/\/matthew\.mccluster\.org\/">/, 'its canonical is the file\'s own until P2');
});

test('a checkout return that names no site origin lands on the platform at P1; one started on either host comes back to it', async () => {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', STRIPE_SECRET_KEY: 'sk_test_fixture', CREATOR_STARTER_MONTHLY_PRICE_ID: 'price_fixture1' };
  const realFetch = globalThis.fetch;
  try {
    for (const [headers, want] of [[{}, PLAT], [{ origin: PLAT }, PLAT], [{ origin: PROF }, PROF], [{ origin: 'https://evil.example' }, PLAT], [{ origin: WWW }, PLAT]]) {
      const calls = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        calls.push({ url, body: init.body || null });
        if (url === 'https://db.test/auth/v1/user') return new Response(JSON.stringify({ id: 'user-1', email: 'buyer@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
        throw new Error(`unexpected ${url}`);
      };
      const r = await handleCreatorCheckout(new Request('https://api.mccluster.org/v1/creator-billing/checkout', {
        method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ plan: 'starter', period: 'monthly' })
      }), env);
      assert.equal(r.status, 200);
      const sent = new URLSearchParams(calls.find((c) => c.url.includes('checkout/sessions')).body);
      assert.equal(new URL(sent.get('success_url')).origin, want, JSON.stringify(headers));
      assert.equal(new URL(sent.get('cancel_url')).origin, want, JSON.stringify(headers));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
