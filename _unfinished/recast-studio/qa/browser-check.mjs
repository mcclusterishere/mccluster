import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const errors = []; const requests = [];
try {
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  for (const viewport of [{ width:390,height:844 },{ width:820,height:1180 },{ width:1440,height:1100 }]) {
    await page.setViewportSize(viewport); await page.goto('http://127.0.0.1:4179');
    await page.waitForTimeout(120);
    const sizes = await page.evaluate(() => ({ scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth }));
    assert.equal(sizes.scroll,sizes.client,`horizontal overflow at ${viewport.width}`);
    await page.screenshot({path:join(root,`qa/recast-${viewport.width}.png`),fullPage:true});
  }
  await page.locator('#plan-button').click(); assert.match(await page.locator('#form-status').textContent(),/Choose both/);
  await page.locator('#source-input').setInputFiles(join(root,'qa/source-test.mp4'));
  await page.waitForFunction(() => document.getElementById('source-status').textContent === 'Local clip ready');
  await page.locator('#character-input').setInputFiles(join(root,'qa/reference-test.png'));
  await page.waitForFunction(() => !document.getElementById('character-preview').hidden);
  for (const id of ['shot-check','rights-footage','rights-likeness','rights-sharing']) await page.locator('#'+id).check();
  await page.locator('#budget').fill('2'); await page.locator('#plan-button').click();
  await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('exceeds'));
  await page.locator('#budget').fill('5'); await page.locator('#plan-button').click(); await page.locator('#take-card').waitFor({state:'visible'});
  const initial = JSON.parse(await page.locator('#provenance').textContent()); assert.equal(initial.readyForLive,false); assert.equal(initial.output,null);
  await page.locator('#simulate-button').click(); await page.waitForTimeout(100); await page.locator('#cancel-button').click();
  assert.match(await page.locator('#job-state').textContent(),/Canceled/); await page.waitForTimeout(2500); assert.match(await page.locator('#job-state').textContent(),/Canceled/);
  await page.locator('#plan-button').click(); await page.locator('#simulate-button').click();
  await page.waitForFunction(() => document.getElementById('job-state').textContent === 'Simulation complete');
  assert.match(await page.locator('#job-description').textContent(),/No generated output exists/);
  await page.locator('#duration').fill('6'); assert.equal(await page.locator('#take-card').isVisible(),false);
  await page.locator('#plan-button').click(); await page.locator('#take-card').waitFor({state:'visible'});
  await page.locator('#renderer').selectOption('openjutsu-h3-selfhost'); assert.equal(await page.locator('#rights-sharing').isChecked(),false);
  await page.locator('#rights-sharing').check(); await page.locator('#plan-button').click();
  await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('licens'));
  assert.equal(await page.locator('#take-card').isVisible(),false);
  await page.locator('#reset-button').click(); assert.equal(await page.locator('#source-preview').isVisible(),false);
  assert.equal(await page.locator('#rights-footage').isChecked(),false);
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:4179/')));
  console.log(JSON.stringify({passed:true,viewports:[390,820,1440],checks:['no overflow','local media preview','missing inputs','budget gate','plan','cancel timer','simulation','input invalidation','provider rights reset','H3 license block','reset','no outbound requests','no page errors'],networkRequestCount:requests.length},null,2));
} finally {await browser.close();}
