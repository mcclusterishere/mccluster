// Serve repository root locally first; no production connections.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.MISSION_LAB_URL || 'http://127.0.0.1:8765/tools/prim3-mission-lab.html');
    await page.click('#draft'); await page.check('#fiction'); await page.check('#geography');
    await page.click('#approve'); await page.click('#release'); await page.click('#begin');
    async function answer() {
      const n = (await page.locator('#question').textContent()).match(/-?\d+/g).map(Number);
      await page.fill('#answer', String(Math.abs(n[2] - n[0])));
      await page.locator('#answerForm button').first().click();
    }
    await answer(); await page.click('#hint'); await answer(); await page.click('#finish');
    assert.equal(await page.locator('#debrief').isVisible(), true);
    assert.match(await page.locator('#summary').textContent(), /2 of 2 answers correct; 1 without a hint/);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth), true);
    console.log(`PASS ${width}px brief → practice → hint → debrief, no errors/overflow`);
    await page.close();
  }
} finally { await browser.close(); }
