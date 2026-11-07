/* The globe's Games overlay: its registry (docs/universe/universe-registry.json → gamesWorld), the published file
   (data/games/world.v1.json, derived by tools/publish-games-world.mjs), every link it offers, and the storyline
   schedule's "now / next" math. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildGamesWorld, serialize, ROOT, OUTPUT, REGISTRY } from '../../tools/publish-games-world.mjs';

const read = (p) => readFile(resolve(ROOT, p), 'utf8');
const readJson = async (p) => JSON.parse(await read(p));
/* js/globe-games.js is a classic browser script; it exports HuGames onto globalThis outside a page */
createRequire(import.meta.url)('../../js/globe-games.js');
const { scheduleAt, findTown, townStorylines, routes, resolveRequires } = globalThis.HuGames;
const exists = (p) => access(resolve(ROOT, p)).then(() => true, () => false);

const world = await readJson(OUTPUT);
const registry = await readJson(REGISTRY);

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
function* towns(w) { for (const c of w.countries) for (const s of c.states) for (const t of s.towns) yield { c, s, t }; }

test('the published file is exactly what the publisher derives from the registry', async () => {
  assert.equal(await read(OUTPUT), serialize(await buildGamesWorld()), 'run node tools/publish-games-world.mjs');
});

test('the registry is extended, not paralleled: gamesWorld lives in the universe registry and the schema documents it', async () => {
  const gw = registry.gamesWorld;
  assert.equal(gw.schema, 'here.games-world/v1');
  assert.equal(gw.published, OUTPUT);
  assert.ok(Number.isFinite(Date.parse(gw.scheduleEpoch)));
  assert.match(await read('docs/universe/UNIVERSE-SCHEMA.md'), /gamesWorld/);
  /* the old Uprise World is left alone: nothing here routes into it */
  assert.ok(!routes(world).some((r) => /uprise-world/.test(r)));
});

test('schema: country → state → town, each town with real coordinates and at least one destination', () => {
  const ids = new Set();
  for (const c of world.countries) {
    assert.match(c.id, /^[a-z0-9-]+$/); assert.ok(c.name && c.region, c.id);
    assert.ok(!ids.has(c.id), 'duplicate country ' + c.id); ids.add(c.id);
    for (const s of c.states) {
      assert.match(s.id, /^[a-z0-9-]+$/); assert.ok(s.towns.length, s.id);
      for (const t of s.towns) {
        assert.match(t.id, /^[a-z0-9-]+$/);
        assert.ok(Math.abs(t.lat) <= 90 && Math.abs(t.lon) <= 180, t.id);
        assert.ok(t.entries.length, t.id + ' has nothing to start');
        for (const e of t.entries) {
          assert.ok(['place', 'story', 'mission', 'game', 'lab'].includes(e.kind), e.id);
          assert.ok(e.title && e.route && e.blurb && e.blurb.text && e.blurb.source, e.id);
          if (e.neighborhood) assert.ok(t.neighborhoods.some((n) => n.id === e.neighborhood), e.id + ' names an unknown neighborhood');
        }
        for (const id of t.storylines) assert.ok(world.storylines.some((x) => x.id === id), t.id + ' lists unknown storyline ' + id);
      }
    }
  }
  assert.ok(!/coming soon/i.test(JSON.stringify(world)), 'only real destinations are listed');
});

test('blurbs are quoted from their cited sources, never newly written', async () => {
  const cache = new Map();
  const corpus = async (src) => {
    if (!cache.has(src)) { const raw = await read(src); cache.set(src, src.endsWith('.json') ? strings(JSON.parse(raw)).join('\n') : raw); }
    return cache.get(src);
  };
  for (const { t } of towns(world)) {
    for (const x of [...t.entries, ...t.neighborhoods]) {
      if (!x.blurb) continue;
      assert.ok((await corpus(x.blurb.source)).includes(x.blurb.text), `${x.id}: blurb not found in ${x.blurb.source}`);
    }
  }
});

test('every link resolves to a file in this repository, and every query it carries is one that page reads', async () => {
  const levels = await read('js/prim3-tactics/levels/index.mjs');
  const b1 = await read('js/prim3-tactics/missions/blind-the-floor.mjs');
  const city = await read('js/fictional-city/app.mjs');
  const prim3 = await readJson('data/prim3/world-missions.json');
  const arcade = await readJson('data/city-arcade/catalog.v1.json');
  assert.match(await read('js/city-arcade/app.mjs'), /get\('game'\)/, 'the arcade reads ?game=');
  const all = routes(world);
  assert.ok(all.length > 30);
  /* a conditional slot's own query is checked only once the feature it waits for is in this checkout */
  const pending = new Set();
  for (const { t } of towns(world)) for (const e of t.entries) if (e.requires && !(await exists(e.requires.source))) pending.add(e.route);
  const screenModes = JSON.stringify((await readJson('screens/data/screen-registry-v1.json')));
  for (const r of all) {
    const u = new URL(r, 'https://matthew.mccluster.org/');
    assert.ok(!/^[a-z]+:/i.test(r) && !r.startsWith('/'), 'relative route only: ' + r);
    await access(resolve(ROOT, u.pathname.slice(1)));
    const q = u.searchParams;
    if (u.pathname === '/prim3-transit.html') {
      if (q.has('level')) assert.match(levels, new RegExp(`'${q.get('level')}':`), r);
      if (q.has('side')) assert.match(b1, new RegExp(`SIDES = \\[[^\\]]*'${q.get('side')}'`), r);
      if (q.has('mission')) assert.ok(prim3.missions.some((m) => m.id === q.get('mission')), r);
    }
    if (u.pathname.startsWith('/screens/') && q.has('mode')) assert.ok(screenModes.includes('"' + q.get('mode') + '"'), r + ' names a registered screen mode');
    if (u.pathname === '/screens/terminal.html' && q.has('tab') && !pending.has(r)) assert.match(await read('js/eu-screens/apps/terminal.mjs'), new RegExp(`id: "${q.get('tab')}"`), r);
    if (u.pathname === '/city-arcade.html') assert.ok(arcade.games.some((g) => g.id === q.get('game') && g.status === 'playable'), r + ' is a playable arcade game');
    if (u.pathname === '/fictional-city.html' && q.has('entry')) assert.match(city, new RegExp(`entry === '${q.get('entry')}'`), r);
  }
});

test('Bridgeport, Connecticut carries the city, the Robbery 1s, the garage, the HQ and both sides of B1', () => {
  const f = findTown(world, 'us/connecticut/bridgeport');
  assert.ok(f, 'United States → Connecticut → Bridgeport');
  assert.equal(world.countries[0].id, 'us', 'the United States is listed first');
  const r = f.town.entries.map((e) => e.route);
  for (const want of ['fictional-city.html', 'fictional-city.html?entry=bridgeport', 'fictional-city.html?entry=garage', 'prim3-transit.html?level=equity-uprise-hq',
    'prim3-transit.html?level=equity-uprise-b1&side=defend', 'prim3-transit.html?level=equity-uprise-b1&side=attack', 'equity-uprise-server-lab-3d.html', 'screens/building.html']) assert.ok(r.includes(want), want);
  assert.deepEqual(townStorylines(world, 'us/connecticut/bridgeport').map((s) => s.id), ['robbery-1s', 'whip-equipped', 'b1-blind-the-floor']);
});

test('PRIM3 World missions that name a real place are listed there, each opening its own mission', async () => {
  const prim3 = await readJson('data/prim3/world-missions.json');
  const listed = [...towns(world)].flatMap(({ t }) => t.entries).filter((e) => e.universe === 'prim3-world');
  assert.equal(listed.length, prim3.missions.length, 'every PRIM3 World mission has a mapped place');
  for (const m of prim3.missions) {
    const e = listed.find((x) => x.id === 'prim3-' + m.id);
    assert.ok(e, m.id); assert.equal(e.route, 'prim3-transit.html?mission=' + m.id + '&new=1');
    const at = registry.gamesWorld.imports[0].places[m.id];
    assert.ok(m.place.startsWith(at.town) || m.place === at.town, `${m.id}: town ${at.town} is the mission's own place ${m.place}`);
  }
  assert.ok(findTown(world, 'jp/aichi/kariya'));
});

test('the city expansion: its playable neighbourhoods are places in Bridgeport; its businesses are not separate destinations', async () => {
  const city = await readJson('core/data/fictional-city/district.v1.json');
  const t = findTown(world, 'us/connecticut/bridgeport').town;
  const fresh = city.expansionNeighborhoods.filter((n) => n.authorship === 'new-2026-11-03');
  assert.ok(fresh.length >= 4);
  for (const n of fresh) {
    const e = t.entries.find((x) => x.id === 'city-' + n.id);
    assert.ok(e && e.kind === 'place' && e.route === 'fictional-city.html' && e.title === n.name, n.id);
    assert.ok(n.lore.startsWith(e.blurb.text), n.id + ' quotes its own lore');
  }
  const text = JSON.stringify(world);
  for (const b of city.expansionBusinesses || []) assert.ok(!text.includes('"' + b.id + '"'), b.id + ' is reached through its neighbourhood, not listed alone');
});

test('the City Arcade lists only its playable games, under Bridgeport', async () => {
  const arcade = await readJson('data/city-arcade/catalog.v1.json');
  const t = findTown(world, 'us/connecticut/bridgeport').town;
  const listed = t.entries.filter((e) => e.kind === 'game').map((e) => e.id).sort();
  assert.deepEqual(listed, arcade.games.filter((g) => g.status === 'playable').map((g) => 'arcade-' + g.id).sort());
  assert.ok(t.neighborhoods.some((n) => n.id === 'city-arcade'));
});

test('storylines are seeded from their sources: Robbery 1s 13 scenes in 7 acts, Whip Equipped in canon order, B1 at its anchors', async () => {
  const city = await readJson('core/data/fictional-city/district.v1.json');
  const arc = city.storyArcs.find((a) => a.id === 'robbery-1s');
  const rob = world.storylines.find((s) => s.id === 'robbery-1s');
  assert.equal(rob.scenes.length, 13);
  assert.deepEqual(rob.scenes.map((s) => s.id), arc.beats.map((b) => b.id));
  assert.deepEqual([...new Set(rob.scenes.map((s) => s.act))], [1, 2, 3, 4, 5, 6, 7]);
  rob.scenes.forEach((s, i) => { assert.equal(s.title, arc.beats[i].title); assert.equal(s.summary, arc.beats[i].summary); assert.deepEqual(s.anchor.position, arc.beats[i].position); assert.equal(s.anchor.placeId, arc.beats[i].placeId); });
  assert.equal(rob.neighborhood, arc.neighborhoodId);

  const canon = await readJson('docs/music/whip-equipped/CANON.json');
  const timing = await readJson('docs/music/whip-equipped/TIMING.json');
  const whip = world.storylines.find((s) => s.id === 'whip-equipped');
  assert.deepEqual(whip.scenes.map((s) => s.id), canon.core_sequence.map((id) => 'whip-' + id));
  whip.scenes.forEach((s, i) => assert.equal(s.durationMs, timing.tracks.find((t) => t.id === canon.core_sequence[i]).chapter_target_ms));
  assert.deepEqual(whip.scenes.slice(-3).map((s) => s.title), ['Dealer Plates', 'Tears Won\'t Fall', 'Salvage Title'], 'the controlling ending order');
  assert.ok(whip.scenes.every((s) => s.anchor.placeId === city.garage.id));

  const b1src = await read('js/prim3-tactics/missions/blind-the-floor.mjs');
  const b1level = await read('js/prim3-tactics/levels/equity-uprise-b1.mjs');
  const b1 = world.storylines.find((s) => s.id === 'b1-blind-the-floor');
  for (const s of b1.scenes) {
    const id = s.anchor.device || s.anchor.equipment || s.anchor.door;
    assert.ok(b1src.includes(`'${id}'`), s.id + ' anchor ' + id + ' is in the mission spec');
    assert.ok(b1level.includes(`'${s.title}'`), s.id + ' title is the level\'s own objective line');
  }
  for (const s of world.storylines) {
    let o = 0; for (const x of s.scenes) { assert.equal(x.offsetMs, o); o += x.durationMs; }
    assert.equal(s.loop.periodMs, o, s.id + ' loop period is the sum of its scenes');
  }
});

test('schedule: now / next is deterministic, loops, and handles the scene edges', () => {
  const s = { loop: { epoch: '2026-11-03T00:00:00Z', periodMs: 600 }, scenes: [{ id: 'a', offsetMs: 0, durationMs: 100 }, { id: 'b', offsetMs: 100, durationMs: 200 }, { id: 'c', offsetMs: 300, durationMs: 300 }] };
  const E = Date.parse(s.loop.epoch);
  const at = (t) => { const r = scheduleAt(s, E + t); return [r.now.scene.id, r.next.scene.id, r.now.startsAt - E, r.now.endsAt - E, r.loop]; };
  assert.deepEqual(at(0), ['a', 'b', 0, 100, 0]);
  assert.deepEqual(at(99), ['a', 'b', 0, 100, 0]);
  assert.deepEqual(at(100), ['b', 'c', 100, 300, 0]);
  assert.deepEqual(at(599), ['c', 'a', 300, 600, 0]);
  assert.deepEqual(at(600), ['a', 'b', 600, 700, 1]);
  assert.deepEqual(at(1350), ['b', 'c', 1300, 1500, 2]);
  assert.deepEqual(at(-1), ['c', 'a', -300, 0, -1], 'before the epoch it is still a loop');
  assert.equal(scheduleAt(s, E + 250).next.startsAt - E, 300);
  assert.equal(scheduleAt(s, E + 250).now.remainingMs, 50);
  assert.equal(scheduleAt({ ...s, scenes: [] }, E), null);
  assert.equal(scheduleAt(s, NaN), null);
  /* the same instant always gives the same answer, for every real storyline, and the instant is inside its scene */
  for (const real of world.storylines) {
    for (let k = 0; k < 500; k++) {
      const t = Date.parse(real.loop.epoch) + Math.floor((k * 7919.123 + k * k * 104729) % (real.loop.periodMs * 5)) - real.loop.periodMs;
      const a = scheduleAt(real, t), b = scheduleAt(real, t);
      assert.deepEqual(a, b);
      assert.ok(a.now.startsAt <= t && t < a.now.endsAt, real.id + ' at ' + t);
      assert.equal(a.now.endsAt - a.now.startsAt, a.now.scene.durationMs);
      assert.equal(a.next.index, (a.now.index + 1) % real.scenes.length);
    }
  }
});

test('Equity Uprise HQ: the exercise, both sides of B1, the Server Lab and the Building Screens; the Workbench waits for its build', async () => {
  const t = findTown(world, 'us/connecticut/bridgeport').town;
  const hq = t.entries.filter((e) => e.neighborhood === 'equity-uprise-hq');
  assert.deepEqual(hq.map((e) => e.route), ['prim3-transit.html?level=equity-uprise-hq', 'prim3-transit.html?level=equity-uprise-b1&side=defend', 'prim3-transit.html?level=equity-uprise-b1&side=attack',
    'equity-uprise-server-lab-3d.html', 'screens/building.html', 'screens/terminal.html?tab=hardware&mode=TRAINING']);
  const bench = hq.find((e) => e.id === 'eu-computer-workbench');
  assert.equal(bench.requires.built, 'equity-uprise-preview/lab-runtime/equity-uprise-computer-workbench.mjs');
  /* the build copies the source module there (deploy-pages copies lab-runtime into equity-uprise-preview/lab-runtime/) */
  assert.ok(bench.requires.source.endsWith('/' + bench.requires.built.split('/').pop()));
  assert.match(await read('.github/workflows/deploy-pages.yml'), /equity-uprise-preview\/lab-runtime\//);
  assert.match(await read('equity-uprise-server-lab-3d.html'), /owner-only/);
});

test('resolveRequires omits a slot whose build file is missing and keeps it, unmarked, when it is served', async () => {
  const absent = await resolveRequires(world, async () => false);
  const present = await resolveRequires(world, async (p) => p === 'equity-uprise-preview/lab-runtime/equity-uprise-computer-workbench.mjs');
  const failing = await resolveRequires(world, async () => { throw Error('offline'); });
  const ids = (w) => findTown(w, 'us/connecticut/bridgeport').town.entries.map((e) => e.id);
  assert.ok(!ids(absent).includes('eu-computer-workbench'));
  assert.ok(!ids(failing).includes('eu-computer-workbench'), 'an unreachable check omits, never shows');
  assert.ok(ids(present).includes('eu-computer-workbench'));
  assert.ok(!JSON.stringify(present).includes('"requires"'), 'a met requirement is not shown to the panel');
  assert.equal(ids(absent).length, ids(present).length - 1, 'nothing else changes');
  assert.ok(findTown(absent, 'us/connecticut/bridgeport').town.neighborhoods.some((n) => n.id === 'equity-uprise-hq'));
  assert.ok(JSON.stringify(world).includes('"requires"'), 'the input is not modified');
});
