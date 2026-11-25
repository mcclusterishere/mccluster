/* Real World editor controls with synthetic owner responses and local files only.
   This verifies draft validation, storage failure and navigation, not globe rendering.
   PLAYWRIGHT_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chromium node scripts/e2e/prim3-world-controls.e2e.mjs */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'));
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = 'https://matthew.mccluster.org';
const DRAFT = 'prim3.world.drafts.v1';
const fixture = JSON.parse(await readFile(join(ROOT, 'data/prim3/world-missions.json'), 'utf8'));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox','--disable-dev-shm-usage'] });
async function open({ owner = true, failStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, reducedMotion:'reduce', serviceWorkers:'block' });
  await ctx.addInitScript(({failStorage,DRAFT}) => {
    localStorage.setItem('mccdb_session', JSON.stringify({access_token:'synthetic-owner',expires_at:Math.floor(Date.now()/1000)+3600}));
    if (failStorage) { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k === DRAFT) throw new DOMException('Quota exceeded','QuotaExceededError'); return set.call(this,k,v); }; }
  }, {failStorage,DRAFT});
  const requests = [], navigations = [], errors = [];
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()); requests.push(u.pathname);
    if (u.hostname === 'api.mccluster.org') return route.fulfill({status:u.pathname === '/v1/status' && !owner ? 403 : 200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify(u.pathname === '/v1/status' ? {ok:owner} : {items:[]})});
    if (u.origin !== BASE) return route.abort(); // intentional globe-unavailable path; no external dependencies
    if (u.pathname === '/prim3-transit.html' && req.isNavigationRequest()) {
      navigations.push(u.href);
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Captured local play test</title><p>Navigation fixture</p>'});
    }
    const f = resolve(ROOT,decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(resolve(ROOT)+sep)) return route.abort();
    try { return route.fulfill({contentType:MIME[extname(f)] || 'application/octet-stream',body:await readFile(f)}); }
    catch { return route.fulfill({status:404,body:''}); }
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(BASE+'/prim3-world.html', {waitUntil:'domcontentloaded'});
  if (owner) {
    await page.locator('[data-mode="edit"]').click();
    await page.locator('#pwF-title').waitFor();
  } else await page.waitForFunction(() => document.querySelector('[data-owner-msg]')?.textContent.includes('house owner'));
  return {ctx,page,requests,navigations,errors};
}
async function scenario(name, options, verify) {
  const run = await open(options);
  try { await verify(run); assert.deepEqual(run.errors,[], 'No uncaught page errors'); console.log('PASS '+name); }
  finally { await run.ctx.close(); }
}
try {
  await scenario('invalid mission cannot start or create a browser draft', {}, async ({page,navigations}) => {
    await page.locator('#pwF-title').fill('');
    await page.locator('[data-act="playtest"]').click();
    await page.waitForFunction(() => document.getElementById('pwStatus').textContent.includes('Title is required'));
    assert.equal(new URL(page.url()).pathname,'/prim3-world.html'); assert.deepEqual(navigations,[]);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),DRAFT),null);
  });
  await scenario('duplicate mission ID cannot start a play test', {}, async ({page,navigations}) => {
    await page.locator('#pwF-id').fill(fixture.missions[1].id);
    await page.locator('[data-act="playtest"]').click();
    await page.waitForFunction(() => document.getElementById('pwStatus').textContent.includes('unique'));
    assert.deepEqual(navigations,[]); assert.equal(await page.evaluate(key=>localStorage.getItem(key),DRAFT),null);
  });
  await scenario('failed draft storage prevents play-test navigation', {failStorage:true}, async ({page,navigations}) => {
    await page.locator('#pwF-title').fill('Unsaved fixture title');
    await page.locator('[data-act="playtest"]').click();
    await page.waitForFunction(() => document.getElementById('pwStatus').textContent.includes('Play test has not started'));
    assert.deepEqual(navigations,[]); assert.equal(await page.evaluate(key=>localStorage.getItem(key),DRAFT),null);
  });
  await scenario('renamed ID and edited title are saved before current-ID navigation', {}, async ({page,navigations}) => {
    await page.locator('#pwF-id').fill('fixture-renamed-mission');
    await page.locator('#pwF-title').fill('Edited fixture mission');
    await page.locator('[data-act="playtest"]').click();
    await page.waitForURL('**/prim3-transit.html?**');
    assert.equal(navigations.length,1);
    const target = new URL(navigations[0]); assert.equal(target.searchParams.get('mission'),'fixture-renamed-mission'); assert.equal(target.searchParams.get('new'),'1');
    const saved = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),DRAFT);
    const mission = saved.missions.find(m=>m.id==='fixture-renamed-mission'); assert.equal(mission.title,'Edited fixture mission');
    assert.ok(!saved.missions.some(m=>m.id===fixture.missions[0].id));
  });
  await scenario('server 403 keeps editor controls and mission modules unloaded', {owner:false}, async ({page,requests,navigations}) => {
    assert.equal(await page.locator('[data-mode="edit"]').count(),0);
    assert.equal(await page.locator('[data-act="playtest"]').count(),0);
    assert.ok(!requests.includes('/js/prim3-world/app.mjs'));
    assert.ok(!requests.includes('/js/prim3-world/news-desk.mjs'));
    assert.ok(!requests.includes('/data/prim3/world-missions.json'));
    assert.deepEqual(navigations,[]);
  });
} finally { await browser.close(); }
