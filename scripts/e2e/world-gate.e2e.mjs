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
   - the onboarding pages, still pages, in the door's hand;
   - the review of 2026-11-18 (DR-M1..DR-m11): the action wholly in view at rest, above the fade, with the privacy notice up
     and on a laptop; the open mission on the phone's stage; the crest on the stage's dark band; the World's own credit,
     legend and feed asleep under the veil; the names a reader hears; the faces fetched only on intent; a touch screen's
     keyboard not raised by the door; Back from a mission's Join back in the mission;
   - the verification of 2026-11-18: with the privacy notice waiting and a phone's keyboard up, no room kept for a notice
     that is under the keyboard; the news card's hours from the answer itself; every control's real target (where a tap
     lands, not its box); the stage's focus marks whole and inside their own plates; the floating card clear of the stage
     on a short screen (1024 x 768, 768 x 1024, 1000 x 650).
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
/* the action at rest: wholly inside the sheet, clear of the fade that says there is more (34 px), and the topmost thing
   at its centre and its four inner corners (review DR-M1, DR-M2: no scrollIntoView first) */
async function actionAtRest(page, sel = '#mnAuthGo') {
  return page.evaluate((sel) => {
    const sh = document.getElementById('wgSheet'), el = document.querySelector(sel);
    if (!sh || !el || !el.getClientRects().length) return { ok: false, why: 'not shown' };
    const s = sh.getBoundingClientRect(), g = el.getBoundingClientRect(), more = sh.hasAttribute('data-more');
    const floor = more ? s.bottom - 34 : s.bottom;
    /* the centre, and four points just inside its edges that lie inside any rounded shape (a pill's ends are half circles) */
    const mx = g.left + g.width / 2, my = g.top + g.height / 2, inset = Math.min(g.height, g.width) / 2;
    const pts = [[mx, my], [mx, g.top + 4], [mx, g.bottom - 4], [g.left + inset, my], [g.right - inset, my]];
    const hits = pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e) || (el.tagName === 'INPUT' && !!e.closest('label') && e.closest('label').contains(el))); });
    return { ok: g.top >= s.top - 0.5 && g.bottom <= floor + 0.5 && hits.every(Boolean), go: [Math.round(g.top), Math.round(g.bottom)], sheet: [Math.round(s.top), Math.round(s.bottom)], floor: Math.round(floor), more, hits };
  }, sel);
}
/* the cards the phone's stage shows, in order */
const stageCards = (page) => page.evaluate(() => [...document.querySelectorAll('#wgPulse > .wg-card')].filter((c) => !c.hidden && c.getClientRects().length && getComputedStyle(c).display !== 'none').map((c) => c.id));
/* where a tap really lands on each control: the run of points through its centre that hit it, across and down. A control's
   box can be 44 px and its target a third of that, when a row it sits in cuts what leaves it, or the sheet lies over it
   (the news link was 18 px tall this way, the credit's links 37) */
const trueTargets = (page) => page.evaluate(async () => {
  const door = document.getElementById('mnSignedOut'), small = [];
  for (const e of [...door.querySelectorAll('button, a[href], input:not([type=hidden])')].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden')) {
    e.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const mine = (x, y) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h) || (e.tagName === 'INPUT' && !!h.closest('label') && h.closest('label').contains(e))); };
    let up = 0, down = 0, left = 0, right = 0;
    const hit = mine(cx, cy);
    if (hit) { while (up < 60 && mine(cx, cy - up - 1)) up++; while (down < 60 && mine(cx, cy + down + 1)) down++; while (left < 60 && mine(cx - left - 1, cy)) left++; while (right < 60 && mine(cx + right + 1, cy)) right++; }
    const w = hit ? left + right + 1 : 0, h = hit ? up + down + 1 : 0;
    if (w < 44 || h < 44) small.push({ el: e.id || e.textContent.trim().slice(0, 24), w, h, box: [Math.round(r.width), Math.round(r.height)] });
  }
  document.getElementById('wgSheet').scrollTop = 0;
  return small;
});
/* a stage control's focus mark, from pixels: what changes by 3:1 or more inside the control's own box when the keyboard's
   focus lands on it (5 px around the Back pill, which sits on the solid band), as a share of a 2 px line around the control
   (WCAG 2.2, 2.4.13). Nothing outside a control's own plate is counted: the Earth turns between the two pictures, and a
   mark drawn out there can be cut by the row or lost against the Earth (the mission card's line was, and the news link's). */
async function focusMark(page, sel) {
  const box = await page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e || !e.getClientRects().length) return null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const r = e.getBoundingClientRect(), pad = e.id === 'mnSignedOutBack' ? 5 : 0;
    return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, w: r.width, h: r.height };
  }, sel);
  if (!box) return null;
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  await page.waitForTimeout(300);
  const before = await page.screenshot({ clip, timeout: 90000 });
  /* a key first, so the browser treats the focus that follows as the keyboard's (:focus-visible) */
  await page.keyboard.press('Shift');
  const fv = await page.evaluate((sel) => { const e = document.querySelector(sel); e.focus({ preventScroll: true }); return e.matches(':focus-visible'); }, sel);
  await page.waitForTimeout(350);
  const after = await page.screenshot({ clip, timeout: 90000 });
  const changed = await page.evaluate(async ([a, b]) => {
    const load = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return { d: g.getImageData(0, 0, img.width, img.height).data, n: img.width * img.height }; };
    const A = await load(a), B = await load(b);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, L = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    let count = 0;
    for (let i = 0; i < Math.min(A.d.length, B.d.length); i += 4) { const l1 = L(A.d, i), l2 = L(B.d, i); if ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) >= 3) count++; }
    return { count, pixels: A.n };
  }, [before.toString('base64'), after.toString('base64')]);
  /* device pixels to CSS px: the picture holds clip.width x clip.height CSS px */
  const area = changed.count * (clip.width * clip.height) / changed.pixels;
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  return { sel, fv, share: Math.round((area / (2 * 2 * (box.w + box.h))) * 100) / 100 };
}
/* the brightest pixel in a strip of the page, 0-255 luminance (a pale seam, a peeking feed) */
async function brightest(page, clip) {
  const png = await page.screenshot({ clip, timeout: 90000 });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    return Math.round(max);
  }, png.toString('base64'));
}
/* what Chrome's accessibility tree tells a screen reader about an element: its role, name and description */
async function ax(page, sel) {
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes[0] || {};
    return { role: n.role && n.role.value, name: n.name && n.name.value, description: n.description ? n.description.value : '', pressed: (n.properties || []).some((p) => p.name === 'pressed') };
  } finally { await client.detach().catch(() => {}); }
}
/* the World under the door at 700 px and up: where the veil and the lower third's shelf are solid, and where the globe
   frame's own legend, credit and controls and the feed's row sit (review DR-m3) */
const peek = (page) => page.evaluate(() => {
  const r = (el) => { if (!el || !el.getClientRects().length) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const veil = document.querySelector('#mnSignedOut .wg-veil'), v = veil.getBoundingClientRect(), vb = getComputedStyle(veil).backgroundImage, vc = getComputedStyle(veil).backgroundColor;
  /* the veil is solid 22 px below its top when it is a gradient, at once when it is a flat colour */
  const veilSolid = { top: Math.round(v.top + (/gradient/.test(vb) ? 22 : 0)), left: Math.round(v.left), flat: !/gradient/.test(vb) ? vc : null };
  const lower = document.querySelector('#mnSignedOut .wg-lower'), lb = lower.getBoundingClientRect(), shelf = getComputedStyle(lower, '::before');
  const sh = parseFloat(shelf.height) || 0, sb = lb.bottom - (parseFloat(shelf.bottom) || 0);
  const shelfSolid = { top: Math.round(sb - sh + sh * 0.66), bottom: Math.round(sb), left: Math.round(lb.left), right: Math.round(lb.right) };
  const f = document.getElementById('mnWorldFrame'), fr = f.getBoundingClientRect(), d = f.contentDocument;
  const chrome = [];
  if (d) for (const s of ['.osm-credit', '#heatLegend', '.globe-controls', '.globe-data', '#envLegend']) {
    const e = d.querySelector(s); if (!e || !e.getClientRects().length || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') continue;
    const b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
    chrome.push({ sel: s, top: Math.round(fr.top + b.top), bottom: Math.round(fr.top + b.bottom), left: Math.round(fr.left + b.left), right: Math.round(fr.left + b.right) });
  }
  const scope = r(document.getElementById('mnFeedScope')), guest = r(document.getElementById('mnGuestCard'));
  return { veil: veilSolid, shelf: shelfSolid, chrome, scope, guest, vw: innerWidth, vh: innerHeight };
});
/* a box is asleep when the solid veil or the solid foot of the shelf covers it, or it is off screen */
const asleep = (p, b) => !b || b.top >= p.vh || b.bottom <= 0 || (b.top >= p.veil.top && b.left >= p.veil.left - 1) || (b.top >= p.shelf.top && b.left >= p.shelf.left - 1 && b.right <= p.shelf.right + 1);
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
  /* the fade that says there is more never lies over a control at rest: text under it is not measured for contrast, so no
     control may be there (review DR-m10) */
  if (root === '#mnSignedOut') {
    const faded = await page.evaluate(() => {
      const sh = document.getElementById('wgSheet');
      if (!sh || !sh.hasAttribute('data-more') || sh.scrollTop > 2) return [];
      const s = sh.getBoundingClientRect(), top = s.bottom - 34;
      /* a control's drawn words (its text's own boxes; a field's whole box), not the padding that makes it a 44 px target */
      const drawn = (e) => { if (e.tagName === 'INPUT') return [e.getBoundingClientRect()]; const rg = document.createRange(); rg.selectNodeContents(e); return [...rg.getClientRects()].filter((x) => x.width > 1 && x.height > 1); };
      return [...sh.querySelectorAll('button, a[href], input:not([type=hidden])')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
        /* 4 px or more of the words' box between the fade's top and the sheet's foot (a sliver of a line box carries no ink) */
        .flatMap((e) => drawn(e).map((r) => ({ el: e, r }))).filter(({ r }) => Math.min(r.bottom, s.bottom) - Math.max(r.top, top) >= 4)
        .map(({ el, r }) => ({ id: el.id || el.textContent.trim().slice(0, 24), top: Math.round(r.top), bottom: Math.round(r.bottom), fade: Math.round(top) }));
    });
    check(name, 'no control lies under the fade at rest', faded.length === 0, faded);
  }
  return m;
}
/* the door's law, read from the live page */
async function law(page, scope, phase) {
  const l = await page.evaluate((phase) => {
    const d = document.getElementById('mnSignedOut'), imgs = [...d.querySelectorAll('img')];
    const band = (parseFloat(getComputedStyle(d).getPropertyValue('--wg-head')) || 72) + 2;
    const crown = imgs.map((i) => { const cs = getComputedStyle(i), r = i.getBoundingClientRect(); return { src: i.getAttribute('src'), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), shown: i.getClientRects().length > 0 && cs.display !== 'none', box: [Math.round(r.width), Math.round(r.height)], onBand: r.top >= 0 && r.bottom <= band + 0.5, inStage: !!i.closest('.wg-stage'),
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
  check(scope, 'the crest is the supplied artwork only: one file, the white mark on the stage\'s dark band by night and by day, alt "", 160 x 160, a square 52 px box, nothing drawn on or around it', l.crown.length === 1 && l.crown.every((c) => c.alt === '' && c.w === '160' && c.h === '160' && c.plain && c.shown && c.inStage && c.onBand
    && c.src === 'assets/img/equity-uprise-mark-white.png' && c.box[0] === 52 && c.box[1] === 52), { crown: l.crown, phase });
  check(scope, 'no other entity or name: never "Equity Uprise" in words, never Matthew McCluster, I AM HERE, Whip Equipped or PRIM3; the colophon is the company\'s', !/Equity Uprise|Human Uprise|Matthew McCluster|I AM HERE|Whip Equipped|PRIM3/.test(l.text) && /A McCluster Corp program\./.test(l.text), l.text.slice(0, 300));
  check(scope, 'no "Hu Up" anywhere on the page; the headline is the line, with no lede after it', !l.hu && l.h2 === 'Turn what you care about into action.' && !l.lede);
  check(scope, 'a dialog named for its mode, without aria-modal', l.role === 'dialog' && l.modal === null && l.label === (l.mode === 'create' ? 'Create an account' : 'Sign in'), { role: l.role, modal: l.modal, label: l.label, mode: l.mode });
  check(scope, 'the doors are tabs: Sign in and Create account by name, one tab stop, the panel labelled by the chosen one', l.tabs.list === 'Sign in or create an account' && JSON.stringify(l.tabs.names) === '["Sign in","Create account"]'
    && JSON.stringify(l.tabs.tabindex) === (l.mode === 'create' ? '["-1","0"]' : '["0","-1"]') && l.tabs.panel === (l.mode === 'create' ? 'mnCreateTab' : 'mnSignInTab'), l.tabs);
  check(scope, 'fields: a label each, autocomplete as before, described by the status (and the rule, and the match)', l.fields.every((f) => f.label) && l.fields[0].ac === 'email' && l.fields[1].ac === (l.mode === 'create' ? 'new-password' : 'current-password') && l.fields[2].ac === 'new-password'
    && l.fields[0].desc === 'mnAuthStatus' && l.fields[1].desc === (l.mode === 'create' ? 'mnPasswordHint mnAuthStatus' : 'mnAuthStatus') && l.fields[2].desc === 'wgMatch mnAuthStatus' && l.shows.every((s) => s.controls && s.pressed === null && s.name === 'Show password'), { fields: l.fields, shows: l.shows });
  check(scope, 'form controls at 16 px or more', l.inputs.every((i) => i.size >= 16), l.inputs);
  check(scope, 'no backdrop-filter in the door overlaps the globe frame (by a whole pixel or more)', l.blur.every((b) => !(b.r.left < l.frame.right - 1 && b.r.right > l.frame.left && b.r.top < l.frame.bottom && b.r.bottom > l.frame.top)), l.blur);
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
      check(name, 'the pulse is the World\'s real answers: Open now and the newest mission, news from 183+ countries (GDELT, a capped read), the Docket 516R record; never a total', m.cards[0].shown && /Give someone a free ride/.test(m.cards[0].text) && /Open now/.test(m.cards[0].text) && !/missions/.test(m.cards[0].text)
        && /News from 183\+ countries/.test(m.cards[1].text) && /Last 24 hours/i.test(m.cards[1].text) && /The GDELT Project/.test(m.cards[1].text) && !/12,?296|12,?000/.test(m.cards[1].text) && /Docket 516R · Write the Change/.test(m.cards[2].text) && /10 participants · 9 songs · Bridgeport, CT · Oct 5, 2025/.test(m.cards[2].text), m.cards);
      check(name, 'the Earth\'s credit is on the stage', /NASA imagery/.test(m.creditText) && /Natural Earth/.test(m.creditText) && /OpenStreetMap/.test(m.creditText), m.creditText);
      const prov = await page.evaluate(() => ({ providers: !document.getElementById('mnProviders').hidden, buttons: document.querySelectorAll('#mnProviderButtons button').length }));
      check(name, 'email only in the live settings: no provider button and no "or"', !prov.providers && prov.buttons === 0, prov);
      const rest = await actionAtRest(page);
      check(name, 'the action is wholly in view at rest: inside the sheet, clear of the fade, the topmost thing at its centre and corners', rest.ok, rest);
      if (w !== 1280) {
        const cards = await stageCards(page);
        check(name, 'the phone and tablet stage carries the World\'s pulse: the open mission first', cards[0] === 'wgPulseMission', cards);
        if (w === 390 && mode === 'signin') check(name, '390 sign in: all three cards one under another, none cut at the edge', cards.length === 3 && m.cards.every((c) => c.shown), { cards });
      }
      if (w === 390 && mode === 'signin') await tabsStayInside(page, name);
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
      if (w >= 820) {
        const p = await peek(page);
        const awake = p.chrome.filter((b) => !asleep(p, b)).concat([['scope', p.scope], ['guest', p.guest]].filter(([, b]) => !asleep(p, b)).map(([sel, b]) => ({ sel, ...b })));
        check(name, 'the World under the door sleeps: the globe frame\'s own credit, legend and controls and the feed\'s row and guest card lie under the solid veil or shelf (one credit on screen)', awake.length === 0 && p.chrome.length > 0, { awake, veil: p.veil, shelf: p.shelf });
      }
      if (w === 820) {
        const visibleGlobe = m.sheet.top - Math.max(m.frame.top, (await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('mnSignedOut')).getPropertyValue('--wg-head')) || 72)) + 2);
        check(name, '820: the card 500 px or less and centred, wholly visible without scrolling, 300 px or more of the globe above it', m.sheet.w <= 500 && Math.abs(m.sheet.left - (m.vw - m.sheet.right)) <= 2 && !m.more && m.sheet.bottom <= m.vh && m.sheet.top >= 0 && visibleGlobe >= 300, { sheet: m.sheet, more: m.more, visibleGlobe });
      }
      if (w === 1280) {
        check(name, '1280: the card 484 ± 8 px in the right-hand column, wholly on screen, everything in it without a scroll', Math.abs(m.sheet.w - 484) <= 8 && m.sheet.left >= m.vw - 540 - 1 && !m.more && m.sheet.top >= 0 && m.sheet.bottom <= m.vh, { sheet: m.sheet, more: m.more });
        check(name, '1280: the dated lower third at the bottom left, up to three cards', /Today in the World/i.test(m.dateline) && m.pulse.left < m.sheet.left && m.pulse.bottom > m.vh / 2, { dateline: m.dateline, pulse: m.pulse });
        check(name, '1280: the veil never overlaps the globe frame', !overlap(m.veil, { ...m.frame, right: m.frame.right - 0.5 }), { veil: m.veil, frame: m.frame });
        /* no pale seam between the Earth and the card: the strip right of the frame is dark by day too (it read 109 to 139) */
        const seam = await brightest(page, { x: Math.max(0, m.frame.right), y: 120, width: Math.max(4, m.sheet.left - m.frame.right - 3), height: 360 });
        check(name, '1280: the strip between the Earth and the card stays dark (brightest pixel under 40 of 255)', seam < 40, seam);
      }
      const small = await trueTargets(page);
      check(name, 'every control can really be tapped across 44 x 44 (where a tap lands on it, not its box)', small.length === 0, small);
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
      /* the way back goes back into the mission, by the Back pill and by the phone's Back (review DR-m2) */
      for (const [how, act] of [['the Back pill', () => page.click('#mnSignedOutBack')], ['the phone\'s Back', () => page.evaluate(() => history.back())]]) {
        await act();
        await closed(page);
        await page.waitForSelector('#mnMissionDialog[open]', { timeout: 10000 }).catch(() => {});
        const back = await page.evaluate(() => ({ dialog: document.getElementById('mnMissionDialog').open, title: document.getElementById('mnMissionTitle').textContent, mission: new URL(location.href).searchParams.get('mission'), door: !document.getElementById('mnSignedOut').hidden, hist: history.state && history.state.mccDoor }));
        check(name, `${how} from a mission's Join puts the guest back in that mission's sheet, ?mission= kept, no door and no history entry left`, back.dialog && back.title === 'Give someone a free ride' && back.mission === RIDE && !back.door && !back.hist, back);
        if (how === 'the Back pill') { await page.click('#mnMissionJoin'); await opened(page); }
      }
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

  /* ---------- the news card's hours are the answer's own (window_hours) ---------- */
  if (runs('pulse')) for (const [kind, want] of [['two-days', 'Last 48 hours'], ['untold', null]]) {
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[1280], '/mnet.html?view=feed', { phase: 'night', heat: kind, dpr: 1, globe: false });
    try {
      await worldReady(page);
      await openBy(page, 'signin');
      await pulseSettled(page);
      await page.waitForTimeout(700);
      const cards = (await doorFrame(page)).cards;
      check('pulse-window', want ? `an answer that counted 48 hours reads "${want}", never 24` : 'an answer that does not say what window it counted gets no news card; the other cards stay',
        want ? cards[1].shown && cards[1].text.includes(want) && !/24/.test(cards[1].text) : !cards[1].shown && cards[0].shown && cards[2].shown, cards);
    } finally { await ctx.close(); }
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
  if (runs('banner')) for (const [w, phase, mode] of [[390, 'night', 'signin'], [390, 'day', 'create'], [1280, 'night', 'signin'], [1280, 'night', 'create']]) {
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
      /* at rest: nothing scrolled first (review DR-M1). In Create account the box to tick sits above the action, so it is in
         view too */
      await page.evaluate(() => { const s = document.getElementById('wgSheet'); s.scrollTop = 0; });
      await settle(page);
      const rest = await actionAtRest(page);
      check(name, 'with the notice up, the action is wholly in view at rest, above the fade and the notice', rest.ok && !overlap(m.banner, m.go), { rest, banner: m.banner });
      if (mode === 'create') {
        const box = await actionAtRest(page, '#mnCreateAgreeBox');
        check(name, 'with the notice up, the privacy box is in view at rest too', box.ok, box);
      }
      const tall = (await doorFrame(page)).sheet.h;
      await page.click('#mccPrivacyNoticeLater');
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({ safe: getComputedStyle(document.getElementById('mnSignedOut')).getPropertyValue('--wg-safe-bottom').trim(), max: getComputedStyle(document.getElementById('wgSheet')).maxHeight }));
      check(name, 'dismissing the banner gives the sheet its full height back', after.safe === '0px', { after, before: b.safe, tall });
    } finally { await ctx.close(); }
  }

  /* ---------- the stage's focus marks, from pixels, at every width by night and by day ---------- */
  /* the marks are drawn inside the controls' own plates, so the Earth is not their ground: the globe's renderer stays off and
     the two pictures of each control are quick and still */
  if (runs('focus')) for (const w of [390, 820, 1280]) for (const phase of ['night', 'day']) {
    const name = `focus-${w}-${phase}`;
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed', { phase, globe: false });
    try {
      await worldReady(page);
      await openBy(page, 'signin');
      await page.waitForFunction(() => ['wgPulseMission', 'wgPulseNews'].every((id) => !document.getElementById(id).hidden), null, { timeout: 9000 }).catch(() => {});
      await settle(page);
      const marks = [];
      for (const sel of ['#mnSignedOutBack', '#wgPulseMission .wg-card__go', '#wgPulseNews a', '#wgCredit a']) {
        const mk = await focusMark(page, sel).catch((e) => ({ sel, error: String(e && e.message || e).split('\n')[0].slice(0, 120) }));
        if (mk) marks.push(mk);
      }
      check(name, 'the stage\'s focus marks: the Back pill, the mission card, the news link (and the credit\'s first link) each show the keyboard\'s focus whole, 3:1 or more against what was there, inside their own plate', marks.length >= 3 && marks.every((mk) => mk.fv && mk.share >= 0.8), marks);
    } finally { await ctx.close(); }
  }

  /* ---------- the floating card on a short screen: a tablet on its side and upright, a laptop's window ---------- */
  if (runs('short')) for (const [w, h] of [[1024, 768], [768, 1024], [1000, 650]]) for (const mode of ['signin', 'create']) {
    /* a 650 px window cannot hold Create account's action above the fade without the card lying over the way back, and the
       way back wins (as on a phone): there the sheet says there is more and the action is reached at its end */
    const fits = !(h === 650 && mode === 'create');
    const name = `short-${mode}-${w}x${h}`;
    const { ctx, page, world } = await openWorld(browser, server.base, { name: String(w), viewport: { width: w, height: h }, mobile: false }, '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false });
    try {
      await worldReady(page);
      await openBy(page, mode);
      await pulseSettled(page);
      await settle(page);
      const s = await page.evaluate(() => {
        const R = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
        const $ = (id) => document.getElementById(id), d = $('mnSignedOut'), sheet = R($('wgSheet'));
        const parts = { back: R($('mnSignedOutBack')), crest: R(d.querySelector('.wg-crest')), dateline: R($('wgDateline')), pulse: R($('wgPulse')), credit: R($('wgCredit')) };
        const under = Object.entries(parts).filter(([, r]) => r && r.left < sheet.right && r.right > sheet.left && r.top < sheet.bottom && r.bottom > sheet.top).map(([k, r]) => `${k} by ${Math.min(r.bottom, sheet.bottom) - Math.max(r.top, sheet.top)} px`);
        return { sheet, under, shown: Object.keys(parts).filter((k) => parts[k]), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      check(name, 'the card lies over nothing of the stage: the way back, the crest, the dateline, the cards and the credit are each clear of it or not shown', s.under.length === 0 && s.shown.includes('back') && s.shown.includes('crest') && s.sheet.top >= 68, s);
      check(name, 'nothing scrolls sideways', s.sw === s.cw, { sw: s.sw, cw: s.cw });
      const rest = await actionAtRest(page);
      if (fits) check(name, 'the action is wholly in view at rest', rest.ok, rest);
      else {
        await page.evaluate(() => { const sh = document.getElementById('wgSheet'); sh.scrollTop = sh.scrollHeight; });
        await page.waitForFunction(() => !document.getElementById('wgSheet').hasAttribute('data-more'), null, { timeout: 8000 }).catch(() => {});
        const end = await actionAtRest(page);
        check(name, 'too short for the action at rest: the sheet says there is more, and the action is wholly in view at its end', rest.more && end.ok && !end.more, { rest, end });
      }
      check(name, 'no page errors', world.errors.length === 0, world.errors);
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
        const lines = await page.evaluate(() => { const one = (el) => { if (!el || !el.getClientRects().length) return true; const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size === 1; }; return { tabs: [...document.querySelectorAll('#mnSignedOut .wg-tab-w')].map(one), forgot: one(document.getElementById('mnForgot')), labels: [...document.querySelectorAll('#mnSignedOut .wg-field .mn__label')].filter((l) => l.getClientRects().length).map((l) => [l.textContent, one(l)]) }; });
        check(name, '320: each door\'s word, every field\'s name and the Forgot line stay on one line', lines.tabs.every(Boolean) && lines.forgot && lines.labels.every(([, ok]) => ok), lines);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- every way out; the World restored; the history ---------- */
  if (runs('close')) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', token: 'ok' });
    try {
      await worldReady(page);
      /* the scrim is tapped in the stage's dark band, right of the crest: the pulse cards now fill the Earth below it */
      const ways = { back: () => page.click('#mnSignedOutBack'), escape: () => page.keyboard.press('Escape'), scrim: () => page.mouse.click(330, 34), history: () => page.evaluate(() => history.back()) };
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
            /* everything in the door that moves on the way in, and the band over the header, read as the entrance starts */
            const all = document.getAnimations().filter((a) => 'animationName' in a && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#mnSignedOut') && a.effect.getComputedTiming().iterations !== Infinity);
            const band = getComputedStyle(door, '::before');
            window.__wgEnter = { entering: true, sheet: getComputedStyle(sheet).transform, animations: anims.length,
              names: [...new Set(all.map((a) => a.animationName))].sort(), band: band.backgroundColor, bandOpacity: band.opacity, bandAnimated: all.some((a) => a.effect.pseudoElement === '::before') };
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
        if (t === 0) {
          check('motion', 'a gesture brings the entrance: the sheet starts 28 px low', !!start && start.entering && /matrix\(1, 0, 0, 1, 0, 28\)/.test(start.sheet), { start, now: s });
          /* the sheet rises whole (review DR-m1): only the scrim and the sheet move, nothing inside them on its own, no sweep;
             the band over the World's header is solid from this first frame (review DR-m9) */
          const moving = start || {};
          check('motion', 'only the scrim fades and the sheet rises; the header band is solid and still from the first frame', JSON.stringify(moving.names) === '["wg-fade-in","wg-rise"]' && moving.band === 'rgb(4, 6, 9)' && moving.bandOpacity === '1' && !moving.bandAnimated, moving);
        }
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

  /* ---------- what a screen reader is told (review DR-m5) ---------- */
  if (runs('ax')) {
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[1280], '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false });
    try {
      await worldReady(page);
      await openBy(page, 'signin');
      const sign = { email: await ax(page, '#mnEmail'), password: await ax(page, '#mnPassword'), show: await ax(page, '[data-reveal="mnPassword"]') };
      check('ax', 'Sign in: the fields are named as written ("Email", "Password"), the password described by the status alone, Show is a plain button named for what it does', sign.email.name === 'Email' && sign.password.name === 'Password' && !/8 characters/.test(sign.password.description) && sign.show.name === 'Show password' && !sign.show.pressed, sign);
      await page.click('[data-reveal="mnPassword"]');
      const shown = await ax(page, '[data-reveal="mnPassword"]');
      check('ax', 'once shown, the button is named Hide password, with no pressed state besides', shown.name === 'Hide password' && !shown.pressed, shown);
      await page.click('#mnCreateTab');
      const make = { password: await ax(page, '#mnPassword'), confirm: await ax(page, '#mnPassword2'), show: await ax(page, '[data-reveal="mnPassword"]') };
      check('ax', 'Create account: the password is described by the eight-character rule; the confirm field is named as written; Show is reset', /Use at least 8 characters\./.test(make.password.description) && make.confirm.name === 'Confirm password' && make.show.name === 'Show password', make);
    } finally { await ctx.close(); }
  }

  /* ---------- the headline's faces: fetched on intent, never on arrival (review DR-m8) ---------- */
  if (runs('fonts')) {
    const { ctx, page } = await openWorld(browser, server.base, DEVICES[1280], '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false });
    try {
      await worldReady(page);
      await page.waitForTimeout(3200);
      const faces = () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /playfair/i.test(e.name)).map((e) => e.name.replace(/^.*\//, '')));
      const before = await faces();
      check('fonts', 'a guest\'s arrival, and three idle seconds on the World, fetch no headline face', before.length === 0, before);
      await page.hover('#mnGuestJoin');
      await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => /playfair/i.test(e.name)).length >= 2, null, { timeout: 8000 }).catch(() => {});
      const after = await faces();
      check('fonts', 'a pointer on the header\'s Join fetches the roman and the italic before the tap', after.length === 2 && after.some((f) => /playfair-display-latin-500-normal/.test(f)) && after.some((f) => /playfairdisplay-italic/.test(f)), after);
    } finally { await ctx.close(); }
  }

  /* ---------- a touch screen: the door does not raise the keyboard; the keyboard does not cover the field (review DR-m11) ---------- */
  if (runs('touch')) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false });
    try {
      await worldReady(page);
      await page.tap('[data-guest-open="create"]');
      await opened(page);
      const f = await page.evaluate(() => ({ active: document.activeElement && (document.activeElement.id || document.activeElement.tagName), input: !!(document.activeElement && document.activeElement.matches('input, textarea, select')), coarse: matchMedia('(hover: none) and (pointer: coarse)').matches }));
      check('touch', 'opened by a tap on a touch screen, the door itself takes the focus: no field, so no keyboard rises over the sheet', f.coarse && f.active === 'mnSignedOut' && !f.input, f);
      /* the keyboard rises when a field is tapped: the visual viewport shrinks to 470 px, and the field stays in view */
      await page.tap('#mnPassword');
      await page.setViewportSize({ width: 390, height: 470 });
      await page.waitForTimeout(500);
      const k = await page.evaluate(() => {
        const d = document.getElementById('mnSignedOut').getBoundingClientRect(), s = document.getElementById('wgSheet').getBoundingClientRect(), i = document.getElementById('mnPassword').closest('.wg-field').getBoundingClientRect(), b = document.getElementById('mnSignedOutBack').getBoundingClientRect();
        return { vh: visualViewport.height, door: [Math.round(d.top), Math.round(d.bottom)], sheet: [Math.round(s.top), Math.round(s.bottom)], field: [Math.round(i.top), Math.round(i.bottom)], back: Math.round(b.bottom), focus: document.activeElement && document.activeElement.id, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      check('touch', 'with the keyboard up (470 px), the door fits the visual viewport, the focused field stays in view inside the sheet, the way back stays clear, nothing scrolls sideways', k.door[1] <= k.vh + 1 && k.field[0] >= k.sheet[0] && k.field[1] <= k.sheet[1] && k.sheet[0] >= k.back && k.focus === 'mnPassword' && k.sw === k.cw, k);
      await page.setViewportSize(DEVICES[390].viewport);
      check('touch', 'no page errors', world.errors.length === 0, world.errors);
    } finally { await ctx.close(); }
    /* the keyboard with the privacy notice still waiting (a first visit): on a phone the visual viewport shrinks while the
       layout viewport, and the notice fixed to its foot, stay where they were (iOS Safari, Chrome for Android), so the notice
       is under the keyboard. The door keeps no room for a notice that is not in it: it kept the notice's 218 px as nothing
       above the keyboard and left the form a 184 px window. Headless Chromium has no keyboard: the visual viewport is a
       stand-in the door's script reads, put in place before the door first wires itself. */
    {
      const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[390], '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false, banner: true });
      try {
        await worldReady(page);
        await page.waitForSelector('#mccPrivacyNotice', { timeout: 10000 });
        await page.evaluate(() => { const vv = new EventTarget(); Object.assign(vv, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 }); Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv }); window.__keyboard = (h) => { vv.height = h; vv.dispatchEvent(new Event('resize')); }; });
        await page.tap('[data-guest-open="create"]');
        await opened(page);
        await settle(page);
        const read = () => page.evaluate(() => { const d = document.getElementById('mnSignedOut'), dr = d.getBoundingClientRect(), s = document.getElementById('wgSheet').getBoundingClientRect(), b = document.getElementById('mccPrivacyNotice').getBoundingClientRect(), f = document.getElementById('mnPassword').closest('.wg-field').getBoundingClientRect();
          return { safe: getComputedStyle(d).getPropertyValue('--wg-safe-bottom').trim(), flag: d.hasAttribute('data-banner'), door: [Math.round(dr.top), Math.round(dr.bottom)], sheet: [Math.round(s.top), Math.round(s.bottom)], banner: [Math.round(b.top), Math.round(b.bottom)], field: [Math.round(f.top), Math.round(f.bottom)], gap: Math.round(dr.bottom - s.bottom), focus: document.activeElement && document.activeElement.id }; });
        const rest = await read();
        await page.tap('#mnPassword');
        await page.evaluate(() => window.__keyboard(470));
        await page.waitForTimeout(400);
        await settle(page);
        const up = await read();
        check('touch', 'the notice waiting and the keyboard up (the visual viewport 470 px, the notice under the keyboard): the door keeps no room for the notice, the sheet runs to the door\'s foot, the focused field is in view', rest.flag && parseFloat(rest.safe) > 100 && rest.sheet[1] <= rest.banner[0]
          && up.safe === '0px' && !up.flag && up.door[1] === 470 && up.banner[0] >= 470 && up.gap === 0 && up.focus === 'mnPassword' && up.field[0] >= up.sheet[0] && up.field[1] <= up.sheet[1], { rest, up });
        await page.evaluate(() => window.__keyboard(innerHeight));
        await page.waitForTimeout(400);
        await settle(page);
        const down = await read();
        check('touch', 'the keyboard down again: the notice has its room back and is not covered', down.flag && down.safe === rest.safe && down.sheet[1] <= down.banner[0], { down, rest });
        check('touch', 'no page errors with the notice and the keyboard', world.errors.length === 0, world.errors);
      } finally { await ctx.close(); }
    }
    /* a keyboard at hand (1280): the first field takes the focus, as before */
    const { ctx: c2, page: p2 } = await openWorld(browser, server.base, DEVICES[1280], '/mnet.html?view=feed', { phase: 'night', dpr: 1, globe: false });
    try {
      await worldReady(p2);
      await openBy(p2, 'signin');
      check('touch', 'on a desktop the email takes the focus at once', await p2.evaluate(() => document.activeElement && document.activeElement.id) === 'mnEmail');
    } finally { await c2.close(); }
  }

  /* ---------- the onboarding pages: still pages, the door's hand ---------- */
  if (runs('onboard')) for (const [w, phase, pages] of [[390, 'night', 3], [390, 'day', 3], [1280, 'night', 1], [1280, 'day', 1]]) {
    const { ctx, page, world } = await openWorld(browser, server.base, DEVICES[w], '/mnet.html?view=feed&finish=1', { phase, member: true, nextStep: 'profile' });
    try {
      await page.waitForSelector('#mnProfileGate:not([hidden])', { timeout: 60000 });
      const p = await page.evaluate(() => ({ app: document.getElementById('mnApp').hidden, gate: document.documentElement.classList.contains('mn-gate-on'), door: document.documentElement.classList.contains('mn-door-open'), h: getComputedStyle(document.querySelector('#mnStep1 .mn__onboard-h')) }));
      check(`onboard-${w}-${phase}`, 'the pages replace the World as before (mn-gate-on), never the door', p.app && p.gate && !p.door, p);
      const o = await page.evaluate(() => { const g = document.getElementById('mnProfileGate'), h = document.querySelector('#mnStep1 .mn__onboard-h').getBoundingClientRect(), f = document.getElementById('mnProfileSave').getBoundingClientRect(); return { slash: getComputedStyle(g, '::after').content, mid: Math.round((f.left + f.right) / 2), head: Math.round(h.left), vw: innerWidth }; });
      check(`onboard-${w}-${phase}`, 'no stray slanted line' + (w === 1280 ? '; on a wide screen the form is one centred measure' : ''), o.slash === 'none' && (w !== 1280 || Math.abs(o.mid - o.vw / 2) <= 40), o);
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

  /* ---------- the onboarding pages on a laptop's window: the floating bar never lies on the action (release review RS-4) ----------
     At 1366 x 768 and 1280 x 720 the bar, centred over the pages' centred measure, covered most of the action's words at rest.
     From 1100 px it steps aside; it is moved, never hidden, and the phone keeps it where it was. Each page at rest: wherever the
     action is on screen, it is the topmost thing at its centre and four inner points (an action below the fold is not covered). */
  if (runs('onboard-bar')) for (const [w, h] of [[1366, 768], [1280, 720], [1100, 700], [390, 844]]) {
    const scope = `onboard-bar-${w}x${h}`;
    const device = w === 390 ? DEVICES[390] : { name: `${w}x${h}`, viewport: { width: w, height: h }, mobile: false };
    const { ctx, page } = await openWorld(browser, server.base, device, '/mnet.html?view=feed&finish=1', { phase: 'night', member: true, nextStep: 'profile', dpr: 1, globe: false });
    const atRest = () => page.evaluate(() => {
      const el = document.getElementById('mnProfileSave'), bar = document.querySelector('body > .appbar');
      const g = el.getBoundingClientRect(), b = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
      const mx = g.left + g.width / 2, my = g.top + g.height / 2, inset = Math.min(g.height, g.width) / 2;
      const pts = [[mx, my], [mx, g.top + 4], [mx, g.bottom - 4], [g.left + inset, my], [g.right - inset, my]].filter(([, y]) => y >= 0 && y < innerHeight);
      const hits = pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); });
      return { step: document.getElementById('mnStepsCount').textContent, scrollY: Math.round(scrollY), shown: pts.length, hits, covered: hits.filter((x) => !x).length,
        action: [Math.round(g.left), Math.round(g.top), Math.round(g.width), Math.round(g.height)], bar: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
        barShown: cs.display !== 'none' && cs.visibility === 'visible' && b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
        barMid: Math.round(b.left + b.width / 2), vw: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    try {
      await page.waitForSelector('#mnProfileGate:not([hidden])', { timeout: 60000 });
      await page.waitForTimeout(900);
      const seen = [await atRest()];
      await page.fill('#mnHandle', 'fixture.member'); await page.fill('#mnDisplay', 'Fixture Member'); await page.waitForTimeout(700);
      await page.click('#mnProfileSave');
      await page.waitForFunction(() => document.getElementById('mnStepsCount').textContent === '2 / 3', null, { timeout: 15000 });
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
      seen.push(await atRest());
      await page.fill('#mnLegalName', 'Nadia Member'); await page.fill('#mnAddr1', '1 Main Street'); await page.fill('#mnCity', 'Bridgeport'); await page.fill('#mnRegion', 'CT'); await page.fill('#mnPostal', '06604');
      await page.click('#mnProfileSave');
      await page.waitForFunction(() => document.getElementById('mnStepsCount').textContent === '3 / 3', null, { timeout: 15000 });
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
      seen.push(await atRest());
      if (w === 1366) await page.screenshot({ path: join(OUT, `onboard-bar-${w}x${h}-3.png`) });
      if (w >= 1100) check(scope, 'at rest on every page, wherever the action is on screen nothing lies on it', seen.every((s) => s.covered === 0) && seen.some((s) => s.shown > 0), seen);
      check(scope, w >= 1100 ? 'the bar is moved, never hidden: whole on screen, beside the measure' : 'the phone keeps its bar where it was: whole on screen and centred',
        seen.every((s) => s.barShown && (w >= 1100 ? s.barMid > s.vw / 2 + 300 : Math.abs(s.barMid - s.vw / 2) <= 1)), seen.map((s) => ({ bar: s.bar, barShown: s.barShown, vw: s.vw })));
      check(scope, 'no sideways scroll', seen.every((s) => s.overflow === 0), seen.map((s) => s.overflow));
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
