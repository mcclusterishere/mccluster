/* Isolated Chromium fixtures. Every remote request is intercepted, including
 * sign-in/signup; no real account, invitation or profile is created or claimed. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightResponse } from '../../workers/mccluster/src/preflight.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'cohort-claim');
const { chromium } = createRequire(import.meta.url)('playwright');
const INVITE = 'abcdef12'.repeat(8); // Synthetic test token, never submitted outside fixtures.
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'cohort-fixture@example.invalid' };
const MUID = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'docket-516r-2025';
const session = () => ({ access_token: 'x.' + Buffer.from(JSON.stringify({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.fixture', refresh_token: 'fixture-only', expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://local').pathname)).replace(/^([.][.][/\\])+/, '');
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [], active = new Set();
function check(name, ok, detail) { results.push({ name, ok: !!ok, ...(detail ? { detail } : {}) }); assert.ok(ok, name); }

async function scenario({ member = false, expired = false, errorCode = null, malformed = false } = {}) {
  const state = { member, expired, errorCode, malformed, previews: [], claims: [], signIns: [], signups: [], requests: [], heldClaim: null, deferClaim: false };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  active.add(ctx);
  await ctx.addInitScript(({ member, authSession }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (member) localStorage.setItem('mccdb_session', JSON.stringify(authSession));
  }, { member, authSession: session() });
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const record = { url: req.url(), method: req.method(), headers: req.headers(), body: req.postData() || '' };
    state.requests.push(record);
    if (url.origin === BASE) {
      if (url.pathname === '/js/tabbar.js') {
        // Observe the moment the real navigation starts, without replacing any
        // of its behavior or exposing a real invitation outside this fixture.
        const source = await readFile(join(ROOT, 'js/tabbar.js'), 'utf8');
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__cohortNavBoot = { hash: location.hash, invitation: sessionStorage.getItem("mcc.cohort.invitation") };\n' + source });
      }
      return route.continue();
    }
    const headers = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,apikey,content-type,prefer', 'access-control-allow-methods': 'GET,POST,OPTIONS,PATCH,DELETE' };
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') {
      if (url.hostname === 'api.mccluster.org' && url.pathname.startsWith('/v1/action-archive/')) {
        // Exercise the actual Worker preflight contract. A missing prefix must
        // fail this browser journey instead of a test-fixture-forged 204.
        const result = preflightResponse(new Request(req.url(), {
          method: 'OPTIONS', headers: req.headers()
        }), { ALLOWED_ORIGINS: BASE });
        if (!result) return route.fulfill({ status: 405, headers });
        return route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers) });
      }
      return route.fulfill({ status: 204, headers });
    }
    if (url.hostname === 'api.mccluster.org') {
      if (url.pathname === '/v1/action-archive/invitation') {
        state.previews.push(req.postDataJSON());
        if (state.expired) return json({ error: 'This invitation is unavailable or expired. Ask the organizer for a new link.' }, 409);
        return json({ project_slug: PROJECT, participant_slug: 'ocho-great', display_name: 'Ocho Great', project_title: 'Docket 516R', expires_at: '2030-01-01T00:00:00Z' });
      }
      if (url.pathname === '/v1/action-archive/claim') {
        state.claims.push({ body: req.postDataJSON(), authorization: req.headers().authorization });
        if (state.deferClaim) await new Promise(resolve => { state.heldClaim = resolve; });
        if (state.errorCode) return json({ code: state.errorCode, error: state.errorCode === 'M_ACCOUNT_PROFILE_REQUIRED' ? 'Finish your M Account profile, then return to this invitation.' : 'This account already has a profile in this cohort.' }, 409);
        if (state.malformed) return json({ status: 'pending' });
        return json({ project_slug: PROJECT, participant_slug: 'ocho-great', m_uid: MUID });
      }
      return json({});
    }
    if (url.hostname === 'zmnhbrjyhxzhkxmhkexs.supabase.co') {
      if (url.pathname.endsWith('/auth/v1/token')) { state.signIns.push(req.postDataJSON()); state.member = true; return json(session()); }
      if (url.pathname.endsWith('/auth/v1/signup')) { state.signups.push(req.postDataJSON()); state.member = true; return json(session()); }
      if (url.pathname.endsWith('/auth/v1/user')) return json(state.member ? USER : { error: 'No session' }, state.member ? 200 : 401);
      if (url.pathname.endsWith('/auth/v1/logout')) { state.member = false; return json({}); }
      if (url.pathname.endsWith('/auth/v1/settings')) return json({ external: {} });
      if (url.pathname.endsWith('/rpc/m_touch_app')) return json({ m_uid: MUID, auth_user_id: USER.id });
      if (url.pathname.endsWith('/rpc/m_my_uid')) return json(MUID);
      return json([]);
    }
    return route.abort();
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page, state, errors };
}
async function close(s) { await s.ctx.close(); active.delete(s.ctx); }
async function open(s) { await s.page.goto(BASE + '/cohort-claim.html#invite=' + INVITE); await s.page.waitForFunction(() => document.getElementById('claimStatus').textContent !== 'Checking your invitation…'); }
async function fit(s, name) { const size = await s.page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); check(name, size.width === 390 && size.scroll === 390, size); }
async function tokenSaved(s) { return s.page.evaluate(() => JSON.parse(sessionStorage.getItem('mcc.cohort.invitation') || 'null')?.token || null); }
function noLeaks(s, name) {
  const leaked = s.state.requests.some(r => r.url.includes(INVITE) || (r.headers.referer || '').includes(INVITE) ||
    (r.body.includes(INVITE) && !/^https:\/\/api\.mccluster\.org\/v1\/action-archive\/(invitation|claim)$/.test(r.url)));
  check(name, !leaked);
}

try {
  await mkdir(OUT, { recursive: true });
  {
    const s = await scenario(); await open(s);
    await s.page.waitForSelector('#claimSignIn:not([hidden])');
    check('private fragment is removed and retained only for the same tab', new URL(s.page.url()).hash === '' && await tokenSaved(s) === INVITE);
    const navigation = await s.page.evaluate(() => window.__cohortNavBoot);
    check('the actual shared navigation starts only after the private fragment is stored and removed', navigation?.hash === '' && JSON.parse(navigation?.invitation || 'null')?.token === INVITE && await s.page.locator('.appbar').count() === 1);
    check('preview identifies the intended participant without auto-claim', (await s.page.locator('#claimTitle').innerText()).includes('Ocho Great') && s.state.claims.length === 0 && await s.page.locator('#claimConfirm').isDisabled());
    await fit(s, 'invitation sign-in fits 390px'); await s.page.screenshot({ path: join(OUT, 'invitation-signin-390.png') });
    await s.page.locator('#claimEmail').fill('cohort-fixture@example.invalid'); await s.page.locator('#claimPassword').fill('Fixture Password 123');
    await s.page.locator('#claimSignIn button').click(); await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled);
    check('sign-in uses the existing M Account JSON contract', s.state.signIns.length === 1 && s.state.signIns[0].email === USER.email && s.state.signIns[0].password === 'Fixture Password 123');
    check('sign-in does not claim and clears the password input', s.state.claims.length === 0 && await s.page.locator('#claimPassword').inputValue() === '');
    await s.page.locator('#claimConfirm').scrollIntoViewIfNeeded();
    const connect = await s.page.locator('#claimConfirm').evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight, unobstructed: hit === button || button.contains(hit), enabled: !button.disabled };
    });
    check('the shared app bar leaves the enabled Connect button visible and unobstructed at 390px', connect.visible && connect.unobstructed && connect.enabled, connect);
    await s.page.screenshot({ path: join(OUT, 'ready-to-connect-390.png') });
    s.state.deferClaim = true; await s.page.locator('#claimConfirm').click(); await s.page.waitForFunction(() => document.getElementById('claimConfirm').disabled);
    await s.page.evaluate(() => { document.getElementById('claimConfirm').click(); document.getElementById('claimConfirm').click(); });
    check('explicit claim serializes duplicate taps', s.state.claims.length === 1);
    s.state.deferClaim = false; s.state.heldClaim(); await s.page.waitForSelector('#claimDone:not([hidden])');
    check('claim carries only token plus authenticated header', JSON.stringify(s.state.claims[0].body) === JSON.stringify({ token: INVITE }) && s.state.claims[0].authorization.startsWith('Bearer '));
    check('confirmed claim clears the private invitation and exposes distinct profile/page links', await tokenSaved(s) === null && (await s.page.locator('#claimProvider').getAttribute('href')).startsWith('docket-516r-cohort.html?person=') && (await s.page.locator('#claimProfile').getAttribute('href')).startsWith('cohort-profile.html?project='));
    await fit(s, 'confirmed claim fits 390px'); await s.page.screenshot({ path: join(OUT, 'claimed-390.png') }); noLeaks(s, 'invitation never enters request URL, referrer, or unrelated telemetry');
    check('sign-in and claim have no script errors', s.errors.length === 0, s.errors); await close(s);
  }
  {
    const s = await scenario({ member: true, errorCode: 'ACCOUNT_ALREADY_LINKED_TO_COHORT' }); await open(s); await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled);
    await s.page.locator('#claimConfirm').click(); await s.page.getByText('This account already has a profile in this cohort.', { exact: true }).waitFor();
    check('wrong-account refusal preserves invitation and does not show success', await tokenSaved(s) === INVITE && await s.page.locator('#claimDone').isHidden());
    await s.page.locator('#claimSwitch').click(); await s.page.waitForSelector('#claimSignIn:not([hidden])');
    check('switching accounts preserves the invitation', await tokenSaved(s) === INVITE);
    s.state.errorCode = null; await s.page.locator('#claimEmail').fill(USER.email); await s.page.locator('#claimPassword').fill('Fixture Password 123'); await s.page.locator('#claimSignIn button').click();
    await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled); await s.page.locator('#claimConfirm').click(); await s.page.waitForSelector('#claimDone:not([hidden])');
    check('the participant can retry after changing account', s.state.claims.length === 2 && await tokenSaved(s) === null); noLeaks(s, 'account switch does not disclose invitation'); await close(s);
  }
  {
    const s = await scenario({ member: true, errorCode: 'M_ACCOUNT_PROFILE_REQUIRED' }); await open(s); await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled);
    await s.page.locator('#claimConfirm').click(); await s.page.waitForSelector('#claimSetup:not([hidden])');
    check('missing M profile offers the existing profile setup without consuming invitation', await tokenSaved(s) === INVITE && await s.page.locator('#claimSetup a').getAttribute('href') === 'mccluster-creator-studio.html');
    s.state.errorCode = null; await s.page.locator('#claimConfirm').click(); await s.page.waitForSelector('#claimDone:not([hidden])'); check('completed account setup can retry with the same invitation', s.state.claims.length === 2); await close(s);
  }
  {
    const s = await scenario({ expired: true }); await open(s);
    check('expired invitation stops before sign-in or claim', (await s.page.locator('#claimStatus').innerText()).includes('expired') && s.state.claims.length === 0 && await s.page.locator('#claimAccount').isHidden());
    await fit(s, 'expired invitation fits 390px'); await s.page.screenshot({ path: join(OUT, 'expired-390.png') }); noLeaks(s, 'expired invitation stays out of unrelated traffic'); await close(s);
  }
  {
    const s = await scenario({ member: true, malformed: true }); await open(s); await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled);
    await s.page.locator('#claimConfirm').click(); await s.page.getByText('The service did not confirm your profile connection. Please try again.', { exact: true }).waitFor();
    check('a malformed 200 response cannot falsely mark a claim successful', await tokenSaved(s) === INVITE && await s.page.locator('#claimDone').isHidden()); await close(s);
  }
  {
    const s = await scenario(); await open(s); await s.page.waitForSelector('#accountLinks:not([hidden])');
    const popupPromise = s.ctx.waitForEvent('page'); await s.page.getByRole('link', { name: 'Create an account', exact: true }).click(); const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded'); await popup.waitForFunction(() => window.MCC && typeof MCC.signUpWithPassword === 'function');
    check('signup opens the existing account page in its own tab', new URL(popup.url()).pathname === '/account.html' && await tokenSaved(s) === INVITE);
    // Exercise the actual shared signup library against the isolated Auth fixture.
    // Account's existing Places/intake UI is outside this claim-page change.
    const signup = await popup.evaluate(() => MCC.signUpWithPassword('cohort-fixture@example.invalid', 'Fixture Password 123', { name: 'Cohort Fixture' }));
    check('existing signup API establishes the shared account session', signup.session === true && s.state.signups.length === 1);
    await s.page.bringToFront(); await s.page.locator('#claimRefresh').click(); await s.page.waitForFunction(() => !document.getElementById('claimConfirm').disabled);
    check('returning from signup picks up the account while retaining the private invitation', await tokenSaved(s) === INVITE && s.state.claims.length === 0);
    await s.page.locator('#claimConfirm').click(); await s.page.waitForSelector('#claimDone:not([hidden])');
    check('new account return can connect via the same verified claim API', s.state.claims.length === 1); noLeaks(s, 'signup tab and its telemetry never receive the invitation'); await close(s);
  }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  for (const ctx of active) await ctx.close();
  await browser.close(); server.close();
}
console.log(JSON.stringify(results, null, 2));
assert.equal(results.filter(result => !result.ok).length, 0);
