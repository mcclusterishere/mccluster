/* PRIM3 · Equity Uprise HQ / Emergency Exercise — level data (review branch; not public canon).

   The Equity Uprise building on the PRIM3 tactics grid, from its canonical plan data. Nothing here is
   drawn from a render: every rectangle below is copied, in feet, from the building authority and is
   checked against it by scripts/test/prim3-equity-uprise-level.test.mjs:
     production/building-core-v2.json          plate, levels, stairs A/B, elevators, MEP riser
     production/core-v2-floor-programs.json    Floor 1 zones and the shared support band
     production/floor-01/floor-01-site-egress.json   site, public way, egress walks, doors, assembly areas
     production/floor-07/floor-07-object-inventory.json  Level 7 roof headhouses, overruns, screens, beacon
   This file never edits those files; the building's authority stays in docs/design/equity-uprise-building/.

   The mission is Floor 1's own "Emergency Exercise" interaction mode (authorized participants or an
   instructor): a drill. The opposition are exercise role-players, not an attack on the building.

   Grid. Plans are laid on the grid at 12 ft (3.66 m) a tile, 3.3% over the 3.54 m game tile, so the
   72 ft plate is exactly 6 × 6 tiles and the 18 ft structural grid falls every 1.5 tiles. Heights stay
   real metres. A plan rectangle covers a tile when it overlaps at least half of it on both axes;
   a rectangle that covers no tile that way takes the tile under its centre. Shared vertical systems
   (stairs, elevators, riser) win any tile they share with a floor-local room.

   Floors (engine z):
     z0  the site at grade (the building footprint is solid here: walls are movement-only, see below)
     z1  Floor 1, finished floor 0 ft: the plate is a surface at height 0, entered through its doors
     z2…z6  Floors 2–6: their slabs, but only the landings inside Stair A and Stair B are open (the
            drill keeps the floor doors shut, so the rest of each floor is a closed, opaque volume)
     z7  Level 7, the open-air roof at 81 ft
     z8  B1 (−13.5 ft): a normal, staffed floor (owner, 2026-11-03: "We can have B1. Everybody's welcome to B1.
         Make it normal."). Its cells, rooms and stairs come from the building package through the PRIM3 adapter
         (adapters/equity-uprise/): both protected stairs go down to it; its plant rooms are shut like Floor 1's.
   Because the engine's walls are whole tiles, Floor 1 is a separate floor joined to the site only at
   its doors; its facade is glazing, so it stops movement but not sight. */

import { TILE_M } from '../scale.mjs';
import { loadPackage } from '../adapters/equity-uprise/pipeline.mjs';
import * as EU from '../adapters/equity-uprise/adapter.mjs';
const PKG = await loadPackage();
export { TILE_M };

export const LEVEL_ID = 'equity-uprise-hq';
export const FT = 0.3048;
export const FT_PER_TILE = 12;
export const W = 12, H = 13, FLOORS = 9;
// the building's south-west corner (0, 0 ft) is the corner of tile (3, 8); +X east, +Y north
export const ORIGIN = { x: 3, y: 9 };
export const FRAME = { x0: 3, y0: 8, yUp: true };
export const toDisplay = (x, y) => ({ X: x - FRAME.x0, Y: FRAME.y0 - y });
export const STOREY_M = 13.5 * FT;
export const LEVEL_Z = { site: 0, floor1: 1, roof: 7 };
export const floorHeight = (z) => (z === 8 ? -STOREY_M : z <= 1 ? 0 : (z - 1) * STOREY_M); // z7 → 81 ft, z8 (B1) → −13.5 ft
// the fog of war is read on the floor a tile is walked on at street level: Floor 1 inside the plate
export const fogFloor = (x, y) => (x >= 3 && x < 9 && y >= 3 && y < 9 ? 1 : 0);
export const floorName = (z) => (z === 0 ? '' : z === 1 ? 'Floor 1' : z === 7 ? 'Level 7 roof' : z === 8 ? 'B1' : `Stair, Floor ${z}`);

/* ---------- canonical plan rectangles (feet, building coordinates) ---------- */
export const PLAN = {
  plate: { x1: 0, y1: 0, x2: 72, y2: 72 },
  siteBounds: { x1: -36, y1: -48, x2: 108, y2: 108 },
  core: {
    stairA: { x1: 60, y1: 54, x2: 72, y2: 72 },
    stairB: { x1: 8, y1: 54, x2: 18, y2: 72 },
    passengerElevator: { x1: 54, y1: 34, x2: 62, y2: 44 },
    freightElevator: { x1: 0, y1: 60, x2: 8, y2: 72 },
    mepRiser: { x1: 50, y1: 66, x2: 60, y2: 72 }
  },
  floor1: {
    vestibule: { x1: 29, y1: 0, x2: 43, y2: 9 },
    intakeRoom: { x1: 2, y1: 32, x2: 16, y2: 44 },
    reception: { x1: 30, y1: 44, x2: 42, y2: 47 },
    journeyWall: { x1: 28, y1: 50, x2: 44, y2: 54 },
    corridor: { x1: 18, y1: 54, x2: 60, y2: 60 },
    restroomA: { x1: 18, y1: 60, x2: 26, y2: 70 },
    restroomB: { x1: 26, y1: 60, x2: 34, y2: 70 },
    supportA: { x1: 34, y1: 60, x2: 42, y2: 72 },
    supportB: { x1: 42, y1: 60, x2: 50, y2: 72 },
    janitor: { x1: 50, y1: 60, x2: 54, y2: 66 }
  },
  site: {
    publicWay: { x1: -18, y1: -36, x2: 90, y2: -24 },
    publicApproach: { x1: 30, y1: -24, x2: 42, y2: 0 },
    eastEgressWalk: { x1: 72, y1: -24, x2: 84, y2: 62 },
    serviceApron: { x1: -24, y1: 48, x2: 0, y2: 68 },
    assemblyA: { x1: 88, y1: -8, x2: 108, y2: 16 },
    assemblyB: { x1: 88, y1: 78, x2: 108, y2: 102 }
  },
  doors: {
    publicOuter: { facade: 'south', x1: 31, x2: 41 },
    stairADischarge: { facade: 'east', x: 72, y1: 56, y2: 60 },
    stairBDischarge: { facade: 'north', y: 72, x1: 12, x2: 15 },
    serviceWest: { facade: 'west', x: 0, y1: 56, y2: 59 }
  },
  roof: {
    passengerOverrun: { x1: 54, y1: 34, x2: 62, y2: 44, h_ft: 8 },
    freightOverrun: { x1: 0, y1: 60, x2: 8, y2: 72, h_ft: 8 },
    mepScreen: { x1: 50, y1: 66, x2: 60, y2: 72, h_ft: 6 },
    mechUnit1: { x1: 35, y1: 62, x2: 40, y2: 68, h_ft: 4 },
    mechUnit2: { x1: 41, y1: 62, x2: 46, y2: 68, h_ft: 4 },
    beacon: { cx: 48, cy: 27, w: 2.5, d: 5, z_ft: 3.5 },
    mobilityRing: { cx: 29, cy: 27, r: 13.5 },
    overlookDeck: { x1: 12, y1: 0.75, x2: 46, y2: 6 }
  }
};

/* ---------- plan → grid ---------- */
// building feet → continuous tile coordinates (tile centres are integers, as in the renderer)
export const ftToTile = (xf, yf) => ({ x: ORIGIN.x + xf / FT_PER_TILE - 0.5, y: ORIGIN.y - yf / FT_PER_TILE - 0.5 });
export function rectTiles(r) {
  const xs = [], ys = [];
  for (let i = 0; i < W; i += 1) { const a = (i - ORIGIN.x) * FT_PER_TILE, ov = Math.min(r.x2, a + 12) - Math.max(r.x1, a); if (ov >= 6 - 1e-9) xs.push(i); }
  for (let j = 0; j < H; j += 1) { const top = (ORIGIN.y - j) * FT_PER_TILE, ov = Math.min(r.y2, top) - Math.max(r.y1, top - 12); if (ov >= 6 - 1e-9) ys.push(j); }
  const c = ftToTile((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2);
  if (!xs.length) xs.push(Math.round(c.x));
  if (!ys.length) ys.push(Math.round(c.y));
  const out = []; for (const y of ys) for (const x of xs) out.push({ x, y }); return out;
}
const one = (r) => rectTiles(r)[0];
const key = (x, y, z = 0) => `${x}:${y}:${z}`;

export const PLATE = (() => { const t = rectTiles(PLAN.plate); return { x: Math.min(...t.map((c) => c.x)), y: Math.min(...t.map((c) => c.y)), w: 6, d: 6 }; })();
export const CORE = Object.fromEntries(Object.entries(PLAN.core).map(([k, r]) => [k, rectTiles(r)]));
const STAIRS = { A: CORE.stairA, B: CORE.stairB };
const isStair = (x, y) => [...STAIRS.A, ...STAIRS.B].some((c) => c.x === x && c.y === y);
const coreCell = (x, y) => Object.values(CORE).some((cs) => cs.some((c) => c.x === x && c.y === y));

// the stair foot on Floor 1 is the enclosure tile on the corridor side (south); flights switch back
// between the enclosure's two tiles, one storey (13.5 ft) per link
function stairLinks(name) {
  const cells = [...STAIRS[name]].sort((a, b) => b.y - a.y); // [south, north]
  const out = [];
  for (let z = 1; z < 7; z += 1) {
    const from = cells[(z - 1) % 2], to = cells[z % 2];
    out.push({ id: `stair-${name.toLowerCase()}-${z}-${z + 1}`, from: { x: from.x, y: from.y, z }, to: { x: to.x, y: to.y, z: z + 1 }, cost: 3 });
  }
  return out;
}

/* ---------- the scene the renderer and the sector map draw ---------- */
const doorOut = one({ x1: PLAN.doors.publicOuter.x1, y1: -1, x2: PLAN.doors.publicOuter.x2, y2: 0 }); // the step outside the doors
const doorIn = { x: doorOut.x, y: doorOut.y - 1 };
const dischargeIn = one({ x1: 60, y1: PLAN.doors.stairADischarge.y1, x2: 72, y2: PLAN.doors.stairADischarge.y2 });
const dischargeOut = { x: dischargeIn.x + 1, y: dischargeIn.y };
const receptionCells = rectTiles(PLAN.floor1.reception);

export const SCENE = {
  kind: 'building',
  plan: PLAN, plate: PLATE, core: CORE, ftToTile, rectTiles,
  levels: Array.from({ length: 9 }, (_, z) => ({ z, height: floorHeight(z) })),
  basement: { z: 8, height: floorHeight(8) },
  // Floor 1 tiles the drill closes (rooms and shafts), with the height that blocks sight
  floor1Rooms: [
    ...['intakeRoom', 'restroomB', 'supportA', 'supportB'].flatMap((k) => rectTiles(PLAN.floor1[k]).map((c) => ({ ...c, id: k }))).filter((c) => !coreCell(c.x, c.y))
  ],
  reception: receptionCells,
  doors: [
    { id: 'public-entrance', label: 'Public entrance', out: doorOut, in: doorIn, open: true },
    { id: 'stair-a-discharge', label: 'Stair A exit discharge', out: dischargeOut, in: dischargeIn, open: false }
  ],
  zones: [
    { id: 'public-way', kind: 'street', cells: rectTiles(PLAN.site.publicWay) },
    { id: 'public-approach', kind: 'walk', cells: rectTiles(PLAN.site.publicApproach) },
    { id: 'east-egress-walk', kind: 'walk', cells: rectTiles(PLAN.site.eastEgressWalk) },
    { id: 'service-apron', kind: 'service', cells: rectTiles(PLAN.site.serviceApron) },
    { id: 'assembly-a', kind: 'assembly', cells: rectTiles(PLAN.site.assemblyA) },
    { id: 'assembly-b', kind: 'assembly', cells: rectTiles(PLAN.site.assemblyB) }
  ],
  roofProps: ['passengerOverrun', 'freightOverrun', 'mepScreen', 'mechUnit1', 'mechUnit2'].map((k) => ({ id: k, h: PLAN.roof[k].h_ft * FT, cells: rectTiles(PLAN.roof[k]) })),
  beacon: (() => { const b = PLAN.roof.beacon; return { ...one({ x1: b.cx - b.w / 2, y1: b.cy - b.d / 2, x2: b.cx + b.w / 2, y2: b.cy + b.d / 2 }), h: 2 * b.z_ft * FT }; })(),
  stairs: [],
  stairCores: Object.entries(STAIRS).map(([n, cells]) => ({ id: `stair-${n.toLowerCase()}`, name: `Stair ${n}`, cells })),
  objective: { id: 'INTERFACE', x: receptionCells[receptionCells.length - 1].x, y: receptionCells[0].y, z: 1, label: 'Security interface' },
  extraction: null,
  assembly: rectTiles(PLAN.site.assemblyA)
};
// the pad the squad extracts on: Assembly Area A (its 2 × 2 tiles), as one Manhattan zone
const AA = SCENE.assembly;
SCENE.extraction = { x: Math.max(...AA.map((c) => c.x)), y: Math.max(...AA.map((c) => c.y)), r: 1, z: 0, label: 'ASSEMBLY A' };

/* ---------- rules data ---------- */
export function surfaces() {
  const out = [{ id: 'floor-1', z: 1, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: 0 }];
  for (let z = 2; z <= 6; z += 1) out.push({ id: `floor-${z}`, z, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: floorHeight(z) });
  out.push({ id: 'level-7', z: 7, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: floorHeight(7) });
  out.push({ id: 'b1', z: 8, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: floorHeight(8) });
  return out;
}
// B1 from the building package, through the adapter: its rooms (shut, as Floor 1's are), shafts, cover, and the
// two protected stairs down from Floor 1 (the same switchback the stairs keep above)
export const B1 = (() => { const t = EU.traversal(PKG, { levels: [0, 1] }); return { blockers: t.blockers.filter((b) => b.z === 8), cover: t.cover.filter((c) => c.z === 8), links: t.links.filter((l) => l.kind === 'stair'), grid: t.grids[0] }; })();
const inPlate = (x, y) => x >= PLATE.x && x < PLATE.x + PLATE.w && y >= PLATE.y && y < PLATE.y + PLATE.d;

export function buildBlockers({ dischargeOpen = false } = {}) {
  const out = new Map();
  const put = (x, y, z, h = null) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = key(x, y, z); const prev = out.get(k); if (!prev || (prev.h != null && (h == null || prev.h < h))) out.set(k, h == null ? { x, y, z } : { x, y, z, h }); };
  // z0: the building is solid at grade (movement only: Floor 1 is its own floor above the same tiles)
  for (let y = PLATE.y; y < PLATE.y + PLATE.d; y += 1) for (let x = PLATE.x; x < PLATE.x + PLATE.w; x += 1) put(x, y, 0);
  // the Stair A discharge landing outside: secured from the exterior until opened from inside
  if (!dischargeOpen) put(dischargeOut.x, dischargeOut.y, 0, 0);
  // Floor 1: shafts, closed rooms (full height) and the reception desk (low cover)
  for (const [k, cells] of Object.entries(CORE)) if (k !== 'stairA' && k !== 'stairB') for (const c of cells) put(c.x, c.y, 1);
  for (const c of SCENE.floor1Rooms) put(c.x, c.y, 1);
  for (const c of receptionCells) put(c.x, c.y, 1, 1.1);
  // Floors 2–6: closed to the drill except the stair landings (full height: they stop sight too)
  for (let z = 2; z <= 6; z += 1) for (let y = PLATE.y; y < PLATE.y + PLATE.d; y += 1) for (let x = PLATE.x; x < PLATE.x + PLATE.w; x += 1) if (!isStair(x, y)) put(x, y, z);
  // Level 7: overruns, MEP screen, mechanical units, the routing beacon
  for (const p of SCENE.roofProps) for (const c of p.cells) if (!isStair(c.x, c.y)) put(c.x, c.y, 7, p.h);
  put(SCENE.beacon.x, SCENE.beacon.y, 7, SCENE.beacon.h);
  for (const b of B1.blockers) put(b.x, b.y, b.z);
  return [...out.values()];
}

export function buildCover(blockers) {
  const bmap = new Map(blockers.map((b) => [key(b.x, b.y, b.z), b]));
  const surf = surfaces();
  const has = (x, y, z) => surf.some((s) => s.z === z && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.d);
  const walkable = (x, y, z) => x >= 0 && y >= 0 && x < W && y < H && !bmap.has(key(x, y, z)) && (z === 0 || has(x, y, z));
  const SIDES = [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]];
  const out = [];
  for (const z of [0, 1, 7]) for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (!walkable(x, y, z)) continue;
    let tall = 0; const sides = [];
    for (const [s, dx, dy] of SIDES) {
      const nx = x + dx, ny = y + dy, n = bmap.get(key(nx, ny, z));
      if (n && n.h !== 0 && (n.h == null || n.h >= 1)) {
        // the building at grade is glazing seen from outside: no cover from glass
        if (z === 0 && inPlate(nx, ny)) continue;
        sides.push(s); tall = Math.max(tall, n.h == null ? 9 : n.h);
      } else if (z === 7 && !n && !inPlate(nx, ny)) { sides.push(s); tall = Math.max(tall, 1.1); } // the roof parapet
    }
    if (sides.length) out.push({ x, y, z, type: tall >= 1.8 ? 'HIGH' : 'LOW', sides });
  }
  return out;
}

// the grid is drawn on the walkable raised surfaces only: the stair landings of Floors 2–6 and the roof
// (Floor 1 is at grade, on the ground grid; the rest of each closed floor is not a place to stand)
SCENE.gridSurfaces = [
  ...[2, 3, 4, 5, 6].flatMap((z) => [...STAIRS.A, ...STAIRS.B].map((c) => ({ z, x: c.x, y: c.y, w: 1, d: 1, height: floorHeight(z) }))),
  { z: 7, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: floorHeight(7) },
  { z: 8, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: floorHeight(8) }
];

/* ---------- the building's own 3D model: the look (the rules above stay on the plan data) ----------
   The renderer draws the Equity Uprise building from the GLBs its own pipeline builds
   (docs/design/equity-uprise-building/production/, deploy-pages.yml publishes them to equity-uprise-preview/).
   They are derived artifacts: they never change a blocker, a link or a height here, and the test
   scripts/test/prim3-equity-uprise-level.test.mjs checks that they land on the plan rectangles above.

   One scale. The plan is laid at 12 ft a tile, so this level is drawn at 12 ft (3.6576 m) a world unit
   in every direction: the model is scaled uniformly, and the operatives keep their real 1.75 m against
   it. The rules keep the shared 3.54 m tile (TILE_M) and real metres for heights. */
export const WORLD_M = FT_PER_TILE * FT;
// building metres (x east, y north, z up, as the GLBs are authored; Floor 1's finished floor is z 0) → world
export function modelToWorld(xm, ym, zm, ffeFt = 0) { const o = ftToTile(0, 0); return { X: o.x + xm / WORLD_M, Y: (zm + ffeFt * FT) / WORLD_M, Z: o.y - ym / WORLD_M }; }
const GENERATED = 'docs/design/equity-uprise-building/production/generated/';
const ROOT = new URL('../../../', import.meta.url);
const floorPart = (n) => ({
  id: `floor-0${n}`, file: `equity-uprise-floor-0${n}-core-v2.glb`, ffeFt: (n - 1) * 13.5, storey: n, lazy: true,
  // the combined chassis supplies the shared cores; the facade supplies the perimeter (as the building viewer does)
  drop: /^(stair_|pass_|freight_|mep)|IDENTITY-SIGN/, // the identity-sign slot is the building's brand slot: never drawn here
  replacedBy: [[/^(north_wall|west_wall|east_wall|south_mullion_)|^F[2-6]-SOUTH-GLAZING-01::pane-/, 'facade']]
});
export const MODEL = {
  // published copies first (the web root has no docs/), then the repository checkout
  roots: [new URL('equity-uprise-preview/', ROOT).href, new URL(GENERATED, ROOT).href],
  up: 'z', units: 'm', storeyFt: 13.5,
  // the height above a storey's finished floor where the cutaway slices the building (ceilings, lights and
  // everything above go): 8 ft, under the 11 ft ceilings and over the 7 ft door heads
  cutFt: 8,
  parts: [
    { id: 'chassis', file: 'equity-uprise-building-core-v2.glb', ffeFt: 0, required: true,
      // never drawn: the diagnostic program pads, door/egress/equipment markers and every storey's program blocks
      // (the detailed floors carry the real rooms). B1's chassis pieces give way to the detailed B1 model.
      drop: /^B1_program|^L[0-7]_(program|circle|support|sphere|zone)|^SITE_(door|discharge_barrier|equipment)/,
      replacedBy: [
        [/^(L0_|B1_)|_L-13\.5_/, 'basement'],
        [/^L1_/, 'floor-01'],
        [/^L7_(slab|parapet)/, 'roof'],
        ...[2, 3, 4, 5, 6].map((n) => [new RegExp(`^L${n}_slab`), `floor-0${n}`]),
        [/^L[2-6]_(north_wall|west_wall|east_wall|south_glazing)/, 'facade']
      ] },
    { id: 'floor-01', file: 'equity-uprise-floor-01-core-v2.glb', ffeFt: 0, storey: 1,
      // the shared cores come from the chassis; the glazed perimeter from the facade (or plain glass on the battery
      // tier); the public entrance leaves stand open for the drill
      drop: /IDENTITY-SIGN|^(stair_|passenger_|freight_|mep)|^(north|west|east)_exterior_wall|^south_exterior_(left|right)|^F1-ENTRY-DOOR-(OUTER|INNER)::leaf/ },
    { id: 'roof', file: 'equity-uprise-floor-07-core-v2.glb', ffeFt: 81, storey: 7 },
    // the curtain wall, crown and entry; 2.5 MB, so not on the battery tier. Its signage reconstructs the
    // Equity Uprise mark and lettering from primitives: never drawn here (AGENTS.md, hard rule 11)
    { id: 'facade', file: 'equity-uprise-facade-core-v2.glb', ffeFt: 0, tiers: ['mid', 'high'],
      drop: /^FAC-SIGN-|^FAC-DOOR-LEAF-/ },
    floorPart(2), floorPart(3), floorPart(4), floorPart(5), floorPart(6),
    // B1, the detailed basement (in git; loads the first time the cutaway goes below grade)
    { id: 'basement', file: 'equity-uprise-basement-b1-core-v2.glb', ffeFt: -13.5, storey: 0, lazy: true }
  ]
};
// the opening camera stands back far enough to show the whole tower from the public way
export const OPENING_DIST = 24;
// the opening shot (owner, 2026-11-03: "the tower looks small in the opening view"): low and close from the
// public way, so the tower fills the board and the squad stands in the foreground, tappable
export const OPENING = { x: 5.5, y: 7.6, z: 0, lift: 2.6, dist: 16.5, pitch: 0.36 };
// the objective's label sits just over Floor 1's ceiling (11 ft), so it marks Floor 1 even when the whole tower is drawn
export const OBJ_LABEL_H = 1.2;
// the storey the cutaway shows for a unit on engine floor z (the site and Floor 1 are both storey 1)
export const storeyOf = (z) => (z === 8 ? 0 : Math.max(1, Math.min(7, z || 1)));

export const DISCHARGE_CELLS = [{ x: dischargeOut.x, y: dischargeOut.y, z: 0 }];

export const MISSION = {
  title: 'Equity Uprise HQ',
  objective: 'Report the emergency',
  node: 'INTERFACE',
  nodeLabel: 'Security interface',
  linkWord: 'Report',
  brief: 'Emergency Exercise on Floor 1. T reports at the security interface behind reception (two steps), then the squad assembles at Assembly Area A.',
  roles: {
    E: 'Lead the way in. Open the Stair A discharge door from inside.',
    R: 'Overwatch. The roof (Level 7) is reached by Stair A or B.',
    T: 'Reach the security interface and report twice. Keep T alive.'
  },
  objectiveLine: 'T reports at the security interface, twice.',
  doneLine: 'Emergency reported.',
  logLink: (n) => `T reports at the security interface (${n}/2).`,
  logDone: 'Emergency reported. Assemble at Assembly Area A.',
  sideNode: 'DISCHARGE',
  breachWord: 'Open exit',
  logBreach: 'E opens the Stair A exit discharge from inside.',
  held: 'The exit door stayed shut',
  refused: 'The interface refused the report',
  help: [
    'An emergency exercise on Floor 1 of the Equity Uprise building, laid out from its plans. The squad goes in by the public entrance (the only normal entrance). Technical stands next to reception and <b>Reports</b> twice at the security interface. Entry can <b>Open exit</b> on the Stair A discharge door from inside. Then everyone still standing reaches Assembly Area A and <b>Assembles</b>. If Technical is lost, the exercise fails.',
    'Stairs A and B climb every storey to the Level 7 roof, one storey a flight; Floors 2–6 stay shut. Floor 1 is glazed: it stops movement, not sight. Coordinates: X grows east, Y grows north; the building\'s south-west corner is (0, 0), one tile is 12 ft. Rules are the Prim3 canonical engine; this page only draws them. Progress is saved in this browser.'
  ],
  extractWord: 'Assemble',
  extractPlace: 'Assembly Area A',
  doneTitle: 'Exercise complete',
  failT: 'Technical was lost. The report never went in.'
};

export function engineConfig({ seed = 20261103 } = {}) {
  const blockers = buildBlockers();
  const links = [
    { id: 'public-entrance', from: { ...doorOut, z: 0 }, to: { ...doorIn, z: 1 }, cost: 1 },
    { id: 'stair-a-discharge', from: { ...dischargeOut, z: 0 }, to: { ...dischargeIn, z: 1 }, cost: 1 },
    ...stairLinks('A'), ...stairLinks('B'), ...B1.links
  ];
  const obj = SCENE.objective;
  return {
    width: W, height: H, floors: FLOORS, seed,
    clock: 14,
    extractionRequired: true,
    surfaces: surfaces(),
    links,
    blockers,
    cover: [...buildCover(blockers), ...B1.cover],
    units: [
      { id: 'E1', faction: 'PLAYER', role: 'E', x: 4, y: 11, hp: 8, maxHp: 8, moveRange: 6, aim: 72, weaponDamage: 3, ammo: 4, magazineSize: 4, reserveAmmo: 8, detectionRadius: 5 },
      { id: 'R1', faction: 'PLAYER', role: 'R', x: 3, y: 12, hp: 6, maxHp: 6, moveRange: 6, aim: 80, weaponDamage: 4, ammo: 3, magazineSize: 3, reserveAmmo: 6, detectionRadius: 7 },
      { id: 'T1', faction: 'PLAYER', role: 'T', x: 5, y: 12, hp: 6, maxHp: 6, moveRange: 6, aim: 62, weaponDamage: 2, ammo: 6, magazineSize: 6, reserveAmmo: 12, detectionRadius: 5, canBeDowned: true },
      // exercise role-players: one by the intake room, one in the corridor behind reception, two on the roof.
      // Floor 1 is glazed (see the header), so nobody waits outside the glass: the drill is inside and above
      { id: 'H1', faction: 'THREAT', x: 4, y: 5, z: 1, hp: 5, maxHp: 5, aim: 58, moveRange: 5, detectionRadius: 5 },
      { id: 'H2', faction: 'THREAT', x: 7, y: 4, z: 1, hp: 5, maxHp: 5, aim: 58, moveRange: 5, detectionRadius: 5 },
      { id: 'H3', faction: 'THREAT', x: 5, y: 7, z: 7, hp: 5, maxHp: 5, aim: 62, moveRange: 5, detectionRadius: 8 },
      { id: 'H4', faction: 'THREAT', x: 7, y: 7, z: 7, hp: 5, maxHp: 5, aim: 58, moveRange: 5, detectionRadius: 6, patrol: [{ x: 7, y: 7, z: 7 }, { x: 4, y: 7, z: 7 }] }
    ],
    nodes: [
      { id: 'INTERFACE', state: 'OBSERVED', required: true, at: { x: obj.x, y: obj.y, z: 1, range: 1, roles: ['T'] } },
      { id: 'DISCHARGE', state: 'OBSERVED', required: false, at: { x: dischargeIn.x, y: dischargeIn.y, z: 1, range: 1, roles: ['E'] } }
    ],
    technicalTruth: {
      nodes: {
        INTERFACE: { actions: { OBSERVED: { LINK_1: { next: 'WORK_IN_PROGRESS', apCost: 1 } }, WORK_IN_PROGRESS: { LINK_2: { next: 'VERIFIED', apCost: 1 } } }, effectOnVerified: { reported: true } },
        DISCHARGE: { actions: { OBSERVED: { BREACH: { next: 'VERIFIED', apCost: 1 } } }, effectOnVerified: { dischargeOpen: true, removeBlockers: DISCHARGE_CELLS } }
      }
    },
    objectives: [],
    battlefield: {
      levelId: LEVEL_ID,
      coordinateFrame: FRAME,
      objectiveTiles: [{ id: 'INTERFACE', x: obj.x, y: obj.y, z: 1 }],
      extractionZone: { x: SCENE.extraction.x, y: SCENE.extraction.y, z: 0, r: SCENE.extraction.r }
    }
  };
}
