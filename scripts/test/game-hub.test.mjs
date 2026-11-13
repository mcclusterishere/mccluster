/* THE GAME HUB (owner, 2026-11-03: "The learning hub is now the game hub ... each learning module as an icon at the
   bottom of the screen"). Holds data/game-hub/modules.json to its schema and the music pairing rule, the vendored
   Chem-108 data to its pin (js/game-hub/chem108/data/SOURCE.json), the Molecule Rush engine to Chem-108's own alias
   and review semantics, and the page to the house rules (bar, noindex, no purple, mobile first). docs/game-hub/README.md */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModules, musicErrors, isPurple, albumFor, parseHash, hashFor } from '../../js/game-hub/modules.mjs';
import { placeFor, nextIndex, loadPositions, STORE_KEY } from '../../js/game-hub/player.mjs';
import * as E from '../../js/game-hub/chem108/engine.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);
const DOC = JSON.parse(read('data/game-hub/modules.json'));
const ALBUMS = JSON.parse(read('data/albums.json')).albums;
const VENDOR = 'js/game-hub/chem108/data/';
const SOURCE = JSON.parse(read(VENDOR + 'SOURCE.json'));
const D = require(join(ROOT, VENDOR, 'data.js')), X = require(join(ROOT, VENDOR, 'extra-data.js')), CORE = require(join(ROOT, VENDOR, 'core.js'));
const CAT = E.buildCatalog(D, X);
const PAGE = read('game-hub.html');
const CSS = read('css/game-hub.css');

/* a seeded generator so the randomized checks are repeatable */
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('modules.json validates: unique ids, a default, known kinds, albums that exist', () => {
  assert.deepEqual(validateModules(DOC, { albums: ALBUMS }), []);
  assert.deepEqual(DOC.modules.map((m) => m.id), ['prim3-security', 'chem108']);
  const bad = structuredClone(DOC);
  bad.modules[1].id = bad.modules[0].id; bad.modules[0].music.album = 'nope'; bad.modules[1].accent = '#8a2be2';
  const errs = validateModules(bad, { albums: ALBUMS }).join('\n');
  assert.match(errs, /duplicate module id/); assert.match(errs, /nope is not in data\/albums.json/); assert.match(errs, /is purple/);
});

test('every module icon exists; image icons are owner-supplied artwork, used whole', () => {
  for (const m of DOC.modules) {
    if (m.icon.kind === 'image') {
      assert.ok(existsSync(join(ROOT, m.icon.src)), m.icon.src);
      assert.match(m.icon.src, /^assets\/img\/prim3-mark-\d+\.png$/, 'the PRIM3 icon is the supplied mark, scaled only');
      const png = readFileSync(join(ROOT, m.icon.src));
      assert.equal(png.readUInt32BE(16), m.icon.width); assert.equal(png.readUInt32BE(20), m.icon.height);
    }
  }
  assert.equal(DOC.modules.find((m) => m.id === 'chem108').icon.kind, 'glyph', 'no course mark exists for Chem 108, so it gets a plain UI glyph');
  assert.doesNotMatch(read('js/game-hub/hub.mjs'), /prim3[^'"]*\.svg/, 'no drawn PRIM3 mark');
});

test('music pairing: albums exist and are playable; only the course\'s own songs are Rhythm', () => {
  for (const m of DOC.modules) {
    const a = albumFor(ALBUMS, m.music.album);
    assert.ok(a && a.tracks.length >= 2, `${m.id}: ${m.music.album} has tracks`);
    for (const t of a.tracks) assert.ok(existsSync(join(ROOT, t.src)), t.src);
  }
  const sec = DOC.modules.find((m) => m.id === 'prim3-security'), chem = DOC.modules.find((m) => m.id === 'chem108');
  assert.deepEqual([sec.music.album, sec.music.role], ['prim3', 'rhythm']);
  assert.equal(chem.music.role, 'soundtrack');
  assert.equal(chem.music.label, 'Study soundtrack — no chemistry lyrics');
  assert.notEqual(chem.music.album, 'prim3', 'the security tapes would teach the wrong course');
  assert.match(musicErrors({ id: 'x', music: { album: 'here', role: 'soundtrack', label: 'Chem Rhythm' } }).join(), /no course lyrics|never claims Rhythm/);
});

test('the player clamps a remembered place to the album and wraps at the end', () => {
  const album = { tracks: [{}, {}, {}] };
  assert.deepEqual(placeFor({ track: 2, time: 41 }, album), { track: 2, time: 41 });
  assert.deepEqual(placeFor({ track: 9, time: 41 }, album), { track: 0, time: 0 });
  assert.deepEqual(placeFor(undefined, album), { track: 0, time: 0 });
  assert.equal(nextIndex(album, 2), 0);
  const broken = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(loadPositions(broken), { modules: {} });
  assert.equal(STORE_KEY, 'mcc.gamehub.music.v1');
  assert.deepEqual(parseHash(hashFor('chem108', 'molecule-rush')), { module: 'chem108', play: 'molecule-rush' });
});

test('vendored Chem-108 data matches SOURCE.json byte for byte', () => {
  assert.equal(SOURCE.repository, 'mcclusterishere/Chem-108');
  assert.match(SOURCE.commit, /^fb1b038[0-9a-f]{33}$/);
  for (const [file, meta] of Object.entries(SOURCE.files)) {
    const sha = createHash('sha256').update(readFileSync(join(ROOT, VENDOR, file))).digest('hex');
    assert.equal(sha, meta.sha256, `${file} drifted from Chem-108 ${meta.from}`);
  }
});

test('the deck is whole: 306 cards over 14 topics, 49 structures, 118 elements', () => {
  assert.equal(CAT.topics.length, 14);
  assert.equal(CAT.cards.length + CAT.molecules.length, 306);
  assert.equal(CAT.molecules.length, 49);
  assert.equal(CAT.elements.length, 118);
  for (const m of CAT.molecules) assert.match(m.svg, /<svg[\s\S]*<path/);
  for (const name of Object.keys(E.MOLECULE_FAMILY)) assert.ok(CAT.molecules.some((m) => m.name === name), name);
});

test('ported alias and review rules agree with Chem-108\'s own core.js', () => {
  for (const m of D.molecules) for (const v of [m.name, ...m.aliases, m.name.toUpperCase(), ' ' + m.name + ' ', 'hexane']) {
    assert.equal(E.accepted(m, v), CORE.accepted(m, v), `${m.name} / ${v}`);
  }
  const hex = D.molecules.find((m) => m.name === 'hex-1-ene');
  assert.ok(E.accepted(hex, '  1–HEXENE  ')); assert.ok(!E.accepted(hex, 'hex-2-ene'));
  const neo = D.molecules.find((m) => m.name === '2,2-dimethylpropane');
  assert.ok(E.accepted(neo, '2, 2 - dimethylpropane')); assert.ok(!E.accepted(neo, '2,3-dimethylpropane'));
  assert.ok(E.accepted({ name: 'Aluminium', aliases: ['Aluminum'] }, 'aluminum'));
  let a = E.update(null, true, 1000); assert.deepEqual(a, CORE.update(null, true, 1000)); assert.equal(a.due, 601000);
  const b = E.update(a, true, 2000); assert.equal(b.due, 86402000);
  const c = E.update(b, false, 3000); assert.deepEqual([c.streak, c.due, c.correct, c.seen], [0, 63000, 2, 3]);
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }], r = { a: { due: 0 }, b: { due: 5e12 } };
  assert.equal(E.choose(items, r, null, 1e12).id, 'a'); assert.equal(E.choose(items, r, 'a', 1e12).id, 'c');
});

test('every question in every mode: the answer is present once, four distinct options, distractors from its own topic', () => {
  const rand = seeded(7);
  for (const mode of Object.keys(E.MODES)) {
    const items = E.modeItems(CAT, mode);
    const byGroup = new Map(items.map((i) => [i.id, i]));
    for (const item of items) for (let k = 0; k < 3; k++) {
      const q = E.makeQuestion(CAT, mode, item, { rand, aliasChance: 0.5 });
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options.map((o) => E.norm(o.label))).size, 4, `${item.id}: options read the same`);
      const right = q.options.filter((o) => o.correct);
      assert.equal(right.length, 1); assert.ok(E.check(q, right[0].label), `${item.id}: right answer accepted`);
      for (const o of q.options.filter((x) => !x.correct)) {
        assert.ok(!E.check(q, o.label), `${item.id}: distractor ${o.label} is an accepted answer`);
        const src = items.find((i) => i.name === o.label && i.group === item.group);
        assert.ok(src, `${item.id}: distractor ${o.label} is not from ${item.group}`);
        assert.equal(src.deck, byGroup.get(item.id).deck, `${item.id}: distractor from another topic`);
      }
    }
  }
});

test('Name It sometimes shows an accepted alias as the right option, and it scores', () => {
  const hex = E.modeItems(CAT, 'name-it').find((m) => m.name === 'hex-1-ene');
  const q = E.makeQuestion(CAT, 'name-it', hex, { rand: () => 0, aliasChance: 1 });
  const right = q.options.find((o) => o.correct);
  assert.equal(right.label, '1-hexene'); assert.equal(q.answer, 'hex-1-ene');
  assert.equal(E.answer(E.newRound({ mode: 'name-it' }), q, right.label).ok, true);
});

test('topics follow Chem-108 order and each mode filters to its own', () => {
  assert.deepEqual(CAT.topics.map((t) => t.id), ['atoms', 'elements20', 'elements', 'matter', 'bonding', 'quantity', 'acids', 'basics', 'bonds', 'branches', 'groups', 'aromatics', 'reactivity', 'stereo']);
  assert.deepEqual(E.modeTopics(CAT, 'name-it').map((t) => t.id), ['bonds', 'branches', 'groups', 'aromatics']);
  assert.deepEqual(E.modeTopics(CAT, 'element-sprint').map((t) => t.id), ['elements20', 'elements']);
  assert.equal(E.modeTopics(CAT, 'topic-blitz').length, 14);
  assert.ok(E.pool(CAT, 'name-it', 'aromatics').every((q) => q.deck === 'aromatics'));
  assert.equal(E.pool(CAT, 'element-sprint', 'elements20').length, 40);
});

test('scoring: streak multiplier, three lives, sixty seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 12, 99].map(E.multiplier), [1, 1, 1, 2, 2, 3, 5, 5]);
  const item = E.modeItems(CAT, 'element-sprint').find((q) => q.id === 'el-name:6');
  const q = E.makeQuestion(CAT, 'element-sprint', item, { rand: seeded(1) });
  const right = q.options.find((o) => o.correct).label, wrong = q.options.find((o) => !o.correct).label;
  let s = E.newRound({ mode: 'element-sprint' });
  assert.deepEqual([s.lives, s.timeLeft], [3, 60]);
  const pts = [];
  for (let i = 0; i < 4; i++) { const r = E.answer(s, q, right); s = r.state; pts.push(r.points); }
  assert.deepEqual(pts, [100, 100, 200, 200]); assert.equal(s.score, 600); assert.equal(s.bestStreak, 4);
  let r = E.answer(s, q, wrong); s = r.state;
  assert.deepEqual([r.ok, s.streak, s.lives, s.missed.length, s.missed[0].answer], [false, 0, 2, 1, 'Carbon']);
  s = E.answer(E.answer(s, q, wrong).state, q, wrong).state;
  assert.deepEqual([s.lives, s.over, s.reason], [0, true, 'lives']);
  assert.equal(E.answer(s, q, right).points, 0, 'no scoring after the round ends');
  let t = E.newRound({ mode: 'name-it' }); t = E.tick(t, 59.5); assert.equal(t.over, false); t = E.tick(t, 1);
  assert.deepEqual([t.timeLeft, t.over, t.reason], [0, true, 'time']);
});

test('the save keeps best score per mode and accuracy per topic', () => {
  const st = { ...E.newRound({ mode: 'name-it' }), score: 700 };
  let { save, newBest } = E.recordRound(E.emptySave(), st, [{ id: 'm1', deck: 'bonds', ok: true }, { id: 'm2', deck: 'bonds', ok: false }]);
  assert.equal(newBest, true); assert.equal(save.best['name-it'], 700); assert.equal(E.accuracy(save.topics.bonds), 50);
  ({ save, newBest } = E.recordRound(save, { ...st, score: 300 }, []));
  assert.equal(newBest, false); assert.equal(save.best['name-it'], 700);
});

test('the page: shared bar, noindex, module script, mobile-first CSS, no purple', () => {
  assert.match(PAGE, /<script src="js\/tabbar\.js\?v=fc1986ec0f4c"><\/script>/);
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(PAGE, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(PAGE, /js\/game-hub\/hub\.mjs/);
  assert.match(PAGE, /id="ghModules"/); assert.match(PAGE, /data-hub-music-play/);
  assert.match(PAGE, /href="action-globe\.html\?explore=1&amp;games=1"/, 'the hub opens owner-only globe games');
  assert.match(PAGE, /href="city-arcade\.html"/, 'the hub opens City Arcade');
  assert.doesNotMatch(CSS, /@media[^{]*max-width/); assert.doesNotMatch(CSS, /(?<!minmax\(0,)\b1fr/);
  assert.match(CSS, /font-size:max\(16px/);
  for (const hex of CSS.match(/#[0-9a-f]{6}\b/gi)) assert.ok(!isPurple(hex), `${hex} is purple`);
  for (const m of DOC.modules) assert.ok(!isPurple(m.accent));
  assert.match(read('js/site-navigation.js'), /label:'Game Hub'[^}]*game-hub\.html/);
});
