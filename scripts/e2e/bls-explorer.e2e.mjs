/* Sealed browser fixture for the actual Control source inspector modules.
   This is not signed-in production, live BLS, or full-shell acceptance. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const out = process.env.BLS_PROOF_DIR || '/tmp/bls-explorer-proof';
await mkdir(out, { recursive: true });
const css = await Promise.all(['control-analytics-unified', 'control-bls-explorer'].map(name => readFile(new URL('../../css/' + name + '.css', import.meta.url), 'utf8')));
const scripts = await Promise.all(['bls-explorer', 'analytics-unified'].map(name => readFile(new URL('../../js/control-room/' + name + '.js', import.meta.url), 'utf8')));
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ['--no-sandbox'] });
async function mount(page) {
  await page.setContent('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLS Control fixture</title><style>body{margin:0;background:#09090b;font:16px system-ui;color:#eee;--k-line:#333;--k-serif:system-ui}main{padding:12px;max-width:960px;margin:auto;box-sizing:border-box}*{box-sizing:border-box}</style><main id="root"></main></html>');
  for (const text of css) await page.addStyleTag({ content: text });
  for (const text of scripts) await page.addScriptTag({ content: text });
  await page.evaluate(() => {
    const U = window.CR.analyticsUnified;
    U.state.sources = [
      { key: 'bls', name: 'Bureau of Labor Statistics', configured: true, entitlement: { allowed: true }, persistence: 'persistent' },
      { key: 'usgs', name: 'USGS', configured: true, entitlement: { allowed: true } },
    ];
    U.state.readiness = { database_schema_ready: false };
    window.calls = []; window.mode = 'ok'; window.finishRead = null;
    const data = { result: { source: 'bls', operation: 'timeseries', access_mode: 'unregistered', fetched_at: '2026-11-07T12:00:00Z', attribution: 'Synthetic BLS-shaped fixture, not real observations', records: [
      ['M01', 2], ['M02', null], ['M03', 3], ['M04', 4], ['M13', 3],
    ].map(([period, value]) => ({ metric: 'LNS14000000', value_number: value, unit: null, properties: { year: '2024', period, footnote_codes: ['P'] } })) } };
    window.paint = () => { const root = document.getElementById('root'); root.innerHTML = U.intelligence(); U.bind(root, async (path, options) => {
      window.calls.push({ path, ...options });
      if (window.mode === 'failure') throw Error('Fixture upstream unavailable');
      if (window.mode === 'delay') return new Promise(resolve => { window.finishRead = () => resolve(data); });
      return data;
    }, window.paint); };
    window.paint();
  });
}
try {
  for (const width of [390, 820, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mount(page);
    await page.locator('[data-cu-source="bls"]').click();
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    assert.equal(await page.locator('[data-cu-archive]').isDisabled(), true);
    await page.getByLabel('BLS series ID', { exact: true }).fill('lns14000000');
    await page.getByLabel('Start year', { exact: true }).fill('2024');
    await page.getByLabel('End year', { exact: true }).fill('2024');
    await page.getByRole('button', { name: 'Read BLS snapshot', exact: true }).click();
    await page.getByRole('heading', { name: 'BLS observations' }).waitFor();
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls, [{ path: '/v1/seek-first/fetch/bls', method: 'POST', body: { series_id: 'LNS14000000', start_year: 2024, end_year: 2024, lane: 'INTERNAL', persist: false, include_raw: false } }]);
    assert.equal(await page.locator('.cu-bls-results tbody tr').count(), 5);
    assert.match(await page.locator('.cu-bls-results').innerText(), /Not reported/);
    assert.match(await page.locator('.cu-bls-results').innerText(), /2024 average \(M13\)/);
    const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, input: getComputedStyle(document.getElementById('cuBlsSeries')).fontSize }));
    assert.equal(sizes.scroll, sizes.client, 'no horizontal overflow at ' + width);
    assert.ok(parseFloat(sizes.input) >= 16, 'no iOS input zoom');
    await page.screenshot({ path: join(out, 'bls-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Clear snapshot', exact: true }).click();
    assert.equal(await page.locator('.cu-bls-results').count(), 0);
    await page.evaluate(() => { window.mode = 'delay'; });
    await page.getByRole('button', { name: 'Read BLS snapshot', exact: true }).click();
    await page.waitForFunction(() => window.finishRead !== null);
    assert.equal(await page.getByRole('button', { name: 'Reading BLS…', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Clear snapshot', exact: true }).click();
    await page.evaluate(() => window.finishRead());
    assert.equal(await page.locator('.cu-bls-results').count(), 0);
    await page.evaluate(() => { window.mode = 'failure'; });
    await page.getByRole('button', { name: 'Read BLS snapshot', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture upstream unavailable' }).waitFor();
    await page.evaluate(() => { window.mode = 'ok'; });
    await page.getByRole('button', { name: 'Read BLS snapshot', exact: true }).click();
    await page.getByRole('heading', { name: 'BLS observations' }).waitFor();
    await page.locator('[data-cu-source="usgs"]').click();
    assert.equal(await page.locator('.cu-bls-results').count(), 0);
    assert.equal(await page.locator('#cuSnapshot').count(), 1);
    await page.locator('[data-cu-source="bls"]').click();
    await page.getByLabel('BLS series ID', { exact: true }).fill('LNS14000000');
    await page.evaluate(() => { window.CR.analyticsUnified.state.sources[0].entitlement.allowed = false; window.paint(); });
    assert.equal(await page.getByRole('button', { name: 'Read BLS snapshot', exact: true }).isDisabled(), true);
    const before = await page.evaluate(() => window.calls.length);
    await page.evaluate(() => document.getElementById('cuBlsSnapshot').dispatchEvent(new Event('submit', { cancelable: true })));
    assert.equal(await page.evaluate(() => window.calls.length), before);
    await page.evaluate(() => { window.CR.analyticsUnified.clearPrivate(); window.paint(); });
    assert.equal(await page.locator('#cuBlsSnapshot').count(), 0);
    await page.reload(); await mount(page); await page.locator('[data-cu-source="bls"]').click();
    assert.equal(await page.locator('.cu-bls-results').count(), 0);
    assert.equal(await page.getByLabel('BLS series ID', { exact: true }).inputValue(), '');
    assert.deepEqual(errors, []);
    console.log('PASS BLS inspector at ' + width + 'px: snapshot, layout, clear, interruption, failure, retry, source switch, denied access, sign-out and reload');
    await context.close();
  }
} finally { await browser.close(); }
