/* Direct checkout, in a real browser at phone width (390px), against the real
   pages with every network call answered by fixtures: no production API,
   Stripe or Storage request escapes.

   - album.html and catalogue.html show "Buy <format> — $X" (the file's real
     format) on exactly the
     recordings with an offer on sale, and on no other row;
   - tapping it posts { action: "checkout", offer_key } and nothing priced,
     then goes to the Checkout URL; the album row does not start playing;
   - purchase.html?session_id=… claims, rewrites the address to ?token=…,
     shows downloads left and downloads; an exhausted purchase is refused;
     a canceled checkout says nothing was charged;
   - every page: scrollWidth === clientWidth at 390px.
   Usage: node scripts/e2e/music-direct-checkout.e2e.mjs [outdir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/music-direct-checkout-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const HOUSE = 'https://matthew.mccluster.org';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const IMAGE = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const TOKEN = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const OFFERS = [
  { offer_key: 'here--antisocial', catalog_key: 'here:antisocial', title: 'Antisocial', price_cents: 199, currency: 'usd', format: 'wav' },
  { offer_key: 'heal-the-3--deep-end', catalog_key: 'heal-the-3:deep-end', title: 'Deep End', price_cents: 299, currency: 'usd', format: 'mp3' }
];
await mkdir(OUT, { recursive: true });
let failures = 0;
function check(name, pass, detail) { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`); if (!pass) failures++; }

async function setup(start, { left = 4, operator = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript((operator) => {
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      if (operator) {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const tok = 'x.' + btoa(JSON.stringify({ exp, sub: '11111111-1111-4111-8111-111111111111', email: 'owner@fixture.invalid' })).replace(/=+$/, '') + '.y';
        localStorage.setItem('mccdb_session', JSON.stringify({ access_token: tok, refresh_token: 'fixture-only', expires_at: exp, user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@fixture.invalid' } }));
      }
    } catch (_) {}
  }, operator);
  const calls = [], errors = [];
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  await context.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.hostname.endsWith('supabase.co') && p.startsWith('/functions/v1/music-direct-')) {
      const body = JSON.parse(req.postData() || '{}');
      calls.push({ fn: p.split('/').pop(), body });
      if (p.endsWith('music-direct-checkout')) {
        if (body.action === 'offers') return json(r, { ok: true, offers: OFFERS });
        if (body.action === 'checkout') { await new Promise((ok) => setTimeout(ok, 600)); return json(r, { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }); }
      }
      if (p.endsWith('music-direct-access') && body.action === 'operator-direct-list') {
        if (!operator || !/^Bearer x\./.test(req.headers().authorization || '')) return json(r, { error: 'operator permission required' }, 403);
        return json(r, { ok: true, catalogue: [
          { catalog_key: 'here:here', album_title: 'I AM HERE', track_title: 'Here', artist_name: 'McCluster' },
          { catalog_key: 'here:antisocial', album_title: 'I AM HERE', track_title: 'Antisocial', artist_name: 'McCluster' },
          { catalog_key: 'whip-equipped:dealer-plates-a-side', album_title: 'Whip Equipped', track_title: 'Dealer Plates (A-Side)', artist_name: 'McCluster' }
        ], offers: [{ offer_key: 'here--antisocial', catalog_key: 'here:antisocial', title: 'Antisocial', price_cents: 199, currency: 'usd', asset_path: 'direct-sales/here/antisocial/u-antisocial.wav', active: true, max_downloads: 5, download_window_days: 30 }],
        sales: { 'here--antisocial': { paid: 3, refunded: 1, gross_cents: 597 } }, defaults: { max_downloads: 5, download_window_days: 30 } });
      }
      if (p.endsWith('music-direct-access') && body.action === 'operator-direct-save') return json(r, { ok: true, offer: {} });
      if (p.endsWith('music-direct-access')) {
        const view = { title: 'Antisocial', format: 'wav', downloads_used: 5 - left, downloads_left: left, max_downloads: 5, expires_at: '2026-11-29T00:00:00Z', can_download: left > 0,
          refusal: left > 0 ? null : { reason: 'download_limit', message: 'This purchase has used all of its downloads.' } };
        if (body.action === 'claim') return json(r, { ok: true, state: 'paid', token: TOKEN, ...view });
        if (body.action === 'status') return json(r, { ok: true, state: 'paid', ...view });
        if (body.action === 'download') return left > 0 ? json(r, { ok: true, url: HOUSE + '/__signed/antisocial.mp3', downloads_left: left - 1 }) : json(r, { error: 'This purchase has used all of its downloads.', reason: 'download_limit' }, 429);
      }
      return json(r, { error: 'fixture' }, 400);
    }
    if (u.hostname.endsWith('supabase.co') && p === '/functions/v1/music-access') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'operator-status') return json(r, { ok: true, operator });
      if (body.action === 'operator-dashboard') return json(r, { ok: true, tracks: [], creators: [], offers: [] });
    }
    if (u.hostname === 'api.mccluster.org') {
      if (p === '/v1/status') return operator ? json(r, { ok: true, operator: { email: 'owner@fixture.invalid' }, database: { reachable: true } }) : json(r, { error: 'Forbidden' }, 403);
      if (p === '/v1/workspaces/me') return json(r, { ok: true, profile: { id: '11111111-1111-4111-8111-111111111111' }, default_org_id: 'o1', workspaces: [{ org_id: 'o1', slug: 'mccluster', kind: 'studio', role: operator ? 'owner' : 'viewer', enabled: true, name: 'McCluster' }] });
      return json(r, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [] });
    }
    if (u.hostname === 'checkout.stripe.com') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe fixture</title><p>stripe</p>' });
    if (u.hostname.endsWith('supabase.co') || u.hostname === 'api.mccluster.org') return json(r, []);
    if (u.origin === HOUSE) {
      if (p.startsWith('/__signed/')) return r.fulfill({ status: 200, contentType: 'text/plain', body: 'audio' });
      if (p.startsWith('/assets/audio/')) return r.fulfill({ status: 404, body: '' });
      const path = resolve(ROOT, '.' + (p === '/' ? '/index.html' : decodeURIComponent(p)));
      if (path.startsWith(resolve(ROOT) + sep)) {
        try { return r.fulfill({ body: await readFile(path), contentType: MIME[extname(path)] || 'application/octet-stream' }); } catch {}
      }
      if (/\.(?:png|jpe?g|webp|gif)$/.test(p)) return r.fulfill({ contentType: 'image/gif', body: IMAGE });
      return r.fulfill({ status: 404, body: 'Fixture: file absent' });
    }
    return r.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(HOUSE + start, { waitUntil: 'load' });
  return { context, page, calls, errors };
}
const noOverflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

/* ---- album.html ---- */
{
  const { context, page, calls } = await setup('/album.html?album=here');
  await page.waitForSelector('#tracks li[data-title="Antisocial"] [data-direct-offer]', { timeout: 15000 });
  const buttons = await page.$$eval('[data-direct-offer]', (bs) => bs.map((b) => ({ key: b.getAttribute('data-direct-offer'), text: b.textContent, row: b.closest('li').getAttribute('data-title') })));
  check('album: one buy button, on the recording on sale', buttons.length === 1 && buttons[0].row === 'Antisocial' && buttons[0].key === 'here--antisocial', buttons);
  check('album: button names the real format and the price', buttons[0]?.text === 'Buy WAV — $1.99', buttons[0]?.text);
  let o = await noOverflow(page);
  check('album: no horizontal scroll at 390px', o.sw === o.cw, o);
  await page.locator('#tracks li[data-title="Antisocial"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, 'album-390.png') });
  const nav = page.waitForURL(/checkout\.stripe\.com/, { timeout: 10000 });
  await page.click('#tracks li[data-title="Antisocial"] [data-direct-offer]');
  /* the checkout answer is held 600ms: the row must not have started playing meanwhile */
  const playing = await page.$eval('#tracks li[data-title="Antisocial"]', (li) => li.classList.contains('on'));
  const busy = await page.$eval('[data-direct-offer]', (b) => b.getAttribute('aria-busy'));
  await nav;
  const req = calls.find((c) => c.body.action === 'checkout');
  check('album: checkout names the offer and nothing else', req && JSON.stringify(Object.keys(req.body).sort()) === JSON.stringify(['action', 'offer_key']) && req.body.offer_key === 'here--antisocial', req);
  check('album: tap went to Stripe Checkout', page.url().startsWith('https://checkout.stripe.com/'), page.url());
  check('album: tapping Buy does not play the row', playing === false, playing);
  check('album: the button shows it is working', busy === 'true', busy);
  await context.close();
}

/* ---- catalogue.html ---- */
{
  const { context, page } = await setup('/catalogue.html');
  await page.waitForSelector('#reg li[data-albslug] [data-direct-offer]', { timeout: 15000 });
  const rows = await page.$$eval('[data-direct-offer]', (bs) => bs.map((b) => b.closest('li').id).sort());
  const labels = await page.$$eval('[data-direct-offer]', (bs) => bs.map((b) => b.textContent).sort());
  check('catalogue: each button names its own format', JSON.stringify(labels) === JSON.stringify(['Buy MP3 — $2.99', 'Buy WAV — $1.99']), labels);
  check('catalogue: buy buttons exactly on the two recordings on sale', JSON.stringify(rows) === JSON.stringify(['antisocial', 'deep-end']), rows);
  const o = await noOverflow(page);
  check('catalogue: no horizontal scroll at 390px', o.sw === o.cw, o);
  await page.screenshot({ path: join(OUT, 'catalogue-390.png'), fullPage: true });
  await context.close();
}

/* ---- purchase.html: return from Stripe ---- */
{
  const { context, page, calls, errors } = await setup('/purchase.html?session_id=cs_test_fixture123');
  await page.waitForSelector('#ppCard:not([hidden])', { timeout: 10000 });
  check('purchase: the session is claimed', calls.some((c) => c.body.action === 'claim' && c.body.session_id === 'cs_test_fixture123'), calls);
  check('purchase: the address now carries the token, not the session', page.url() === `${HOUSE}/purchase.html?token=${TOKEN}`, page.url());
  check('purchase: title, real format and downloads left', (await page.textContent('#ppTitle')) === 'Antisocial · WAV' && (await page.textContent('#ppDownload')) === 'Download WAV' && /4 of 5 downloads left/.test(await page.textContent('#ppMeta')), await page.textContent('#ppMeta'));
  check('purchase: the kept link is shown', (await page.inputValue('#ppLink')) === `${HOUSE}/purchase.html?token=${TOKEN}`);
  const o = await noOverflow(page);
  check('purchase: no horizontal scroll at 390px', o.sw === o.cw, o);
  const fontSize = await page.$eval('#ppLink', (el) => parseFloat(getComputedStyle(el).fontSize));
  check('purchase: form control at least 16px', fontSize >= 16, fontSize);
  await page.screenshot({ path: join(OUT, 'purchase-390.png'), fullPage: true });
  await Promise.all([page.waitForURL(/__signed/, { timeout: 10000 }), page.click('#ppDownload')]);
  check('purchase: download uses the token', calls.some((c) => c.body.action === 'download' && c.body.token === TOKEN), calls);
  check('purchase: no page errors', errors.length === 0, errors);
  await context.close();
}

/* ---- purchase.html: exhausted, and canceled ---- */
{
  const { context, page } = await setup(`/purchase.html?token=${TOKEN}`, { left: 0 });
  await page.waitForSelector('#ppCard:not([hidden])', { timeout: 10000 });
  check('purchase: an exhausted purchase cannot download', await page.$eval('#ppDownload', (b) => b.disabled), null);
  check('purchase: and says why', /used all of its downloads/.test(await page.textContent('#ppStatus')), await page.textContent('#ppStatus'));
  await context.close();
}
{
  const { context, page } = await setup('/purchase.html?canceled=1&offer=here--antisocial');
  check('purchase: canceled says nothing was charged', /Nothing was charged/.test(await page.textContent('#ppLead')), await page.textContent('#ppLead'));
  const o = await noOverflow(page);
  check('purchase (canceled): no horizontal scroll at 390px', o.sw === o.cw, o);
  await context.close();
}

/* ---- Control · Create · Music · Direct sales (music-admin.html forwards here) ---- */
{
  const { context, page, calls, errors } = await setup('/control.html#create:music', { operator: true });
  await page.waitForSelector('[data-crom-section="direct"]', { timeout: 20000 });
  await page.click('[data-crom-section="direct"]');
  await page.waitForSelector('[data-crds="here:antisocial"]', { timeout: 15000 });
  const rows = await page.$$eval('[data-crds]', (r) => r.map((x) => x.getAttribute('data-crds')));
  check('control: every catalogue recording is listed', rows.length === 3, rows);
  const text = await page.textContent('[data-crds="here:antisocial"]');
  check('control: the live offer reads as on sale with its format and sales', /on sale WAV \$1\.99/.test(text) && /sold as WAV, unconverted/.test(text) && /3 sold, 1 refunded/.test(text), text);
  const o = await noOverflow(page);
  check('control: no horizontal scroll at 390px', o.sw === o.cw, o);
  const sizes = await page.$$eval('[data-crds] input', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check('control: form controls at least 16px', sizes.length > 0 && sizes.every((x) => x >= 16), sizes);
  await page.locator('[data-crds="here:antisocial"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, 'control-direct-sales-390.png') });
  await page.fill('[data-crds="here:antisocial"] [data-crds-f="price"]', '2.49');
  await page.click('[data-crds="here:antisocial"] [data-crds-save="off"]');
  await page.waitForFunction(() => /Taken off sale/.test(document.querySelector('[data-crds="here:antisocial"]')?.textContent || ''), null, { timeout: 10000 });
  const save = calls.find((c) => c.body.action === 'operator-direct-save');
  check('control: save goes through the operator action with the price in cents', save && save.body.price_cents === 249 && save.body.active === false && save.body.catalog_key === 'here:antisocial', save);
  check('control: no page errors', errors.length === 0, errors);
  await context.close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'music direct checkout: all checks passed');
assert.equal(failures, 0);
