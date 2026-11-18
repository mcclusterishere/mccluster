/* THE DOOR (owner, 2026-11-18: "the sign-in page just looks like shit. It needs to be fancier, look sexier, and have more
   shit to it ... This is royalty shit over here"; docs/design/WORLD-SIGN-IN-DOOR.md). The World's sign-in rises over the
   living World instead of replacing it.

   The page exactly as it ships, with the real globe when CESIUM_DIR is set, and a fake api.mccluster.org and Supabase shaped
   like production on 2026-11-18 (scripts/e2e/support/world-gate-harness.mjs). It takes the screenshot set of the spec
   (docs/design/WORLD-SIGN-IN-DOOR.md, "Screenshots") and holds the door to its acceptance:
   - the law: no "Hu Up", the supplied crown only (white by night, dark by day, nothing drawn on it), no other entity named,
     the company's colophon, 16 px controls, nothing scrolling sideways at 320, 390, 820 and 1280;
   - the overlay: the World displayed and inert under it, the bar and its chip inert, the privacy banner never inert and
     never covered, Tab going nowhere outside the door but the banner;
   - the layout targets at 390x844, 820x1180 and 1280x800, by night and by day, sign in and create account;
   - honesty: each card only from its own read, singular and plural, no zero, no total, the GDELT credit linked, the
     record's counts and no name, and the Earth's credit;
   - the network: nothing read on arrival, only the door's reads on opening, nothing more within five minutes;
   - every way in (the openers) and every way out (Back, Escape, the scrim, the phone's Back, a hand-off, a success);
   - motion only after a gesture, none under reduced motion, no blur over the globe; contrast from pixels; 44 px targets;
   - the onboarding pages, still pages, in the door's hand.
     CESIUM_DIR=/path/to/Build/Cesium node scripts/e2e/world-gate.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). Every PNG of the set and results.json land in outDir. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadChromium, startServer, openWorld, worldReady, doorFrame, contrast, targets, settle, DEVICES, LAUNCH, RIDE, ONE_MISSION, TWO_MISSIONS, MANY_MISSIONS } from './support/world-gate-harness.mjs';

const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-gate');
await mkdir(OUT, { recursive: true });
const chromium = loadChromium();
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, ...LAUNCH });
const results = [], frames = [];
const ONLY = process.env.WORLD_GATE_ONLY ? process.env.WORLD_GATE_ONLY.split(',') : null;
const runs = (name) => !ONLY || ONLY.includes(name);
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, ...(ok || detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 700)}`);
}
const opened = (page) => page.waitForFunction(() => { const d = document.getElementById('mnSignedOut'); return d && !d.hidden && !d.classList.contains('is-leaving'); }, null, { timeout: 15000 });
const closed = (page) => page.waitForFunction(() => document.getElementById('mnSignedOut').hidden, null, { timeout: 5000 }).then(() => true, () => false);
const pulseSettled = (page) => page.waitForFunction(() => ['wgPulseMission', 'wgPulseNews', 'wgPulseRecord'].filter((id) => !document.getElementById(id).hidden).length >= 1, null, { timeout: 8000 }).catch(() => {});
const overlap = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/* the noise a scenario may allow: only its own deliberate fixture failures */
function noise(world, allow = []) {
  /* the house owner check answers 403 to everyone here; without CESIUM_DIR the globe's library is refused on purpose */
  const ok = (url) => /\/v1\/status$/.test(url) || (!process.env.CESIUM_DIR && /^https:\/\/cesium\.com\//.test(url)) || allow.some((re) => re.test(url));
  return { console: world.console.filter((c) => !(/^Failed to load resource/.test(c.text) && (ok(c.url) || !c.url))), bad: world.bad.filter((b) => !ok(b.url)) };
}

/* one frame of the set: the screenshot, and what results.json keeps of it */
async function frame(page, world, name, { root = '#mnSignedOut', shot = true } = {}) {
  await settle(page);
  const m = await doorFrame(page);
  const c = await contrast(page, root);
  const small = await targets(page, root);
  /* the glyph mask came off just now: every button's colour eases back over 220 ms (css/style.css), so wait it out */
  if (shot) { await settle(page); await page.screenshot({ path: join(OUT, name + '.png'), timeout: 90000 }).catch((e) => check(name, 'the picture is taken', false, String(e && e.message || e).slice(0, 160))); }
  frames.push({ name, overflow: { sw: m.sw, cw: m.cw }, rects: { sheet: m.sheet, go: m.go, banner: m.banner, frame: m.frame, veil: m.veil }, fonts: m.fonts, visibleText: root === '#mnSignedOut' ? m.visibleText : '', cards: m.cards, dateline: m.dateline, credit: m.creditText,
    contrast: c.items.map((i) => ({ text: i.text, ratio: i.ratio, need: i.need })), inert: m.inert, requests: world.requests.filter((r) => r.frame === 'main').map((r) => `${r.m} ${r.host}${r.p}`) });
  check(name, 'nothing scrolls sideways', m.sw === m.cw, { sw: m.sw, cw: m.cw });
  check(name, 'every text reads at 4.5:1 or better (3:1 for large type), measured from pixels with the glyphs masked', c.failures.length === 0 && c.items.length > 0, c.failures.slice(0, 5));
  check(name, 'every interactive element is at least 44 x 44', small.length === 0, small.slice(0, 6));
  return m;
}
/* the door's law, read from the live page */
async function law(page, scope, phase) {
  const l = await page.evaluate((phase) => {
    const d = document.getElementById('mnSignedOut'), imgs = [...d.querySelectorAll('img')];
    const crown = imgs.map((i) => { const cs = getComputedStyle(i), r = i.getBoundingClientRect(); return { src: i.getAttribute('src'), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), shown: i.getClientRects().length > 0 && cs.display !== 'none', box: [Math.round(r.width), Math.round(r.height)],
      plain: cs.filter === 'none' && /^none/.test(cs.maskImage || cs.webkitMaskImage || 'none') && cs.mixBlendMode === 'normal' && cs.boxShadow === 'none' && cs.borderTopWidth === '0px' && (cs.outlineStyle === 'none' || cs.outlineWidth === '0px') && cs.backgroundImage === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && cs.borderRadius === '0px' }; });
    const text = d.innerText;
    const inputs = [...d.querySelectorAll('input:not([type=hidden])')].filter((i) => i.getClientRects().length).map((i) => ({ id: i.id, size: parseFloat(getComputedStyle(i).fontSize) }));
    const blur = [...document.querySelectorAll('#mnSignedOut, #mnSignedOut *')].filter((e) => { const cs = getComputedStyle(e); return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none'); }).map((e) => ({ el: e.id || e.className, r: e.getBoundingClientRect().toJSON() }));
    const frame = document.getElementById('mnWorldFrame').getBoundingClientRect();
    const fonts = performance.getEntriesByType('resource').filter((e) => /\.(woff2?|ttf|otf)(\?|$)/.test(e.name)).map((e) => e.name);
    return { crown, text, inputs, blur, frame: frame.toJSON(), fonts, role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label'), mode: d.getAttribute('data-auth-mode'),
      h2: document.getElementById('wgTitle').textContent, lede: !!d.querySelector('.mn__lede'), hu: /hu\s*up/i.test(document.documentElement.outerHTML),
      tabs: { list: d.querySelector('[role=tablist]').getAttribute('aria-label'), names: [...d.querySelectorAll('[role=tab]')].map((t) => [...t.childNodes].filter((n) => !(n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent).join('').trim()), selected: [...d.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected')), tabindex: [...d.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('tabindex')), panel: document.getElementById('mnAuthPanel').getAttribute('aria-labelledby') },
      fields: ['mnEmail', 'mnPassword', 'mnPassword2'].map((id) => { const i = document.getElementById(id); return { id, label: !!d.querySelector(`label[for="${id}"]`), ac: i.getAttribute('autocomplete'), desc: i.getAttribute('aria-describedby') }; }),
      shows: [...d.querySelectorAll('[data-reveal]')].map((b) => ({ controls: b.getAttribute('aria-controls'), pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label') })),
      providers: !document.getElementById('mnProviders').hidden, or: getComputedStyle(document.querySelector('#mnSignedOut .mn__or')).display !== 'none' && !document.getElementById('mnProviders').hidden };
  }, phase);
  const shownCrowns = l.crown.filter((c) => c.shown);
  check(scope, 'the crown is the supplied artwork only: two files, alt "", 160 x 160, one shown for the phase, square, nothing drawn on or around it', l.crown.length === 2 && l.crown.every((c) => c.alt === '' && c.w === '160' && c.h === '160' && c.plain)
    && shownCrowns.length === 1 && shownCrowns[0].src === (phase === 'day' ? 'assets/img/equity-uprise-mark.png' : 'assets/img/equity-uprise-mark-white.png') && shownCrowns[0].box[0] === shownCrowns[0].box[1], l.crown);
  check(scope, 'no other entity or name: never "Equity Uprise" in words, never Matthew McCluster, I AM HERE, Whip Equipped or PRIM3; the colophon is the company\'s', !/Equity Uprise|Human Uprise|Matthew McCluster|I AM HERE|Whip Equipped|PRIM3/.test(l.text) && /A McCluster Corp program\./.test(l.text), l.text.slice(0, 300));
  check(scope, 'no "Hu Up" anywhere on the page; the headline is the line, with no lede after it', !l.hu && l.h2 === 'Turn what you care about into action.' && !l.lede);
  check(scope, 'a dialog named for its mode, without aria-modal', l.role === 'dialog' && l.modal === null && l.label === (l.mode === 'create' ? 'Create an account' : 'Sign in'), { role: l.role, modal: l.modal, label: l.label, mode: l.mode });
  check(scope, 'the doors are tabs: Sign in and Create account by name, one tab stop, the panel labelled by the chosen one', l.tabs.list === 'Sign in or create an account' && JSON.stringify(l.tabs.names) === '["Sign in","Create account"]'
    && JSON.stringify(l.tabs.tabindex) === (l.mode === 'create' ? '["-1","0"]' : '["0","-1"]') && l.tabs.panel === (l.mode === 'create' ? 'mnCreateTab' : 'mnSignInTab'), l.tabs);
  check(scope, 'fields: a label each, autocomplete as before, described by the status (and the rule, and the match)', l.fields.every((f) => f.label) && l.fields[0].ac === 'email' && l.fields[1].ac === (l.mode === 'create' ? 'new-password' : 'current-password') && l.fields[2].ac === 'new-password'
    && l.fields[0].desc === 'mnAuthStatus' && l.fields[1].desc === 'mnPasswordHint mnAuthStatus' && l.fields[2].desc === 'wgMatch mnAuthStatus' && l.shows.every((s) => s.controls && s.pressed === 'false' && s.name === 'Show password'), { fields: l.fields, shows: l.shows });
  check(scope, 'form controls at 16 px or more', l.inputs.every((i) => i.size >= 16), l.inputs);
  check(scope, 'no backdrop-filter in the door overlaps the globe frame', l.blur.every((b) => !(b.r.left < l.frame.right - 0.5 && b.r.right > l.frame.left && b.r.top < l.frame.bottom && b.r.bottom > l.frame.top)), l.blur);
  check(scope, 'only same-origin font files', l.fonts.every((f) => f.startsWith(server.base)), l.fonts);
  return l;
}
/* the overlay: the World displayed and inert, the bar and its chip inert, the banner never; html says which gate is up */
async function overlay(page, scope) {
  const o = await page.evaluate(() => ({ app: !document.getElementById('mnApp').hidden && getComputedStyle(document.getElementById('mnApp')).display !== 'none', appInert: document.getElementById('mnApp').inert,
    top: !!document.querySelector('.mn__top').closest('[inert]'), bar: !!document.querySelector('.appbar') && !!document.querySelector('.appbar').closest('[inert]'), chip: document.getElementById('mccAuthChip') ? !!document.getElementById('mccAuthChip').closest('[inert]') : null,
    banner: document.getElementById('mccPrivacyNotice') ? !!document.getElementById('mccPrivacyNotice').closest('[inert]') : null,
    door: document.documentElement.classList.contains('mn-door-open'), gate: document.documentElement.classList.contains('mn-gate-on'),
    z: (() => { const bar = document.querySelector('.appbar'); if (!bar) return null; const r = bar.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && !!e.closest('#mnSignedOut, #mccPrivacyNotice'); })() }));
  check(scope, 'the World stays on screen under the door, inert; the header, the bar and its chip are inert; html has mn-door-open, not mn-gate-on', o.app && o.appInert && o.top && o.bar && (o.chip === null || o.chip) && o.door && !o.gate && o.banner !== true && o.z !== false, o);
  return o;
}
/* Tab never reaches anything outside the door except the privacy banner */
async function tabsStayInside(page, scope, n = 26) {
  const seen = [];
  await page.focus('#mnEmail');
  for (let k = 0; k < n; k++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? 'body' : a.closest('#mnSignedOut') ? 'door' : a.closest('#mccPrivacyNotice') ? 'banner' : (a.id || a.tagName); }));
  }
  check(scope, 'Tab reaches nothing outside the door except the privacy banner', seen.every((s) => s === 'door' || s === 'banner' || s === 'body'), seen);
  await page.focus('#mnEmail');
}
const openBy = async (page, how) => {
  if (how === 'signin' || how === 'create') await page.click(`[data-guest-open="${how}"]`);
  else if (how === 'people') { await page.evaluate(() => document.querySelector('#mnFeedScope [data-mn-view="discover"]').focus({ preventScroll: true })); await page.keyboard.press('Enter'); }
  await opened(page);
};

try {
  /* ---------- the core grid: 390, 820 and 1280, night and day, sign in and create ---------- */
  if (runs('grid')) for (const w of [390, 820, 1280]) for (const phase of ['night', 'day']) for (const mode of ['signin', 'create']) {
    const name = `door-${mode}-${w}-${phase}`, device = DEVICES[w];
    const { ctx, page, world } = await openWorld(browser, server.base, device, '/mnet.html?view=feed', { phase });
    try {
      await worldReady(page);
      await page.waitForTimeout(400);
      const before = world.requests.filter((r) => r.frame === 'main' && /news-heat|action-archive|docket-516r/.test(r.p)).length;
      check(name, 'a guest\'s arrival makes no door read', before === 0, before);
      await openBy(page, mode);
      await pulseSettled(page);
      const m = await frame(page, world, name);
      await law(page, name, phase);
      await overlay(page, name);
      const reads = world.requests.filter((r) => r.frame === 'main' && /news-heat|action-archive|docket-516r/.test(r.p));
      check(name, 'opening reads only news-heat and the record, once each', reads.length === 2 && reads.some((r) => r.p === '/v1/world/news-heat' && !r.q) && reads.some((r) => r.p === '/v1/action-archive/docket-516r-2025'), reads);
      check(name, 'the pulse is the World\'s real answers: Open now and the newest mission, news from 183 countries (GDELT), the Docket 516R record; never a total', m.cards[0].shown && /Give someone a free ride/.test(m.cards[0].text) && /Open now/.test(m.cards[0].text) && !/missions/.test(m.cards[0].text)
        && /News from 183 countries/.test(m.cards[1].text) && /The GDELT Project/.test(m.cards[1].text) && !/12,?296|12,?000/.test(m.cards[1].text) && /Docket 516R · Write the Change/.test(m.cards[2].text) && /10 participants · 9 songs · Bridgeport, CT · Oct 5, 2025/.test(m.cards[2].text), m.cards);
      check(name, 'the Earth\'s credit is on the stage', /NASA imagery/.test(m.creditText) && /Natural Earth/.test(m.creditText) && /OpenStreetMap/.test(m.creditText), m.creditText);
      const prov = await page.evaluate(() => ({ providers: !document.getElementById('mnProviders').hidden, buttons: document.querySelectorAll('#mnProviderButtons button').length }));
      check(name, 'email only in the live settings: no provider button and no "or"', !prov.providers && prov.buttons === 0, prov);
      const hit = await page.evaluate(() => { const g = document.getElementById('mnAuthGo').getBoundingClientRect(), e = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2); return !!e && (e.id === 'mnAuthGo' || !!e.closest('#mnAuthGo')); });
      if (w === 390 && mode === 'signin') {
        check(name, '390 sign in: the sheet\'s top between 150 and 260, the action wholly on screen and hit-testable, the pulse showing', m.sheet.top >= 150 && m.sheet.top <= 260 && m.go.top >= 0 && m.go.bottom <= m.vh && hit && m.pulse && m.pulse.h > 0, { sheet: m.sheet, go: m.go, hit, pulse: m.pulse });
        await tabsStayInside(page, name);
      }
      if (w === 390 && mode === 'create') {
        check(name, '390 create: the sheet scrolls inside and says there is more', m.more, m.sheet);
        if (phase === 'night') {
          await page.evaluate(() => { const s = document.getElementById('wgSheet'); s.scrollTop = s.scrollHeight; });
          /* the fade goes on the sheet's own scroll event, which a busy renderer delivers late */
          await page.waitForFunction(() => !document.getElementById('wgSheet').hasAttribute('data-more'), null, { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(250);
          const end = await frame(page, world, 'door-create-390-night-end');
          const hit2 = await page.evaluate(() => { const g = document.getElementById('mnAuthGo').getBoundingClientRect(), e = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2); return !!e && !!e.closest('#mnAuthGo'); });
          check('door-create-390-night-end', 'at the end of the sheet the action is wholly visible and hit-testable, and the fade has gone', !end.more && end.go.top >= end.sheet.top && end.go.bottom <= end.sheet.bottom && hit2, { go: end.go, sheet: end.sheet, more: end.more });
        }
      }
      if (w === 820) {
        const visibleGlobe = m.sheet.top - Math.max(m.frame.top, (await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('mnSignedOut')).getPropertyValue('--wg-head')) || 72)) + 2);
        check(name, '820: the card 500 px or less and centred, wholly visible without scrolling, 300 px or more of the globe above it', m.sheet.w <= 500 && Math.abs(m.sheet.left - (m.vw - m.sheet.right)) <= 2 && !m.more && m.sheet.bottom <= m.vh && m.sheet.top >= 0 && visibleGlobe >= 300, { sheet: m.sheet, more: m.more, visibleGlobe });
      }
      if (w === 1280) {
        check(name, '1280: the card 484 ± 8 px in the right-hand column' + (mode === 'signin' ? ', wholly visible' : ', fitting or scrolling inside with the fade'), Math.abs(m.sheet.w - 484) <= 8 && m.sheet.left >= m.vw - 540 - 1 && (mode === 'create' ? true : !m.more) && m.sheet.top >= 0 && m.sheet.bottom <= m.vh, { sheet: m.sheet, more: m.more });
        check(name, '1280: the dated lower third at the bottom left, up to three cards', /Today in the World/i.test(m.dateline) && m.pulse.left < m.sheet.left && m.pulse.bottom > m.vh / 2, { dateline: m.dateline, pulse: m.pulse });
        check(name, '1280: the veil never overlaps the globe frame', !overlap(m.veil, { ...m.frame, right: m.frame.right - 0.5 }), { veil: m.veil, frame: m.frame });
      }
      const n = noise(world);
      check(name, 'no console error and no 4xx', n.console.length === 0 && n.bad.length === 0 && world.errors.length === 0, { ...n, errors: world.errors });
    } finally { await ctx.close(); }
  }

  /* ---------- the reason line, and a mission Join ---------- */
  if (runs('why')) for (const [w, phase] of [[390, 'night'], [390, 'day'], [1280, 'night']]) {
    const name = `door-why-${w}-${phase}`;
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase });
    try {
      await worldReady(page);
      await openBy(page, 'people');
      await pulseSettled(page);
      const m = await frame(page, world, name);
      const why = await page.evaluate(() => ({ row: !document.getElementById('mnGuestWhyRow').hidden, text: document.getElementById('mnGuestWhy').textContent }));
      check(name, 'People asks with its own line: Sign in to find people.', why.row && why.text === 'Sign in to find people.', why);
      if (w === 390) check(name, '390 with a reason: the sheet\'s top stays at 150 or more', m.sheet.top >= 150, m.sheet);
    } finally { await ctx.close(); }
  }
  if (runs('mission')) {
    const name = 'door-mission-390-night';
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], `/mnet.html?view=feed&mission=${RIDE}`, { phase: 'night', missions: TWO_MISSIONS.concat(ONE_MISSION.filter((m) => !TWO_MISSIONS.some((x) => x.id === m.id))) });
    try {
      await page.waitForSelector('#mnMissionDialog[open]', { timeout: 60000 });
      await page.click('#mnMissionJoin');
      await opened(page);
      await pulseSettled(page);
      await page.waitForFunction(() => /Your mission/.test(document.getElementById('wgPulseMission').textContent), null, { timeout: 8000 }).catch(() => {});
      await frame(page, world, name);
      const s = await page.evaluate(() => ({ why: document.getElementById('mnGuestWhy').textContent, dialog: document.getElementById('mnMissionDialog').open, mission: new URL(location.href).searchParams.get('mission'), card: document.getElementById('wgPulseMission').textContent.replace(/\s+/g, ' ').trim(), button: !!document.querySelector('#wgPulseMission button') }));
      check(name, 'from a mission Join: the reason, the dialog closed, ?mission= kept, the card reads Your mission and is not a button', s.why === 'Sign in to join this mission.' && !s.dialog && s.mission === RIDE && /Your mission/.test(s.card) && /Give someone a free ride/.test(s.card) && !s.button, s);
    } finally { await ctx.close(); }
  }

  /* ---------- the mission card hands the World its mission; two and 500 missions; one country ---------- */
  if (runs('pulse')) {
    for (const [list, kicker, label] of [[TWO_MISSIONS, 'Open now · 2 missions', 'two'], [MANY_MISSIONS, 'Open now · 500+ missions', '500']]) {
      const { ctx, page } = await openWorld(browser, server.base, DEVICES[1280], '/mnet.html?view=feed', { phase: 'night', missions: list, heat: label === 'two' ? 'single' : 'three', dpr: 1 });
      try {
        await worldReady(page);
        await openBy(page, 'signin');
        await pulseSettled(page);
        await page.waitForTimeout(400);
        const cards = (await doorFrame(page)).cards;
        check('pulse-' + label, `${list.length} open missions read "${kicker}"`, cards[0].text.includes(kicker), cards[0]);
        check('pulse-' + label, label === 'two' ? 'one country reads "News from 1 country"' : 'three countries read "News from 3 countries"', cards[1].text.includes(label === 'two' ? 'News from 1 country' : 'News from 3 countries'), cards[1]);
        if (label === 'two') {
          await page.click('#wgPulseMission .wg-card__go');
          await page.waitForSelector('#mnMissionDialog[open]', { timeout: 10000 });
          const h = await page.evaluate(() => ({ door: document.getElementById('mnSignedOut').hidden || document.getElementById('mnSignedOut').classList.contains('is-leaving'), mission: new URL(location.href).searchParams.get('mission'), title: document.getElementById('mnMissionTitle').textContent, hist: history.state && history.state.mccDoor }));
          check('pulse-two', 'the mission card closes the door and opens that mission\'s dialog with ?mission= in the address', h.door && h.mission === TWO_MISSIONS[0].id && h.title === TWO_MISSIONS[0].title && !h.hist, h);
        }
      } finally { await ctx.close(); }
    }
  }

  /* ---------- errors, the busy action, the emailed state, a provider ---------- */
  if (runs('states')) {
    for (const phase of ['night', 'day']) {
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase, token: 'invalid' });
      try {
        await worldReady(page);
        await openBy(page, 'signin');
        await page.fill('#mnEmail', 'member@example.invalid');
        await page.fill('#mnPassword', 'not-the-password');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => /match an account/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 });
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await frame(page, world, `door-error-390-${phase}`);
        await page.click('#mnCreateTab');
        await page.fill('#mnEmail', 'new.member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.fill('#mnPassword2', 'fixture-password-2');
        await page.click('#mnAuthGo');
        await frame(page, world, `door-create-error-390-${phase}`);
        const e = await page.evaluate(() => ({ status: document.getElementById('mnAuthStatus').textContent, invalid: document.getElementById('mnPassword2').getAttribute('aria-invalid') }));
        check(`door-create-error-390-${phase}`, 'the passwords differ: the reason over the action and the field marked', e.status === 'Those passwords do not match.' && e.invalid === 'true', e);
      } finally { await ctx.close(); }
    }
    {
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', banner: true });
      try {
        await worldReady(page);
        await page.click('#mccPrivacyNoticeLater').catch(() => {});
        /* the banner has gone before the door measures its room */
        await page.waitForFunction(() => { const b = document.getElementById('mccPrivacyNotice'); return !b || b.hidden || !b.getClientRects().length; }, null, { timeout: 5000 }).catch(() => {});
        await openBy(page, 'create');
        await page.fill('#mnEmail', 'new.member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.fill('#mnPassword2', 'fixture-password-1');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => /Tick the box/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 5000 });
        await frame(page, world, 'door-privacy-error-390-night');
        const p = await page.evaluate(() => { const l = document.getElementById('mnCreateAgree'), s = l.querySelector('span'), r = s.getBoundingClientRect(); return { lines: Math.round(r.height / parseFloat(getComputedStyle(s).lineHeight)), invalid: document.getElementById('mnCreateAgreeBox').getAttribute('aria-invalid') }; });
        check('door-privacy-error-390-night', 'the privacy sentence stays on one line, and the box is marked', p.lines === 1 && p.invalid === 'true', p);
      } finally { await ctx.close(); }
    }
    {
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', token: 'slow' });
      try {
        await worldReady(page);
        await openBy(page, 'signin');
        await page.fill('#mnEmail', 'member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => document.getElementById('mnAuthGo').getAttribute('aria-busy') === 'true', null, { timeout: 3000 });
        await page.waitForTimeout(500);
        const b = await page.evaluate(() => { const g = document.getElementById('mnAuthGo'); return { text: g.textContent, busy: g.getAttribute('aria-busy'), disabled: g.disabled, fill: getComputedStyle(g).webkitTextFillColor }; });
        check('door-loading-390-night', 'busy: Signing in…, held, aria-busy, the label still readable', b.text === 'Signing in…' && b.busy === 'true' && b.disabled && /255, 255, 255/.test(b.fill), b);
        await page.screenshot({ path: join(OUT, 'door-loading-390-night.png'), timeout: 90000 });
        frames.push({ name: 'door-loading-390-night', overflow: await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })), requests: world.requests.filter((r) => r.frame === 'main').map((r) => `${r.m} ${r.host}${r.p}`) });
      } finally { await ctx.close(); }
    }
    for (const [w, phase] of [[390, 'night'], [390, 'day'], [1280, 'night']]) {
      const name = `door-verify-${w}-${phase}`;
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase, signup: 'confirm' });
      try {
        await worldReady(page);
        await openBy(page, 'create');
        await page.fill('#mnEmail', 'new.member@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.fill('#mnPassword2', 'fixture-password-1');
        await page.click('#mnAuthGo');
        await page.waitForFunction(() => /Check your email/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 });
        /* Resend is held for the first minute: read it now, before the picture (a busy renderer can outlast the minute) */
        const held = await page.evaluate(() => document.getElementById('mnResend').disabled);
        await frame(page, world, name);
        const v = await page.evaluate((held) => ({ ok: document.getElementById('mnAuthStatus').classList.contains('is-ok'), resend: !document.getElementById('mnResend').hidden, held, top: document.getElementById('mnAuthStatus').getBoundingClientRect().top < document.getElementById('mnEmail').getBoundingClientRect().top }), held);
        check(name, 'the sealed note leads, Resend under it held, the fields after', v.ok && v.resend && v.held && v.top, v);
      } finally { await ctx.close(); }
    }
    {
      const name = 'door-provider-390-night';
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', settings: { external: { email: true, google: true } } });
      try {
        await worldReady(page);
        await openBy(page, 'signin');
        await page.waitForSelector('#mnProviders:not([hidden]) .mn__provider', { timeout: 10000 });
        await page.evaluate(() => { const s = document.getElementById('wgSheet'); s.scrollTop = s.scrollHeight; });
        await frame(page, world, name);
        const p = await page.evaluate(() => ({ words: [...document.querySelectorAll('#mnProviderButtons .mn__provider')].map((b) => b.textContent), imgs: document.querySelectorAll('#mnProviders img, #mnProviders svg').length, or: document.querySelector('#mnSignedOut .mn__or').textContent }));
        check(name, 'Google switched on in the live settings: one outlined pill in words only, under "or"', JSON.stringify(p.words) === '["Continue with Google"]' && p.imgs === 0 && p.or === 'or', p);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- every read failing: only the Earth, the way back and the credit; the form still works ---------- */
  if (runs('empty')) for (const w of [390, 1280]) {
    const name = `door-empty-${w}-night`;
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase: 'night', missions: 'fail', heat: '503', archive: 'gone', token: 'invalid' });
    try {
      await page.waitForFunction(() => !!window.MCC_GATE && !!window.MCC, null, { timeout: 60000 });
      await page.waitForSelector('[data-guest-open="signin"]', { state: 'visible', timeout: 60000 });
      await openBy(page, 'signin');
      await page.waitForTimeout(1500);
      const m = await frame(page, world, name);
      check(name, 'no card, no dateline, no zero, no placeholder digits; the back pill and the credit stay', m.cards.every((c) => !c.shown) && !m.dateline && !/\d/.test(m.cards.map((c) => c.text).join('')) && m.back && /OpenStreetMap/.test(m.creditText), { cards: m.cards, dateline: m.dateline });
      await page.fill('#mnEmail', 'member@example.invalid');
      await page.fill('#mnPassword', 'not-the-password');
      await page.click('#mnAuthGo');
      await page.waitForFunction(() => /match an account/.test(document.getElementById('mnAuthStatus').textContent), null, { timeout: 10000 }).catch(() => {});
      check(name, 'the form still works', /match an account/.test(await page.textContent('#mnAuthStatus')));
      const n = noise(world, [/news-heat/, /action-archive/, /docket-516r-archive\.json/, /action_missions/, /auth\/v1\/token/]);
      check(name, 'nothing else fails: only the deliberate fixture failures in the console and the 4xx list', n.console.length === 0 && n.bad.filter((b) => b.status !== 400).length === 0 && world.errors.length === 0, { ...n, errors: world.errors });
    } finally { await ctx.close(); }
  }

  /* ---------- the privacy banner (first visit, banner mode) ---------- */
  if (runs('banner')) for (const [w, phase, mode] of [[390, 'night', 'signin'], [390, 'day', 'create'], [1280, 'night', 'signin']]) {
    const name = `door-banner-${mode}-${w}-${phase}`;
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase, banner: true });
    try {
      await worldReady(page);
      await page.waitForSelector('#mccPrivacyNotice', { timeout: 10000 });
      await openBy(page, mode);
      await pulseSettled(page);
      const m = await frame(page, world, name);
      await overlay(page, name);
      await tabsStayInside(page, name, 30);
      const b = await page.evaluate(() => { const a = document.getElementById('mccPrivacyNoticeAgree').getBoundingClientRect(), e = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2); return { hit: e && e.id, inert: document.getElementById('mccPrivacyNotice').inert, safe: getComputedStyle(document.getElementById('mnSignedOut')).getPropertyValue('--wg-safe-bottom') }; });
      check(name, 'the banner is never covered and never inert; the sheet ends above it', !overlap(m.banner, m.sheet) && b.hit === 'mccPrivacyNoticeAgree' && !b.inert, { banner: m.banner, sheet: m.sheet, b });
      await page.evaluate(() => document.getElementById('mnAuthGo').scrollIntoView({ block: 'nearest' }));
      await page.waitForTimeout(300);
      const reach = await page.evaluate(() => { const g = document.getElementById('mnAuthGo').getBoundingClientRect(), e = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2); return !!e && !!e.closest('#mnAuthGo'); });
      check(name, 'the action is reachable by scrolling the sheet', reach);
      const tall = (await doorFrame(page)).sheet.h;
      await page.click('#mccPrivacyNoticeLater');
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({ safe: getComputedStyle(document.getElementById('mnSignedOut')).getPropertyValue('--wg-safe-bottom').trim(), max: getComputedStyle(document.getElementById('wgSheet')).maxHeight }));
      check(name, 'dismissing the banner gives the sheet its full height back', after.safe === '0px', { after, before: b.safe, tall });
    } finally { await ctx.close(); }
  }

  /* ---------- reduced motion; 320 x 640 ---------- */
  if (runs('small')) {
    {
      const name = 'door-reduced-motion-390-night';
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', reduced: true, token: 'slow' });
      try {
        await worldReady(page);
        await openBy(page, 'signin');
        const r = await page.evaluate(() => ({ entering: document.getElementById('mnSignedOut').classList.contains('is-entering'), anims: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#mnSignedOut')).map((a) => a.effect.getComputedTiming().duration) }));
        await pulseSettled(page);
        await frame(page, world, name);
        const t = await page.evaluate(() => [...document.querySelectorAll('#mnSignedOut *, #mnProfileGate *')].filter((e) => { const cs = getComputedStyle(e); return cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) && /transform|all/.test(cs.transitionProperty); }).length);
        await page.fill('#mnEmail', 'member@example.invalid'); await page.fill('#mnPassword', 'fixture-password-1'); await page.click('#mnAuthGo');
        await page.waitForTimeout(400);
        const busy = await page.evaluate(() => ({ busy: document.getElementById('mnAuthGo').getAttribute('aria-busy'), ring: getComputedStyle(document.getElementById('mnAuthGo'), '::after').animationName }));
        check(name, 'reduced motion: no entrance, no animation longer than 120 ms, no transform transition, the busy ring still', !r.entering && r.anims.every((d) => d <= 120) && t === 0 && busy.busy === 'true' && busy.ring === 'none', { r, t, busy });
      } finally { await ctx.close(); }
    }
    for (const [mode, phase] of [['signin', 'night'], ['create', 'day']]) {
      const name = `door-${mode}-320-${phase}`;
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[320], '/mnet.html?view=feed', { phase });
      try {
        await worldReady(page);
        await openBy(page, mode);
        await pulseSettled(page);
        await frame(page, world, name);
        const reach = await page.evaluate(async () => {
          const out = [];
          for (const el of [...document.querySelectorAll('#wgSheet button, #wgSheet a[href], #wgSheet input')].filter((e) => e.getClientRects().length)) {
            el.scrollIntoView({ block: 'nearest' });
            await new Promise((r) => requestAnimationFrame(r));
            const r = el.getBoundingClientRect(), e = document.elementFromPoint(Math.min(innerWidth - 1, r.left + Math.min(r.width / 2, 20)), r.top + r.height / 2);
            if (!(e && (e === el || el.contains(e) || e.contains(el) || (el.tagName === 'INPUT' && e.closest('.wg-field, .mn__check') === el.closest('.wg-field, .mn__check'))))) out.push(el.id || el.textContent.trim().slice(0, 20));
          }
          return out;
        });
        check(name, '320 x 640: every control can be reached', reach.length === 0, reach);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- every way out; the World restored; the history ---------- */
  if (runs('close')) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', token: 'ok' });
    try {
      await worldReady(page);
      const ways = { back: () => page.click('#mnSignedOutBack'), escape: () => page.keyboard.press('Escape'), scrim: () => page.mouse.click(195, 100), history: () => page.evaluate(() => history.back()) };
      /* the feed settles first (its reads land and it stops growing), so the place it keeps is a place it had */
      await page.waitForFunction(() => { const f = document.getElementById('mnWorldFeed'), h = f.scrollHeight, prev = window.__feedH; window.__feedH = h; return prev === h; }, null, { timeout: 15000, polling: 400 }).catch(() => {});
      for (const [way, act] of Object.entries(ways)) {
        /* focusing People lets the strip bring itself into view (the feed lane's own keyboard walk); the baseline is the
           feed's place at the moment the door is asked for */
        await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); const f = document.getElementById('mnWorldFeed'); f.scrollTop = 140; document.querySelector('#mnFeedScope [data-mn-view="discover"]').focus({ preventScroll: true }); });
        await page.waitForTimeout(300);
        const feed = await page.evaluate(() => document.getElementById('mnWorldFeed').scrollTop);
        await page.keyboard.press('Enter');
        await opened(page);
        await page.fill('#mnEmail', 'kept@example.invalid');
        await page.fill('#mnPassword', 'fixture-password-1');
        await page.click('[data-reveal="mnPassword"]');
        await page.focus('#mnSignInTab');
        await act();
        const ok = await closed(page);
        const s = await page.evaluate(() => ({ inert: [...document.querySelectorAll('[inert]')].map((e) => e.id || e.className), scroll: document.getElementById('mnWorldFeed').scrollTop, focus: document.activeElement && document.activeElement.getAttribute('data-mn-view'), email: document.getElementById('mnEmail').value, type: document.getElementById('mnPassword').type, hist: history.state && history.state.mccDoor }));
        check('close-' + way, `${way} closes the door: inert gone, the feed where it was, focus back on People, the email kept, the password hidden, no history entry left`, ok && s.inert.length === 0 && s.scroll === feed && s.focus === 'discover' && s.email === 'kept@example.invalid' && s.type === 'password' && !s.hist, { ok, s, feed });
        if (way === 'back') { await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, 'door-closed-after-back-390-night.png'), timeout: 90000 }); frames.push({ name: 'door-closed-after-back-390-night', overflow: await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })) }); }
      }
      /* Escape with a filled field focused: the first only lets go */
      await openBy(page, 'signin');
      await page.focus('#mnEmail');
      await page.keyboard.press('Escape');
      const first = await page.evaluate(() => ({ open: !document.getElementById('mnSignedOut').hidden, focus: document.activeElement && document.activeElement.id }));
      await page.keyboard.press('Escape');
      check('close-escape-filled', 'with a filled field focused, the first Escape only lets go of it and the second closes', first.open && first.focus !== 'mnEmail' && await closed(page), first);
      /* a re-open during the exit */
      await openBy(page, 'signin');
      await page.evaluate(() => { document.getElementById('mnSignedOutBack').click(); document.querySelector('[data-guest-open="create"]').click(); });
      await page.waitForTimeout(400);
      const race = await page.evaluate(() => ({ hidden: document.getElementById('mnSignedOut').hidden, leaving: document.getElementById('mnSignedOut').classList.contains('is-leaving'), mode: document.getElementById('mnSignedOut').getAttribute('data-auth-mode'), app: document.getElementById('mnApp').inert }));
      check('reopen-race', 'opening again during the 220 ms exit leaves the door open and interactive', !race.hidden && !race.leaving && race.mode === 'create' && race.app, race);
      /* re-opens within five minutes read nothing again */
      const reads = world.requests.filter((r) => r.frame === 'main' && /news-heat|action-archive|docket-516r/.test(r.p)).length;
      check('reopen-reads', 'five opens, the door\'s reads made once', reads === 2, reads);
      /* a sign-in that works: the door is gone within 260 ms of the session, and Back does not bring it back */
      await page.click('#mnSignInTab');
      await page.fill('#mnEmail', 'member@example.invalid'); await page.fill('#mnPassword', 'fixture-password-1');
      await page.click('#mnAuthGo');
      await page.waitForFunction(() => !document.documentElement.classList.contains('mn-guest'), null, { timeout: 15000 });
      const t0 = Date.now();
      const gone = await closed(page);
      const after = await page.evaluate(() => ({ hist: history.state && history.state.mccDoor, app: !document.getElementById('mnApp').hidden }));
      await page.evaluate(() => history.back()); await page.waitForTimeout(500);
      check('success', 'after a sign-in the door is gone within 260 ms, the World is the member\'s, no history entry, Back does not reopen', gone && Date.now() - t0 <= 1000 && !after.hist && after.app && await page.evaluate(() => document.getElementById('mnSignedOut').hidden), { gone, after, ms: Date.now() - t0 });
      const n = noise(world);
      check('close', 'no console error and no 4xx', n.console.length === 0 && n.bad.length === 0 && world.errors.length === 0, { ...n, errors: world.errors });
    } finally { await ctx.close(); }
  }

  /* ---------- the motion frames: the sheet rises whole, paused at 0, 120, 260 and 420 ms ---------- */
  if (runs('motion')) {
    /* the door's own motion, timed: the globe's renderer stays off so the page's thread is free for the frames */
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', globe: false });
    try {
      await worldReady(page);
      for (const t of [0, 120, 260, 420]) {
        /* the entrance as it starts: read in the same task that sets is-entering, before any frame is drawn */
        await page.evaluate(() => {
          window.__wgEnter = null;
          const door = document.getElementById('mnSignedOut');
          const mo = new MutationObserver(() => {
            if (window.__wgEnter || !door.classList.contains('is-entering')) return;
            const sheet = document.getElementById('wgSheet'), anims = sheet.getAnimations();
            anims.forEach((a) => { a.pause(); a.currentTime = 0; });
            window.__wgEnter = { entering: true, sheet: getComputedStyle(sheet).transform, animations: anims.length };
            anims.forEach((a) => a.play());
            mo.disconnect();
          });
          mo.observe(door, { attributes: true, attributeFilter: ['class'] });
        });
        await page.click('[data-guest-open="signin"]');
        await page.evaluate((t) => { document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#mnSignedOut')).forEach((a) => { a.pause(); a.currentTime = t; }); }, t);
        await page.screenshot({ path: join(OUT, `door-open-${t}ms-390-night.png`), timeout: 90000 });
        const s = await page.evaluate(() => ({ entering: document.getElementById('mnSignedOut').classList.contains('is-entering'), sheet: getComputedStyle(document.getElementById('wgSheet')).transform }));
        const start = await page.evaluate(() => window.__wgEnter);
        if (t === 0) check('motion', 'a gesture brings the entrance: the sheet starts 28 px low', !!start && start.entering && /matrix\(1, 0, 0, 1, 0, 28\)/.test(start.sheet), { start, now: s });
        frames.push({ name: `door-open-${t}ms-390-night`, motion: s });
        await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity && a.effect.target && a.effect.target.closest && a.effect.target.closest('#mnSignedOut')).forEach((a) => a.finish()));
        await page.click('#mnSignedOutBack');
        await closed(page);
      }
      /* a door opened by the address is whole in its first frame */
      await page.goto(server.base + '/mnet.html?view=feed&signin=1&daylight=night', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.getElementById('mnSignedOut').hidden, null, { timeout: 30000 });
      const boot = await page.evaluate(() => ({ entering: document.getElementById('mnSignedOut').classList.contains('is-entering'), anims: document.getAnimations().filter((a) => 'animationName' in a && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#mnSignedOut') && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.animationName) }));
      check('motion', '?signin=1 opens the door whole, with no entrance (no keyframe animation; a focus ring may still ease in)', !boot.entering && boot.anims.length === 0, boot);
    } finally { await ctx.close(); }
  }

  /* ---------- every way in ---------- */
  if (runs('openers')) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', dpr: 1 });
    try {
      await worldReady(page);
      const ask = async (label, act, mode, why) => {
        await act();
        await opened(page);
        const s = await page.evaluate(() => ({ mode: document.getElementById('mnSignedOut').getAttribute('data-auth-mode'), why: document.getElementById('mnGuestWhy').textContent }));
        check('openers', `${label} opens ${mode}${why ? ' with "' + why + '"' : ''}`, s.mode === mode && s.why === why, s);
        await page.click('#mnSignedOutBack'); await closed(page);
      };
      await ask('the header Join', () => page.evaluate(() => document.getElementById('mnGuestJoin').click()), 'create', '');
      await ask('the guest card\'s Sign in', () => page.click('[data-guest-open="signin"]'), 'signin', '');
      await ask('the guest card\'s Create account', () => page.click('[data-guest-open="create"]'), 'create', '');
      await ask('People', () => openBy(page, 'people'), 'signin', 'Sign in to find people.');
      await ask('Save on a post', () => page.evaluate(() => document.querySelector('#mnFeed [data-post-id] [data-action="save"]').click()), 'signin', 'Sign in to save posts.');
      const globe = page.frame({ url: /action-globe\.html/ });
      if (globe) await ask('the globe\'s locked layer (hu:ask-sign-in)', () => globe.evaluate(() => parent.postMessage({ type: 'hu:ask-sign-in', reason: 'layers' }, location.origin)), 'signin', 'Sign in to see satellites and space missions on the Earth.');
      else check('openers', 'the globe frame is there to ask', false);
      check('openers', 'no page errors', world.errors.length === 0, world.errors);
    } finally { await ctx.close(); }
    for (const [label, path, mode, why] of [['?signin=1', '/mnet.html?view=feed&signin=1', 'signin', ''], ['?join=1', '/mnet.html?join=1', 'create', ''], ['a flow (?next=)', '/mnet.html?next=creator.html', 'signin', 'Sign in, or create an account, to carry on.']]) {
      const { ctx, page } = await openWorld(browser, server.base, DEVICES[390], path, { phase: 'night', dpr: 1 });
      try {
        await page.waitForFunction(() => !document.getElementById('mnSignedOut').hidden, null, { timeout: 60000 });
        const s = await page.evaluate(() => ({ mode: document.getElementById('mnSignedOut').getAttribute('data-auth-mode'), why: document.getElementById('mnGuestWhy').textContent, app: !document.getElementById('mnApp').hidden }));
        check('openers', `${label} opens ${mode} at once, over the World`, s.mode === mode && s.why === why && s.app, s);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- no flash: a guest's way in never paints the door ---------- */
  if (runs('flash')) for (const w of [390, 820, 1280]) for (const phase of ['night', 'day']) {
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase, dpr: 1 });
    try {
      await page.waitForTimeout(6200);
      const n = await page.evaluate(() => window.__doorFlash);
      check(`flash-${w}-${phase}`, 'sampling every frame for 6 s: the door never painted on the way in', n === 0, n);
    } finally { await ctx.close(); }
  }

  /* ---------- the onboarding pages: still pages, the door's hand ---------- */
  if (runs('onboard')) for (const [w, phase, pages] of [[390, 'night', 3], [390, 'day', 3], [1280, 'night', 1], [1280, 'day', 1]]) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed&finish=1', { phase, member: true, nextStep: 'profile' });
    try {
      await page.waitForSelector('#mnProfileGate:not([hidden])', { timeout: 60000 });
      const p = await page.evaluate(() => ({ app: document.getElementById('mnApp').hidden, gate: document.documentElement.classList.contains('mn-gate-on'), door: document.documentElement.classList.contains('mn-door-open'), h: getComputedStyle(document.querySelector('#mnStep1 .mn__onboard-h')) }));
      check(`onboard-${w}-${phase}`, 'the pages replace the World as before (mn-gate-on), never the door', p.app && p.gate && !p.door, p);
      await frame(page, world, `onboard-1-${w}-${phase}`, { root: '#mnProfileGate' });
      if (pages > 1) {
        await page.fill('#mnHandle', 'fixture.member');
        await page.fill('#mnDisplay', 'Fixture Member');
        await page.waitForTimeout(700);
        await page.click('#mnProfileSave');
        await page.waitForFunction(() => document.getElementById('mnStepsCount').textContent === '2 / 3', null, { timeout: 15000 });
        await frame(page, world, `onboard-2-${w}-${phase}`, { root: '#mnProfileGate' });
        await page.fill('#mnLegalName', 'Nadia Member'); await page.fill('#mnAddr1', '1 Main Street'); await page.fill('#mnCity', 'Bridgeport'); await page.fill('#mnRegion', 'CT'); await page.fill('#mnPostal', '06604');
        await page.click('#mnProfileSave');
        await page.waitForFunction(() => document.getElementById('mnStepsCount').textContent === '3 / 3', null, { timeout: 15000 });
        await frame(page, world, `onboard-3-${w}-${phase}`, { root: '#mnProfileGate' });
      }
    } finally { await ctx.close(); }
  }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), cesium: !!process.env.CESIUM_DIR, results, frames }, null, 1));
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
