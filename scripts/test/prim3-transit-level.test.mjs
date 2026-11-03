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
  const menu = await readFile(new URL('../../js/prim3-tactics/preview.mjs', import.meta.url), 'utf8');
  assert.match(menu, /prim3-transit\.html/);
  const man = JSON.parse(await readFile(new URL('../../assets/3d/prim3-operators/manifest.json', import.meta.url), 'utf8'));
  for (const r of ['E', 'R', 'T']) assert.ok(man.models[r] && man.sources[r], `manifest lists ${r} with its source`);
});
