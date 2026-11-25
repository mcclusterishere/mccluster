/* Audit the existing city→HQ handoff with actual renderer picking. Fixture saves and auth only.
   Does not change tactical source or use production accounts.
   CHROMIUM_PATH=/usr/bin/chromium THREE_DIR=/tmp/three-package/package node ... [output] */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = process.argv[2] || '/tmp/city-upstairs-audit'; await mkdir(out, { recursive: true });
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))('playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const base = 'https://matthew.mccluster.org', findings = [];
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' };
try {
  for (const width of [390, 1280]) for (const stair of ['stair-a-1-2', 'stair-b-1-2']) {
    const cfg = HQ.engineConfig({ seed: 3 }), link = cfg.links.find(l => l.id === stair);
    let state = R.beginPlayerPhase(R.createState(cfg)); state.units = state.units.filter(u => u.id === 'T1');
    for (const next of R.findPath(state, 'T1', link.from)) {
      const current = state.units[0];
      if (current.x === next.x && current.y === next.y && current.z === next.z) continue;
      if (current.ap < 1) state = R.beginPlayerPhase({ ...state, phase: 'THREAT' });
      state = R.moveUnit(state, 'T1', next, 'MOVE');
    }
    state = R.beginPlayerPhase({ ...state, phase: 'THREAT' });
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.addInitScript(state => {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'fixture-owner', expires_at: Date.now() / 1000 + 3600 }));
      localStorage.setItem('prim3.level.equity-uprise-hq.v1', JSON.stringify({ v: 1, state, log: [] }));
      localStorage.setItem('prim3.tactics.preview.gfx', 'low');
    }, state);
    await ctx.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'api.mccluster.org') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
      let path;
      if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.startsWith('/npm/three@0.180.0/')) path = join(process.env.THREE_DIR, u.pathname.slice('/npm/three@0.180.0/'.length));
      else if (u.origin === base) { path = resolve(root, '.' + decodeURIComponent(u.pathname)); if (!path.startsWith(resolve(root) + sep)) return route.abort(); }
      else return route.abort();
      try { return route.fulfill({ body: await readFile(path), contentType: types[extname(path)] || 'application/octet-stream' }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/prim3-transit.html?level=equity-uprise-hq');
    await page.waitForFunction(() => window.__tx?.r3 && !__tx.busy, null, { timeout: 60000 });
    await page.locator('#txActs [data-act="move"]').click();
    await page.waitForFunction(() => __tx.ui.mode === 'move');
    await page.locator('#tx3d').scrollIntoViewIfNeeded();
    // Camera framing only; no unit/selection/rule mutation. Pointer still goes through the rendered canvas.
    await page.evaluate(p => __tx.r3.focus(p.x, p.y, p.z, 12), link.from);
    await page.waitForTimeout(800);
    const before = await page.evaluate(target => {
      const screen = __tx.r3.screenOf(target.x, target.y, 0, target.z);
      return { cut: __tx.r3.cut, reachable: __tx.reach().tiles.some(t => t.x === target.x && t.y === target.y && t.z === target.z), screen,
        picked: __tx.r3.tileAt(screen.x, screen.y), units: __tx.state.units.map(u => ({ id: u.id, x: u.x, y: u.y, z: u.z })) };
    }, link.to);
    assert.equal(before.reachable, true, 'upper landing is actually reachable');
    await page.mouse.click(before.screen.x, before.screen.y);
    const preview = await page.evaluate(() => __tx.ui.preview);
    await page.screenshot({ path: join(out, `${width}-${stair}.png`) });
    const finding = { width, stair, from: link.from, target: link.to, ...before, preview, errors };
    findings.push(finding); console.log(JSON.stringify(finding));
    assert.equal(errors.length, 0);
    await ctx.close();
  }
} finally { await writeFile(join(out, 'findings.json'), JSON.stringify(findings, null, 2)); await browser.close(); }
