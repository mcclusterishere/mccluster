/* THE HOST ROUTER (SPEC-PLATFORM 2.4): one table, every host, every path class, every stage.

   workers/mccluster/src/platform/router.js reads the generated table (src/platform/hosts.generated.js, from
   data/seo/domain-architecture.json) and decides, per host and path, what Worker mccluster answers. With P0's table it
   must answer exactly what was measured on 2026-11-23 (test/fixtures/platform-hosts-probe-20261123.json, from the
   SPEC-PLATFORM probe record: GET and HEAD only), so a rollback to P0 restores exactly that. The table that ships is P1's
   (the generated SITE; test/platform-p1.test.mjs holds it to every published page). The other stages' tables are built
   here by tools/build-site-hosts.mjs from the same record: P0, P1, P3 (Matthew's host routed to the Worker answers 301s
   for the pages that moved) and stage F (the equityuprise rewrite: platform.origin https://equityuprise.com,
   mccluster.org McCluster Corp's tenant). Nothing here reaches the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, makeSite } from '../src/platform/hosts.generated.js';
import { siteTable, readRecord } from '../../../tools/build-site-hosts.mjs';
import { routeFor, createSiteRouter } from '../src/platform/router.js';
import { COMPANY_PARTS, WORLD_HEAD, worldHeadOf } from '../src/company-site/router.js';
import { WORLD_DOOR_PARTS } from '../src/human-uprise/router.js';
import { SECURITY, WORLD_CSP_REPORT_ONLY } from '../src/world-host.js';

const PLAT = 'https://mccluster.org';
const WWW = 'https://www.mccluster.org';
const PROF = 'https://matthew.mccluster.org';
const HU = 'https://humanuprise.com';
const HUW = 'https://www.humanuprise.com';
const EQ = 'https://equityuprise.com';

const record = readRecord();
const tableOf = (stage, rec = record) => makeSite(siteTable(rec, { stage }));
/* P0's table, rebuilt from the record: what shipped before P1 and what a rollback to P0 (edge.now back to P0) restores.
   The generated SITE is the stage that ships (P1, test/platform-p1.test.mjs). */
const P0 = tableOf('P0');
const P1 = tableOf('P1');
const P3 = tableOf('P3');

/* the equityuprise rewrite, as scripts/test/site-hosts.test.mjs builds it (SPEC-PLATFORM 2.3 and 2.10) */
function rewritten() {
  const F = JSON.parse(JSON.stringify(record));
  F.platform.origin = EQ;
  F.platform.website_id = `${EQ}/#website`;
  F.platform.site_name = 'Equity Uprise';
  F.platform.own_paths = { generated: ['/robots.txt', '/sitemap.xml', '/llms.txt'], subtrees: [] };
  F.tenants.company = { host: 'mccluster.org', entity: record.entities.mccluster_corp.id, website_id: `${PLAT}/#website`, site_name: 'McCluster Corp', root: '/company', sets: [], own_paths: { generated: ['/company'], subtrees: ['/news'] } };
  F.doors = {
    'www.equityuprise.com': { to: 'platform', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'www.mccluster.org': { to: 'tenants.company', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'humanuprise.com': record.doors['humanuprise.com'],
    'www.humanuprise.com': record.doors['www.humanuprise.com'],
    'here.mccluster.org': record.doors['here.mccluster.org']
  };
  return F;
}
const F_RECORD = rewritten();
const F0 = tableOf('P0', F_RECORD);
const F1 = tableOf('P1', F_RECORD);
const F3 = tableOf('P3', F_RECORD);

const route = (site, url, init = {}) => routeFor(site, new URL(url), { doorFiles: WORLD_DOOR_PARTS.paths, ...init });
const moved = (location) => ({ kind: 'moved', location });
/* compare only the fields an expectation names */
function check(site, url, want, init = {}) {
  const got = route(site, url, init);
  if (want === null) return assert.equal(got, null, `${site.stage} ${url}: not this Worker's host`);
  assert.ok(got, `${site.stage} ${url}: the router answers`);
  const seen = Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]));
  assert.deepEqual(seen, want, `${site.stage} ${init.method || 'GET'} ${url}`);
}

/* ---------- P0: as measured on 2026-11-23, exactly ---------- */

test('P0 platform host: the World at /, its rooms and files passed through, the company\'s own pages, every other path 301 to the same path on Matthew\'s host', () => {
  const world = { kind: 'world', origin: PLAT, head: 'platform' };
  const room = { kind: 'pass', noindex: true };
  const file = { kind: 'pass', noindex: false };
  const own = { kind: 'own', origin: PLAT };
  for (const [path, want] of [
    ['/', world], ['/?view=feed', world], ['/?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264', world],
    ['/index.html', moved(`${PLAT}/`)], ['/index.html?view=feed', moved(`${PLAT}/?view=feed`)],
    ['/index.html?album=here', moved(`${PLAT}/?album=here`)],
    ['/mnet.html', moved(`${PLAT}/`)], ['/mnet.html?view=missions&mission=m1', moved(`${PLAT}/?view=missions&mission=m1`)],
    ['/company', own], ['/robots.txt', own], ['/sitemap.xml', own], ['/llms.txt', own],
    ['/news', own], ['/news/', own], ['/news/a-headline-123', own], ['/news/feed.xml', own],
    ['/company/', moved(`${PLAT}/company`)], ['/company/?ref=x', moved(`${PLAT}/company?ref=x`)],
    ['/account.html', room], ['/login.html', room], ['/privacy.html', room], ['/action-globe.html?embedded=1', room],
    ['/action/', room], ['/action/index.html', room], ['/auth/?next=%2F', room], ['/action-network-hire.html', room],
    ['/js/tabbar.js?v=1', file], ['/css/mnet.css', file], ['/assets/img/m-mark.png', file], ['/data/albums.json', file],
    ['/vendor/x.js', file], ['/sw.js', file],
    ['/manifest.json', moved(`${PROF}/manifest.json`)], ['/embed.html?album=here', moved(`${PROF}/embed.html?album=here`)],
    ['/carry.html', moved(`${PROF}/carry.html`)], ['/.well-known/acme-challenge/x', moved(`${PROF}/.well-known/acme-challenge/x`)],
    ['/.well-known/security.txt', moved(`${PROF}/.well-known/security.txt`)],
    ['/listen.html?track=1', moved(`${PROF}/listen.html?track=1`)], ['/album.html?album=here', moved(`${PROF}/album.html?album=here`)],
    ['/music-creator.html?handle=fixture-ana', moved(`${PROF}/music-creator.html?handle=fixture-ana`)],
    ['/matthew-mccluster.html', moved(`${PROF}/matthew-mccluster.html`)], ['/engineering/', moved(`${PROF}/engineering/`)],
    ['/engineering', moved(`${PROF}/engineering`)], ['/engineering/mccluster-platform.html', moved(`${PROF}/engineering/mccluster-platform.html`)],
    ['/whip.html', moved(`${PROF}/whip.html`)], ['/whip/driver/?a=1', moved(`${PROF}/whip/driver/?a=1`)],
    ['/docket-516.html', moved(`${PROF}/docket-516.html`)], ['/control.html', moved(`${PROF}/control.html`)],
    ['/nope.html', moved(`${PROF}/nope.html`)], ['/favicon.ico', moved(`${PROF}/favicon.ico`)], ['/tracks/i-am-here.mp3', moved(`${PROF}/tracks/i-am-here.mp3`)],
    ['//evil.example/x', moved(`${PROF}//evil.example/x`)]
  ]) check(P0, PLAT + path, want);
  /* plain http is one hop to https on the apex, whatever the path */
  for (const path of ['/', '/company', '/?view=feed', '/docket-516.html']) check(P0, `http://mccluster.org${path}`, moved(PLAT + path));
});

test('P0 methods: the World, its rooms and files answer GET and HEAD only; a 301 answers every method; the company\'s pages decide their own', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    for (const path of ['/', '/?view=feed', '/account.html', '/js/tabbar.js', '/sw.js']) check(P0, PLAT + path, { kind: 'refused' }, { method });
    check(P0, `${PLAT}/listen.html`, moved(`${PROF}/listen.html`), { method });
    check(P0, `${PLAT}/mnet.html?view=feed`, moved(`${PLAT}/?view=feed`), { method });
    check(P0, `${PLAT}/company`, { kind: 'own' }, { method });
    check(P0, `${HU}/`, { kind: 'refused' }, { method });
    check(P0, `${HU}/robots.txt`, { kind: 'door-file' }, { method });
  }
  for (const method of ['GET', 'HEAD']) check(P0, `${PLAT}/account.html`, { kind: 'pass' }, { method });
});

test('P0 www: what the apex serves goes to the apex, everything else straight to Matthew\'s host, query kept, any scheme', () => {
  for (const scheme of ['https', 'http']) {
    const at = (p) => `${scheme}://www.mccluster.org${p}`;
    for (const [path, to] of [
      ['/', `${PLAT}/`], ['/?view=feed', `${PLAT}/?view=feed`], ['/index.html', `${PLAT}/`], ['/index.html?view=feed', `${PLAT}/?view=feed`],
      ['/mnet.html?mission=m1', `${PLAT}/mnet.html?mission=m1`], ['/company', `${PLAT}/company`], ['/company/', `${PLAT}/company`],
      ['/news/', `${PLAT}/news/`], ['/robots.txt', `${PLAT}/robots.txt`], ['/sitemap.xml', `${PLAT}/sitemap.xml`], ['/llms.txt', `${PLAT}/llms.txt`],
      ['/account.html', `${PLAT}/account.html`], ['/action/', `${PLAT}/action/`], ['/js/mnet.js', `${PLAT}/js/mnet.js`], ['/sw.js', `${PLAT}/sw.js`],
      ['/hire.html', `${PROF}/hire.html`], ['/listen.html?track=1', `${PROF}/listen.html?track=1`], ['/manifest.json', `${PROF}/manifest.json`],
      ['/embed.html', `${PROF}/embed.html`], ['/whip.html', `${PROF}/whip.html`], ['/.well-known/security.txt', `${PROF}/.well-known/security.txt`]
    ]) check(P0, at(path), moved(to));
  }
});

test('P0 humanuprise.com (inert until routed): the World by host with its own head, its rooms, its own robots and sitemap, every other path to Matthew\'s host; www to the apex', () => {
  const world = { kind: 'world', origin: HU, head: 'door' };
  for (const [path, want] of [
    ['/', world], ['/?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264', world],
    ['/mnet.html?view=missions', moved(`${HU}/?view=missions`)], ['/robots.txt', { kind: 'door-file', origin: HU }], ['/sitemap.xml', { kind: 'door-file', origin: HU }],
    ['/account.html', { kind: 'pass', noindex: true }], ['/action/?c=end-racism', { kind: 'pass', noindex: true }], ['/action-network-cohorts.html', { kind: 'pass', noindex: true }],
    ['/js/mnet.js?v=1', { kind: 'pass', noindex: false }], ['/sw.js', { kind: 'pass', noindex: false }],
    ['/index.html', moved(`${PROF}/index.html`)], ['/listen.html', moved(`${PROF}/listen.html`)], ['/creator.html', moved(`${PROF}/creator.html`)],
    ['/receipt.html?session=cs_1', moved(`${PROF}/receipt.html?session=cs_1`)], ['/tracks/i-am-here.mp3', moved(`${PROF}/tracks/i-am-here.mp3`)],
    ['/whip.html', moved(`${PROF}/whip.html`)], ['/llms.txt', moved(`${PROF}/llms.txt`)], ['/company', moved(`${PROF}/company`)]
  ]) check(P0, HU + path, want);
  check(P0, 'http://humanuprise.com/?view=missions', moved(`${HU}/?view=missions`));
  for (const u of [`${HUW}/?view=missions`, `${HUW}/album.html`, 'http://www.humanuprise.com/account.html']) {
    const p = new URL(u);
    check(P0, u, moved(HU + p.pathname + p.search));
  }
});

test('P0 Matthew\'s host is not routed: if a request for it ever reached the Worker, GitHub\'s answer passes untouched; every other host is not the router\'s', () => {
  for (const path of ['/', '/?view=feed', '/index.html', '/listen.html', '/account.html', '/whip.html', '/js/tabbar.js', '/nope.html', '/robots.txt']) {
    for (const method of ['GET', 'HEAD', 'POST']) check(P0, PROF + path, { kind: 'origin', classes: false }, { method });
  }
  for (const u of ['https://api.mccluster.org/v1/health', 'https://here.mccluster.org/listen.html', 'https://mcp.mccluster.org/', 'https://example.org/',
    'https://mccluster.org.evil.example/', 'https://evil-mccluster.org/', 'https://evilmccluster.org/', 'https://humanuprise.com.evil.example/', `${EQ}/`]) check(P0, u, null);
});

/* ---------- P1 and P3: the tables that exist only in tests ---------- */

test('P1 platform host: every page at its path (the HERE front door at /index.html), profile_only 301 to Matthew\'s host, World queries on /index.html 301 to the World', () => {
  assert.equal(P1.switches.platform_serves, 'everything');
  const page = { kind: 'pass', noindex: false, framing: 'site' };
  for (const [path, want] of [
    ['/', { kind: 'world', origin: PLAT }], ['/?view=feed', { kind: 'world' }],
    ['/index.html', page], ['/index.html?album=here', page],
    ['/index.html?view=feed', moved(`${PLAT}/?view=feed`)], ['/index.html?mission=m1&src=x', moved(`${PLAT}/?mission=m1&src=x`)],
    ['/mnet.html?view=feed', moved(`${PLAT}/?view=feed`)],
    ['/company', { kind: 'own' }], ['/company/', moved(`${PLAT}/company`)], ['/news/', { kind: 'own' }], ['/robots.txt', { kind: 'own' }],
    ['/account.html', page], ['/listen.html?track=1', page], ['/album.html?album=here', page], ['/music-creator.html?handle=x', page],
    ['/matthew-mccluster.html', page], ['/engineering/', page], ['/engineering', page], ['/control.html', page], ['/nope.html', page],
    ['/js/tabbar.js', { kind: 'pass', noindex: false }], ['/manifest.json', { kind: 'pass' }], ['/sw.js', { kind: 'pass' }],
    ['/embed.html?album=here', { kind: 'pass', framing: 'anyone' }], ['/carry.html', { kind: 'pass', framing: 'platform' }],
    ['/.well-known/acme-challenge/x', { kind: 'pass' }],
    ['/whip.html', moved(`${PROF}/whip.html`)], ['/whip/driver/?a=1', moved(`${PROF}/whip/driver/?a=1`)], ['/prayer-closet.html', moved(`${PROF}/prayer-closet.html`)]
  ]) check(P1, PLAT + path, want);
  check(P1, 'http://mccluster.org/listen.html', moved(`${PLAT}/listen.html`));
  check(P1, `${PLAT}/listen.html`, { kind: 'refused' }, { method: 'POST' });
});

test('P1 doors: www, humanuprise.com and its www answer 301 to the platform, same path and query, every path', () => {
  for (const origin of [WWW, HU, HUW, 'http://www.mccluster.org', 'http://humanuprise.com']) {
    for (const path of ['/', '/?view=feed', '/index.html', '/company/', '/listen.html?track=1', '/robots.txt', '/whip.html', '/js/x.js']) {
      check(P1, origin + path, moved(PLAT + path));
    }
  }
  check(P1, `${PROF}/listen.html`, { kind: 'origin', classes: false }, {});
});

test('P3 Matthew\'s host routed: his pages, Whip and the files pass to GitHub; the pages that moved and World queries 301 to the platform; a 404 stays a 404', () => {
  assert.equal(P3.switches.profile_host_routed, true);
  const his = { kind: 'origin', classes: true };
  for (const [path, want] of [
    ['/', his], ['/?album=here', his], ['/index.html', his],
    ['/?view=feed', moved(`${PLAT}/?view=feed`)], ['/?mission=m1', moved(`${PLAT}/?mission=m1`)], ['/index.html?view=feed', moved(`${PLAT}/?view=feed`)],
    ['/mnet.html', moved(`${PLAT}/`)], ['/mnet.html?view=missions&mission=m1', moved(`${PLAT}/?view=missions&mission=m1`)],
    ['/matthew-mccluster.html', his], ['/resume-it-support.html', his], ['/engineering/', his], ['/engineering/mccluster-platform.html', his],
    ['/portfolio.html', his], ['/card.html', his], ['/press.html', his], ['/films.html', his], ['/newsroom.html', his],
    ['/whip.html', his], ['/whip/driver/?a=1', his], ['/prayer-closet.html', his],
    ['/listen.html?track=1', moved(`${PLAT}/listen.html?track=1`)], ['/album.html?album=here', moved(`${PLAT}/album.html?album=here`)],
    ['/account.html', moved(`${PLAT}/account.html`)], ['/action/', moved(`${PLAT}/action/`)], ['/control.html', moved(`${PLAT}/control.html`)],
    ['/js/tabbar.js', his], ['/sw.js', his], ['/manifest.json', his], ['/embed.html?album=here', his], ['/carry.html', his],
    ['/.well-known/acme-challenge/token', his], ['/robots.txt', his], ['/sitemap.xml', his], ['/llms.txt', his],
    ['/company', his], ['/news/', his], ['/nope.html', his], ['/favicon.ico', his], ['/engineering', his]
  ]) check(P3, PROF + path, want);
  /* the platform fetching its static files from another zone (stage F) announces itself: those requests are never redirected */
  check(P3, `${PROF}/listen.html`, { kind: 'origin', classes: false }, { headers: new Headers({ 'cf-worker': 'mccluster.org' }) });
  check(P3, `${PROF}/listen.html`, moved(`${PLAT}/listen.html`), { headers: new Headers({ 'cf-worker': 'evil.example' }) });
  /* the platform and the doors answer as in P1 */
  check(P3, `${PLAT}/listen.html`, { kind: 'pass' });
  check(P3, `${HU}/listen.html`, moved(`${PLAT}/listen.html`));
});

/* ---------- stage F: the equityuprise rewrite through the router ---------- */

test('the equityuprise rewrite: the new platform serves the World and every page, mccluster.org keeps the company page and its news, every old address lands', () => {
  for (const site of [F1, F3]) {
    const own = { kind: 'own', origin: EQ };
    for (const [path, want] of [
      ['/', { kind: 'world', origin: EQ, head: 'platform' }], ['/listen.html', { kind: 'pass' }], ['/index.html', { kind: 'pass' }],
      ['/index.html?view=feed', moved(`${EQ}/?view=feed`)], ['/mnet.html', moved(`${EQ}/`)], ['/robots.txt', own],
      ['/whip.html', moved(`${PROF}/whip.html`)], ['/company', moved(`${PLAT}/company`)], ['/company/', moved(`${PLAT}/company`)],
      ['/news/a-headline-123', moved(`${PLAT}/news/a-headline-123`)]
    ]) check(site, EQ + path, want);
    check(site, `${EQ}/listen.html`.replace('https:', 'http:'), moved(`${EQ}/listen.html`));
    for (const [path, want] of [
      ['/company', { kind: 'own', origin: PLAT }], ['/news/', { kind: 'own', origin: PLAT }], ['/company/', moved(`${PLAT}/company`)],
      ['/', moved(`${EQ}/`)], ['/?view=feed', moved(`${EQ}/?view=feed`)], ['/mnet.html?mission=m1', moved(`${EQ}/?mission=m1`)],
      ['/listen.html?track=1', moved(`${EQ}/listen.html?track=1`)], ['/account.html', moved(`${EQ}/account.html`)],
      ['/matthew-mccluster.html', moved(`${EQ}/matthew-mccluster.html`)], ['/whip.html', moved(`${PROF}/whip.html`)],
      ['/js/tabbar.js', { kind: 'pass' }], ['/assets/img/m-mark.png', { kind: 'pass' }], ['/embed.html', { kind: 'pass', framing: 'anyone' }]
    ]) check(site, PLAT + path, want);
    check(site, 'http://mccluster.org/company', moved(`${PLAT}/company`));
    for (const path of ['/', '/company/', '/listen.html']) check(site, WWW + path, moved(PLAT + path));
    for (const path of ['/', '/listen.html?track=1']) check(site, `https://www.equityuprise.com${path}`, moved(EQ + path));
    for (const path of ['/', '/listen.html']) check(site, HU + path, moved(EQ + path));
    check(site, 'https://here.mccluster.org/x', null);
  }
  check(F1, `${PROF}/listen.html`, { kind: 'origin', classes: false });
  check(F3, `${PROF}/listen.html`, moved(`${EQ}/listen.html`));
  check(F3, `${PROF}/listen.html`, { kind: 'origin', classes: false }, { headers: new Headers({ 'cf-worker': 'equityuprise.com' }) });
  check(F3, `${PROF}/matthew-mccluster.html`, { kind: 'origin', classes: true });
});

/* ---------- no loops, short chains ---------- */

const LOOP_PATHS = ['/', '/?view=feed', '/index.html', '/index.html?view=feed', '/index.html?album=here', '/mnet.html', '/mnet.html?mission=m1', '/company', '/company/',
  '/news', '/news/', '/news/a-1', '/robots.txt', '/sitemap.xml', '/llms.txt', '/account.html', '/action/', '/auth/', '/js/tabbar.js', '/sw.js', '/manifest.json',
  '/embed.html', '/carry.html', '/.well-known/acme-challenge/x', '/listen.html', '/album.html?album=here', '/matthew-mccluster.html', '/engineering/',
  '/engineering', '/whip.html', '/whip/', '/site0/', '/nope.html', '/favicon.ico', ...record.url_ownership.platform.slice(0, 40), ...record.url_ownership.profile, ...record.url_ownership.profile_only];

test('no host, path or stage loops, and every old address lands in at most three hops (the equityuprise rewrite included)', () => {
  for (const site of [P0, P1, tableOf('P2'), P3, tableOf('P4'), F0, F1, F3, tableOf('P4', F_RECORD)]) {
    const hosts = [site.platform.host, ...site.tenants.map((t) => t.host), ...site.doors.filter((d) => d.served_by === 'worker:mccluster').map((d) => d.host)];
    for (const host of hosts) for (const scheme of ['https', 'http']) for (const path of LOOP_PATHS) {
      let url = new URL(`${scheme}://${host}${path}`);
      const seen = [url.href];
      let last = null;
      for (;;) {
        const r = last = route(site, url.href);
        if (!r || r.kind !== 'moved') break;
        url = new URL(r.location);
        assert.ok(!seen.includes(url.href), `${site.stage}${site.platform.origin === EQ ? ' (F)' : ''}: ${seen.join(' -> ')} -> ${url.href} loops`);
        seen.push(url.href);
        assert.ok(seen.length <= 4, `${site.stage}: ${seen.join(' -> ')} takes more than three hops`);
      }
      /* Matthew's own origin answers plain http with its own 301 to https (Measured: GitHub Pages) */
      if (!(last && last.kind === 'origin')) assert.equal(url.protocol, 'https:', `${site.stage} ${scheme}://${host}${path} ends on https`);
    }
  }
});

/* ---------- answers: the fixture of 2026-11-23 replayed through the router ---------- */

const PROBE = JSON.parse(await readFile(new URL('./fixtures/platform-hosts-probe-20261123.json', import.meta.url), 'utf8'));
const MNET = await readFile(new URL('../../../mnet.html', import.meta.url), 'utf8');
const GITHUB = new Map(PROBE.head_hops.filter((h) => h.url.startsWith(`${PROF}/`)).map((h) => [new URL(h.url).pathname + new URL(h.url).search, h]));

/* GitHub Pages as measured: the status, type and cache of each probed path; a directory without its slash is an absolute
   301 on the static origin (Measured: /engineering, /action); anything else a 404 page */
function github({ asked = [], extra = {} } = {}) {
  return async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    const u = new URL(req.url);
    asked.push({ url: req.url, method: req.method, redirect: req.redirect, headers: req.headers });
    const key = u.pathname + u.search;
    if (extra[key] || extra[u.pathname]) return (extra[key] || extra[u.pathname])(req);
    const row = GITHUB.get(key) || GITHUB.get(u.pathname);
    if (row) {
      const headers = { 'content-type': row.content_type, etag: '"gh"', 'last-modified': 'Fri, 20 Nov 2026 22:29:26 GMT', server: 'GitHub.com', 'access-control-allow-origin': '*' };
      if (row.cache_control) headers['cache-control'] = row.cache_control;
      const body = u.pathname === '/mnet.html' ? MNET : `<!doctype html><title>${u.pathname}</title>`;
      return new Response(req.method === 'HEAD' ? null : body, { status: row.status, headers });
    }
    if (['/engineering', '/action', '/whip', '/assets/img'].includes(u.pathname)) {
      return new Response(req.method === 'HEAD' ? null : '<html>301</html>', { status: 301, headers: { location: `${PROF}${u.pathname}/`, 'content-type': 'text/html', server: 'GitHub.com' } });
    }
    return new Response(req.method === 'HEAD' ? null : '<!doctype html><title>404</title>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', server: 'GitHub.com' } });
  };
}
/* the newsroom's database, empty: /news/ renders its index with no articles */
const supabase = (gh) => async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://db.test/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return gh(input, init);
};
const NEWS_ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
const routerFor = (site) => createSiteRouter({ site, company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS });
const P0_ROUTER = routerFor(P0);

/* Cloudflare's edge after the Worker: the zone's Browser Cache TTL sets max-age=14400 on scripts and images (Measured:
   /js/music-engine.js, /sw.js, /assets/img/icon-192.png answer 600 on GitHub and 14400 on the apex); the Worker hands on
   what GitHub sent. */
const EDGE_TTL = /\.(?:js|png)$/;

test('with P0\'s table every probed path on mccluster.org and www.mccluster.org answers as measured on 2026-11-23: status, location and the headers that matter', async () => {
  const hops = PROBE.head_hops.filter((h) => /^https?:\/\/(?:www\.)?mccluster\.org\//.test(h.url));
  assert.ok(hops.length >= 90, 'the fixture holds both hosts');
  let compared = 0;
  for (const hop of hops) {
    /* Cloudflare's managed robots.txt answers www's before any Worker runs (200 with a stray location header) */
    if (hop.url === `${WWW}/robots.txt`) continue;
    const r = await P0_ROUTER(new Request(hop.url, { method: hop.method }), NEWS_ENV, supabase(github()));
    assert.ok(r, `${hop.url}: answered by the router`);
    const u = new URL(hop.url);
    assert.equal(r.status, hop.status, `${hop.url}: status`);
    assert.equal(r.headers.get('location'), hop.location, `${hop.url}: location`);
    assert.equal(r.headers.get('x-frame-options'), hop.x_frame_options, `${hop.url}: x-frame-options`);
    assert.equal(r.headers.get('x-robots-tag'), hop.x_robots_tag, `${hop.url}: x-robots-tag`);
    assert.equal(r.headers.get('content-security-policy'), hop.content_security_policy, `${hop.url}: content-security-policy`);
    assert.equal(r.headers.get('content-type'), hop.content_type, `${hop.url}: content-type`);
    const cache = EDGE_TTL.test(u.pathname) && hop.cache_control === 'max-age=14400' ? GITHUB.get(u.pathname).cache_control : hop.cache_control;
    assert.equal(r.headers.get('cache-control'), cache, `${hop.url}: cache-control`);
    compared++;
  }
  assert.equal(compared, hops.length - 1);
});

test('the full security headers of the World, a room, the company page and the news are the measured ones, byte for byte', async () => {
  for (const [url, measured] of Object.entries(PROBE.full_headers)) {
    const r = await P0_ROUTER(new Request(url, { method: 'HEAD' }), NEWS_ENV, supabase(github()));
    assert.equal(r.status, measured[':status'], url);
    for (const [name, value] of Object.entries(measured)) {
      if (name.startsWith(':') || name === 'cache-control' || name === 'content-type') continue;
      assert.equal(r.headers.get(name), value, `${url}: ${name}`);
    }
  }
});

test('the World\'s head on the platform is the measured one: canonical, og:url, site name, isPartOf and @ids, over the real mnet.html', async () => {
  const want = PROBE.get_heads.find((g) => g.path === '/index.html');
  assert.equal(want.chain, `301>${PLAT}/ 200`);
  for (const url of [`${PLAT}/`, `${PLAT}/?view=feed`]) {
    const r = await P0_ROUTER(new Request(url), {}, github());
    const html = await r.text();
    assert.equal(html.match(/<link rel="canonical" href="([^"]+)">/)[1], want.canonical);
    assert.equal(html.match(/<meta property="og:url" content="([^"]+)">/)[1], want.og_url);
    assert.equal(html.match(/<meta property="og:site_name" content="([^"]+)">/)[1], want.og_site_name);
    assert.doesNotMatch(html, /<meta name="robots" content="noindex">/);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const ids = new Set(), parts = new Set();
    const walk = (n) => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; if (typeof n['@id'] === 'string') ids.add(n['@id']); if (n.isPartOf?.['@id']) parts.add(n.isPartOf['@id']); Object.values(n).forEach(walk); };
    ld.forEach(walk);
    assert.deepEqual([...ids].sort(), [...want.ld_ids].sort(), `${url}: the @ids`);
    assert.deepEqual([...parts], want.is_part_of, `${url}: isPartOf`);
  }
  /* and every other probed GET on the platform keeps its measured first hop */
  for (const g of PROBE.get_heads) {
    const first = g.chain.split(' ')[0];
    const r = await P0_ROUTER(new Request(PLAT + g.path), NEWS_ENV, supabase(github()));
    if (first.startsWith('301>')) assert.equal(r.headers.get('location'), first.slice(4), `${g.path}: ${g.chain}`);
    else assert.equal(String(r.status), first, `${g.path}: ${g.chain}`);
  }
});

/* ---------- the pass-through ---------- */

test('the pass-through never follows an upstream redirect: a Location on the static origin is rewritten to the requesting host, any other is refused', async () => {
  const asked = [];
  const gh = github({ asked });
  /* P0: a World room the static origin answers with its directory's slash */
  let r = await P0_ROUTER(new Request(`${PLAT}/assets/img`), {}, gh);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), `${PLAT}/assets/img/`, 'the directory on the platform, not on Matthew\'s host');
  assert.equal(asked.at(-1).redirect, 'manual', 'fetched with redirect: manual');
  /* P1: GitHub's absolute 301s for /engineering and /action land on the platform's own directory */
  const p1 = routerFor(P1);
  for (const path of ['/engineering', '/action']) {
    r = await p1(new Request(PLAT + path), {}, gh);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get('location'), `${PLAT}${path}/`, path);
  }
  r = await p1(new Request(`${PLAT}/engineering`, { method: 'HEAD' }), {}, gh);
  assert.equal(r.headers.get('location'), `${PLAT}/engineering/`);
  assert.equal(await r.text(), '');
  /* /whip: the slash first, then the profile-only 301: two hops, never a loop */
  r = await p1(new Request(`${PLAT}/whip`), {}, gh);
  assert.equal(r.headers.get('location'), `${PLAT}/whip/`);
  assert.equal(route(P1, `${PLAT}/whip/`).location, `${PROF}/whip/`);
  /* a relative Location is resolved on the static origin first; one on the static origin with userinfo keeps only its
     path; a path that starts with // stays a path on this host */
  const extra = {
    '/rel': () => new Response(null, { status: 302, headers: { location: '/somewhere/?q=1' } }),
    '/self': () => new Response(null, { status: 301, headers: { location: `${PLAT}/self` } }),
    '/protocol': () => new Response(null, { status: 301, headers: { location: `${PROF}//evil.example/x` } }),
    '/userinfo-own': () => new Response(null, { status: 301, headers: { location: 'https://someone@matthew.mccluster.org/assets/y/' } })
  };
  const odd = github({ extra });
  r = await p1(new Request(`${PLAT}/rel`), {}, odd);
  assert.deepEqual([r.status, r.headers.get('location')], [302, `${PLAT}/somewhere/?q=1`]);
  r = await p1(new Request(`${PLAT}/protocol`), {}, odd);
  assert.equal(new URL(r.headers.get('location')).host, 'mccluster.org', 'a path that starts with // never becomes another host');
  r = await p1(new Request(`${PLAT}/userinfo-own`), {}, odd);
  assert.deepEqual([r.status, r.headers.get('location')], [301, `${PLAT}/assets/y/`], 'userinfo on the static origin is dropped, the path kept');
  /* a Location off the static origin is never this host's redirect: absolute to another host, the static host behind
     userinfo, the static host over plain http, protocol-relative to another host. Refused with a 502 and no Location,
     on the platform today (a World room) and from P1 (any page), whatever the status */
  const FOREIGN = [
    [307, 'https://elsewhere.example/x'],
    [302, 'https://evil.example/landing'],
    [301, 'https://matthew.mccluster.org@evil.example/'],
    [302, 'http://matthew.mccluster.org/assets/x'],
    [308, '//evil.example/x'],
    [303, 'https://matthew.mccluster.org.evil.example/assets/x'],
    [301, 'https://matthew.mccluster.org:8443/assets/x']
  ];
  for (const [status, location] of FOREIGN) {
    const foreign = async () => new Response(null, { status, headers: { location, 'cache-control': 'max-age=600' } });
    for (const [router, url] of [[P0_ROUTER, `${PLAT}/assets/x`], [P0_ROUTER, `${PLAT}/action-network-hire.html`], [p1, `${PLAT}/listen.html`], [p1, `${PLAT}/away`]]) {
      for (const method of ['GET', 'HEAD']) {
        r = await router(new Request(url, { method }), {}, foreign);
        assert.equal(r.status, 502, `${method} ${url} with an upstream ${status} Location ${location}: refused`);
        assert.equal(r.headers.get('location'), null, `${method} ${url}: no Location reaches the visitor (${location})`);
      }
    }
  }
  /* the World's own door (humanuprise.com, once routed) refuses the same */
  r = await routerFor(P0)(new Request(`${HU}/assets/x`), {}, async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/landing' } }));
  assert.deepEqual([r.status, r.headers.get('location')], [502, null]);
  /* an upstream that redirects to the very address asked for is a loop: refused, never handed to the browser */
  r = await p1(new Request(`${PLAT}/self`), {}, odd);
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('location'), null);
});

test('the World\'s document never redirects: an upstream 3xx for the root is a 502, not a loop between / and /mnet.html', async () => {
  const gh = github({ extra: { '/mnet.html': () => new Response(null, { status: 301, headers: { location: `${PROF}/mnet.html/` } }) } });
  const r = await P0_ROUTER(new Request(`${PLAT}/`), {}, gh);
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('location'), null);
});

test('a static origin that 301s the platform\'s own fetch (stage F, Matthew\'s host routed from another zone) never loops: the platform announces itself, and without that the guard answers 502', async () => {
  const zone = (host) => host.split('.').slice(-2).join('.');
  /* the network as Cloudflare would route it: a fetch to Matthew's host from another zone meets that host's Worker route */
  function network(site, { announce }) {
    const gh = github();
    const router = routerFor(site);
    const net = async (input) => {
      const req = input instanceof Request ? input : new Request(input);
      const host = new URL(req.url).hostname;
      if (host === site.profile.host && site.switches.profile_host_routed && zone(host) !== zone(site.platform.host)) {
        const headers = new Headers(req.headers);
        if (announce) headers.set('cf-worker', zone(site.platform.host));
        return router(new Request(req.url, { method: req.method, headers, redirect: 'manual' }), {}, gh);
      }
      return gh(req);
    };
    return net;
  }
  const f3 = routerFor(F3);
  let r = await f3(new Request(`${EQ}/listen.html`), {}, network(F3, { announce: true }));
  assert.equal(r.status, 200, 'the platform gets the page from the static origin');
  r = await f3(new Request(`${EQ}/listen.html`), {}, network(F3, { announce: false }));
  assert.equal(r.status, 502, 'without the header Matthew\'s host would 301 the page back to the platform: refused, not looped');
  /* the same zone (P3 today): a subrequest skips Worker routes and reaches GitHub, so nothing changes */
  r = await routerFor(P3)(new Request(`${PLAT}/listen.html`), {}, network(P3, { announce: false }));
  assert.equal(r.status, 200);
});

/* ---------- headers by class ---------- */

test('headers by class: documents carry the table\'s frame-ancestors and the World\'s report-only policy, embed.html no frame restriction, carry.html the platform only, files as today', async () => {
  const gh = github({ extra: {
    '/embed.html': () => new Response('<!doctype html><title>embed</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    '/carry.html': () => new Response('<!doctype html><title>carry</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  } });
  const p1 = routerFor(P1);
  const doc = await p1(new Request(`${PLAT}/listen.html`), {}, gh);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-security-policy'), `frame-ancestors ${P1.frame_ancestors.join(' ')}`);
  assert.equal(doc.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(doc.headers.get('content-security-policy-report-only'), WORLD_CSP_REPORT_ONLY);
  assert.equal(doc.headers.get('x-robots-tag'), null, 'from P1 no page served by the platform is noindex: its canonical says where it lives');
  assert.equal(doc.headers.get('strict-transport-security'), 'max-age=31536000');
  const embed = await p1(new Request(`${PLAT}/embed.html?album=here`), {}, gh);
  assert.equal(embed.headers.get('content-security-policy'), 'frame-ancestors *');
  assert.equal(embed.headers.get('x-frame-options'), null, 'other people\'s sites frame the embed');
  assert.equal(embed.headers.get('content-security-policy-report-only'), null);
  const carry = await p1(new Request(`${PLAT}/carry.html`), {}, gh);
  assert.equal(carry.headers.get('content-security-policy'), `frame-ancestors ${PLAT}`);
  assert.equal(carry.headers.get('x-frame-options'), null);
  const js = await p1(new Request(`${PLAT}/js/tabbar.js`), {}, gh);
  for (const [k, v] of Object.entries(SECURITY)) assert.equal(js.headers.get(k), v, `a file keeps today's ${k}`);
  assert.equal(js.headers.get('etag'), '"gh"');
  assert.equal(js.headers.get('content-security-policy-report-only'), null);
  /* P0's rooms stay noindex, as measured */
  const room = await P0_ROUTER(new Request(`${PLAT}/account.html`), {}, gh);
  assert.equal(room.headers.get('x-robots-tag'), 'noindex');
  /* the table decides the ancestors: the equityuprise rewrite frames from its own origins */
  const f = await routerFor(F1)(new Request(`${EQ}/listen.html`), {}, gh);
  assert.equal(f.headers.get('content-security-policy'), `frame-ancestors ${F1.frame_ancestors.join(' ')}`);
  assert.ok(F1.frame_ancestors.includes(EQ));
});

test('Matthew\'s host through the Worker: untouched before P3; from P3 GitHub\'s answer keeps its own headers and gains the framing of its class', async () => {
  const gh = github({ extra: {
    '/carry.html': () => new Response('<!doctype html><title>carry</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' } }),
    '/embed.html': () => new Response('<!doctype html><title>embed</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  } });
  const asked = [];
  const record = async (input) => { asked.push(input); return gh(input); };
  const before = await P0_ROUTER(new Request(`${PROF}/listen.html`, { headers: { cookie: 'a=1', 'user-agent': 'probe' } }), {}, record);
  assert.equal(before.status, 200);
  assert.equal(before.headers.get('server'), 'GitHub.com');
  assert.equal(before.headers.get('access-control-allow-origin'), '*');
  assert.equal(before.headers.get('content-security-policy'), null, 'before P3 nothing is added');
  assert.equal(asked.at(-1).url, `${PROF}/listen.html`, 'the request goes to its own origin');
  assert.equal(asked.at(-1).headers.get('user-agent'), 'probe', 'the request goes as it came');
  const p3 = routerFor(P3);
  const page = await p3(new Request(`${PROF}/matthew-mccluster.html`), {}, gh);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('access-control-allow-origin'), '*', 'GitHub\'s own headers stay');
  assert.equal(page.headers.get('content-security-policy'), `frame-ancestors ${P3.frame_ancestors.join(' ')}`);
  assert.equal(page.headers.get('content-security-policy-report-only'), null, 'the World\'s dry run is not his pages\'');
  const carry = await p3(new Request(`${PROF}/carry.html`), {}, gh);
  assert.equal(carry.headers.get('content-security-policy'), `frame-ancestors ${PLAT}`, 'only the platform frames the carry page');
  assert.equal(carry.headers.get('x-frame-options'), null);
  const embed = await p3(new Request(`${PROF}/embed.html`), {}, gh);
  assert.equal(embed.headers.get('content-security-policy'), 'frame-ancestors *');
  const missing = await p3(new Request(`${PROF}/nope.html`), {}, gh);
  assert.equal(missing.status, 404, 'a 404 stays a 404');
  const moved301 = await p3(new Request(`${PROF}/listen.html?track=1`), {}, gh);
  assert.deepEqual([moved301.status, moved301.headers.get('location')], [301, `${PLAT}/listen.html?track=1`]);
  /* GitHub's own redirects (a directory's slash, http to https) are handed on, never followed */
  const dir = await p3(new Request(`${PROF}/engineering`), {}, gh);
  assert.deepEqual([dir.status, dir.headers.get('location')], [301, `${PROF}/engineering/`]);
});

test('the heads: the platform\'s World head is the company generator\'s today, and a door\'s names its own host', async () => {
  assert.deepEqual(COMPANY_PARTS.head(P0), WORLD_HEAD);
  assert.deepEqual(worldHeadOf(P0), WORLD_HEAD, 'the table alone writes today\'s head, byte for byte');
  assert.equal(COMPANY_PARTS.head(F1).origin, EQ, 'another platform origin gets its own canonical');
  assert.equal(COMPANY_PARTS.head(F1).siteName, 'Equity Uprise');
  const door = await routerFor(P0)(new Request(`${HU}/`), {}, github());
  const html = await door.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/humanuprise\.com\/">/);
  assert.match(html, /<meta property="og:site_name" content="Equity Uprise">/);
  const robots = await routerFor(P0)(new Request(`${HU}/robots.txt`), {}, () => { throw new Error('must not fetch'); });
  assert.match(await robots.text(), /Sitemap: https:\/\/humanuprise\.com\/sitemap\.xml/);
});

test('wrangler.toml\'s PUBLIC_ORIGIN is the table\'s static origin, and the apex is no longer a separate variable', async () => {
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(toml.match(/^PUBLIC_ORIGIN = "([^"]+)"$/m)[1], SITE.platform.static_origin);
  assert.doesNotMatch(toml, /^APEX_ORIGIN\b/m, 'nothing read it: the platform\'s origin is the table\'s');
});

test('entry-platform.js consults the one site router before every API handler, in place of the two host calls', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const site = src.indexOf('await siteResponse(request, env)');
  assert.ok(site > 0, 'the router runs');
  for (const later of ['coreSignedGate(request, env)', 'preflightResponse(request, env)', 'enforceApiRateLimit(request, env)', 'handlePlatformApi(request, env)']) {
    assert.ok(site < src.indexOf(later), `before ${later}`);
  }
  assert.doesNotMatch(src, /await (?:companySiteResponse|humanUpriseResponse)\(/, 'one call, not two');
  assert.match(src, /createSiteRouter\(\{ company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS \}\)/);
});
