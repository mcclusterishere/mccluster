/* McCluster Corp's property on mccluster.org: served by host, inert elsewhere.
   Its root is the World (owner, 2026-10-15: "we need mccluster.org to
   actually show the World"), the company page is /company, and since P1 every
   other page answers at its path, passed through from the static origin, with
   Whip Equipped and the owner's own pages (profile_only) sent to
   matthew.mccluster.org. Before P1 every path that was neither answered 301 to
   matthew.mccluster.org (test/platform-router.test.mjs keeps P0's table).
   docs/control-plane/DOMAINS-AND-ENTITIES.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companySiteResponse, COMPANY_PAGE_PATH, WORLD_HEAD, WORLD_SHARE } from '../src/company-site/router.js';
import { worldHeadFor } from '../src/world-host.js';
import { PAGES } from '../src/company-site/pages.generated.js';

const req = (url, method = 'GET', headers = {}) => new Request(url, { method, headers });
/* the real World, as published on the personal property: the test sees the head the host actually serves */
const MNET = await readFile(new URL('../../../mnet.html', import.meta.url), 'utf8');
/* the personal origin, where the World's files live */
const upstream = [];
const fetchImpl = async (r) => {
  const u = new URL(r.url);
  upstream.push({ url: r.url, method: r.method, accept: r.headers.get('accept') });
  if (u.pathname === '/mnet.html') return new Response(MNET, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', etag: '"m1"', 'cache-control': 'max-age=600' } });
  if (u.pathname === '/js/mnet.js') return new Response('/* mnet */', { status: 200, headers: { 'content-type': 'text/javascript', etag: '"j1"' } });
  if (u.pathname === '/account.html') return new Response('<!doctype html><title>Account</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.pathname === '/action-globe.html') return new Response('<!doctype html><title>Earth</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.pathname === '/action/') return new Response('<!doctype html><title>Campaign</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  /* the pages the platform serves from P1, as the static origin answers them */
  if (/^\/(?:index|album|listen|docket-516|music-creator)\.html$|^\/engineering\//.test(u.pathname)) return new Response('<!doctype html><title>Page</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
};
const ask = (url, method, headers) => companySiteResponse(req(url, method, headers), { PUBLIC_ORIGIN: 'http://pages.test' }, fetchImpl);

test('the router is inert for every host but mccluster.org and www', async () => {
  for (const u of ['https://api.mccluster.org/v1/health', 'https://matthew.mccluster.org/', 'https://mcp.mccluster.org/', 'https://here.mccluster.org/', 'https://evil-mccluster.org/', 'https://humanuprise.com/']) {
    assert.equal(await ask(u), null, u);
  }
  assert.equal(upstream.length, 0, 'nothing was fetched for a host that is not this one');
});

test('the apex root is the World, company-first: this host\'s canonical, McCluster Corp as the site, no noindex', async () => {
  const r = await ask('https://mccluster.org/?view=feed');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('x-robots-tag'), null, 'the root is indexable here');
  assert.equal(r.headers.get('etag'), null, 'the body changed, so the upstream validator does not describe it');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const html = await r.text();
  assert.doesNotMatch(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/mccluster\.org\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/mccluster\.org\/">/);
  assert.match(html, /<meta property="og:site_name" content="McCluster Corp">/);
  assert.match(html, /<section class="mn__world-home" id="mnWorld"/, 'it is mnet.html, the World');
  /* company-first share preview (domain-architecture.json -> properties.company.share_preview), on the real head */
  const titles = html.match(/<title>[^<]*<\/title>/g);
  /* owner, 2026-10-28: the public brand is Equity Uprise, not Human Uprise */
  assert.deepEqual(titles, ['<title>Equity Uprise · McCluster</title>'], 'one title, and it is the World\'s on the company host');
  assert.doesNotMatch(html, /Human Uprise/, 'the public brand is Equity Uprise: no Human Uprise anywhere in the served World');
  assert.doesNotMatch(html, /Equity Uprise is the McCluster social network/, 'the noindex page\'s own description does not leak');
  assert.equal(html.match(/<meta name="description"/g).length, 1);
  assert.match(html, /<meta name="description" content="Equity Uprise is McCluster Corp's movement platform/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta property="og:title" content="Equity Uprise · McCluster">/);
  assert.match(html, /<meta property="og:description" content="Equity Uprise is McCluster Corp's movement platform/);
  assert.match(html, /<meta property="og:image" content="https:\/\/matthew\.mccluster\.org\/assets\/img\/m-mark\.png">/, 'the supplied M mark, unaltered, until an owner card exists');
  assert.match(html, /<meta name="twitter:card" content="summary">/);
  assert.match(html, /<meta name="twitter:title" content="Equity Uprise · McCluster">/);
  assert.match(html, /<meta name="twitter:description" content="Equity Uprise is McCluster Corp's movement platform/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/matthew\.mccluster\.org\/assets\/img\/m-mark\.png">/);
  assert.doesNotMatch(html, /I AM HERE/, 'never the album');
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one <h1> on the root');
  const ld = JSON.parse(html.split('<script type="application/ld+json">')[1].split('</script>')[0]);
  assert.equal(ld['@id'], 'https://mccluster.org/');
  assert.equal(ld.isPartOf['@id'], 'https://mccluster.org/#website', 'the root belongs to the company WebSite');
  assert.equal(ld.about['@id'], 'https://matthew.mccluster.org/#mccluster-corp', 'stable Organization @id');
  assert.equal(ld.name, 'Equity Uprise · McCluster', 'the WebPage node names the public brand');
  assert.equal(WORLD_HEAD.siteName, 'McCluster Corp');
  assert.equal(upstream.at(-1).url, 'http://pages.test/mnet.html?view=feed', 'fetched from the personal origin the Worker names, query and all');
  assert.equal((await ask('https://mccluster.org/', 'HEAD')).status, 200);
  assert.equal((await ask('https://mccluster.org/', 'POST')).status, 405);
});

/* P1: /index.html is the HERE front door at its path; only a World query on it (view=, mission=) is the root's */
test('/mnet.html and a World query on /index.html are the root here, query and all; /index.html itself is the HERE front door', async () => {
  assert.equal((await ask('https://mccluster.org/mnet.html?view=missions&mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264')).headers.get('location'), 'https://mccluster.org/?view=missions&mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264');
  assert.equal((await ask('https://mccluster.org/index.html?view=feed')).headers.get('location'), 'https://mccluster.org/?view=feed');
  assert.equal((await ask('https://mccluster.org/index.html?mission=m1')).headers.get('location'), 'https://mccluster.org/?mission=m1');
  const door = await ask('https://mccluster.org/index.html?album=here');
  assert.equal(door.status, 200, 'the HERE front door answers at its path');
  assert.equal(door.headers.get('location'), null);
  assert.equal(door.headers.get('x-robots-tag'), null, 'not noindex: its canonical says where it lives (P2 moves canonicals)');
  assert.equal(upstream.at(-1).url, 'http://pages.test/index.html?album=here');
});

/* PUBLIC MISSIONS (owner, 2026-11-17: "people can just go look at the missions, sign in, get that user flow"): a shared
   mission link, and the address a guest keeps while signing in to join, land on that mission. The World's document name
   moves to the root in one 301 that drops nothing: the mission, and the campaign, content, source and return a join
   is attributed to. */
test('a shared /mnet.html?mission= link moves to /?mission= with every parameter kept, in one 301', async () => {
  const id = '302dcb4e-ca21-4289-b633-9c397985fb9d';
  const bare = await ask(`https://mccluster.org/mnet.html?mission=${id}`);
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), `https://mccluster.org/?mission=${id}`);
  const attributed = `?view=missions&mission=${id}&campaign=bridgeport-creates&content=55555555-5555-4555-8555-555555555555&src=network&return=%2Faction%2F`;
  const r = await ask(`https://mccluster.org/mnet.html${attributed}`);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), `https://mccluster.org/${attributed}`);
  /* www moves to the apex with the query kept; the apex's own hop then lands on the root, as above */
  const www = await ask(`https://www.mccluster.org/mnet.html?mission=${id}`);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('location'), `https://mccluster.org/mnet.html?mission=${id}`);
  /* the root itself serves the World with the query passed through, so the page sees the mission */
  const root = await ask(`https://mccluster.org/?mission=${id}`);
  assert.equal(root.status, 200);
  assert.equal(upstream.at(-1).url, `http://pages.test/mnet.html?mission=${id}`);
});

/* P1: every page and file rides this host; no page is noindex here any more (at P0 the World's rooms were) */
test('the World\'s rooms and files ride this host, and no page the platform serves is noindex', async () => {
  const js = await ask('https://mccluster.org/js/mnet.js?v=abc');
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('etag'), '"j1"', 'a static file keeps its validator');
  assert.equal(js.headers.get('x-robots-tag'), null, 'only documents carry noindex');
  assert.equal(upstream.at(-1).url, 'http://pages.test/js/mnet.js?v=abc');
  const room = await ask('https://mccluster.org/account.html');
  assert.equal(room.status, 200);
  assert.equal(room.headers.get('x-robots-tag'), null);
  assert.equal((await ask('https://mccluster.org/action-globe.html?embedded=1')).status, 200, 'the Earth frames on the same host, for the bridge');
  assert.equal((await ask('https://mccluster.org/auth/seek-first-handoff.html')).status, 404, 'passed through as upstream answers');
});

test('the company page is /company: McCluster Corp, not the album or the founder, and no executable scripts', async () => {
  assert.equal(COMPANY_PAGE_PATH, '/company');
  const r = await ask('https://mccluster.org/company');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await r.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/mccluster\.org\/company">/);
  assert.match(html, /<meta property="og:site_name" content="McCluster Corp">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/mccluster\.org\/company">/);
  assert.match(html, /<title>McCluster Corp/);
  assert.doesNotMatch(html, /og:title" content="[^"]*I AM HERE/);
  assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/, 'no executable scripts on the company page');
  assert.match(html, /<a class="go" href="https:\/\/mccluster\.org\/">Open the World/, 'the company page opens the World at the root');
  const ld = JSON.parse(html.split('<script type="application/ld+json">')[1].split('</script>')[0]);
  const org = ld['@graph'].find((n) => n['@id'] === 'https://matthew.mccluster.org/#mccluster-corp');
  assert.equal(org.url, 'https://mccluster.org/', 'the Organization\'s url is the company property');
  const site = ld['@graph'].find((n) => n['@type'] === 'WebSite');
  assert.equal(site['@id'], 'https://mccluster.org/#website');
  assert.equal(site.url, 'https://mccluster.org/');
  assert.equal(site.publisher['@id'], org['@id']);
  const about = ld['@graph'].find((n) => n['@type'] === 'AboutPage');
  assert.equal(about['@id'], 'https://mccluster.org/company');
  assert.ok(!JSON.stringify(ld).includes('whip.html#whip-equipped'), 'Whip Equipped is not part of McCluster Corp');
  assert.match(html, /Whip Equipped LLC[^<]*is a separate company/);
  assert.equal((await ask('https://mccluster.org/company', 'POST')).status, 405);
});

/* P1: the 301 every other apex path answered until P1 is gone; the platform serves the page, query intact, and only
   Whip Equipped and the owner's own pages (url_ownership.profile_only) answer 301 to Matthew's host */
test('every other apex page answers at its path here; Whip and the owner\'s own pages answer 301 to matthew.mccluster.org', async () => {
  for (const path of ['/docket-516.html', '/album.html', '/listen.html?track=1', '/music-creator.html?handle=fixture-ana', '/engineering/mccluster-platform.html']) {
    const r = await ask('https://mccluster.org' + path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('location'), null, path);
    assert.equal(r.headers.get('x-robots-tag'), null, path);
    assert.equal(upstream.at(-1).url, 'http://pages.test' + path, `${path}: passed through, query intact`);
  }
  for (const [from, to] of [
    ['https://mccluster.org/whip.html', 'https://matthew.mccluster.org/whip.html'],
    ['https://mccluster.org/whip/rider/?ref=x', 'https://matthew.mccluster.org/whip/rider/?ref=x'],
    ['https://mccluster.org/we-manufacture.html', 'https://matthew.mccluster.org/we-manufacture.html'],
    ['https://mccluster.org/prayer-closet.html', 'https://matthew.mccluster.org/prayer-closet.html']
  ]) {
    const r = await ask(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  const funnel = await ask('https://mccluster.org/action/?c=end-racism');
  assert.equal(funnel.status, 200, 'the campaign funnel rides this host');
  assert.equal(funnel.headers.get('x-robots-tag'), null);
  assert.equal(upstream.at(-1).url, 'http://pages.test/action/?c=end-racism');
});

/* P1: www sends every path to the apex (until P1 the apex's own paths went there and the rest to Matthew's host) */
test('www sends every path to the apex, same path and query', async () => {
  assert.equal((await ask('https://www.mccluster.org/')).headers.get('location'), 'https://mccluster.org/');
  assert.equal((await ask('https://www.mccluster.org/?view=feed')).headers.get('location'), 'https://mccluster.org/?view=feed');
  assert.equal((await ask('https://www.mccluster.org/company')).headers.get('location'), 'https://mccluster.org/company');
  assert.equal((await ask('https://www.mccluster.org/sitemap.xml')).headers.get('location'), 'https://mccluster.org/sitemap.xml');
  assert.equal((await ask('https://www.mccluster.org/js/mnet.js')).headers.get('location'), 'https://mccluster.org/js/mnet.js');
  assert.equal((await ask('https://www.mccluster.org/hire.html')).headers.get('location'), 'https://mccluster.org/hire.html');
  assert.equal((await ask('https://www.mccluster.org/whip.html?x=1')).headers.get('location'), 'https://mccluster.org/whip.html?x=1', 'the apex then sends Whip to Matthew\'s host');
});

test('robots, sitemap and llms belong to the company property and map the World and the company page', async () => {
  assert.match(await (await ask('https://mccluster.org/robots.txt')).text(), /Sitemap: https:\/\/mccluster\.org\/sitemap\.xml/);
  const sitemap = await (await ask('https://mccluster.org/sitemap.xml')).text();
  assert.match(sitemap, /<loc>https:\/\/mccluster\.org\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/mccluster\.org\/company<\/loc>/);
  const llms = await (await ask('https://mccluster.org/llms.txt')).text();
  assert.match(llms, /^# McCluster Corp/);
  assert.match(llms, /do not merge them/);
  assert.match(llms, /https:\/\/mccluster\.org\/ is the Equity Uprise World/);
  assert.doesNotMatch(llms, /Human Uprise/, 'the public brand is Equity Uprise');
  assert.deepEqual(Object.keys(PAGES).sort(), ['/company', '/llms.txt', '/robots.txt', '/sitemap.xml']);
});

test('the platform entry consults the host router, with the company\'s pages, before the API and with the env it needs', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.match(src, /createSiteRouter\(\{ company: COMPANY_PARTS, worldDoor: WORLD_DOOR_PARTS \}\)/, 'the company\'s pages ride the one host router (src/platform/router.js)');
  const i = src.indexOf('await siteResponse(request, env)'), j = src.indexOf('enforceApiRateLimit(request, env)');
  assert.ok(i > 0 && j > i, 'host routing runs first and only for the site\'s hosts');
});

test('plain http on the apex is one 301 to https; /company/ is the company page, not a path on Matthew\'s site', async () => {
  for (const [from, to] of [
    ['http://mccluster.org/', 'https://mccluster.org/'],
    ['http://mccluster.org/company', 'https://mccluster.org/company'],
    ['http://mccluster.org/?view=feed', 'https://mccluster.org/?view=feed'],
    ['http://mccluster.org/docket-516.html', 'https://mccluster.org/docket-516.html'],
    ['https://mccluster.org/company/', 'https://mccluster.org/company'],
    ['https://mccluster.org/company/?ref=x', 'https://mccluster.org/company?ref=x'],
    /* P1: www keeps the path as asked; the apex folds the slash in its own hop (above) */
    ['https://www.mccluster.org/company/', 'https://mccluster.org/company/'],
    ['http://www.mccluster.org/', 'https://mccluster.org/']
  ]) {
    const r = await ask(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  assert.equal((await ask('https://mccluster.org/company')).status, 200, 'https itself is untouched');
});

test('the host\'s share preview replaces whatever title and description the upstream page carries', () => {
  /* mnet.html's own title happens to match the host's now (both say Equity Uprise), so prove the swap on a page that does not */
  const upstream = '<!doctype html><html><head><title>Some other page</title>\n  <meta name="description" content="Some other description.">\n  <meta name="robots" content="noindex"></head><body></body></html>';
  const out = worldHeadFor(upstream, WORLD_HEAD);
  assert.deepEqual(out.match(/<title>[^<]*<\/title>/g), [`<title>${WORLD_SHARE.title}</title>`]);
  assert.equal(WORLD_SHARE.title, 'Equity Uprise · McCluster');
  assert.doesNotMatch(out, /Some other/);
  assert.doesNotMatch(out, /noindex/);
  assert.match(out, /<meta property="og:site_name" content="McCluster Corp">/, 'the site is the company');
});
