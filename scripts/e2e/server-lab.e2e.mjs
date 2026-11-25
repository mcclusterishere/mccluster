/* Server Lab browser acceptance: the owner gate, then L1-L4 played through the real page at 390 px and desktop,
   tapping real 3D objects where the level asks for it. All network is intercepted except the three.js CDN; the
   building runtime is served from its source under docs/ at the paths deploy-pages.yml publishes it to
   (equity-uprise-preview/). Usage: node scripts/e2e/server-lab.e2e.mjs [screenshot-dir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/server-lab-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const BASE = 'https://matthew.mccluster.org';
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };
const P = 'docs/design/equity-uprise-building/production/';
const PREVIEW = {
  'lab-runtime/': P + 'lab-runtime/',
  'electronics/server-lab-hardware-v1.json': P + 'electronics/server-lab-hardware-v1.json',
  'equity-uprise-it-lab-catalog-v1.json': P + 'electronics/generated/equity-uprise-it-lab-catalog-v1.json',
  'equity-uprise-asset-registry-v1.json': P + 'asset-registry/generated/equity-uprise-asset-registry-v1.json',
  'equity-uprise-electronics-connections-v1.json': P + 'electronics/generated/equity-uprise-electronics-connections-v1.json',
  'equity-uprise-electronics-manifest-v1.json': P + 'electronics/generated/equity-uprise-electronics-manifest-v1.json',
  'competency-rubrics.json': 'docs/design/equity-uprise-development/competency-rubrics.json',
};
const results = [];
function check(name, ok, detail) { results.push({ name, pass: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); assert.ok(ok, name); }
await mkdir(OUT, { recursive: true });
const USER = '11111111-1111-4111-8111-111111111111';

async function open(width, persona = 'owner', query = '') {
  const height = width < 700 ? 844 : 900;
  const ctx = await browser.newContext({ viewport: { width, height }, actionTimeout: 120000, hasTouch: width < 700, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(({ signed, USER }) => {
    if (signed) { const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: USER, exp })) + '.y', expires_at: exp, refresh_token: 'fixture-only', user: { id: USER } })); }
  }, { signed: persona !== 'guest', USER });
  const calls = [];
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    calls.push(u.href);
    if (u.hostname === 'cdn.jsdelivr.net') return r.continue();
    if (u.hostname === 'api.mccluster.org') {
      const status = persona === 'owner' ? 200 : 403;
      return r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: status === 200 }) });
    }
    if (u.origin !== BASE) return r.fulfill({ status: 404, body: '' });
    let rel = decodeURIComponent(u.pathname.slice(1)) || 'index.html';
    if (rel.startsWith('equity-uprise-preview/')) {
      const sub = rel.slice('equity-uprise-preview/'.length);
      const key = Object.keys(PREVIEW).find((k) => (k.endsWith('/') ? sub.startsWith(k) : sub === k));
      if (!key) return r.fulfill({ status: 404, body: '' });
      rel = key.endsWith('/') ? PREVIEW[key] + sub.slice(key.length) : PREVIEW[key];
    }
    const file = resolve(ROOT, rel);
    if (!file.startsWith(ROOT.replace(/\/$/, '') + sep)) return r.fulfill({ status: 403, body: '' });
    try { return r.fulfill({ status: 200, contentType: MIME[extname(file)] || 'application/octet-stream', body: await readFile(file) }); }
    catch { return r.fulfill({ status: 404, body: '' }); }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/equity-uprise-server-lab-3d.html' + (query || '?fx=lite'));
  return { ctx, page, errors, calls };
}
const SKIP = /-4[13]-IT-LAB-0(4[67]|50|51)|-11-L1-find-L1-R/;
const shot = (page, name) => (SKIP.test(name) ? null : page.screenshot({ path: join(OUT, name + '.png'), timeout: 180000 }));
async function ready(page) { await page.waitForFunction(() => window.__serverLab && document.documentElement.dataset.serverLab === 'ready', null, { timeout: 120000 }); await page.waitForTimeout(800); }
async function noOverflow(page, label) { const d = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); check(label + ' no horizontal overflow ' + d.join('/'), d[0] === d[1], d); }
async function tapPart(page, id, views = []) {
  await page.evaluate(() => window.__serverLab.settle());
  for (let attempt = 0; attempt < 3 + views.length; attempt += 1) {
    const pt = await page.evaluate((i) => window.__serverLab.pointFor(i), id);
    if (pt) { await page.mouse.click(pt.x, pt.y); return true; }
    const grip = page.locator('#slGrip');
    const collapsed = await page.evaluate(() => document.getElementById('slSheet').classList.contains('is-collapsed'));
    if (!collapsed && await grip.isVisible()) { await grip.click(); await page.waitForTimeout(300); continue; }
    const v = views.shift();
    if (v) { await page.evaluate(({ x, id }) => (x === 'focus' ? window.__serverLab.focus(id) : window.__serverLab.view(x)), { x: v, id }); await page.evaluate(() => window.__serverLab.settle()); }
  }
  return false;
}
async function ensureSheet(page) { const collapsed = await page.evaluate(() => document.getElementById('slSheet').classList.contains('is-collapsed')); if (collapsed) { await page.locator('#slGrip').click(); await page.waitForTimeout(300); } }
const btn = (page, sel) => page.locator(sel).first();

/* ---------------- gate ---------------- */
for (const [persona, text] of [['guest', 'Sign in'], ['member', 'house owner']]) {
  const { ctx, page } = await open(390, persona);
  await page.waitForFunction(() => document.documentElement.dataset.ownerAccess === 'closed', null, { timeout: 15000 });
  const s = await page.evaluate(() => ({ msg: document.querySelector('[data-owner-msg]').textContent, app: !!document.getElementById('slApp'), canvas: !!document.querySelector('canvas'), lab: !!window.__serverLab }));
  check('gate keeps the lab closed for ' + persona, s.msg.includes(text) && !s.app && !s.canvas && !s.lab, s);
  if (persona === 'member') await shot(page, 'gate-390');
  await ctx.close();
}

for (const width of [390, 1280]) {
  const tag = width < 700 ? '390' : '1280';
  const { ctx, page, errors } = await open(width, 'owner');
  await ready(page);
  check(tag + ' owner sees the lab', await page.evaluate(() => !!document.querySelector('canvas')), null);
  await shot(page, tag + '-01-explore-rack');
  await noOverflow(page, tag + ' explore');
  const small = await page.evaluate(() => [...document.querySelectorAll('.sl-app button, .sl-app a')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.classList.contains('sl-grip')).map((b) => b.textContent.trim()).slice(0, 5));
  check(tag + ' tap targets >= 44px', small.length === 0, small);

  // explore: tap the lab server, open it, tap a DIMM for its card, exploded view
  await page.evaluate(() => window.__serverLab.view('rack'));
  await btn(page, '[data-act="open-server"]').click();
  await page.evaluate(() => window.__serverLab.settle());
  await shot(page, tag + '-02-server-open');
  await tapPart(page, 'CPU2-DIMM-E1', ['server']);
  await ensureSheet(page);
  const card = await page.textContent('#slBody');
  check(tag + ' tapping a DIMM opens its card', /DDR5|DIMM/.test(card) && /channel|slot 1/i.test(card), card.slice(0, 200));
  await shot(page, tag + '-03-dimm-card');
  await page.click('[data-tool="explode"]');
  await page.evaluate(() => window.__serverLab.settle());
  await page.waitForTimeout(900);
  await shot(page, tag + '-04-exploded');
  await page.click('[data-tool="explode"]');
  await page.click('[data-tool="rear"]');
  await page.evaluate(() => window.__serverLab.settle());
  await shot(page, tag + '-05-rear');

  /* ---------------- L1 ---------------- */
  await page.click('[data-level="L1"]');
  await page.waitForFunction(() => window.__serverLab.snapshot() && window.__serverLab.snapshot().source_lab_id === 'IT-LAB-041', null, { timeout: 60000 });
  let wrongDone = false, hinted = false, i = 0;
  for (;;) {
    const p = await page.evaluate(() => { const ex = window.__serverLab.ui.exercise; const s = ex.snapshot(); const q = ex.prompts.find((x) => !s.prompts_answered.includes(x.prompt_id)); return q ? { id: q.prompt_id, mode: q.mode, target: q.target, answer: q.answer, choices: q.choices.map((c) => c.id) } : null; });
    if (!p) break;
    await ensureSheet(page);
    if (p.mode === 'name') {
      if (!wrongDone) { await btn(page, `[data-answer="${p.choices.find((c) => c !== p.answer)}"]`).click(); wrongDone = true; }
      if (i === 2) await shot(page, tag + '-10-L1-name');
      await btn(page, `[data-answer="${p.answer}"]`).click();
    } else {
      if (!hinted) { await page.click('[data-act="hint"]'); hinted = true; }
      if (p.target.startsWith('RACK')) await page.evaluate(() => window.__serverLab.view('rack'));
      await page.evaluate(() => window.__serverLab.settle());
      if (i === 3 || p.id === 'L1-S2') await shot(page, tag + '-11-L1-find-' + p.id);
      const tapped = await tapPart(page, p.target, p.target.startsWith('RACK') ? ['focus', 'rack', 'rear'] : ['server', 'focus', 'rear']);
      const answered = await page.evaluate((id) => window.__serverLab.snapshot().prompts_answered.includes(id), p.id);
      check(tag + ' L1 find by tapping the 3D ' + p.target, tapped && answered, p);
    }
    i += 1;
  }
  await ensureSheet(page);
  await page.click('[data-act="finish"]');
  const a1 = await page.evaluate(() => window.__serverLab.done());
  check(tag + ' L1 complete and assessed', a1 && a1.phase === 'COMPLETED' && a1.hints.count >= 1 && a1.action_metrics.incorrect >= 1, a1 && a1.performance_signal);
  await shot(page, tag + '-12-L1-done');

  /* ---------------- L2 ---------------- */
  await page.click('[data-level="L2"]');
  await page.waitForFunction(() => window.__serverLab.snapshot() && window.__serverLab.snapshot().source_lab_id === 'IT-LAB-042', null, { timeout: 60000 });
  await page.evaluate(() => window.__serverLab.settle());
  await shot(page, tag + '-20-L2-stripped');
  await ensureSheet(page);
  await page.click('[data-part="PART-CPU-A"]');
  await page.selectOption('#slTarget', 'CPU1');
  await btn(page, '[data-install-opt*="pin1-aligned"]').click();
  check(tag + ' L2 refuses a CPU before the ESD strap', /Ground yourself/.test(await page.textContent('#slBody')), null);
  await page.click('[data-act="esd"]');
  const steps = await page.evaluate(() => window.__l2steps || null);
  const ref = [
    ['PART-CPU-A', 'CPU1', 'pin1-aligned'], ['PART-HS-2U', 'HS-CPU1', '1,2,3,4'], ['PART-CPU-A', 'CPU2', 'pin1-aligned'], ['PART-HS-2U', 'HS-CPU2', '1,2,3,4'],
    ...['CPU1', 'CPU2'].flatMap((c) => ['A', 'E', 'C', 'G'].map((ch) => ['PART-DIMM-32G', c + '-DIMM-' + ch + '1'])),
    ...[0, 1, 2, 3].map((b) => ['PART-SSD-SAS-1T9', 'BAY-0' + b]), ['PART-RISER1', 'RISER1'], ['PART-RAID', 'R1-S2'], ['PART-OCP-NIC', 'OCP-NIC'], ['PART-PSU-800', 'PSU1'], ['PART-PSU-800', 'PSU2'],
  ];
  let wrongChannel = false, tappedSlots = 0;
  for (const [part, target, opt] of ref) {
    await ensureSheet(page);
    const sel = await page.evaluate(() => window.__serverLab.ui.selectedPart);
    if (sel !== part) await page.click(`[data-part="${part}"]`);
    if (part === 'PART-DIMM-32G' && !wrongChannel) {
      await page.selectOption('#slTarget', target.replace(/-[A-H]1$/, '-B1'));
      await btn(page, '[data-install-opt="{}"]').click();
      check(tag + ' L2 rejects channel B before A/E/C/G', /order A, E, C, G/.test(await page.textContent('#slBody')), null);
      wrongChannel = true;
    }
    if (opt) {
      await page.selectOption('#slTarget', target);
      if (opt === '1,2,3,4' && target === 'HS-CPU1') { await btn(page, '[data-install-opt*="[1,3,2,4]"]').click(); check(tag + ' L2 rejects a cross torque order', /order printed on the label/.test(await page.textContent('#slBody')), null); await page.selectOption('#slTarget', target); }
      await btn(page, opt.includes(',') ? `[data-install-opt*="[${opt}]"]` : `[data-install-opt*="${opt}"]`).click();
    } else if (part === 'PART-DIMM-32G' || part === 'PART-SSD-SAS-1T9') {
      const ok = await tapPart(page, target, ['server', 'focus']); // tap the glowing ghost slot in 3D
      if (ok) tappedSlots += 1;
      const placed = await page.evaluate((t) => { const s = window.__serverLab.snapshot().build.state; return !!(s.dimms[t] || s.drives[t]); }, target);
      if (!placed) { await ensureSheet(page); await page.selectOption('#slTarget', target); await btn(page, '[data-install-opt="{}"]').click(); }
    } else {
      await page.selectOption('#slTarget', target);
      await btn(page, '[data-install-opt="{}"]').click();
    }
    const placed = await page.evaluate(({ target }) => { const s = window.__serverLab.snapshot().build.state; return !!(s.cpus[target] || s.heatsinks[target] || s.dimms[target] || s.drives[target] || s.risers[target] || s.pcie[target] || (target === 'OCP-NIC' && s.ocp) || s.psus[target]); }, { target });
    check(tag + ' L2 installed ' + part + ' → ' + target, placed, await page.textContent('.sl-feedback').catch(() => ''));
    if (target === 'CPU1-DIMM-G1') await shot(page, tag + '-21-L2-memory');
  }
  check(tag + ' L2 DIMMs/drives placed by tapping 3D slots', tappedSlots >= 8, tappedSlots);
  await ensureSheet(page);
  await page.click('[data-act="check-memory"]');
  check(tag + ' L2 memory population valid', /Population valid: 256 GB/.test(await page.textContent('#slBody')), null);
  await page.click('[data-cable="CBL-RAID-BP-A"]');
  await page.click('[data-cable="CBL-PWR-1"][data-to="PDU-A:PWR-OUT-07"]');
  await page.click('[data-cable="CBL-PWR-2"][data-to="PDU-A:PWR-OUT-07"]');
  check(tag + ' L2 rejects both PSUs on one feed', /same PDU/.test(await page.textContent('#slBody')), null);
  await page.click('[data-cable="CBL-PWR-2"][data-to="PDU-B:PWR-OUT-07"]');
  await page.click('[data-cable="CBL-DAC-1"][data-to="CORE1:SFP+-IN-03"]');
  await page.click('[data-cable="CBL-DAC-2"][data-to="CORE2:SFP+-IN-03"]');
  await page.click('[data-cable="CBL-MGMT"][data-to="MGMT-SW:VLAN-MGMT"]');
  await shot(page, tag + '-22-L2-built-open');
  await page.click('[data-act="close-lid"]');
  await page.click('[data-act="finish"]');
  const a2 = await page.evaluate(() => window.__serverLab.done());
  check(tag + ' L2 complete; wrong seating recorded', a2 && a2.phase === 'COMPLETED' && a2.action_metrics.incorrect >= 3 && a2.action_metrics.blocked >= 1, a2 && a2.action_metrics);
  await shot(page, tag + '-23-L2-done');

  /* ---------------- L3 ---------------- */
  await page.click('[data-level="L3"]');
  await page.waitForFunction(() => window.__serverLab.snapshot() && window.__serverLab.snapshot().source_lab_id === 'IT-LAB-043', null, { timeout: 60000 });
  await ensureSheet(page);
  await page.click('[data-l3="power_on"]');
  await page.evaluate(() => window.__serverLab.settle());
  await shot(page, tag + '-30-L3-post');
  await page.click('[data-l3cpus="2"]'); await page.fill('#slMem', '256'); await page.click('[data-l3="report_post"]');
  await page.click('[data-path="production_nic"]');
  await page.click('[data-path="dedicated_mgmt_port"]');
  await page.click('[data-health="ok"]');
  await page.click('[data-l3level="RAID10"]'); await page.fill('#slTb', '3.84'); await page.click('[data-l3="configure_raid"]');
  check(tag + ' L3 RAID 10 rejected for capacity', /needs 5/.test(await page.textContent('#slBody')), null);
  await page.click('[data-l3level="RAID5"]'); await page.fill('#slTb', '5.76'); await page.click('[data-l3="configure_raid"]');
  await page.evaluate(() => window.__serverLab.settle());
  await shot(page, tag + '-31-L3-raid-rear');
  await page.selectOption('#slLinks', '2'); await page.selectOption('#slSpeed', '10'); await page.click('[data-l3="verify_link"]');
  await page.click('[data-act="finish"]');
  const a3 = await page.evaluate(() => window.__serverLab.done());
  check(tag + ' L3 complete', a3 && a3.phase === 'COMPLETED' && a3.action_metrics.incorrect === 2, a3 && a3.action_metrics);

  /* ---------------- L4 ---------------- */
  await page.click('[data-level="L4"]');
  await shot(page, tag + '-40-L4-picker');
  for (const lab of (width < 700 ? ['IT-LAB-044', 'IT-LAB-045', 'IT-LAB-051'] : ['IT-LAB-046', 'IT-LAB-047', 'IT-LAB-048', 'IT-LAB-049', 'IT-LAB-050'])) {
    await ensureSheet(page);
    await page.click(`[data-scenario="${lab}"]`);
    await page.waitForFunction((l) => window.__serverLab.snapshot() && window.__serverLab.snapshot().source_lab_id === l, lab, { timeout: 60000 });
    await page.evaluate(() => window.__serverLab.settle());
    await shot(page, tag + '-41-' + lab + '-ticket');
    const def = await page.evaluate((l) => { const s = window.__serverLab.snapshot(); return { path: s ? null : null, faults: s.unresolved_fault_ids }; }, lab);
    const path = await page.evaluate(async (l) => (await (await fetch('/equity-uprise-preview/lab-runtime/server-lab-scenario-pack-v1.json')).json()).scenarios.find((s) => s.source_lab_id === l).verification_path, lab);
    for (const step of path) {
      await ensureSheet(page);
      if (step.action_id.endsWith('-diagnose')) {
        for (const f of step.input.findings) await page.click(`[data-finding="${f}"]`);
        await page.click('[data-act="diagnose"]');
      } else if (step.input.component_id) {
        if (lab === 'IT-LAB-045') { // the dangerous wrong pull: a healthy member of the degraded array
          await page.selectOption('#slReplace', 'BAY-01'); await page.click('[data-act="replace"]');
          check(tag + ' L4 pulling a healthy RAID member is flagged critical', /loses the virtual disk/.test(await page.textContent('#slBody')), null);
        }
        if (lab === 'IT-LAB-044') { // tap the failed DIMM in 3D (lid open after power-off)
          await page.click('[data-tool="lid"]');
          await page.evaluate(() => window.__serverLab.settle());
          await shot(page, tag + '-42-L4-dimm-amber');
          await tapPart(page, step.input.component_id, ['server', 'focus']);
          await ensureSheet(page);
          check(tag + ' L4 tapping the DIMM selects it', (await page.evaluate(() => window.__serverLab.ui.replaceId)) === step.input.component_id, null);
        } else await page.selectOption('#slReplace', step.input.component_id);
        await page.click('[data-act="replace"]');
      } else if (step.input.order) {
        for (const c of step.input.order) await page.click(`[data-fw="${c}"]`);
        await page.click(`[data-l4="${step.action_id}"]`);
      } else {
        await page.click(`[data-l4="${step.action_id}"]`);
      }
      if (step.action_id.endsWith('-read-sel')) await shot(page, tag + '-43-' + lab + '-sel');
    }
    const snap = await page.evaluate(() => window.__serverLab.snapshot());
    check(tag + ' L4 ' + lab + ' faults cleared through the sandbox', snap.unresolved_fault_ids.length === 0 && snap.can_complete, snap.unresolved_fault_ids);
    await page.click('[data-act="finish"]');
    const a4 = await page.evaluate(() => window.__serverLab.done());
    check(tag + ' L4 ' + lab + ' assessed (sandbox, no live control)', a4 && a4.phase === 'COMPLETED' && a4.live_control_allowed === false && a4.execution_target === 'SANDBOX', a4 && a4.phase);
    if (lab === 'IT-LAB-045') check(tag + ' L4 critical safety blocks the positive signal', a4.performance_signal === 'critical_safety_issue', a4.performance_signal);
    await shot(page, tag + '-44-' + lab + '-done');
    await page.click('[data-level="L4"]');
  }
  await noOverflow(page, tag + ' after L4');
  check(tag + ' no page errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ server_lab_e2e: results.every((r) => r.pass) ? 'PASS' : 'FAIL', checks: results.length, out: OUT }));
