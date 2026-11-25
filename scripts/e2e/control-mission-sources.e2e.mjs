/* Control › Missions & fellows › Mission sources, the browser proof. The real control.html and its scripts, the house owner
   signed in, against the in-process MISSION SOURCES plane (scripts/test/support/mission-sources-plane.mjs: the REAL Worker
   route /v1/mission-sources over the REAL pending SQL in PGlite; its header says what is emulated). Never touches
   production. At 390, 820 and 1440:
     the card reads the draft (Preview and Show only, Preview a new tab on this origin); Show refused while the dated
     confirmation and a reason are missing, nothing sent; Show with them, the revision that was read and a fresh key, read
     back as Shown; Edit words refused before sending for a denied word, then saved; Hide, read back as Hidden; a change made
     elsewhere refused as moved and read again; a command whose answer is lost (committed, connection dropped) settled by its
     key in the history and never resent; a command whose connection is refused (nothing served) found absent, then sent
     again by hand with the same key and recorded once; no horizontal overflow (scrollWidth === clientWidth) at every step;
     every button at least 44 px and every field at least 16 px type and labelled.
   Once, at 390: the SQL not applied (said, no command offered), and a viewer of the house denied (only the denied line).
   One write the page does not make is labelled: a change made elsewhere (through the plane, as the owner).
   PGLITE_MODULE=<pglite dist/index.js> PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/control-mission-sources.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVE = resolve(process.env.MCC_SERVE_ROOT || ROOT);
const OUT = process.argv[2] || '/tmp/control-mission-sources-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const ORG = '11111111-1111-4111-8111-222222222222';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const results = [];
function check(scope, name, condition, detail) { results.push({ scope, name, pass: !!condition }); console.log((condition ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (condition ? '' : ' ' + JSON.stringify(detail))); }
await mkdir(OUT, { recursive: true });
if (!process.env.PGLITE_MODULE) { check('setup', 'PGLITE_MODULE is set: the proof runs over the in-process plane and is never skipped', false, 'PGLITE_MODULE unset'); process.exit(1); }
const { createMissionSourcesPlane } = await import('../test/support/mission-sources-plane.mjs');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'cache-control': 'private, no-store' }, body: JSON.stringify(body) });
const sub = (h) => { try { return JSON.parse(Buffer.from(String(h || '').replace(/^Bearer\s+/i, '').split('.')[1], 'base64').toString('utf8')); } catch { return null; } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function setup(viewport, plane, who = 'owner') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const errors = [];
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); });
  await ctx.addInitScript(plane.sessionScript(who));
  /* the test's own route, registered FIRST: static files and the shell's other calls; the plane's route (attached after it)
     wins for /v1/mission-sources* on the API origin */
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === 'https://api.mccluster.org') {
      const w = sub(req.headers().authorization);
      if (p === '/v1/status') return json(route, { ok: true, operator: { email: w?.email || '' }, database: { reachable: true } });
      if (p === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: w?.sub }, default_org_id: ORG, workspaces: [{ org_id: ORG, slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] });
      if (p === '/v1/mnet/bootstrap') return json(route, { identity: { mccluster_id: 'matthew' }, profile: { display_name: 'Plane owner', avatar_url: '' } });
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0 });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') { const w = sub(req.headers().authorization); return w ? json(route, { id: w.sub, email: w.email }) : json(route, { msg: 'invalid' }, 401); }
      return json(route, []);
    }
    if (u.origin === BASE) {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, '')); const file = resolve(SERVE, rel);
      if (!file.startsWith(SERVE + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  await plane.attach(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const posts = (plane) => plane.log.filter((x) => x.method === 'POST').length;
const card = (page) => page.locator('[data-mission-sources]');
const status = (page) => page.locator('[data-ms-source="drawdown"] [data-ms-status]');
async function openCard(page, view = 'applied') {
  await page.goto(BASE + '/control.html#create:action-network');
  await page.locator('[data-crn-tab="sources"]').click();
  await page.waitForFunction((v) => document.querySelector('[data-mission-sources]')?.getAttribute('data-ms-view') === v, view);
}
async function sizes(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-mission-sources]');
    const buttons = [...host.querySelectorAll('button, a.cr-btn')].filter((b) => b.offsetParent !== null).map((b) => ({ t: b.textContent.trim().slice(0, 40), h: Math.round(b.getBoundingClientRect().height) }));
    const fields = [...host.querySelectorAll('input:not([type="checkbox"])')].filter((i) => i.offsetParent !== null).map((i) => ({ f: parseFloat(getComputedStyle(i).fontSize), h: Math.round(i.getBoundingClientRect().height), labelled: !!i.labels && i.labels.length === 1 }));
    return { buttons, fields };
  });
}
const waitStatus = (page, kind) => page.waitForFunction((k) => document.querySelector('[data-ms-source="drawdown"] [data-ms-status]')?.getAttribute('data-ms-status') === k, kind);
const stateIs = (page, s) => page.waitForFunction((x) => document.querySelector('[data-ms-source="drawdown"]')?.getAttribute('data-ms-state') === x, s);
async function reason(page, text) { await page.locator('[data-ms-reason]').fill(text); }

async function proof(width) {
  const scope = String(width);
  const plane = await createMissionSourcesPlane();
  let ctx = null;
  try {
    const s = await setup({ width, height: 900 }, plane); ctx = s.ctx; const { page, errors } = s;
    const noOverflow = async (what) => check(scope, 'no horizontal overflow (' + what + ')', await overflow(page));
    await openCard(page);
    check(scope, 'the chip is pressed and the card reads the draft', /Project Drawdown · catalog drawdown · Draft · revision 1/.test(await card(page).innerText()));
    check(scope, 'a draft offers Preview and Show only', JSON.stringify(await page.locator('[data-ms-open]').evaluateAll((b) => b.map((x) => x.getAttribute('data-ms-open')))) === '["show"]');
    const prev = page.locator('[data-ms-preview]');
    check(scope, 'Preview opens the World on this origin in a new tab, with the owner preview', await prev.getAttribute('href') === '/mnet.html?source=project-drawdown&preview=1' && await prev.getAttribute('target') === '_blank');
    check(scope, 'the intro says it is McCluster Corp’s page, never the organization’s account', /It is McCluster Corp’s page, never the organization’s account\./.test(await card(page).innerText()));
    await noOverflow('draft');
    const sz = await sizes(page);
    check(scope, 'every button and the Preview link at least 44 px tall', sz.buttons.length >= 2 && sz.buttons.every((b) => b.h >= 44), sz.buttons);
    await page.screenshot({ path: join(OUT, 'sources-draft-' + width + '.png'), fullPage: true });

    /* Show: refused without the confirmation and a reason; then sent */
    await page.locator('[data-ms-open="show"]').click();
    const show = page.locator('[data-ms-send="show"]');
    check(scope, 'Show waits for the confirmation (aria-disabled, still focusable)', await show.getAttribute('aria-disabled') === 'true');
    let before = posts(plane);
    await show.focus(); await page.keyboard.press('Enter'); /* aria-disabled stays focusable and answers */
    await waitStatus(page, 'refused');
    check(scope, 'Show without the confirmation sends nothing and says why', posts(plane) === before && /Tick the confirmation and give the date it was confirmed\./.test(await status(page).innerText()));
    const f = await sizes(page);
    check(scope, 'every field is labelled, at least 44 px tall and at least 16 px type', f.fields.length >= 2 && f.fields.every((x) => x.f >= 16 && x.h >= 44 && x.labelled), f.fields);
    await page.locator('[data-ms-confirm]').check();
    await page.locator('[data-ms-confirmed-on]').fill('2026-11-19');
    check(scope, 'the refusal goes once the confirmation and its date are given', (await status(page).textContent()).trim() === '' && await status(page).getAttribute('data-ms-status') === '');
    check(scope, 'still waiting for a reason', await show.getAttribute('aria-disabled') === 'true');
    await reason(page, 'Matthew confirmed the written permission covers this page.');
    check(scope, 'with the confirmation, its date and a reason, Show is available', await show.getAttribute('aria-disabled') === null);
    await noOverflow('show confirmation');
    await page.screenshot({ path: join(OUT, 'sources-show-confirmation-' + width + '.png'), fullPage: true });
    await show.click();
    await stateIs(page, 'shown');
    const st = (await plane.call('owner', 'GET', '/v1/mission-sources')).body;
    check(scope, 'stored: Shown at revision 2, the reason typed, the confirmation date only', st.sources[0].state === 'shown' && st.sources[0].revision === 2 && st.history[0].reason === 'Matthew confirmed the written permission covers this page.' && st.history[0].permission_confirmed_on === '2026-11-19');
    check(scope, 'the card says it is public for every new visit and lists the history', /Shown: the page and its door are public for every new visit\./.test(await status(page).innerText()) && /Shown · revision 2 · Matthew confirmed the written permission covers this page\. · permission confirmed 19 November 2026/.test(await card(page).innerText()));
    check(scope, 'a shown page offers Preview, Hide and Edit words', JSON.stringify(await page.locator('[data-ms-open]').evaluateAll((b) => b.map((x) => x.getAttribute('data-ms-open')))) === '["hide","edit"]');
    await noOverflow('shown');
    await page.screenshot({ path: join(OUT, 'sources-shown-' + width + '.png'), fullPage: true });

    /* Edit words: refused before sending, then saved */
    await page.locator('[data-ms-open="edit"]').click();
    check(scope, 'editing a shown page says the change is public', /This page is public: the change shows on every new visit\./.test(await card(page).innerText()));
    await page.locator('[data-ms-role]').fill('Missions written with our partner, Project Drawdown.');
    await reason(page, 'Trying a role line.');
    before = posts(plane);
    await page.locator('[data-ms-send="edit"]').click();
    await waitStatus(page, 'refused');
    check(scope, 'a denied word is refused before sending, with the reason', posts(plane) === before && /These words cannot be saved/.test(await status(page).innerText()));
    await noOverflow('edit refused');
    await page.screenshot({ path: join(OUT, 'sources-words-refused-' + width + '.png'), fullPage: true });
    await page.locator('[data-ms-role]').fill('Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.');
    await page.locator('[data-ms-send="edit"]').click();
    await waitStatus(page, 'done');
    check(scope, 'saved at revision 3', /Saved\./.test(await status(page).innerText()) && (await plane.source()).revision === 3 && (await plane.source()).role_line.endsWith('by area.'));

    /* a change made elsewhere (a write the page does not make, through the plane as the owner), then Hide is refused as moved */
    const elsewhere = await plane.call('owner', 'POST', '/v1/mission-sources/commands', { command: 'edit', catalog: 'drawdown', expected_revision: 3, key: randomUUID(), reason: 'A change made elsewhere (test fixture).', payload: { role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.' } });
    check(scope, 'labelled fixture: a change made elsewhere moved the revision to 4', elsewhere.status === 200 && elsewhere.body.receipt.revision === 4);
    await page.locator('[data-ms-open="hide"]').click();
    await reason(page, 'Hide while checking.');
    await page.locator('[data-ms-send="hide"]').click();
    await waitStatus(page, 'refused');
    check(scope, 'refused as moved: nothing changed, and the card reads again', /This source changed since you opened it\./.test(await status(page).innerText()) && (await plane.source()).state === 'shown');
    await page.waitForFunction(() => /revision 4/.test(document.querySelector('[data-ms-line]')?.textContent || ''));

    /* Hide with the fresh revision; then a lost answer (committed, connection dropped): read back, never resent */
    plane.faults.add({ method: 'POST', path: '/v1/mission-sources/commands', mode: 'drop' });
    before = posts(plane);
    await page.locator('[data-ms-send="hide"]').click();
    await page.waitForFunction(() => /^Recorded\.$/.test(document.querySelector('[data-ms-source="drawdown"] [data-ms-status]')?.textContent || ''));
    check(scope, 'a lost answer is read back by key and found recorded; nothing resent', posts(plane) === before + 1 && (await plane.audits()) === 4 && (await plane.source()).state === 'hidden');
    await stateIs(page, 'hidden');
    check(scope, 'a hidden page offers Preview, Show and Edit words', JSON.stringify(await page.locator('[data-ms-open]').evaluateAll((b) => b.map((x) => x.getAttribute('data-ms-open')))) === '["show","edit"]');
    await noOverflow('hidden');
    await page.screenshot({ path: join(OUT, 'sources-hidden-' + width + '.png'), fullPage: true });

    /* a refused connection (nothing served): absent from the history, sent again by hand with the same key, recorded once */
    await page.locator('[data-ms-open="show"]').click();
    await page.locator('[data-ms-confirm]').check();
    await page.locator('[data-ms-confirmed-on]').fill('2026-11-19');
    await reason(page, 'Show again after the check.');
    plane.faults.add({ method: 'POST', path: '/v1/mission-sources/commands', mode: 'refuse' });
    before = posts(plane);
    await page.locator('[data-ms-send="show"]').click();
    await page.locator('[data-ms-again]').waitFor();
    check(scope, 'not in the history: the card says so and offers Send again, sending nothing by itself', /Not recorded\. Send it again: the same change is recorded at most once\./.test(await status(page).innerText()) && (await plane.audits()) === 4);
    await noOverflow('unknown outcome');
    await page.screenshot({ path: join(OUT, 'sources-unknown-outcome-' + width + '.png'), fullPage: true });
    await page.locator('[data-ms-again]').click();
    await stateIs(page, 'shown');
    const h = (await plane.call('owner', 'GET', '/v1/mission-sources')).body.history;
    check(scope, 'sent again by hand: recorded once, under the same key', (await plane.audits()) === 5 && h.filter((x) => x.reason === 'Show again after the check.').length === 1);
    check(scope, 'no page error', errors.length === 0, errors);
  } catch (e) { check(scope, 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 800)); } finally { if (ctx) await ctx.close().catch(() => {}); await plane.close(); }
}

async function onceAt390() {
  let ctx = null;
  const plane = await createMissionSourcesPlane({ apply: false });
  try {
    const s = await setup({ width: 390, height: 900 }, plane); ctx = s.ctx; const { page } = s;
    await openCard(page, 'not_applied');
    check('390 not applied', 'the store not applied is said, naming the pending file', /The mission sources table is not applied yet \(supabase\/pending\/20261119140000_mission_catalog_sources_v1\.sql\)/.test(await card(page).innerText()));
    check('390 not applied', 'no command is offered and nothing was sent', await page.locator('[data-ms-open]').count() === 0 && posts(plane) === 0);
    check('390 not applied', 'no horizontal overflow', await overflow(page));
    await page.screenshot({ path: join(OUT, 'sources-not-applied-390.png'), fullPage: true });
  } catch (e) { check('390 not applied', 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 600)); } finally { if (ctx) await ctx.close().catch(() => {}); await plane.close(); }
  const denied = await createMissionSourcesPlane();
  try {
    const s = await setup({ width: 390, height: 900 }, denied, 'viewer'); ctx = s.ctx; const { page } = s;
    await openCard(page, 'denied');
    check('390 denied', 'a viewer of the house sees only the denied line', (await card(page).innerText()).replace(/\s+/g, ' ').trim() === 'Mission sources Only the house owner can change a mission source.' && await page.locator('[data-ms-open], [data-ms-preview]').count() === 0);
    check('390 denied', 'no store call was made for the viewer', denied.rpcLog.length === 0);
    await page.screenshot({ path: join(OUT, 'sources-denied-390.png'), fullPage: true });
  } catch (e) { check('390 denied', 'the proof ran to the end', false, String(e && e.stack || e).slice(0, 600)); } finally { if (ctx) await ctx.close().catch(() => {}); await denied.close(); }
}

try {
  await onceAt390();
  for (const width of [390, 820, 1440]) await proof(width);
} finally { await browser.close(); }
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length || results.length === 0 ? 1 : 0);
