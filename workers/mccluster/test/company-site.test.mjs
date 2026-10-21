/* McCluster Corp's property on mccluster.org: served by host, inert elsewhere.
   Its root is the World (owner, 2026-10-15: "we need mccluster.org to
   actually show the World"), the company page is /company, and every path
   that is neither keeps today's 301 to matthew.mccluster.org.
   docs/control-plane/DOMAINS-AND-ENTITIES.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companySiteResponse, COMPANY_PAGE_PATH, WORLD_HEAD } from '../src/company-site/router.js';
import { PAGES } from '../src/company-site/pages.generated.js';

const req = (url, method = 'GET', headers = {}) => new Request(url, { method, headers });
const MNET = '<!doctype html><html><head><title>Human Uprise · McCluster</title>\n  <meta name="robots" content="noindex">\n  <link rel="stylesheet" href="css/mnet.css"></head><body><main id="mnWorld"></main><script src="js/mnet.js"></script></body></html>';
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
  assert.match(html, /<main id="mnWorld">/, 'it is mnet.html, the World');
  const ld = JSON.parse(html.split('<script type="application/ld+json">')[1].split('</script>')[0]);
  assert.equal(ld['@id'], 'https://mccluster.org/');
  assert.equal(ld.isPartOf['@id'], 'https://mccluster.org/#website', 'the root belongs to the company WebSite');
  assert.equal(ld.about['@id'], 'https://matthew.mccluster.org/#mccluster-corp', 'stable Organization @id');
  assert.equal(WORLD_HEAD.siteName, 'McCluster Corp');
  assert.equal(upstream.at(-1).url, 'http://pages.test/mnet.html?view=feed', 'fetched from the personal origin the Worker names, query and all');
  assert.equal((await ask('https://mccluster.org/', 'HEAD')).status, 200);
  assert.equal((await ask('https://mccluster.org/', 'POST')).status, 405);
});

test('/mnet.html and /index.html are the root here, query and all', async () => {
  assert.equal((await ask('https://mccluster.org/mnet.html?view=missions&mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264')).headers.get('location'), 'https://mccluster.org/?view=missions&mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264');
  assert.equal((await ask('https://mccluster.org/index.html')).headers.get('location'), 'https://mccluster.org/');
});

test('the World\'s rooms and files ride this host, noindex on the documents', async () => {
  const js = await ask('https://mccluster.org/js/mnet.js?v=abc');
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('etag'), '"j1"', 'a static file keeps its validator');
  assert.equal(js.headers.get('x-robots-tag'), null, 'only documents carry noindex');
  assert.equal(upstream.at(-1).url, 'http://pages.test/js/mnet.js?v=abc');
  const room = await ask('https://mccluster.org/account.html');
  assert.equal(room.status, 200);
  assert.equal(room.headers.get('x-robots-tag'), 'noindex');
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

test('every other apex path keeps today\'s 301 to the same path on matthew.mccluster.org', async () => {
  for (const [from, to] of [
    ['https://mccluster.org/docket-516.html', 'https://matthew.mccluster.org/docket-516.html'],
    ['https://mccluster.org/album.html', 'https://matthew.mccluster.org/album.html'],
    ['https://mccluster.org/listen.html?track=1', 'https://matthew.mccluster.org/listen.html?track=1'],
    ['https://mccluster.org/music-creator.html?handle=fixture-ana', 'https://matthew.mccluster.org/music-creator.html?handle=fixture-ana'],
    ['https://mccluster.org/engineering/mccluster-platform.html', 'https://matthew.mccluster.org/engineering/mccluster-platform.html']
  ]) {
    const r = await ask(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  const funnel = await ask('https://mccluster.org/action/?c=end-racism');
  assert.equal(funnel.status, 200, 'the campaign funnel is one of the World\'s rooms and rides this host');
  assert.equal(funnel.headers.get('x-robots-tag'), 'noindex');
  assert.equal(upstream.at(-1).url, 'http://pages.test/action/?c=end-racism');
});

test('www sends what this host serves to the apex and everything else straight to the personal property', async () => {
  assert.equal((await ask('https://www.mccluster.org/')).headers.get('location'), 'https://mccluster.org/');
  assert.equal((await ask('https://www.mccluster.org/?view=feed')).headers.get('location'), 'https://mccluster.org/?view=feed');
  assert.equal((await ask('https://www.mccluster.org/company')).headers.get('location'), 'https://mccluster.org/company');
  assert.equal((await ask('https://www.mccluster.org/sitemap.xml')).headers.get('location'), 'https://mccluster.org/sitemap.xml');
  assert.equal((await ask('https://www.mccluster.org/js/mnet.js')).headers.get('location'), 'https://mccluster.org/js/mnet.js');
  assert.equal((await ask('https://www.mccluster.org/hire.html')).headers.get('location'), 'https://matthew.mccluster.org/hire.html');
});

test('robots, sitemap and llms belong to the company property and map the World and the company page', async () => {
  assert.match(await (await ask('https://mccluster.org/robots.txt')).text(), /Sitemap: https:\/\/mccluster\.org\/sitemap\.xml/);
  const sitemap = await (await ask('https://mccluster.org/sitemap.xml')).text();
  assert.match(sitemap, /<loc>https:\/\/mccluster\.org\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/mccluster\.org\/company<\/loc>/);
  const llms = await (await ask('https://mccluster.org/llms.txt')).text();
  assert.match(llms, /^# McCluster Corp/);
  assert.match(llms, /do not merge them/);
  assert.match(llms, /https:\/\/mccluster\.org\/ is the Human Uprise World/);
  assert.deepEqual(Object.keys(PAGES).sort(), ['/company', '/llms.txt', '/robots.txt', '/sitemap.xml']);
});

test('the platform entry consults the company router before the API, with the env it needs', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const i = src.indexOf('await companySiteResponse(request, env)'), j = src.indexOf('enforceApiRateLimit(request, env)');
  assert.ok(i > 0 && j > i, 'company routing runs first and only for its own hosts');
});
