/* PRIM3 × Equity Uprise: the three layers. (a) the building authority, read-only; (b) the game adapter (frame,
   cells, traversal, cover, cameras); (c) the SANDBOX electronics binding. Plus the vertical slice, Blind the Floor /
   Restore the Picture, played on the real resolver and threat AI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection } from '../../js/prim3-tactics/tactical-hints.mjs';
import { runThreatPhase, threatKnowledge } from '../../js/prim3-tactics/tactical-threat-ai.mjs';
import * as A from '../../js/prim3-tactics/adapters/equity-uprise/adapter.mjs';
import { loadPackage, buildBattlefield, walkableCells } from '../../js/prim3-tactics/adapters/equity-uprise/pipeline.mjs';
import { sandboxView, realView, bindCameras } from '../../js/prim3-tactics/adapters/equity-uprise/sandbox.mjs';
import * as M from '../../js/prim3-tactics/missions/blind-the-floor.mjs';
import { buildPackage, SOURCES, PACKAGE_PATH } from '../prim3/build-equity-uprise-package.mjs';
import { playGame, winRates } from '../prim3/blind-the-floor-sim.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';

const ROOT = new URL('../../', import.meta.url);
const sha = async (p) => createHash('sha256').update(await readFile(new URL(p, ROOT))).digest('hex');
const authorityHashes = async () => Object.fromEntries(await Promise.all(Object.values(SOURCES).map(async (p) => [p, await sha(p)])));
const pkgP = loadPackage();
const json = async (p) => JSON.parse(await readFile(new URL(p, ROOT), 'utf8'));
async function realSandbox() {
  const { ElectronicsSandbox } = await import(new URL(SOURCES.sandbox, ROOT).href);
  return new ElectronicsSandbox({ registry: await json(SOURCES.registry), connections: await json(SOURCES.connections), manifest: await json(SOURCES.manifest) });
}

test('(a) the committed package is exactly what the authority builds today, and records every source hash', async () => {
  const pkg = await pkgP, built = await buildPackage();
  assert.equal(JSON.stringify(built) + '\n', await readFile(new URL(PACKAGE_PATH, ROOT), 'utf8'), 'stale: run node scripts/prim3/build-equity-uprise-package.mjs');
  assert.deepEqual(pkg.provenance, await authorityHashes());
  assert.equal(pkg.sandbox.execution_target, 'SANDBOX'); assert.equal(pkg.sandbox.live_control_allowed, false);
});

test('(b) the frame: feet ↔ grid is documented and reversible, cell anchors round-trip exactly', async () => {
  const pkg = await pkgP;
  for (let y = 0; y < A.H; y += 1) for (let x = 0; x < A.W; x += 1) { const f = A.cellToFt(x, y); assert.deepEqual(A.ftToCell(f.xf, f.yf), { x, y }); const b = A.cellBoundsFt(x, y); assert.deepEqual(A.ftToCell(b.x1, b.y1), { x, y }, 'the cell owns its south-west corner'); }
  assert.deepEqual(A.ftToCell(0, 0), { x: 3, y: 8 }, 'the building SW corner');
  assert.deepEqual(A.ftToCell(71.99, 71.99), { x: 8, y: 3 }, 'the building NE corner');
  assert.deepEqual(A.ftToCell(-36, -48), { x: 0, y: 12 }, 'the site SW corner');
  assert.equal(A.FT_PER_CELL * A.FT / 3.54 < 1.04, true, '12 ft is within 4% of the engine tile (true scale, not shrunk)');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((l) => A.elevationFt(pkg, l)), [-13.5, 0, 13.5, 27, 40.5, 54, 67.5, 81]);
  for (const l of [0, 1, 2, 3, 4, 5, 6, 7]) assert.equal(A.levelOfZ(A.zOfLevel(l)), l);
  // the same rule the hand-built HQ level uses
  for (const r of Object.values(HQ.PLAN.core)) assert.deepEqual(A.rectCells(r), HQ.rectTiles(r));
});

test('(b) generic: every level F1–F6, the L7 roof and B1 loads; stairs join consecutive levels; elevators only when permitted', async () => {
  const pkg = await pkgP;
  for (const l of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const g = A.levelGrid(pkg, l);
    assert.equal(g.cells.size, 36, `level ${l}: the full 72 × 72 ft plate`);
    assert.deepEqual(g.cores['stair-a-east'], HQ.CORE.stairA); assert.deepEqual(g.cores['stair-b-west'], HQ.CORE.stairB);
  }
  const t = A.traversal(pkg, { levels: [0, 1, 2, 3, 4, 5, 6, 7], site: true, openings: { 'F1-DOOR-PUBLIC-OUTER': true } });
  for (const n of ['stair-a-east', 'stair-b-west']) assert.equal(t.links.filter((k) => k.id.startsWith(n)).length, 7, `${n}: B1→F1→…→L7`);
  assert.ok(t.links.some((k) => k.id === 'stair-b-west-0-1' && k.from.z === 8 && k.to.z === 1), 'B1 → Floor 1 by Stair B');
  assert.ok(!t.links.some((k) => k.kind === 'elevator'));
  const withCab = A.traversal(pkg, { levels: [0, 1], elevators: true });
  assert.ok(withCab.links.some((k) => k.kind === 'elevator' && k.id.startsWith('passenger-elevator-a')));
  // F1 from the adapter agrees with the hand-built HQ level: the intake room, restroom B and support rooms are closed
  const f1 = A.levelGrid(pkg, 1);
  for (const c of HQ.SCENE.floor1Rooms) assert.equal(f1.cells.get(`${c.x}:${c.y}`).kind, 'closed', `${c.id} at ${c.x},${c.y}`);
  // the public entrance joins the site to Floor 1 where the HQ level puts it
  const door = t.links.find((k) => k.id === 'F1-DOOR-PUBLIC-OUTER');
  assert.deepEqual([door.from, door.to], [{ x: 6, y: 9, z: 0 }, { x: 6, y: 8, z: 1 }]);
  // a squad can walk from the street to B1 and to the roof on these links
  const s = R.createState({ width: 12, height: 13, floors: 9, surfaces: t.surfaces, links: t.links, blockers: t.blockers, units: [{ id: 'T', faction: 'PLAYER', role: 'T', x: 6, y: 11, z: 0 }] });
  const reach = R.computeReach(s, 'T', Infinity);
  assert.ok(Number.isFinite(reach.costAt(5, 4, 8)), 'B1 concourse'); assert.ok(Number.isFinite(reach.costAt(5, 6, 7)), 'the roof');
});

test('(b) placements go through the frame: cameras, rack, console, doors and equipment sit in their own rooms', async () => {
  const pkg = await pkgP, g = A.levelGrid(pkg, 0, M.SPEC.rules[0]);
  const cams = A.camerasOn(pkg, g);
  assert.deepEqual(cams.map((c) => c.asset_id), ['B1-SEC-CAM-01', 'B1-SEC-CAM-02', 'B1-SEC-CAM-03', 'B1-SEC-CAM-04']);
  for (const c of cams) { assert.equal(c.cellZone, 'b1-telecom-core'); assert.deepEqual(c.cell, { x: 6, y: 6, z: 8 }); assert.ok(A.rectCells(g.zones.find((z) => z.id === 'b1-telecom-core').bounds_ft).some((k) => k.x === 6 && k.y === 6)); }
  assert.deepEqual(A.deviceAnchor(pkg, g, 'B1-NET-PATCH-PANEL-01'), { x: 6, y: 4, zone: 'b1-tunnel-ops-concourse', z: 8, asset_id: 'B1-NET-PATCH-PANEL-01', position_ft: [45, 62.8, -12.3] });
  assert.equal(A.equipmentAnchor(g, 'B1-TELECOM-CONSOLE-01').zone, 'b1-telecom-core');
  for (const d of g.doors) { const a = A.doorAnchor(g, d.id); const b = A.cellBoundsFt(a.x, a.y); assert.ok(d.x >= b.x1 - 0.51 && d.x <= b.x2 + 0.51 && d.y >= b.y1 - 0.51 && d.y <= b.y2 + 0.51, d.id); }
  // camera optics are the authority's; the placement authority itself says 'unknown' (recorded, not hidden)
  assert.ok(cams.every((c) => c.optics.horizontal_fov_deg === 92 && c.optics.training_range_ft === 32 && c.placement_authority === 'unknown'));
});

test('(b) coverage: the engine CAMERA machine sees the authority optics\' wedge over B1, plus only the cells behind the lens', async () => {
  const pkg = await pkgP, { bf, lanes, selection } = M.battlefield(pkg);
  const s = R.createState({ width: 12, height: 13, floors: 9, surfaces: bf.surfaces, links: bf.links, blockers: bf.blockers, machines: bf.machines, units: [] });
  for (const cam of bf.cameras) {
    const wedge = cam.coverage.filter((c) => c.walkable).map((c) => `${c.x}:${c.y}`).sort();
    const engine = lanes.filter((c) => R.gridDistance(cam.cell, c, s) <= cam.detectionRadius && ((c.x === cam.cell.x && c.y === cam.cell.y) || R.hasLineOfSight(s, cam.cell, c))).map((c) => `${c.x}:${c.y}`).sort();
    // the engine camera has no facing: it sees everything the optics cover, plus cells behind the lens within range
    assert.ok(wedge.every((k) => engine.includes(k)), `${cam.asset_id}: the engine sees the whole optical wedge`);
    const behind = engine.filter((k) => !wedge.includes(k));
    assert.deepEqual(behind, ['7:6', '7:7'], `${cam.asset_id}: only the building-v3 east corridor, behind the lens, is extra (camera facing is an upstream engine item)`);
    assert.ok(wedge.includes('6:4'), 'every camera sees the rack');
  }
  // selection by traversable-lane coverage: all four see the lane and they are redundant (one covers what four do)
  assert.deepEqual(selection.seeing, ['B1-SEC-CAM-01', 'B1-SEC-CAM-02', 'B1-SEC-CAM-03', 'B1-SEC-CAM-04']);
  assert.equal(selection.minimal.length, 1);
});

test('(c) the packaged fault consequences are the real sandbox\'s, for single, multiple and mixed ledgers; reset restores the baseline', async () => {
  const pkg = await pkgP, sb = await realSandbox();
  const before = sb.summary();
  const L = (...xs) => xs.map(([f, t]) => ({ fault_id: f, target: t }));
  for (const ledger of [L(['camera_link_down', 'B1-SEC-CAM-02']), L(['camera_link_down', 'B1-SEC-CAM-01'], ['poe_disabled', 'B1-SEC-CAM-03']), L(...[1, 2, 3, 4].map((i) => ['camera_link_down', `B1-SEC-CAM-0${i}`])), L(['access_switch_failed', 'B1-NET-ACCESS-SW-01'], ['camera_link_down', 'B1-SEC-CAM-04'])]) {
    const mine = sandboxView(pkg, ledger), real = realView(sb, ledger);
    assert.deepEqual(mine.assets, real.assets); assert.deepEqual(mine.connections, real.connections);
  }
  assert.deepEqual(sb.summary(), before, 'the sandbox is back at its baseline');
  assert.throws(() => sandboxView(pkg, [{ fault_id: 'normal_power_loss', target: 'whole_building' }]), /approved mission vocabulary/);
});

test('acceptance: an attacker blinds a real camera, the defender loses that coverage, restores and verifies it, wins; nothing persistent changes', async () => {
  const pkg = await pkgP, hashes = await authorityHashes(), pkgBefore = JSON.stringify(pkg);
  // defender side, all links live at the start (the red team has not cut yet)
  let s = M.createMission(pkg, { side: 'defend', seed: 11 });
  s = M.sync(pkg, { ...s, battlefield: { ...s.battlefield, eu: { ...s.battlefield.eu, ledger: [] } } });
  // a red-team member reaches the rack and its technical intent cuts the first live link: B1-SEC-CAM-01
  s = { ...s, units: s.units.filter((u) => u.faction === 'PLAYER' || u.id === 'H2').map((u) => (u.id === 'H2' ? { ...u, x: 5, y: 4, z: 8 } : u)) };
  const cam = (st) => st.machines.find((m) => m.id === 'B1-SEC-CAM-01');
  assert.equal(cam(s).state, 'ACTIVE');
  s = M.afterThreat(pkg, s).state;
  assert.equal(cam(s).state, 'JAMMED'); assert.equal(cam(s).offline, true);
  assert.deepEqual(s.battlefield.eu.ledger.map((f) => f.target), ['B1-SEC-CAM-01']);
  // T goes down Stair B, crosses to (6,5) (next to the rack and the console), restores and verifies
  const T = (st) => st.units.find((u) => u.id === 'T1');
  s = { ...s, units: s.units.filter((u) => u.faction === 'PLAYER') }; // the red team is dealt with: this case is the technical loop
  s = R.moveUnit(s, 'T1', { x: 4, y: 3, z: 8 }, 'MOVE');
  s = R.moveUnit(s, 'T1', { x: 6, y: 5, z: 8 }, 'MOVE');
  s = M.sync(pkg, R.beginPlayerPhase(R.resolveClockStatePhase(R.beginThreatPhase(s))));
  assert.deepEqual([T(s).x, T(s).y, T(s).z], [6, 5, 8]);
  s = M.performMission(pkg, s, 'eu:restore', 'T1').state;
  assert.equal(cam(s).state, 'ACTIVE'); assert.equal(s.battlefield.eu.ledger.length, 0);
  s = M.performMission(pkg, s, 'eu:verify', 'T1').state;
  assert.equal(M.outcome(s), 'win');
  // nothing persistent changed: authority bytes, the package, and the sandbox baseline
  assert.deepEqual(await authorityHashes(), hashes);
  assert.equal(JSON.stringify(pkg), pkgBefore);
  const sb = await realSandbox(); assert.deepEqual(realView(sb, []), { assets: {}, connections: {} });
  // a restart is a clean mission
  assert.deepEqual(M.createMission(pkg, { side: 'attack', seed: 11 }).battlefield.eu.ledger, []);
});

test('consequences: blinding changes the defenders\' fog (side defend) and the defending AI\'s decisions (side attack)', async () => {
  const pkg = await pkgP;
  // defend: a red-team member in the lane is visible to the squad only through a live camera
  let s = M.createMission(pkg, { side: 'defend', seed: 4 });
  const seesH3 = (st) => playerProjection(st).units.some((u) => u.id === 'H3');
  s = { ...s, units: s.units.map((u) => (u.id === 'H3' ? { ...u, x: 5, y: 5, z: 8 } : u)) };
  assert.equal(seesH3(s), false, 'all four links cut: the lane is dark');
  const live = M.sync(pkg, { ...s, battlefield: { ...s.battlefield, eu: { ...s.battlefield.eu, ledger: s.battlefield.eu.ledger.slice(1) } } });
  assert.equal(seesH3(live), true, 'one link restored: the picture shows H3');
  // attack: T at the rack, out of every defender's own sight; only Floor 1 security (H4) is on the board.
  // Cameras live: the defenders' network knows T and H4 comes for it; blinded: H4 walks its patrol.
  let a = M.createMission(pkg, { side: 'attack', seed: 4 });
  a = { ...a, units: a.units.filter((u) => u.id === 'T1' || u.id === 'H4').map((u) => (u.id === 'T1' ? { ...u, x: 6, y: 4, z: 8 } : u)) };
  const blind = M.sync(pkg, { ...a, battlefield: { ...a.battlefield, eu: { ...a.battlefield.eu, ledger: a.battlefield.eu.cameras.map((id) => ({ fault_id: 'camera_link_down', target: id })) } } });
  assert.ok(threatKnowledge(R.beginThreatPhase(a)).has('T1'), 'live cameras: the defenders know where T is');
  assert.ok(!threatKnowledge(R.beginThreatPhase(blind)).has('T1'), 'blind: they do not');
  const turn = (st) => { const b = R.beginThreatPhase(st); return runThreatPhase(b, { rng: [10, 90, 10, 90] }).state.events.slice(b.events.length).filter((e) => /FIRE|MOVE|DASH|OVERWATCH/.test(e.type)); };
  const seen = turn(a), dark = turn(blind);
  assert.notDeepEqual(seen, dark, 'the threat AI decides differently');
  assert.deepEqual(dark.find((e) => e.type === 'MOVE').destination, { x: 8, y: 4, z: 1 }, 'blind: H4 keeps to its patrol (the Stair A landing)');
  assert.ok(seen.some((e) => e.type === 'OVERWATCH_SET'), 'live: H4 stops short and covers the approach to T');
});

test('both sides can win through play: heuristic squad vs the canonical threat AI, many seeds, both roles', async () => {
  const r = await winRates(40);
  for (const side of M.SIDES) { assert.ok(r[side].player > 0, `${side}: the squad wins some`); assert.ok(r[side].opponent > 0, `${side}: the AI wins some`); }
});

test('replayed games (one each way, each role) reproduce exactly', async () => {
  const pkg = await pkgP, fx = JSON.parse(await readFile(new URL('fixtures/blind-the-floor-replays.json', import.meta.url), 'utf8'));
  const source = JSON.parse(await readFile(new URL('../../js/prim3-tactics/SOURCE.json', import.meta.url), 'utf8'));
  assert.equal(fx.engineCommit, source.commit, 'replays name the engine whose evacuation rules they exercise');
  assert.deepEqual(fx.games.map((g) => `${g.side}:${g.outcome === 'win' ? 'squad' : 'ai'}`).sort(), ['attack:ai', 'attack:squad', 'defend:ai', 'defend:squad']);
  for (const g of fx.games) { const r = playGame(pkg, g.side, g.seed); assert.equal(r.outcome, g.outcome); assert.equal(r.round, g.round); assert.deepEqual(r.trace, g.trace); assert.deepEqual(r.state.battlefield.eu.events, g.sandbox); }
});

test('evacuated escorts no longer trap Technical until the B1 mission clock expires', async () => {
  const run = playGame(await pkgP, 'attack', 5);
  assert.equal(run.outcome, 'win');
  assert.ok(run.state.mission.extractedUnitIds.includes('T1'));
});

test('mode separation: the mission is TRAINING in the SANDBOX; its ledger lives only in the mission state', async () => {
  const pkg = await pkgP, s = M.createMission(pkg, { side: 'defend', seed: 1 });
  assert.equal(s.battlefield.eu.mode, 'TRAINING'); assert.equal(s.battlefield.eu.execution_target, 'SANDBOX'); assert.equal(s.battlefield.eu.live_control_allowed, false);
  assert.equal(s.battlefield.eu.ledger.length, 4, 'the red team cut all four before the squad is called');
  const page = await readFile(new URL('js/prim3-tactics/transit.mjs', ROOT), 'utf8');
  assert.match(page, /prim3\.level\.\$\{LEVEL\.SAVE_ID \|\| LEVEL\.LEVEL_ID\}/, 'the mission saves under its own PRIM3 key, one per side');
  for (const f of ['adapter.mjs', 'sandbox.mjs', 'pipeline.mjs']) assert.doesNotMatch(await readFile(new URL(`js/prim3-tactics/adapters/equity-uprise/${f}`, ROOT), 'utf8'), /writeFile|localStorage|fetch\([^)]*method/, f);
});

test('the B1 level is registered, loads, draws no mark, and hands the page the mission hooks', async () => {
  const { LEVELS, loadLevel } = await import('../../js/prim3-tactics/levels/index.mjs');
  assert.ok(LEVELS['equity-uprise-b1']);
  const L = await loadLevel('equity-uprise-b1');
  assert.equal(L.LEVEL_ID, 'equity-uprise-b1'); assert.equal(L.SIDE, 'defend'); assert.equal(L.SAVE_ID, 'equity-uprise-b1.defend');
  for (const k of ['createState', 'sync', 'actions', 'perform', 'afterThreat', 'outcome', 'debrief', 'objective']) assert.equal(typeof L.HOOKS[k], 'function', k);
  const s = L.HOOKS.createState(3);
  assert.equal(L.HOOKS.objective(s).progress, '0/4');
  assert.ok(L.SCENE.gridSurfaces.some((g) => g.z === 8 && g.height < 0), 'a grid on B1');
  for (const f of ['levels/equity-uprise-b1.mjs', 'missions/blind-the-floor.mjs', 'adapters/equity-uprise/adapter.mjs']) assert.doesNotMatch(await readFile(new URL(`js/prim3-tactics/${f}`, ROOT), 'utf8'), /\.(png|jpe?g|svg|webp)\b|logo|emblem/i, f);
  const menu = await readFile(new URL('js/prim3-tactics/preview.mjs', ROOT), 'utf8');
  assert.match(menu, /prim3-transit\.html\?level=equity-uprise-b1&side=defend/);
});
