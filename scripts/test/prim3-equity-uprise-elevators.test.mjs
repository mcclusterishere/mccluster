/* PRIM3 × Equity Uprise: permitted elevators are usable links (audit EQ3).
   A cab is boarded from the landing in front of the shaft's access opening (the package's opening_ft /
   access_side), never from inside the shaft: shafts stay solid, and a mission that does not permit the
   cabs still moves by stair only. Nothing here implies passenger-elevator service to Level 7. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as A from '../../js/prim3-tactics/adapters/equity-uprise/adapter.mjs';
import { loadPackage } from '../../js/prim3-tactics/adapters/equity-uprise/pipeline.mjs';
import { SPEC } from '../../js/prim3-tactics/missions/blind-the-floor.mjs';

const pkgP = loadPackage();
const unit = (x, y, z) => ({ id: 'T', faction: 'PLAYER', role: 'T', x, y, z });
const state = (t, u) => R.createState({ width: 12, height: 13, floors: 9, surfaces: t.surfaces, links: t.links, blockers: t.blockers, units: [u] });
const solid = (t) => new Set(t.blockers.filter((b) => b.h == null).map((b) => A.key(b.x, b.y, b.z)));

test('elevator links board and alight on the landing in front of the access opening, never inside the shaft', async () => {
  const pkg = await pkgP, t = A.traversal(pkg, { levels: [1, 3], elevators: true });
  const cabs = t.links.filter((k) => k.kind === 'elevator');
  assert.equal(cabs.length, 2, 'the passenger cab and the service/freight cab');
  const blocked = solid(t);
  for (const k of cabs) for (const end of [k.from, k.to]) assert.ok(!blocked.has(A.key(end.x, end.y, end.z)), `${k.id}: ${JSON.stringify(end)} is a walkable landing`);
  for (const c of pkg.cores.filter((x) => /elevator/.test(x.type))) {
    const shaft = A.rectCells(c.bounds_ft)[0], landing = A.elevatorLanding(c);
    assert.deepEqual(A.levelGrid(pkg, 1).cells.get(`${shaft.x}:${shaft.y}`).kind, 'shaft', `${c.id}: the shaft is still solid`);
    assert.equal(Math.abs(landing.x - shaft.x) + Math.abs(landing.y - shaft.y), 1, `${c.id}: the landing is the cell on the access side`);
    const link = cabs.find((k) => k.id.startsWith(c.id));
    assert.deepEqual([link.from.x, link.from.y, link.to.x, link.to.y], [landing.x, landing.y, landing.x, landing.y]);
  }
  assert.deepEqual(A.elevatorLanding(pkg.cores.find((c) => c.id === 'passenger-elevator-a')), { x: 6, y: 5 }, 'west of the hoistway (opening at x = 54 ft)');
  assert.deepEqual(A.elevatorLanding(pkg.cores.find((c) => c.id === 'service-freight-elevator-a')), { x: 3, y: 4 }, 'south of the shaft (opening at y = 60 ft)');
});

test('a served non-consecutive floor pair with no stair path is reachable by cab, and the trip comes back', async () => {
  const pkg = await pkgP, t = A.traversal(pkg, { levels: [1, 3], elevators: true });
  assert.ok(!t.links.some((k) => k.kind === 'stair'), 'Floors 1 and 3 alone: no one-storey stair link joins them');
  const up = R.computeReach(state(t, unit(6, 6, 1)), 'T', Infinity);
  assert.ok(Number.isFinite(up.costAt(6, 5, 3)), 'Floor 3 passenger landing');
  assert.ok(Number.isFinite(up.costAt(3, 4, 3)), 'Floor 3 service/freight landing');
  assert.equal(up.costAt(7, 5, 3), undefined, 'the hoistway itself is never a destination');
  const down = R.computeReach(state(t, unit(6, 5, 3)), 'T', Infinity);
  assert.ok(Number.isFinite(down.costAt(6, 6, 1)), 'and back down to Floor 1');
});

test('elevators:false (the default) and unserved levels deny the cab', async () => {
  const pkg = await pkgP;
  const off = A.traversal(pkg, { levels: [1, 3] });
  assert.ok(!off.links.some((k) => k.kind === 'elevator'));
  assert.equal(R.computeReach(state(off, unit(6, 6, 1)), 'T', Infinity).costAt(6, 5, 3), undefined, 'no cab, no stair: Floor 3 stays out of reach');
  const roof = A.traversal(pkg, { levels: [6, 7], elevators: true });
  assert.ok(!roof.links.some((k) => k.kind === 'elevator'), 'no cab serves the Level 7 roof (Core V2)');
  assert.ok(roof.links.some((k) => k.kind === 'stair' && k.to.z === 7), 'the roof is reached by protected stair');
});

test('the B1 exercise still moves by stair: its spec keeps elevators off', async () => {
  assert.equal(SPEC.elevators, false);
});
