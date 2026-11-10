/* Control: one account's private data never reaches another account, or the
   page after sign-out (audit A1 close-out, 2026-11-10). Real control.html and
   every script from this checkout in Chromium at 390 px; EVERY network call is
   a synthetic fixture answered for the account whose bearer token sent it
   (account A's strings carry A-PRIVATE, account B's B-PRIVATE), and each
   refresh token maps to its own account, so a refresh never swaps accounts.
   Nothing leaves the process.

   J1 A signs out in another tab: this tab is replaced by the gate, which says
      why; B then signs in here and sees only B.
   J2 B replaces A's session from another tab: this tab reloads for B and says
      why; nothing of A remains.
   J3 drafts A left unsent never reach B's composer or reply box.
   J4 A's refresh is slow when A signs out elsewhere and B signs in here: B's
      page is not undone by A's late reads.
   J5 a same-account token refresh in another tab changes nothing.

   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-account-lifecycle.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(process.env.CONTROL_E2E_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const OUT = process.argv[2] || '/tmp/control-account-lifecycle-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const SUB = { A: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' };
const exp = () => Math.floor(Date.now() / 1000) + 3600;
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (w, n = 0) => 'x.' + b64u({ sub: SUB[w], exp: exp(), email: w.toLowerCase() + '@fixture.invalid', n }) + '.y';
const whoOf = header => { try { const sub = JSON.parse(Buffer.from(String(header || '').replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString()).sub; return sub === SUB.A ? 'A' : sub === SUB.B ? 'B' : '?'; } catch { return 'none'; } };
const results = [];
function check(scope, name, ok, detail) { results.push({ scope, name, pass: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail ?? null))); }
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) }).catch(() => {});
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const log = [], slow = { coreA: 0 };
  await ctx.addInitScript(({ token }) => {
    /* Seeded once per context, before the first page: A is signed in. */
    if (!localStorage.getItem('fixture-seeded')) {
      localStorage.setItem('fixture-seeded', '1');
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      const s = JSON.stringify({ access_token: token, refresh_token: 'fixture-a', expires_at: Math.floor(Date.now() / 1000) + 3600 });
      localStorage.setItem('mccdb_session', s); localStorage.setItem('mcc_sess_keep', s);
    }
  }, { token: tokenFor('A') });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === 'https://api.mccluster.org') {
      const w = whoOf(req.headers()['authorization']);
      log.push({ who: w, path: p, t: Date.now() });
      if (p === '/health') return json(route, { ok: true });
      if (w !== 'A' && w !== 'B') return json(route, { error: 'unauthorized' }, 401);
      const M = w + '-PRIVATE', org = 'org-' + w.toLowerCase(), now = new Date().toISOString();
      if (p === '/v1/core/mcp' && w === 'A' && slow.coreA) { const ms = slow.coreA; await new Promise(r => setTimeout(r, ms)); }
      if (p === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: SUB[w] }, default_org_id: org, workspaces: [{ org_id: org, slug: 'ws-' + w.toLowerCase(), kind: 'studio', role: 'owner', enabled: true, name: M + '-WORKSPACE' }] });
      if (p === '/v1/status') return json(route, { ok: true, operator: { email: M + '-operator@fixture.invalid' }, database: { reachable: true } });
      if (p === '/v1/core/mcp') { let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {} return json(route, { jsonrpc: '2.0', id: body.id, result: body.method === 'tools/list' ? { tools: [{ name: 'ai.chat' }, { name: 'core.ai.turn.submit' }, { name: 'core.ai.turn.get' }] } : {} }); }
      if (p === '/v1/observability/events') return json(route, { ok: true, events: [{ id: 'ev-' + w, event_name: M + '-EVENT', event_kind: 'domain', level: 'info', occurred_at: now, source: 'worker', outcome: 'ok' }], has_more: false });
      if (p === '/v1/social/accounts') return json(route, { ok: true, accounts: [{ id: 'sa-' + w, platform: 'instagram', handle: M + '-HANDLE', display_name: M + '-HANDLE', status: 'connected' }] });
      if (p === '/v1/comms/threads') return json(route, { ok: true, threads: [{ id: 'thread-shared', mode: 'human', channel: 'email', updated_at: now, last_inbound_at: now, comms_contacts: { display_name: M + '-CONTACT', address: w.toLowerCase() + '@example.invalid' } }] });
      if (/^\/v1\/comms\/threads\/[^/]+\/messages$/.test(p)) return json(route, { ok: true, thread: { id: 'thread-shared', mode: 'human' }, messages: [{ id: 'm-' + w, body: M + '-MESSAGE', direction: 'inbound', status: 'received', created_at: now }], has_more: false });
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0 });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/token') {
        let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
        const grant = u.searchParams.get('grant_type');
        const w = grant === 'refresh_token' ? ({ 'fixture-a': 'A', 'fixture-b': 'B' })[body.refresh_token] : (/^b@/.test(body.email || '') ? 'B' : /^a@/.test(body.email || '') ? 'A' : null);
        if (!w) return json(route, { error: 'invalid_grant' }, 400);
        return json(route, { access_token: tokenFor(w), refresh_token: 'fixture-' + w.toLowerCase(), token_type: 'bearer', expires_in: 3600, expires_at: exp(), user: { id: SUB[w], email: w.toLowerCase() + '@fixture.invalid' } });
      }
      const w = whoOf(req.headers()['authorization']);
      if (p === '/auth/v1/user') return json(route, { id: SUB[w] || null, email: w.toLowerCase() + '@fixture.invalid' });
      if (p === '/rest/v1/ops_ai_threads' && (w === 'A' || w === 'B')) return json(route, [{ id: 'ai-' + w, org_id: 'org-' + w.toLowerCase(), title: w + '-PRIVATE-CHAT', last_message_at: new Date().toISOString() }]);
      return json(route, [], 200, { 'content-range': '0-0/0' });
    }
    if (u.origin === BASE) {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, '')); const file = resolve(ROOT, rel);
      if (!file.startsWith(ROOT + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  return { ctx, log, slow };
}
const surface = page => page.evaluate(() => (document.getElementById('crSurface') || {}).innerText || '');
const wholeDom = page => page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll('textarea,input')].map(f => f.value).join('\n'));
const gateShown = page => page.evaluate(() => !document.getElementById('cpGate').hidden && document.getElementById('crApp').hidden);
async function appReady(page) { await page.waitForFunction(() => window.CR && window.CR.nav && !document.getElementById('crApp').hidden && document.getElementById('crSurface').childElementCount > 0, null, { timeout: 20000 }); await page.waitForTimeout(600); }
async function go(page, hash) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(900); }
async function waitText(page, text, ms = 8000) { try { await page.waitForFunction(t => ((document.getElementById('crSurface') || {}).innerText || '').includes(t), text, { timeout: ms }); return true; } catch { return false; } }
/* A page that is replaced loses this mark. */
const mark = page => page.evaluate(() => { window.__fixtureMark = 1; });
async function replaced(page, ms = 8000) { try { await page.waitForFunction(() => !window.__fixtureMark && document.readyState !== 'loading', null, { timeout: ms }); await page.waitForTimeout(700); return true; } catch { return false; } }
async function otherTab(ctx, fn, arg) {
  const tab = await ctx.newPage();
  await tab.goto(BASE + '/control.html', { waitUntil: 'domcontentloaded' });
  await tab.waitForFunction(() => window.MCC_AUTH && typeof window.MCC_AUTH.signOut === 'function', null, { timeout: 20000 });
  /* The other tab may itself reload once its account changes; that is its business. */
  try { await tab.evaluate(fn, arg); } catch (e) { if (!/context was destroyed|navigation/i.test(String(e && e.message))) throw e; }
  await tab.close();
}
async function signInHere(page, email) { await page.fill('#cpEmail', email); await page.fill('#cpPass', 'fixture-password'); await page.click('#cpIn'); }
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  {
    const S = 'J1 sign-out elsewhere, then B here';
    const { ctx, log } = await context();
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/control.html#system:observability', { waitUntil: 'domcontentloaded' }); await appReady(page);
    check(S, 'A sees its own event', await waitText(page, 'A-PRIVATE-EVENT'));
    await go(page, '#create:publish:channels');
    check(S, 'A sees its own social account', await waitText(page, 'A-PRIVATE-HANDLE'));
    await mark(page);
    await otherTab(ctx, () => window.MCC_AUTH.signOut());
    check(S, 'the page that held A is replaced', await replaced(page));
    check(S, 'the gate shows', await gateShown(page));
    check(S, 'the gate says why', /signed out/i.test(await page.locator('#cpNote').innerText()), await page.locator('#cpNote').innerText());
    check(S, 'nothing of A anywhere in the document', !(await wholeDom(page)).includes('A-PRIVATE'));
    check(S, 'no horizontal overflow at 390 on the gate', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, 'j1-signed-out-390.png') });
    const before = log.length;
    await signInHere(page, 'b@fixture.invalid'); await appReady(page);
    await go(page, '#system:observability');
    check(S, "B sees B's event", await waitText(page, 'B-PRIVATE-EVENT'));
    await go(page, '#create:publish:channels');
    check(S, "B sees B's social account", await waitText(page, 'B-PRIVATE-HANDLE'));
    check(S, 'nothing of A anywhere in B\'s document', !(await wholeDom(page)).includes('A-PRIVATE'));
    const after = log.slice(before).filter(r => r.path !== '/health');
    check(S, "no read after B signed in carried A's token", !after.some(r => r.who === 'A'), after.filter(r => r.who === 'A').map(r => r.path));
    check(S, 'no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  {
    const S = 'J2 B replaces A from another tab';
    const { ctx, log } = await context();
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/control.html#system:observability', { waitUntil: 'domcontentloaded' }); await appReady(page);
    check(S, 'A sees its own event', await waitText(page, 'A-PRIVATE-EVENT'));
    await mark(page);
    const t0 = Date.now();
    await otherTab(ctx, () => window.MCC_AUTH.signInPassword('b@fixture.invalid', 'fixture-password'));
    check(S, 'this tab reloads for B', await replaced(page));
    await appReady(page);
    check(S, "B's events load", await waitText(page, 'B-PRIVATE-EVENT'));
    check(S, 'nothing of A anywhere in the document', !(await wholeDom(page)).includes('A-PRIVATE'));
    check(S, 'the page says why it reloaded', /account changed/i.test(await surface(page)), (await surface(page)).slice(0, 200));
    check(S, "Control re-read the workspace with B's token", log.some(r => r.t >= t0 && r.who === 'B' && r.path === '/v1/workspaces/me'));
    check(S, 'no horizontal overflow at 390 with the notice', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, 'j2-reloaded-for-b-390.png') });
    await page.click('[data-action="dismiss-notice"]'); await page.waitForTimeout(300);
    check(S, 'the notice can be dismissed', !/account changed/i.test(await surface(page)));
    check(S, 'no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  {
    const S = 'J3 unsent drafts';
    const { ctx } = await context();
    const page = await ctx.newPage();
    await page.goto(BASE + '/control.html#home:ask', { waitUntil: 'domcontentloaded' }); await appReady(page);
    await page.waitForSelector('#crAiComposer:not([disabled])', { timeout: 15000 });
    await page.fill('#crAiComposer', 'A-PRIVATE-UNSENT-AI');
    await go(page, '#people:inbox:conversations');
    await page.click('[data-action="select-thread"][data-id="thread-shared"]');
    await page.waitForSelector('#crReply', { timeout: 15000 });
    await page.fill('#crReply', 'A-PRIVATE-UNSENT-REPLY');
    await mark(page);
    await otherTab(ctx, () => window.MCC_AUTH.signOut());
    await replaced(page);
    await signInHere(page, 'b@fixture.invalid'); await appReady(page);
    await go(page, '#home:ask');
    check(S, "B's AI composer is empty", (await page.evaluate(() => (document.getElementById('crAiComposer') || {}).value || '')) === '');
    await go(page, '#people:inbox:conversations');
    await page.click('[data-action="select-thread"][data-id="thread-shared"]');
    await page.waitForSelector('#crReply', { timeout: 15000 });
    check(S, "B's reply box is empty", (await page.inputValue('#crReply')) === '');
    check(S, 'nothing of A anywhere in the document', !(await wholeDom(page)).includes('A-PRIVATE'));
    await ctx.close();
  }
  {
    const S = "J4 A's slow refresh, then B";
    const { ctx, slow } = await context();
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/control.html#people:inbox:conversations', { waitUntil: 'domcontentloaded' }); await appReady(page);
    check(S, 'A sees its own conversation', await waitText(page, 'A-PRIVATE-CONTACT'));
    slow.coreA = 6000;
    await page.click('#crSurface [data-action="refresh"]'); await page.waitForTimeout(400);
    await mark(page);
    await otherTab(ctx, () => { localStorage.removeItem('mccdb_session'); localStorage.removeItem('mcc_sess_keep'); });
    check(S, 'the page that held A is replaced', await replaced(page));
    check(S, 'the gate shows', await gateShown(page));
    await signInHere(page, 'b@fixture.invalid'); await appReady(page);
    check(S, "B's conversations render", await waitText(page, 'B-PRIVATE-CONTACT', 6000));
    await page.waitForTimeout(6500);
    const text = await surface(page);
    check(S, "B's conversations still render after A's slow read would have answered", text.includes('B-PRIVATE-CONTACT') && !/could not be read/i.test(text), text.slice(0, 200));
    check(S, 'nothing of A anywhere in the document', !(await wholeDom(page)).includes('A-PRIVATE'));
    check(S, 'no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  {
    const S = 'J5 same-account token refresh';
    const { ctx } = await context();
    const page = await ctx.newPage();
    await page.goto(BASE + '/control.html#home:ask', { waitUntil: 'domcontentloaded' }); await appReady(page);
    await page.waitForSelector('#crAiComposer:not([disabled])', { timeout: 15000 });
    await page.fill('#crAiComposer', 'A-UNSENT-STAYS');
    await mark(page);
    const refreshed = tokenFor('A', 1);
    await otherTab(ctx, t => { const s = JSON.stringify({ access_token: t, refresh_token: 'fixture-a', expires_at: Math.floor(Date.now() / 1000) + 3600 }); localStorage.setItem('mccdb_session', s); localStorage.setItem('mcc_sess_keep', s); }, refreshed);
    await page.waitForTimeout(1200);
    check(S, 'the page is not replaced', await page.evaluate(() => window.__fixtureMark === 1));
    check(S, 'the draft is still there', (await page.inputValue('#crAiComposer')) === 'A-UNSENT-STAYS');
    check(S, 'the app is still shown', !(await gateShown(page)));
    await ctx.close();
  }
} catch (error) {
  console.log('FAIL [harness] ' + (error && error.stack || error));
  results.push({ scope: 'harness', name: 'ran to completion', pass: false });
} finally { await browser.close(); }
const failed = results.filter(r => !r.pass).length;
console.log((results.length - failed) + '/' + results.length + ' checks passed');
if (failed) process.exitCode = 1;
