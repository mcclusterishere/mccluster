/* THE DOOR'S FLOWS (owner, 2026-11-18: "the sign-in page just looks like shit ... This is royalty shit over here";
   docs/design/WORLD-SIGN-IN-DOOR.md). The redesign changes presentation only: every flow must keep calling the same auth
   functions with the same arguments. This suite walks them on the page as it ships, with the auth client wrapped so each call
   and its arguments are recorded (the provider hand-off is stubbed so the page never leaves for the provider), and the
   network faked so each request body is recorded too:
   - the why row and the way back, opened from the World (a members-only tap: People);
   - sign in refused (invalid_credentials: the door's own line), then a field error on Create account (the passwords differ:
     nothing is sent, the field is marked);
   - create an account with the privacy agreement ticked (the first visit's banner, so the box is asked), the sealed
     "Check your email" note, Resend held, then Resend verification;
   - the Google button, when the live settings switch Google on: the provider hand-off with the return address;
   - Forgot password: the hand-off to forgot-password.html with the email;
   - sign in: the door gives way to the member's World and leaves no history entry behind.
   At 390x844, 820x1180 and 1280x800, by night and by day: scrollWidth === clientWidth, no page errors, the focus order through
   the door, and the contrast of the key texts measured from pixels.
     CESIUM_DIR=/path/to/Build/Cesium node scripts/e2e/sign-in.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). results.json and a screenshot per state land in outDir. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadChromium, startServer, openWorld, worldReady, doorFrame, contrast, settle, DEVICES, LAUNCH, SB } from './support/world-gate-harness.mjs';

const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'sign-in');
await mkdir(OUT, { recursive: true });
const chromium = loadChromium();
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, ...LAUNCH });
const results = [];
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, ...(ok || detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 700)}`);
}
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const calls = (page) => page.evaluate(() => (window.__authCalls || []).slice());
/* These predicates inspect DOM state, not a painted frame. Software-rendered Cesium can delay animation frames while
   the door closes, so poll independently of requestAnimationFrame without extending either deadline. A passive probe
   distinguishes a missing click, an unstarted close and an unfinished hide if the state still fails to arrive. */
async function doorProbe(page) {
  await page.evaluate(() => {
    if (window.__signInDoorProbe) return;
    const state = () => {
      const d = document.getElementById('mnSignedOut');
      return { at: Math.round(performance.now()), hidden: d ? d.hidden : null, leaving: !!d && d.classList.contains('is-leaving'),
        gateOpen: window.MCC_GATE ? window.MCC_GATE.isOpen() : null, historyDoor: !!(history.state && history.state.mccDoor),
        focus: document.activeElement && document.activeElement.id };
    };
    const probe = window.__signInDoorProbe = { clicks: [], state };
    document.addEventListener('click', (e) => {
      if (!e.target?.closest?.('#mnSignedOutBack')) return;
      const click = { before: state() };
      probe.clicks.push(click);
      setTimeout(() => { click.afterDispatch = state(); }, 0);
      setTimeout(() => { click.after400ms = state(); }, 400);
    }, { capture: true, passive: true });
  });
}
async function waitDoor(page, expected) {
  await doorProbe(page);
  try {
    await page.waitForFunction((expected) => {
      const d = document.getElementById('mnSignedOut');
      return !!d && (expected === 'closed' ? d.hidden : !d.hidden && !d.classList.contains('is-leaving'));
    }, expected, { timeout: expected === 'closed' ? 5000 : 10000, polling: 100 });
  } catch (error) {
    const detail = await page.evaluate(() => {
      const p = window.__signInDoorProbe;
      return p ? { current: p.state(), clicks: p.clicks.slice(-2) } : { probe: 'unavailable' };
    }).catch((e) => ({ diagnosticsError: e.message }));
    console.error('DOOR STATE TIMEOUT ' + expected + ': ' + JSON.stringify(detail));
    throw error;
  }
}
const opened = (page) => waitDoor(page, 'opened');
const closed = (page) => waitDoor(page, 'closed');
/* who has the focus, as a reader would name it */
const focusName = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'body';
  return (a.id ? '#' + a.id : a.getAttribute('data-reveal') ? 'show:' + a.getAttribute('data-reveal') : a.closest('.wg-foot') ? 'foot:' + a.textContent.trim() : a.closest('#wgCredit') ? 'credit:' + a.textContent.trim() : a.closest('#wgPulse') ? 'pulse:' + a.textContent.trim().slice(0, 24) : a.tagName.toLowerCase());
});
async function tabWalk(page, n, back = false) {
  const seen = [];
  for (let k = 0; k < n; k++) { await page.keyboard.press(back ? 'Shift+Tab' : 'Tab'); seen.push(await focusName(page)); }
  return seen;
}
/* the key texts and their measured contrast */
async function keyContrast(page, scope) {
  const c = await contrast(page);
  const keys = /Turn what|into action|The place for doers|Sign in|Create account|Welcome back|New here|Email|Password|Forgot|Sign in to find people|McCluster Corp|Back|Check your email|match an account|do not match/;
  const key = c.items.filter((i) => keys.test(i.text));
  check(scope, 'the key texts read at 4.5:1 or better (3:1 for large type), measured from pixels', key.length >= 8 && c.failures.length === 0, { failures: c.failures.slice(0, 6), measured: key.length });
  /* the glyph mask came off just now: every button's colour eases back over 220 ms (css/style.css), so the next screenshot waits it out */
  await settle(page);
  return c;
}
/* THE RESEND HOLD, AS IT BEGINS. Read after the awaits of a busy runner, the label says only how far the countdown has got
   (a slow runner read "Try again in 53s"). So the page records the label the Resend button shows the moment it is held, and
   when; the check reads the hold from that first label, and asks the label read later to be still held and to count down no
   faster than the clock. Added to the page before it loads (openWorld's beforeNavigate); the globe's frame is left alone. */
function recordResendHold() {
  if (window !== window.top) return;
  const watch = () => {
    const b = document.getElementById('mnResend');
    if (!b || window.__resendHold) return;
    const hold = window.__resendHold = { first: null, firstAt: null };
    const look = () => { if (hold.first === null && !b.hidden && b.disabled) { hold.first = b.textContent; hold.firstAt = performance.now(); } };
    new MutationObserver(look).observe(b, { attributes: true, attributeFilter: ['hidden', 'disabled'], childList: true, characterData: true, subtree: true });
    look();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
}

try {
  for (const w of [390, 820, 1280]) for (const phase of ['night', 'day']) {
    const device = DEVICES[w], scope = `${w}-${phase}`;
    if (process.env.SIGNIN_ONLY && !process.env.SIGNIN_ONLY.split(',').includes(scope)) continue;
    /* ---------- 1. opened from the World: the why row, the focus order, the way back ---------- */
    {
      const { ctx, page, world } = await openWorld(browser, server.base, device, '/mnet.html?view=feed', { phase, recordAuth: true });
      try {
        await worldReady(page);
        await page.waitForTimeout(600);
        /* the feed scrolled, then People tapped with the keyboard (a pointer click would scroll the strip into view first) */
        await page.evaluate(() => { const f = document.getElementById('mnWorldFeed'); if (f) f.scrollTop = 120; document.querySelector('#mnFeedScope [data-mn-view="discover"]').focus({ preventScroll: true }); });
        await page.waitForTimeout(300);
        const feed = await page.evaluate(() => (document.getElementById('mnWorldFeed') || {}).scrollTop || 0);
        await page.keyboard.press('Enter');
        await opened(page);
        await page.waitForTimeout(500);
        const why = await page.evaluate(() => ({ row: !document.getElementById('mnGuestWhyRow').hidden, text: document.getElementById('mnGuestWhy').textContent, back: !document.getElementById('mnSignedOutBack').hidden, mode: document.getElementById('mnSignedOut').getAttribute('data-auth-mode'), focus: document.activeElement && document.activeElement.id }));
        /* the focus: the first field where a keyboard is at hand; on a touch screen the door itself, so no keyboard rises over
           the sheet before a field is tapped (review DR-m11) */
        const firstFocus = device.mobile ? 'mnSignedOut' : 'mnEmail';
        check(scope, `a members-only tap opens the door in sign-in mode with its reason and the way back, the focus on ${firstFocus === 'mnEmail' ? 'the email' : 'the door'}`, why.row && why.text === 'Sign in to find people.' && why.back && why.mode === 'signin' && why.focus === firstFocus, why);
        await page.focus('#mnEmail');
        const fwd = await tabWalk(page, 6);
        check(scope, 'focus order forward from the email: password, Show, Forgot, the action, the footer', JSON.stringify(fwd) === JSON.stringify(['#mnPassword', 'show:mnPassword', '#mnForgot', '#mnAuthGo', 'foot:Privacy Policy', 'foot:Manage your M Account']), fwd);
        await page.focus('#mnEmail');
        const back = await tabWalk(page, 2, true);
        check(scope, 'focus order backward from the email: the selected door, then the stage', back[0] === '#mnSignInTab' && /^(credit:|pulse:|#mnSignedOutBack)/.test(back[1]), back);
        await page.focus('#mnEmail');
        let size = await fits(page);
        check(scope, 'nothing scrolls sideways with the door open', size.sw === size.cw, size);
        await keyContrast(page, scope + ' why');
        await page.screenshot({ path: join(OUT, `why-${scope}.png`), timeout: 90000 });
        await page.fill('#mnEmail', 'kept@example.invalid');
        await page.click('#mnSignedOutBack');
        await closed(page);
        const after = await page.evaluate(() => ({ scroll: (document.getElementById('mnWorldFeed') || {}).scrollTop || 0, focus: document.activeElement && (document.activeElement.getAttribute('data-mn-view') || document.activeElement.id), email: document.getElementById('mnEmail').value, door: history.state && history.state.mccDoor }));
        check(scope, 'Back to the World closes the door onto the World as it was: the feed\'s place, the focus on the tap that asked, the email kept', after.scroll === feed && after.focus === 'discover' && after.email === 'kept@example.invalid' && !after.door, { after, feed });
        check(scope, 'no auth call while only opening and closing the door', (await calls(page)).length === 0, await calls(page));
        check(scope, 'no page errors', world.errors.length === 0, world.errors);
      } finally { await ctx.close(); }
    }
    /* ---------- 2. sign in refused, a field error, the Google button, Forgot ---------- */
    {
      const { ctx, page, world, opts } = await openWorld(browser, server.base, device, '/mnet.html?view=feed', { phase, recordAuth: true, token: 'invalid', settings: { external: { email: true, google: true } } });
      try {
        await worldReady(page);
        await page.click('[data-guest-open="signin"]');
        await opened(page);
        await page.fill('#mnEmail', ' Member@Example.invalid ');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => /match an account/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 }).catch(() => {});
        const refused = await page.evaluate(() => ({ status: document.getElementById('mnAuthStatus').textContent, error: document.getElementById('mnAuthStatus').classList.contains('is-error'), go: document.getElementById('mnAuthGo').textContent, busy: document.getElementById('mnAuthGo').getAttribute('aria-busy'), type: document.getElementById('mnPassword').type }));
        const c1 = await calls(page);
        const token = world.auth.filter((a) => a.p === '/auth/v1/token');
        check(scope, 'Sign in calls signInWithPassword(email as typed and trimmed, password) once', c1.length === 1 && c1[0].name === 'signInWithPassword' && c1[0].args[0] === 'Member@Example.invalid' && c1[0].args[1] === 'fixture-password-1', c1);
        check(scope, 'and sends one POST to the token endpoint with the lower-cased email, the password and the apikey', token.length === 1 && token[0].m === 'POST' && token[0].q === '?grant_type=password' && token[0].apikey && JSON.stringify(token[0].body) === JSON.stringify({ email: 'member@example.invalid', password: 'fixture-password-1' }), token);
        const forgotWords = await page.textContent('#mnForgot');
        check(scope, 'invalid_credentials reads as the door\'s own line, naming the Forgot control by its own words, beside the action, and the action comes back', refused.status === `That email and password don’t match an account. Check them, or use “${forgotWords}” above.` && forgotWords === "Forgot or don't know your password?" && refused.error && refused.go === 'Sign in' && refused.busy === null && refused.type === 'password', { refused, forgotWords });
        await keyContrast(page, scope + ' refused');
        await page.screenshot({ path: join(OUT, `refused-${scope}.png`), timeout: 90000 });
        /* a field error on Create account: the passwords differ, nothing is sent */
        await page.click('#mnCreateTab');
        await page.fill('#mnEmail', 'new.member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.fill('#mnPassword2', 'fixture-password-2');
        await page.click('#mnAuthGo');
        const mismatch = await page.evaluate(() => ({ status: document.getElementById('mnAuthStatus').textContent, invalid: document.getElementById('mnPassword2').getAttribute('aria-invalid'), focus: document.activeElement && document.activeElement.id, ring: getComputedStyle(document.getElementById('mnPassword2').closest('.wg-field')).boxShadow }));
        check(scope, 'a field error: the reason over the action, the confirm field marked and focused, nothing sent', mismatch.status === 'Those passwords do not match.' && mismatch.invalid === 'true' && mismatch.focus === 'mnPassword2' && (await calls(page)).length === 1, mismatch);
        await page.screenshot({ path: join(OUT, `field-error-${scope}.png`), timeout: 90000 });
        /* the Google button, from the live settings (create mode: the return carries join=1) */
        await page.waitForSelector('#mnProviders:not([hidden]) .mn__provider', { timeout: 10000 });
        const label = await page.textContent('#mnProviderButtons .mn__provider');
        await page.click('#mnProviderButtons .mn__provider');
        await page.waitForFunction(() => (window.__authCalls || []).some((c) => c.name === 'signInWithProvider'), null, { timeout: 5000 }).catch(() => {});
        const prov = (await calls(page)).filter((c) => c.name === 'signInWithProvider');
        const expectNext = await page.evaluate(() => { const b = new URL(location.href); b.searchParams.set('join', '1'); return location.origin + '/auth/?next=' + encodeURIComponent(b.pathname + b.search + b.hash); });
        check(scope, 'the Google button shows only because the settings switch it on, and hands off with the same return as before', label === 'Continue with Google' && prov.length === 1 && prov[0].args[0] === 'google' && prov[0].args[1] === expectNext, { label, prov, expectNext });
        /* Forgot: back to Sign in, the email carried to forgot-password.html */
        await page.click('#mnSignInTab');
        await page.fill('#mnEmail', 'member@example.invalid');
        await Promise.all([page.waitForURL(/forgot-password\.html/, { timeout: 30000, waitUntil: 'commit' }), page.click('#mnForgot')]);
        const forgot = new URL(page.url());
        check(scope, 'Forgot hands off to forgot-password.html with the email', forgot.pathname === '/forgot-password.html' && forgot.searchParams.get('email') === 'member@example.invalid', page.url());
        check(scope, 'no page errors', world.errors.length === 0, world.errors);
        void opts;
      } finally { await ctx.close(); }
    }
    /* ---------- 3. create an account with the privacy agreement, the sealed note, Resend ---------- */
    {
      const { ctx, page, world } = await openWorld(browser, server.base, device, '/mnet.html?view=feed', { phase, recordAuth: true, banner: true, signup: 'confirm', beforeNavigate: (fresh) => fresh.page.addInitScript(recordResendHold) });
      try {
        await worldReady(page);
        await page.click('[data-guest-open="create"]');
        await opened(page);
        const box = await page.evaluate(() => ({ agree: !document.getElementById('mnCreateAgree').hidden, line: !document.getElementById('mnCreatePrivacy').hidden, banner: !!document.getElementById('mccPrivacyNotice') }));
        check(scope, 'a first visit (the privacy banner, nothing agreed yet) is asked to tick the box', box.agree && !box.line && box.banner, box);
        await page.fill('#mnEmail', 'new.member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.fill('#mnPassword2', 'fixture-password-1');
        const rules = await page.evaluate(() => ({ met: document.getElementById('mnPasswordHint').getAttribute('data-met'), match: document.getElementById('mnPassword2').closest('.wg-field').getAttribute('data-match'), said: document.getElementById('wgMatch').textContent }));
        check(scope, 'the live rules: eight characters met, both passwords match, said once', rules.met === 'true' && rules.match === 'true' && rules.said === 'Both passwords match.', rules);
        await page.click('#mnAuthGo');
        const unticked = await page.evaluate(() => ({ status: document.getElementById('mnAuthStatus').textContent, invalid: document.getElementById('mnCreateAgreeBox').getAttribute('aria-invalid') }));
        check(scope, 'without the tick nothing is sent and the box is marked', /Tick the box/.test(unticked.status) && unticked.invalid === 'true' && (await calls(page)).length === 0, unticked);
        await page.screenshot({ path: join(OUT, `privacy-error-${scope}.png`), timeout: 90000 });
        await page.click('#mnCreateAgreeBox');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => /Check your email/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 }).catch(() => {});
        const made = await calls(page), signup = world.auth.filter((a) => a.p === '/auth/v1/signup');
        const ack = made[0] && made[0].args[2];
        check(scope, 'Create account calls signUpWithPassword(email, password, the privacy acknowledgement) once', made.length === 1 && made[0].name === 'signUpWithPassword' && made[0].args[0] === 'new.member@example.invalid' && made[0].args[1] === 'fixture-password-1' && ack && ack.privacy_policy_version && ack.privacy_acknowledged_at, made);
        check(scope, 'and one POST to signup with email, password and the acknowledgement, and no redirect', signup.length === 1 && signup[0].body && signup[0].body.email === 'new.member@example.invalid' && signup[0].body.password === 'fixture-password-1' && signup[0].body.data && signup[0].body.data.privacy_policy_version === ack.privacy_policy_version && !/redirect/.test(signup[0].q) && !('redirect_to' in signup[0].body), signup);
        const note = await page.evaluate(() => { const s = document.getElementById('mnAuthStatus'), r = document.getElementById('mnResend'), p = document.getElementById('mnAuthPanel'); const kids = [...p.children].filter((k) => !k.hidden && k.getClientRects().length).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((k) => k.id || k.className.split(' ')[0]);
          const hold = window.__resendHold || {};
          return { ok: s.classList.contains('is-ok'), text: s.textContent, resend: !r.hidden, held: r.disabled, label: r.textContent, first: hold.first === undefined ? null : hold.first, sinceFirst: hold.firstAt == null ? null : Math.round(performance.now() - hold.firstAt), mode: document.getElementById('mnSignedOut').getAttribute('data-auth-mode'), order: kids.slice(0, 3) }; });
        /* held for 60 s: the first label the held button showed was "Try again in 60s"; read now, it is still held and counts
           down from there no faster than the clock (one tick of slack), however long this runner took to read it */
        const left = /^Try again in (\d+)s$/.exec(note.label), shown = left ? Number(left[1]) : NaN;
        const held60 = note.first === 'Try again in 60s' && note.held && shown >= 1 && shown <= 60 && note.sinceFirst !== null && shown >= 60 - Math.floor(note.sinceFirst / 1000) - 1;
        check(scope, 'the sealed note: Check your email, Resend held for 60 s, both leading the panel, back on Sign in', note.ok && /^Check your email/.test(note.text) && note.resend && held60 && note.mode === 'signin' && note.order[0] === 'mnAuthStatus' && note.order[1] === 'mnResend', note);
        let size = await fits(page);
        check(scope, 'nothing scrolls sideways in the emailed state', size.sw === size.cw, size);
        await keyContrast(page, scope + ' emailed');
        await page.screenshot({ path: join(OUT, `emailed-${scope}.png`), timeout: 90000 });
        /* the 60 s hold is real (above); the test lets it go rather than wait it out */
        await page.evaluate(() => { document.getElementById('mnResend').disabled = false; });
        await page.click('#mnResend');
        await page.waitForFunction(() => /Verification email sent/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 }).catch(() => {});
        const resent = (await calls(page)).filter((c) => c.name === 'resendSignupVerification'), resend = world.auth.filter((a) => a.p === '/auth/v1/resend');
        check(scope, 'Resend calls resendSignupVerification(email) once: one POST {type: signup, email}, then held again', resent.length === 1 && resent[0].args[0] === 'new.member@example.invalid' && resend.length === 1 && JSON.stringify(resend[0].body) === JSON.stringify({ type: 'signup', email: 'new.member@example.invalid' }) && await page.evaluate(() => document.getElementById('mnResend').disabled), { resent, resend });
        check(scope, 'no page errors', world.errors.length === 0, world.errors);
      } finally { await ctx.close(); }
    }
    /* ---------- 4. sign in: the door gives way to the member's World ---------- */
    {
      const { ctx, page, world } = await openWorld(browser, server.base, device, '/mnet.html?view=feed', { phase, recordAuth: true, token: 'ok' });
      try {
        await worldReady(page);
        await page.click('[data-guest-open="signin"]');
        await opened(page);
        await page.click('#mnSignInTab');
        await page.fill('#mnEmail', 'member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.press('#mnPassword', 'Enter');
        const t0 = Date.now();
        await page.waitForFunction(() => document.getElementById('mnSignedOut').hidden, null, { timeout: 15000 }).catch(() => {});
        const landed = await page.evaluate(() => ({ door: !document.getElementById('mnSignedOut').hidden, app: !document.getElementById('mnApp').hidden, guest: document.documentElement.classList.contains('mn-guest'), hist: history.state && history.state.mccDoor, session: !!localStorage.getItem('mccdb_session') }));
        const c = await calls(page), boot = world.requests.filter((r) => r.p === '/v1/mnet/bootstrap');
        check(scope, 'Enter in the password signs in with the same call, then bootstrap, then the member\'s World with no door and no history entry', c.length === 1 && c[0].name === 'signInWithPassword' && boot.length >= 1 && !landed.door && landed.app && !landed.guest && !landed.hist && landed.session, { landed, calls: c, ms: Date.now() - t0 });
        await page.evaluate(() => history.back());
        await page.waitForTimeout(600);
        check(scope, 'a later Back does not bring the door back', await page.evaluate(() => document.getElementById('mnSignedOut').hidden));
        check(scope, 'no page errors', world.errors.length === 0, world.errors);
        void SB;
      } finally { await ctx.close(); }
    }
  }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
