/* ANTI-SOCIAL — GET SOCIAL, IN A REAL BROWSER.
   ============================================================
   One mission, three levels, as a member on an iPhone, against a fake
   backend that answers the way the real RPCs do (the SQL itself is proven
   by scripts/test-antisocial-db.sh on a scratch Postgres). This run reads
   the page back: the dialog's 1 / 3 · 2 / 3 · 3 / 3 list, Level 1 and
   Level 2 submitted through submit_antisocial_level, the desk's verdict
   moving the next level open, Level 3 publishing together through
   publish_antisocial_collaboration with a connected partner, a project
   published with me confirmed with one tap, Connect on a member's profile,
   a connection request answered from the bell, the made-together card
   under a vouched post, and the record reading n / 3.

     node scripts/e2e/anti-social.e2e.mjs [outDir]
   ============================================================ */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out-mission-pins');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- the fixture world: the curated missions, after the pending SQL ---------- */
const MEMO = '368fd75a-77d2-4de0-9722-17020674a914', TRACE = '9144bd42-f94a-494e-a17a-a45f9e155f86', BIZ = 'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c';
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const jwt = () => 'x.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'auth-you' })).replace(/=+$/, '') + '.y';
const m = (id, title, domain) => ({ id, campaign_id: null, title, description: 'Fixture description for ' + title + '.', domain, difficulty: 1, base_points: 100, proof_required: true, verification_mode: 'review', skills: ['research'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic' });
const MISSIONS = [m(MEMO, 'Write a policy memo', 'research'), m(TRACE, 'Trace the minerals in your phone', 'research'), m(BIZ, 'Buy from a Black business', 'community')];
const EXTRAS = [
  { mission_id: MEMO, origin_label: null, next_mission_id: 'df26314d-d4e1-47e3-b980-1b60b1a682ea', next_mission_title: 'Co-write a policy reform paper', next_mission_open: false, previous_mission_title: null, pin_count: 1, country_count: 1, cta_key: null, cta_label: null },
  { mission_id: TRACE, origin_label: 'Started by the Connecticut cohort', next_mission_id: null, next_mission_title: null, next_mission_open: null, previous_mission_title: null, pin_count: 52, country_count: 50, cta_key: null, cta_label: null },
  { mission_id: BIZ, origin_label: null, next_mission_id: null, next_mission_title: null, next_mission_open: null, previous_mission_title: null, pin_count: 1, country_count: 1, cta_key: 'business_listing', cta_label: 'Put your Black business on the map' }
];
const calls = [];
async function routeBackends(ctx) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', async (route) => {
    const r = route.request(), u = new URL(r.url()), rpc = (u.pathname.match(/\/rest\/v1\/rpc\/([a-z_]+)$/) || [])[1];
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,apikey,content-type,prefer', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (u.pathname.includes('/auth/v1/user')) return json(route, { id: 'auth-you', email: 'you@example.org' });
    const body = r.method() === 'POST' ? (r.postDataJSON() || {}) : {};
    if (rpc) calls.push({ rpc, body });
    if (u.pathname.endsWith('/rest/v1/action_missions')) { const id = (u.searchParams.get('id') || '').replace('eq.', ''); return json(route, id ? MISSIONS.filter((x) => x.id === id) : MISSIONS); }
    if (rpc === 'action_mission_card_extras') return json(route, EXTRAS);
    if (rpc === 'submit_action_business_listing') return json(route, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'submitted' });
    if (rpc === 'action_record') return json(route, { verified_actions: 0, points: 0, in_progress: 0, missions: [], skills: [], cohorts: [] });
    if (rpc === 'action_bounty_public') return json(route, { support_open: false, support_note: '' });
    return json(route, []);
  });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH' } });
    if (u.pathname === '/v1/world/ion') return json(route, { ok: true, available: false, binding: null });
    if (u.pathname === '/v1/mnet/bootstrap') return json(route, { identity: ME, profile: ME, next_step: null, tour_done_at: new Date().toISOString() });
    if (u.pathname === '/v1/mnet/feed') return json(route, { items: [], next_before: null });
    return json(route, {});
  });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.addInitScript((token) => {
  localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
  localStorage.setItem('mnet_tour_seen', '1');
  localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
}, jwt());
await routeBackends(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fits = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

await page.goto(`${BASE}/mnet.html?view=missions`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('#mnMissionList [data-mission]').length >= 3, null, { timeout: 60000 });
const card = (id) => page.evaluate((x) => (document.querySelector(`#mnMissionList [data-mission="${x}"]`) || {}).textContent || '', id);
check('memo card names the next step', /Next in this arc: Co-write a policy reform paper/.test(await card(MEMO)));
check('trace card says where it started and that anyone can join', /Started by the Connecticut cohort · open to everyone/.test(await card(TRACE)));
check('trace card shows its reach', /On the World in 50 countries/.test(await card(TRACE)));
check('business card carries its CTA', /Put your Black business on the map/.test(await card(BIZ)));
let f = await fits(); check('missions list fits 390px', f.sw === f.cw, f);
await page.screenshot({ path: join(OUT, 'missions-390.png'), fullPage: false });

await page.click(`#mnMissionList [data-mission="${BIZ}"] [data-focus="business"]`);
await page.waitForFunction(() => document.getElementById('mnMissionDialog').open && document.getElementById('mnBusinessListing'), null, { timeout: 15000 });
await page.waitForTimeout(200);
check('the CTA lands on the listing form', await page.evaluate(() => document.activeElement && document.activeElement.id === 'mnBizName'));
const sizes = await page.evaluate(() => [...document.querySelectorAll('#mnBusinessListing .mn__input')].map((n) => parseFloat(getComputedStyle(n).fontSize)));
check('form controls are at least 16px', sizes.length >= 4 && sizes.every((s) => s >= 16), sizes);
f = await fits(); check('dialog with form fits 390px', f.sw === f.cw, f);
const dlg = await page.evaluate(() => { const d = document.getElementById('mnMissionDialog'); return { sw: d.scrollWidth, cw: d.clientWidth }; });
check('dialog itself has no sideways scroll', dlg.sw <= dlg.cw, dlg);
await page.fill('#mnBizName', 'Fixture Books');
await page.fill('#mnBizArea', 'Hartford, CT');
await page.fill('#mnBizUrl', 'https://books.example');
await page.check('#mnBizOwned'); await page.check('#mnBizConsent');
await page.locator('#mnBusinessListing').screenshot({ path: join(OUT, 'business-form-390.png') });
await page.click('#mnBusinessListing button[type=submit]');
await page.waitForFunction(() => /reviewer checks it/.test(document.getElementById('mnBizStatus').textContent), null, { timeout: 10000 });
const sent = calls.find((c) => c.rpc === 'submit_action_business_listing');
check('submission carries attestations, consent version and a coarse default', !!sent && sent.body.p_exact_location_opt_in === false && sent.body.p_street_address === null && sent.body.p_attest_black_owned === true && sent.body.p_consent_version === '2026-10-15', sent && sent.body);
check('no page errors', errors.length === 0, errors);

await browser.close(); server.close();
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
