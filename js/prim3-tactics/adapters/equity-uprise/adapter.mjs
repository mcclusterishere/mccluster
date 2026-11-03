/* PRIM3 × Equity Uprise — the game adapter (layer b). Pure and deterministic; runs in the browser and in Node.

   Layer (a), the building authority (docs/design/equity-uprise-building/), is read once into a frozen
   package by scripts/prim3/build-equity-uprise-package.mjs (equity-uprise-package.json, with the sha256 of
   every source). This module turns that package into the things the PRIM3 resolver plays on:
   tactical cells, a traversal graph (stairs, doors; elevators only where a mission permits them), cover,
   sight surfaces, and interactive machines (security cameras at their real positions, with their real
   coverage). Layer (c), the SANDBOX electronics simulation, is bound through sandbox.mjs.

   It never writes the authority, never invents a room, door, device or camera, and never moves one.

   THE FRAME (feet ↔ grid), documented and reversible:
     authority:  feet, Core V2 local frame: origin = the building's south-west corner, +x east, +y north,
                 Floor 1 finished floor = 0 ft; levels at their finished-floor elevations (B1 −13.5 … L7 81).
     grid:       one cell = 12 ft × 12 ft (3.66 m, 3.3% over the 3.54 m engine tile; the 72 ft plate is exactly
                 6 × 6 cells and the 18 ft structural bays fall every 1.5 cells). Grid +x = east, grid +y = SOUTH.
                 The building's south-west corner is the south-west corner of cell (3, 8); the site
                 (−36…108 × −48…108 ft) is the 12 × 13 cell board.
                 cell (gx, gy) covers x ∈ [12(gx−3), 12(gx−3)+12) ft and y ∈ [12(8−gy), 12(8−gy)+12) ft.
     anchors:    a cell's anchor is its centre: cellToFt(gx, gy) = (12(gx−3)+6, 12(8−gy)+6) ft, and
                 ftToCell(cellToFt(c)) === c for every cell (tested).
     floors:     engine z: 0 = the site at grade, 1–6 = Floors 1–6, 7 = the Level 7 roof, 8 = B1.
                 Heights are the real elevations in metres (engine surfaces).                         */

export const FT = 0.3048;
export const FT_PER_CELL = 12;
export const ORIGIN_CELL = { x: 3, y: 8 }; // the cell whose south-west corner is the building's (0, 0) ft
export const W = 12, H = 13, FLOORS = 9;
export const LEVEL_Z = { 0: 8, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 }; // authority level → engine z
export const Z_LEVEL = { 0: 'site', 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 0 };
export const LEVEL_NAME = { 0: 'B1', 1: 'Floor 1', 2: 'Floor 2', 3: 'Floor 3', 4: 'Floor 4', 5: 'Floor 5', 6: 'Floor 6', 7: 'Level 7 roof' };

/* ---------- the frame ---------- */
export const ftToCell = (xf, yf) => ({ x: ORIGIN_CELL.x + Math.floor(xf / FT_PER_CELL), y: ORIGIN_CELL.y - Math.floor(yf / FT_PER_CELL) });
export const cellToFt = (x, y) => ({ xf: (x - ORIGIN_CELL.x) * FT_PER_CELL + FT_PER_CELL / 2, yf: (ORIGIN_CELL.y - y) * FT_PER_CELL + FT_PER_CELL / 2 });
export const cellBoundsFt = (x, y) => { const c = cellToFt(x, y), h = FT_PER_CELL / 2; return { x1: c.xf - h, y1: c.yf - h, x2: c.xf + h, y2: c.yf + h }; };
export const zOfLevel = (level) => LEVEL_Z[level];
export const levelOfZ = (z) => Z_LEVEL[z];
export const elevationFt = (pkg, level) => pkg.levels.find((l) => l.level === level).elevation_ft;
export const key = (x, y, z = 0) => `${x}:${y}:${z}`;
export const PLATE = { x: ORIGIN_CELL.x, y: ORIGIN_CELL.y - 5, w: 6, d: 6 }; // cells (3..8, 3..8)
export const inPlate = (x, y) => x >= PLATE.x && x < PLATE.x + PLATE.w && y >= PLATE.y && y < PLATE.y + PLATE.d;

// the covering rule (same as levels/equity-uprise-hq.mjs): a rectangle covers a cell when it overlaps at
// least half of it on both axes; a rectangle that covers no cell that way takes the cell under its centre
export function rectCells(r) {
  const xs = [], ys = [];
  for (let gx = 0; gx < W; gx += 1) { const b = cellBoundsFt(gx, 0); if (Math.min(r.x2, b.x2) - Math.max(r.x1, b.x1) >= FT_PER_CELL / 2 - 1e-9) xs.push(gx); }
  for (let gy = 0; gy < H; gy += 1) { const b = cellBoundsFt(0, gy); if (Math.min(r.y2, b.y2) - Math.max(r.y1, b.y1) >= FT_PER_CELL / 2 - 1e-9) ys.push(gy); }
  const c = ftToCell((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2);
  if (!xs.length) xs.push(c.x);
  if (!ys.length) ys.push(c.y);
  const out = []; for (const y of ys) for (const x of xs) out.push({ x, y }); return out;
}
const within = (p, r) => p[0] >= r.x1 && p[0] <= r.x2 && p[1] >= r.y1 && p[1] <= r.y2;

/* ---------- a level's cells ----------
   rules (mission config): { open: [zone ids opened], closed: [zone ids closed] }. Default: a zone of kind
   'room' is closed (its door is a door, not an invitation); open zones, features, terminals and furniture
   are walkable floor. Shared shafts (elevators, MEP riser) are solid; protected stairs are stair cells.
   Shared cores win any cell they share with a room (Core V2). */
export function levelGrid(pkg, level, rules = {}) {
  const L = pkg.levels.find((l) => l.level === level);
  if (!L) throw new Error(`unknown level ${level}`);
  const z = zOfLevel(level);
  const cells = new Map(); // key(x,y) → { zone, kind: 'open'|'closed'|'shaft'|'stair', core? }
  for (let y = PLATE.y; y < PLATE.y + PLATE.d; y += 1) for (let x = PLATE.x; x < PLATE.x + PLATE.w; x += 1) cells.set(`${x}:${y}`, { x, y, zone: null, kind: 'open' });
  const open = new Set(rules.open || []), closed = new Set(rules.closed || []);
  // zones in program order; a room's closure wins over open floor it shares a cell with
  const zoneCells = {};
  for (const zn of L.zones) {
    const cs = rectCells(zn.bounds_ft).filter((c) => inPlate(c.x, c.y));
    zoneCells[zn.id] = cs;
    const isClosed = closed.has(zn.id) || (zn.kind === 'room' && !open.has(zn.id));
    for (const c of cs) {
      const cur = cells.get(`${c.x}:${c.y}`);
      if (isClosed) Object.assign(cur, { zone: zn.id, kind: 'closed' });
      else if (cur.kind !== 'closed') Object.assign(cur, { zone: cur.zone || zn.id, kind: 'open' });
    }
  }
  const cores = {};
  for (const c of pkg.cores) {
    if (!c.serves_levels.includes(level)) continue;
    const cs = rectCells(c.bounds_ft); cores[c.id] = cs;
    for (const cc of cs) Object.assign(cells.get(`${cc.x}:${cc.y}`), { zone: c.id, kind: c.type === 'protected_stair' ? 'stair' : 'shaft', core: c.type });
  }
  return { level, z, elevation_ft: L.elevation_ft, cells, zoneCells, cores, zones: L.zones, doors: L.doors || [], equipment: L.equipment || [] };
}

/* ---------- traversal: surfaces, blockers, links and cover for a set of levels ----------
   spec: { levels: [0, 1, …], rules: { [level]: { open, closed } }, site: true|false,
           openings: { [site opening id]: true } (exterior doors open), elevators: false }           */
export function traversal(pkg, spec) {
  const levels = [...spec.levels].sort((a, b) => a - b);
  const grids = Object.fromEntries(levels.map((l) => [l, levelGrid(pkg, l, (spec.rules || {})[l])]));
  const surfaces = [], blockers = [], links = [];
  const put = (x, y, z, h) => blockers.push(h == null ? { x, y, z } : { x, y, z, h });
  for (const l of levels) {
    const g = grids[l];
    surfaces.push({ id: `level-${l}`, z: g.z, x: PLATE.x, y: PLATE.y, w: PLATE.w, d: PLATE.d, height: g.elevation_ft * FT });
    for (const c of g.cells.values()) if (c.kind === 'closed' || c.kind === 'shaft') put(c.x, c.y, g.z);
  }
  // the site at grade: walkable outside the plate; the building is solid at grade (Floor 1 is its own floor)
  if (spec.site) { for (let y = PLATE.y; y < PLATE.y + PLATE.d; y += 1) for (let x = PLATE.x; x < PLATE.x + PLATE.w; x += 1) put(x, y, 0); }
  else for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) put(x, y, 0);
  // protected stairs: one storey per link, switching back between the enclosure's two cells
  for (const c of pkg.cores.filter((k) => k.type === 'protected_stair')) {
    const cells = rectCells(c.bounds_ft).sort((a, b) => b.y - a.y); // [south, north]
    for (let i = 0; i < levels.length - 1; i += 1) {
      const lo = levels[i], hi = levels[i + 1];
      if (hi !== lo + 1 || !c.serves_levels.includes(lo) || !c.serves_levels.includes(hi)) continue;
      const a = cells[((lo - 1) % 2 + 2) % 2], b = cells[lo % 2];
      links.push({ id: `${c.id}-${lo}-${hi}`, from: { x: a.x, y: a.y, z: zOfLevel(lo) }, to: { x: b.x, y: b.y, z: zOfLevel(hi) }, cost: 3, kind: 'stair' });
    }
  }
  // elevators: only where the mission permits them (a cab is not a free teleporter)
  if (spec.elevators) for (const c of pkg.cores.filter((k) => /elevator/.test(k.type))) {
    const cell = rectCells(c.bounds_ft)[0];
    const served = levels.filter((l) => c.serves_levels.includes(l));
    for (let i = 0; i < served.length - 1; i += 1) links.push({ id: `${c.id}-${served[i]}-${served[i + 1]}`, from: { ...cell, z: zOfLevel(served[i]) }, to: { ...cell, z: zOfLevel(served[i + 1]) }, cost: 2, kind: 'elevator' });
  }
  // exterior doors (site ↔ Floor 1), from the site-egress openings
  if (spec.site && levels.includes(1)) for (const o of pkg.site.openings) {
    if (!(spec.openings || {})[o.id] || o.y != null && o.facade === 'south' && o.y > 0) continue; // the inner vestibule door is not an exterior door
    const mid = o.facade === 'south' || o.facade === 'north' ? [(o.x1 + o.x2) / 2, o.facade === 'south' ? 0 : 72] : [o.facade === 'east' ? 72 : 0, (o.y1 + o.y2) / 2];
    const inside = ftToCell(mid[0] - (o.facade === 'east' ? 1 : 0), mid[1] - (o.facade === 'north' ? 1 : 0));
    const out = { south: { x: inside.x, y: inside.y + 1 }, north: { x: inside.x, y: inside.y - 1 }, east: { x: inside.x + 1, y: inside.y }, west: { x: inside.x - 1, y: inside.y } }[o.facade];
    links.push({ id: o.id, from: { ...out, z: 0 }, to: { ...inside, z: 1 }, cost: 1, kind: 'door' });
  }
  return { grids, surfaces, blockers, links, cover: buildCover(grids, blockers, spec) };
}

// cover: a walkable cell next to a closed room, a shaft or the below-grade perimeter has HIGH cover on that side;
// equipment (desks, tables, benches, racks) gives LOW cover (HIGH when over 5.5 ft) in the cells it stands in,
// on the side(s) of the cell it occupies
export function buildCover(grids, blockers, spec = {}) {
  const solid = new Set(blockers.filter((b) => b.h == null).map((b) => key(b.x, b.y, b.z)));
  const SIDES = [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]];
  const out = new Map();
  const add = (x, y, z, side, type) => { const k = key(x, y, z); const c = out.get(k) || { x, y, z, type: 'LOW', sides: [] }; if (!c.sides.includes(side)) c.sides.push(side); if (type === 'HIGH') c.type = 'HIGH'; out.set(k, c); };
  for (const g of Object.values(grids)) {
    for (const c of g.cells.values()) {
      if (c.kind === 'closed' || c.kind === 'shaft') continue;
      if (solid.has(key(c.x, c.y, g.z))) continue;
      for (const [s, dx, dy] of SIDES) {
        const nx = c.x + dx, ny = c.y + dy;
        if (!inPlate(nx, ny)) { if (g.level === 0) add(c.x, c.y, g.z, s, 'HIGH'); else if (g.level === 7) add(c.x, c.y, g.z, s, 'LOW'); continue; } // B1's perimeter wall; the roof parapet
        if (solid.has(key(nx, ny, g.z))) add(c.x, c.y, g.z, s, 'HIGH');
      }
    }
    for (const e of g.equipment) {
      const ctr = [(e.bounds_ft.x1 + e.bounds_ft.x2) / 2, (e.bounds_ft.y1 + e.bounds_ft.y2) / 2];
      const tall = (e.top_ft || 0) >= 5.5 ? 'HIGH' : 'LOW';
      for (let y = PLATE.y; y < PLATE.y + PLATE.d; y += 1) for (let x = PLATE.x; x < PLATE.x + PLATE.w; x += 1) {
        const b = cellBoundsFt(x, y);
        if (Math.min(e.bounds_ft.x2, b.x2) <= Math.max(e.bounds_ft.x1, b.x1) || Math.min(e.bounds_ft.y2, b.y2) <= Math.max(e.bounds_ft.y1, b.y1)) continue;
        if (solid.has(key(x, y, g.z)) || g.cells.get(`${x}:${y}`).kind !== 'open') continue;
        const a = cellToFt(x, y), dx = ctr[0] - a.xf, dy = ctr[1] - a.yf;
        if (Math.abs(dx) >= Math.abs(dy)) add(x, y, g.z, dx >= 0 ? 'E' : 'W', tall); else add(x, y, g.z, dy >= 0 ? 'N' : 'S', tall);
      }
    }
  }
  return [...out.values()];
}

/* ---------- placing a device: the frame, then the room it is in ----------
   A device takes the cell of the zone (room) whose authority bounds contain it, the covered cell nearest to it;
   a device in no zone takes the cell containing it. Every placement goes through ftToCell/cellToFt. */
export function deviceCell(grid, position_ft) {
  const p = position_ft;
  const zone = grid.zones.find((z) => within(p, z.bounds_ft) && (grid.zoneCells[z.id] || []).length);
  if (zone) {
    let best = null, bd = Infinity;
    for (const c of grid.zoneCells[zone.id]) { const a = cellToFt(c.x, c.y), d = Math.hypot(a.xf - p[0], a.yf - p[1]); if (d < bd - 1e-9) { bd = d; best = c; } }
    return { ...best, zone: zone.id };
  }
  return { ...ftToCell(p[0], p[1]), zone: null };
}

/* ---------- security cameras: the authority's own position, aim and optics ----------
   coverage (the authority's optics, on the grid): a cell is covered when its anchor is within the training range
   and inside the horizontal field of view around the aim vector. Walls between rooms are not edge-modeled
   (whole-cell engine), so this is the camera's reach over the cell plan, not through-wall truth.
   The engine CAMERA machine spots with detectionRadius = floor(range / 12 ft) and its own line of sight. */
export function camerasOn(pkg, grid) {
  const lvl = LEVEL_NAME[grid.level] === 'B1' ? 'B1' : grid.level === 7 ? 'L7' : `F${grid.level}`;
  return pkg.cameras.filter((c) => c.level_id === lvl).map((c) => {
    const cell = deviceCell(grid, c.position_ft);
    const range = c.optics.training_range_ft, half = c.optics.horizontal_fov_deg / 2 * Math.PI / 180;
    const aim = Math.atan2(c.aim_vector[1], c.aim_vector[0]);
    const coverage = [];
    for (const g of grid.cells.values()) {
      const a = cellToFt(g.x, g.y), dx = a.xf - c.position_ft[0], dy = a.yf - c.position_ft[1], d = Math.hypot(dx, dy);
      if (d > range) continue;
      let off = Math.abs(Math.atan2(dy, dx) - aim); if (off > Math.PI) off = 2 * Math.PI - off;
      if (d < 1e-9 || off <= half + 1e-9) coverage.push({ x: g.x, y: g.y, walkable: g.kind === 'open' || g.kind === 'stair' });
    }
    return { ...c, cell: { x: cell.x, y: cell.y, z: grid.z }, cellZone: cell.zone, detectionRadius: Math.floor(range / FT_PER_CELL), coverage };
  });
}

// camera selection by traversable-lane coverage: the cameras whose coverage meets the lane, and a smallest set
// (greedy, ties by asset id) whose union covers every lane cell any camera can see
export function selectCamerasForLane(cams, lane) {
  const L = new Set(lane.map((c) => `${c.x}:${c.y}`));
  const sees = cams.map((c) => ({ id: c.asset_id, cells: new Set(c.coverage.filter((v) => L.has(`${v.x}:${v.y}`)).map((v) => `${v.x}:${v.y}`)) })).filter((s) => s.cells.size);
  const coverable = new Set(sees.flatMap((s) => [...s.cells]));
  const chosen = [], left = new Set(coverable);
  while (left.size) {
    const best = sees.filter((s) => !chosen.includes(s.id)).map((s) => ({ id: s.id, n: [...s.cells].filter((k) => left.has(k)).length })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))[0];
    if (!best || !best.n) break;
    chosen.push(best.id); for (const k of sees.find((s) => s.id === best.id).cells) left.delete(k);
  }
  return { seeing: sees.map((s) => s.id).sort(), minimal: chosen, coverable: [...coverable].sort(), uncovered: lane.filter((c) => !coverable.has(`${c.x}:${c.y}`)) };
}

// equipment and device anchors (the rack, the console, the readers) on the grid, via the frame
export function deviceAnchor(pkg, grid, assetId) {
  const d = pkg.b1_devices.find((x) => x.asset_id === assetId);
  if (!d) throw new Error(`unknown device ${assetId}`);
  return { ...deviceCell(grid, d.position_ft), z: grid.z, asset_id: assetId, position_ft: d.position_ft };
}
export function equipmentAnchor(grid, id) {
  const e = grid.equipment.find((x) => x.id === id);
  if (!e) throw new Error(`unknown equipment ${id}`);
  const c = [(e.bounds_ft.x1 + e.bounds_ft.x2) / 2, (e.bounds_ft.y1 + e.bounds_ft.y2) / 2];
  return { ...deviceCell(grid, c), z: grid.z, id };
}
export function doorAnchor(grid, id) {
  const d = grid.doors.find((x) => x.id === id);
  if (!d) throw new Error(`unknown door ${id}`);
  // the cell just inside the doorway (half a foot into the zone the door belongs to)
  const inward = { south: [0, 0.5], north: [0, -0.5], east: [-0.5, 0], west: [0.5, 0] }[d.side];
  const c = ftToCell(d.x + inward[0], d.y + inward[1]);
  return { ...c, z: grid.z, id, side: d.side };
}
