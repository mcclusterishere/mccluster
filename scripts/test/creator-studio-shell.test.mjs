/* Creator Studio, first slice of the redesign: the four-chapter shell and the Take bench.

   What is held here:
   - every element id creator.html had before the shell still exists, once (js/music-creator-studio.js,
     js/creator-onboarding.js and js/music-self-analytics.js find their elements by id);
   - four chapters: Make, Releases, Page, Stats, as a tablist with four tabs and four panels, routed by hash;
   - the viewport never blocks zoom;
   - the new stylesheet and scripts are referenced, and the scripts load before the studio module;
   - the new stylesheet obeys AGENTS.md hard rule 14 (min-width queries only, minmax(0,1fr), no text under 12px)
     and adds no colour of its own: it is built from the Music V2 tokens;
   - the Take bench's arithmetic (trim, fades, WAV) is right, and it never uploads or plays the catalogue.

   The rendered checks (390px overflow, smallest text, smallest target, the import, trim, render and hand-off in
   a real browser) are in scripts/e2e/creator-studio-shell.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const html = read('creator.html');
const css = read('css/creator-studio.css');
const shell = read('js/creator-studio-shell.js');
const take = read('js/creator-studio-take.js');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* the ids of creator.html on origin/main at 7f2644b4, before the shell */
const EXISTING_IDS = ('creatorGate creatorJoin creatorSignIn creatorOnboard cobAvatar cobName cobHandle cobTitle cobForm ' +
  'cobNameField cobNameInput cobHandleField cobHandleInput cobHandleHelp cobGo cobStatus creatorApp creatorSummary cmeAvatar ' +
  'cmeName cmeHandle cmePage cmeEdit artistAnalyticsHeading selfMusicRefresh selfMusicAnalytics creatorIdentity profileForm ' +
  'creatorHandle creatorName creatorBio creatorWebsite creatorAvatarFile creatorAvatarNow creatorBannerFile creatorBannerNow ' +
  'creatorAccent creatorBackground creatorForeground creatorSurface creatorTerms publicProfile profileStatus rateCard ' +
  'creatorServices newService serviceForm serviceTitle servicePrice serviceUnit serviceRoyalty serviceDescription saveService ' +
  'cancelService deleteService serviceStatus albumCard creatorAlbums newAlbum albumForm albumTitle albumKind albumDate ' +
  'albumCover albumCoverNow albumDescription albumFeatured albumTracks albumPool saveAlbum cancelAlbum deleteAlbum albumStatus ' +
  'creatorTracks trackForm trackTitle trackArtist trackGenre trackAlbum trackAccess trackDescription trackMaster trackPreview ' +
  'previewHelp trackArt trackMusicVideo trackLyricsUrl trackLyricSheet trackLyricSheetFile trackLyricSheetHelp trackAccent ' +
  'trackBackground trackForeground trackSurface trackServiceLabel trackServiceUrl trackLyricCtas ownsMaster ' +
  'controlsComposition samplesCleared collaboratorsCleared isDerivative derivativeField derivativePermissions licensePrice ' +
  'licenseTitle licenseTerms releaseTerms submitTrack trackStatus').split(' ');

const idsIn = (src) => [...src.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);

test('every element id creator.html had before the shell still exists, exactly once', () => {
  assert.equal(EXISTING_IDS.length, 110);
  const ids = idsIn(html);
  for (const id of EXISTING_IDS) assert.equal(ids.filter((x) => x === id).length, 1, 'id="' + id + '"');
  assert.equal(new Set(ids).size, ids.length, 'no id is used twice');
});

test('the forms and their fields are still where the studio script reads them', () => {
  for (const [form, fields] of Object.entries({
    profileForm: ['creatorHandle', 'creatorName', 'creatorBio', 'creatorAccent', 'creatorTerms'],
    serviceForm: ['serviceTitle', 'servicePrice', 'saveService'],
    albumForm: ['albumTitle', 'albumTracks', 'saveAlbum'],
    trackForm: ['trackTitle', 'trackMaster', 'trackPreview', 'ownsMaster', 'releaseTerms', 'submitTrack', 'trackStatus']
  })) {
    const open = html.indexOf('id="' + form + '"');
    const close = html.indexOf('</form>', open);
    assert.ok(open > 0 && close > open, form);
    for (const f of fields) {
      const at = html.indexOf('id="' + f + '"');
      assert.ok(at > open && at < close, f + ' is inside #' + form);
    }
  }
  assert.match(html, /<input id="trackMaster" type="file" accept="[^"]*audio\/wav[^"]*" required>/, 'the master input still takes a WAV');
});

test('four chapters: Make, Releases, Page, Stats', () => {
  const chapters = ['make', 'releases', 'page', 'stats'];
  assert.equal((html.match(/id="creatorChapters"/g) || []).length, 1, 'one chapter row');
  assert.equal((html.match(/<a class="cs-tab"/g) || []).length, 4);
  assert.equal((html.match(/<div class="cs-panel"/g) || []).length, 4);
  for (const c of chapters) {
    const tab = html.match(new RegExp('<a class="cs-tab" id="cs-tab-' + c + '"[^>]*>([^<]+)</a>'));
    assert.ok(tab, 'tab ' + c);
    assert.match(tab[0], new RegExp('href="#' + c + '"'), c + ' has a hash route');
    assert.match(tab[0], new RegExp('data-chapter="' + c + '"'));
    assert.match(html, new RegExp('<div class="cs-panel" id="cs-panel-' + c + '" data-chapter="' + c + '"'));
    assert.match(shell, new RegExp('"' + c + '"'));
  }
  assert.deepEqual([...html.matchAll(/<a class="cs-tab"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]), ['Make', 'Releases', 'Page', 'Stats']);
  /* The tab roles are given by the shell, not written in the markup: if the script does not run, the row is not
     announced as four tabs that do nothing, and the stylesheet keeps it out of sight. The rendered roles
     (one tablist, four tabs, four panels, one selected) are checked in the browser run. */
  assert.doesNotMatch(html, /role="tab(list|panel)?"/, 'no tab role in the markup');
  assert.doesNotMatch(html, /aria-selected=/, 'no selected state in the markup');
  assert.match(shell, /setAttribute\("role", "tablist"\)/);
  assert.match(shell, /setAttribute\("role", "tab"\)/);
  assert.match(shell, /setAttribute\("role", "tabpanel"\)/);
  assert.match(shell, /setAttribute\("aria-controls", panels\[k\]\.id\)/);
  assert.match(shell, /setAttribute\("aria-labelledby", tabs\[k\]\.id\)/);
  assert.match(shell, /setAttribute\("aria-selected", on \? "true" : "false"\)/);
  assert.match(shell, /if \(any\) panel\.removeAttribute\("tabindex"\); else panel\.tabIndex = 0;/, 'a chapter with nothing focusable in it can still be reached');
  assert.match(strip(css), /\.cs-tabs:not\(\[role="tablist"\]\)\{display:none\}/);
  /* the chapters live inside the studio, after its opening tag and before the first existing card */
  const app = html.indexOf('id="creatorApp"');
  assert.ok(html.indexOf('id="creatorChapters"') > app && html.indexOf('id="creatorChapters"') < html.indexOf('id="creatorSummary"'));
  /* the shell sorts the existing cards by ids they already have, and names every one */
  for (const id of ['creatorTracks', 'trackForm', 'creatorSummary', 'creatorIdentity', 'albumCard', 'rateCard', 'selfMusicAnalytics']) {
    assert.match(shell, new RegExp('"' + id + '"'), 'the shell places ' + id);
  }
  assert.match(shell, /hashchange/);
  assert.match(shell, /edit=profile/, 'creator.html?edit=profile opens on Page, where the profile form is');
  assert.match(shell, /ArrowRight/);
  assert.match(shell, /ArrowLeft/);
  assert.match(shell, /"Home"/);
  assert.match(shell, /"End"/);
  /* Alt+Left is the browser's Back: the tab keys are left alone when a modifier is held */
  assert.match(shell, /if \(e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey\) return;/);
});

test('the address decides the chapter: element fragments, Back to the entry address, focus kept in sight', () => {
  /* a link written before the chapters existed still lands: mnet.html sends creators to their analytics card */
  const world = read('mnet.html');
  assert.match(world, /href="creator\.html#artistAnalyticsHeading"/);
  assert.match(html, /id="artistAnalyticsHeading"/);
  const code = strip(shell);
  assert.match(code, /function chapterOf\(el\)/, 'a fragment that names an element inside a chapter opens that chapter');
  assert.match(code, /getElementById\(decodeURIComponent\(raw\)\)/);
  assert.match(code, /"selfMusicAnalytics"\]/, 'the analytics card, which holds that heading, is in Stats');
  /* Back to the entry address (no fragment) shows the default chapter again; an unknown fragment is left alone */
  const change = code.slice(code.indexOf('addEventListener("hashchange"'));
  assert.match(change.slice(0, 400), /var t = wanted\(\);\s*if \(!t\.named\) return;\s*show\(t\.chapter\);/);
  assert.match(code, /named: !raw/);
  /* a focused field is scrolled clear of the parked row and of the fixed bottom bar, both measured */
  assert.match(code, /scrollPaddingTop = Math\.ceil\(park \+ row\.offsetHeight \+ 12\) \+ "px"/);
  assert.match(code, /scrollPaddingBottom = under \? under \+ "px" : ""/);
});

test('local chapters only: no second global navigation, the Review link untouched, index.html not involved', () => {
  assert.equal((html.match(/<nav\b/g) || []).length, 1, 'the context bar is still the only <nav> in the markup');
  assert.match(html, /<a href="music-admin\.html">Review<\/a>/);
  assert.doesNotMatch(shell + take, /index\.html/);
});

test('the viewport never blocks zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)">/);
  assert.ok(viewport);
  assert.doesNotMatch(viewport[1], /user-scalable\s*=\s*(no|0)/i);
  assert.doesNotMatch(viewport[1], /maximum-scale/i);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
});

test('the new files are referenced, and load before the studio module', () => {
  assert.match(html, /<link rel="stylesheet" href="css\/creator-studio\.css\?v=__STAMP__">/);
  assert.match(html, /<script src="js\/creator-studio-shell\.js\?v=__STAMP__"><\/script>/);
  assert.match(html, /<script src="js\/creator-studio-take\.js\?v=__STAMP__"><\/script>/);
  assert.ok(html.indexOf('css/music-system-v2.css') < html.indexOf('css/creator-studio.css'), 'after the Music V2 sheet it builds on');
  assert.ok(html.indexOf('js/creator-studio-shell.js') < html.indexOf('js/creator-studio-take.js'));
  assert.ok(html.indexOf('js/creator-studio-take.js') < html.indexOf('js/music-creator-studio.js'));
  assert.ok(html.indexOf('js/mcc-auth.js') < html.indexOf('js/creator-studio-take.js'), 'takes are scoped to the account mcc-auth names');
  assert.match(html, /id="takeBenchMount"/);
});

test('no text-size declaration under 12px in the new stylesheet', () => {
  const code = strip(css);
  const sizes = [...code.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(sizes.length > 20, 'the stylesheet sets text sizes');
  for (const value of sizes) {
    const px = [...value.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1]));
    const rem = [...value.matchAll(/(\d*\.?\d+)rem/g)].map((m) => Number(m[1]) * 16);
    const all = px.concat(rem);
    assert.ok(all.length, 'a size in px or rem: ' + value);
    /* max(16px,1rem) resolves to its largest part; anything else must clear the floor outright */
    const resolved = /^max\(/.test(value) ? Math.max(...all) : Math.min(...all);
    assert.ok(resolved >= 12, 'font-size ' + value + ' is under 12px');
    assert.doesNotMatch(value, /\d(em|vw|vh|%)|clamp\(|min\(/, 'a size that cannot be read off the sheet: ' + value);
  }
  assert.doesNotMatch(code, /(^|[;{\s])font\s*:/, 'no font shorthand hiding a size');
  /* form controls: 16px or more, so iOS does not zoom the page on focus */
  assert.match(code, /font-size:max\(16px,1rem\)/);
});

test('the new stylesheet is mobile first and built from the Music V2 tokens', () => {
  const code = strip(css);
  assert.doesNotMatch(code, /max-width\s*:/, 'no max-width query or cap: breakpoints only add');
  const queries = [...code.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim());
  for (const q of queries) assert.match(q, /^\(min-width:\d+px\)$|^\(prefers-reduced-motion:reduce\)$/, q);
  assert.ok(queries.some((q) => /min-width/.test(q)));
  /* every fractional track has a zero floor */
  const tracks = [...code.matchAll(/grid-template-columns\s*:\s*([^;}]+)/g)].map((m) => m[1]);
  assert.ok(tracks.length > 8);
  for (const t of tracks) {
    const bare = t.replace(/minmax\(0,\s*\d*\.?\d+fr\)/g, '');
    assert.doesNotMatch(bare, /fr/, 'a bare fr track: ' + t);
  }
  /* four equal chapter columns */
  assert.match(code, /\.cs-tabs\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(code, /\.cs-tab\{[^}]*height:44px/);
  assert.match(code, /\.cs-tab\{[^}]*font-size:14px/);
  assert.match(code, /\.cs-tab\[aria-selected="true"\]\{[^}]*border-bottom-color:var\(--music-accent\)/);
  assert.match(code, /\.cs-tab:focus-visible\{[^}]*outline:2px solid/);
  /* no colour of its own: tokens, currentColor and transparent only */
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, 'a hex colour');
  assert.doesNotMatch(code, /\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/, 'a colour function');
  const tokens = new Set([...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const t of tokens) assert.match(t, /^--(music-[a-z0-9-]+|cs-chip-clear)$/, 'only Music V2 tokens: ' + t);
  const system = read('css/music-system-v2.css');
  for (const t of tokens) if (t.startsWith('--music-')) assert.ok(system.includes(t + ':'), t + ' is defined by css/music-system-v2.css');
  /* controls a thumb can hit */
  assert.match(code, /\.creator-btn\{[^}]*min-height:44px/);
  assert.match(code, /input\[type="color"\]\{[^}]*height:44px/);
  assert.match(code, /\.tb-handle\{[^}]*width:44px/);
  /* a field's edge can be seen: the faint token, not the hairline border token */
  assert.match(code, /select\{[^}]*border:1px solid var\(--music-faint\)/);
  assert.match(code, /::placeholder\{color:var\(--music-muted\)/);
});

test('no colour is written in the new scripts either', () => {
  for (const [name, src] of [['js/creator-studio-take.js', take], ['js/creator-studio-shell.js', shell]]) {
    const code = strip(src);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, 'a hex colour in ' + name);
    assert.doesNotMatch(code, /\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/, 'a colour function in ' + name);
  }
  assert.match(strip(take), /getComputedStyle\(box\)\.color/, 'a missing token falls back to the colour the page already has');
});

test('the Take bench uploads nothing and is not a second player', () => {
  const code = strip(take);
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|supabase|authFetch|api\.mccluster\.org/, 'no network call of any kind');
  assert.doesNotMatch(code, /new Audio\(|createElement\(["']audio["']\)|\.play\(\)/, 'no media element: playback is a buffer source');
  assert.match(code, /createBufferSource\(\)/);
  assert.match(code, /MCC_MUSIC\.pause\(\)/, 'the site player is asked to pause');
  assert.match(code, /mcc:music-state/, 'and the bench stops if the site player starts');
  assert.match(code, /getUserMedia/);
  assert.match(code, /MediaRecorder/);
  assert.match(code, /decodeAudioData/);
  assert.match(code, /OfflineAudioContext/);
  assert.match(code, /indexedDB/);
  assert.match(code, /new DataTransfer\(\)/);
  assert.match(code, /getElementById\("trackMaster"\)/);
  assert.match(code, /NotAllowedError/, 'a refused microphone has its own message');
  assert.doesNotMatch(code, /\bconfirm\(|\balert\(/, 'no browser dialogs');
  /* a control that is only waiting keeps focus: aria-disabled, never the disabled property, for busy states */
  assert.doesNotMatch(code, /\$\(id\)\.disabled = !!on/);
  assert.match(code, /setAttribute\("aria-disabled", "true"\)/);
  assert.match(code, /mount\.addEventListener\("click", swallow, true\)/);
  /* Record and Play are named for what a press does; no pressed state contradicts the name */
  assert.doesNotMatch(code, /aria-pressed/);
  /* the list holds no audio: bytes are read when a take is used, opened or downloaded */
  assert.match(code, /createObjectStore\(AUDIO, \{ keyPath: "id" \}\)/);
  assert.match(code, /createObjectStore\(RECS, \{ autoIncrement: true \}\)/, 'a recording in progress is written down as it arrives');
  assert.match(code, /addEventListener\("beforeunload", warnLeaving\)/);
  assert.match(code, /removeEventListener\("beforeunload", warnLeaving\)/, 'and only while one runs');
  assert.match(code, /idb-timeout/, 'a database that never answers does not lock the bench');
  assert.match(code, /d\.addEventListener\("play", function \(\) \{ if \(S\.playing\) pause\(\); \}, true\)/, 'other media starting stops the bench');
  assert.match(code, /ctx\.suspend\(\)/, 'the audio session is given back when idle');
  assert.match(code, /\$\("tbImport"\)\.disabled = !AC;/, 'Import stays off where audio cannot open');
  assert.match(code, /"Delete “" \+ name \+ "” for good\?"/, 'the second Delete press is named for what it does');
  assert.match(code, /e\.key !== "Escape"/);
  /* the listener-file ceiling is the release form's own number */
  const studio = read('js/music-creator-studio.js');
  assert.match(studio, /"creator-previews": 52428800/);
  assert.match(code, /var PREVIEW_MAX_BYTES = 52428800;/);
  assert.doesNotMatch(take + shell + css + html.slice(html.indexOf('id="creatorChapters"'), html.indexOf('id="creatorSummary"')), /BandLab|GarageBand|Soundtrap/i, 'no other product is named');
});

test('trim, fades and the WAV are computed correctly', () => {
  const T = createRequire(import.meta.url)('../../js/creator-studio-take.js');
  /* a region is kept inside the audio, never shorter than the minimum, with fades that fit */
  assert.deepEqual(T.region(2, 0.5, 1.5, 0.25, 0.25), { start: 0.5, end: 1.5, length: 1, fadeIn: 0.25, fadeOut: 0.25 });
  assert.deepEqual(T.region(2, -3, 9, 0, 0), { start: 0, end: 2, length: 2, fadeIn: 0, fadeOut: 0 });
  const tight = T.region(2, 1.99, 1.0, 0, 0);
  assert.ok(tight.end - tight.start >= T.MIN_REGION - 1e-9 && tight.end <= 2);
  const squeezed = T.region(10, 0, 1, 5, 5);
  assert.ok(Math.abs(squeezed.fadeIn + squeezed.fadeOut - 1) < 1e-9, 'two fades never overlap');
  /* the envelope */
  assert.equal(T.envelope(0, 1, 0.25, 0.25), 0);
  assert.equal(T.envelope(0.125, 1, 0.25, 0.25), 0.5);
  assert.equal(T.envelope(0.5, 1, 0.25, 0.25), 1);
  assert.ok(Math.abs(T.envelope(0.875, 1, 0.25, 0.25) - 0.5) < 1e-9);
  assert.equal(T.envelope(1, 1, 0.25, 0.25), 0);
  assert.equal(T.envelope(0.3, 1, 0, 0), 1);
  /* a WAV: 16-bit PCM, interleaved, clipped, with a header that says what it holds */
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, 0]);
  const right = Float32Array.from([1, 1, 1, 1, 1, 1, 1, 1]);
  const wav = T.encodeWav([left, right], 8000);
  assert.equal(wav.byteLength, 44 + 8 * 2 * 2);
  assert.deepEqual(T.wavInfo(wav), { channels: 2, sampleRate: 8000, bits: 16, frames: 8, duration: 0.001 });
  const v = new DataView(wav);
  const text = (at) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  assert.deepEqual([text(0), text(8), text(12), text(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(v.getUint32(4, true), wav.byteLength - 8);
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint32(28, true), 8000 * 2 * 2, 'byte rate');
  const sample = (frame, ch) => v.getInt16(44 + (frame * 2 + ch) * 2, true);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((f) => sample(f, 0)), [0, 16384, -16384, 32767, -32768, 32767, -32768]);
  assert.equal(sample(0, 1), 32767);
  assert.equal(T.wavInfo(new ArrayBuffer(10)), null);
  /* a trimmed, faded region written straight from the channels: the same envelope, sample for sample */
  {
    const sr = 1000, src = new Float32Array(2000).fill(0.5);
    const r = T.region(2, 0.5, 1.5, 0.25, 0.25);
    const out = T.encodeRegion([src], sr, r);
    const info = T.wavInfo(out);
    assert.deepEqual(info, { channels: 1, sampleRate: 1000, bits: 16, frames: 1000, duration: 1 });
    const o = new DataView(out), at = (f) => o.getInt16(44 + f * 2, true);
    assert.equal(at(0), 0, 'a fade in starts from silence');
    assert.equal(at(125), 8192, 'half way up the fade in');
    assert.equal(at(500), 16384, 'full level between the fades');
    assert.equal(at(875), 8192, 'half way down the fade out');
    assert.ok(Math.abs(at(999)) <= 66, 'and ends at silence');
    for (const f of [0, 125, 250, 500, 750, 875, 999]) {
      assert.ok(Math.abs(at(f) - Math.round(0.5 * 32768 * T.envelope(f / sr, 1, 0.25, 0.25))) <= 1, 'frame ' + f + ' follows the envelope');
    }
    assert.deepEqual(T.regionFrames(2000, sr, T.region(2, 1.9, 2.5, 0, 0)), { start: 1900, frames: 100, fadeIn: 0, fadeOut: 0 });
  }
  /* a 16-bit file that is only trimmed keeps its samples exactly */
  {
    const ints = [0, 1, -1, 2, 12345, -12345, 16384, 32766, 32767, -32767, -32768];
    const back = T.encodeWav([Float32Array.from(ints, (s) => s / 32768)], 44100);
    const b = new DataView(back);
    assert.deepEqual(ints.map((_, i) => b.getInt16(44 + i * 2, true)), ints);
    /* and the same where the decoder divides positive samples by 32767 (Chromium): the writer is told which */
    const chromium = T.encodeWav([Float32Array.from(ints, (s) => (s < 0 ? s / 32768 : s / 32767))], 44100, 32767);
    const c = new DataView(chromium);
    assert.deepEqual(ints.map((_, i) => c.getInt16(44 + i * 2, true)), ints);
  }
  /* a file's length is read from its header, before any of it is decoded */
  {
    const tone = T.encodeWav([new Float32Array(8000), new Float32Array(8000)], 8000);
    assert.deepEqual(T.wavProbe(new Uint8Array(tone), tone.byteLength), { duration: 1, sampleRate: 8000, channels: 2 });
    /* only the head of a long file is read: the data chunk's own size says how long it is */
    const head = new Uint8Array(T.encodeWav([new Float32Array(4)], 8000).slice(0, 44));
    new DataView(head.buffer).setUint32(40, 31 * 60 * 8000 * 2, true);
    const long = T.wavProbe(head, 44 + 31 * 60 * 8000 * 2);
    assert.equal(long.duration, 31 * 60);
    assert.match(T.tooLong(long), /31 minutes long/);
    assert.equal(T.tooLong({ duration: 10 * 60, sampleRate: 48000, channels: 2 }), '');
    assert.match(T.tooLong({ duration: 25 * 60, sampleRate: 48000, channels: 2 }), /more than a browser tab can hold/);
    assert.equal(T.tooLong({ duration: 25 * 60, sampleRate: 48000, channels: 1 }), '', 'mono is half the memory');
    assert.equal(T.tooLong(null), '', 'an unreadable header is settled after decoding instead');
    assert.equal(T.wavProbe(new Uint8Array(64), 64), null);
    /* MP3, constant bitrate: MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo; five hours of it */
    const frame = new Uint8Array(512); frame.set([0xFF, 0xFB, 0x90, 0x00]);
    const fiveHours = 5 * 3600 * 16000;
    const cbr = T.mp3Probe(frame, fiveHours);
    assert.equal(Math.round(cbr.duration), 5 * 3600);
    assert.deepEqual([cbr.sampleRate, cbr.channels], [44100, 2]);
    assert.match(T.tooLong(cbr), /300 minutes long/);
    /* MP3 with a frame count written by the encoder (variable bitrate): the count wins over the file size */
    const vbr = new Uint8Array(512); vbr.set([0xFF, 0xFB, 0x90, 0xC0]);
    vbr.set([0x58, 0x69, 0x6E, 0x67, 0, 0, 0, 1, 0, 0, 0x27, 0x10], 36);
    const counted = T.mp3Probe(vbr, 123);
    assert.ok(Math.abs(counted.duration - 10000 * 1152 / 44100) < 1e-9);
    assert.equal(counted.channels, 1);
    assert.equal(T.mp3Probe(new Uint8Array(512), 512), null);
    const tag = new Uint8Array(10); tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x02, 0x01]);
    assert.equal(T.id3Size(tag), 10 + 257);
    assert.equal(T.id3Size(frame), 0);
    /* M4A: the movie header, duration over timescale */
    const moov = new Uint8Array(64); moov.set([0x6D, 0x76, 0x68, 0x64], 4);
    const mv = new DataView(moov.buffer); mv.setUint32(20, 1000); mv.setUint32(24, 2400000);
    assert.equal(T.mvhdProbe(moov).duration, 2400);
    assert.match(T.tooLong(T.mvhdProbe(moov)), /40 minutes long/);
    assert.equal(T.mvhdProbe(new Uint8Array(64)), null);
  }
  /* the picture */
  const p = T.peaks([Float32Array.from([0, 1, -1, 0, 0.25, -0.5, 0, 0])], 2);
  assert.deepEqual(Array.from(p), [-1, 1, -0.5, 0.25]);
  /* names and clocks */
  assert.equal(T.clock(0), '0:00.00');
  assert.equal(T.clock(61.239), '1:01.24');
  assert.equal(T.stem('My song (final).WAV'), 'My song (final)');
  assert.equal(T.safeName('  a/b\\c:d  '), 'a b c d');
  assert.equal(T.safeName(''), 'Take');
  /* the session document a take carries, for the multitrack sessions that come later */
  const doc = T.sessionDoc({ id: 'x', name: 'N', duration: 1.5, sampleRate: 48000 });
  assert.equal(doc.tracks.length, 1);
  assert.deepEqual(doc.tracks[0].clips, [{ id: 'c1', take: 'x', at: 0, offset: 0, duration: 1.5 }]);
});

test('the roadmap says what this slice built and what it did not', () => {
  const doc = read('docs/control-plane/CREATOR-STUDIO-ROADMAP.md');
  assert.match(doc, /Take bench/);
  for (const later of [/multitrack/i, /mixer/i, /loops/i, /cloud/i, /collaborat/i, /mastering/i]) assert.match(doc, later);
  assert.match(doc, /not built/i);
});
