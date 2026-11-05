/* PRIM3, its own artist (owner, 2026-11-02), in a real browser against this
   checkout's files; every network call is a fixture (no Supabase, no Worker).
     - prim3-artist.html at 390, 820 and 1280: no sideways scroll, the
       supplied mark at its own proportions, the 13 songs linking into the
       player, the course link, "Managed by Matthew McCluster";
     - album.html?album=prim3: the album is Cyber Security Specialist, billed
       to PRIM3, and the name opens the artist page;
     - Control · Sell · Music · Artists ("Acting as") at 390 and 1280: while
       music_my_artists is not deployed, the house artist, PRIM3 and Equity
       Uprise from the public catalog with the "backend is pending" note;
       once it answers, the account's own list and no note.
   PLAYWRIGHT_DIR=<node_modules> [PLAYWRIGHT_BROWSERS_PATH=…] node scripts/e2e/prim3-artist.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/prim3-artist-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const OWNER = '11111111-1111-4111-8111-111111111111';
let failures = 0;
function check(scope, name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail))); if (!ok) failures++; }
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });

async function setup(viewport, { signedIn = false, labelRows = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const errors = [], rpcs = [];
  await ctx.addInitScript(({ OWNER, signedIn }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    if (!signedIn) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: OWNER, email: 'owner@fixture.invalid' })).replace(/=+$/, '') + '.y', refresh_token: 'fixture-only', expires_at: exp, user: { id: OWNER, email: 'owner@fixture.invalid' } }));
  }, { OWNER, signedIn });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === 'https://api.mccluster.org') {
      if (p === '/v1/status') return json(route, { ok: true, operator: { email: 'owner@fixture.invalid' }, database: { reachable: true } });
      if (p === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: OWNER }, default_org_id: 'o1', workspaces: [{ org_id: 'o1', slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] });
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0, items: [], posts: [], tracks: [] });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return json(route, { id: OWNER, email: 'owner@fixture.invalid' });
      if (p === '/rest/v1/rpc/music_my_artists') {
        rpcs.push(p);
        /* not deployed: PostgREST's answer for a missing function */
        if (!labelRows) return json(route, { code: 'PGRST202', message: 'Could not find the function public.music_my_artists without parameters in the schema cache' }, 404);
        return json(route, labelRows);
      }
      return json(route, []);
    }
    if (u.origin === BASE) {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, ''));
      if (/^assets\/(audio|video)\//.test(rel) || /\.(mp4|webm|m4a|mp3)$/i.test(rel)) return route.fulfill({ status: 404, body: '' });
      const file = resolve(ROOT, rel); if (!file.startsWith(resolve(ROOT) + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors, rpcs };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ---- the artist page, phone first ---- */
for (const vp of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 900 }]) {
  const scope = 'artist ' + vp.width;
  const { ctx, page, errors } = await setup(vp);
  await page.goto(`${BASE}/prim3-artist.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const facts = await page.evaluate(() => {
    const mark = document.querySelector('.p3a__mark');
    const r = mark.getBoundingClientRect();
    return {
      h1: document.querySelector('h1').textContent.trim(),
      tracks: [...document.querySelectorAll('#p3aTracks a')].map((a) => a.getAttribute('href')),
      managed: document.getElementById('p3aManaged').innerText,
      course: !!document.querySelector('a[href="prim3.html"]'),
      play: !!document.querySelector('a[href="album.html?album=prim3"]'),
      album: document.getElementById('p3aAlbum').textContent.trim(),
      mark: { src: mark.getAttribute('src'), w: r.width, h: r.height, nw: mark.naturalWidth, nh: mark.naturalHeight }
    };
  });
  check(scope, 'no sideways scroll', (await overflow(page)) === 0, await overflow(page));
  check(scope, 'the act is the page', facts.h1 === 'PRIM3', facts.h1);
  check(scope, 'the album by name', facts.album === 'Cyber Security Specialist', facts.album);
  check(scope, '13 songs, each into the player', facts.tracks.length === 13 && facts.tracks.every((h) => h.startsWith('album.html?album=prim3&t=')), facts.tracks);
  check(scope, 'Got WiFi? first', facts.tracks[0] === 'album.html?album=prim3&t=Got%20WiFi%3F', facts.tracks[0]);
  check(scope, 'says who manages it, plainly', /^Managed by Matthew McCluster\./.test(facts.managed), facts.managed);
  check(scope, 'links the course and the player', facts.course && facts.play);
  check(scope, 'the supplied mark, whole, at its own proportions', facts.mark.src === 'assets/img/prim3-logo.png' && facts.mark.nw > 0
    && Math.abs(facts.mark.w / facts.mark.h - facts.mark.nw / facts.mark.nh) < 0.02, facts.mark);
  check(scope, 'no script errors', errors.length === 0, errors);
  /* the site fades sections in as they enter the viewport, so a full-page
     capture shows the fold's far side blank: make the viewport the page's
     height (the width, and so the layout, unchanged) and let them arrive */
  await page.setViewportSize({ width: vp.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `prim3-artist-${vp.width}.jpg`), type: 'jpeg', quality: 60 });
  await ctx.close();
}

/* ---- the player bills the album to PRIM3 and opens its page ---- */
{
  const scope = 'album 390';
  const { ctx, page, errors } = await setup({ width: 390, height: 844 });
  await page.goto(`${BASE}/album.html?album=prim3`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('albName').textContent.trim().length > 0, null, { timeout: 15000 });
  const f = await page.evaluate(() => ({
    name: document.getElementById('albName').textContent.trim(),
    artist: document.getElementById('albArtist').textContent.trim(),
    href: (document.querySelector('#albArtist a') || {}).getAttribute ? document.querySelector('#albArtist a').getAttribute('href') : null,
    now: document.getElementById('nowBy').textContent.trim()
  }));
  check(scope, 'Cyber Security Specialist', f.name === 'Cyber Security Specialist', f);
  check(scope, 'billed to PRIM3, everywhere it credits', f.artist === 'PRIM3' && f.now === 'PRIM3', f);
  check(scope, 'the name opens the artist page', f.href === 'prim3-artist.html', f);
  check(scope, 'no sideways scroll', (await overflow(page)) === 0, await overflow(page));
  check(scope, 'no script errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---- Control: Acting as ---- */
async function openArtists(page) {
  await page.goto(`${BASE}/control.html#sell:music:artists`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-crla-switch]').waitFor({ timeout: 30000 });
}
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  const scope = 'control pending ' + vp.width;
  const { ctx, page, errors, rpcs } = await setup(vp, { signedIn: true });
  await openArtists(page);
  const opts = await page.locator('[data-crla-switch] option').allTextContents();
  check(scope, 'asked the backend first', rpcs.length >= 1, rpcs);
  check(scope, 'the house artist, then the label\'s acts', JSON.stringify(opts) === JSON.stringify(['Matthew McCluster (you)', 'PRIM3', 'Equity Uprise']), opts);
  check(scope, 'says the backend is pending', await page.locator('[data-crla-pending]').isVisible());
  await page.selectOption('[data-crla-switch]', 'prim3');
  const cur = await page.locator('[data-crla-current]').innerText();
  check(scope, 'acting as PRIM3 shows its album and its standing', /PRIM3/.test(cur) && /Cyber Security Specialist/.test(cur) && /no login of its own yet/.test(cur), cur);
  check(scope, 'remembered on this device', (await page.evaluate(() => localStorage.getItem('mcc_music_acting_as'))) === 'prim3');
  check(scope, 'no sideways scroll', (await overflow(page)) === 0, await overflow(page));
  check(scope, 'no script errors', errors.length === 0, errors);
  await page.locator('[data-crla]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, `control-artists-pending-${vp.width}.jpg`), type: 'jpeg', quality: 60 });
  await ctx.close();
}
{
  const scope = 'control backend 390';
  const rows = [
    { m_uid: 'a', handle: 'matthew', artist_name: 'Matthew McCluster', avatar_url: '', relation: 'self', role: 'owner', has_login: true, profile_status: 'active' },
    { m_uid: 'b', handle: 'equity-uprise', artist_name: 'Equity Uprise', avatar_url: '', relation: 'managed', role: 'label_admin', has_login: false, profile_status: 'active' },
    { m_uid: 'c', handle: 'prim3', artist_name: 'PRIM3', avatar_url: '', relation: 'managed', role: 'label_admin', has_login: false, profile_status: 'active' }
  ];
  const { ctx, page, errors } = await setup({ width: 390, height: 844 }, { signedIn: true, labelRows: rows });
  await openArtists(page);
  const opts = await page.locator('[data-crla-switch] option').allTextContents();
  check(scope, 'the account\'s own list', JSON.stringify(opts) === JSON.stringify(['Matthew McCluster (you)', 'Equity Uprise', 'PRIM3']), opts);
  check(scope, 'no pending note once it is real', (await page.locator('[data-crla-pending]').count()) === 0);
  check(scope, 'no script errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nPRIM3 artist: all checks pass');
process.exit(failures ? 1 : 0);
