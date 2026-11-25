/* The World's host answers with its own security headers (src/world-host.js):
   framing limited to the World and the property that frames it on purpose
   (js/world-audio-continuity.js opens https://mccluster.org/ in a frame to
   keep the music playing), camera, microphone and geolocation the World's
   own, and the World's content policy as a report-only dry run on its
   documents alone. Audit finding 1 (audit/security-headers). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SECURITY, FRAME_ANCESTORS, WORLD_CSP_REPORT_ONLY, own } from '../src/world-host.js';
import { companySiteResponse } from '../src/company-site/router.js';
import { humanUpriseResponse, WORLD_DOOR_PARTS } from '../src/human-uprise/router.js';
import { SITE, makeSite } from '../src/platform/hosts.generated.js';
import { createSiteRouter } from '../src/platform/router.js';
import { siteTable, readRecord } from '../../../tools/build-site-hosts.mjs';
import { shippedSite } from '../../../scripts/test/support/mcc-site.mjs';

const site = (p) => readFile(new URL('../../../' + p, import.meta.url), 'utf8');
const fetchImpl = async (r) => {
  const u = new URL(r.url);
  if (u.pathname === '/mnet.html') return new Response('<!doctype html><html><head><title>World</title>\n  <meta name="robots" content="noindex"></head><body></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', etag: '"m1"' } });
  if (u.pathname === '/account.html') return new Response('<!doctype html><title>Account</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.pathname === '/js/mnet.js') return new Response('/* mnet */', { status: 200, headers: { 'content-type': 'text/javascript', etag: '"j1"' } });
  return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
};
const env = { PUBLIC_ORIGIN: 'http://pages.test' };
const req = (url, method = 'GET') => new Request(url, { method });
const directives = (policy) => Object.fromEntries(policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...sources] = d.split(/\s+/);
  return [name, sources];
}));
/* The World's two hosts. The platform answers with the table that ships (P1). The door serves the World only on P0's
   table (from P1 it answers every path with a 301 to the platform), so its World is read on P0's table, rebuilt from the
   record: a rollback to P0 restores exactly that. */
const doorAtP0 = createSiteRouter({ site: makeSite(siteTable(readRecord(), { stage: 'P0' })), worldDoor: WORLD_DOOR_PARTS });
const HOSTS = {
  'mccluster.org': (u, m) => companySiteResponse(req(u, m), env, fetchImpl),
  'humanuprise.com': (u, m) => doorAtP0(req(u, m), env, fetchImpl)
};
/* the rooms' noindex: P0 put it on the World's rooms; from P1 no page the platform serves carries it */
const ROOM_ROBOTS = { 'mccluster.org': null, 'humanuprise.com': 'noindex' };

test('the ancestors are exactly the origins the Music -> World bridge trusts; the legacy answer is SAMEORIGIN; capture and location are the World\'s own', async () => {
  /* the bridge trusts the table's site origins (window.MCC_SITE, generated from the same record as the Worker's table;
     its HOUSE and WORLD_ORIGINS literals left with P1) */
  const bridge = await site('js/world-audio-continuity.js');
  assert.match(bridge, /function trustedOrigins\(\) \{ var S = site\(\); return S \? S\.site_origins : \[\]; \}/);
  assert.doesNotMatch(bridge, /var (?:HOUSE|WORLD_ORIGINS|TRUSTED) = /, 'no list of its own');
  const trusted = [...shippedSite().site_origins];
  assert.deepEqual(trusted, [...SITE.site_origins], 'the pages and the Worker read the same list');
  assert.deepEqual(FRAME_ANCESTORS, ["'self'", ...trusted], 'the frame-ancestors list and the bridge\'s trusted origins move together');
  assert.equal(SECURITY['content-security-policy'], `frame-ancestors ${FRAME_ANCESTORS.join(' ')}`);
  assert.equal(SECURITY['x-frame-options'], 'SAMEORIGIN');
  assert.equal(SECURITY['permissions-policy'], 'camera=(self), microphone=(self), geolocation=(self)');
  assert.equal(SECURITY['x-content-type-options'], 'nosniff');
  assert.equal(SECURITY['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(SECURITY['strict-transport-security'], 'max-age=31536000');
  assert.equal('content-security-policy-report-only' in SECURITY, false, 'the dry run is for the World\'s documents, not every file and every host page');
});

test('the report-only policy is a dry run of what the World loads: every third-party script and stylesheet its pages name is allowed', async () => {
  const d = directives(WORLD_CSP_REPORT_ONLY);
  assert.deepEqual(d['frame-ancestors'], FRAME_ANCESTORS);
  assert.deepEqual(d['object-src'], ["'none'"]);
  for (const s of ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:']) assert.ok(d['script-src'].includes(s), `script-src ${s}: Cesium compiles WebAssembly and evaluates generated shaders`);
  assert.ok(d['worker-src'].includes('blob:'), 'Cesium boots its workers from blob:');
  for (const s of ['https://api.mccluster.org', 'https://zmnhbrjyhxzhkxmhkexs.supabase.co', 'wss://zmnhbrjyhxzhkxmhkexs.supabase.co', 'https://cesium.com', 'https://*.cesium.com', 'https://gibs.earthdata.nasa.gov', 'https://tile.openstreetmap.org']) {
    assert.ok(d['connect-src'].includes(s), `connect-src ${s}`);
  }
  assert.ok(d['img-src'].includes('https:'), 'members\' photos and post images come from anywhere over https');
  assert.ok(d['media-src'].includes('https:'), 'post media too');
  assert.ok(d['frame-src'].includes('https:'), 'a member\'s front page is framed from its own origin');
  assert.doesNotMatch(WORLD_CSP_REPORT_ONLY, /esm\.sh|cdn\.jsdelivr\.net|unpkg\.com/, 'the World loads no module from a CDN');
  /* the pages themselves: every external script and stylesheet they carry is in the policy */
  for (const page of ['mnet.html', 'action-globe.html', 'world-news.html', 'login.html', 'account.html', 'create.html', 'give.html']) {
    const html = await site(page);
    for (const [, origin] of html.matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^/"]+)/g)) assert.ok(d['script-src'].includes(origin), `${page}: script from ${origin}`);
    /* each <link> tag on its own: a canonical beside a stylesheet is not a stylesheet */
    for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
      const origin = (tag.match(/\bhref="(https:\/\/[^/"]+)/) || [])[1];
      if (!origin || !/\brel="stylesheet"/.test(tag)) continue;
      assert.ok(d['style-src'].includes(origin), `${page}: stylesheet from ${origin}`);
    }
  }
});

test('the World\'s documents carry the headers and the report-only policy on both hosts; its files carry the headers alone', async () => {
  for (const [host, ask] of Object.entries(HOSTS)) {
    const root = await ask(`https://${host}/`);
    assert.equal(root.status, 200, host);
    assert.match(root.headers.get('content-type'), /^text\/html/, host);
    for (const [k, v] of Object.entries(SECURITY)) assert.equal(root.headers.get(k), v, `${host} / ${k}`);
    assert.equal(root.headers.get('content-security-policy-report-only'), WORLD_CSP_REPORT_ONLY, `${host} root`);
    const head = await ask(`https://${host}/`, 'HEAD');
    assert.equal(head.headers.get('content-security-policy-report-only'), WORLD_CSP_REPORT_ONLY, `${host} HEAD`);
    assert.equal(head.headers.get('x-frame-options'), 'SAMEORIGIN', `${host} HEAD`);
    const room = await ask(`https://${host}/account.html`);
    assert.equal(room.status, 200, host);
    assert.equal(room.headers.get('x-robots-tag'), ROOM_ROBOTS[host], `${host} room`);
    assert.equal(room.headers.get('content-security-policy-report-only'), WORLD_CSP_REPORT_ONLY, `${host} room`);
    assert.equal(room.headers.get('permissions-policy'), SECURITY['permissions-policy'], `${host} room`);
    const file = await ask(`https://${host}/js/mnet.js`);
    assert.equal(file.status, 200, host);
    assert.equal(file.headers.get('content-security-policy-report-only'), null, `${host}: a script is not a document`);
    assert.equal(file.headers.get('x-frame-options'), 'SAMEORIGIN', `${host} file`);
    assert.equal(file.headers.get('content-security-policy'), SECURITY['content-security-policy'], `${host} file`);
    assert.equal(file.headers.get('etag'), '"j1"', `${host}: a static file keeps its validator`);
  }
});

test('the host\'s own answers carry the headers; the company page keeps its own, stricter policy and no dry run', async () => {
  const robots = own('User-agent: *\n', 'text/plain; charset=utf-8');
  for (const [k, v] of Object.entries(SECURITY)) assert.equal(robots.headers.get(k), v, k);
  assert.equal(robots.headers.get('content-security-policy-report-only'), null);
  const hu = await HOSTS['humanuprise.com']('https://humanuprise.com/robots.txt');
  assert.equal(hu.headers.get('x-frame-options'), 'SAMEORIGIN');
  /* from P1 the door's robots.txt is the platform's: one 301 there, and the platform's own answer carries the headers */
  const moved = await humanUpriseResponse(req('https://humanuprise.com/robots.txt'), env, () => { throw new Error('must not fetch'); });
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), `${SITE.platform.origin}/robots.txt`);
  const platformRobots = await HOSTS['mccluster.org']('https://mccluster.org/robots.txt');
  assert.equal(platformRobots.headers.get('x-frame-options'), 'SAMEORIGIN');
  const company = await HOSTS['mccluster.org']('https://mccluster.org/company');
  assert.equal(company.status, 200);
  assert.match(company.headers.get('content-security-policy'), /default-src 'none'/, '/company keeps its full policy');
  assert.match(company.headers.get('content-security-policy'), /frame-ancestors 'none'/, '/company is framed by nobody');
  assert.equal(company.headers.get('content-security-policy-report-only'), null, 'the World\'s dry run is not the company page\'s');
  assert.equal(company.headers.get('permissions-policy'), SECURITY['permissions-policy']);
});
