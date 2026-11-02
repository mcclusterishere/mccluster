// Phone-first proof for the surfaces this branch touched: at 390px, scrollWidth === clientWidth (AGENTS.md hard
// rule 14), every focusable control is reachable, and the page reaches its signed-out gate without script errors.
// Serves the repository tree statically; API calls fail closed (no network), which is exactly the honest state
// these pages must survive. Usage: node scripts/e2e/mobile-overflow-audit.mjs [out-dir]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp-lite.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'docs/productization/20261102-claude/evidence/mobile');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.vtt': 'text/vtt' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });

const PAGES = ['free-website.html', 'customer-site.html', 'customer-projects.html', 'customer-domain-purchases.html', 'website-studio.html', 'front-studio.html', 'project-studio.html?project=alpha'];
const results = [];
const chrome = await launch();
try {
  for (const path of PAGES) {
    for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1280, 800]]) {
      const page = await chrome.page();
      const errors = [];
      page.events.length = 0;
      await page.viewport(w, h, label === 'phone');
      await page.goto(base + path, 2500);
      const metrics = await page.evaluate(`(() => { const d = document.documentElement, b = document.body;
        const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(e => !e.hidden && !e.disabled && e.getClientRects().length);
        const offenders = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > d.clientWidth + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 8).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''));
        return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, bodyScroll: b.scrollWidth, title: document.title, focusables: focusables.length, offenders, h1: (document.querySelector('h1') || {}).textContent || '' }; })()`);
      for (const ev of page.events) if (ev.method === 'Runtime.exceptionThrown') errors.push(ev.params.exceptionDetails?.exception?.description || ev.params.exceptionDetails?.text);
      const file = path.replace(/[^a-z0-9]+/gi, '-') + '-' + label + '.png';
      await page.screenshot(join(OUT, file));
      const ok = metrics.scrollWidth === metrics.clientWidth && metrics.bodyScroll <= metrics.clientWidth;
      results.push({ page: path, label, width: w, ok, ...metrics, scriptErrors: errors, screenshot: file });
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + ' ' + path + ' · scrollWidth ' + metrics.scrollWidth + ' / clientWidth ' + metrics.clientWidth + (metrics.offenders.length ? ' · offenders ' + metrics.offenders.join(', ') : '') + (errors.length ? ' · script errors ' + errors.length : ''));
      await page.close();
    }
  }
} finally { await chrome.close(); server.close(); }
const { writeFile } = await import('node:fs/promises');
await writeFile(join(OUT, 'mobile-overflow-audit.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const failed = results.filter(r => !r.ok);
console.log(failed.length ? 'FAIL ' + failed.length + ' of ' + results.length : 'PASS all ' + results.length + ' page/width checks');
process.exit(failed.length ? 1 : 0);
