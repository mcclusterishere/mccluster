/* PRIM3 courtyard study (demos/prim3-courtyard, PlayCanvas 2.23.1): real-browser checks.
   Runs WebGL through SwiftShader so the scene actually renders headless.
   PLAYWRIGHT_DIR=<node_modules with playwright> node scripts/e2e/prim3-courtyard.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2] || '/tmp/prim3-courtyard-proof';
await mkdir(OUT, { recursive: true });
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'http://courtyard.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const results = [];
const check = (scope, name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + `[${scope}] ${name}` + (ok ? '' : ' ' + JSON.stringify(detail))); };

// the study's own pure-rules tests
try { execFileSync(process.execPath, ['--test', join(ROOT, 'demos/prim3-courtyard/rules.test.cjs')], { stdio: 'pipe' }); check('rules', 'rules.test.cjs passes', true); }
catch (e) { check('rules', 'rules.test.cjs passes', false, String(e.stdout || e.message).slice(-400)); }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(vp, path) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', hasTouch: vp.width < 1000 });
  await ctx.addInitScript(() => { try { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); } catch (e) {} });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== BASE) return route.abort();
    const f = resolve(ROOT, decodeURIComponent(u.pathname).slice(1));
    if (!f.startsWith(ROOT + sep)) return route.abort();
    try { return route.fulfill({ body: await readFile(f), contentType: TYPES[extname(f)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + path);
  return { ctx, page, errors };
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  const scope = 'study-' + vp.width;
  const { ctx, page, errors } = await open(vp, '/demos/prim3-courtyard/index.html');
  const started = await page.waitForFunction(() => !!window.__PRIM3, null, { timeout: 30000 }).then(() => true, () => false);
  check(scope, 'the PlayCanvas scene starts (WebGL available)', started);
  if (!started) { check(scope, 'no page errors', false, errors); await ctx.close(); continue; }
  await page.waitForTimeout(800);
  // PlayCanvas does not preserve the drawing buffer, so sample a screenshot of the canvas instead
  const shot = await page.locator('canvas').first().screenshot();
  const painted = (() => { let n = 0; for (let i = 0; i < shot.length; i += 997) n += shot[i] > 40 ? 1 : 0; return n; })();
  check(scope, 'the courtyard renders (the canvas is not blank)', painted > 50, painted);
  const S = () => page.evaluate(() => window.__PRIM3.snapshot());
  const settle = async () => { for (let i = 0; i < 200 && (await S()).moving; i++) await page.waitForTimeout(100); };
  // tap a character on the canvas to select it
  const pE = await page.evaluate(() => window.__PRIM3.projectUnit('E'));
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.click(box.x + pE.x, box.y + pE.y); await page.waitForTimeout(200);
  check(scope, 'tapping E on the canvas selects E', (await S()).selected === 'E', (await S()).selected);
  // T walks to the relay in two moves and connects
  await page.evaluate(() => window.__PRIM3.selectUnit('T'));
  const before = await S();
  await page.evaluate(() => window.__PRIM3.preview(4, 3));
  check(scope, 'previewing a blocked tile offers no route and spends nothing', (await S()).route.length === 0 && (await S()).units.find((u) => u.id === 'T').ap === before.units.find((u) => u.id === 'T').ap, await S());
  await page.evaluate(() => window.__PRIM3.preview(4, 6));
  const pv = await S();
  check(scope, 'previewing (4, 6) shows a route and spends nothing', pv.route.length > 1 && pv.units.find((u) => u.id === 'T').ap === 2, pv);
  await page.evaluate(() => window.__PRIM3.confirmMove());
  const mid = await S();
  check(scope, 'Confirm spends exactly one AP and animates', mid.units.find((u) => u.id === 'T').ap === 1 && mid.moving, mid);
  await page.evaluate(() => window.__PRIM3.endTurn());
  check(scope, 'End turn cannot interrupt a move in progress', (await S()).turn === 1);
  await settle();
  const t1 = (await S()).units.find((u) => u.id === 'T');
  check(scope, 'T arrives at (4, 6)', t1.x === 4 && t1.y === 6, t1);
  await page.evaluate(() => { window.__PRIM3.preview(6, 6); window.__PRIM3.confirmMove(); }); await settle();
  await page.evaluate(() => window.__PRIM3.connectRelay());
  check(scope, 'with no AP left, Connect relay does nothing', (await S()).complete === false);
  await page.evaluate(() => window.__PRIM3.endTurn());
  check(scope, 'End turn restores AP', (await S()).units.every((u) => u.ap === 2) && (await S()).turn === 2, await S());
  await page.evaluate(() => window.__PRIM3.connectRelay());
  check(scope, 'T beside the relay connects it and completes the exercise', (await S()).complete === true, await S());
  check(scope, 'no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
  check(scope, 'no page errors', !errors.length, errors);
  await page.screenshot({ path: join(OUT, `courtyard-study-${vp.width}.png`) });
  await ctx.close();
}

// the site wrapper (shared shell + same-origin frame)
{
  const scope = 'wrapper-390';
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, '/prim3-courtyard.html');
  await page.waitForTimeout(1500);
  const frame = page.frameLocator('#courtyard-frame');
  const started = await page.waitForFunction(() => { const f = document.getElementById('courtyard-frame'); return !!(f && f.contentWindow && f.contentWindow.__PRIM3); }, null, { timeout: 30000 }).then(() => true, () => false);
  check(scope, 'the wrapper loads the study in its frame', started);
  check(scope, 'the wrapper links back to PRIM3', await page.locator('a[href="prim3.html"]').count() === 1);
  check(scope, 'no sideways scroll on the wrapper', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
  check(scope, 'no page errors', !errors.length, errors);
  void frame;
  await page.screenshot({ path: join(OUT, 'courtyard-wrapper-390.png'), fullPage: true });
  await ctx.close();
}
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
