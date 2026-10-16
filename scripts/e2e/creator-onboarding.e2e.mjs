/* CREATOR ONBOARDING, ONE CLICK, IN A REAL BROWSER.
   ============================================================
   Creator Studio (creator.html) at 390px and 1280px against a faked
   Supabase whose two onboarding RPCs follow the same rules as
   supabase/pending/music_creator_one_click_v1.sql (built here from
   js/creator-onboarding.js, which the SQL behaviour test pins to the same
   answers). Nothing touches production.

     1. complete profile  -> one click -> creator, no field asked
     2. incomplete        -> only the missing name and handle are asked
     3. already a creator -> the onboarding is never shown, reload included
     4. ?edit=profile     -> the profile form, only when asked for
     5. RPC not deployed  -> the browser-built answer gives the same result

   Every view is measured at 390px: scrollWidth must equal clientWidth.

     node scripts/e2e/creator-onboarding.e2e.mjs [outDir]
   CREATOR_E2E_ROOT=<a checkout> serves another tree (the "before" shots).
   CREATOR_E2E_BEFORE=1 only takes screenshots (the old page has no
   onboarding to assert on).
   ============================================================ */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('../../', import.meta.url));
const ROOT = process.env.CREATOR_E2E_ROOT || HERE;
const BEFORE = process.env.CREATOR_E2E_BEFORE === '1';
const OUT = process.argv[2] || join(HERE, 'e2e-out-creator-onboarding');
const require = createRequire(import.meta.url);
const OB = require(join(HERE, 'js/creator-onboarding.js'));
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  const file = path === '/' ? 'index.html' : path;
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const UID = '00000000-0000-4000-8000-00000000a001';
const MUID = '10000000-0000-4000-8000-00000000a001';

/* the fixtures: invented people, no real member data */
const SCENARIOS = {
  complete: { network: { display_name: 'Fixture Artist', bio: 'Songs from the fixture.', website_url: 'https://fixture.example' }, platform: { mccluster_id: 'fixture.artist', display_name: 'Fixture' }, creator: null },
  incomplete: { network: { display_name: '', bio: '', website_url: '' }, platform: { mccluster_id: null, display_name: null }, creator: null },
  creator: { network: { display_name: 'Fixture Chase' }, platform: { mccluster_id: 'fixture-chase' }, creator: { handle: 'fixture-artist', artist_name: 'Fixture Artist', bio: 'Already here.', website_url: '', avatar_url: '', banner_url: '', status: 'active', verification_state: 'unverified', payout_state: 'not_started', settings: { experience_theme: {} }, updated_at: 't1' } }
};

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log((ok ? 'ok   ' : 'FAIL ') + what); };

async function run(browser, width, name, opts = {}) {
  const db = JSON.parse(JSON.stringify(SCENARIOS[opts.scenario || name]));
  const calls = [];
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([uid]) => {
    try { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() })); } catch (_) {}
    try { localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'fixture-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } })); } catch (_) {}
  }, [UID]);
  await ctx.route('https://esm.sh/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'export function createClient(){return {storage:{from(){return {getPublicUrl(){return {data:{publicUrl:""}}},remove(){return Promise.resolve({})},uploadToSignedUrl(){return Promise.resolve({})}}}}}}' }));
  const state = (input) => OB.fallbackState({ creator: db.creator, network: db.network, platform: db.platform, linked: !!db.creator, input });
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.startsWith('/auth/')) return json({});
    if (p === '/rest/v1/rpc/m_my_uid') return json(MUID);
    if (p.startsWith('/rest/v1/rpc/music_')) {
      calls.push({ fn: p.slice('/rest/v1/rpc/'.length), body: req.postDataJSON() });
      if (opts.noRpc) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      if (p.endsWith('/music_creator_state')) { const s = state(); delete s.insert; return json(s); }
      const b = req.postDataJSON() || {};
      const s = state({ handle: b.p_handle, artist_name: b.p_artist_name });
      if (s.creator || !s.insert || b.p_accept_terms !== true) { delete s.insert; return json(s); }
      db.creator = Object.assign({ status: 'active', verification_state: 'unverified', payout_state: 'not_started', avatar_url: '', banner_url: '', settings: {}, updated_at: 't1' }, s.insert);
      return json(Object.assign(state(), { created: true }));
    }
    if (p === '/rest/v1/music_creator_profiles' && req.method() === 'POST') {
      calls.push({ fn: 'rest:insert', body: req.postDataJSON() });
      db.creator = Object.assign({ status: 'active', verification_state: 'unverified', payout_state: 'not_started', avatar_url: '', banner_url: '', settings: {}, updated_at: 't1' }, req.postDataJSON());
      return route.fulfill({ status: 201, body: '' });
    }
    if (p === '/rest/v1/music_creator_profiles') return json(db.creator ? [db.creator] : []);
    if (p === '/rest/v1/network_profiles') return json(db.network ? [db.network] : []);
    if (p === '/rest/v1/platform_profiles') return json(db.platform ? [db.platform] : []);
    if (p === '/rest/v1/identity_presentations') return req.method() === 'GET' ? json([{ music_enabled: !!db.creator }]) : route.fulfill({ status: 201, body: '' });
    return json([]);
  });
  await ctx.route('https://api.mccluster.org/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, creator: !!db.creator, tracks: [], counts: {}, page_traffic: { views: 0, sources: {} } }) }));
  await ctx.route(/^https:\/\/(?!zmnhbrjyhxzhkxmhkexs|api\.mccluster|esm\.sh)/, (route) => route.fulfill({ status: 204, body: '' }));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/creator.html${opts.query || ''}`, { waitUntil: 'load' });
  /* settled: the page has decided between onboarding, studio and edit */
  await page.waitForFunction(() => ['creatorOnboard', 'creatorSummary', 'creatorIdentity']
    .some((id) => document.getElementById(id) && !document.getElementById(id).hidden), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const tag = `${opts.prefix || 'after'}-${width}-${name}`;
  const fit = async (label) => {
    const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    if (width === 390) check(m.s === m.c, `${tag} ${label}: scrollWidth ${m.s} === clientWidth ${m.c}`);
  };
  const shot = (suffix) => page.screenshot({ path: join(OUT, `${tag}${suffix ? '-' + suffix : ''}.png`), fullPage: false });
  const visible = (sel) => page.locator(sel).isVisible();

  if (BEFORE) { await shot(); await page.screenshot({ path: join(OUT, `${tag}-full.png`), fullPage: true }); await ctx.close(); return; }

  if (name === 'complete') {
    check(await visible('#creatorOnboard'), `${tag}: the one-click card shows`);
    check(!(await visible('#cobNameField')) && !(await visible('#cobHandleField')), `${tag}: nothing is asked`);
    check((await page.textContent('#cobName')) === 'Fixture Artist' && (await page.textContent('#cobHandle')) === '@fixture.artist', `${tag}: prefilled from the profile`);
    await fit('onboarding'); await shot('1-card');
    await page.click('#cobGo');
    await page.waitForSelector('#creatorSummary:not([hidden])');
    check(!(await visible('#creatorOnboard')), `${tag}: onboarding gone after one click`);
    check(!(await visible('#creatorIdentity')), `${tag}: the profile form stays closed`);
    const become = calls.filter((c) => c.fn === 'music_become_creator');
    check(become.length === 1 && become[0].body.p_accept_terms === true && become[0].body.p_handle === null, `${tag}: exactly one become call, terms accepted, nothing typed`);
    await fit('studio'); await shot('2-studio');
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(400);
    check(!(await visible('#creatorOnboard')) && (await visible('#creatorSummary')), `${tag}: reload never shows the onboarding`);
  }
  if (name === 'incomplete') {
    check(await visible('#cobNameField') && await visible('#cobHandleField'), `${tag}: name and handle asked`);
    check((await page.locator('#cobForm input:visible').count()) === 2, `${tag}: only the two missing fields`);
    await fit('onboarding'); await shot('1-card');
    await page.fill('#cobNameInput', 'Fixture Newcomer');
    await page.fill('#cobHandleInput', '@Fixture-Newcomer');
    await shot('2-filled');
    await page.click('#cobGo');
    await page.waitForSelector('#creatorSummary:not([hidden])');
    const become = calls.filter((c) => c.fn === 'music_become_creator').pop();
    check(become && become.body.p_handle === 'fixture-newcomer' && become.body.p_artist_name === 'Fixture Newcomer', `${tag}: only the typed fields are sent, handle normalised`);
    check((await page.textContent('#cmeHandle')) === '@fixture-newcomer', `${tag}: studio shows the new handle`);
    await fit('studio'); await shot('3-studio');
  }
  if (name === 'creator' || name === 'fallback') {
    check(!(await visible('#creatorOnboard')), `${tag}: an existing creator never sees the onboarding`);
    check(await visible('#creatorSummary') && !(await visible('#creatorIdentity')), `${tag}: studio with the summary, form closed`);
    check((await page.getAttribute('#cmeEdit', 'href')) === 'creator.html?edit=profile', `${tag}: edit goes to profile edit`);
    check(calls.every((c) => c.fn !== 'music_become_creator' && c.fn !== 'rest:insert'), `${tag}: nothing written`);
    await fit('studio'); await shot();
  }
  if (name === 'edit') {
    check(await visible('#creatorIdentity'), `${tag}: the profile form opens for editing`);
    check(!(await visible('#creatorOnboard')), `${tag}: not the onboarding`);
    check((await page.inputValue('#creatorName')) === 'Fixture Artist', `${tag}: prefilled`);
    await fit('edit'); await shot();
  }
  if (name === 'fallback-complete') {
    await page.click('#cobGo');
    await page.waitForSelector('#creatorSummary:not([hidden])');
    const ins = calls.find((c) => c.fn === 'rest:insert');
    check(ins && ins.body.handle === 'fixture.artist' && ins.body.artist_name === 'Fixture Artist' && ins.body.terms_version === 'music-creator-v1', `${tag}: RPC missing, the same profile is written`);
  }
  check(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) {
    if (BEFORE) {
      await run(browser, width, 'creator', { prefix: 'before' });
      await run(browser, width, 'complete', { prefix: 'before' });
      continue;
    }
    await run(browser, width, 'complete');
    await run(browser, width, 'incomplete');
    await run(browser, width, 'creator');
    await run(browser, width, 'edit', { scenario: 'creator', query: '?edit=profile' });
    await run(browser, width, 'fallback', { scenario: 'creator', noRpc: true });
    await run(browser, width, 'fallback-complete', { scenario: 'complete', noRpc: true });
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log(`\ncreator onboarding e2e: all checks passed (${BEFORE ? 'before shots' : 'after'}) -> ${OUT}`);
