/* PRIM3 · Equity Uprise HQ: the level is the building's own plan data on the 3.54 m grid, played by the
   real vendored resolver, hints and threat AI. Its plan rectangles are checked against the building
   authority files, so the level cannot drift from the building without a failing test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection, knownPaths } from '../../js/prim3-tactics/tactical-hints.mjs';
import { runThreatPhase } from '../../js/prim3-tactics/tactical-threat-ai.mjs';
import * as L from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import { LEVELS, loadLevel } from '../../js/prim3-tactics/levels/index.mjs';

const BLD = new URL('../../docs/design/equity-uprise-building/production/', import.meta.url);
const json = async (rel) => JSON.parse(await readFile(new URL(rel, BLD), 'utf8'));
const start = (seed = 3) => R.beginPlayerPhase(R.createState(L.engineConfig({ seed })));
const at = (s, id) => s.units.find((u) => u.id === id);
const place = (s, id, x, y, z = 0) => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, x, y, z } : u)) });
const squadOnly = (s) => ({ ...s, units: s.units.filter((u) => u.faction === 'PLAYER') });
const rect = (b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });

test('the plan rectangles are the building authority, unchanged', async () => {
  const core = await json('building-core-v2.json');
  assert.equal(core.units, 'feet');
  assert.deepEqual([core.shell.width_ft, core.shell.depth_ft, core.shell.floor_to_floor_ft], [72, 72, 13.5]);
  const vs = core.vertical_systems;
  assert.deepEqual(L.PLAN.core.passengerElevator, rect(vs.passenger_elevator.shaft_bounds_ft));
  assert.deepEqual(L.PLAN.core.freightElevator, rect(vs.service_freight_elevator.shaft_bounds_ft));
  assert.deepEqual(L.PLAN.core.stairA, rect(vs.stair_a.enclosure_bounds_ft));
  assert.deepEqual(L.PLAN.core.stairB, rect(vs.stair_b.enclosure_bounds_ft));
  assert.deepEqual(L.PLAN.core.mepRiser, rect(vs.mep_riser.shaft_bounds_ft || vs.mep_riser.bounds_ft));
  assert.deepEqual(core.levels.map((l) => l.finished_floor_elevation_ft), [-13.5, 0, 13.5, 27, 40.5, 54, 67.5, 81]);
  for (let z = 1; z <= 7; z += 1) assert.ok(Math.abs(L.floorHeight(z) - core.levels[z].finished_floor_elevation_ft * 0.3048) < 1e-9, `floor ${z} height`);

  const prog = await json('core-v2-floor-programs.json');
  const f1 = prog.levels.find((l) => l.level === 1), zone = (label) => rect(f1.zones.find((z) => z.label === label).bounds_ft);
  assert.deepEqual(L.PLAN.floor1.vestibule, zone('Entry Vestibule'));
  assert.deepEqual(L.PLAN.floor1.intakeRoom, zone('Intake / Verification Consultation'));
  assert.deepEqual(L.PLAN.floor1.reception, zone('Reception / Concierge / Security Desk'));
  assert.deepEqual(L.PLAN.floor1.journeyWall, zone('Journey Wall'));
  for (const [k, src] of [['corridor', 'corridor'], ['restroomA', 'restroom_a'], ['restroomB', 'restroom_b'], ['supportA', 'support_a'], ['supportB', 'support_b'], ['janitor', 'janitor']]) assert.deepEqual(L.PLAN.floor1[k], rect(prog.common_support[src].bounds_ft), k);
  assert.ok(f1.interaction_modes.some((m) => m.id === 'emergency_exercise'), 'the drill is Floor 1\'s own Emergency Exercise mode');

  const site = await json('floor-01/floor-01-site-egress.json'), el = (id) => rect(site.site_elements.find((e) => e.id === id).bounds_ft);
  assert.deepEqual(L.PLAN.siteBounds, rect(site.site_bounds_ft));
  assert.deepEqual(L.PLAN.site.publicWay, el('site-public-way-south'));
  assert.deepEqual(L.PLAN.site.publicApproach, el('site-public-approach'));
  assert.deepEqual(L.PLAN.site.eastEgressWalk, el('site-east-egress-walk'));
  assert.deepEqual(L.PLAN.site.serviceApron, el('site-service-apron-west'));
  assert.deepEqual(L.PLAN.site.assemblyA, el('site-primary-assembly'));
  assert.deepEqual(L.PLAN.site.assemblyB, el('site-alternate-assembly'));
  const door = (id) => site.exterior_openings.find((o) => o.object_id === id).location;
  assert.deepEqual(L.PLAN.doors.publicOuter, door('F1-DOOR-PUBLIC-OUTER'));
  assert.deepEqual(L.PLAN.doors.stairADischarge, door('F1-DOOR-STAIR-A-DISCHARGE'));

  const roof = await json('floor-07/floor-07-object-inventory.json'), obj = (id) => roof.objects.find((o) => o.id === id).placement;
  const fromArr = (b) => ({ x1: b[0], y1: b[1], x2: b[2], y2: b[3] });
  for (const [k, id] of [['passengerOverrun', 'F7-PASSENGER-OVERRUN-01'], ['freightOverrun', 'F7-FREIGHT-OVERRUN-01'], ['mepScreen', 'F7-MEP-SCREEN-01'], ['mechUnit1', 'F7-MECH-UNIT-01'], ['mechUnit2', 'F7-MECH-UNIT-02']]) {
    const { h_ft, ...r } = L.PLAN.roof[k]; assert.deepEqual(r, fromArr(obj(id).bounds_ft), k); assert.equal(h_ft, obj(id).height_ft, k);
  }
  assert.deepEqual([L.PLAN.roof.beacon.cx, L.PLAN.roof.beacon.cy, L.PLAN.roof.beacon.z_ft], obj('F7-ECOSYSTEM-BEACON-01').center_ft);
  assert.deepEqual([L.PLAN.roof.mobilityRing.cx, L.PLAN.roof.mobilityRing.cy, L.PLAN.roof.mobilityRing.r], [...obj('F7-MOBILITY-RING-01').center_ft.slice(0, 2), obj('F7-MOBILITY-RING-01').radius_ft]);
});

test('the plan lands on the grid: a 6 × 6 plate, the shared cores where Core V2 puts them, the site around it', () => {
  assert.equal(L.FT_PER_TILE * 0.3048 / L.TILE_M < 1.04, true, '12 ft a tile is within 4% of the game tile');
  assert.deepEqual(L.PLATE, { x: 3, y: 3, w: 6, d: 6 });
  assert.deepEqual(L.CORE.stairA, [{ x: 8, y: 3 }, { x: 8, y: 4 }], 'Stair A: the north-east enclosure');
  assert.deepEqual(L.CORE.stairB, [{ x: 4, y: 3 }, { x: 4, y: 4 }], 'Stair B: X8–18, never the old X0–12');
  assert.deepEqual(L.CORE.freightElevator, [{ x: 3, y: 3 }]);
  assert.deepEqual(L.CORE.passengerElevator, [{ x: 7, y: 5 }]);
  assert.deepEqual(L.CORE.mepRiser, [{ x: 7, y: 3 }]);
  assert.deepEqual(L.toDisplay(3, 8), { X: 0, Y: 0 }, 'the building south-west tile reads (0, 0)');
  // site: 144 × 156 ft is 12 × 13 tiles
  assert.deepEqual([L.W, L.H], [(108 + 36) / 12, (108 + 48) / 12]);
  assert.equal(L.SCENE.doors[0].out.y, 9, 'the public entrance is on the south facade');
  assert.ok(L.SCENE.zones.find((z) => z.id === 'assembly-a').cells.length === 4);
});

test('every unit spawns on a walkable, unoccupied tile', () => {
  const s = start(), cfg = L.engineConfig();
  const blocked = new Set(cfg.blockers.map((b) => `${b.x}:${b.y}:${b.z}`));
  const seen = new Set();
  for (const u of s.units) {
    const k = `${u.x}:${u.y}:${u.z}`;
    assert.ok(!blocked.has(k), `${u.id} spawns on a blocker`);
    assert.ok(!seen.has(k), `${u.id} shares a tile`); seen.add(k);
    if (u.z) assert.ok(cfg.surfaces.some((r) => r.z === u.z && u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.d), `${u.id} has no floor`);
  }
  assert.ok(cfg.links.every((l) => l.from.z >= 0 && l.to.z >= 0 && l.cost >= 1));
  assert.ok(s.units.filter((u) => u.faction === 'PLAYER').every((u) => u.z === 0 && u.y >= 11), 'the squad starts on the public way');
});

test('the only way in is the public entrance; Stairs A and B climb every storey to Level 7', () => {
  const s = start(), cfg = L.engineConfig();
  const reach = R.computeReach(squadOnly(s), 'T1', Infinity);
  const cost = (x, y, z) => reach.costAt(x, y, z);
  assert.ok(Number.isFinite(cost(6, 4, 1)), 'behind reception, by the security interface');
  assert.ok(Number.isFinite(cost(5, 6, 7)), 'the roof');
  assert.ok(Number.isFinite(cost(11, 9, 0)), 'Assembly Area A');
  // no door but the public entrance at the start: the stair discharge is secured from outside
  const doors = cfg.links.filter((l) => l.from.z === 0 || l.to.z === 0);
  assert.deepEqual(doors.map((l) => l.id).sort(), ['public-entrance', 'stair-a-discharge']);
  assert.ok(cfg.blockers.some((b) => b.x === 9 && b.y === 4 && b.z === 0), 'the discharge landing is closed');
  // six storeys of stairs from Floor 1 to the roof, in each stair, a link per storey
  for (const n of ['a', 'b']) { const ls = cfg.links.filter((l) => new RegExp(`^stair-${n}-\\d`).test(l.id)); assert.equal(ls.length, 6); assert.deepEqual(ls.map((l) => l.to.z), [2, 3, 4, 5, 6, 7]); }
  // the roof is a real climb: more than one move from Floor 1
  assert.ok(cost(5, 6, 7) - cost(6, 7, 1) > 12);
  // closed floors: on Floors 2–6 only the stair landings are walkable
  const geoWalk = (x, y, z) => !cfg.blockers.some((b) => b.x === x && b.y === y && b.z === z) && cfg.surfaces.some((r) => r.z === z && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
  for (let z = 2; z <= 6; z += 1) { let open = 0; for (let y = 3; y < 9; y += 1) for (let x = 3; x < 9; x += 1) if (geoWalk(x, y, z)) open += 1; assert.equal(open, 4, `floor ${z} landings`); }
});

test('a tapped route is the route walked: through the public entrance onto Floor 1', () => {
  let s = start();
  const r = knownPaths(playerProjection(s), 'T1');
  const path = r.pathTo(6, 8, 1);
  assert.ok(path && path.some((p) => p.z === 1), 'the preview goes in at the door');
  s = R.moveUnit(s, 'T1', { x: 6, y: 8, z: 1 }, 'MOVE', { path, rolls: [50, 50] });
  assert.deepEqual([at(s, 'T1').x, at(s, 'T1').y, at(s, 'T1').z], [6, 8, 1]);
});

test('Entry opens the Stair A discharge from inside only; then it is a way out', () => {
  let s = start();
  assert.throws(() => R.technicalAction(place(s, 'E1', 9, 5, 0), 'E1', 'DISCHARGE', 'BREACH'), /not in position/);
  s = place(s, 'E1', 8, 5, 1);
  assert.throws(() => R.technicalAction(place(s, 'T1', 8, 4, 1), 'T1', 'DISCHARGE', 'BREACH'), /cannot operate/);
  const out = R.technicalAction(s, 'E1', 'DISCHARGE', 'BREACH');
  assert.equal(out.accepted, true);
  assert.ok(!out.state.blockers.some((b) => b.x === 9 && b.y === 4 && b.z === 0), 'the landing outside is open');
  const reach = R.computeReach(squadOnly(out.state), 'E1', Infinity);
  assert.equal(reach.costAt(9, 4, 0), 2, 'out through the stair enclosure');
});

test('Technical reports twice at the security interface, then the squad assembles at Assembly Area A', () => {
  let s = place(start(), 'T1', 6, 4, 1);
  assert.throws(() => R.technicalAction(place(s, 'E1', 6, 6, 1), 'E1', 'INTERFACE', 'LINK_1'), /cannot operate/);
  s = R.technicalAction(s, 'T1', 'INTERFACE', 'LINK_1').state;
  assert.equal(s.nodes.find((n) => n.id === 'INTERFACE').state, 'WORK_IN_PROGRESS');
  s = R.technicalAction(s, 'T1', 'INTERFACE', 'LINK_2').state;
  assert.equal(s.nodes.find((n) => n.id === 'INTERFACE').state, 'VERIFIED');
  assert.equal(R.missionComplete(s), false, 'assembly is still required');
  for (const [id, x, y] of [['E1', 11, 9], ['R1', 11, 8], ['T1', 10, 9]]) { s = place(s, id, x, y, 0); s = R.extractUnit(s, id); }
  assert.equal(R.missionComplete(s), true);
});

test('a hostile phase on the building is deterministic and leaves a playable state', () => {
  const run = () => runThreatPhase(R.beginThreatPhase(start(5)), { rng: [40, 70, 10, 90, 55, 25, 60, 80, 30, 50, 45, 65] });
  const a = run(), b = run();
  assert.deepEqual(a.events, b.events);
  const next = R.beginPlayerPhase(R.resolveClockStatePhase(a.state));
  assert.equal(next.phase, 'PLAYER');
});

test('the level is in the registry and the tactics menu, and the page loads it by id', async () => {
  assert.ok(LEVELS['equity-uprise-hq'] && LEVELS['transit-relay']);
  assert.equal((await loadLevel('equity-uprise-hq')).LEVEL_ID, 'equity-uprise-hq');
  assert.equal((await loadLevel('nope')).LEVEL_ID, 'transit-relay', 'an unknown id plays the default level');
  const menu = await readFile(new URL('../../js/prim3-tactics/preview.mjs', import.meta.url), 'utf8');
  assert.match(menu, /prim3-transit\.html\?level=equity-uprise-hq/);
  const page = await readFile(new URL('../../js/prim3-tactics/transit.mjs', import.meta.url), 'utf8');
  assert.match(page, /loadLevel\(new URLSearchParams\(location\.search\)\.get\('level'\)\)/);
  assert.match(page, /prim3\.transit\.v1/, 'Transit keeps its save');
  // the level draws no mark: no image, logo or emblem reference anywhere in the level or its renderer path
  const lvl = await readFile(new URL('../../js/prim3-tactics/levels/equity-uprise-hq.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(lvl, /\.(png|jpe?g|svg|webp)\b|logo|emblem/i);
});

test('B1 is a normal floor: both protected stairs go down to it from Floor 1, its plant rooms are shut like Floor 1\'s', () => {
  const s = start(), cfg = L.engineConfig();
  assert.equal(L.floorName(8), 'B1'); assert.equal(L.storeyOf(8), 0);
  assert.ok(Math.abs(L.floorHeight(8) + 13.5 * 0.3048) < 1e-9);
  assert.deepEqual(cfg.links.filter((l) => l.from.z === 8 || l.to.z === 8).map((l) => l.id).sort(), ['stair-a-east-0-1', 'stair-b-west-0-1']);
  const reach = R.computeReach(squadOnly(s), 'T1', Infinity);
  assert.ok(Number.isFinite(reach.costAt(5, 4, 8)), 'the tunnel concourse'); assert.ok(Number.isFinite(reach.costAt(5, 5, 8)), 'the systems lab');
  assert.ok(!Number.isFinite(reach.costAt(4, 7, 8)), 'the mechanical plant stays shut');
});

test('full strength (the roof shooters exactly as defined) is hard but winnable: a heuristic squad wins some, loses more', async () => {
  const { hqRates, playHq } = await import('../prim3/hq-drill-sim.mjs');
  const cfg = L.engineConfig(), roof = cfg.units.filter((u) => u.z === 7);
  assert.deepEqual(roof.map((u) => [u.id, u.hp, u.aim, u.detectionRadius]), [['H3', 5, 62, 8], ['H4', 5, 58, 6]], 'the roof shooters are not weakened');
  const r = hqRates(40, 'naive');
  assert.ok(r.wins >= 1 && r.wins <= 30, `wins ${r.wins}/40`);
  const fx = JSON.parse(await readFile(new URL('fixtures/hq-drill-full-strength-win.json', import.meta.url), 'utf8'));
  const source = JSON.parse(await readFile(new URL('../../js/prim3-tactics/SOURCE.json', import.meta.url), 'utf8'));
  assert.equal(fx.engineCommit, source.commit);
  const g = playHq(fx.seed, fx.policy);
  assert.equal(g.outcome, 'win'); assert.deepEqual(g.trace, fx.trace, 'the recorded winning run replays exactly');
});

test('phone layout: the objective is a strip docked above the battlefield, never over it; mobile-first queries only', async () => {
  const html = await readFile(new URL('../../prim3-transit.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="txObj"') < html.indexOf('id="txStage"') && html.indexOf('id="txObj"') < html.indexOf('class="tx-3d"'), 'the strip comes before the stage');
  assert.ok(!/<section class="tx-stage"[^]*id="txObj"[^]*<\/section>\s*<aside/.test(html.slice(html.indexOf('class="tx-stage"'), html.indexOf('<aside'))), 'the strip is not inside the stage');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.doesNotMatch(css.match(/\.tx-obj\{[^}]*\}/)[0], /position:\s*absolute/);
  assert.doesNotMatch(css, /@media\s*\(max-width/, 'min-width queries only');
  assert.match(css, /grid-template-areas:"top top" "obj side" "stage side"/, 'desktop docks it above the stage too');
  const page = await readFile(new URL('../../js/prim3-tactics/transit.mjs', import.meta.url), 'utf8');
  assert.match(page, /r3\.frame\(LEVEL\.OPENING\)/, 'a level frames its own opening shot');
  assert.ok(L.OPENING && L.OPENING.dist < L.OPENING_DIST && L.OPENING.pitch < 0.86, 'the HQ opening is closer and lower than the old one');
});
