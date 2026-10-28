/* Human Uprise's own door on humanuprise.com: the World by host, inert
   elsewhere, the World's rooms and files passed through from the personal
   origin, and every other path sent to the property it belongs to.
   workers/mccluster/src/human-uprise/router.js,
   docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { humanUpriseResponse, worldHead, HUMAN_UPRISE_ORIGIN } from '../src/human-uprise/router.js';
import { PERSONAL_ORIGIN } from '../src/company-site/pages.generated.js';
import { allowedOrigins } from '../src/lib/http.js';

const req = (url, method = 'GET', headers = {}) => new Request(url, { method, headers });

/* a fake personal origin: records what was asked, answers like GitHub Pages */
function upstream(pages = {}) {
  const asked = [];
  const fetchImpl = async (r) => {
    const u = new URL(r.url);
    asked.push({ url: r.url, method: r.method, accept: r.headers.get('accept') || '', encoding: r.headers.get('accept-encoding') || '' });
    const page = pages[u.pathname];
    if (!page) return new Response('<!doctype html><title>404</title>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response(page.body, { status: 200, headers: { 'content-type': page.type, 'cache-control': 'max-age=600', etag: '"abc"', 'content-encoding': 'gzip', 'content-length': '999' } });
  };
  return { asked, fetchImpl };
}
const MNET = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Equity Uprise · McCluster</title>\n  <meta name="viewport" content="width=device-width">\n  <meta name="robots" content="noindex">\n</head>\n<body></body></html>';
const PAGES = {
  '/mnet.html': { type: 'text/html; charset=utf-8', body: MNET },
  '/action-globe.html': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Globe</title>' },
  '/account.html': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Account</title>' },
  '/auth/': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Auth</title>' },
  '/action/': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Campaign</title>' },
  '/action-network-cohorts.html': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>Cohorts</title>' },
  '/js/mnet.js': { type: 'text/javascript; charset=utf-8', body: '/* mnet */' },
  '/css/mnet.css': { type: 'text/css; charset=utf-8', body: '.mn{}' },
  '/assets/img/equity-uprise-logo.webp': { type: 'image/webp', body: 'RIFF' },
  '/sw.js': { type: 'text/javascript; charset=utf-8', body: '/* keeper */' }
};

test('the router is inert for every host but humanuprise.com and www', async () => {
  for (const u of ['https://api.mccluster.org/v1/health', 'https://matthew.mccluster.org/mnet.html', 'https://mccluster.org/', 'https://humanuprise.com.evil.example/', 'https://evil-humanuprise.com/']) {
    assert.equal(await humanUpriseResponse(req(u), {}, () => { throw new Error('must not fetch'); }), null, u);
  }
});

test('the root is the World: mnet.html from the personal origin, with this host\'s canonical in its head', async () => {
  const { asked, fetchImpl } = upstream(PAGES);
  const r = await humanUpriseResponse(req('https://humanuprise.com/'), {}, fetchImpl);
  assert.equal(r.status, 200);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, `${PERSONAL_ORIGIN}/mnet.html`);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(r.headers.get('x-robots-tag'), null, 'the front door is indexable');
  assert.equal(r.headers.get('etag'), null, 'the upstream validator does not describe the rewritten body');
  assert.equal(r.headers.get('content-encoding'), null);
  assert.equal(r.headers.get('content-length'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const html = await r.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/humanuprise\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/humanuprise\.com\/">/);
  assert.match(html, /<meta property="og:site_name" content="Equity Uprise">/, 'the public brand (owner, 2026-10-28), on the legacy-named host');
  assert.doesNotMatch(html, /name="robots" content="noindex"/, 'the noindex that belongs to Matthew\'s site does not follow the World here');
  assert.match(html, /<title>Equity Uprise · McCluster<\/title>/, 'the page is otherwise untouched');
});

test('the root keeps its deep links: the query rides to the World unchanged', async () => {
  const { asked, fetchImpl } = upstream(PAGES);
  const r = await humanUpriseResponse(req('https://humanuprise.com/?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264'), {}, fetchImpl);
  assert.equal(r.status, 200);
  assert.equal(asked[0].url, `${PERSONAL_ORIGIN}/mnet.html?mission=58eeb75d-a5b6-4280-9cd7-3b0cabf02264`);
  const head = await humanUpriseResponse(req('https://humanuprise.com/', 'HEAD'), {}, fetchImpl);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('worldHead falls back to the title when a page carries no robots meta', () => {
  const out = worldHead('<!doctype html><html><head><title>X</title></head></html>');
  assert.match(out, /<\/title>\n  <link rel="canonical" href="https:\/\/humanuprise\.com\/">/);
});

test('the World\'s document name is the root here, query and all', async () => {
  const r = await humanUpriseResponse(req('https://humanuprise.com/mnet.html?view=missions'), {}, () => { throw new Error('must not fetch'); });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://humanuprise.com/?view=missions');
});

test('the World\'s rooms, the sign-in pages and the static files pass through from the personal origin', async () => {
  const { asked, fetchImpl } = upstream(PAGES);
  const cases = [
    ['/action-globe.html?embedded=1&surface=network', 'text/html', 'noindex'],
    ['/account.html', 'text/html', 'noindex'],
    ['/auth/?next=%2F', 'text/html', 'noindex'],
    ['/action/?c=end-racism', 'text/html', 'noindex'],
    ['/action-network-cohorts.html', 'text/html', 'noindex'],
    ['/js/mnet.js?v=20261014', 'text/javascript', null],
    ['/css/mnet.css', 'text/css', null],
    ['/assets/img/equity-uprise-logo.webp', 'image/webp', null],
    ['/sw.js', 'text/javascript', null]
  ];
  for (const [path, type, robots] of cases) {
    const r = await humanUpriseResponse(req('https://humanuprise.com' + path, 'GET', { accept: 'text/html', 'accept-encoding': 'br, gzip', range: 'bytes=0-1' }), {}, fetchImpl);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), new RegExp('^' + type.replace('/', '\\/')), path);
    assert.equal(r.headers.get('x-robots-tag'), robots, path);
    assert.equal(r.headers.get('cache-control'), 'max-age=600', path);
    assert.equal(r.headers.get('etag'), '"abc"', path);
    assert.equal(r.headers.get('content-encoding'), null, `${path}: the runtime decodes the upstream body`);
    assert.equal(r.headers.get('content-length'), null, path);
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000', path);
  }
  assert.deepEqual(asked.map((a) => a.url), cases.map(([p]) => PERSONAL_ORIGIN + p));
  assert.ok(asked.every((a) => a.accept === 'text/html'), 'the client\'s accept header goes upstream');
  assert.ok(asked.every((a) => a.encoding === ''), 'the client\'s accept-encoding never goes upstream');
  const missing = await humanUpriseResponse(req('https://humanuprise.com/js/not-there.js'), {}, fetchImpl);
  assert.equal(missing.status, 404, 'upstream status passes through');
});

test('every other path belongs to Matthew\'s site and gets a 301 there: Music, the M, creators, records', async () => {
  for (const [from, to] of [
    ['https://humanuprise.com/listen.html', `${PERSONAL_ORIGIN}/listen.html`],
    ['https://humanuprise.com/index.html', `${PERSONAL_ORIGIN}/index.html`],
    ['https://humanuprise.com/album.html', `${PERSONAL_ORIGIN}/album.html`],
    ['https://humanuprise.com/music-creator.html?handle=ana', `${PERSONAL_ORIGIN}/music-creator.html?handle=ana`],
    ['https://humanuprise.com/creator.html', `${PERSONAL_ORIGIN}/creator.html`],
    ['https://humanuprise.com/tracks/i-am-here.mp3', `${PERSONAL_ORIGIN}/tracks/i-am-here.mp3`],
    ['https://humanuprise.com/whip.html', `${PERSONAL_ORIGIN}/whip.html`],
    ['https://humanuprise.com/receipt.html?session=cs_1', `${PERSONAL_ORIGIN}/receipt.html?session=cs_1`]
  ]) {
    const r = await humanUpriseResponse(req(from), {}, () => { throw new Error('must not fetch'); });
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
});

test('www sends everything to the apex, same path and query', async () => {
  const r = await humanUpriseResponse(req('https://www.humanuprise.com/?view=missions'), {}, () => { throw new Error('must not fetch'); });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://humanuprise.com/?view=missions');
  assert.equal((await humanUpriseResponse(req('https://www.humanuprise.com/album.html'))).headers.get('location'), 'https://humanuprise.com/album.html');
});

test('robots and sitemap are this host\'s own; only GET and HEAD reach the World', async () => {
  const robots = await humanUpriseResponse(req('https://humanuprise.com/robots.txt'));
  assert.match(await robots.text(), /Sitemap: https:\/\/humanuprise\.com\/sitemap\.xml/);
  const sitemap = await (await humanUpriseResponse(req('https://humanuprise.com/sitemap.xml'))).text();
  assert.match(sitemap, /<loc>https:\/\/humanuprise\.com\/<\/loc>/);
  assert.doesNotMatch(sitemap, /account|mnet\.html/, 'the sitemap names the front door only');
  const post = await humanUpriseResponse(req('https://humanuprise.com/', 'POST'), {}, () => { throw new Error('must not fetch'); });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('the upstream is PUBLIC_ORIGIN when the Worker names one', async () => {
  const { asked, fetchImpl } = upstream({ '/mnet.html': PAGES['/mnet.html'] });
  await humanUpriseResponse(req('https://humanuprise.com/'), { PUBLIC_ORIGIN: 'http://127.0.0.1:4173/' }, fetchImpl);
  assert.equal(asked[0].url, 'http://127.0.0.1:4173/mnet.html');
  const r = await humanUpriseResponse(req('https://humanuprise.com/album.html'), { PUBLIC_ORIGIN: 'http://127.0.0.1:4173' });
  assert.equal(r.headers.get('location'), `${PERSONAL_ORIGIN}/album.html`, 'the 301 names Matthew\'s public property whatever the upstream is');
});

test('the platform entry consults the Human Uprise router after the company router and before the API', async () => {
  const src = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  const i = src.indexOf('await companySiteResponse(request, env)');
  const j = src.indexOf('await humanUpriseResponse(request, env)');
  const k = src.indexOf('enforceApiRateLimit(request, env)');
  assert.ok(i > 0 && j > i && k > j, 'host routing runs first and only for its own hosts');
});

test('the API answers the Human Uprise host: its origins are on the CORS allowlist', () => {
  const list = allowedOrigins({});
  assert.ok(list.includes(HUMAN_UPRISE_ORIGIN), 'https://humanuprise.com');
  assert.ok(list.includes('https://www.humanuprise.com'));
  assert.ok(list.includes('https://matthew.mccluster.org'), 'and the personal property keeps its place');
});

test('plain http on the apex is one 301 to https, same path and query', async () => {
  for (const [from, to] of [
    ['http://humanuprise.com/', 'https://humanuprise.com/'],
    ['http://humanuprise.com/?view=missions', 'https://humanuprise.com/?view=missions'],
    ['http://www.humanuprise.com/account.html', 'https://humanuprise.com/account.html']
  ]) {
    const r = await humanUpriseResponse(req(from), {}, () => { throw new Error('must not fetch'); });
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
});
