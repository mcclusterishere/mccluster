// Scratch check (not committed): in a real browser and in real time, does the page's own 30 s timer notice a session
// removed in the SAME tab with no storage event and no mcc:auth-changed? Fixture account replies only.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const { chromium } = createRequire(join('/opt/node-tools/node_modules', 'package.json'))('playwright');
const root = resolve(process.argv[2]);
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { const data = await readFile(path); res.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const part = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = [part({ alg: 'none', typ: 'JWT' }), part({ sub: 'fixture-member-a', exp: Math.floor(Date.now() / 1000) + 3600 }), 'fixture'].join('.');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 568 } });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.pathname === '/auth/v1/user') return route.fulfill({ json: { id: 'fixture-member-a' }, headers: { 'access-control-allow-origin': '*' } });
    return route.abort();
  });
  // the bar is left out so that nothing but the trial page's own timer can react
  await context.route('**/js/tabbar.js*', route => route.abort());
  await context.addInitScript(([session]) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const at = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session);
    localStorage.setItem('mcc.chem108.guest-trial.v1', JSON.stringify({ version: 1, startedAt: at, lastSeen: at }));
    window.__events = 0; window.addEventListener('storage', () => window.__events++); window.addEventListener('mcc:auth-changed', () => window.__events++);
  }, [JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 })]);
  const page = await context.newPage();
  await page.goto(base + '/chem108.html');
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  await page.locator('#chemTrialStart').click();
  await page.locator('[data-start]').click();
  console.log('verified member, expired trial, playing: options on screen =', await page.locator('.mr-opt').count());
  const t0 = Date.now();
  await page.evaluate(() => { localStorage.removeItem('mccdb_session'); localStorage.removeItem('mcc_sess_keep'); });
  console.log('session removed in this same tab; events the page heard:', await page.evaluate(() => window.__events));
  let outcome = 'still playing after 40 s';
  try { await page.locator('#chemTrialAccount').waitFor({ state: 'visible', timeout: 40000 }); outcome = 'round closed, account prompt shown'; } catch (e) { /* reported below */ }
  console.log(`${outcome} after ${((Date.now() - t0) / 1000).toFixed(1)} s; heading = ${JSON.stringify(await page.locator('#chemTrialHeading').innerText())}; options on screen = ${await page.locator('.mr-opt').count()}; events heard = ${await page.evaluate(() => window.__events)}`);
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
