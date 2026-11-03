/* PRIM3 · Transit / Relay — level data (review branch; not public canon).

   One source for two consumers:
     engineConfig()  → createState() input for the canonical Prim3 resolver (rules authority)
     SCENE           → what the 3D renderer and the sector map draw (never rules)

   Grid: 64 × 64 tiles, engine x grows west→east, y grows north→south (the engine's convention).
   Players read signed coordinates through battlefield.coordinateFrame: X = x − 32, Y = 31 − y, so
   north is +Y, the relay sits near (0, 0) and the map spans −32…31 on both axes.
   Units: one tile = TILE_M = 3.54 m (scale.mjs; owner, 2026-11-03: the grid doubled from 1.6 m).
   Heights (blocker h, surface height) are metres, as the resolver expects. Props keep real sizes,
   so their footprints are what they cover on this grid: a 40 ft container (12.2 × 2.4 m) is 4 × 1
   tiles, a crate stack, an AC unit and a jersey-barrier segment are one tile each. Buildings kept
   their tile footprints: at 3.54 m they are 28–50 m warehouses and blocks, real yard sizes.

   An original layout: a canal compound at night. The squad starts south of the canal; the relay is
   in the central yard; Warehouse B-1 has an external stair to its roof and a skybridge to A-1;
   depot A-2 has a stair on its south face. Entry can breach the service gate in the fence line;
   Technical must connect to the relay twice; then everyone extracts at the south-west pad. */

export const LEVEL_ID = 'transit-relay';
export const W = 64, H = 64, FLOORS = 2;
export { TILE_M } from '../scale.mjs';
export const FRAME = { x0: 32, y0: 31, yUp: true };
export const toDisplay = (x, y) => ({ X: x - FRAME.x0, Y: FRAME.y0 - y });

/* ---------- authored scene (engine tile units; heights in metres) ---------- */
export const SCENE = {
  canal: { x: 0, y: 44, w: 64, d: 4 },
  bridges: [
    { id: 'west-bridge', x: 10, y: 43, w: 3, d: 6, kind: 'road' },
    { id: 'footbridge', x: 30, y: 43, w: 1, d: 6, kind: 'grate' },
    { id: 'east-bridge', x: 50, y: 43, w: 3, d: 6, kind: 'road' }
  ],
  buildings: [
    { id: 'A-1', label: 'A-1', x: 2, y: 4, w: 12, d: 11, h: 9, roof: true, wall: 'concrete' },
    { id: 'A-2', label: 'A-2', x: 2, y: 22, w: 11, d: 14, h: 8, roof: true, wall: 'concrete', door: { side: 'E', at: 29 } },
    { id: 'B-1', label: 'B-1', x: 22, y: 6, w: 15, d: 13, h: 9, roof: true, wall: 'corrugated', door: { side: 'S', at: 29 } },
    { id: 'C-3', label: 'C-3', x: 46, y: 3, w: 14, d: 14, h: 13, roof: true, wall: 'concrete' },
    { id: 'D-4', label: 'D-4', x: 54, y: 51, w: 9, d: 10, h: 6, roof: true, wall: 'corrugated' }
  ],
  skybridge: { id: 'skybridge', x: 14, y: 10, w: 8, d: 1, h: 9 },
  // stairs: ground foot (z0) ↔ roof landing (z1); cost = movement steps, the climb included
  stairs: [
    { id: 'b1-stair', from: { x: 38, y: 18, z: 0 }, to: { x: 36, y: 15, z: 1 }, cost: 6, side: 'E' },
    { id: 'a2-stair', from: { x: 7, y: 38, z: 0 }, to: { x: 7, y: 35, z: 1 }, cost: 6, side: 'S' },
    // every building is climbable (owner, 2026-11-02): a tall ladder up C-3, a stair up D-4
    { id: 'c3-ladder', from: { x: 44, y: 12, z: 0 }, to: { x: 46, y: 12, z: 1 }, cost: 7, side: 'W', kind: 'ladder' },
    { id: 'd4-stair', from: { x: 52, y: 57, z: 0 }, to: { x: 54, y: 57, z: 1 }, cost: 5, side: 'W' }
  ],
  containers: [ // 40 ft boxes (12.2 × 2.4 × 2.6 m) on 4 × 1 tiles; c-stack is two high
    { id: 'c-west', x: 16, y: 37, w: 4, d: 1, h: 2.6, color: 0x8e4a33 },
    { id: 'c-yard', x: 41, y: 23, w: 4, d: 1, h: 2.6, color: 0x4f6166 },
    { id: 'c-mid', x: 24, y: 24, w: 1, d: 4, h: 2.6, color: 0x8e4a33 },
    { id: 'c-east', x: 50, y: 34, w: 4, d: 1, h: 2.6, color: 0x7a3b2b },
    { id: 'c-south', x: 3, y: 51, w: 4, d: 1, h: 2.6, color: 0x5b6b4a },
    { id: 'c-stack', x: 56, y: 22, w: 4, d: 1, h: 5.2, color: 0x8e4a33 }
  ],
  barricades: [ // jersey barriers: low cover (1.1 m)
    { x: 28, y: 36, w: 3, d: 1 }, { x: 34, y: 34, w: 2, d: 1 }, { x: 20, y: 30, w: 1, d: 2 },
    { x: 40, y: 30, w: 1, d: 3 }, { x: 27, y: 22, w: 2, d: 1 }, { x: 35, y: 26, w: 2, d: 1 },
    { x: 14, y: 42, w: 3, d: 1 }, { x: 44, y: 49, w: 2, d: 1 }, { x: 36, y: 52, w: 1, d: 2 }
  ],
  crates: [ // stacked crates: high cover (1.8 m), one stack per tile
    { x: 18, y: 26, w: 2, d: 1 }, { x: 44, y: 30, w: 1, d: 1 }, { x: 33, y: 40, w: 1, d: 1 },
    { x: 9, y: 18, w: 1, d: 1 }, { x: 47, y: 55, w: 1, d: 1 }, { x: 22, y: 52, w: 1, d: 1 }
  ],
  tent: { id: 'med-tent', x: 41, y: 38, w: 2, d: 2, h: 2.6 }, // a 7 × 7 m field tent
  fence: { y: 40, x0: 22, x1: 40, h: 2.2, gate: [30, 31, 32] },
  relay: { id: 'RELAY', x: 31, y: 30, h: 1.5 },
  extraction: { x: 8, y: 57, r: 3 },
  lamps: [ { x: 21, y: 20 }, { x: 39, y: 21 }, { x: 15, y: 39 }, { x: 45, y: 39 }, { x: 26, y: 49 }, { x: 47, y: 51 }, { x: 12, y: 54 } ],
  trees: [ { x: 18, y: 2 }, { x: 42, y: 1 }, { x: 62, y: 30 }, { x: 1, y: 40 }, { x: 25, y: 61 }, { x: 40, y: 61 } ],
  rooftop: [ // AC units and vents on roofs (scenery on blocked roof tiles; one 3.5 m unit per tile)
    { x: 25, y: 8, w: 1, d: 1, h: 1.6, z: 1 }, { x: 28, y: 8, w: 1, d: 1, h: 1.6, z: 1 }, { x: 5, y: 6, w: 1, d: 1, h: 1.2, z: 1 }, { x: 9, y: 31, w: 1, d: 1, h: 1.4, z: 1 }
  ]
};

/* ---------- rules data derived from the scene ---------- */
const key = (x, y, z = 0) => `${x}:${y}:${z}`;
function rectCells(r, fn) { for (let y = r.y; y < r.y + r.d; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) fn(x, y); }

export function buildBlockers({ gateOpen = false } = {}) {
  const out = new Map();
  const put = (x, y, z, h) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = key(x, y, z); const prev = out.get(k); if (!prev || prev.h < h) out.set(k, { x, y, z, h }); };
  for (const b of SCENE.buildings) rectCells(b, (x, y) => put(x, y, 0, b.h));
  // canal: water you cannot walk, but can see across (h 0); bridges cut through it
  const onBridge = (x, y) => SCENE.bridges.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d);
  rectCells(SCENE.canal, (x, y) => { if (!onBridge(x, y)) put(x, y, 0, 0); });
  for (const c of SCENE.containers) rectCells(c, (x, y) => put(x, y, 0, c.h));
  for (const b of SCENE.barricades) rectCells(b, (x, y) => put(x, y, 0, 1.1));
  for (const c of SCENE.crates) rectCells(c, (x, y) => put(x, y, 0, 1.8));
  rectCells(SCENE.tent, (x, y) => put(x, y, 0, SCENE.tent.h));
  for (let x = SCENE.fence.x0; x <= SCENE.fence.x1; x += 1) {
    if (gateOpen && SCENE.fence.gate.includes(x)) continue;
    put(x, SCENE.fence.y, 0, SCENE.fence.h);
  }
  put(SCENE.relay.x, SCENE.relay.y, 0, SCENE.relay.h);
  // skybridge pillars (the deck itself is a roof surface; the ground under it stays walkable)
  const sb = SCENE.skybridge; put(sb.x + 2, sb.y + sb.d, 0, 9); put(sb.x + sb.w - 3, sb.y + sb.d, 0, 9);
  for (const r of SCENE.rooftop) rectCells(r, (x, y) => put(x, y, 1, r.h));
  // stair footprints on the ground (except the foot tile itself) so nobody walks through the flight
  for (const s of SCENE.stairs) {
    const dx = Math.sign(s.to.x - s.from.x), dy = Math.sign(s.to.y - s.from.y);
    for (let x = s.from.x + dx, y = s.from.y + dy, i = 0; i < 8 && !(x === s.to.x && y === s.to.y); i += 1) {
      const inBuilding = SCENE.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d);
      if (!inBuilding) put(x, y, 0, 3);
      if (x !== s.to.x) x += dx; else if (y !== s.to.y) y += dy;
    }
  }
  return [...out.values()];
}

export function surfaces() {
  const out = SCENE.buildings.filter((b) => b.roof).map((b) => ({ z: 1, x: b.x, y: b.y, w: b.w, d: b.d, height: b.h }));
  const sb = SCENE.skybridge; out.push({ z: 1, x: sb.x, y: sb.y, w: sb.w, d: sb.d, height: sb.h });
  return out;
}

// Cover is derived, never hand-placed: a walkable tile next to a blocker at least 1 m tall gets
// cover on that side (HIGH if the tallest such neighbour is ≥ 1.8 m, else LOW). Roof edges get LOW
// cover facing outward (the parapet).
export function buildCover(blockers) {
  const bmap = new Map(blockers.map((b) => [key(b.x, b.y, b.z), b]));
  const surf = surfaces();
  const walkable = (x, y, z) => {
    if (x < 0 || y < 0 || x >= W || y >= H || bmap.has(key(x, y, z))) return false;
    return z === 0 || surf.some((s) => s.z === z && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.d);
  };
  const out = [];
  const SIDES = [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]];
  for (let z = 0; z < FLOORS; z += 1) for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (!walkable(x, y, z)) continue;
    let tall = 0; const sides = [];
    for (const [s, dx, dy] of SIDES) {
      const n = bmap.get(key(x + dx, y + dy, z));
      if (n && n.h >= 1) { sides.push(s); tall = Math.max(tall, n.h); }
      else if (z > 0 && !walkable(x + dx, y + dy, z) && !n) { sides.push(s); tall = Math.max(tall, 1.1); } // parapet
    }
    if (sides.length) out.push({ x, y, z, type: tall >= 1.8 ? 'HIGH' : 'LOW', sides });
  }
  return out;
}

export const GATE_CELLS = SCENE.fence.gate.map((x) => ({ x, y: SCENE.fence.y, z: 0 }));

export const MISSION = {
  title: 'Transit / Relay',
  objective: 'Secure the relay',
  brief: 'T must connect to the relay twice, then the whole squad extracts at the south-west pad.',
  linkActions: ['LINK_1', 'LINK_2']
};

export function engineConfig({ seed = 20261102 } = {}) {
  const blockers = buildBlockers();
  return {
    width: W, height: H, floors: FLOORS, seed,
    clock: 14,
    extractionRequired: true,
    surfaces: surfaces(),
    links: SCENE.stairs.map((s) => ({ id: s.id, from: s.from, to: s.to, cost: s.cost })),
    blockers,
    cover: buildCover(blockers),
    units: [
      { id: 'E1', faction: 'PLAYER', role: 'E', x: 44, y: 52, hp: 8, maxHp: 8, moveRange: 7, aim: 72, weaponDamage: 3, ammo: 4, magazineSize: 4, reserveAmmo: 8, detectionRadius: 9 },
      { id: 'R1', faction: 'PLAYER', role: 'R', x: 46, y: 57, hp: 6, maxHp: 6, moveRange: 8, aim: 80, weaponDamage: 4, ammo: 3, magazineSize: 3, reserveAmmo: 6, detectionRadius: 12 },
      { id: 'T1', faction: 'PLAYER', role: 'T', x: 49, y: 53, hp: 6, maxHp: 6, moveRange: 7, aim: 62, weaponDamage: 2, ammo: 6, magazineSize: 6, reserveAmmo: 12, detectionRadius: 8, canBeDowned: true },
      { id: 'H1', faction: 'THREAT', x: 38, y: 27, hp: 5, maxHp: 5, aim: 62, moveRange: 6, detectionRadius: 10, patrol: [{ x: 38, y: 27 }, { x: 38, y: 33 }] },
      { id: 'H2', faction: 'THREAT', x: 23, y: 33, hp: 5, maxHp: 5, aim: 62, moveRange: 6, detectionRadius: 10 },
      { id: 'H3', faction: 'THREAT', x: 12, y: 39, hp: 5, maxHp: 5, aim: 60, moveRange: 6, detectionRadius: 10, patrol: [{ x: 12, y: 39 }, { x: 18, y: 41 }] },
      { id: 'H4', faction: 'THREAT', x: 30, y: 11, z: 1, hp: 5, maxHp: 5, aim: 66, moveRange: 6, detectionRadius: 13 },
      { id: 'H5', faction: 'THREAT', x: 8, y: 28, z: 1, hp: 5, maxHp: 5, aim: 64, moveRange: 6, detectionRadius: 12 },
      { id: 'H6', faction: 'THREAT', x: 17, y: 10, z: 1, hp: 5, maxHp: 5, aim: 64, moveRange: 6, detectionRadius: 12 }
    ],
    nodes: [
      { id: 'RELAY', state: 'OBSERVED', required: true, at: { x: SCENE.relay.x, y: SCENE.relay.y, z: 0, range: 1, roles: ['T'] } },
      { id: 'GATE', state: 'OBSERVED', required: false, at: { x: 31, y: SCENE.fence.y + 1, z: 0, range: 1, roles: ['E'] } }
    ],
    technicalTruth: {
      nodes: {
        RELAY: { actions: { OBSERVED: { LINK_1: { next: 'WORK_IN_PROGRESS', apCost: 1 } }, WORK_IN_PROGRESS: { LINK_2: { next: 'VERIFIED', apCost: 1 } } }, effectOnVerified: { relayLinked: true } },
        GATE: { actions: { OBSERVED: { BREACH: { next: 'VERIFIED', apCost: 1 } } }, effectOnVerified: { gateOpen: true, removeBlockers: GATE_CELLS } }
      }
    },
    objectives: [],
    battlefield: {
      levelId: LEVEL_ID,
      coordinateFrame: FRAME,
      objectiveTiles: [{ id: 'RELAY', x: SCENE.relay.x, y: SCENE.relay.y }],
      extractionZone: { x: SCENE.extraction.x, y: SCENE.extraction.y, z: 0, r: SCENE.extraction.r }
    }
  };
}
