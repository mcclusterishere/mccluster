/* Accessibility ratchet for every sitemap page (plus three embedded globe/news
   pages the 2026-10-27 audit flagged). Runs axe-core at 390px against the
   repository files; all network is intercepted, so it never calls production.
   The committed baseline (scripts/e2e/fixtures/axe-baseline.json) records the
   violating node count per page and rule: a count may only go down, and a rule
   a page did not violate may not appear.

   node scripts/e2e/sitemap-a11y.e2e.mjs [out-dir]            check against the baseline
   A11Y_WRITE_BASELINE=1 node scripts/e2e/sitemap-a11y.e2e.mjs  rewrite the baseline (only after fixing)

   Env: PLAYWRIGHT_DIR (node_modules holding playwright), AXE_DIR (node_modules
   holding axe-core), CESIUM_DIR (optional local Cesium Build), CHROMIUM_EXECUTABLE (optional), A11Y_ONLY (comma list of paths). */
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/sitemap-a11y-proof';
const BASELINE = join(ROOT, 'scripts/e2e/fixtures/axe-baseline.json');
const req = dir => createRequire(join(dir || '/opt/node-tools/node_modules', 'x'));
const {chromium} = req(process.env.PLAYWRIGHT_DIR)('playwright');
const AXE_SOURCE = await readFile(req(process.env.AXE_DIR || process.env.PLAYWRIGHT_DIR).resolve('axe-core/axe.min.js'), 'utf8');
const BASE = 'https://matthew.mccluster.org';
const MIME = {'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.xml':'application/xml','.txt':'text/plain','.webmanifest':'application/manifest+json'};
const EXTRA = ['guest-globe.html', 'topics.html', 'world-news.html'];

const sitemap = JSON.parse(await readFile(join(ROOT, 'data/seo/sitemap-pages.json'), 'utf8')).pages.map(p => p.url.replace(BASE + '/', ''));
let pages = [...sitemap, ...EXTRA];
if (process.env.A11Y_ONLY) { const only = process.env.A11Y_ONLY.split(','); pages = pages.filter(p => only.includes(p)); }
const toFile = p => (p === '' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p);

const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const json = (r, body, status = 200) => r.fulfill({status, contentType: 'application/json', headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}, body: JSON.stringify(body)});
const results = {};
await mkdir(OUT, {recursive: true});
try {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await ctx.addInitScript(() => { try { localStorage.setItem('mcc_privacy_ack', JSON.stringify({version: '2026-10-19', accepted_at: new Date().toISOString()})); } catch {} });
  await ctx.route('**/*', async r => {
    const rq = r.request(), u = new URL(rq.url()), p = u.pathname;
    if (rq.method() === 'OPTIONS') return r.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}});
    if (u.hostname.endsWith('supabase.co')) return json(r, []);
    if (u.hostname === 'api.mccluster.org') return json(r, {ok: true, items: [], posts: [], events: [], missions: [], tracks: [], sites: []});
    if (u.hostname === 'cesium.com' && process.env.CESIUM_DIR) {
      const rel = p.split('/Build/Cesium/')[1];
      if (rel) { const path = resolve(process.env.CESIUM_DIR, rel); if (path.startsWith(resolve(process.env.CESIUM_DIR) + sep)) { try { return r.fulfill({body: await readFile(path), contentType: MIME[extname(path)] || 'application/octet-stream'}); } catch {} } }
      return r.abort();
    }
    if (u.origin === BASE) {
      const path = resolve(ROOT, '.' + decodeURIComponent(p.endsWith('/') ? p + 'index.html' : p));
      if (path.startsWith(resolve(ROOT) + sep)) { try { return r.fulfill({body: await readFile(path), contentType: MIME[extname(path)] || 'application/octet-stream'}); } catch {} }
      return r.fulfill({status: 404, body: 'Fixture: missing file'});
    }
    return r.abort();
  });
  for (const p of pages) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + '/' + p, {waitUntil: 'load', timeout: 45000});
      await page.waitForTimeout(1200);
      await page.addScriptTag({content: AXE_SOURCE});
      const v = await page.evaluate(async () => (await window.axe.run(document, {resultTypes: ['violations']})).violations.map(x => ({id: x.id, impact: x.impact, nodes: x.nodes.length, targets: x.nodes.slice(0, 50).map(n => n.target.join(' ')), nodes_detail: x.nodes.slice(0, 50).map(n => ({html: n.html.slice(0, 160), data: (n.any[0] || n.all[0] || n.none[0] || {}).data || null}))})));
      const fit = await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
      /* axe accepts a title in place of alt; the audit counts the attribute itself */
      const noAlt = await page.evaluate(() => [...document.querySelectorAll('img:not([alt])')].map(i => i.outerHTML.slice(0, 160)));
      if (noAlt.length) v.push({id: 'img-missing-alt-attribute', impact: 'serious', nodes: noAlt.length, targets: noAlt, nodes_detail: []});
      results[p] = {rules: Object.fromEntries(v.map(x => [x.id, x.nodes]).sort()), fits390: fit, detail: v};
      console.log(p.padEnd(44), v.reduce((n, x) => n + x.nodes, 0), v.map(x => x.id + ':' + x.nodes).join(' '));
    } catch (e) {
      results[p] = {error: String(e.message || e).slice(0, 300)};
      console.log(p.padEnd(44), 'ERROR', results[p].error);
    } finally { await page.close(); }
  }
  await ctx.close();
} finally { await browser.close(); }

await writeFile(join(OUT, 'axe-results.json'), JSON.stringify(results, null, 2));
const current = Object.fromEntries(Object.entries(results).map(([p, r]) => [p, r.rules || null]));
if (process.env.A11Y_WRITE_BASELINE) {
  const prev = JSON.parse(await readFile(BASELINE, 'utf8').catch(() => '{"pages":{}}'));
  const merged = {...prev.pages, ...current};
  const body = {
    schema_version: 'mccluster-axe-baseline/v1',
    note: 'Violating node count per page and axe-core rule at 390px (scripts/e2e/sitemap-a11y.e2e.mjs). Counts may only go down. Regenerate with A11Y_WRITE_BASELINE=1 only after a fix lowers them.',
    axe_core: '4.10.3',
    pages: Object.fromEntries(Object.keys(merged).sort().map(k => [k, merged[k]])),
  };
  await writeFile(BASELINE, JSON.stringify(body, null, 2) + '\n');
  console.log('Baseline written:', BASELINE);
  process.exit(0);
}
const baseline = JSON.parse(await readFile(BASELINE, 'utf8')).pages;
const failures = [], improved = [];
for (const [p, rules] of Object.entries(current)) {
  if (!rules) { failures.push(`${p}: page failed to load (${results[p].error})`); continue; }
  const base = baseline[p];
  if (!base) { failures.push(`${p}: not in ${BASELINE}; add it with A11Y_WRITE_BASELINE=1`); continue; }
  for (const [rule, n] of Object.entries(rules)) {
    const was = base[rule] || 0;
    if (n > was) failures.push(`${p}: ${rule} ${was} -> ${n} (${results[p].detail.find(d => d.id === rule).targets.slice(0, 5).join(' | ')})`);
  }
  for (const [rule, was] of Object.entries(base)) if ((rules[rule] || 0) < was) improved.push(`${p}: ${rule} ${was} -> ${rules[rule] || 0}`);
}
if (improved.length) console.log('\nImproved (lower the baseline with A11Y_WRITE_BASELINE=1):\n  ' + improved.join('\n  '));
if (failures.length) { console.error('\nAccessibility regressions:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`\nPASS axe ratchet: ${Object.keys(current).length} pages at or below baseline`);
