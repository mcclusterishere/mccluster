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
const places = JSON.parse(await readFile(join(root, 'core/data/fictional-city/places.v1.json'), 'utf8'));
const STATE_KEY = 'here.universe.mccluster-fictional-city.state';
// the original 27 plus any parcel-bound residents from lore revision 2 (PR #720)
const PEOPLE = city.npcs.length + city.garageCrew.length + (city.expansionNpcs?.length || 0);
const LORE_PARCELS = new Set((city.expansionBusinesses || []).map(b => b.parcelId));
const CHUNKS = JSON.parse(await readFile(join(root, 'data/fictional-city/chunks/index.v1.json'), 'utf8')).chunks.length;
const PLACES_SUMMARY = JSON.stringify({ neighborhoods: 6, parcels: places.parcels.length, vacant: places.parcels.filter(p => !LORE_PARCELS.has(p.id)).length, chunks: CHUNKS });
const metrics = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const results = [];
const ready = page => page.waitForFunction(() => window.MCC_CITY && document.querySelector('#city-canvas')?.dataset.ready === 'true');
const settled = page => page.waitForFunction(() => { const s = MCC_CITY.stats(); return s && s.chunks.loading === 0; });
// a device save written before the page starts, exactly as an earlier visit would have left it
async function withSave(context, save) {
  await context.addInitScript(({ key, save }) => { if (!sessionStorage.getItem('fixture-save')) { sessionStorage.setItem('fixture-save', '1'); localStorage.setItem(key, JSON.stringify(save)); } }, { key: STATE_KEY, save });
}
const v2 = (position, extra = {}) => ({ version: 2, credits: 250, position, inventory: {}, met: [], visited: [], receipts: [], story: { chapter: null }, discoveries: [], payments: [], ...extra });
async function holdUntil(page, key, predicate, arg, timeout = 90000) {
  await page.locator('#city-canvas').focus();
  await page.keyboard.down(key);
  try { await page.waitForFunction(predicate, arg, { timeout }); } finally { await page.keyboard.up(key); }
}
async function measure(page, label) {
  await settled(page); await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({ stats: MCC_CITY.stats(), heap: performance.memory?.usedJSHeapSize || null, bytes: performance.getEntriesByType('resource').filter(e => /fictional-city|three/.test(e.name)).reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0), area: document.querySelector('#city-location').textContent, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  metrics.push({ label, area: m.area, drawCalls: m.stats.drawCalls, triangles: m.stats.triangles, geometries: m.stats.geometries, textures: m.stats.textures, activeChunks: m.stats.chunks.active, loads: m.stats.chunks.loads, unloads: m.stats.chunks.unloads, hqLod: m.stats.hqLod, visibleNpcs: m.stats.visibleNpcs, heapBytes: m.heap, cityBytes: m.bytes, viewport: m.stats.viewport, overflow: m.scroll - m.client });
  return m;
}
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
  const page = await context.newPage(); page.setDefaultTimeout(120000); page.on('pageerror', e => errors.push(e.message)); // software WebGL runs the full city at about 2 fps
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
    check(width + ': all ' + PEOPLE + ' people, the original and Bridgeport places and ' + places.parcels.length + ' parcels are instantiated', stats.npcCount === PEOPLE && stats.buildings === expectedPlaces && stats.parcels === places.parcels.length, stats);
    check(width + ': all 13 Robbery 1s scene stops are instantiated', stats.storyStops === 13, stats);
    check(width + ': measured scene stays inside the preview geometry budget', stats.triangles < 150000 && stats.drawCalls < 300, stats);
    await page.screenshot({ path: join(out, 'city-' + width + '.png'), fullPage: false });
    await page.locator('.city-garage-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'neighbors-' + width + '.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => MCC_CITY.snapshot().position);
    await page.locator('#city-canvas').focus();
    await page.keyboard.down('d');
    try { await page.waitForFunction(p => { const n = MCC_CITY.snapshot().position; return Math.hypot(n.x - p.x, n.z - p.z) > .25; }, before, { timeout: 40000 }); }
    finally { await page.keyboard.up('d'); }
    const after = await page.evaluate(() => MCC_CITY.snapshot().position);
    check(width + ': keyboard walking changes player position', Math.hypot(after.x - before.x, after.z - before.z) > .2);
    const control = await page.locator('[data-move="north"]').boundingBox();
    const cdp = await context.newCDPSession(page);
    const touchBefore = await page.evaluate(() => MCC_CITY.snapshot().position);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: control.x + control.width / 2, y: control.y + control.height / 2, id: 12 }] });
    try { await page.waitForFunction(p => { const n = MCC_CITY.snapshot().position; return Math.hypot(n.x - p.x, n.z - p.z) > .25; }, touchBefore, { timeout: 40000 }); }
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
  /* ---------------- the expanded city ---------------- */
  {
    // an existing v1 save, as the first district wrote it, loads intact under v2
    const { context, page, errors } = await contextFor(390);
    const item = city.items.find(i => i.businessId === 'hordash');
    const v1 = { version: 1, revision: city.revision, credits: 199, position: { x: -16, z: -12.5, interior: null }, inventory: { [item.id]: 1 }, met: ['mike-hawk'], visited: ['hordash'], receipts: [{ itemId: item.id, price: item.price, at: 1762100000000 }], story: { chapter: 'tears-wont-fall' } };
    await withSave(context, v1);
    await page.goto(site + '/fictional-city.html'); await ready(page);
    const s = await page.evaluate(() => MCC_CITY.snapshot());
    check('v1 save migrates to v2 keeping credits, inventory, receipts, met, visited, chapter and position',
      s.version === 2 && s.credits === 199 && s.inventory[item.id] === 1 && s.receipts.length === 1 && s.receipts[0].at === v1.receipts[0].at && s.met[0] === 'mike-hawk' && s.visited.includes('hordash') && s.story.chapter === 'tears-wont-fall' && s.position.x === -16 && Array.isArray(s.discoveries), s);
    check('the city reports its geography: 5 neighbourhoods + the island, every parcel, every chunk; lore claims its parcels', JSON.stringify(await page.evaluate(() => MCC_CITY.places())) === PLACES_SUMMARY);
    // all eight original businesses: enter and leave each one
    for (const b of city.businesses) {
      await page.getByRole('button', { name: 'District map' }).click();
      await page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: b.name, exact: true }) }).first().getByRole('button', { name: 'About this spot' }).click();
      await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
      await page.waitForFunction(id => MCC_CITY.snapshot().position.interior === id, b.id);
      await page.getByRole('button', { name: 'Leave building' }).click();
      await page.waitForFunction(() => !MCC_CITY.snapshot().position.interior);
    }
    const visited = await page.evaluate(() => MCC_CITY.snapshot().visited);
    check('all eight original businesses entered and left', city.businesses.every(b => visited.includes(b.id)), { visited });
    // all 27 established people: every conversation opens from the directory
    for (const n of [...city.npcs, ...city.garageCrew]) {
      await page.getByRole('button', { name: 'Open the city directory' }).click();
      await page.locator('#city-dialog-body button.city-person').filter({ hasText: n.name }).first().click();
      await page.waitForFunction(name => document.querySelector('#city-dialog-title')?.textContent === name, n.name);
      await page.getByRole('button', { name: 'Close panel' }).click();
    }
    check('all 27 established characters interacted with', (await page.evaluate(() => MCC_CITY.snapshot().met)).length === 27);
    check('migrated device: no uncaught errors', errors.length === 0, { errors });
    await context.close();
  }
  {
    // insufficient funds are refused at the counter
    const { context, page } = await contextFor(390);
    await withSave(context, v2({ x: 0, z: 2.5, interior: null }, { credits: 3 }));
    await page.goto(site + '/fictional-city.html'); await ready(page);
    await page.getByRole('button', { name: 'District map' }).click();
    await page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: 'Hordash', exact: true }) }).getByRole('button', { name: 'About this spot' }).click();
    await page.getByRole('button', { name: 'Browse the counter' }).click();
    const buys = page.locator('#city-dialog-body button', { hasText: 'Buy' });
    check('insufficient credits: every counter purchase is refused and nothing is charged', (await buys.count()) === 3 && await buys.evaluateAll(n => n.every(b => b.disabled)) && (await page.evaluate(() => MCC_CITY.snapshot().credits)) === 3);
    await context.close();
  }
  {
    // garage kiosk → existing globe route; bridge walk; HQ doorway; HQ assets warm on approach
    const { context, page, requests } = await contextFor(1280);
    await withSave(context, v2({ x: 5.4, z: 3.6, interior: 'whip-equipped-garage' }));
    await page.goto(site + '/fictional-city.html'); await ready(page);
    await page.waitForFunction(() => /transportation globe/i.test(document.querySelector('#city-prompt').textContent));
    await page.getByRole('button', { name: 'Interact' }).click();
    check('the garage globe kiosk opens the existing transportation globe route', await page.locator('#city-dialog-body a[href*="action-globe.html"]').count() === 1);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.getByRole('button', { name: 'Leave building' }).click();
    await page.getByRole('button', { name: 'District map' }).click();
    await page.getByRole('button', { name: 'Walk to Equity Uprise Island' }).click();
    await page.waitForFunction(() => Math.abs(MCC_CITY.snapshot().position.z - 73) < 1);
    await page.waitForFunction(() => /Equity Uprise HQ/.test(document.querySelector('#city-prompt').textContent));
    check('HQ assets are prefetched on approach, never rendered in the city', await page.locator('link[data-city-prefetch="hq"]').count() === 2);
    await page.getByRole('button', { name: 'Interact' }).click();
    check('HQ doorway opens the existing detailed HQ exercise', await page.locator('#city-dialog-body a[href*="prim3-transit.html?level=equity-uprise-hq"]').count() === 1);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await measure(page, 'island (1280)');
    await page.locator('.city-stage').screenshot({ path: join(out, 'after-island-hq.png') });
    await context.close();
  }
  {
    const { context, page } = await contextFor(1280);
    await withSave(context, v2({ x: 0, z: 46, interior: null }));
    await page.goto(site + '/fictional-city.html'); await ready(page);
    // screen-relative keys: the camera turns to face the HQ as the island begins (z ≥ 67), so stop there
    await holdUntil(page, 's', () => MCC_CITY.snapshot().position.z > 66.5);
    const p = await page.evaluate(() => MCC_CITY.snapshot().position);
    check('walked the footbridge from the harbor promenade to the island shore', p.z > 66.5 && Math.abs(p.x) < 5, p);
    check('the island counts as found on foot', (await page.evaluate(() => MCC_CITY.snapshot().discoveries)).includes('hq-island'));
    await context.close();
  }
  {
    // walk across neighbourhood and chunk boundaries; water stops a body; doors and interiors in new areas
    const { context, page, errors } = await contextFor(1280);
    // west along Harbor Boulevard from Civic Center into Northside, across the x = −192 chunk edge
    await withSave(context, v2({ x: -160, z: -1, interior: null }));
    await page.goto(site + '/fictional-city.html'); await ready(page); await settled(page);
    const s0 = await page.evaluate(() => MCC_CITY.stats().chunks);
    await holdUntil(page, 'a', () => MCC_CITY.snapshot().position.x < -195);
    await settled(page);
    const s1 = await page.evaluate(() => ({ chunks: MCC_CITY.stats().chunks, p: MCC_CITY.snapshot(), area: document.querySelector('#city-location').textContent }));
    check('walked from Civic Center across a neighbourhood and chunk edge into Northside', s1.area === ((city.expansionNeighborhoods || []).find(n => n.id === 'northside-residential')?.name || 'Northside') && s1.p.discoveries.includes('northside-residential'), s1);
    check('chunks ahead loaded while walking (bounded active set)', s1.chunks.loads > s0.loads && s1.chunks.active <= 16, { s0, s1: s1.chunks });
    await page.locator('.city-stage').screenshot({ path: join(out, 'after-northside.png') });
    await measure(page, 'northside (1280)');
    // map travel to a far neighbourhood unloads what is behind
    await page.getByRole('button', { name: 'District map' }).click();
    // the first wharf workshop: a lore business once lore claims the parcel, otherwise the generic workshop
    const wharfBiz = (city.expansionBusinesses || []).find(x => x.parcelId === 'workshop-waterfront/shop-01');
    const wharfName = wharfBiz ? wharfBiz.name : 'Workshop', wharfId = wharfBiz ? wharfBiz.id : 'workshop-waterfront/shop-01';
    if (!wharfBiz) await page.locator('details.city-area-list').filter({ hasText: 'Workshop Wharf' }).locator('summary').click();
    const wharf = page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: wharfName, exact: true }) }).first();
    await wharf.getByRole('button', { name: 'Go to the door' }).click();
    await page.waitForFunction(() => MCC_CITY.snapshot().position.z > 60);
    await settled(page); await page.waitForTimeout(700); await settled(page);
    const s2 = await page.evaluate(() => MCC_CITY.stats().chunks);
    check('far chunks unload with hysteresis; active set stays bounded', s2.unloads > 0 && s2.active <= 16, s2);
    await page.waitForFunction(name => document.querySelector('#city-prompt').textContent.includes(name), wharfName);
    await page.getByRole('button', { name: 'Interact' }).click();
    await page.waitForFunction(id => MCC_CITY.snapshot().position.interior === id, wharfId);
    check('a new-neighbourhood workshop is an entered interior', true);
    await page.getByRole('button', { name: 'Leave building' }).click();
    await page.waitForFunction(() => !MCC_CITY.snapshot().position.interior);
    await page.locator('.city-stage').screenshot({ path: join(out, 'after-wharf.png') });
    await measure(page, 'workshop wharf (1280)');
    await context.close();
    const sea = await contextFor(1280);
    await withSave(sea.context, v2({ x: 100, z: 132, interior: null }));
    await sea.page.goto(site + '/fictional-city.html'); await ready(sea.page);
    await sea.page.locator('#city-canvas').focus(); await sea.page.keyboard.down('s'); await sea.page.waitForTimeout(4000); await sea.page.keyboard.up('s');
    const q = await sea.page.evaluate(() => MCC_CITY.snapshot().position);
    check('the sea wall stops a body at the quay edge', q.z < 140 && q.z > 135, q);
    await measure(sea.page, 'hq waterfront (1280)');
    await sea.page.locator('.city-stage').screenshot({ path: join(out, 'after-hq-waterfront.png') });
    // HQ overlook: the landmark interaction
    await sea.context.close();
    const look = await contextFor(390);
    await withSave(look.context, v2({ x: 36, z: 88, interior: null }));
    await look.page.goto(site + '/fictional-city.html'); await ready(look.page);
    await look.page.waitForFunction(() => /Equity Uprise HQ/.test(document.querySelector('#city-prompt').textContent));
    await look.page.getByRole('button', { name: 'Interact' }).click();
    check('the HQ overlook is an interaction with a route to the footbridge', await look.page.getByRole('button', { name: 'Go to the footbridge' }).count() === 1);
    await look.page.getByRole('button', { name: 'Close panel' }).click();
    await look.page.locator('.city-stage').screenshot({ path: join(out, 'after-hq-overlook-390.png') });
    await look.context.close();
    check('expansion walk: no uncaught errors', errors.length === 0, { errors });
  }
  {
    // a failed chunk download falls back to massing (collision is never streamed) and recovers on retry
    const { context, page } = await contextFor(1280);
    let fail = true;
    await context.route(url => url.pathname.endsWith('/data/fictional-city/chunks/c-2_-1.json'), route => fail ? route.fulfill({ status: 503, body: 'fixture outage' }) : route.fallback());
    await withSave(context, v2({ x: -100, z: -16, interior: null }));
    await page.goto(site + '/fictional-city.html'); await ready(page);
    await page.waitForFunction(() => MCC_CITY.stats().chunks.fallback.includes('c-2_-1'));
    check('failed chunk: massing fallback, doors still interactable', await page.evaluate(() => /Police|Enter/.test(document.querySelector('#city-prompt').textContent) || MCC_CITY.stats().chunks.failures > 0));
    fail = false;
    await page.waitForFunction(() => MCC_CITY.stats().chunks.ready.includes('c-2_-1'), undefined, { timeout: 30000 });
    check('failed chunk recovers on retry with full detail', true);
    await page.locator('.city-stage').screenshot({ path: join(out, 'after-civic.png') });
    await measure(page, 'civic center (1280)');
    await context.close();
  }
  if (city.expansionBusinesses?.length) {
    // lore revision 2: a parcel-bound business is enterable at its parcel; a bribe spends city credits; refusal when short
    const bribe = city.expansionBusinesses.flatMap(b => (b.interactions || []).filter(i => i.type === 'bribe').map(i => ({ ...i, businessId: b.id }))).sort((a, b) => a.price - b.price)[0];
    const officer = city.expansionNpcs.find(n => n.id === bribe.npcIds[0]);
    const { context, page, errors } = await contextFor(390);
    await page.goto(site + '/fictional-city.html'); await ready(page);
    await page.getByRole('button', { name: 'Open the city directory' }).click();
    await page.locator('#city-dialog-body button.city-person').filter({ hasText: officer.name }).first().click();
    const before = await page.evaluate(() => MCC_CITY.snapshot().credits);
    await page.locator(`[data-interaction="${bribe.id}"]`).click();
    const paid = await page.evaluate(() => MCC_CITY.snapshot());
    check('a lore bribe deducts its price in city credits and records the payment', paid.credits === before - bribe.price && paid.payments.length === 1 && paid.payments[0].interactionId === bribe.id);
    check('the bribe outcome is shown', (await page.locator('#city-dialog-body').textContent()).includes(bribe.outcome));
    await page.reload(); await ready(page);
    check('payment survives reload', (await page.evaluate(() => MCC_CITY.snapshot().payments.length)) === 1);
    const minor = city.expansionNpcs.find(n => n.minor === true);
    await page.getByRole('button', { name: 'Open the city directory' }).click();
    await page.locator('#city-dialog-body button.city-person').filter({ hasText: minor.name }).first().click();
    check('a minor never offers a paid interaction', await page.locator('#city-dialog-body [data-interaction]').count() === 0);
    await page.getByRole('button', { name: 'Close panel' }).click();
    const biz = city.expansionBusinesses.find(b => b.id === bribe.businessId);
    await page.getByRole('button', { name: 'District map' }).click();
    await page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: biz.name, exact: true }) }).first().getByRole('button', { name: 'About this spot' }).click();
    await page.getByRole('button', { name: 'Walk inside', exact: true }).click();
    await page.waitForFunction(id => MCC_CITY.snapshot().position.interior === id, biz.id);
    check('a parcel-bound lore business is an entered interior', true);
    await page.locator('.city-stage').screenshot({ path: join(out, 'after-lore-interior-390.png') });
    check('lore binding: no uncaught errors', errors.length === 0, { errors });
    await context.close();
    const broke = await contextFor(390);
    await withSave(broke.context, v2({ x: 0, z: 2.5, interior: null }, { credits: bribe.price - 1 }));
    await broke.page.goto(site + '/fictional-city.html'); await ready(broke.page);
    await broke.page.getByRole('button', { name: 'Open the city directory' }).click();
    await broke.page.locator('#city-dialog-body button.city-person').filter({ hasText: officer.name }).first().click();
    check('a bribe is refused when short of credits', await broke.page.locator(`[data-interaction="${bribe.id}"]`).isDisabled() && (await broke.page.evaluate(() => MCC_CITY.snapshot().credits)) === bribe.price - 1);
    await broke.context.close();
  }
  {
    // no WebGL: the full city map, its places, the directory and the Bridgeport story route still work
    const { context, page, errors } = await contextFor(390);
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : original.call(this, type, ...rest); };
    });
    await page.goto(site + '/fictional-city.html');
    await page.waitForFunction(() => document.documentElement.dataset.cityReady === 'true' && window.MCC_CITY);
    check('no WebGL: the city starts without a 3D scene', (await page.evaluate(() => MCC_CITY.stats())) === null);
    await page.getByRole('button', { name: 'District map' }).click();
    check('no WebGL: the whole-city map draws every parcel', await page.locator('.city-map rect[data-place]').count() >= places.parcels.length);
    const biz = (city.expansionBusinesses || [])[0];
    if (biz) {
      await page.locator('.city-place-card').filter({ has: page.getByRole('heading', { name: biz.name, exact: true }) }).first().getByRole('button', { name: 'About this spot' }).click();
      check('no WebGL: a new-neighbourhood business opens from the map', (await page.locator('#city-dialog-title').textContent()) === biz.name);
      await page.getByRole('button', { name: 'Close panel' }).click();
    }
    if ((city.neighborhoods || []).length) {
      await page.getByRole('button', { name: 'District map' }).click();
      await page.getByRole('button', { name: 'Bridgeport · Robbery 1s' }).click();
      check('no WebGL: the Bridgeport map and its story route remain', await page.getByRole('button', { name: 'Open The Robbery 1s' }).count() === 1);
      await page.getByRole('button', { name: 'Close panel' }).click();
    }
    check('no WebGL: no uncaught errors', errors.length === 0, { errors });
    await context.close();
  }
  for (const width of [390, 768, 1440]) {
    const { context, page } = await contextFor(width);
    await page.goto(site + '/fictional-city.html'); await ready(page);
    const m = await measure(page, 'opening view (' + width + ')');
    check(width + ': no horizontal overflow on the expanded city', m.scroll === m.client, { scroll: m.scroll, client: m.client });
    await page.getByRole('button', { name: 'District map' }).click();
    await page.locator('.city-map').screenshot({ path: join(out, 'map-after-' + width + '.png') });
    const dialogOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(width + ': the whole-city map fits without overflow', dialogOverflow === 0);
    await context.close();
  }
} finally {
  await writeFile(join(out, 'metrics.json'), JSON.stringify({ environment: 'Headless Chromium, SwiftShader software WebGL, device pixel ratio 1; not a physical device', metrics }, null, 2));
  await writeFile(join(out, 'results.json'), JSON.stringify({ environment: 'Chromium software WebGL; owner/API fixtures, actual Three 0.180 and authored content', results }, null, 2));
  await browser.close();
}
