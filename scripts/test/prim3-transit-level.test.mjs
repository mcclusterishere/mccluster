/* PRIM3 · Transit / Relay: the level is data for the canonical engine. These checks run the real vendored
   resolver, hints and threat AI on it: the map is playable start to finish under the rules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection, knownPaths } from '../../js/prim3-tactics/tactical-hints.mjs';
import { runThreatPhase } from '../../js/prim3-tactics/tactical-threat-ai.mjs';
import * as L from '../../js/prim3-tactics/levels/transit-relay.mjs';

const start = (seed = 3) => R.beginPlayerPhase(R.createState(L.engineConfig({ seed })));
const at = (s, id) => s.units.find((u) => u.id === id);
// teleport for setting up a position (test only; the game always moves through moveUnit)
const place = (s, id, x, y, z = 0) => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, x, y, z } : u)) });

test('every unit spawns on a walkable, unoccupied tile', () => {
  const s = start(), cfg = L.engineConfig();
  const blocked = new Set(cfg.blockers.map((b) => `${b.x}:${b.y}:${b.z}`));
  const seen = new Set();
  for (const u of s.units) {
    const k = `${u.x}:${u.y}:${u.z}`;
    assert.ok(!blocked.has(k), `${u.id} spawns on a blocker`);
    assert.ok(!seen.has(k), `${u.id} shares a tile`); seen.add(k);
    if (u.z) assert.ok(cfg.surfaces.some((r) => r.z === u.z && u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.d), `${u.id} is not on a roof`);
  }
});

test('from the squad start, the relay, the gate, both roofs and the extraction pad are all reachable', () => {
  const s = start(), cfg = L.engineConfig();
  const reach = R.computeReach({ ...s, units: s.units.filter((u) => u.faction === 'PLAYER') }, 'T1', Infinity);
  const can = (x, y, z = 0) => Number.isFinite(reach.costAt(x, y, z));
  assert.ok(can(L.SCENE.relay.x, L.SCENE.relay.y + 1), 'next to the relay');
  assert.ok(can(31, L.SCENE.fence.y + 1), 'the gate tile');
  assert.ok(can(30, 12, 1), 'B-1 roof by its stair');
  assert.ok(can(8, 28, 1), 'A-2 roof by its stair');
  assert.ok(can(17, 10, 1), 'the skybridge');
  // every building can be climbed (owner, 2026-11-02): each roof is reachable from the squad's start
  for (const b of L.SCENE.buildings) assert.ok(b.roof && can(b.x + Math.floor(b.w / 2), b.y + Math.floor(b.d / 2), 1), `${b.id} roof is reachable`);
  assert.ok(can(L.SCENE.extraction.x, L.SCENE.extraction.y), 'the extraction pad');
  assert.ok(cfg.links.every((l) => l.cost >= 1));
});

test('the player sees only the squad at the start, and hints report signed coordinates', () => {
  const p = playerProjection(start());
  assert.deepEqual(p.units.map((u) => u.id).sort(), ['E1', 'R1', 'T1']);
  assert.deepEqual(L.toDisplay(L.SCENE.relay.x, L.SCENE.relay.y), { X: -1, Y: 1 });
  const r = knownPaths(p, 'T1');
  assert.ok(r.dist.size > 20);
});

test('climbing: a stair is a real move onto the roof, and the operative stands up there', () => {
  let s = start();
  const st = L.SCENE.stairs.find((x) => x.id === 'b1-stair');
  s = place(s, 'T1', st.from.x, st.from.y);
  const r = knownPaths(playerProjection(s), 'T1');
  const path = r.pathTo(st.to.x, st.to.y, 1);
  assert.ok(path && path.some((p) => p.z === 1), 'the preview climbs');
  s = R.moveUnit(s, 'T1', { x: st.to.x, y: st.to.y, z: 1 }, 'MOVE', { path });
  assert.deepEqual([at(s, 'T1').x, at(s, 'T1').y, at(s, 'T1').z], [st.to.x, st.to.y, 1]);
});

test('a previewed route is the route the engine walks (preview = execution)', () => {
  let s = start();
  const r = knownPaths(playerProjection(s), 'E1');
  const path = r.pathTo(42, 50, 0);
  assert.ok(path && path.length);
  s = R.moveUnit(s, 'E1', { x: 42, y: 50, z: 0 }, 'MOVE', { path, rolls: [50, 50] });
  assert.deepEqual([at(s, 'E1').x, at(s, 'E1').y], [42, 50]);
  assert.equal(at(s, 'E1').ap, 1);
});

test('only Entry can breach the gate, from its tile; breaching opens the fence', () => {
  let s = start();
  assert.throws(() => R.technicalAction(s, 'E1', 'GATE', 'BREACH'), /not in position/);
  s = place(s, 'T1', 31, L.SCENE.fence.y + 1);
  assert.throws(() => R.technicalAction(s, 'T1', 'GATE', 'BREACH'), /cannot operate/);
  s = place(place(s, 'T1', 49, 53), 'E1', 31, L.SCENE.fence.y + 1);
  const out = R.technicalAction(s, 'E1', 'GATE', 'BREACH');
  assert.equal(out.accepted, true);
  for (const g of L.GATE_CELLS) assert.ok(!out.state.blockers.some((b) => b.x === g.x && b.y === g.y && b.z === g.z), 'gate cell still blocked');
});

test('Technical links the relay twice (two AP), then extraction completes the mission', () => {
  let s = place(start(), 'T1', L.SCENE.relay.x, L.SCENE.relay.y + 1);
  assert.throws(() => R.technicalAction(place(s, 'E1', L.SCENE.relay.x + 1, L.SCENE.relay.y), 'E1', 'RELAY', 'LINK_1'), /cannot operate/);
  s = R.technicalAction(s, 'T1', 'RELAY', 'LINK_1').state;
  assert.equal(s.nodes.find((n) => n.id === 'RELAY').state, 'WORK_IN_PROGRESS');
  s = R.technicalAction(s, 'T1', 'RELAY', 'LINK_2').state;
  assert.equal(s.nodes.find((n) => n.id === 'RELAY').state, 'VERIFIED');
  assert.equal(at(s, 'T1').ap, 0);
  assert.equal(R.missionComplete(s), false, 'extraction is still required');
  assert.throws(() => R.extractUnit(s, 'E1'), /extraction zone/);
  const e = L.SCENE.extraction;
  for (const id of ['E1', 'R1', 'T1']) { s = place(s, id, e.x + (id === 'E1' ? 0 : id === 'R1' ? 1 : -1), e.y); s = R.extractUnit(s, id); }
  assert.equal(R.missionComplete(s), true);
});

test('a hostile phase on the real map is deterministic for a seed and leaves a playable state', () => {
  const run = () => { let s = R.beginThreatPhase(start(5)); const out = runThreatPhase(s, { rng: [40, 70, 10, 90, 55, 25, 60, 80, 30, 50, 45, 65] }); return out; };
  const a = run(), b = run();
  assert.deepEqual(a.events, b.events);
  const next = R.beginPlayerPhase(R.resolveClockStatePhase(a.state));
  assert.equal(next.phase, 'PLAYER');
  assert.ok(next.units.filter((u) => u.faction === 'PLAYER').every((u) => u.ap === u.maxAp || u.dead || u.downed));
});

test('the page offers the level from the tactics menu, is noindex and never ships a drawn mark', async () => {
  const html = await readFile(new URL('../../prim3-transit.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /src="assets\/img\/prim3-logo\.png"/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.doesNotMatch(html, /@media \(max-width/);
  assert.doesNotMatch(html, /[^/]\/\/\/[^/]/, 'no drawn /// beside the wordmark');
  const page = await readFile(new URL('../../js/prim3-tactics/transit.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /getRandomValues|Math\.random/, 'rolls come only from the engine seed saved with the state');
  assert.match(page, /An unseen shooter/, 'the log never names a hostile the player cannot see');
  assert.doesNotMatch(page, /pathTo\.length|key\.length/, 'roof taps must pass the floor to the route finder (z is an optional argument, so .length lies)');
  assert.match(page, /hasLineOfSight\(state, a, b\)/, 'the fog of war uses the engine\'s own sight rule');
  assert.match(page, /r3\.update\(boardModel\(\)\)/);
  assert.match(page, /p\.units\.filter\(\(u\) => !extracted\(u\)\)/, 'the board draws only the player projection');
  const menu = await readFile(new URL('../../js/prim3-tactics/preview.mjs', import.meta.url), 'utf8');
  assert.match(menu, /prim3-transit\.html/);
  const man = JSON.parse(await readFile(new URL('../../assets/3d/prim3-operators/manifest.json', import.meta.url), 'utf8'));
  for (const r of ['E', 'R', 'T']) assert.ok(man.models[r] && man.sources[r], `manifest lists ${r} with its source`);
});

test('the grid is 3.54 m a tile (owner, 2026-11-03) and real things keep their real size on it', async () => {
  const S = await import('../../js/prim3-tactics/scale.mjs');
  assert.equal(S.TILE_M, 3.54);
  assert.equal(L.TILE_M, S.TILE_M, 'the level uses the shared grid');
  assert.equal(S.OPERATOR_HEIGHT_M, 1.75);
  assert.ok(Math.abs(S.operatorHeight() - 1.75 / 3.54) < 1e-9, 'an operative is about half a tile tall');
  // a 40 ft container (12.19 × 2.44 m) covers the fewest whole tiles that hold it
  const tiles = (m) => Math.ceil(m / L.TILE_M);
  for (const c of L.SCENE.containers) {
    assert.equal(Math.max(c.w, c.d), tiles(12.19), `${c.id} is a 40 ft box long`);
    assert.equal(Math.min(c.w, c.d), tiles(2.44), `${c.id} is one box wide`);
  }
  for (const r of [...L.SCENE.crates, ...L.SCENE.rooftop]) assert.ok(Math.min(r.w, r.d) === 1, 'crate stacks and AC units are one tile deep');
  assert.ok(L.SCENE.skybridge.d * L.TILE_M < 4 && L.SCENE.bridges.find((b) => b.id === 'footbridge').w * L.TILE_M < 4, 'walkways are a walkway wide, not a road');
  // buildings keep their tile footprints: real yard buildings between 25 and 55 m on a side
  for (const b of L.SCENE.buildings) for (const side of [b.w, b.d]) assert.ok(side * L.TILE_M >= 25 && side * L.TILE_M <= 55, `${b.id} side ${side * L.TILE_M} m`);
});

test('every renderer stands an operative at the one real height, never its own scale', async () => {
  const read = (f) => readFile(new URL('../../js/prim3-tactics/' + f, import.meta.url), 'utf8');
  const [lvl, board, kit, page] = await Promise.all(['level3d.mjs', 'board3d.mjs', 'operatives3d.mjs', 'transit.mjs'].map(read));
  for (const [name, src] of [['level3d', lvl], ['board3d', board]]) {
    assert.match(src, /operatorHeight\(/, `${name} takes the figure height from scale.mjs`);
    assert.doesNotMatch(src, /BODY_SCALE|scale\.setScalar\(1\.18\)|2\.15 \//, `${name} has no private figure scale`);
  }
  assert.doesNotMatch(kit, /setScalar\(1\.18\)/);
  // metres → world units on the shared tile, or on a level's own drawing scale (Equity Uprise HQ: its 12 ft plan tile),
  // so a real thing and its operatives are always drawn at one scale
  assert.match(lvl, /const UNIT_M = level\.WORLD_M \|\| TILE_M/);
  assert.match(lvl, /const M = \(m\) => m \/ UNIT_M/);
  assert.match(lvl, /operatorHeight\(UNIT_M\)/);
  assert.match(page, /operatorHeight\(LEVEL\.WORLD_M \|\| LEVEL\.TILE_M\)/, 'unit labels sit just above a real-height head');
});
