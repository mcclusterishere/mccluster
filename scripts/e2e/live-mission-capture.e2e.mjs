/* LIVE MISSION CAPTURE, end to end in a real browser (Chromium, fake camera).

   Serves this checkout and stands in for api.mccluster.org's /v1/live routes
   and for Cloudflare Stream's WHIP endpoint. The WHIP stand-in is a real
   WebRTC peer: a second page answers the capture page's actual SDP offer, so
   the offer/answer, the Location resource and the DELETE on hang-up are the
   real protocol exchange. At 390 px and 1280 px it checks:
     - no horizontal scroll (scrollWidth === clientWidth) before and while live;
     - the camera is asked for (getUserMedia), the screen never (getDisplayMedia);
     - Go live stays disabled until the camera and the three rules are in;
     - the WHIP POST carries application/sdp; the run heartbeats; recording
       chunks (video/webm) upload while live;
     - "Mission complete" unlocks after the policy's minimum, files the run,
       shows "Sent for review", hangs up WHIP (DELETE);
     - the publishing opt-ins start off and save only what was turned on.
   Nothing here touches production. Run:  node scripts/e2e/live-mission-capture.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR, default /opt/node-tools/node_modules). Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'live-mission');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, ''); // js/backend.js reads it with atob
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'a@test', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const ASSIGNMENT = '30000000-0000-4000-8000-00000000000a';
const WHIP = 'https://customer-test.cloudflarestream.com/SECRETKEY/webRTC/publish';

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  for (const vp of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, permissions: ['camera', 'microphone'] });
    const answerer = await context.newPage();
    await answerer.goto(`${ORIGIN}/404.html`).catch(() => {});
    const page = await context.newPage();
    const seen = { whipPost: null, whipDelete: 0, heartbeats: 0, chunks: [], start: null, complete: 0, publishing: null, other: [] };
    await page.addInitScript((jwt) => {
      try { localStorage.setItem('mccdb_session', JSON.stringify({ access_token: jwt, refresh_token: 'r' })); } catch (_) {}
      window.__display = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = () => { window.__display++; return Promise.reject(new Error('no')); };
    }, JWT);
    await context.route(/^https:\/\/(?!customer-test\.cloudflarestream\.com|api\.mccluster\.org)/, (route) => { seen.other.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); });
    /* Supabase stand-in: the signed-in member the page and the bar expect */
    await context.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
      const u = new URL(route.request().url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'a@test' }) });
      if (u.pathname === '/auth/v1/token') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ access_token: JWT, refresh_token: 'r' }) });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
    });
    await context.route('https://api.mccluster.org/**', async (route) => {
      const r = route.request(), u = new URL(r.url());
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' }, body: '' });
      if (!r.headers().authorization) return json(401, { error: 'sign in' });
      if (u.pathname === '/v1/live/sessions' && r.method() === 'POST') {
        seen.start = r.postDataJSON();
        return json(201, { ok: true, session_id: '5e55a000-0000-4000-8000-000000000001', whip_url: WHIP, live_mode: 'required', policy: { min_duration_seconds: 4, resume_window_minutes: 10 }, heartbeat_seconds: 5, chunk_seconds: 2, pin: { city: 'Hartford', precision: 'city' } });
      }
      if (u.pathname.endsWith('/heartbeat')) { seen.heartbeats++; return json(200, { ok: true, status: 'live', continuity: { state: 'continuous', gaps: 0 } }); }
      if (/\/chunks\/\d+$/.test(u.pathname) && r.method() === 'PUT') { seen.chunks.push({ type: r.headers()['content-type'], bytes: (r.postDataBuffer() || Buffer.alloc(0)).length }); return json(200, { ok: true }); }
      if (u.pathname.endsWith('/complete')) { seen.complete++; return json(200, { ok: true, status: 'completed', proof_status: 'pending' }); }
      if (u.pathname.endsWith('/publishing')) { seen.publishing = r.postDataJSON(); return json(200, { ok: true }); }
      return json(404, { error: 'not mocked' });
    });
    await context.route('https://customer-test.cloudflarestream.com/**', async (route) => {
      const r = route.request();
      if (r.method() === 'POST') {
        seen.whipPost = { type: r.headers()['content-type'], sdp: r.postData() || '' };
        const answer = await answerer.evaluate(async (offer) => {
          const pc = new RTCPeerConnection();
          window.__answerers = (window.__answerers || []).concat(pc);
          await pc.setRemoteDescription({ type: 'offer', sdp: offer });
          await pc.setLocalDescription(await pc.createAnswer());
          await new Promise((res) => { if (pc.iceGatheringState === 'complete') res(); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && res(); setTimeout(res, 2500); } });
          return pc.localDescription.sdp;
        }, seen.whipPost.sdp);
        return route.fulfill({ status: 201, contentType: 'application/sdp', headers: { location: '/SECRETKEY/webRTC/publish/session-1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'location' }, body: answer });
      }
      if (r.method() === 'DELETE') { seen.whipDelete++; return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,DELETE', 'access-control-allow-headers': 'content-type' }, body: '' });
    });

    const tag = `[${vp.name} ${vp.width}]`;
    page.on('console', (m) => { if (m.type() === 'error') console.log(`  console: ${m.text()}`); });
    await page.goto(`${ORIGIN}/live-mission.html?assignment=${ASSIGNMENT}&mission=${encodeURIComponent('Help a person')}`);
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
    check(await noScroll(), `${tag} no horizontal scroll on arrival`);
    check((await page.textContent('#lmMission')) === 'Help a person', `${tag} mission title shown`);
    check(await page.isDisabled('#lmGo'), `${tag} Go live disabled before camera and rules`);
    await page.screenshot({ path: join(OUT, `${vp.name}-1-setup.png`), fullPage: true });
    await page.click('#lmCamera');
    await page.waitForFunction(() => document.getElementById('lmVideo').srcObject, null, { timeout: 10000 });
    check(await page.isDisabled('#lmGo'), `${tag} still disabled until the three rules are confirmed`);
    for (const id of ['#lmAdult', '#lmMinors', '#lmRules']) await page.check(id);
    await page.selectOption('#lmThird', 'kept_off_camera');
    check(!(await page.isDisabled('#lmGo')), `${tag} Go live enabled`);
    await page.click('#lmGo');
    await page.waitForSelector('#lmLive:not([hidden])', { timeout: 15000 }).catch(async (e) => { console.log(`  status: ${await page.textContent('#lmStatus')}`, JSON.stringify({ start: !!seen.start, whip: !!seen.whipPost, other: seen.other.slice(0, 5) })); throw e; });
    check(seen.start && seen.start.assignment_id === ASSIGNMENT && seen.start.attest.adult === true && seen.start.third_party_mode === 'kept_off_camera', `${tag} start request carries the assignment, the rules and the helped-person choice`);
    check(seen.whipPost && seen.whipPost.type === 'application/sdp' && seen.whipPost.sdp.startsWith('v=0'), `${tag} WHIP offer POSTed as application/sdp`);
    const connected = await page.waitForSelector('#lmBadge.is-on', { timeout: 15000 }).then(() => true, () => false);
    check(connected, `${tag} the WebRTC publish connected (LIVE badge)`);
    check(await noScroll(), `${tag} no horizontal scroll while live`);
    await page.screenshot({ path: join(OUT, `${vp.name}-2-live.png`), fullPage: true });
    await page.waitForFunction(() => !document.getElementById('lmDone').disabled, null, { timeout: 15000 });
    check(true, `${tag} Mission complete unlocked after the policy minimum`);
    await page.waitForTimeout(2500);
    check(seen.heartbeats >= 1, `${tag} heartbeats sent (${seen.heartbeats})`);
    check(seen.chunks.length >= 1 && seen.chunks.every((c) => /^video\/(webm|mp4)/.test(c.type) && c.bytes > 0), `${tag} recording chunks uploaded while live (${seen.chunks.length})`);
    await page.click('#lmDone');
    await page.waitForSelector('#lmAfter:not([hidden])', { timeout: 15000 });
    check(seen.complete === 1, `${tag} completion filed once`);
    check(/Sent for review/.test(await page.textContent('#lmStatus')), `${tag} says sent for review`);
    check(seen.whipDelete >= 1, `${tag} WHIP session DELETEd on finish`);
    const offByDefault = await page.evaluate(() => [...document.querySelectorAll('#lmPublish input[type=checkbox]')].every((i) => !i.checked));
    check(offByDefault, `${tag} every publishing opt-in starts off`);
    await page.check('#lmPublish input[name=edit_clip]');
    await page.click('#lmPublish button[type=submit]');
    await page.waitForFunction(() => /Choices saved/.test(document.getElementById('lmStatus').textContent), null, { timeout: 10000 });
    const c = seen.publishing && seen.publishing.choices;
    check(c && c.edit_clip === true && c.clipper_share === false && c.paid_ads === false && c.face === 'blur' && c.location_display === 'none' && /^[0-9a-f]{64}$/.test(seen.publishing.text_sha256), `${tag} saves only what was turned on, with the consent text hash`);
    check(await noScroll(), `${tag} no horizontal scroll after finishing`);
    check((await page.evaluate(() => window.__display)) === 0, `${tag} never asked for the screen`);
    check(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('SECRETKEY'), `${tag} the WHIP URL is not stored`);
    await page.screenshot({ path: join(OUT, `${vp.name}-3-review.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed');
console.log(`screenshots: ${OUT}`);
process.exit(fails.length ? 1 : 0);
