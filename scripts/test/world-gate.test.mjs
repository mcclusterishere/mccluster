/* THE DOOR (owner, 2026-11-18: "the sign-in page just looks like shit ... This is royalty shit over here";
   docs/design/WORLD-SIGN-IN-DOOR.md). The World's sign-in rises over the living World instead of replacing it.

   Static: the files, where mnet.html links them, the law in the stylesheet (mobile first, minmax(0, 1fr), 16 px form
   controls, no raster, no !important outside reduced motion, every rule scoped to the door, its pages or html.mn-door-open),
   the supplied mark as the only mark, no "Hu Up", the font file's provenance and licences, and the credit fallback.
   Behaviour: js/world-gate.js (MCC_GATE) in a small fake DOM: the inert map (the privacy notice spared), the history rules
   for each way out, Escape, Show / Hide, the live rules and their one announcement, the busy state, the doors by keyboard,
   the re-open race, the visual viewport, and the pulse's words from real-shaped answers (one, two, 500, unavailable, {}, 503). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const bytes = (p) => readFileSync(new URL('../../' + p, import.meta.url));
const exists = (p) => existsSync(new URL('../../' + p, import.meta.url));
const PLAYFAIR_SHA256 = '1e3429a2122b4171bf393c8de5c501820e17ca2074c498d7080e2326975d825c';

/* ---------------- static ---------------- */
test('the door ships as its own stylesheet and script, linked where the spec puts them', () => {
  for (const f of ['css/world-gate.css', 'js/world-gate.js', 'assets/fonts/playfair-display-latin-500-normal.woff2', 'assets/fonts/OFL-playfair-display.txt', 'assets/fonts/OFL-manrope.txt',
    'docs/design/WORLD-SIGN-IN-DOOR.md', 'scripts/e2e/world-gate.e2e.mjs', 'scripts/e2e/sign-in.e2e.mjs', 'scripts/e2e/support/world-gate-harness.mjs']) assert.ok(exists(f), f);
  const html = read('mnet.html');
  assert.match(html, /<link rel="stylesheet" href="css\/daylight\.css\?v=__STAMP__">\n  <link rel="stylesheet" href="css\/world-gate\.css\?v=__STAMP__">/, 'right after css/daylight.css');
  /* before js/mnet.js, which calls it; js/video-poster.js keeps its pinned place directly before js/mnet.js
     (scripts/test/action-camera-loop.test.mjs) */
  assert.match(html, /<script src="js\/world-gate\.js\?v=__STAMP__"><\/script>\n  <script src="js\/video-poster\.js\?v=__STAMP__"><\/script>\n  <script src="js\/mnet\.js\?v=__STAMP__"><\/script>/, 'before js/video-poster.js and js/mnet.js');
  assert.equal(html.split('<script src="js/world-gate.js').length, 2, 'loaded once');
  assert.doesNotMatch(html, /hu\s*up/i, '"Get Your Hu Up!" is gone from the World, in every form (owner, 2026-11-17)');
  assert.match(html, /The place for doers\./);
});

function door(html) {
  const start = html.indexOf('<section class="mn__gate wg-door" id="mnSignedOut"');
  return html.slice(start, html.indexOf('</section>', html.indexOf('<footer class="wg-foot">', start)) + 10);
}
test('the door\'s markup: a dialog without aria-modal, the supplied crest once on the stage and nothing else drawn, the h2, the doors, the fields', () => {
  const html = read('mnet.html'), d = door(html);
  assert.match(d, /^<section class="mn__gate wg-door" id="mnSignedOut" role="dialog" aria-label="Sign in" tabindex="-1" hidden>/);
  assert.doesNotMatch(d, /aria-modal/);
  const imgs = d.match(/<img [^>]*>/g) || [];
  /* the crest crowns the World above the door (review DR-M3): one image, the owner's white mark, on the stage's dark band by
     night and by day; the sheet carries no mark */
  assert.equal(imgs.length, 1, 'one image: the supplied white mark');
  assert.match(imgs[0], /^<img class="wg-crest" src="assets\/img\/equity-uprise-mark-white\.png" alt="" width="160" height="160" draggable="false">$/);
  const stage = d.slice(d.indexOf('<div class="wg-stage">'), d.indexOf('<div class="wg-sheet" id="wgSheet">'));
  assert.ok(stage.includes(imgs[0]), 'the crest is on the stage, not in the sheet');
  assert.doesNotMatch(d, /<svg[^>]*class="[^"]*(crown|crest)|<canvas|wg-light/, 'nothing drawn for the mark, and no light sweep');
  /* the way back: "← Back" on a phone, its full words from 700 px, one name throughout */
  assert.match(d, /<button class="mn__to-world wg-back" id="mnSignedOutBack" type="button" aria-label="Back to the World">← Back<span class="wg-back-more"> to the World<\/span><\/button>/);
  const h2 = /<h2 class="wg-title" id="wgTitle">([\s\S]*?)<\/h2>/.exec(d)[1];
  assert.equal(h2.replace(/<[^>]+>/g, ''), 'Turn what you care about into action.');
  assert.match(h2, /<em>into action<\/em><span class="wg-stop">\.<\/span>$/);
  assert.match(d, /role="tablist" aria-label="Sign in or create an account"/);
  assert.match(d, /id="mnSignInTab" type="button" role="tab" aria-selected="true"[^>]*><span class="wg-tab-k" aria-hidden="true">Welcome back<\/span><span class="wg-tab-w">Sign in<\/span><\/button>/);
  assert.match(d, /id="mnCreateTab" type="button" role="tab" aria-selected="false"[^>]*><span class="wg-tab-k" aria-hidden="true">New here<\/span><span class="wg-tab-w">Create account<\/span><\/button>/);
  assert.match(d, /<div id="mnAuthPanel" role="tabpanel" aria-labelledby="mnSignInTab">/);
  assert.match(d, /<input class="mn__input" id="mnEmail" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="you@example\.com" aria-describedby="mnAuthStatus">/);
  /* the password is described by the status in Sign in; js/world-gate.js adds the eight-character rule in Create account,
     where it shows (review DR-m5) */
  assert.match(d, /id="mnPassword" type="password" autocomplete="current-password" minlength="8" placeholder="Your password" aria-describedby="mnAuthStatus"/);
  assert.match(d, /id="mnPassword2" type="password" autocomplete="new-password" minlength="8" placeholder="Type it again" aria-describedby="wgMatch mnAuthStatus"/);
  /* Show / Hide: its words and its name say what it will do; no pressed state as well (review DR-m5) */
  assert.equal((d.match(/class="wg-show" type="button" data-reveal="mnPassword2?" aria-controls="mnPassword2?" aria-label="Show password">Show<\/button>/g) || []).length, 2);
  assert.doesNotMatch(d, /aria-pressed/);
  /* the order of the panel: status directly above the action; the note about the three pages to come under the action, so
     the action stays in view above the privacy notice on a phone (review DR-M1) */
  const order = ['id="mnEmail"', 'id="mnPassword"', 'id="mnPasswordHint"', 'id="mnForgot"', 'id="mnConfirmWrap"', 'id="mnCreatePrivacy"', 'id="mnCreateAgree"', 'id="mnAuthStatus"', 'id="mnAuthGo"', 'id="mnCreateNote"', 'id="mnResend"', 'id="mnProviders"'].map((s) => d.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'every part is there');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the panel reads in the spec\'s order');
  assert.ok(d.indexOf('class="wg-stage"') < d.indexOf('id="wgSheet"'), 'the stage first, then the sheet (DOM order is reading order)');
  /* the visible words: the brand is the mark, never written; the company is named once; no other entity */
  const words = d.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  for (const bad of ['Equity Quantized', 'Equity Uprise', 'Human Uprise', 'Matthew McCluster', 'I AM HERE', 'Whip Equipped', 'PRIM3']) assert.ok(!words.includes(bad), bad);
  assert.match(d, /<p class="wg-colophon">A McCluster Corp program\.<\/p>/);
  assert.match(d, /<p class="mn__hint" id="mnCreateNote" hidden><b>Next:<\/b> your profile, where we can reach you, and your phone\. One short page each\.<\/p>/);
  /* the onboarding pages keep their markup */
  assert.match(html, /<section class="mn__gate mn__onboard" id="mnProfileGate" hidden>/);
});

function rules(css) {
  const out = [];
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (src, at) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < src.length && depth; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; }
      const body = src.slice(open + 1, j - 1);
      if (/^@(media|supports|container)/.test(head)) walk(body, [...at, head]);
      else out.push({ head, body, at });
      i = j;
    }
  };
  walk(strip, []);
  return out;
}
/* a selector list split at its top-level commas only (never inside :is() or :not()) */
const topLevel = (head) => { const out = []; let depth = 0, cur = ''; for (const ch of head) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out.filter(Boolean); };
test('the stylesheet keeps the law: mobile first, minmax(0, 1fr), 16 px controls, no raster, scoped, !important only for reduced motion', () => {
  const css = read('css/world-gate.css'), all = rules(css);
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'min-width queries only');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok((code.match(/\b1fr\b/g) || []).length > 0);
  assert.equal((code.match(/\b1fr\b/g) || []).length, (code.match(/minmax\(0, 1fr\)/g) || []).length, 'every 1fr is minmax(0, 1fr)');
  for (const r of all) {
    if (/^@(font-face|keyframes)/.test(r.head) || /^(from|to|\d+%)$/.test(r.head)) continue;
    for (const sel of topLevel(r.head)) assert.match(sel, /^(html\[data-daylight="day"\] )?(#mnSignedOut|#mnProfileGate|html\.mn-door-open|html\.mn-gate-on )/, 'scoped: ' + sel);
    if (/\binput\b|\.mn__input|\bselect\b|\btextarea\b|\.mn__textarea/.test(r.head) && !/::placeholder/.test(r.head)) {
      for (const decl of r.body.split(';')) if (/^\s*font(-size)?\s*:/.test(decl)) assert.match(decl, /max\(16px,/, 'form controls at max(16px, ...): ' + r.head + ' { ' + decl.trim() + ' }');
    }
    const important = /!important/.test(r.body);
    if (important) assert.ok(r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)), '!important only under reduced motion: ' + r.head);
  }
  const urls = css.match(/url\((?!["']?data:image\/svg\+xml)[^)]*\)/g) || [];
  assert.deepEqual(urls, ['url("../assets/fonts/playfair-display-latin-500-normal.woff2")', 'url("../assets/fonts/playfairdisplay-italic-700.woff2")'], 'no raster and nothing under assets/img: only the two font files and data: SVG icons');
  assert.doesNotMatch(css, /assets\/img/);
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic|@import/, 'self-hosted fonts only');
  /* the crest is never altered: scaled into a square box, nothing on or around it, never larger than the file's own pixels
     on a 3x phone (52 px) */
  const crest = all.filter((r) => /\.wg-crest/.test(r.head)).map((r) => r.body).join(';');
  assert.match(crest, /filter: none/); assert.match(crest, /box-shadow: none/); assert.match(crest, /background: none/); assert.match(crest, /border-radius: 0/); assert.match(crest, /object-fit: contain/);
  assert.match(crest, /width: 52px; height: 52px/);
  assert.doesNotMatch(crest, /mask|mix-blend|drop-shadow|opacity|width: (?!52px)\d/);
  assert.doesNotMatch(css, /wg-crown|wg-light|wg-sweep|wg-card-in/, 'no crown in the sheet, no light sweep, no card stagger (review DR-m1)');
  /* motion: the sheet rises whole; only the scrim and the sheet move on the way in */
  const entering = all.filter((r) => /is-entering/.test(r.head));
  assert.deepEqual(entering.map((r) => r.head), ['#mnSignedOut.is-entering .wg-scrim', '#mnSignedOut.is-entering .wg-sheet']);
  assert.doesNotMatch(entering.map((r) => r.body).join(';'), /animation-delay/);
  /* the sheet is opaque by night and by day (review DR-m4) */
  for (const m of css.matchAll(/--wg-sheet: ([^;]+);/g)) assert.doesNotMatch(m[1], /rgba\(/, 'an opaque sheet: ' + m[1]);
  /* the action is in view at rest: the sheet's height takes the action's measured need, and the action is drawn above the
     fade (review DR-M1, DR-M2) */
  const sheet = all.filter((r) => r.head === '#mnSignedOut .wg-sheet' && !r.at.length).map((r) => r.body).join(';');
  assert.match(sheet, /max-height: clamp\(var\(--wg-need, 0px\), calc\(var\(--wg-vvh, 100vh\) - var\(--wg-safe-bottom, 0px\) - 160px\), calc\(var\(--wg-vvh, 100vh\) - var\(--wg-safe-bottom, 0px\) - 68px\)\)/);
  const go = all.filter((r) => r.head === '#mnSignedOut #mnAuthGo' && !r.at.length).map((r) => r.body).join(';');
  assert.match(go, /z-index: 1/);
  /* the large type only on tall desktops (review DR-M2) */
  const tall = all.filter((r) => r.at.some((a) => /min-width: 1100px\) and \(min-height: 900px/.test(a))).map((r) => r.head);
  assert.ok(tall.includes('#mnSignedOut .wg-title') && tall.includes('#mnSignedOut .wg-field'), tall.join(' | '));
  assert.ok(!all.some((r) => r.head === '#mnSignedOut .wg-title' && r.at.length === 1 && /min-width: 1100px\)$/.test(r.at[0])), 'no larger title on a short desktop');
  /* field names are read as written: small capitals from the font, never text-transform (review DR-m5) */
  for (const head of ['#mnSignedOut .wg-field .mn__label', '#mnProfileGate .mn__label']) {
    const body = all.filter((r) => r.head === head).map((r) => r.body).join(';');
    assert.match(body, /font-variant-caps: all-small-caps/, head); assert.match(body, /text-transform: none/, head); assert.doesNotMatch(body, /uppercase/, head);
  }
  /* no blur over the globe: the only backdrop-filter is the veil at 1100 px and up, never under reduced transparency */
  const blur = all.filter((r) => /backdrop-filter/.test(r.body));
  assert.equal(blur.length, 1);
  assert.match(blur[0].head, /^#mnSignedOut \.wg-veil$/);
  assert.ok(blur[0].at.some((a) => /min-width: 1100px\) and \(prefers-reduced-transparency: no-preference/.test(a)));
  /* words over the Earth ride on a plate (the Earth can be any colour: the bare dateline read 2.3:1 over the real globe) */
  for (const part of ['.wg-back', '.wg-card', '.wg-dateline:not([hidden])']) {
    const body = all.filter((r) => r.head === '#mnSignedOut ' + part).map((r) => r.body).join(';');
    assert.match(body, /background: (var\(--wg-chip\)|rgba\()/, 'a plate under ' + part);
  }
  /* the stage's controls (verification, 2026-11-18): the source line of a card is cut along its length only, so the link in
     it keeps its 44 px target; the credit's links have their 44 px inside the stage; the focus marks of the cards and the
     credit are drawn inside their own plates (a row that cuts what leaves it cannot cut them, and the Earth is never their
     ground) */
  const sourceLine = all.filter((r) => r.head === '#mnSignedOut .wg-card__s' && r.at.some((a) => /^@supports \(overflow: clip\)/.test(a))).map((r) => r.body).join(';');
  assert.match(sourceLine, /overflow: visible; overflow-x: clip/, 'the source line: no cut above or below');
  assert.match(all.filter((r) => r.head === '#mnSignedOut .wg-credit a').map((r) => r.body).join(';'), /padding: 13px 0 17px; margin: -13px 0 -17px/);
  assert.match(all.filter((r) => r.head === '#mnSignedOut .wg-credit' && !r.at.length).map((r) => r.body).join(';'), /margin: 10px 16px 0/);
  assert.match(all.filter((r) => r.head === '#mnSignedOut .wg-stage .wg-card__go:focus-visible').map((r) => r.body).join(';'), /outline: 2px solid var\(--wg-gold\); outline-offset: -5px/, 'the mission card: a line inside its own edge');
  for (const head of ['#mnSignedOut .wg-stage .wg-card__s a:focus-visible', '#mnSignedOut .wg-stage .wg-credit a:focus-visible']) {
    const body = all.filter((r) => r.head === head).map((r) => r.body).join(';');
    assert.match(body, /outline: 0/, head); assert.match(body, /background-clip: content-box/, head); assert.match(body, /text-decoration: none/, head);
  }
  /* the floating card (700 px and up) on a short screen: it stops under the way back and the crest, and the stage's lower
     third shows only what has room above the card (the stage's own height decides) */
  const card = all.filter((r) => r.head === '#mnSignedOut .wg-sheet' && r.at.length === 1 && /min-width: 700px\)$/.test(r.at[0])).map((r) => r.body).join(';');
  assert.match(card, /max-height: calc\(var\(--wg-vvh, 100vh\) - 100px - var\(--wg-safe-bottom, 0px\)\)/, 'the card keeps 68 px for the way back over its 32 px margin');
  const gated = (head) => all.filter((r) => r.head === head && r.at.length === 2 && /min-width: 700px\)$/.test(r.at[0]) && /^@container/.test(r.at[1]) && /display: (flex|block)/.test(r.body)).map((r) => Number(/min-height: (\d+)px/.exec(r.at[1])[1]));
  assert.deepEqual(gated('#mnSignedOut .wg-credit'), [104]);
  assert.deepEqual(gated('#mnSignedOut .wg-pulse'), [246]);
  assert.deepEqual(gated('#mnSignedOut .wg-dateline:not([hidden])'), [290]);
  assert.ok(all.some((r) => r.head === '#mnSignedOut .wg-pulse, #mnSignedOut .wg-credit' && r.at.length === 1 && /min-width: 700px\)$/.test(r.at[0]) && /display: none/.test(r.body)), 'hidden from 700 px until the stage has the room');
  assert.ok(!all.some((r) => r.head === '#mnSignedOut .wg-dateline:not([hidden])' && r.at.length === 1 && /display: block/.test(r.body)), 'the dateline is never shown without its room');
  /* the World's own overlays sleep under the door; only the globe frame stays */
  assert.ok(all.some((r) => r.head === 'html.mn-door-open #mnWorld > :not(.mn__world-frame)' && /visibility: hidden/.test(r.body)));
  /* day values for every token */
  const night = /#mnSignedOut, #mnProfileGate \{([\s\S]*?)\n\}/.exec(css)[1], day = /html\[data-daylight="day"\] #mnSignedOut, html\[data-daylight="day"\] #mnProfileGate \{([\s\S]*?)\n\}/.exec(css)[1];
  const names = (s) => (s.match(/--wg-[a-z-]+(?=:)/g) || []).filter((n) => !/^--wg-(ui|serif|ease)$/.test(n)).sort();
  assert.deepEqual(names(day), names(night), 'html[data-daylight="day"] redefines every colour token');
});

test('the font is the package\'s file, unmodified, with its licence; Manrope\'s licence travels too; the notices say so', () => {
  assert.equal(createHash('sha256').update(bytes('assets/fonts/playfair-display-latin-500-normal.woff2')).digest('hex'), PLAYFAIR_SHA256);
  const ofl = read('assets/fonts/OFL-playfair-display.txt'), man = read('assets/fonts/OFL-manrope.txt'), notices = read('THIRD-PARTY-NOTICES');
  assert.match(ofl, /The Playfair Display Project Authors/); assert.match(ofl, /SIL Open Font License, Version 1\.1/);
  assert.match(man, /The Manrope Project Authors/); assert.match(man, /SIL Open Font License, Version 1\.1/);
  assert.match(notices, /Playfair Display \(typeface\)/); assert.match(notices, /@fontsource\/playfair-display/); assert.match(notices, new RegExp(PLAYFAIR_SHA256));
  assert.match(notices, /Manrope \(typeface\)/); assert.match(notices, /assets\/fonts\/OFL-manrope\.txt/);
  const css = read('css/world-gate.css');
  assert.match(css, /@font-face \{ font-family: "Playfair Display"; font-style: normal; font-weight: 500; font-display: swap; src: url\("\.\.\/assets\/fonts\/playfair-display-latin-500-normal\.woff2"\) format\("woff2"\); \}/);
  assert.match(css, /@font-face \{ font-family: "Playfair Display"; font-style: italic; font-weight: 400 900; font-display: swap;/);
});

test('the script stays presentation: no auth call, no console.error; js/mnet.js keeps every auth call as it was', () => {
  const gate = read('js/world-gate.js'), mnet = read('js/mnet.js');
  assert.doesNotMatch(gate, /signInWithPassword|signUpWithPassword|resendSignupVerification|requestPasswordReset|signInWithProvider|signOut|updatePassword/);
  assert.doesNotMatch(gate, /console\.error/);
  assert.doesNotMatch(gate, /innerHTML/, 'values are written as text');
  assert.match(mnet, /var action = create\n      \? MCC\.signUpWithPassword\(email, password, ack\)\n      : MCC\.signInWithPassword\(email, password\);/);
  assert.match(mnet, /MCC\.resendSignupVerification\(email\)\.then/);
  assert.match(mnet, /location\.href = "forgot-password\.html" \+ \(email \? "\?email=" \+ encodeURIComponent\(email\) : ""\);/);
  assert.match(mnet, /MCC\.signInWithProvider\(key, location\.origin \+ "\/auth\/\?next=" \+ encodeURIComponent\(next\)\)/);
  /* the refusal names the control by its own words (review DR-m7) */
  const forgot = /<button class="mn__secondary" id="mnForgot" type="button">([^<]+)<\/button>/.exec(read('mnet.html'))[1];
  assert.equal(forgot, "Forgot or don't know your password?");
  assert.ok(mnet.includes('e && e.code === "invalid_credentials" ? "That email and password don\u2019t match an account. Check them, or use \u201c' + forgot + '\u201d above." : (e.message || "Could not sign in.")'), 'the refusal quotes the Forgot control');
  /* the door rises over the World; the pages still replace it */
  const show = mnet.slice(mnet.indexOf('  function showGate(which) {'), mnet.indexOf('  function providerLabel('));
  assert.match(show, /\$\("mnApp"\)\.hidden = which === "profile";/);
  assert.match(show, /document\.documentElement\.classList\.toggle\("mn-gate-on", which === "profile"\);/);
  assert.match(show, /document\.documentElement\.classList\.toggle\("mn-door-open", which === "signedout"\);/);
  assert.match(show, /if \(gate && gate\.shown\) gate\.shown\(which\);/);
  const open = mnet.slice(mnet.indexOf('  function openSignIn(mode, why, key) {'), mnet.indexOf('  function leaveGuestWorld()'));
  assert.doesNotMatch(open, /scrollTo/, 'the World keeps its place');
  assert.match(open, /querySelectorAll\("dialog\[open\]"\)/);
  assert.match(mnet, /openSignIn\("signin", line, why\);/);
  /* the focus: through MCC_GATE.focus (a touch screen gets the door, not a field: review DR-m11) */
  assert.match(open, /if \(window\.MCC_GATE && MCC_GATE\.focus\) MCC_GATE\.focus\(email\);/);
  assert.doesNotMatch(open.replace(/else if \(email\) email\.focus\(\{ preventScroll: true \}\);/, ''), /email\.focus\(/, 'no unconditional focus on the email');
  /* the way back from a mission's Join goes back to that mission (review DR-m2) */
  const back = mnet.slice(mnet.indexOf('    $("mnSignedOutBack").onclick = function () {'), mnet.indexOf('    $("mnEditProfile").onclick'));
  assert.match(back, /var mission = doorMission\(\);/);
  assert.match(back, /showGate\("app"\);\n      if \(mission\) openMission\(mission\);\n      else if \(state\.currentView !== "feed"\) setView\("feed"\);/);
  assert.match(mnet, /function doorMission\(\) \{\n    if \(state\.doorFor !== "mission"\) return "";/);
});

test('the credit fallback is the World globe\'s own credit, word for word', () => {
  const ag = read('js/action-globe.js');
  const m = /credit\.innerHTML='([^']+)'/.exec(ag);
  assert.ok(m, 'the editorial credit in js/action-globe.js');
  const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const { gate } = boot();
  assert.equal(gate.format.credit, text);
  assert.match(read('mnet.html'), new RegExp('<p class="wg-credit" id="wgCredit">' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</p>'));
});

/* ---------------- a small fake DOM ---------------- */
const parseSel = (sel) => sel.split(',').map((s) => s.trim()).map((s) => {
  const m = { tag: null, id: null, cls: [], attrs: [] };
  s.replace(/^[a-z]+/i, (t) => { m.tag = t.toUpperCase(); return ''; }).replace(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)\]/g, (_, id, c, a) => { if (id) m.id = id; if (c) m.cls.push(c); if (a) m.attrs.push(a); return ''; });
  return m;
});
const matches = (el, sel) => el.nodeType === 1 && parseSel(sel).some((m) => (!m.tag || el.tagName === m.tag) && (!m.id || el.id === m.id) && m.cls.every((c) => el.classList.contains(c)) && m.attrs.every((a) => el.hasAttribute(a)));
function makeDom() {
  const observers = [];
  const notify = (target, kind, info) => {
    for (const o of observers) {
      const inside = o.target === target || (o.opts.subtree && o.target.contains(target));
      if (!inside) continue;
      if (kind === 'attr' && (!o.opts.attributes || (o.opts.attributeFilter && !o.opts.attributeFilter.includes(info)))) continue;
      if (kind === 'child' && !(o.opts.childList || o.opts.characterData)) continue;
      queueMicrotask(() => o.cb([{ type: kind, target, attributeName: info, addedNodes: kind === 'child' ? info || [] : [] }]));
    }
  };
  class Node {
    constructor(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; this.listeners = []; }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); notify(this, 'child', [n]); return n; }
    removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; notify(this, 'child', []); return n; }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((n) => n.textContent).join(''); }
    set textContent(v) { this.childNodes.slice().forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) { const t = new Node(3); t.nodeValue = String(v); t.parentNode = this; this.childNodes.push(t); } notify(this, 'child', []); }
    addEventListener(type, fn, opt) { this.listeners.push({ type, fn, capture: opt === true || !!(opt && opt.capture) }); }
    removeEventListener() {}
    dispatchEvent(ev) {
      const path = []; for (let n = this; n; n = n.parentNode) path.unshift(n);
      if (this !== win && path[0] === doc) path.unshift(win);
      ev.target = this; let stop = false; ev.stopPropagation = () => { stop = true; }; ev.preventDefault = () => { ev.defaultPrevented = true; };
      for (const n of path.slice(0, -1)) { if (stop) break; n.listeners.filter((l) => l.type === ev.type && l.capture).forEach((l) => l.fn.call(n, ev)); }
      if (!stop) { this.listeners.filter((l) => l.type === ev.type).forEach((l) => l.fn.call(this, ev)); if (ev.type === 'click' && typeof this.onclick === 'function') this.onclick(ev); }
      for (const n of path.slice(0, -1).reverse()) { if (stop) break; n.listeners.filter((l) => l.type === ev.type && !l.capture).forEach((l) => l.fn.call(n, ev)); }
      return !ev.defaultPrevented;
    }
  }
  class Element extends Node {
    constructor(tag) {
      super(1); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.styleProps = {}; this.value = ''; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.offsetWidth = 1; this.rect = null;
      const el = this;
      this.style = { setProperty(k, v) { el.styleProps[k] = v; }, removeProperty(k) { delete el.styleProps[k]; }, getPropertyValue(k) { return el.styleProps[k] || ''; }, set pointerEvents(v) { el.styleProps['pointer-events'] = v; }, get pointerEvents() { return el.styleProps['pointer-events'] || ''; } };
      this.classList = { add: (...c) => { const s = new Set(el.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); }, remove: (...c) => { el.className = el.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); }, contains: (c) => el.className.split(' ').includes(c), toggle: (c, on) => { const has = el.classList.contains(c); if (on === undefined ? !has : on) el.classList.add(c); else el.classList.remove(c); } };
      this.className = '';
    }
    get id() { return this.attrs.get('id') || ''; } set id(v) { this.attrs.set('id', v); }
    get type() { return this.attrs.get('type') || ''; } set type(v) { this.setAttribute('type', v); }
    get hidden() { return this.attrs.has('hidden'); } set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get inert() { return this.attrs.has('inert'); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); notify(this, 'attr', k); }
    removeAttribute(k) { if (this.attrs.delete(k)) notify(this, 'attr', k); }
    hasAttribute(k) { return this.attrs.has(k); }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); }); walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return this.rect || { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }; }
    getClientRects() { let hiddenUp = false; for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.hidden) hiddenUp = true; return this.isConnected && !hiddenUp ? [this.getBoundingClientRect()] : []; }
    focus() { const before = doc.activeElement; doc.activeElement = this; if (before !== this) this.dispatchEvent({ type: 'focusin' }); }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    click() { this.dispatchEvent({ type: 'click' }); }
  }
  const win = new Node(9);
  const doc = new Node(9);
  doc.createElement = (t) => new Element(t);
  doc.createElementNS = (_, t) => new Element(t);
  doc.createTextNode = (v) => { const t = new Node(3); t.nodeValue = v; return t; };
  doc.getElementById = (id) => { const find = (n) => { for (const c of n.children) { if (c.id === id) return c; const f = find(c); if (f) return f; } return null; }; return find(doc); };
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.readyState = 'complete'; doc.visibilityState = 'visible';
  /* the font loader: what the door asks for, and when */
  doc.fonts = { loads: [], load(spec) { this.loads.push(spec); return Promise.resolve([]); }, ready: Promise.resolve() };
  doc.documentElement = new Element('html'); doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  return { doc, win, Element, observers };
}

/* the World as js/mnet.js leaves it: main.mn with the header, the door, the pages and the app; the bar, the bar's chip, a
   privacy banner, an element someone else made inert, a script */
function boot({ vv = null, activation = true, reduced = false, touch = false, fetch: fetchImpl = null } = {}) {
  const { doc, win, Element, observers } = makeDom();
  const el = (tag, attrs = {}, parent = null, text = '') => { const e = new Element(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } if (text) e.textContent = text; if (parent) parent.appendChild(e); return e; };
  const main = el('main', { class: 'mn' }, doc.body);
  const top = el('header', { class: 'mn__top' }, main); top.rect = { top: 0, bottom: 69, left: 0, right: 390, width: 390, height: 69 };
  const door = el('section', { class: 'mn__gate wg-door', id: 'mnSignedOut', role: 'dialog', 'aria-label': 'Sign in', tabindex: '-1', hidden: '' }, main);
  const join = el('button', { id: 'mnGuestJoin', type: 'button' }, top, 'Join');
  const pages = el('section', { class: 'mn__gate mn__onboard', id: 'mnProfileGate', hidden: '' }, main);
  const app = el('section', { class: 'mn__app', id: 'mnApp' }, main);
  const frame = el('iframe', { id: 'mnWorldFrame' }, app); frame.rect = { top: 0, bottom: 363, left: 0, right: 390, width: 390, height: 363 };
  el('nav', { class: 'appbar' }, doc.body);
  el('a', { id: 'mccAuthChip' }, doc.body);
  const banner = el('div', { id: 'mccPrivacyNotice' }, doc.body); banner.rect = { top: 700, bottom: 836, left: 8, right: 382, width: 374, height: 136 };
  const theirs = el('div', { id: 'theirs', inert: '' }, doc.body);
  el('script', {}, doc.body);
  el('div', { class: 'wg-scrim' }, door);
  const stage = el('div', { class: 'wg-stage' }, door);
  const back = el('button', { class: 'mn__to-world wg-back', id: 'mnSignedOutBack', type: 'button' }, stage, '← Back to the World');
  const lower = el('div', { class: 'wg-lower' }, stage);
  const dateline = el('p', { class: 'wg-dateline', id: 'wgDateline', hidden: '' }, lower); el('time', { id: 'wgDate' }, dateline);
  const pulse = el('ul', { class: 'wg-pulse', id: 'wgPulse' }, lower);
  for (const id of ['wgPulseMission', 'wgPulseNews', 'wgPulseRecord']) el('li', { class: 'wg-card', id, hidden: '' }, pulse);
  el('p', { class: 'wg-credit', id: 'wgCredit' }, lower, 'NASA imagery · Natural Earth · © OpenStreetMap');
  const sheet = el('div', { class: 'wg-sheet', id: 'wgSheet' }, door);
  const tabs = el('div', { class: 'mn__auth-tabs' }, sheet);
  const signInTab = el('button', { class: 'mn__auth-tab is-active', id: 'mnSignInTab', type: 'button' }, tabs, 'Sign in');
  const createTab = el('button', { class: 'mn__auth-tab', id: 'mnCreateTab', type: 'button', tabindex: '-1' }, tabs, 'Create account');
  const panel = el('div', { id: 'mnAuthPanel', 'aria-labelledby': 'mnSignInTab' }, sheet);
  const f1 = el('div', { class: 'wg-field' }, panel); const email = el('input', { id: 'mnEmail', type: 'email' }, f1);
  const f2 = el('div', { class: 'wg-field' }, panel); const pass = el('input', { id: 'mnPassword', type: 'password', 'aria-describedby': 'mnAuthStatus' }, f2);
  const show1 = el('button', { class: 'wg-show', type: 'button', 'data-reveal': 'mnPassword', 'aria-label': 'Show password' }, f2, 'Show');
  const hint = el('p', { class: 'mn__hint wg-rule', id: 'mnPasswordHint' }, panel, 'Use at least 8 characters.');
  const wrap = el('div', { id: 'mnConfirmWrap' }, panel);
  const f3 = el('div', { class: 'wg-field' }, wrap); const pass2 = el('input', { id: 'mnPassword2', type: 'password' }, f3);
  const show2 = el('button', { class: 'wg-show', type: 'button', 'data-reveal': 'mnPassword2', 'aria-label': 'Show password' }, f3, 'Show');
  const match = el('span', { class: 'wg-sr', id: 'wgMatch' }, f3);
  el('p', { class: 'mn__status', id: 'mnAuthStatus' }, panel);
  const go = el('button', { class: 'mn__primary', id: 'mnAuthGo', type: 'button' }, panel, 'Sign in');
  /* js/mnet.js's side of the contract, reduced to what the door sees */
  const calls = { leave: 0, openMission: [] };
  const gateRef = {};
  const showGate = (which) => {
    app.hidden = which === 'profile';
    if (which === 'signedout') door.hidden = false; else if (!door.hidden) gateRef.g.leave();
    gateRef.g.shown(which);
  };
  const setMode = (mode) => { door.setAttribute('data-auth-mode', mode); signInTab.setAttribute('aria-selected', String(mode !== 'create')); createTab.setAttribute('aria-selected', String(mode === 'create')); };
  back.onclick = () => showGate('app');
  signInTab.onclick = () => setMode('signin');
  createTab.onclick = () => setMode('create');
  /* history: a stack of states; back() is asynchronous, as in a browser */
  const stack = [{ state: null }], hist = { at: 0, backs: 0, pushes: 0, replaces: 0 };
  const history = {
    get state() { return stack[hist.at].state; }, get length() { return stack.length; },
    pushState(s) { stack.splice(hist.at + 1); stack.push({ state: JSON.parse(JSON.stringify(s)) }); hist.at++; hist.pushes++; },
    replaceState(s) { stack[hist.at] = { state: s && JSON.parse(JSON.stringify(s)) }; hist.replaces++; },
    back() { hist.backs++; setTimeout(() => { if (hist.at > 0) hist.at--; win.dispatchEvent({ type: 'popstate', state: stack[hist.at].state }); }, 0); }
  };
  const vvListeners = {};
  const visualViewport = vv ? { ...vv, addEventListener: (t, fn) => { vvListeners[t] = fn; } } : undefined;
  const ctx = {
    document: doc, history, location: { href: 'https://mccluster.org/?mission=0e1f0000-0000-4000-8000-000000000001', origin: 'https://mccluster.org' },
    navigator: { userActivation: { isActive: activation } }, innerHeight: 844, visualViewport,
    matchMedia: (q) => ({ matches: /reduce/.test(q) ? reduced : /coarse/.test(q) ? touch : false }),
    setTimeout, clearTimeout, URL, URLSearchParams, Promise, AbortController, queueMicrotask,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    fetch: fetchImpl || (async () => ({ ok: false, status: 503, json: async () => ({}) })),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe(target, opts) { observers.push({ target, opts, cb: this.cb, mo: this }); } disconnect() { for (let i = observers.length - 1; i >= 0; i--) if (observers[i].mo === this) observers.splice(i, 1); } },
    ResizeObserver: class { observe() {} disconnect() {} },
    MCC_MISSION_POSTS: undefined
  };
  ctx.window = ctx;
  ctx.addEventListener = (...a) => win.addEventListener(...a);
  win.dispatchEvent = win.dispatchEvent.bind(win);
  vm.createContext(ctx);
  vm.runInContext(read('js/world-mission-posts.js'), ctx);
  vm.runInContext(read('js/world-gate.js'), ctx);
  gateRef.g = ctx.MCC_GATE;
  const open = (mode = 'signin', ctxArg = null) => { setMode(mode); showGate('signedout'); if (ctxArg) ctx.MCC_GATE.opened(ctxArg); };
  return { gate: ctx.MCC_GATE, ctx, doc, win, door, main, app, back, banner, theirs, sheet, signInTab, createTab, panel, email, pass, pass2, show1, show2, hint, match, go, f3, stack, hist, calls, showGate, open, vvListeners, frame, join };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (b, k, extra = {}) => b.doc.dispatchEvent.call(b.doc.activeElement === b.doc.body ? b.doc : b.doc.activeElement, { type: 'keydown', key: k, ...extra });

/* ---------------- behaviour ---------------- */
test('opening makes everything outside the door inert, spares the privacy banner, and gives back exactly what it took', async () => {
  const b = boot();
  b.open();
  const inert = (sel) => b.doc.querySelector(sel).hasAttribute('inert');
  assert.equal(inert('.mn__top'), true); assert.equal(b.app.hasAttribute('inert'), true); assert.equal(inert('#mnProfileGate'), true);
  assert.equal(inert('.appbar'), true); assert.equal(inert('#mccAuthChip'), true);
  assert.equal(b.banner.hasAttribute('inert'), false, 'the privacy banner is never inert');
  assert.equal(b.door.hasAttribute('inert'), false);
  assert.equal(b.doc.querySelector('script') && b.doc.querySelector('script').hasAttribute('inert'), false);
  /* a late arrival in the body while open is made inert too */
  const late = b.doc.createElement('div'); late.setAttribute('id', 'late'); b.doc.body.appendChild(late); await tick();
  assert.equal(late.hasAttribute('inert'), true);
  b.back.click();
  for (const sel of ['.mn__top', '#mnApp', '#mnProfileGate', '.appbar', '#mccAuthChip', '#late']) assert.equal(inert(sel), false, sel + ' freed in the same task');
  assert.equal(b.theirs.hasAttribute('inert'), true, 'what someone else made inert stays inert');
});

test('history: one entry while open; the Back pill steps back over it, the phone\'s Back closes, a hand-off and a success replace it', async () => {
  let b = boot();
  b.open();
  assert.equal(b.ctx.history.state.mccDoor, 1); assert.equal(b.stack.length, 2);
  b.back.click();
  assert.equal(b.hist.backs, 1, 'a close from the page steps back over the entry');
  await tick(5);
  assert.equal(b.ctx.history.state, null);
  await tick(260);
  assert.equal(b.door.hidden, true);
  /* the phone's Back: popstate, the door closes, no second step back */
  b = boot();
  b.open();
  b.ctx.history.back();
  await tick(5);
  assert.equal(b.gate.isOpen(), false); assert.equal(b.hist.backs, 1);
  /* a mission handed to the World: replaceState, no step back */
  b = boot({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const handed = [];
  b.open('signin', { reason: '', missions: async () => [{ id: '0e1f0000-0000-4000-8000-000000000002', title: 'Plant a street tree', domain: 'community', points: 25 }], openMission: (id) => { handed.push(id); b.showGate('app'); } });
  await tick(5);
  const go = b.doc.querySelector('.wg-card__go');
  assert.ok(go, 'the mission card is a button');
  go.click();
  assert.deepEqual(handed, ['0e1f0000-0000-4000-8000-000000000002']);
  assert.equal(b.hist.backs, 0); assert.ok(!(b.ctx.history.state && b.ctx.history.state.mccDoor));
  /* a sign-in that worked */
  b = boot();
  b.open();
  b.showGate('app');
  assert.equal(b.hist.backs, 0); assert.ok(!(b.ctx.history.state && b.ctx.history.state.mccDoor)); assert.equal(b.gate.isOpen(), false);
  /* someone who may not leave (no Back on screen): the phone's Back puts the entry back */
  b = boot();
  b.open();
  b.back.hidden = true;
  b.ctx.history.back();
  await tick(5);
  assert.equal(b.gate.isOpen(), true); assert.equal(b.ctx.history.state.mccDoor, 1);
});

test('Escape: a filled field lets go first, then the door closes; never during composition or from the privacy notice', async () => {
  const b = boot();
  b.open();
  b.email.value = 'kept@example.invalid'; b.email.focus();
  key(b, 'Escape', { isComposing: true });
  assert.equal(b.doc.activeElement, b.email); assert.equal(b.gate.isOpen(), true);
  key(b, 'Escape');
  assert.equal(b.doc.activeElement, b.doc.body, 'the first Escape only blurs the filled field'); assert.equal(b.gate.isOpen(), true);
  key(b, 'Escape');
  assert.equal(b.gate.isOpen(), false, 'the second closes');
  assert.equal(b.email.value, 'kept@example.invalid');
  const c = boot();
  c.open();
  c.banner.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(c.gate.isOpen(), true, 'the banner\'s own Escape is its own');
});

test('Show / Hide toggles one field, and every field is hidden again on a mode change, on submit and on close', async () => {
  const b = boot();
  b.open();
  b.show1.click();
  /* it says what it will do next, in its words and its name; no pressed state besides (review DR-m5) */
  assert.equal(b.pass.type, 'text'); assert.equal(b.show1.getAttribute('aria-pressed'), null); assert.equal(b.show1.getAttribute('aria-label'), 'Hide password'); assert.equal(b.show1.textContent, 'Hide');
  b.show1.click();
  assert.equal(b.pass.type, 'password'); assert.equal(b.show1.getAttribute('aria-label'), 'Show password'); assert.equal(b.show1.textContent, 'Show');
  b.show1.click(); assert.equal(b.pass.type, 'text');
  b.createTab.click(); await tick();
  assert.equal(b.pass.type, 'password'); assert.equal(b.show1.textContent, 'Show');
  b.show2.click(); assert.equal(b.pass2.type, 'text');
  b.go.click();
  assert.equal(b.pass2.type, 'password', 'a click on the action hides it before anything is sent');
  b.show1.click(); assert.equal(b.pass.type, 'text');
  b.back.click();
  assert.equal(b.pass.type, 'password'); assert.equal(b.show1.getAttribute('aria-label'), 'Show password');
});

/* security review SEC-4 (2026-11-19): after a refused sign-in and the Back pill the closed door still held all 17 typed
   characters, and the next person at the same screen could open Join and press Show */
test('a closed door keeps no typed password, by any way out; the typed email stays and the rules reset', async () => {
  const b = boot();
  const type = (input, v) => { input.value = v; input.dispatchEvent({ type: 'input' }); };
  b.open('create');
  type(b.email, 'member@example.invalid');
  type(b.pass, 'correct horse 17ch'); type(b.pass2, 'correct horse 17ch');
  assert.equal(b.hint.getAttribute('data-met'), 'true');
  b.back.click();
  assert.equal(b.pass.value, '', 'the password is cleared');
  assert.equal(b.pass2.value, '', 'and its confirmation');
  assert.equal(b.email.value, 'member@example.invalid', 'the email stays');
  assert.equal(b.hint.getAttribute('data-met'), 'false', 'the ring is empty again');
  b.open('signin');
  b.show1.click();
  assert.equal(b.pass.type, 'text');
  assert.equal(b.pass.value, '', 'Show reveals nothing of the earlier attempt');
  /* Escape on an empty field closes the door the same way */
  type(b.pass, 'another attempt');
  b.show1.click();
  b.gate.leave();
  assert.equal(b.pass.value, '', 'cleared when the World closes the door too');
});

test('the live rules: the ring at eight characters, the match tick, and one announcement each time they come to match', async () => {
  const b = boot();
  b.open('create');
  const type = (input, v) => { input.value = v; input.dispatchEvent({ type: 'input' }); };
  type(b.pass, 'seven77');
  assert.equal(b.hint.getAttribute('data-met'), 'false');
  type(b.pass, 'eight888');
  assert.equal(b.hint.getAttribute('data-met'), 'true');
  type(b.pass2, 'eight88');
  assert.equal(b.f3.getAttribute('data-match'), 'false'); assert.equal(b.match.textContent, '');
  type(b.pass2, 'eight888');
  assert.equal(b.f3.getAttribute('data-match'), 'true'); assert.equal(b.match.textContent, 'Both passwords match.');
  b.match.textContent = 'read';
  type(b.pass2, 'eight888');
  assert.equal(b.match.textContent, 'read', 'said once: typing on while it still matches says nothing new');
  type(b.pass, 'eight889');
  assert.equal(b.match.textContent, ''); assert.equal(b.f3.getAttribute('data-match'), 'false');
});

test('busy: aria-busy while the action is held with an ellipsis, not while it only waits out a countdown', async () => {
  const b = boot();
  b.open();
  b.go.disabled = true; b.go.textContent = 'Signing in…'; await tick();
  assert.equal(b.go.getAttribute('aria-busy'), 'true');
  b.go.textContent = 'Try again in 59s'; await tick();
  assert.equal(b.go.getAttribute('aria-busy'), null);
  b.go.disabled = false; b.go.textContent = 'Sign in'; b.go.setAttribute('disabled', ''); b.go.removeAttribute('disabled'); await tick();
  assert.equal(b.go.getAttribute('aria-busy'), null);
});

test('the dialog follows the mode: its name, the doors\' roving tab stop, the panel\'s label; arrows, Home and End move between the doors', async () => {
  const b = boot();
  b.open('signin');
  assert.equal(b.door.getAttribute('aria-label'), 'Sign in');
  assert.equal(b.signInTab.getAttribute('tabindex'), '0'); assert.equal(b.createTab.getAttribute('tabindex'), '-1');
  b.signInTab.focus();
  b.doc.querySelector('.mn__auth-tabs').dispatchEvent.call(b.signInTab, { type: 'keydown', key: 'ArrowRight' });
  await tick();
  assert.equal(b.door.getAttribute('data-auth-mode'), 'create'); assert.equal(b.doc.activeElement, b.createTab);
  assert.equal(b.door.getAttribute('aria-label'), 'Create an account');
  assert.equal(b.createTab.getAttribute('tabindex'), '0'); assert.equal(b.signInTab.getAttribute('tabindex'), '-1');
  assert.equal(b.panel.getAttribute('aria-labelledby'), 'mnCreateTab');
  /* the eight-character rule describes the password only where it shows, in Create account (review DR-m5) */
  assert.equal(b.pass.getAttribute('aria-describedby'), 'mnPasswordHint mnAuthStatus');
  b.createTab.dispatchEvent({ type: 'keydown', key: 'Home' });
  await tick();
  assert.equal(b.door.getAttribute('data-auth-mode'), 'signin'); assert.equal(b.doc.activeElement, b.signInTab);
  assert.equal(b.pass.getAttribute('aria-describedby'), 'mnAuthStatus');
  b.signInTab.dispatchEvent({ type: 'keydown', key: 'End' });
  await tick();
  assert.equal(b.door.getAttribute('data-auth-mode'), 'create');
});

test('a re-open during the 220 ms exit cancels the hide; reduced motion hides at once; only a gesture brings the entrance', async () => {
  let b = boot();
  b.open();
  assert.ok(b.door.classList.contains('is-entering'), 'opened after a gesture: the sheet rises');
  b.back.click();
  assert.ok(b.door.classList.contains('is-leaving')); assert.equal(b.door.hidden, false);
  await tick(60);
  b.open();
  await tick(300);
  assert.equal(b.door.hidden, false); assert.equal(b.gate.isOpen(), true); assert.ok(!b.door.classList.contains('is-leaving'));
  assert.equal(b.door.style.getPropertyValue('pointer-events'), '');
  b = boot({ reduced: true, activation: false });
  b.open();
  assert.ok(!b.door.classList.contains('is-entering'), 'no gesture or reduced motion: whole in its first frame');
  b.back.click();
  assert.equal(b.door.hidden, true, 'reduced motion: hidden at once');
});

test('the visual viewport sizes the door; the privacy banner keeps its room only where it reaches into the door', async () => {
  const b = boot({ vv: { height: 500, offsetTop: 40 } });
  b.open();
  assert.equal(b.door.style.getPropertyValue('--wg-vvh'), '500px');
  assert.equal(b.door.style.getPropertyValue('--wg-vvtop'), '40px');
  assert.equal(b.door.style.getPropertyValue('--wg-head'), '69px');
  assert.equal(b.door.style.getPropertyValue('--wg-veil-top'), '299px');
  const vv = (height, offsetTop) => { b.ctx.visualViewport.height = height; b.ctx.visualViewport.offsetTop = offsetTop; b.vvListeners.resize(); };
  const safe = () => b.door.style.getPropertyValue('--wg-safe-bottom');
  /* at rest the door reaches the foot of the screen (844): the banner (700 to 836, fixed to the layout viewport) lies
     inside it, and the door keeps the banner's height, its 8 px from the foot and 8 px more */
  vv(844, 0);
  assert.equal(b.door.style.getPropertyValue('--wg-vvh'), '844px');
  assert.equal(safe(), String(136 + 8 + 8) + 'px', 'the banner\'s height, its bottom offset and 8 px');
  assert.equal(b.door.hasAttribute('data-banner'), true, 'the door knows the notice is waiting');
  /* the phone's keyboard is up: the visual viewport, and the door with it, ends at 420; the banner stays where it was, under
     the keyboard and below the door's foot. The door keeps no room for a notice that is not in it (it kept 152 px of
     nothing above the keyboard, and left the form a 184 px window) */
  vv(420, 0);
  assert.equal(b.door.style.getPropertyValue('--wg-vvh'), '420px');
  assert.equal(safe(), '0px', 'nothing kept for a banner under the keyboard');
  assert.equal(b.door.hasAttribute('data-banner'), false);
  /* a visual viewport that reaches part of the way into the banner (scrolled down under a short keyboard: 240 to 740) keeps
     only what it overlaps */
  vv(500, 240);
  assert.equal(safe(), String(740 - 700 + 8) + 'px', 'only the part of the banner inside the door, and 8 px');
  assert.equal(b.door.hasAttribute('data-banner'), true);
  /* the keyboard goes down: the banner's room comes back */
  vv(844, 0);
  assert.equal(safe(), '152px');
  b.banner.parentNode.removeChild(b.banner); await tick();
  assert.equal(safe(), '0px', 'the banner gone: the full height comes back');
  assert.equal(b.door.hasAttribute('data-banner'), false);
});

test('the pulse\'s words come from the reads, singular and plural, 500+, and nothing at all when a read is empty or fails', async () => {
  const { gate } = boot();
  const raw = gate.format, plain = (v) => JSON.parse(JSON.stringify(v));
  const f = { missionCard: (...a) => plain(raw.missionCard(...a)), newsCard: (...a) => plain(raw.newsCard(...a)), recordCard: (...a) => plain(raw.recordCard(...a)) };
  const ride = { id: '0e1f0000-0000-4000-8000-000000000001', title: 'Give someone a free ride', domain: 'mutual_aid', points: 100 };
  assert.deepEqual(f.missionCard([ride], '', ''), { id: ride.id, button: true, kicker: 'Open now', value: 'Give someone a free ride', source: 'Mutual aid · 100 points' });
  const tree = { id: '0e1f0000-0000-4000-8000-000000000002', title: 'Plant a street tree', domain: 'community', points: 1 };
  assert.equal(f.missionCard([tree, ride], '', '').kicker, 'Open now · 2 missions');
  assert.equal(f.missionCard([tree, ride], '', '').source, 'Community · 1 point');
  assert.equal(f.missionCard(Array.from({ length: 500 }, (_, k) => ({ ...ride, id: String(k).padStart(36, '0') })), '', '').kicker, 'Open now · 500+ missions');
  assert.equal(f.missionCard([], '', ''), null);
  assert.equal(f.missionCard(null, '', ''), null);
  const mine = f.missionCard([tree, ride], 'mission', ride.id);
  assert.equal(mine.kicker, 'Your mission'); assert.equal(mine.value, 'Give someone a free ride'); assert.equal(mine.button, false);
  assert.equal(f.missionCard([tree, ride], 'people', ride.id).kicker, 'Open now · 2 missions', 'only a mission Join reads as yours');
  assert.deepEqual(f.newsCard({ ok: true, window_hours: 24, countries: { US: 2, BR: 2, KE: 2 }, attribution: { url: 'https://www.gdeltproject.org/' } }), { kicker: 'Last 24 hours', value: 'News from 3 countries', source: 'The GDELT Project', href: 'https://www.gdeltproject.org/' });
  /* a capped read (the API reads at most 15,000 stories) counts a floor, so it says so (review DR-m6) */
  const many = {}; for (let k = 0; k < 183; k++) many['C' + k] = 3;
  assert.equal(f.newsCard({ ok: true, window_hours: 24, countries: many, total: 12296, capped: true }).value, 'News from 183+ countries');
  assert.equal(f.newsCard({ ok: true, window_hours: 24, countries: many, total: 12296, capped: false }).value, 'News from 183 countries');
  assert.equal(f.newsCard({ ok: true, window_hours: 24, countries: { US: 1 }, capped: true }).value, 'News from 1+ countries');
  assert.equal(f.newsCard({ window_hours: 24, countries: { US: 1 } }).value, 'News from 1 country');
  /* the hours are the answer's own (window_hours, 24 in production): another window is quoted as it is, and an answer that
     does not say what window it counted gets no card: the door never states a window it was not told */
  assert.equal(f.newsCard({ window_hours: 48, countries: { US: 1 } }).kicker, 'Last 48 hours');
  assert.equal(f.newsCard({ window_hours: 1, countries: { US: 1 } }).kicker, 'Last hour');
  for (const untold of [{ countries: { US: 1 } }, { window_hours: 0, countries: { US: 1 } }, { window_hours: '24', countries: { US: 1 } }, { window_hours: -24, countries: { US: 1 } }, { window_hours: null, countries: { US: 1 } }]) assert.equal(f.newsCard(untold), null, JSON.stringify(untold));
  assert.equal(f.newsCard({ window_hours: 24, countries: { US: 1 }, attribution: { url: 'javascript:alert(1)' } }).href, 'https://www.gdeltproject.org/');
  assert.equal(f.newsCard({ unavailable: true, countries: { US: 2 } }), null);
  assert.equal(f.newsCard({}), null);
  assert.equal(f.newsCard({ countries: { US: 0 } }), null);
  assert.equal(f.newsCard(null), null, 'a 503 or a timeout reaches the card as nothing');
  const archive = JSON.parse(read('data/action/docket-516r-archive.json'));
  assert.deepEqual(f.recordCard(archive), { kicker: 'On the record', value: 'Docket 516R · Write the Change', source: '10 participants · 9 songs · Bridgeport, CT · Oct 5, 2025' });
  assert.equal(f.recordCard({ ...archive, project: { ...archive.project, status: 'in_progress' } }), null);
  assert.equal(f.recordCard({ ...archive, participants: [] }), null);
  assert.equal(f.recordCard({ ...archive, works: [] }).source, '10 participants · Bridgeport, CT · Oct 5, 2025');
  /* no number is ever invented: the totals of the reads never appear */
  assert.doesNotMatch(JSON.stringify(f.newsCard({ window_hours: 24, countries: { US: 2 }, total: 12296, capped: true })), /12/);
});

test('the reads: each card fills from its own answer, a 503 hides only its card, the record falls back to the static file', async () => {
  const seen = [];
  const archive = JSON.parse(read('data/action/docket-516r-archive.json'));
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (/news-heat/.test(url)) return { ok: false, status: 503, json: async () => ({}) };
    if (/api\.mccluster\.org\/v1\/action-archive/.test(url)) return { ok: false, status: 503, json: async () => ({}) };
    if (/data\/action\/docket-516r-archive\.json/.test(url)) return { ok: true, status: 200, json: async () => archive };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const b = boot({ fetch: fetchImpl });
  b.open('signin', { reason: '', missions: async () => [], openMission: () => {} });
  await tick(20);
  const card = (id) => b.doc.getElementById(id);
  assert.equal(card('wgPulseMission').hidden, true, 'no open mission: no card, no zero');
  assert.equal(card('wgPulseNews').hidden, true, 'news-heat 503: no card');
  assert.equal(card('wgPulseRecord').hidden, false, 'the record from the static file');
  assert.match(card('wgPulseRecord').textContent, /On the record/);
  assert.equal(b.doc.getElementById('wgDateline').hidden, false, 'a card shows, so the dateline does');
  assert.deepEqual(seen, ['https://api.mccluster.org/v1/world/news-heat', 'https://api.mccluster.org/v1/action-archive/docket-516r-2025', 'data/action/docket-516r-archive.json']);
  /* a re-open within five minutes reads nothing again */
  b.back.click(); await tick(260);
  b.open('signin', { reason: '', missions: async () => [], openMission: () => {} });
  await tick(20);
  assert.equal(seen.length, 3);
  /* the credit, with no frame to read: the World's own words */
  assert.equal(b.doc.getElementById('wgCredit').textContent, 'NASA imagery · Natural Earth · © OpenStreetMap');
});

test('the headline\'s faces load on intent or on the first open, never on a guest\'s arrival (review DR-m8)', async () => {
  const b = boot();
  b.showGate('app');
  await tick(5);
  assert.deepEqual(b.doc.fonts.loads, [], 'arriving, and sitting on the World, downloads no face');
  b.join.dispatchEvent({ type: 'pointerdown' });
  assert.deepEqual(b.doc.fonts.loads, ['500 32px "Playfair Display"', 'italic 500 32px "Playfair Display"'], 'a pointer on the header\'s Join fetches both');
  b.join.dispatchEvent({ type: 'focusin' });
  assert.equal(b.doc.fonts.loads.length, 2, 'once');
  /* an open with no intent before it fetches them itself */
  const c = boot();
  c.showGate('app');
  c.open();
  assert.equal(c.doc.fonts.loads.length, 2);
});

test('the focus as the door opens: the first field where a keyboard is at hand, the door itself on a touch screen (review DR-m11)', () => {
  const desk = boot();
  desk.open();
  desk.gate.focus(desk.email);
  assert.equal(desk.doc.activeElement, desk.email);
  const phone = boot({ touch: true });
  phone.open();
  phone.gate.focus(phone.email);
  assert.equal(phone.doc.activeElement, phone.door, 'no field is focused, so no keyboard rises over the sheet');
  /* Escape still closes from there */
  key(phone, 'Escape');
  assert.equal(phone.gate.isOpen(), false);
});

test('the sheet\'s measures: the action\'s need over the fade, and the scrolled flag for the top fade (review DR-M1, DR-M2, DR-m9)', async () => {
  const b = boot();
  b.sheet.rect = { top: 300, bottom: 844, left: 0, right: 390, width: 390, height: 544 };
  b.go.rect = { top: 700, bottom: 756, left: 22, right: 368, width: 346, height: 56 };
  b.sheet.scrollHeight = 700; b.sheet.clientHeight = 544;
  b.open();
  /* the action's foot (756 - 300) + the fade (34) + 4 px */
  assert.equal(b.door.style.getPropertyValue('--wg-need'), '494px');
  assert.ok(b.sheet.hasAttribute('data-more'));
  assert.equal(b.sheet.hasAttribute('data-scrolled'), false);
  b.sheet.scrollTop = 120;
  b.sheet.dispatchEvent({ type: 'scroll' });
  assert.equal(b.sheet.hasAttribute('data-scrolled'), true);
  b.sheet.scrollTop = 0;
  b.sheet.dispatchEvent({ type: 'scroll' });
  assert.equal(b.sheet.hasAttribute('data-scrolled'), false);
  /* never more than the way back allows: the phone's height less the notice's room and 68 px */
  b.go.rect = { top: 1300, bottom: 1356, left: 22, right: 368, width: 346, height: 56 };
  b.sheet.dispatchEvent({ type: 'scroll' });
  assert.equal(b.door.style.getPropertyValue('--wg-need'), String(844 - (136 + 8 + 8) - 68) + 'px');
});

/* release review RS-4 (2026-11-19): on a laptop's window (1366 x 768, 1280 x 720) the floating bar, centred, lay on the
   onboarding page's action at rest, over 87 % of its words, since the pages took one centred measure at 1100 px. From 1100 px
   the bar steps aside, right of that measure; it is moved, never hidden, the phone keeps it where it was, and the listening
   room's bar is left alone. The browser proof is scripts/e2e/world-gate.e2e.mjs (onboard-bar). */
test('on a wide screen the floating bar steps aside from the onboarding pages\' measure, moved and never hidden', () => {
  const all = rules(read('css/world-gate.css'));
  const bar = all.filter((r) => /\.appbar/.test(r.head));
  assert.equal(bar.length, 1, 'one rule touches the bar');
  const [r] = bar;
  assert.equal(r.head, 'html.mn-gate-on body:not([data-world-audio-open]) > .appbar');
  assert.deepEqual(r.at, ['@media (min-width: 1100px)'], 'only where the measure is centred, and never on the phone');
  assert.equal(r.body.trim().replace(/;$/, ''), 'margin-inline: auto calc(24px + env(safe-area-inset-right, 0px))', 'it moves the bar and does nothing else');
  const measure = all.find((x) => x.head === '#mnProfileGate.mn__onboard' && x.at.length === 1 && x.at[0] === r.at[0]);
  assert.ok(measure && /padding-inline: max\(0px, calc\(\(100% - 600px\) \/ 2\)\)/.test(measure.body), 'beside the rule that centres the measure');
});

/* release review RS-9 (2026-11-19), the door's art direction: at 1280 by day the veil (0.94) let the white feed through as a
   grey column with a hard edge against the Earth's black; behind the card the globe kept the news shading, which read as a
   news map; at 390 the record's line was cut to "Bridg…". The browser proof is scripts/e2e/world-gate.e2e.mjs (door-art). */
test('the door\'s art direction: a whole veil, no news shading behind the door, the record\'s line on two lines', () => {
  const all = rules(read('css/world-gate.css'));
  const veil = all.filter((r) => r.head === '#mnSignedOut .wg-veil' && r.at.length === 1 && r.at[0] === '@media (min-width: 1100px)');
  assert.equal(veil.length, 1);
  assert.match(veil[0].body, /background: rgb\(4, 6, 9\)/, 'the veil is whole: nothing of the day feed comes through as a grey column');
  const rec = all.filter((r) => r.head === '#mnSignedOut #wgPulseRecord .wg-card__s' && !r.at.length).map((r) => r.body).join(';');
  assert.match(rec, /-webkit-line-clamp: 2/); assert.match(rec, /white-space: normal/); assert.match(rec, /overflow: hidden/);
  const third = all.filter((r) => r.head === '#mnSignedOut .wg-pulse > .wg-card:nth-child(3 of :not([hidden]))' && r.at.length);
  assert.deepEqual(third.map((r) => r.at.join(' ')), ['@container (min-height: 267px)'], 'the third card waits for the room its second line needs');
  const globe = read('js/world-news-globe.js'), page = read('js/mnet.js');
  assert.match(globe, /tint:scope\(\) !== 'equity' && !doorOpen\(\)/, 'the shading steps aside behind the door');
  assert.match(globe, /window\.addEventListener\('mcc:door', sync\);/, 'and comes back when the door closes');
  assert.match(page, /if \(doorWas !== \(which === "signedout"\)\) \{ try \{ window\.dispatchEvent\(new CustomEvent\("mcc:door"/, 'the page says when the door opens and closes');
});
