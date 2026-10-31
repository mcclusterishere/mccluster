/* MATTHEW'S FRONT PAGE OPENS IN THE VAUNT CABIN (owner, 2026-10-29).
   "matthew.mccluster.org index.html must no longer open on the spinning/orbit hero ... The page now opens INSIDE the
   Vaunt 360 cabin ... It plays immediately on load, muted, with NO Allow/Cancel gate ... The page's song is always
   Antisocial ... a Control Room switch ... that hides his front page from the public."
   These pin that decision in the source: the page, its engine (js/main.js), the Control Room view and the server's
   check of the settings (packages/front-config). The browser flows are scripts/e2e/vaunt-project.e2e.mjs and
   scripts/e2e/control-front-page.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validateFront, STARTS, SONGS } from '../../packages/front-config/index.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const HTML = read('index.html'), MAIN = read('js/main.js'), CR = read('js/control-room/front-page.js');
const CSS = read('css/front-cabin.css');

function engine() {
  const start = MAIN.indexOf('  var FRONT_DEFAULT = {'), end = MAIN.indexOf('  /* AN ACCOUNT\'S OWN FRONT PAGE (front.html');
  assert.ok(start > 0 && end > start);
  const ctx = {};
  vm.runInNewContext(MAIN.slice(start, end) + '\nthis.frontConfig = frontConfig; this.SONGS = FRONT_SONGS;', ctx);
  return ctx;
}

test('the orbit hero is out of the page: no #hero, no orbit canvas, no hero frames, no degree readout', () => {
  for (const gone of ['id="hero"', 'id="orbitCanvas"', 'id="heroFallback"', 'hero_0001', 'id="hudDeg"', '000°', 'assets/video/hero.mp4'])
    assert.ok(!HTML.includes(gone), gone);
});

test('the page opens inside the cabin: first section, the real 360 film and poster, no gate', () => {
  const main = HTML.slice(HTML.indexOf('<main id="top">'), HTML.indexOf('</main>')).replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const firstSection = main.match(/<section\b[^>]*>/);
  assert.match(firstSection[0], /id="cabin"/, 'the first scene in the page is the cabin');
  assert.match(main, /<div class="workvr cabin-open__room" id="workVR"/);
  assert.match(main, /id="workVRCanvas"/);
  assert.match(main, /src="assets\/img\/vaunt-360-poster\.jpg"/);
  assert.match(main, /id="cabinContinue"/, 'a clear way to move on');
  assert.doesNotMatch(main, /vrGateAllow|vrGateDeny|vrbrief--gate|Blurred until/, 'no Allow / Cancel');
  /* the doors and the one h1, Matthew-first (rule 15) */
  assert.match(main, /<h1 class="cabin-open__title" id="cabinTitle">Matthew McCluster<\/h1>/);
  assert.equal((main.match(/<h1\b/g) || []).length, 1);
  assert.match(main, /class="hero__doors"/);
  /* then the plane, the night descent with LOCK IN, and the World after the page */
  const order = ['id="cabin"', 'id="work"', 'id="pillars"', 'id="nightRoom"', 'id="lockRoom"', '</main>', 'id="guestWorld"'].map((x) => HTML.indexOf(x));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
});

test('the engine plays the cabin at once, muted, no gate; scroll, Escape and Continue move on; reduced motion waits on the poster', () => {
  assert.match(MAIN, /var CABIN_FIRST = !MEMBER && !!document\.getElementById\("cabin"\);/);
  const block = MAIN.slice(MAIN.indexOf('/* ---- THE OPENING CABIN'), MAIN.indexOf('/* ---- the sound beacon'));
  assert.ok(block.length > 500);
  assert.match(block, /src: "assets\/video\/vaunt-360\.mp4", video: true/);
  assert.match(block, /workVR\.allowed = true;/, 'nothing is withheld');
  assert.doesNotMatch(block, /openGate\(|is-gated|vrGateAllow/);
  assert.match(block, /if \(prefersReduced && !cabinAsked\) return;/, 'reduced motion: the poster until asked');
  assert.match(block, /wheel: false/, 'the wheel scrolls on, it does not zoom');
  assert.match(block, /safe: function \(\) \{ return cabinSafe \|\| measureCabinSafe\(\); \}/, 'tags stay whole on screen and clear of the words');
  assert.match(read('js/vr360.js'), /var safe = typeof opts\.safe === "function" \? opts\.safe\(\) : null;/);
  assert.match(block, /touchAction: "pan-y"/, 'an upward swipe is the scroll that moves on');
  assert.match(HTML, /id="cabin"[^>]*data-lenis-prevent-touch/);
  assert.match(block, /e\.key !== "Escape"/);
  assert.match(block, /cabinContinue\("escape"\)/);
  /* the 360 video is never unmuted: js/vr360.js mutes it and nothing turns that off */
  assert.match(read('js/vr360.js'), /media\.muted = true;/);
  assert.doesNotMatch(MAIN, /viewer\.media\.muted\s*=\s*false/);
  assert.match(read('js/vr360.js'), /if \(opts\.wheel !== false\) canvas\.addEventListener\("wheel"/);
  /* the cabin inside the films (an account's front.html) keeps its band and its gate */
  assert.match(MAIN, /if \(CABIN_FIRST\) return;   \/\/ the opening cabin is its own scene/);
});

test('one song for the whole page, and it is Antisocial; the first gesture turns it on, the Sound pill decides after', () => {
  assert.match(MAIN, /var HOUSE_TRACK = MEMBER \? "whodidtheshoot" : FRONT\.song;/);
  const { frontConfig } = engine();
  assert.equal(frontConfig(null).song, 'antisocial');
  assert.match(HTML, /<audio id="track-antisocial"[^>]*>\s*<source src="assets\/audio\/antisocial\.mp3"/);
  assert.match(MAIN, /name = HOUSE_TRACK;/, 'fadeTo still pins every route to the one song');
  assert.match(MAIN, /if \(CABIN_FIRST && !framedByControl\) armFirstGesture\(\);/);
  assert.match(MAIN, /toggle\.classList\.contains\("was-used"\)/, 'the Sound pill\'s answer stands');
  assert.match(MAIN, /\[id\^="mccPrivacy"\]/, 'never from the privacy notice');
  assert.match(MAIN, /navigator\.userActivation && !navigator\.userActivation\.isActive/);
});

test('tucked away: a holding screen and noindex for visitors, the real page for the owner, honest copy', () => {
  assert.match(HTML, /<section class="front-holding" id="frontHolding"/);
  assert.ok(HTML.indexOf('id="frontHolding"') > HTML.indexOf('</main>') && HTML.indexOf('id="frontHolding"') < HTML.indexOf('id="guestWorld"'), 'the World and footer stay below it');
  assert.match(HTML, /localStorage\.getItem\("mcc_front_tucked"\)==="1"/, 'no flash for a browser that last saw it tucked');
  assert.match(CSS, /html\[data-front-tucked\] main#top/);
  assert.doesNotMatch(CSS, /html\[data-front-tucked\][^{]*(appbar|guestWorld|site-foot)/, 'the bar, World and footer are never hidden');
  const vis = MAIN.slice(MAIN.indexOf('/* ---------------- TUCKED AWAY'), MAIN.indexOf('/* the saved settings: read now'));
  assert.match(vis, /robots\.name = "robots"; robots\.content = "noindex"/);
  assert.match(vis, /data-appbar-admin/, 'the owner is the server\'s answer, via the bar');
  assert.match(vis, /mcc:appbar-admin/);
  assert.match(vis, /it does not make it secret/i);
  /* the Control Room says the same thing in the owner's words */
  assert.match(CR, /check\("visible","Show my front page to the public"/);
  assert.match(CR, /It does not make it secret\. This is a static site on GitHub Pages/);
  assert.match(CR, /"See it as a visitor"/);
});

test('Control → Front page: start scene, song, visibility and the cabin settings (view, tags) are back', () => {
  for (const name of ['"start"', '"song"', 'check("visible"', 'num("vr.yaw"', 'num("vr.pitch"', 'data-cfp="view"', 'spot.\'+i+\'.href', 'data-cfp="spot"'])
    assert.ok(CR.includes(name), name);
  assert.match(CR, /\["cabin","Cabin"\]/);
  assert.match(CR, /antisocial:"Antisocial \(as shipped\)"/);
  assert.match(CR, /cabin:"In the 360 cabin \(as shipped\)"/);
});

test('front-config: start, song and visible are checked on the server the way the page checks them', () => {
  const { frontConfig, SONGS: pageSongs } = engine();
  assert.deepEqual([...STARTS], ['cabin', 'plane']);
  assert.deepEqual([...SONGS], [...pageSongs], 'the server and the page know the same songs');
  for (const song of SONGS) assert.ok(HTML.includes(`<audio id="track-${song}"`), 'index.html carries ' + song);
  /* kept */
  const good = validateFront({ start: 'plane', song: 'here', visible: false });
  assert.deepEqual(good.dropped, []);
  assert.equal(good.config.start, 'plane');
  assert.equal(good.config.song, 'here');
  assert.equal(good.config.visible, false);
  assert.equal(validateFront({ visible: true }).config.visible, true);
  /* dropped, named, and absent from what is stored */
  const bad = validateFront({ start: 'hero', song: 'javascript:alert(1)', visible: 'no' });
  assert.deepEqual(bad.dropped.sort(), ['song', 'start', 'visible']);
  for (const k of ['start', 'song', 'visible']) assert.ok(!(k in bad.config), k);
  /* missing is simply absent: the page keeps the shipped value */
  const none = validateFront({});
  for (const k of ['start', 'song', 'visible']) assert.ok(!(k in none.config), k);
  /* and the page agrees on every case */
  const D = frontConfig(null);
  assert.equal(D.start, 'cabin'); assert.equal(D.song, 'antisocial'); assert.equal(D.visible, true);
  for (const raw of [{ start: 'plane', song: 'here', visible: false }, { start: 'hero', song: 'nope', visible: 'no' }, {}, { visible: 0 }]) {
    const stored = validateFront(raw).config, played = frontConfig(raw);
    for (const k of ['start', 'song', 'visible']) assert.equal(played[k], k in stored ? stored[k] : D[k], k + ' ' + JSON.stringify(raw));
  }
});

test('phone first: the new sheet adds room with min-width only, 16px controls, no bare 1fr', () => {
  assert.doesNotMatch(CSS, /@media[^{]*max-width/);
  assert.doesNotMatch(CSS, /(?<!minmax\(0,)\b1fr\b/);
  assert.match(CSS, /font:700 max\(16px,\.9rem\)/);
  assert.match(HTML, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(HTML, /css\/front-cabin\.css\?v=e80cb0a13768/);
});
