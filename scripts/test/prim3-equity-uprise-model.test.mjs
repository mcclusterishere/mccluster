/* PRIM3 · Equity Uprise HQ: the building's own GLBs (the look) land on the level's plan rectangles (the
   rules), the model manifest points only at files the building pipeline builds and publishes, nothing the
   level draws reconstructs a mark, and the drill can be played from the public way to Assembly Area A on
   the real resolver. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection, knownPaths } from '../../js/prim3-tactics/tactical-hints.mjs';
import * as L from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';

const GEN = new URL('../../docs/design/equity-uprise-building/production/generated/', import.meta.url);
const FT = 0.3048;
const exists = (u) => access(u).then(() => true, () => false);

// a GLB's nodes with their mesh bounds in building feet. Architecture is exported translated only (checked);
// v3 instanced furniture nodes (`<id>::<catalog type>`) carry a rotation matrix, applied here to the bounds.
async function glbNodes(file) {
  const buf = await readFile(new URL(file, GEN));
  let off = 12, json = null;
  while (off < buf.length) { const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4); if (type === 0x4E4F534A) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8')); off += 8 + len; }
  const out = new Map();
  for (const n of json.nodes) {
    const furniture = /::[a-z0-9_]+$/.test(n.name) && n.mesh != null && /-FURN-/.test(json.meshes[n.mesh].name || '');
    assert.ok(!n.rotation && !n.scale && (!n.matrix || furniture), `${file}: ${n.name} is translated only`);
    if (n.mesh == null) continue;
    const t = n.translation || [0, 0, 0], m = n.matrix, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
        const v = m ? [0, 1, 2].map((k) => m[k] * cx + m[4 + k] * cy + m[8 + k] * cz + m[12 + k]) : [cx + t[0], cy + t[1], cz + t[2]];
        for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
      }
    }
    out.set(n.name, { x1: lo[0] / FT, y1: lo[1] / FT, z1: lo[2] / FT, x2: hi[0] / FT, y2: hi[1] / FT, z2: hi[2] / FT });
  }
  return out;
}
const union = (nodes, re) => { let r = null; for (const [k, b] of nodes) if (re.test(k)) r = r ? { x1: Math.min(r.x1, b.x1), y1: Math.min(r.y1, b.y1), z1: Math.min(r.z1, b.z1), x2: Math.max(r.x2, b.x2), y2: Math.max(r.y2, b.y2), z2: Math.max(r.z2, b.z2) } : { ...b }; assert.ok(r, `no node matches ${re}`); return r; };
const near = (a, b, msg, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
// a plan rectangle (feet) and a model box (feet) in renderer world units, through the level's own mapping
const worldRect = (r) => { const a = L.ftToTile(r.x1, r.y1), b = L.ftToTile(r.x2, r.y2); return { X1: a.x, X2: b.x, Z1: b.y, Z2: a.y }; }; // ftToTile maps the plan to tile-centred world units: (0, 0) ft is the corner 2.5, 8.5
const worldBox = (b, ffeFt = 0) => { const a = L.modelToWorld(b.x1 * FT, b.y1 * FT, b.z1 * FT, ffeFt), c = L.modelToWorld(b.x2 * FT, b.y2 * FT, b.z2 * FT, ffeFt); return { X1: a.X, X2: c.X, Z1: c.Z, Z2: a.Z, Y1: a.Y, Y2: c.Y }; };
const sameXZ = (box, rect, msg, eps = 0.01) => { const w = worldBox(box), p = worldRect(rect); for (const k of ['X1', 'X2', 'Z1', 'Z2']) near(w[k], p[k], `${msg} ${k}`, eps); };

test('one uniform scale: 12 ft a world unit in every direction, and heights agree with the rules', () => {
  assert.equal(L.WORLD_M, 12 * FT);
  const o = L.modelToWorld(0, 0, 0), e = L.modelToWorld(72 * FT, 72 * FT, 72 * FT);
  assert.deepEqual([o.X, o.Z], [L.ftToTile(0, 0).x, L.ftToTile(0, 0).y]);
  near(e.X - o.X, 6, 'plate width', 1e-9); near(o.Z - e.Z, 6, 'plate depth', 1e-9); near(e.Y - o.Y, 6, '72 ft up is 6 units too', 1e-9);
  // the renderer stands a unit on floor z at surface height / WORLD_M: the model's finished floors must be there
  for (let z = 1; z <= 7; z += 1) near(L.modelToWorld(0, 0, 0, (z - 1) * 13.5).Y, L.floorHeight(z) / L.WORLD_M, `floor ${z}`, 1e-9);
  // the plate's corners are tile edges: tiles 3…8 on both axes
  assert.deepEqual([o.X, e.X, e.Z, o.Z], [2.5, 8.5, 2.5, 8.5]);
});

test('the combined chassis lands on the plan: plate, both stairs, both elevators, the riser, Floor 1 and the roof', async () => {
  const n = await glbNodes('equity-uprise-building-core-v2.glb');
  sameXZ(union(n, /^L1_slab_/), L.PLAN.plate, 'Floor 1 slab = plate');
  sameXZ(union(n, /^stair_a_enclosure_(east|north|west)$/), L.PLAN.core.stairA, 'Stair A enclosure');
  sameXZ(union(n, /^stair_b_enclosure_(east|north|west)$/), L.PLAN.core.stairB, 'Stair B enclosure (X8–18)');
  sameXZ(union(n, /^passenger_elevator_shaft_/), L.PLAN.core.passengerElevator, 'passenger elevator');
  sameXZ(union(n, /^freight_elevator_shaft_/), L.PLAN.core.freightElevator, 'service/freight elevator');
  // finished floors: the top of each storey's slab is that storey's height in the rules
  for (let z = 1; z <= 7; z += 1) near(worldBox(union(n, new RegExp(`^L${z}_slab_`))).Y2, L.floorHeight(z) / L.WORLD_M, `L${z} slab top`, 1e-3);
  // and the stair enclosures fall on the very tiles the rules walk
  const tilesOf = (r) => { const w = worldBox(r), xs = [], zs = []; for (let x = Math.ceil(w.X1 - 0.5); x <= Math.floor(w.X2 - 0.5 + 1e-9); x += 1) xs.push(x); for (let y = Math.ceil(w.Z1 - 0.5); y <= Math.floor(w.Z2 - 0.5 + 1e-9); y += 1) zs.push(y); return { xs, zs }; };
  const a = tilesOf(union(n, /^stair_a_enclosure_(east|north|west)$/));
  assert.deepEqual(a.xs, [8]); assert.ok(L.CORE.stairA.every((c) => c.x === 8 && c.y >= 3 && c.y <= 4));
  // site: the public way and the primary assembly area are where the level paints them
  sameXZ(union(n, /^SITE_01_public_way$/), L.PLAN.site.publicWay, 'public way');
  sameXZ(union(n, /^SITE_06_assembly$/), L.PLAN.site.assemblyA, 'Assembly Area A');
});

test('the Level 7 roof model sits at +81 ft on the plan: overruns, screen, mechanical units, beacon', async () => {
  const n = await glbNodes('equity-uprise-floor-07-core-v2.glb'), part = L.MODEL.parts.find((p) => p.id === 'roof');
  assert.equal(part.ffeFt, 81);
  near(worldBox(union(n, /^F7-ROOF-DECK-01::/), part.ffeFt).Y2, L.floorHeight(7) / L.WORLD_M, 'roof deck top', 1e-3);
  sameXZ(union(n, /^F7-PASSENGER-OVERRUN-01/), L.PLAN.roof.passengerOverrun, 'passenger overrun');
  sameXZ(union(n, /^F7-MEP-SCREEN-01/), L.PLAN.roof.mepScreen, 'MEP screen');
  sameXZ(union(n, /^F7-MECH-UNIT-01/), L.PLAN.roof.mechUnit1, 'mechanical unit 1', 0.03);
  const b = union(n, /^F7-ECOSYSTEM-BEACON-01::pedestal$/);
  near((b.x1 + b.x2) / 2, L.PLAN.roof.beacon.cx, 'beacon x'); near((b.y1 + b.y2) / 2, L.PLAN.roof.beacon.cy, 'beacon y');
});

test('the facade wraps the plate and none of its signage is drawn', async () => {
  const n = await glbNodes('equity-uprise-facade-core-v2.glb'), part = L.MODEL.parts.find((p) => p.id === 'facade');
  const vision = union(n, /^FAC-(SOUTH|NORTH|EAST|WEST)-F1-M\d+::vision$/);
  near(vision.x1, 0, 'west face', 0.5); near(vision.x2, 72, 'east face', 0.5); near(vision.y1, 0, 'south face', 0.5);
  near(vision.z1, 0.5, 'Floor 1 glass starts at the sill'); near(vision.z2, 11, 'Floor 1 glass to 11 ft');
  // building v3: no mark, plate or lettering geometry at all; identity positions are empty brand-slot nodes
  const marks = [...n.keys()].filter((k) => /LOGO|WORDMARK|LETTER|SIGN/i.test(k));
  for (const k of marks) assert.match(k, part.drop, `${k} is dropped, never drawn`);
  const buf = await readFile(new URL('equity-uprise-facade-core-v2.glb', GEN)); const jl = buf.readUInt32LE(12);
  const slots = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8')).nodes.filter((x) => x.name.startsWith('brand-slot::'));
  assert.ok(slots.length >= 3 && slots.every((x) => x.mesh == null && x.extras && x.extras.brand_slot), 'the facade carries empty brand slots');
  assert.deepEqual(part.tiers, ['mid', 'high'], 'the 2.5 MB facade stays off the battery tier');
});

test('the model manifest names only files the building pipeline builds and publishes', async () => {
  const deploy = await readFile(new URL('../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.ok(L.MODEL.roots[0].endsWith('/equity-uprise-preview/') && L.MODEL.roots[1].endsWith('/production/generated/'));
  assert.equal(L.MODEL.parts.filter((p) => p.required).map((p) => p.id).join(), 'chassis');
  for (const p of L.MODEL.parts) {
    const committed = await exists(new URL(p.file, GEN));
    const n = (p.file.match(/floor-0(\d)-core/) || [])[1];
    const published = deploy.includes(p.file) || (n && deploy.includes('equity-uprise-floor-${n}-core-v2.glb') && deploy.includes(`build_equity_uprise_floor_0${n}_v2.py`));
    assert.ok(published, `${p.file} is copied to equity-uprise-preview/ by deploy-pages.yml`);
    if (!p.lazy && p.id !== 'floor-01') assert.ok(committed, `${p.file} is committed`);
    for (const [re, by] of p.replacedBy || []) assert.ok(re instanceof RegExp && L.MODEL.parts.some((q) => q.id === by), `${p.id}: ${by} is a part`);
  }
  // the lazy floors are Floors 2–6 and B1, each at its finished floor
  assert.deepEqual(L.MODEL.parts.filter((p) => p.lazy).map((p) => [p.storey, p.ffeFt]), [[2, 13.5], [3, 27], [4, 40.5], [5, 54], [6, 67.5], [0, -13.5]]);
  assert.deepEqual([0, 1, 2, 6, 7, 8].map(L.storeyOf), [1, 1, 2, 6, 7, 0]);
  // a floor's identity-sign slot is never drawn by the game (the building's brand slot is not ours to render)
  for (const p of L.MODEL.parts.filter((q) => /^floor-0/.test(q.id))) assert.ok(p.drop.test('F4-IDENTITY-SIGN-01::sign'), p.id);
});

test('when Floor 1 is built, its reception, vestibule and stair barriers land on the plan', async (t) => {
  if (!(await exists(new URL('equity-uprise-floor-01-core-v2.glb', GEN)))) { t.skip('Floor 1 GLB is built at publish time (deploy-pages.yml); build it locally to run this'); return; }
  const n = await glbNodes('equity-uprise-floor-01-core-v2.glb');
  sameXZ(union(n, /^F1-RECEPTION-DESK-01::plinth$/), L.PLAN.floor1.reception, 'reception desk');
  sameXZ(union(n, /^floor_slab$/), L.PLAN.plate, 'Floor 1 slab');
  const bar = union(n, /^F1-STAIR-A-BARRIER-DOWN::/); assert.ok(bar.x1 >= L.PLAN.core.stairA.x1 && bar.x2 <= L.PLAN.core.stairA.x2, 'Stair A barrier inside Stair A');
});

test('the drill plays start to finish on the real resolver: in by the public entrance, two reports, exit opened, roof reached, all assembled', () => {
  // squad only (the role-players are the AI's job; this proves the route exists and the rules allow every step)
  let s = R.beginPlayerPhase(R.createState(L.engineConfig({ seed: 7 })));
  s = { ...s, units: s.units.filter((u) => u.faction === 'PLAYER') };
  const at = (id) => s.units.find((u) => u.id === id);
  const goTo = (id, g) => {
    for (let guard = 0; guard < 40; guard += 1) {
      const u = at(id); if (u.x === g.x && u.y === g.y && (u.z || 0) === g.z) return;
      if (u.ap < 1) { s = R.beginPlayerPhase(R.resolveClockStatePhase(R.beginThreatPhase(s))); continue; }
      const kp = knownPaths(playerProjection({ ...s, units: s.units.map((x) => (x.id === id ? { ...x, moveRange: 999 } : x)) }), id);
      const full = kp.pathTo(g.x, g.y, g.z); assert.ok(full && full.length, `${id} has a route to ${JSON.stringify(g)}`);
      // the furthest point of the route this move reaches
      const near = knownPaths(playerProjection(s), id); let dest = null;
      for (const p of full) if (Number.isFinite(near.dist.get(near.key(p.x, p.y, p.z || 0)))) dest = p;
      assert.ok(dest, `${id} can make progress`);
      s = R.moveUnit(s, id, { x: dest.x, y: dest.y, z: dest.z || 0 }, 'MOVE', { path: near.pathTo(dest.x, dest.y, dest.z || 0), rolls: [50, 50] });
    }
    assert.fail(`${id} never reached ${JSON.stringify(g)}`);
  };
  goTo('T1', { x: 6, y: 6, z: 1 });
  assert.equal(at('T1').z, 1, 'T is on Floor 1, in by the public entrance');
  for (const act of ['LINK_1', 'LINK_2']) { if (at('T1').ap < 1) s = R.beginPlayerPhase(R.resolveClockStatePhase(R.beginThreatPhase(s))); s = R.technicalAction(s, 'T1', 'INTERFACE', act).state; }
  assert.equal(s.nodes.find((n) => n.id === 'INTERFACE').state, 'VERIFIED');
  goTo('E1', { x: 8, y: 5, z: 1 });
  if (at('E1').ap < 1) s = R.beginPlayerPhase(R.resolveClockStatePhase(R.beginThreatPhase(s)));
  s = R.technicalAction(s, 'E1', 'DISCHARGE', 'BREACH').state;
  goTo('R1', { x: 5, y: 6, z: 7 }); // up a stair, six storeys, to the roof
  goTo('R1', { x: 11, y: 8, z: 0 });
  goTo('E1', { x: 10, y: 9, z: 0 }); // out through the opened Stair A discharge or the entrance, whichever is shorter
  goTo('T1', { x: 11, y: 9, z: 0 });
  for (const id of ['T1', 'E1', 'R1']) s = R.extractUnit(s, id);
  assert.equal(R.missionComplete(s), true);
});
