/* THE MODULE KNOWS WHO IS LISTENING, IN A REAL BROWSER (music slice M4, 2026-11-19).
   ============================================================
   Owner, 2026-11-19: "it's not aware of whether a person has an account or
   not." The accounts lane (the music map, lane 04) proved it in Chromium with
   five probes; this suite is those probes as repository tests. Every page is
   the real one, served from this checkout under Matthew McCluster's real
   origin; the auth server, PostgREST, the music Edge function and the API
   Worker are the stand-ins in scripts/e2e/support/music-accounts-plane.mjs;
   every other request is aborted. Nothing reaches a live host.

     persona   who is looking, on Listen, the album's gated record, an
               artist's page and Creator Studio: a guest, a member, a
               creator, the house owner, and each back after the token's hour
               (a stored token that expired two hours ago, a good refresh
               token, the refresh answered after 1.5 s)
     race      the owner's gated row and the artist's own tools with the
               refresh answered after 0, 300 and 1500 ms
     expiry    a Creator Studio save after the token it opened with expired
     crosstab  X1-X5: a sign-in or sign-out in another tab; D1a-c: the
               Creator Website Studio and the site's one session
     T7        an account-only creator track for a member back after the hour

   At 390 px every page is measured: scrollWidth must equal clientWidth.

     node scripts/e2e/music-accounts.e2e.mjs [outDir]
   outDir (default: the system's temporary folder) receives result.json, every check and its outcome.
   M4_ONLY=<regex> runs the scenarios whose name matches. M4_SHOTS=<dir>
   writes the owner's screenshots there at device scale 2.
   ============================================================ */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePlane, HOUSE, PEOPLE, SBKEY } from './support/music-accounts-plane.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const OUT = process.argv[2] || join(tmpdir(), 'music-accounts-e2e');
const ONLY = process.env.M4_ONLY ? new RegExp(process.env.M4_ONLY) : null;
const SHOTS = process.env.M4_SHOTS || '';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const failures = [];
const checks = [];
const check = (ok, what) => { checks.push({ ok: !!ok, what }); if (!ok) failures.push(what); console.log((ok ? 'ok   ' : 'FAIL ') + what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function context(browser, plane, width = 390) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await plane.install(ctx, ROOT);
  return ctx;
}
/* a fresh profile on Matthew's origin: the privacy notice answered "Not now", then whatever the case stores */
async function seed(page, items) {
  await page.goto(HOUSE + '/__blank');
  await page.evaluate((it) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('mcc_privacy_seen', JSON.stringify({ version: '2026-10-19', seen_at: new Date().toISOString() }));
    for (const k of Object.keys(it)) localStorage.setItem(k, it[k]);
  }, items || {});
}
const slots = (s) => { const v = JSON.stringify(s); return { mccdb_session: v, mcc_sess_keep: v }; };
const until = (page, fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);
const fits = async (page, label) => {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  check(m.s === m.c && m.c === 390, `${label}: at 390 px scrollWidth ${m.s} === clientWidth ${m.c}`);
};
async function ownerShot(page, name, focus = '.music-launch') {
  if (!SHOTS) return;
  const vp = page.viewportSize();
  const ctx = page.context();
  /* the owner's copies at device scale 2: a second page of the same profile, same storage */
  const big = await ctx.browser().newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600, deviceScaleFactor: 2, serviceWorkers: 'block', storageState: await ctx.storageState() });
  await planeFor.get(ctx).install(big, ROOT);
  const p = await big.newPage();
  await p.goto(page.url(), { waitUntil: 'load' });
  await sleep(4000);
  const offer = await p.$(focus);
  if (offer) await offer.scrollIntoViewIfNeeded().catch(() => {});
  await p.screenshot({ path: join(SHOTS, name + '.png'), fullPage: false });
  await big.close();
}
const planeFor = new WeakMap();

/* What the launch block on Listen offers, read from what a person can see. */
const OFFER = () => {
  const box = document.querySelector('.music-launch');
  if (!box) return null;
  const vis = (e) => { if (!e || e.closest('[hidden]')) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const links = Array.from(box.querySelectorAll('a')).filter(vis).map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') || '' }));
  return {
    door: links.some((l) => l.text === 'Become a creator'),
    studio: links.some((l) => /^Open Creator Studio$/.test(l.text)),
    signin: links.some((l) => l.text === 'Sign in' && /^account\.html/.test(l.href)),
    review: links.some((l) => /control\.html#sell:music:catalog/.test(l.href)),
    links
  };
};

const SCENARIOS = {
  /* The global account chip and the local Studio door must both be usable.
     Overflow checks alone miss a fixed chip covering an otherwise fitting link. */
  async music_contextbar(browser) {
    const plane = makePlane();
    for (const width of [320, 390, 1280]) {
      for (const path of ['/listen.html', '/music-creator.html?handle=fixture-artist']) {
        const ctx = await context(browser, plane, width);
        const page = await ctx.newPage();
        await seed(page, {});
        await page.goto(HOUSE + path, { waitUntil: 'load' });
        await until(page, () => !!document.getElementById('mccAuthChip'), null);
        const layout = await page.evaluate(() => {
          const studio = document.querySelector('.music-contextbar__nav a[href="creator.html"]');
          const chip = document.getElementById('mccAuthChip');
          if (!studio || !chip) return null;
          const a = studio.getBoundingClientRect(), b = chip.getBoundingClientRect();
          const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
          return {
            overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
            reachable: hit === studio || studio.contains(hit), height: a.height,
            scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth
          };
        });
        const tag = `music header ${path} ${width}`;
        check(!!layout && !layout.overlap, `${tag}: Creator Studio is clear of the account chip`);
        check(!!layout && layout.reachable && layout.height >= 44, `${tag}: Creator Studio has a reachable 44px target`);
        check(!!layout && layout.scrollWidth === layout.clientWidth, `${tag}: no horizontal overflow`);
        if (SHOTS && width === 390) {
          await page.screenshot({ path: join(SHOTS, path.startsWith('/listen') ? 'listen-header-390.png' : 'artist-header-390.png') });
        }
        await ctx.close();
      }
    }
  },

  async catalogue_roles(browser) {
    const ctx = await context(browser, makePlane(), 390);
    try {
      const page = await ctx.newPage();
      await seed(page, {});
      await page.goto(HOUSE + '/listen.html');
      const artist = (slug) => page.locator('#artistsRow a[href="artist.html?artist=' + slug + '"]');
      const producer = (slug) => page.locator('#producersRow a[href="artist.html?artist=' + slug + '#produced"]');
      await producer('pax').waitFor();
      check(await artist('pax').isVisible() && await producer('pax').isVisible(), 'Pax Tha Collector is selectable as both artist and producer');
      check(await producer('zakir-elhajoui').locator('.artist__credit-badge').count() === 1, 'Zakir has a release credit badge on the producer card');
      check(await producer('tazzy-jay').locator('.artist__credit-badge').count() === 0, 'Trackout production alone earns no Equity Uprise badge');
      await fits(page, 'Artist and producer selection');
      await artist('equity-uprise').click();
      const members = page.getByRole('region', { name: 'Members', exact: true });
      await members.waitFor();
      check(await members.getByRole('link').count() === 6, 'the group links its six individual artists');
      check(await page.locator('#artistCreditBadge').isVisible(), 'the group profile displays its release badge');
      await fits(page, 'Group profile');
      await members.getByRole('link', { name: 'Pax Tha Collector' }).click();
      const group = page.getByRole('region', { name: 'Groups', exact: true }).getByRole('link', { name: 'Equity Uprise' });
      await group.waitFor();
      const profileUrl = new URL(page.url());
      check(profileUrl.pathname.endsWith('/artist.html') && profileUrl.searchParams.get('artist') === 'pax' &&
        await page.locator('#artistName').textContent() === 'Pax Tha Collector', 'a group member opens their artist profile');
      await fits(page, 'Member profile');
      await group.click();
      await members.waitFor();
      await page.goto(HOUSE + '/listen.html');
      await producer('zakir-elhajoui').click();
      const produced = page.locator('#produced');
      await produced.waitFor();
      check(new URL(page.url()).hash === '#produced' && await produced.locator('button[data-music-play]').count() === 21,
        'the producer bubble opens all 21 of Zakir’s playable productions');
      check(await page.locator('#artistCreditBadge').isVisible() && await page.getByRole('region', { name: 'Groups', exact: true }).count() === 0,
        'Zakir has the release badge on his profile and no group membership');
      await fits(page, 'Producer profile');
    } finally {
      await ctx.close();
    }
  },

  /* ---------- persona: Listen's offer (ACC-4) ---------- */
  async persona_listen(browser) {
    const plane = makePlane({ refreshDelayMs: 1500 });
    const want = {
      guest: { signin: true, door: false, studio: false, review: false },
      member: { signin: false, door: true, studio: false, review: false },
      creator: { signin: false, door: false, studio: true, review: false },
      owner: { signin: false, door: false, studio: true, review: true },
      member_expired: { signin: false, door: true, studio: false, review: false },
      creator_expired: { signin: false, door: false, studio: true, review: false },
      owner_expired: { signin: false, door: false, studio: true, review: true }
    };
    for (const [persona, w] of Object.entries(want)) {
      for (const width of persona.endsWith('_expired') ? [390] : [390, 1280]) {
        const ctx = await context(browser, plane, width);
        planeFor.set(ctx, plane);
        const page = await ctx.newPage();
        const who = persona.replace(/_expired$/, '');
        await seed(page, persona === 'guest' ? {} : slots(plane.storedSession(who, persona.endsWith('_expired') ? -7200 : 3600)));
        await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
        /* settled: what this person should see is on screen, or 10 s passed */
        await until(page, (x) => {
          const box = document.querySelector('.music-launch'); if (!box) return false;
          const vis = (e) => e && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0;
          const a = Array.from(box.querySelectorAll('a')).filter(vis);
          const has = (re) => a.some((l) => re.test(l.textContent.trim()));
          return has(/^Sign in$/) === x.signin && has(/^Become a creator$/) === x.door && has(/^Open Creator Studio$/) === x.studio &&
            a.some((l) => /control\.html#sell:music:catalog/.test(l.getAttribute('href') || '')) === x.review;
        }, w, 10000);
        const got = await page.evaluate(OFFER);
        const tag = `persona listen ${persona} ${width}`;
        check(!!got && got.signin === w.signin, `${tag}: ${w.signin ? 'asked to sign in' : 'not asked to sign in'} (${JSON.stringify(got && got.links)})`);
        check(!!got && got.door === w.door, `${tag}: Become a creator ${w.door ? 'offered' : 'not offered'}`);
        check(!!got && got.studio === w.studio, `${tag}: Open Creator Studio ${w.studio ? 'offered' : 'not offered'}`);
        check(!!got && got.review === w.review, `${tag}: the owner's review desk ${w.review ? 'shown' : 'not shown'}`);
        if (width === 390) await fits(page, tag);
        if (width === 390 && !persona.endsWith('_expired')) await ownerShot(page, `listen-offer-${persona}-390`);
        await ctx.close();
      }
    }
  },

  /* ---------- persona: the album's gated record, back after the hour (ACC-2) ---------- */
  async persona_album_expired(browser) {
    const plane = makePlane({ refreshDelayMs: 1500 });
    for (const who of ['owner', 'member']) {
      const ctx = await context(browser, plane);
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession(who, -7200)));
      const t0 = Date.now();
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      const target = who === 'owner' ? 'earned' : 'locked';
      await until(page, (g) => Array.from(document.querySelectorAll('[data-gated-bucket]')).some((r) => r.getAttribute('data-gate') === g), target, 12000);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-gated-bucket]')).map((r) => ({ gate: r.getAttribute('data-gate'), chip: ((r.querySelector('[data-reclock]') || {}).textContent || '').replace(/\s+/g, ' ').trim() })));
      const gates = plane.log.filter((x) => x.t >= t0 && /\/v1\/music\/gates\/niggy-nigg$/.test(x.path)).map((x) => x.auth);
      const tag = `persona album ${who}_expired`;
      if (who === 'owner') check(rows.length > 0 && rows.every((r) => r.gate === 'earned' && /PLAY/.test(r.chip) && /owner/.test(r.chip)), `${tag}: the owner's row says PLAY · owner (${JSON.stringify(rows)})`);
      else check(rows.length > 0 && rows.every((r) => r.gate === 'locked'), `${tag}: the member is answered as this member, not as a guest (${JSON.stringify(rows)})`);
      check(gates.length > 0 && gates.every((a) => a === 'fresh:' + who), `${tag}: the gate was asked with a renewed token (${gates.join(', ')})`);
      await fits(page, tag);
      await ctx.close();
    }
  },

  /* ---------- persona: the artist's own tools and Creator Studio, back after the hour (ACC-5, ACC-3) ---------- */
  async persona_artist_and_studio_expired(browser) {
    const plane = makePlane({ refreshDelayMs: 1500 });
    {
      const ctx = await context(browser, plane);
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession('creator', -7200)));
      const t0 = Date.now();
      await page.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
      const shown = await until(page, () => !!document.getElementById('apOwnerEdit'), null, 12000);
      const asks = plane.log.filter((x) => x.t >= t0 && /current_m_uid$/.test(x.path)).map((x) => x.auth);
      check(shown, 'persona artist page creator_expired: Edit my artist page is shown to the artist');
      check(asks.length > 0 && asks.every((a) => a === 'fresh:creator'), `persona artist page creator_expired: asked with a renewed token (${asks.join(', ')})`);
      await fits(page, 'persona artist page creator_expired');
      planeFor.set(ctx, plane);
      await ownerShot(page, 'artist-page-own-tools-390', '#apDoors');
      await ctx.close();
    }
    {
      const ctx = await context(browser, plane);
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession('creator', -7200)));
      await page.goto(HOUSE + '/creator.html', { waitUntil: 'load' });
      const app = await until(page, () => !document.getElementById('creatorApp').hidden, null, 12000);
      check(app, 'persona Creator Studio creator_expired: the studio opens');
      await fits(page, 'persona Creator Studio creator_expired');
      await ctx.close();
    }
  },

  /* ---------- race: the refresh answered after 0, 300 and 1500 ms (ACC-2, ACC-5) ---------- */
  async race(browser) {
    for (const delay of [0, 300, 1500]) {
      const plane = makePlane({ refreshDelayMs: delay });
      {
        const ctx = await context(browser, plane);
        const page = await ctx.newPage();
        await seed(page, slots(plane.storedSession('owner', -7200)));
        await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
        const ok = await until(page, () => { const r = Array.from(document.querySelectorAll('[data-gated-bucket]')); return r.length > 0 && r.every((x) => x.getAttribute('data-gate') === 'earned'); }, null, 9000);
        check(ok, `race ${delay} ms: the owner's gated row says PLAY · owner`);
        await ctx.close();
      }
      {
        const ctx = await context(browser, plane);
        const page = await ctx.newPage();
        await seed(page, slots(plane.storedSession('creator', -7200)));
        await page.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
        const ok = await until(page, () => !!document.getElementById('apOwnerEdit'), null, 9000);
        check(ok, `race ${delay} ms: the artist sees Edit my artist page`);
        await ctx.close();
      }
    }
  },

  /* ---------- expiry: Creator Studio keeps working after its first token expires (ACC-3) ----------
     The lane's probe waited 80 s for a 75-s token. Here the hour passes at once: the auth server
     stops accepting every token issued so far, and the stored session's expiry, on this device's
     clock, is put in the past. That is all an hour changes. */
  async expiry(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const page = await ctx.newPage();
    await seed(page, slots(plane.storedSession('creator', 3600)));
    await page.goto(HOUSE + '/creator.html?edit=profile', { waitUntil: 'load' });
    await until(page, () => !document.getElementById('creatorIdentity').hidden, null, 12000);
    const save = async () => {
      await page.fill('#creatorHandle', 'fixture-artist');
      await page.fill('#creatorName', 'Fixture Artist');
      await page.check('#creatorTerms');
      const t = Date.now();
      await page.evaluate(() => { document.getElementById('profileStatus').textContent = ''; document.getElementById('profileForm').requestSubmit(); });
      await until(page, () => /saved|fail|expired|could not|error/i.test(document.getElementById('profileStatus').textContent), null, 10000);
      return { status: await page.textContent('#profileStatus'), net: plane.log.filter((x) => x.t >= t && /music_creator_profiles/.test(x.path) && x.method === 'PATCH').map((x) => x.auth) };
    };
    const first = await save();
    check(/Creator profile saved/.test(first.status), `expiry: a save with the opening token works (${first.status})`);
    plane.expireAll('creator');
    await page.evaluate(() => {
      for (const k of ['mccdb_session', 'mcc_sess_keep']) {
        const s = JSON.parse(localStorage.getItem(k) || 'null');
        if (s) { s.expires_at = Math.floor(Date.now() / 1000) - 5; localStorage.setItem(k, JSON.stringify(s)); }
      }
    });
    const second = await save();
    check(/Creator profile saved/.test(second.status), `expiry: a save after the token expired works, no "JWT expired" (${second.status})`);
    check(second.net.length > 0 && second.net.every((a) => a === 'fresh:creator'), `expiry: the save carried a renewed token (${second.net.join(', ')})`);
    check(await page.evaluate(() => document.body.getAttribute('data-mcc-auth')) === 'in', 'expiry: still signed in');
    await fits(page, 'expiry Creator Studio');
    await ctx.close();
  },

  /* ---------- X1: a sign-out in another tab reaches an open Creator Studio (ACC-1, ACC-8) ---------- */
  async X1_signout_elsewhere_creator_studio(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const a = await ctx.newPage();
    await seed(a, slots(plane.storedSession('creator', 3600)));
    await a.goto(HOUSE + '/creator.html', { waitUntil: 'load' });
    check(await until(a, () => !document.getElementById('creatorApp').hidden, null, 12000), 'X1: Creator Studio open for the creator');
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
    await until(b, () => !!(window.MCC && window.MCC.signOut), null, 8000);
    await b.evaluate(() => window.MCC.signOut());
    const gate = await until(a, () => !document.getElementById('creatorGate').hidden && document.getElementById('creatorApp').hidden, null, 8000);
    check(gate, 'X1: the open studio closes to "Sign in to publish" without a reload');
    await sleep(1500);
    const st = await a.evaluate(() => ({ bar: document.body.getAttribute('data-mcc-auth'), session: !!localStorage.getItem('mccdb_session'), keep: !!localStorage.getItem('mcc_sess_keep') }));
    check(!st.session && !st.keep && st.bar === 'out', `X1: the sign-out stays: no session in storage, the bar says signed out (${JSON.stringify(st)})`);
    await ctx.close();
  },

  /* ---------- X2: a sign-in in another tab reaches an open Creator Studio gate (ACC-1) ---------- */
  async X2_signin_elsewhere_creator_gate(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const a = await ctx.newPage();
    await seed(a, {});
    await a.goto(HOUSE + '/creator.html', { waitUntil: 'load' });
    await sleep(1500);
    check(await a.evaluate(() => !document.getElementById('creatorGate').hidden), 'X2: a guest sees "Sign in to publish"');
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
    await until(b, () => !!(window.MCC && window.MCC.signInWithPassword), null, 8000);
    await b.evaluate((email) => window.MCC.signInWithPassword(email, 'fixture-password'), PEOPLE.creator.label);
    const open = await until(a, () => document.getElementById('creatorGate').hidden && !document.getElementById('creatorApp').hidden, null, 10000);
    check(open, 'X2: the gate gives way to the studio without a reload');
    await fits(a, 'X2 Creator Studio');
    await ctx.close();
  },

  /* ---------- X3: the artist's own tools follow a sign-in and a sign-out elsewhere (ACC-5) ---------- */
  async X3_artist_page_owner_tools(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const a = await ctx.newPage();
    await seed(a, {});
    await a.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
    await sleep(1500);
    check(!(await a.$('#apOwnerEdit')), 'X3: a guest sees no artist tools');
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
    await until(b, () => !!(window.MCC && window.MCC.signInWithPassword), null, 8000);
    await b.evaluate((email) => window.MCC.signInWithPassword(email, 'fixture-password'), PEOPLE.creator.label);
    check(await until(a, () => !!document.getElementById('apOwnerEdit'), null, 10000), 'X3: the artist signs in elsewhere and Edit my artist page appears without a reload');
    await b.evaluate(() => window.MCC.signOut());
    check(await until(a, () => !document.getElementById('apOwnerEdit') && !document.getElementById('apOwnerFront'), null, 10000), 'X3: the artist signs out elsewhere and the tools go');
    await ctx.close();
  },

  /* ---------- X4 (control): the album's gated row repaints on a sign-in elsewhere ---------- */
  async X4_album_gate_signin_elsewhere(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const a = await ctx.newPage();
    await seed(a, {});
    await a.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await until(a, () => Array.from(document.querySelectorAll('[data-gated-bucket]')).some((r) => r.getAttribute('data-gate') === 'preview'), null, 10000);
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
    await until(b, () => !!(window.MCC && window.MCC.signInWithPassword), null, 8000);
    await b.evaluate((email) => window.MCC.signInWithPassword(email, 'fixture-password'), PEOPLE.owner.label);
    check(await until(a, () => { const r = Array.from(document.querySelectorAll('[data-gated-bucket]')); return r.length > 0 && r.every((x) => x.getAttribute('data-gate') === 'earned'); }, null, 10000),
      'X4: the guest row turns into PLAY · owner when the owner signs in elsewhere');
    await ctx.close();
  },

  /* ---------- X5: a sign-out in one tab is not undone by another open music tab (ACC-8) ---------- */
  async X5_signout_stays(browser) {
    for (const pageA of ['/creator.html', '/album.html?album=cia-mind-control', '/listen.html']) {
      const plane = makePlane({});
      const ctx = await context(browser, plane);
      const a = await ctx.newPage();
      await seed(a, slots(plane.storedSession('creator', 3600)));
      await a.goto(HOUSE + pageA, { waitUntil: 'load' });
      await sleep(3000);
      const b = await ctx.newPage();
      await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
      await until(b, () => !!(window.MCC && window.MCC.signOut), null, 8000);
      await sleep(1000);
      await b.evaluate(() => window.MCC.signOut());
      await sleep(4000);
      const read = (pg) => pg.evaluate(() => ({ bar: document.body.getAttribute('data-mcc-auth'), session: !!localStorage.getItem('mccdb_session'), keep: !!localStorage.getItem('mcc_sess_keep') }));
      const sa = await read(a), sb = await read(b);
      check(!sa.session && !sa.keep, `X5 ${pageA}: the open music tab does not write the session back (${JSON.stringify(sa)})`);
      check(sa.bar === 'out' && sb.bar === 'out', `X5 ${pageA}: both tabs say signed out (${sa.bar}, ${sb.bar})`);
      await ctx.close();
    }
  },

  /* ---------- the album's comment box, signed out (ACC-12) ---------- */
  async album_guest_comment(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    planeFor.set(ctx, plane);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    const NOTE = () => { const n = document.querySelector('[data-comments] [data-write] .note'); return n ? { text: n.textContent.trim(), href: (n.querySelector('a') || { getAttribute: () => '' }).getAttribute('href') } : null; };
    await until(page, () => { const n = document.querySelector('[data-comments] [data-write] .note a'); return !!n; }, null, 10000);
    await sleep(1200); /* the box paints again 0.9 s after load */
    const note = await page.evaluate(NOTE);
    check(!!note && note.text === 'Sign in to speak, with your M Account.', `album guest: the comment box asks for the sign-in that exists (${JSON.stringify(note)})`);
    check(!!note && /^account\.html\?next=%2Falbum\.html/.test(note.href || ''), `album guest: the sign-in comes back to the album (${note && note.href})`);
    check(!!note && !/password|one tap/i.test(note.text), 'album guest: no promise of a sign-in without a password');
    await fits(page, 'album guest');
    await ownerShot(page, 'album-comments-guest-390', '[data-comments]');
    await ctx.close();
  },

  /* ---------- D1a: the Creator Website Studio acts as the site's account, never a previous one (ACC-6) ---------- */
  async D1a_creator_website_studio_account(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    planeFor.set(ctx, plane);
    const a = await ctx.newPage();
    const old = plane.session('creator', 3600);
    const items = Object.assign({ [SBKEY]: JSON.stringify({ access_token: old.access_token, token_type: 'bearer', expires_in: old.expires_in, expires_at: old.expires_at, refresh_token: old.refresh_token, user: old.user }) },
      slots(plane.storedSession('member', 3600)));
    await seed(a, items);
    const t0 = Date.now();
    await a.goto(HOUSE + '/mccluster-creator-studio.html', { waitUntil: 'load' });
    await until(a, () => /Signed in as/.test(document.getElementById('accountStatus').textContent), null, 10000);
    await sleep(1500);
    const net = plane.log.filter((x) => x.t >= t0 && x.page === '/mccluster-creator-studio.html' && /^(fresh|expired):/.test(x.auth)).map((x) => x.auth + ' ' + x.path);
    const status = await a.textContent('#accountStatus');
    check(/fixture-listener/.test(status), `D1a: the studio names the account the site is signed in as (${status})`);
    const name = await a.inputValue('#name');
    check(name === PEOPLE.member.name, `D1a: the editor holds the site account's profile, not the previous account's (${name})`);
    check(net.length > 0 && net.every((x) => x.startsWith('fresh:member')), `D1a: every call carries the site account's token, none the previous account's (${net.join(' | ')})`);
    const prompts = await a.evaluate(() => {
      const vis = (e) => e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
      return Array.from(document.querySelectorAll('a,p')).filter(vis).map((e) => e.textContent.trim()).filter((t) => /^Sign in/i.test(t));
    });
    check(prompts.length === 0, `D1a: a signed-in member is not asked to sign in (${JSON.stringify(prompts)})`);
    await fits(a, 'D1a Creator Website Studio');
    await ownerShot(a, 'creator-website-studio-member-390');
    await ctx.close();
  },

  /* ---------- D1b: after a sign-out the Creator Website Studio is signed out too (ACC-6) ---------- */
  async D1b_creator_website_studio_after_signout(browser) {
    const plane = makePlane({});
    const ctx = await context(browser, plane);
    const a = await ctx.newPage();
    await seed(a, slots(plane.storedSession('creator', 3600)));
    await a.goto(HOUSE + '/mccluster-creator-studio.html', { waitUntil: 'load' });
    await until(a, () => /Signed in as/.test(document.getElementById('accountStatus').textContent), null, 10000);
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/account.html', { waitUntil: 'load' });
    /* a sign-out that could not reach the server (offline): only this device forgets the session */
    await b.evaluate(() => { localStorage.removeItem('mcc_sess_keep'); localStorage.removeItem('mccdb_session'); window.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: false } })); });
    await b.close();
    const c = await ctx.newPage();
    const t0 = Date.now();
    await c.goto(HOUSE + '/mccluster-creator-studio.html', { waitUntil: 'load' });
    await sleep(4000);
    const st = await c.evaluate(() => ({ status: document.getElementById('accountStatus').textContent, name: document.getElementById('name').value, signin: !document.getElementById('accountSignIn') || !document.getElementById('accountSignIn').hidden }));
    const asCreator = plane.log.filter((x) => x.t >= t0 && /creator$/.test(x.auth));
    check(/Not signed in/.test(st.status), `D1b: the reopened studio says it is not signed in (${st.status})`);
    check(st.name !== PEOPLE.creator.name, `D1b: the signed-out account's profile is not loaded into the editor (${st.name})`);
    check(asCreator.length === 0, `D1b: nothing is asked as the signed-out account (${asCreator.map((x) => x.path).join(', ')})`);
    check(st.signin, 'D1b: the sign-in link is offered');
    check(await a.evaluate(() => /Not signed in/.test(document.getElementById('accountStatus').textContent)), 'D1b: the studio left open follows the sign-out too');
    const leftName = await a.inputValue('#name');
    check(leftName !== PEOPLE.creator.name, `D1b: the studio left open no longer shows the signed-out account's profile (${leftName})`);
    await ctx.close();
  },

  /* ---------- D1c: one refresher of the shared refresh token (ACC-6) ----------
     The token lives 85 s, so a separate supabase-js session would refresh it at its first tick (it refreshes
     anything due within 90 s), rotating the shared refresh token into its own store. 27 s later the site's
     own copy is due (it renews a minute early) and a music page renews it. */
  async D1c_one_refresher(browser) {
    const plane = makePlane({ reuseMs: 3000 });
    const ctx = await context(browser, plane, 1280);
    const a = await ctx.newPage();
    const s = plane.storedSession('member', 85);
    const born = Date.now();
    await seed(a, slots(s));
    await a.goto(HOUSE + '/mccluster-creator-studio.html', { waitUntil: 'load' });
    await sleep(Math.max(0, 28000 - (Date.now() - born)));
    const opened = Date.now();
    const b = await ctx.newPage();
    await b.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await sleep(6000);
    /* while the site's session was still good (more than a minute left), nothing should have renewed it */
    const early = plane.log.filter((x) => x.path === '/auth/v1/token' && x.grant === 'refresh_token' && x.t < opened);
    const used = plane.log.filter((x) => x.path === '/auth/v1/token' && x.grant === 'refresh_token').map((x) => `${Math.round((x.t - born) / 1000)}s ${x.page} ${x.rt}`);
    const st = await b.evaluate(() => ({ bar: document.body.getAttribute('data-mcc-auth'), session: !!localStorage.getItem('mccdb_session') }));
    check(st.bar === 'in' && st.session, `D1c: the member is still signed in on Music after the refresh (${JSON.stringify(st)}; refreshes: ${used.join(' | ')})`);
    check(early.length === 0, `D1c: the studio never spends the shared refresh token on a store of its own (${early.map((x) => x.page + ' ' + x.rt).join(', ')})`);
    check(await a.evaluate((k) => !localStorage.getItem(k), SBKEY), 'D1c: no second session is stored');
    await ctx.close();
  },

  /* ---------- T7: an account-only creator track for a member back after the hour (DEL-3, C3 member side) ---------- */
  async T7_creator_track_expired_member(browser) {
    const plane = makePlane({
      refreshDelayMs: 300,
      creatorTracks: [{ id: '30000000-0000-4000-8000-000000000001', m_uid: PEOPLE.creator.muid, title: 'Fixture Account Song', artist: 'Fixture Artist', poster_url: '', audio_url: HOUSE + '/assets/audio/here.mp3', preview_bucket: 'creator-previews', preview_path: 'x/preview.mp3', access_mode: 'account', genre: '', published_at: '2026-11-01T00:00:00Z' }]
    });
    const ctx = await context(browser, plane);
    const page = await ctx.newPage();
    await seed(page, slots(plane.storedSession('member', -7200)));
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    const ready = await until(page, () => !!document.querySelector('[data-creator-track]') && !!window.MCC_MUSIC, null, 10000);
    check(ready, 'T7: the creator track is on the shelf');
    const t0 = Date.now();
    await page.evaluate(() => window.MCC_MUSIC.playCreator('30000000-0000-4000-8000-000000000001').catch(() => null));
    await until(page, () => window.MCC_MUSIC.access() !== 'loading', null, 10000);
    const access = await page.evaluate(() => window.MCC_MUSIC.access());
    const asks = plane.log.filter((x) => x.t >= t0 && x.action === 'stream').map((x) => x.auth);
    check(access === 'full', `T7: the member hears the full track, not a preview (${access})`);
    check(asks.length > 0 && asks[asks.length - 1] === 'fresh:member', `T7: the stream was asked for with a renewed token (${asks.join(', ')})`);
    await ctx.close();
  }
};

await mkdir(OUT, { recursive: true });
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const started = Date.now();
try {
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.test(name)) continue;
    const t = Date.now();
    try { await fn(browser); }
    catch (e) { check(false, `${name}: threw ${String(e && e.stack || e).slice(0, 400)}`); }
    console.log(`-- ${name} ${Math.round((Date.now() - t) / 1000)} s`);
  }
} finally {
  await browser.close();
}
const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n${seconds} s`);
await writeFile(join(OUT, 'result.json'), JSON.stringify({ seconds, passed: checks.length - failures.length, failed: failures.length, checks }, null, 2) + '\n');
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('music accounts e2e: all checks passed');
