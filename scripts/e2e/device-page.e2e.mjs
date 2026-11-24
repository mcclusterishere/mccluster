/* device.html at 390px (an iPhone) and 1280px (a Mac): signed out it asks for sign-in; signed in as the owner it
   shows what the device has, opts in from the page, and on a computer gives the one-line install with the pass.
   The gateway is a fixture here; scripts/staging/device-jobs/device-optin.mjs drives the real one.
   [PLAYWRIGHT_DIR=<node_modules>] node scripts/e2e/device-page.e2e.mjs [outDir] */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out-device-page');
await mkdir(OUT, { recursive: true });
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const b = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const ORG = '00000000-0000-4000-8000-00000000c0de';
const results = [];
const check = (s, n, ok, d) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + `[${s}] ${n}` + (ok ? '' : ' ' + JSON.stringify(d))); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function run(scope, ctxOpts, { signedIn = true } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1, ...ctxOpts });
  if (signedIn) await ctx.addInitScript(() => {
    try { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); } catch (_) {}
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'owner-token', refresh_token: 'r', expires_at: exp, user: { id: 'u1' } }));
  });
  const calls = [];
  await ctx.route('https://compute.mccluster.org/**', async (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    calls.push({ p, h: req.headers() });
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    if (p === '/v1/compute/device-grants') { const kind = JSON.parse(req.postData() || '{}').kind; return json(201, { grant: 'mccg1.cGF5bG9hZA.c2ln', kind, org_id: ORG, expires_at: new Date(Date.now() + 900000).toISOString() }); }
    if (p === '/v1/compute/enroll') return json(201, { node_id: 'node_x' });
    if (p === '/v1/compute/heartbeat') return json(200, { ok: true, server_time: new Date().toISOString() });
    return json(404, {});
  });
  await ctx.route(/^https:\/\/(?!compute\.mccluster\.org)/, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/device.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const fit = async (l) => { const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })); check(scope, `${l}: scrollWidth ${m.s} === clientWidth ${m.c}`, m.s === m.c, m); };
  if (!signedIn) {
    check(scope, 'signed out: asks to sign in, offers nothing else', await page.isVisible('#dnGate') && !(await page.isVisible('#dnBrowser')) && /next=device\.html/.test(await page.getAttribute('#dnSignIn', 'href')));
    await fit('signed out'); await ctx.close(); return;
  }
  check(scope, 'shows what this device has', /Processor threads/.test(await page.textContent('#dnFacts')));
  const h = await page.$eval('#dnOptIn', (b) => b.getBoundingClientRect().height);
  check(scope, 'the opt-in button is a 44px+ target', h >= 44, h);
  await fit('before opting in');
  await page.click('#dnOptIn');
  await page.waitForFunction(() => /Live in the network/.test(document.getElementById('dnState').textContent), null, { timeout: 10000 }).catch(() => {});
  const grantCall = calls.find((c) => c.p === '/v1/compute/device-grants'), enroll = calls.find((c) => c.p === '/v1/compute/enroll');
  check(scope, 'one tap: a browser grant with the owner session, then enrol with the grant, then live', grantCall?.h.authorization === 'Bearer owner-token' && enroll?.h['x-mccluster-enroll-grant'] === 'mccg1.cGF5bG9hZA.c2ln' && /Live in the network/.test(await page.textContent('#dnState')), calls.map((c) => c.p));
  check(scope, 'the enrol request is not signed with any secret of the site', !enroll?.h.authorization);
  check(scope, 'leave is offered once joined', await page.isVisible('#dnLeave') && !(await page.isVisible('#dnOptIn')));
  if (scope === '390') await page.screenshot({ path: join(OUT, 'device-390.png'), fullPage: true });
  const full = await page.isVisible('#dnFull');
  if (scope === '390') check(scope, 'a phone is not offered the computer install', !full);
  else {
    check(scope, 'a Mac is offered the full node', full);
    await page.click('#dnInstall');
    await page.waitForSelector('#dnCmdBox:not([hidden])', { timeout: 10000 });
    const cmd = await page.textContent('#dnCmd');
    check(scope, 'the Mac command clones the repo and installs with the org and the one-time pass', /git clone --depth 1 https:\/\/github\.com\/mcclusterishere\/mccluster/.test(cmd) && cmd.includes(`--org ${ORG} --grant mccg1.cGF5bG9hZA.c2ln`), cmd);
    await page.screenshot({ path: join(OUT, 'device-1280.png') });
  }
  await fit('after opting in');
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}
const iphone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const mac = { viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' };
try { await run('390-signed-out', iphone, { signedIn: false }); await run('390', iphone); await run('1280', mac); }
finally { await browser.close(); server.close(); }
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
