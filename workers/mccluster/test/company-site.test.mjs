/* McCluster Corp's property on mccluster.org: served by host, inert elsewhere,
   and every non-company path keeps today's 301 to matthew.mccluster.org.
   docs/control-plane/DOMAINS-AND-ENTITIES.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companySiteResponse } from '../src/company-site/router.js';
import { PAGES } from '../src/company-site/pages.generated.js';

const req = (url, method = 'GET') => new Request(url, { method });

test('the router is inert for every host but mccluster.org and www', () => {
  for (const u of ['https://api.mccluster.org/v1/health', 'https://matthew.mccluster.org/', 'https://mcp.mccluster.org/', 'https://here.mccluster.org/', 'https://evil-mccluster.org/']) {
    assert.equal(companySiteResponse(req(u)), null, u);
  }
});

test('the apex root is McCluster Corp, not the album or the founder', async () => {
  const r = companySiteResponse(req('https://mccluster.org/'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await r.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/mccluster\.org\/">/);
  assert.match(html, /<meta property="og:site_name" content="McCluster Corp">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/mccluster\.org\/">/);
  assert.match(html, /<title>McCluster Corp/);
  assert.doesNotMatch(html, /og:title" content="[^"]*I AM HERE/);
  assert.doesNotMatch(html, /<script(?! type="application\/ld\+json")/, 'no executable scripts on the company page');
  const ld = JSON.parse(html.split('<script type="application/ld+json">')[1].split('</script>')[0]);
  const org = ld['@graph'].find((n) => n['@id'] === 'https://matthew.mccluster.org/#mccluster-corp');
  assert.equal(org.url, 'https://mccluster.org/');
  const site = ld['@graph'].find((n) => n['@type'] === 'WebSite');
  assert.equal(site['@id'], 'https://mccluster.org/#website');
  assert.equal(site.publisher['@id'], org['@id']);
  assert.ok(!JSON.stringify(ld).includes('whip.html#whip-equipped'), 'Whip Equipped is not part of McCluster Corp');
  assert.match(html, /Whip Equipped LLC[^<]*is a separate company/);
});

test('every other apex path keeps today\'s 301 to the same path on matthew.mccluster.org', () => {
  for (const [from, to] of [
    ['https://mccluster.org/action/?c=end-racism', 'https://matthew.mccluster.org/action/?c=end-racism'],
    ['https://mccluster.org/docket-516.html', 'https://matthew.mccluster.org/docket-516.html'],
    ['https://mccluster.org/mnet.html?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264', 'https://matthew.mccluster.org/mnet.html?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264'],
    ['https://mccluster.org/album.html', 'https://matthew.mccluster.org/album.html']
  ]) {
    const r = companySiteResponse(req(from));
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
});

test('www sends company paths to the apex and everything else straight to the personal property', () => {
  assert.equal(companySiteResponse(req('https://www.mccluster.org/')).headers.get('location'), 'https://mccluster.org/');
  assert.equal(companySiteResponse(req('https://www.mccluster.org/sitemap.xml')).headers.get('location'), 'https://mccluster.org/sitemap.xml');
  assert.equal(companySiteResponse(req('https://www.mccluster.org/hire.html')).headers.get('location'), 'https://matthew.mccluster.org/hire.html');
  assert.equal(companySiteResponse(req('https://mccluster.org/index.html')).headers.get('location'), 'https://mccluster.org/');
});

test('robots, sitemap and llms belong to the company property', async () => {
  assert.match(await companySiteResponse(req('https://mccluster.org/robots.txt')).text(), /Sitemap: https:\/\/mccluster\.org\/sitemap\.xml/);
  assert.match(await companySiteResponse(req('https://mccluster.org/sitemap.xml')).text(), /<loc>https:\/\/mccluster\.org\/<\/loc>/);
  const llms = await companySiteResponse(req('https://mccluster.org/llms.txt')).text();
  assert.match(llms, /^# McCluster Corp/);
  assert.match(llms, /do not merge them/);
  assert.equal(companySiteResponse(req('https://mccluster.org/', 'HEAD')).status, 200);
  assert.equal(companySiteResponse(req('https://mccluster.org/', 'POST')).status, 405);
  assert.deepEqual(Object.keys(PAGES).sort(), ['/', '/llms.txt', '/robots.txt', '/sitemap.xml']);
});

test('the platform entry consults the company router before the API', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const i = src.indexOf('companySiteResponse(request)'), j = src.indexOf('enforceApiRateLimit(request, env)');
  assert.ok(i > 0 && j > i, 'company routing runs first and only for its own hosts');
});
