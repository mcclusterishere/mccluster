/* Full host verification with actual Three.js and local canonical lore.
   All account/Core/external requests are fixtures; no production account is accessed.
   CHROMIUM_PATH=/path/to/chromium THREE180_DIR=/path/to/cached/three180 node scripts/e2e/fictional-city.e2e.mjs [output]
*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishCity } from '../../tools/publish-fictional-city.mjs';
import { readGameLore } from '../../core/src/game-lore.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = process.argv[2] || '/tmp/fictional-city-qa';
const site = 'https://matthew.mccluster.org';
const threeDir = process.env.THREE180_DIR;
if (!threeDir) throw new Error('THREE180_DIR must contain exact three.module.js and three.core.js version 0.180.0');
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))('playwright');
await publishCity(root); await mkdir(out, { recursive: true });
const city = JSON.parse(await readFile(join(root, 'core/data/fictional-city/district.v1.json'), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const results = [];
function check(name, value, detail = {}) { results.push({ name, pass: !!value, ...detail }); console.log((value ? 'PASS ' : 'FAIL ') + name); assert.ok(value, name); }
async function contextFor(width, role = 'owner') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, hasTouch: width < 700, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const requests = [], errors = [];
  await context.addInitScript(({ role }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    if (role !== 'guest') {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'fixture.' + btoa(JSON.stringify({ sub: 'city-fixture', exp: expires })) + '.fixture', expires_at: expires, refresh_token: 'fixture-only', user: { id: 'city-fixture', email: 'city-fixture@example.invalid' } }));
    }
  }, { role });
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(value) });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push(url.href);
    if (request.method() === 'OPTIONS') return json(route, {}, 200);
    if (url.hostname === 'api.mccluster.org') {
      if (url.pathname === '/v1/status') return json(route, { ok: role === 'owner' }, role === 'owner' ? 200 : 403);
      if (url.pathname === '/v1/core/mcp') {
        if (role !== 'owner') return json(route, { error: 'forbidden' }, 403);
        const rpc = request.postDataJSON();
        try {
          const lore = await readGameLore(rpc.params.arguments);
          return json(route, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify({ capability: 'game.lore.read', result: { result: lore } }) }] } });
        } catch (e) { return json(route, { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }); }
      }
      return json(route, { ok: true, items: [], rows: [], threads: [], posts: [], events: [], missions: [], sources: [], layers: [], features: [], profile: {} });
    }
    if (url.hostname.endsWith('supabase.co')) {
      if (url.pathname.endsWith('/user')) return json(route, { id: 'city-fixture', email: 'city-fixture@example.invalid' });
      return json(route, []);
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/three@0.180.0/build/')) {
      const name = url.pathname.split('/').at(-1);
      if (['three.module.js', 'three.core.js'].includes(name)) return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(threeDir, name)) });
    }
    if (url.origin === site) {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(resolve(root) + sep)) return route.fulfill({ status: 403 });
      try { return route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', body: await readFile(path) }); }
      catch { return route.fulfill({ status: 404, body: 'Not found' }); }
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  const page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', e => errors.push(e.message));
  return { context, page, requests, errors };
}
try {
  for (const role of ['guest', 'member']) {
    const { context, page, requests } = await contextFor(390, role);
    await page.goto(site + '/fictional-city.html'); await page.waitForFunction(() => document.documentElement.dataset.ownerAccess === 'closed');
    check(role + ': owner gate denies access', await page.locator('#city-canvas').count() === 0);
    check(role + ': neither game runtime nor fictional data loads before owner approval', !requests.some(url => /\/js\/fictional-city\/|\/data\/fictional-city\//.test(url)));
    await context.close();
  }
  for (const width of [390, 1280]) {
    const { context, page, requests, errors } = await contextFor(width);
    await page.goto(site + '/fictional-city.html');
    await page.waitForFunction(() => document.documentElement.dataset.cityReady === 'true' && window.MCC_CITY && document.querySelector('#city-canvas')?.dataset.ready === 'true');
    await page.waitForFunction(() => MCC_CITY.loreSource() === 'connected');
    check(width + ': authenticated Core reads match the exact published lore bytes', await page.evaluate(() => MCC_CITY.loreSource()) === 'connected');
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, canvas: document.querySelector('#city-canvas').getBoundingClientRect().width }));
    check(width + ': no horizontal page overflow', dimensions.width === dimensions.scroll, dimensions);
    const stats = await page.evaluate(() => MCC_CITY.stats());
    const expectedPlaces = city.businesses.length + 1 + (city.neighborhoods || []).reduce((count, area) => count + area.places.length, 0);
    check(width + ': all 27 people and original plus neighborhood places are instantiated', stats.npcCount === 27 && stats.buildings === expectedPlaces, stats);
    check(width + ': all 13 Robbery 1s scene stops are instantiated', stats.storyStops === 13, stats);
    check(width + ': measured scene stays inside the preview geometry budget', stats.triangles < 150000 && stats.drawCalls < 300, stats);
    await page.screenshot({ path: join(out, 'city-' + width + '.png'), fullPage: false });
    await page.locator('.city-garage-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'neighbors-' + width + '.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => MCC_CITY.snapshot().position);
    await page.locator('#city-canvas').focus();
    await page.keyboard.down('d');
    try { await page.waitForFunction(p => { const n = MCC_CITY.snapshot().position; return Math.hypot(n.x - p.x, n.z - p.z) > .25; }, before, { timeout: 10000 }); }
    finally { await page.keyboard.up('d'); }
    const after = await page.evaluate(() => MCC_CITY.snapshot().position);
    check(width + ': keyboard walking changes player position', Math.hypot(after.x - before.x, after.z - before.z) > .2);
    const control = await page.locator('[data-move="north"]').boundingBox();
    const cdp = await context.newCDPSession(page);
    const touchBefore = await page.evaluate(() => MCC_CITY.snapshot().position);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: control.x + control.width / 2, y: control.y + control.height / 2, id: 12 }] });
    try { await page.waitForFunction(p => { const n = MCC_CITY.snapshot().position; return Math.hypot(n.x - p.x, n.z - p.z) > .25; }, touchBefore, { timeout: 10000 }); }
    finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    const touchAfter = await page.evaluate(() => MCC_CITY.snapshot().position);
    check(width + ': actual touch on the direction control moves the player', Math.hypot(touchAfter.x - touchBefore.x, touchAfter.z - touchBefore.z) > .2);
    await cdp.detach();
    check(width + ': movement controls preserve browser pinch zoom', await page.locator('#city-canvas').evaluate(n => getComputedStyle(n).touchAction.includes('pinch-zoom')));

    await page.getByRole('button', { name: 'Head to the garage' }).click();
    await page.waitForFunction(() => MCC_CITY.snapshot().position.interior === 'whip-equipped-garage');
    check(width + ': garage is an actual entered interior', (await page.evaluate(() => MCC_CITY.stats())).interior === 'whip-equipped-garage');
    await page.locator('#city-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'garage-' + width + '.png'), fullPage: false });
    await page.getByRole('button', { name: 'Leave building' }).click();
    await page.waitForFunction(() => !MCC_CITY.snapshot().position.interior);

    await page.getByRole('button', { name: 'District map' }).click();
    const tea = page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: 'GAURANFUCKING TEA', exact: true }) });
    await tea.getByRole('button', { name: 'About this spot' }).click();
    await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
    await page.waitForFunction(() => MCC_CITY.snapshot().position.interior === 'gauranfucking-tea');
    await page.reload(); await page.waitForFunction(() => window.MCC_CITY && document.querySelector('#city-canvas')?.dataset.ready === 'true');
    check(width + ': reload restores the entered building', await page.evaluate(() => MCC_CITY.snapshot().position.interior) === 'gauranfucking-tea');
    await page.getByRole('button', { name: 'Leave building' }).click();
    await page.getByRole('button', { name: 'Open the city directory' }).click();
    await page.locator('#city-dialog-body').getByRole('button').filter({ hasText: 'Mike Hawk' }).first().click();
    const candidate = city.npcs.find(n => n.name === 'Mike Hawk');
    await page.getByRole('button', { name: candidate.dialogue.topics[0].label, exact: true }).click();
    check(width + ': a selected NPC conversation renders all authored exchanges', await page.locator('.city-script-line').count() === candidate.dialogue.topics[0].lines.length);
    check(width + ': meeting an NPC records discovery', (await page.evaluate(() => MCC_CITY.snapshot().met)).includes(candidate.id));
    await page.screenshot({ path: join(out, 'dialogue-' + width + '.png'), fullPage: false });
    await page.getByRole('button', { name: 'Close panel' }).click();

    await page.getByRole('button', { name: 'District map' }).click();
    await page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: 'GAURANFUCKING TEA', exact: true }) }).getByRole('button', { name: 'About this spot' }).click();
    await page.getByRole('button', { name: 'Browse the counter' }).click();
    const item = city.items.find(i => i.businessId === 'gauranfucking-tea');
    const balance = await page.evaluate(() => MCC_CITY.snapshot().credits);
    await page.getByRole('button', { name: 'Buy ' + item.name + ' for ' + item.price + ' credits', exact: true }).click();
    const bought = await page.evaluate(() => MCC_CITY.snapshot());
    check(width + ': purchase deducts only game credits and adds one item', bought.credits === balance - item.price && bought.inventory[item.id] === 1);
    await page.screenshot({ path: join(out, 'shop-' + width + '.png'), fullPage: false });
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.reload(); await page.waitForFunction(() => window.MCC_CITY && document.querySelector('#city-canvas')?.dataset.ready === 'true');
    const restored = await page.evaluate(() => MCC_CITY.snapshot());
    check(width + ': pocket and discovery survive reload', restored.inventory[item.id] === 1 && restored.credits === bought.credits && restored.met.includes(candidate.id));
    check(width + ': no real checkout is contacted', !requests.some(url => /stripe|checkout|paypal/i.test(url)));

    await page.getByRole('button', { name: 'Whip Equipped story desk', exact: true }).click();
    await page.getByRole('button', { name: '1 Test Drive', exact: true }).waitFor();
    check(width + ': full chapter desk includes the canonical ending order', await page.locator('#city-dialog-body button.city-person').count() === 13);
    await page.getByRole('button', { name: '1 Test Drive', exact: true }).click();
    await page.getByText('Before the song · 2T', { exact: true }).waitFor();
    check(width + ': story desk contains full dialogue and video/after sections', await page.locator('#city-dialog-body details').count() === 3 && (await page.locator('#city-dialog-body').textContent()).includes('G20'));
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.getByRole('button', { name: 'Transportation & other worlds' }).click();
    check(width + ': departure desk uses existing HQ and owner globe routes', await page.locator('#city-dialog-body a[href*="prim3-transit.html?level=equity-uprise-hq"]').count() === 1 && await page.locator('#city-dialog-body a[href*="action-globe.html"]').count() === 1);
    check(width + ': no uncaught browser errors', errors.length === 0, { errors });
    await context.close();
  }
  {
    const { context, page } = await contextFor(390);
    let finishStory;
    const deferred = new Promise(resolve => { finishStory = resolve; });
    await context.route(url => url.pathname.endsWith('/data/fictional-city/whip-story.v1.json'), async route => {
      await deferred;
      await route.fulfill({ status: 503, body: 'Fixture: delayed unavailable screenplay' });
    });
    await page.goto(site + '/fictional-city.html');
    await page.waitForFunction(() => window.MCC_CITY && document.querySelector('#city-canvas')?.dataset.ready === 'true');
    const storyRequest = page.waitForRequest(request => request.url().includes('/data/fictional-city/whip-story.v1.json'));
    await page.getByRole('button', { name: 'Whip Equipped story desk', exact: true }).click();
    await storyRequest;
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.getByRole('button', { name: 'Open the city directory' }).click();
    await page.locator('#city-dialog-body').getByRole('button').filter({ hasText: 'Mike Hawk' }).first().click();
    const storyFailure = page.waitForResponse(response => response.url().includes('/data/fictional-city/whip-story.v1.json'));
    finishStory();
    await storyFailure;
    await page.waitForTimeout(100);
    check('late failed screenplay load cannot replace a newly opened resident conversation', await page.locator('#city-dialog-title').textContent() === 'Mike Hawk' && !(await page.locator('#city-dialog-body').textContent()).includes('could not'));
    await context.close();
  }
} finally {
  await writeFile(join(out, 'results.json'), JSON.stringify({ environment: 'Chromium software WebGL; owner/API fixtures, actual Three 0.180 and authored content', results }, null, 2));
  await browser.close();
}
