/* Real page and browser; fixture backends only. No production writes.
   Exercises the World Missions deck with auth, rejected joins, pending joins,
   pointer gestures, competing touch navigation, and a missing WebGL globe. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'mission-swipe');
// Use the exact reviewed mission copy, whether the SQL is pending or promoted.
const resetPaths = (await Promise.all(['supabase/migrations', 'supabase/pending'].map(async dir =>
  (await readdir(join(ROOT, dir))).filter(name => /action_mission_reset_v1\.sql$/.test(name)).map(name => join(ROOT, dir, name))
))).flat();
assert.ok(resetPaths.length, 'The mission reset SQL is available');
const resetSource = await readFile(resetPaths[0], 'utf8');
const copies = [...resetSource.matchAll(/update public\.action_missions set\s+title='((?:''|[^'])*)',\s+description='((?:''|[^'])*)'/g)].map(m => ({ title: m[1].replace(/''/g, "'"), description: m[2].replace(/''/g, "'") }));
assert.equal(copies.length, 3, 'Read the three active mission definitions');
const archive = JSON.parse(await readFile(join(ROOT, 'data/action/docket-516r-archive.json'), 'utf8'));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://local').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const data = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const titles = copies.map(m => m.title);
const rows = copies.map((copy, i) => ({ id: ids[i], ...copy, discovery_category: i ? 'create' : 'help', domain: i ? 'creative' : 'mutual_aid', status: 'open', kind: 'civic', difficulty: 1, base_points: 100, proof_required: true, verification_mode: 'review', skills: [], campaign_id: null }));
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const token = () => 'x.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: ME.m_uid })).toString('base64url') + '.y';
const results = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function scenario({ member = false, viewport = { width: 390, height: 844 } } = {}) {
  const world = { assignments: new Map(), joins: [], proofWrites: 0, deny: false, malformed: false, deferJoin: null, pending: null };
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.addInitScript(({ member, token }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    localStorage.setItem('mnet_tour_seen', '1');
    if (member) localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  }, { member, token: token() });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,apikey,content-type,prefer', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.origin === BASE) {
      if (u.pathname === '/action-globe.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="background:#07080b"><script>parent.postMessage({type:"hu:globe-unavailable"},location.origin)</script></body>' });
      return route.continue();
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (u.hostname === 'zmnhbrjyhxzhkxmhkexs.supabase.co') {
      if (u.pathname.endsWith('/auth/v1/user')) return json(member ? { id: ME.m_uid, email: 'fixture@example.invalid' } : { error: 'No session' }, member ? 200 : 401);
      const rpc = u.pathname.split('/rpc/')[1];
      if (u.pathname.endsWith('/action_missions')) { const id = u.searchParams.get('id')?.replace('eq.', ''); return json(id ? rows.filter(m => m.id === id) : rows); }
      if (u.pathname.endsWith('/action_mission_assignments')) { const a = world.assignments.get(u.searchParams.get('mission_id')?.replace('eq.', '')); return json(a ? [a] : []); }
      if (rpc?.startsWith('join_action_mission')) {
        const body = req.postDataJSON(); world.joins.push(body);
        if (world.deferJoin) await new Promise(resolve => { world.pending = resolve; });
        if (world.deny) return json({ message: 'Approval is required for this mission.' }, 403);
        if (world.malformed) return json({ status: 'application_required' });
        const a = { id: '44444444-4444-4444-8444-444444444444', status: 'in_progress' }; world.assignments.set(body.p_mission_id, a);
        return json({ assignment_id: a.id, status: a.status, mission_id: body.p_mission_id });
      }
      if (rpc?.includes('proof') && req.method() === 'POST') world.proofWrites++;
      if (rpc === 'action_record') return json({ verified_actions: 0, points: 0, in_progress: 0, missions: [], skills: [], cohorts: [] });
      if (rpc === 'action_bounty_public') return json({ support_open: false, bounties: [] });
      return json([]);
    }
    if (u.hostname === 'api.mccluster.org') {
      if (u.pathname === '/v1/action-archive/docket-516r-2025') return json(archive);
      if (u.pathname === '/v1/status') return json({ error: 'Forbidden' }, 403);
      if (u.pathname === '/v1/mnet/bootstrap') return json({ identity: ME, profile: ME, next_step: null, tour_done_at: new Date().toISOString() });
      if (/\/v1\/mnet\/(public-)?feed/.test(u.pathname)) return json({ items: [], next_before: null });
      if (u.pathname === '/v1/world/news') return json({ items: [], next_before: null, unavailable: true });
      return json({});
    }
    return route.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/mnet.html?view=feed');
  await page.waitForFunction(() => window.MCC_WORLD_MODE && document.documentElement.classList.contains('mn-world-on'));
  assert.equal(await page.evaluate(() => window.MCC_WORLD_MODE.get()), 'travel');
  await page.click('.wt-world-modes [data-world-mode="missions"]');
  await page.waitForSelector('.mn-swipe__card');
  const current = () => page.locator('.mn-swipe__card').getAttribute('data-mission');
  return { ctx, page, world, errors, current };
}
async function fit(page) {
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, frame: document.querySelector('#mnWorldFrame').getBoundingClientRect().height, feed: document.querySelector('#mnWorldFeed').getBoundingClientRect().height }));
  assert.equal(sizes.scroll, sizes.width); assert.ok(sizes.frame > 100); assert.ok(sizes.feed > 100); return sizes;
}
async function swipe(page, dx, dy = 0, cancel = false) {
  await page.locator('.mn-swipe__category').scrollIntoViewIfNeeded();
  const box = await page.locator('.mn-swipe__card h3').boundingBox();
  const x = box.x + box.width / 2, y = box.y + 15;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
  await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await session.detach();
  await page.waitForTimeout(100);
}
async function actionVisibility(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  return page.locator('.mn-swipe__actions').evaluate(actions => {
    const rect = actions.getBoundingClientRect(), bar = document.querySelector('.appbar').getBoundingClientRect(), feed = document.querySelector('#mnWorldFeed').getBoundingClientRect();
    const hits = [...actions.querySelectorAll('button')].map(button => {
      const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { label: button.textContent, hit: hit === button || button.contains(hit), height: b.height };
    });
    return { top: rect.top, bottom: rect.bottom, navTop: bar.top, feedTop: feed.top, hits };
  });
}
function assertActionsVisible(metrics) {
  assert.ok(metrics.top >= metrics.feedTop + 8, 'actions stay inside the scrolling feed');
  assert.ok(metrics.bottom <= metrics.navTop - 8, 'actions clear the floating navigation');
  assert.ok(metrics.hits.every(h => h.hit && h.height >= 44), 'both actions have unobstructed real hit targets');
}
try {
  await mkdir(OUT, { recursive: true });
  {
    const s = await scenario({ member: true });
    for (let i = 0; i < rows.length; i++) {
      assert.equal(await s.current(), ids[i]);
      const summary = await s.page.locator('.mn-swipe__description').textContent();
      assert.ok(summary.length <= 220 && summary.endsWith('…'));
      await s.page.getByRole('button', { name: 'Read full mission', exact: true }).click();
      assert.equal(await s.page.locator('#mnMissionDetail > p').first().textContent(), rows[i].description);
      await s.page.click('#mnMissionClose');
      await s.page.locator('.mn-swipe__actions').evaluate(n => n.scrollIntoView({ block: 'end', behavior: 'auto' }));
      const scrolled = await actionVisibility(s.page); assertActionsVisible(scrolled);
      await s.page.screenshot({ path: join(OUT, `mission-${i + 1}-actions-390.png`) });
      await s.page.locator('#mnWorldFeed').evaluate(n => { n.scrollTop = 0; });
      await s.page.getByRole('button', { name: 'Read full mission', exact: true }).focus();
      await s.page.keyboard.press('Tab');
      const keyboard = await actionVisibility(s.page); assertActionsVisible(keyboard);
      assert.ok(await s.page.locator('.mn-swipe__pass').evaluate(n => n === document.activeElement));
      results.push({ name: `actual SQL copy: ${titles[i]}, full instructions and unobstructed actions`, ok: true, fullLength: rows[i].description.length, excerptLength: summary.length, scrolled, keyboard });
      await s.page.locator('.mn-swipe__pass').click();
    }
    assert.equal(s.world.joins.length, 0); assert.equal(s.world.proofWrites, 0); assert.deepEqual(s.errors, []);
    await s.ctx.close();
  }
  {
    const s = await scenario();
    assert.equal(await s.current(), ids[0]);
    await s.page.locator('.mn-swipe__pass').click();
    assert.equal(await s.current(), ids[1]); assert.equal(s.world.joins.length, 0);
    await s.page.locator('.mn-swipe__undo').click(); assert.equal(await s.current(), ids[0]);
    await swipe(s.page, 8, -130); assert.equal(await s.current(), ids[0]);
    await swipe(s.page, 140, 0, true); assert.equal(await s.current(), ids[0]);
    await swipe(s.page, -140); assert.equal(await s.current(), ids[1]);
    assert.equal(await s.page.evaluate(() => window.MCC_WORLD_MODE.get()), 'missions');
    await s.page.locator('.mn-swipe__undo').click();
    await s.page.locator('.mn-swipe__accept').click();
    await s.page.waitForFunction(() => !document.querySelector('#mnSignedOut').hidden);
    assert.equal(s.world.joins.length, 0); assert.equal(s.world.proofWrites, 0);
    assert.match(s.page.url(), new RegExp('mission=' + ids[0]));
    results.push({ name: 'guest, vertical/cancelled/left touch, undo, no mutation before sign-in', ok: true });
    await s.ctx.close();
  }
  {
    const s = await scenario({ member: true });
    s.world.deny = true;
    await swipe(s.page, 140);
    await s.page.waitForFunction(() => document.querySelector('.mn-swipe__status').textContent.includes('Approval is required'));
    assert.equal(await s.current(), ids[0]); assert.equal(s.world.joins.length, 1);
    await s.page.click('#mnMissionClose');
    s.world.deny = false; s.world.malformed = true;
    await s.page.locator('.mn-swipe__accept').click();
    await s.page.waitForFunction(() => document.querySelector('.mn-swipe__status').textContent.includes('not returned an active assignment'));
    assert.equal(await s.current(), ids[0]);
    await s.page.click('#mnMissionClose');
    s.world.malformed = false; s.world.deferJoin = true;
    await s.page.locator('.mn-swipe__accept').click();
    await s.page.waitForFunction(() => document.querySelector('#mnMissionJoin').disabled);
    await s.page.evaluate(() => { document.querySelector('.mn-swipe__accept').click(); document.querySelector('#mnMissionJoin').click(); });
    assert.equal(s.world.joins.length, 3);
    s.world.pending();
    await s.page.waitForFunction(id => document.querySelector('.mn-swipe__card').dataset.mission !== id, ids[0]);
    assert.equal(await s.current(), ids[1]); assert.equal(s.world.proofWrites, 0);
    assert.ok(!await s.page.locator('#mnMissionProof').isHidden());
    await s.page.click('#mnMissionClose');
    await s.page.locator('.mn-swipe__card').focus(); await s.page.keyboard.press('ArrowLeft');
    assert.equal(await s.current(), ids[2]);
    await s.page.locator('.mn-swipe__undo').click(); assert.equal(await s.current(), ids[1]);
    await s.page.locator('[data-status="completed"]').click();
    await s.page.locator('#mnCompletedSeries .dc-series').waitFor();
    assert.equal(await s.page.locator('.mn-swipe__card').count(), 0);
    await s.page.locator('.dc-series__summary').click();
    assert.match(await s.page.locator('.dc-series__name').textContent(), /Docket 516R.*Write a Song/);
    assert.match(await s.page.locator('.dc-series__position').textContent(), /1 \/ 9/);
    await s.page.locator('.dc-series__next').click();
    assert.match(await s.page.locator('.dc-series__position').textContent(), /2 \/ 9/);
    await s.page.locator('[data-status="open"]').click();
    assert.equal(await s.current(), ids[1]);
    const sizes = await fit(s.page);
    await s.page.locator('.mn-swipe__actions').evaluate(n => n.scrollIntoView({ block: 'end', behavior: 'auto' }));
    assertActionsVisible(await actionVisibility(s.page));
    await s.page.screenshot({ path: join(OUT, 'mission-cards-390.png') });
    assert.deepEqual(s.errors, []);
    results.push({ name: 'member, rejected and malformed joins, duplicate-click lock, real assignment, keyboard, 390px overflow', ok: true, sizes });
    await s.ctx.close();
  }
  for (const width of [768, 1280]) {
    const s = await scenario({ member: true, viewport: { width, height: 900 } });
    const sizes = await fit(s.page); assert.deepEqual(s.errors, []);
    results.push({ name: `persistent globe and deck fit ${width}px`, ok: true, sizes }); await s.ctx.close();
  }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close(); server.close();
}
console.log(JSON.stringify(results, null, 2));
