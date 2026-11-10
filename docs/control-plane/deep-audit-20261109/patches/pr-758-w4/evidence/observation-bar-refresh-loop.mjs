// Scratch check (not part of the lane's change): does the shared bar keep refreshing when canonical auth treats the
// session as stale on every call (for example a device clock about an hour fast)? Fixture auth only; local page only.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const { chromium } = createRequire(join('/opt/node-tools/node_modules', 'package.json'))('playwright');
const root = resolve(process.argv[2]);
const pagePath = process.argv[3] || '/chem108.html';
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { const data = await readFile(path); res.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const part = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = turn => [part({ alg: 'none', typ: 'JWT' }), part({ sub: 'fixture-member-a', turn, exp: Math.floor(Date.now() / 1000) + 3600 }), 'fixture'].join('.');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const cors = { 'access-control-allow-origin': '*' };
  let refreshes = 0, users = 0, turn = 1;
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      refreshes++;
      // a healthy server answer; expires_at is what a device with a clock an hour fast sees as already past
      return route.fulfill({ json: { access_token: token(++turn), refresh_token: 'fixture-refresh-' + turn, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 5, user: { id: 'fixture-member-a' } }, headers: cors });
    }
    if (u.pathname === '/auth/v1/user') { users++; return route.fulfill({ json: { id: 'fixture-member-a' }, headers: cors }); }
    return route.abort();
  });
  await context.addInitScript(([session]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); } },
    [JSON.stringify({ access_token: token(1), refresh_token: 'fixture-refresh-1', expires_at: Math.floor(Date.now() / 1000) - 5 })]);
  const page = await context.newPage();
  if (process.argv[4] === 'no-bar') await page.route('**/js/tabbar.js*', r => r.abort());
  await page.goto(base + pagePath);
  for (const at of [1000, 2000, 3000]) { await page.waitForTimeout(1000); console.log(`${pagePath}${process.argv[4] === 'no-bar' ? ' (bar not loaded)' : ''} after ${at} ms: token refreshes=${refreshes} user lookups=${users}`); }
  if (pagePath === '/chem108.html') console.log('trial heading:', await page.locator('#chemTrialHeading').innerText());
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
