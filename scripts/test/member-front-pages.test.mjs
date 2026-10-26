/* EVERY ACCOUNT'S FRONT PAGE (owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this
   exact same experience. The experience being my front page with a VR, with the scroll dependent video, all this.").
   The page engine (js/main.js) checks the settings again as it reads them; the Worker's check (packages/front-config)
   decides what is stored. These hold the two to the same rules, and hold the pages, the doors and the pending SQL to
   their contract. The browser flow is scripts/e2e/member-front.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validateFront, mediaPrefix, frontHref as serverHref } from '../../packages/front-config/index.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const MAIN = read('js/main.js');
const PROJECT = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const UID = '22222222-2222-4222-8222-222222222222', OTHER = '44444444-4444-4444-8444-444444444444';
const PREFIX = mediaPrefix(PROJECT, UID);

/* the engine's own checks, lifted out of js/main.js as they are written */
function engine() {
  const start = MAIN.indexOf('  var FRONT_DEFAULT = {'), end = MAIN.indexOf('  /* AN ACCOUNT\'S OWN FRONT PAGE (front.html');
  assert.ok(start > 0 && end > start, 'the front settings block is where it was');
  const ctx = {};
  vm.runInNewContext(MAIN.slice(start, end) + '\nthis.frontConfig = frontConfig; this.frontHref = frontHref;', ctx);
  return ctx;
}

test('the engine and the Worker agree on every link: on this site or https, never a script', () => {
  const { frontHref } = engine();
  const cases = ['hire.html', 'mnet.html?view=profile&handle=benji.chase', 'https://instagram.com/hitmanbenji', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)',
    'data:text/html,1', '//evil.example', 'http://insecure.example', 'https://x.example/"onmouseover=1', ' ', '', 'a'.repeat(301), 'vbscript:x', '#top', '../up.html'];
  for (const h of cases) assert.equal(frontHref(h) ?? undefined, serverHref(h), JSON.stringify(h));
});

test('the engine plays only media the Worker would have kept: the account\'s own folder of front-media', () => {
  const { frontConfig } = engine();
  const film = (base) => ({ base, count: 48, ext: 'webp', sm: true });
  const media = {
    hero: film(PREFIX + 'films/a1/'),
    scene1: film(`${PROJECT}/storage/v1/object/public/front-media/${OTHER}/films/x/`), // someone else's folder: the Worker drops it
    scene2: film('https://evil.example/storage/v1/object/public/front-media/' + UID + '/films/x/'),
    night: film(PREFIX + 'films/../../x/'),
    cabin: { src: PREFIX + 'cabin-1.jpg', kind: 'image' },
    sound: { src: PREFIX + 'sound-1.wav' }
  };
  const stored = validateFront({ media }, { mediaPrefix: PREFIX }).config.media;
  assert.deepEqual(Object.keys(stored).sort(), ['cabin', 'hero', 'sound']);
  /* what the Worker stores, the engine plays */
  const played = frontConfig({ media: stored }).media;
  assert.equal(played.hero.base, stored.hero.base);
  assert.equal(played.cabin.src, stored.cabin.src);
  assert.equal(played.sound.src, stored.sound.src);
  /* and what it would not, the engine will not play either (a folder rule aside, which only the Worker can know) */
  const raw = frontConfig({ media }).media;
  assert.equal(raw.scene2, null, 'another host');
  assert.equal(raw.night, null, 'a climb out of the folder');
  for (const bad of [{ base: PREFIX + 'f/', count: 7, ext: 'webp' }, { base: PREFIX + 'f/', count: 241, ext: 'webp' }, { base: PREFIX + 'f/', count: 48, ext: 'png' }, { base: PREFIX + 'f', count: 48, ext: 'webp' }, { base: PREFIX + 'f/', count: 48.5, ext: 'webp' }]) {
    assert.equal(frontConfig({ media: { hero: bad } }).media.hero, null, JSON.stringify(bad));
    assert.equal(validateFront({ media: { hero: bad } }, { mediaPrefix: PREFIX }).config.media.hero, undefined, JSON.stringify(bad));
  }
  assert.equal(frontConfig({ media: { cabin: { src: PREFIX + 'c.mp4', kind: 'gif' } } }).media.cabin, null);
});

test('an account\'s 360 room has its own tags or none, never the house\'s (Codex #595)', () => {
  const { frontConfig } = engine();
  assert.equal(frontConfig({}).vr.spots.length, 3, 'the house page keeps its three tags');
  /* (the engine's arrays come from its own context: compared by length) */
  assert.equal(frontConfig({}, true).vr.spots.length, 0);
  assert.equal(frontConfig({ vr: { spots: [] } }, true).vr.spots.length, 0);
  assert.equal(frontConfig({ vr: { spots: [{ label: 'x', href: 'javascript:1' }] } }, true).vr.spots.length, 0);
  assert.equal(frontConfig({ vr: { spots: [{ label: 'My studio', href: 'studio.html' }] } }, true).vr.spots[0].label, 'My studio');
  /* both places the engine reads settings say which page it is */
  assert.match(MAIN, /var FRONT = frontConfig\(MEMBER \? MEMBER\.config : null, !!MEMBER\);/);
  assert.match(MAIN, /FRONT = frontConfig\(raw, !!MEMBER\);/);
});

test('the engine and the Worker bound the settings the same way', () => {
  const { frontConfig } = engine();
  const D = frontConfig(null);
  for (const [raw, path] of [[{ scroll: { duration: 1.8 } }, 'scroll.duration'], [{ scroll: { duration: 1.81 } }, 'scroll.duration'], [{ scroll: { touchLerp: 0.04 } }, 'scroll.touchLerp'],
    [{ night: { arrive: 0.5 } }, 'night.arrive'], [{ night: { arrive: 0.87 } }, 'night.arrive'], [{ vr: { yaw: -180 } }, 'vr.yaw'], [{ vr: { pitch: 86 } }, 'vr.pitch']]) {
    const [a, b] = path.split('.');
    const stored = validateFront(raw, {}).config;
    const kept = stored[a] && stored[a][b];
    const played = frontConfig(raw)[a][b];
    assert.equal(played, kept === undefined ? D[a][b] : kept, JSON.stringify(raw));
  }
});

test('the account page is the house page as a template: same engine, its own words as text, not indexed', () => {
  const html = read('front.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<script defer src="js\/front-member\.js\?v=__STAMP__"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="js\/main\.js/, 'the loader starts the engine once the page is in');
  for (const id of ['orbitCanvas', 'heroTitle', 'workVR', 'workVRCanvas', 'pillars', 'finaleTitle', 'vrGateAllow', 'vrGateDeny', 'soundToggle', 'track-whodidtheshoot'])
    assert.match(html, new RegExp(`id="${id}"`), id);
  const loader = read('js/front-member.js');
  assert.doesNotMatch(loader, /innerHTML/, 'an account\'s words go in as text only');
  assert.match(loader, /s\.src = "js\/main\.js"/);
  assert.match(loader, /fetch\(API \+ "\/v1\/fronts\/" \+ encodeURIComponent\(handle\)/);
  /* the editor's preview takes the draft only from its own parent on this origin */
  assert.match(loader, /e\.origin !== location\.origin \|\| e\.source !== w\.parent/);
  assert.match(MAIN, /\/\(\?:control\|front-studio\)\\\.html\$\//);
  /* an account's media plays on an account's page only, never on the house page, whatever a settings row carries */
  assert.match(MAIN, /function memberFilm\(name\) \{ var k = FILM_KEYS\[name\]; return \(MEMBER && /);
  assert.match(MAIN, /var room = MEMBER \? FRONT\.media\.cabin : null;/);
});

test('the editor: every signed-in account, its own folder, its draft through the Worker', () => {
  const html = read('front-studio.html'), js = read('js/front-studio.js'), media = read('js/front-media.js');
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /js\/front-media\.js/);
  assert.match(html, /js\/front-studio\.js/);
  assert.match(js, /api\(ownPath, \{ method: "POST", body: \{ config: S\.draft, publish: publish \} \}\)/);
  assert.match(js, /api\(publishedPath, \{ method: "DELETE" \}\)/);
  assert.match(js, /var ownPath = projectMode.*"\/v1\/fronts\/me"/);
  assert.match(js, /var publishedPath = projectMode.*"\/v1\/fronts\/me\/published"/);
  /* uploads go to the account's folder named by the Worker, with the account's own session */
  assert.match(media, /x\.open\("POST", "https:\/\/api\.mccluster\.org\/v1\/customer-site\/media\?path=" \+ encodeURIComponent\(path\)\)/);
  assert.match(media, /"x-site-bytes", String\(blob\.size\)/);
  assert.match(media, /"authorization", "Bearer " \+ token/);
  /* what a page no longer uses leaves the account's folder after each save, publish and take-down */
  assert.match(media, /function sweep\(prefixPath, configs\)/);
  assert.equal((js.match(/ sweep\(\);/g) || []).length, 2, 'save/publish and take-down both sweep');
  assert.match(js, /var start = S\.sweeping \|\| Promise\.resolve\(\);/);
  assert.doesNotMatch(media + js, /service_role|SERVICE_ROLE/);
  /* phone first */
  const css = read('css/front-studio.css');
  assert.doesNotMatch(css, /max-width\s*:\s*\d+px\)/, 'min-width queries only');
  assert.doesNotMatch(css, /(?<!minmax\(0,)\b1fr\b(?!\))/, 'minmax(0,1fr), never a bare 1fr');
  assert.match(css, /font:400 max\(16px,1rem\)/);
});

test('the doors: an account\'s card and its artist page lead to its front page and its editor', () => {
  const card = read('member-front.html'), cardJs = read('js/member-front.js'), artist = read('js/music-creator-profile.js');
  assert.match(card, /id="mfBuild"[^>]+href="front-studio\.html"/);
  assert.match(card, /id="mfFront"/);
  assert.match(cardJs, /'Edit my front page'/);
  assert.match(cardJs, /query\.get\('card'\)!=='1'/);
  /* a published page is public: a signed-out visitor to the card is taken in too */
  assert.match(cardJs, /if\(handleRE\.test\(handle\)\)void frontPage\(handle,'@'\+handle,false\);/);
  assert.match(artist, /front-studio\.html/);
});

test('the Worker carries the routes and answers their preflight', () => {
  const entry = read('workers/mccluster/src/entry-platform.js'), pre = read('workers/mccluster/src/preflight.js');
  assert.match(entry, /import \{ handleMemberFronts \} from '\.\/member-fronts\.js'/);
  assert.match(entry, /handleMemberFronts\(request, env\)/);
  assert.match(pre, /'\/v1\/fronts'/);
});

test('the pending SQL: the table is the Worker\'s alone; the bucket writes only to the uploader\'s own folder', () => {
  const sql = read('supabase/pending/member_fronts_v1.sql');
  assert.match(sql, /create table if not exists public\.member_fronts/i);
  assert.match(sql, /alter table public\.member_fronts force row level security/i);
  assert.match(sql, /revoke all on (table )?public\.member_fronts from (public, )?anon, authenticated/i);
  assert.match(sql, /'front-media'/);
  const own = sql.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) || [];
  assert.ok(own.length >= 5, 'select, insert, update and delete are each held to the uploader\'s folder');
  /* one page, not a warehouse: every write is held to the account's room (Codex #595) */
  assert.match(sql, /create or replace function public\.front_media_has_room\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?count\(\*\) < 2500[\s\S]*?< 1073741824/);
  assert.match(sql, /revoke all on function public\.front_media_has_room\(\) from public, anon;/);
  for (const op of ['insert', 'update']) {
    const pol = sql.match(new RegExp(`on storage\\.objects for ${op}[\\s\\S]*?;`));
    assert.ok(pol && /public\.front_media_has_room\(\)/.test(pol[0]), op + ' is held to the account\'s room');
  }
  /* public by the bucket's own flag: no policy lists everyone's uploads */
  for (const pol of sql.matchAll(/create policy "[^"]+"\s+on storage\.objects for (\w+)([\s\S]*?);/g))
    assert.match(pol[2], /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/, pol[1] + ' is held to the folder');
});
