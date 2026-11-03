#!/usr/bin/env node
/* PRIM3 tactics page: phone layout check, by DOM measurement in a real browser (Playwright, chromium).
   For each level and width it loads prim3-transit.html, waits for the board, and checks:
     - no horizontal scroll (scrollWidth === clientWidth);
     - the objective strip and the battlefield do not overlap (the strip is docked above the board);
     - nothing but the corner controls sits over the board's middle: the squad's tiles are tappable
       (a tap at each operative's screen position selects that operative).
   Usage: node scripts/prim3/check-tactics-layout.mjs [base=http://127.0.0.1:8763]
   (serve the repository root first, e.g. python3 -m http.server 8763)                                   */
const base = process.argv[2] || 'http://127.0.0.1:8763';
let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
const levels = ['equity-uprise-hq', 'equity-uprise-b1'];
const widths = [[360, 780], [390, 844], [1440, 900]];
const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-webgl'] });
let failed = 0;
for (const level of levels) for (const [w, h] of widths) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${base}/prim3-transit.html?level=${level}&look=day&fx=low&new=1&seed=7`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__tx && window.__tx.r3, null, { timeout: 60000 });
  await p.evaluate(() => { const g = document.querySelector('[data-sheet="brief-go"]'); if (g) g.click(); });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const o = box(document.getElementById('txObj')), s = box(document.getElementById('txStage'));
    const overlap = !(o.bottom <= s.top || o.top >= s.bottom || o.right <= s.left || o.left >= s.right);
    const tx = window.__tx, taps = [];
    for (const u of tx.state.units.filter((x) => x.faction === 'PLAYER')) {
      const pt = tx.r3.screenOf(u.x, u.y, 0.5, u.z);
      const el = document.elementFromPoint(pt.x, pt.y);
      const onBoard = !!(el && el.closest('.tx-3d'));
      const t = tx.r3.tileAt(pt.x, pt.y);
      taps.push({ id: u.id, onBoard, hit: !!(t && (t.unitId === u.id || (t.x === u.x && t.y === u.y))) });
    }
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, overlap, taps };
  });
  const ok = r.sw === r.cw && !r.overlap && r.taps.every((t) => t.onBoard && t.hit);
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${level} @${w}: scroll ${r.sw}/${r.cw}, objective over board: ${r.overlap}, taps ${r.taps.map((t) => `${t.id}:${t.onBoard && t.hit ? 'ok' : 'blocked'}`).join(' ')}`);
  await p.close();
}
await b.close();
process.exit(failed ? 1 : 0);
