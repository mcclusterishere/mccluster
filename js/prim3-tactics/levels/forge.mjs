/* PRIM3 tactics — a Level Forge document as a playable level (prim3-transit.html?level=forge).

   The Forge (prim3-level-builder/) authors on a 1 m grid in signed cells, with the White Industrial kit
   (assets/3d/prim3-kit/white-industrial/, one game unit = one metre). The game plays on TILE_M tiles
   (3.54 m, scale.mjs). This module is the ONE translation between them: it turns a Forge document into
   the same level-module shape every level in levels/ exports (LEVEL_ID, W, H, FLOORS, FRAME, toDisplay,
   SCENE, MISSION, surfaces(), engineConfig()), so the page, the renderer and the canonical resolver
   treat it like Transit / Relay. There is no second engine and no second rule set:

     - rules come from js/prim3-tactics/tactical-resolver.mjs (vendored, SOURCE.json);
     - the squad's and the hostiles' numbers are Transit / Relay's own (its engineConfig());
     - playability is checked with the resolver's own computeReach, never a local path finder.

   Mapping (exportForgeLevel):
     cells → tiles   a rectangle covers the tiles it overlaps by at least half a tile (a smaller thing
                     takes the tile its centre is in); a point (spawn, link end) takes the tile it is in.
     axes            the Forge's sector map has +Y north (N ↑); the engine's y grows north → south. So
                     engine y runs against Forge y, and FRAME { yUp: true } gives the player back the
                     Forge's own signs: the relay at Forge (0, 0) reads (0, 0), north is +Y.
     heights         metres, as the resolver expects (surface heights, blocker h).
     warehouse/tower roofs and catwalks/raised bridges are floor-1 surfaces; stairs and ladders become
     links (cost in movement tiles, never less than the tiles walked plus the climb); water blocks
     walking, a ground bridge clears it; containers, crates, barriers and other solid props are blockers
     whose height decides cover exactly as Transit's buildCover does; trees are scenery, as in Transit.
   Everything is also handed to the renderer as SCENE.props at its exact Forge position and size, so the
   kit meshes stand where they were placed while the rules use the tile snap. */
import { TILE_M } from '../scale.mjs';
import { createState, computeReach } from '../tactical-resolver.mjs';
import { engineConfig as transitConfig } from './transit-relay.mjs';

export const FORGE_LEVEL_ID = 'forge';
export const PLAYTEST_KEY = 'prim3.forge.playtest.v1';
export const FORGE_URL = 'prim3-level-builder/index.html';

/* Rules facts per kit asset (footprint and heights in metres: assets/3d/prim3-kit/white-industrial/catalog.json;
   scripts/test/prim3-forge-level.test.mjs holds this table to the catalog). kind decides what the rules make of it. */
const KIT = {
  'concrete-tile-8': { w: 8, d: 8, h: 0.19, kind: 'ground' },
  'soil-tile-8': { w: 8, d: 8, h: 0.23, kind: 'ground' },
  'grass-tile-8': { w: 8, d: 8, h: 0.305, kind: 'ground' },
  'water-tile-16': { w: 16, d: 8, h: 0.128, kind: 'water' },
  'warehouse-16': { w: 16, d: 12, h: 9, surface: 8, kind: 'building', wall: 'corrugated', tag: 'W' },
  'tower-8': { w: 8, d: 8, h: 12.6, surface: 12, kind: 'building', wall: 'concrete', tag: 'T' },
  'wall-8': { w: 8, d: 1, h: 3.14, kind: 'solid' },
  'low-barrier-4': { w: 4, d: 1, h: 1.16, kind: 'barricade' },
  'high-cover-4': { w: 4, d: 2, h: 2.7, kind: 'solid' },
  'container-12': { w: 12, d: 4, h: 4, kind: 'container' },
  'crate-2': { w: 2, d: 2, h: 2.06, kind: 'crate' },
  'bridge-16': { w: 16, d: 6, h: 1.45231, surface: 0.3, kind: 'bridge' },
  'stairs-8': { w: 4, d: 8, h: 9.09035, surface: 8, kind: 'stairs' },
  'catwalk-8': { w: 8, d: 4, h: 5.15231, surface: 4, kind: 'deck' },
  'ladder-8': { w: 1, d: 0.5, h: 8, surface: 8, kind: 'ladder' },
  'pipe-stack-6': { w: 3, d: 6, h: 1.63, kind: 'solid' },
  'hvac-3': { w: 3, d: 2.5, h: 1.7625, kind: 'solid' },
  'relay-terminal': { w: 2, d: 2, h: 3.4, kind: 'solid' },
  'gate-8': { w: 8, d: 1, h: 4, kind: 'solid' },
  'fence-8': { w: 8, d: 0.5, h: 2.6, kind: 'solid' },
  'tree-8': { w: 1, d: 1, h: 8.00502, kind: 'tree' },
  'rock-cluster': { w: 4, d: 2.5, h: 1.7, kind: 'solid' },
  'spawn-marker': { w: 3, d: 3, h: 0.2, kind: 'marker' },
  'extraction-marker': { w: 5, d: 5, h: 0.20031, kind: 'marker' }
};
export const FORGE_KIT_RULES = KIT;

// The canonical Transit / Relay squad and hostiles: the only numbers a Forge level plays with.
const TRANSIT = transitConfig();
const SQUAD = Object.fromEntries(TRANSIT.units.filter((u) => u.faction === 'PLAYER').map((u) => [u.role, u]));
const strip = ({ x, y, z, patrol, id, ...rest }) => rest; // eslint-disable-line no-unused-vars
const HOSTILE = { guard: strip(TRANSIT.units.find((u) => u.id === 'H1')), sentry: strip(TRANSIT.units.find((u) => u.id === 'H4')) };
const RELAY_TRUTH = TRANSIT.technicalTruth.nodes.RELAY;
const STAIR_CLIMB_M = 4.5, LADDER_CLIMB_M = 2.5; // metres climbed per movement tile on a stair / a ladder

const key = (x, y, z = 0) => `${x}:${y}:${z}`;
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v) => Number.isInteger(v);

/* metres along one axis (from the map's low edge) → the tiles a span covers */
function span(a0, a1) {
  const s = Math.round(a0 / TILE_M), e = Math.round(a1 / TILE_M);
  if (e > s) return [s, e - 1];
  const c = Math.floor((a0 + a1) / 2 / TILE_M); return [c, c];
}

// the cell rectangle an object covers (the Forge's own footprint rule: ceil(footprint × scale), quarter turns)
function cellRect(o) {
  const a = KIT[o.assetId], s = o.scale ?? 1;
  let w = Math.max(1, Math.ceil(a.w * s - 1e-5)), d = Math.max(1, Math.ceil(a.d * s - 1e-5));
  if ((o.rotation || 0) % 180) [w, d] = [d, w];
  return { x: o.x, y: o.y, w, d };
}

/** A Forge document → a level module (the levels/*.mjs shape), plus the problems found on the way. */
export function exportForgeLevel(doc) {
  const errors = [], warnings = [];
  if (!isRecord(doc) || !isRecord(doc.bounds) || !Array.isArray(doc.objects) || !Array.isArray(doc.spawns)) {
    return { level: null, errors: ['This is not a Level Forge document.'], warnings };
  }
  const b = doc.bounds, minX = b.minX, topY = b.maxY + 1; // engine y is measured south from the Forge's north edge
  if (![b.minX, b.maxX, b.minY, b.maxY].every(int) || b.minX > 0 || b.minY > 0 || b.maxX < 0 || b.maxY < 0) {
    return { level: null, errors: ['Map bounds must be whole cells around the origin.'], warnings };
  }
  // whole tiles only: a sliver of a tile past the map's edge is not a lane around everything (128 m → 36 tiles)
  const W = Math.round((b.maxX - minX + 1) / TILE_M), H = Math.round((topY - b.minY) / TILE_M), FLOORS = 2;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  // a cell (cx, cy) is the square [cx, cx + 1) × [cy, cy + 1); its tile is the one its centre falls in
  const tileOf = (cx, cy) => ({ x: Math.min(W - 1, Math.max(0, Math.floor((cx - minX + 0.5) / TILE_M))), y: Math.min(H - 1, Math.max(0, Math.floor((topY - cy - 0.5) / TILE_M))) });
  const tileRect = (r) => {
    const [x0, x1] = span(r.x - minX, r.x + r.w - minX), [y0, y1] = span(topY - (r.y + r.d), topY - r.y);
    const x = Math.max(0, x0), y = Math.max(0, y0);
    return { x, y, w: Math.min(W - 1, x1) - x + 1, d: Math.min(H - 1, y1) - y + 1 };
  };
  const cells = (r, fn) => { for (let y = r.y; y < r.y + r.d; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) fn(x, y); };
  // metres → renderer world units (tile centres at integers; world z is engine y)
  const worldX = (m) => (m - minX) / TILE_M - 0.5, worldZ = (m) => (topY - m) / TILE_M - 0.5;

  const origin = tileOf(0, 0), FRAME = { x0: origin.x, y0: origin.y, yUp: true };
  const SCENE = { kind: 'forge', buildings: [], decks: [], stairs: [], containers: [], barricades: [], crates: [], trees: [], props: [], lamps: [] };
  const surfaces = [], blockers = new Map(), waterCells = new Set(), bridgeCells = new Set(), stairObjects = [], raised = [];
  const block = (x, y, z, h) => { if (!inMap(x, y)) return; const k = key(x, y, z), prev = blockers.get(k); if (!prev || prev.h < h) blockers.set(k, { x, y, z, h }); };
  let buildingNo = 0;

  for (const o of doc.objects) {
    const a = isRecord(o) ? KIT[o.assetId] : null;
    if (!a) { errors.push(`Unknown asset: ${String(o && o.assetId).slice(0, 80)}.`); continue; }
    const s = o.scale ?? 1, e = o.elevation || 0, rot = o.rotation || 0, cr = cellRect(o), tr = tileRect(cr);
    const hM = a.h * s, surfaceM = a.surface != null ? a.surface * s + e : null;
    // what has no canonical stand-in (the renderer draws buildings, decks, flights, containers, crates, barriers
    // and trees itself, fitted to the rule tiles) is drawn from the kit where the Forge placed it
    const drawn = ['building', 'deck', 'stairs', 'ladder', 'container', 'crate', 'barricade', 'tree', 'marker'].includes(a.kind) || (a.kind === 'bridge' && surfaceM >= 1);
    if (!drawn) SCENE.props.push({ id: o.assetId, kind: a.kind, x: worldX(cr.x + cr.w / 2), z: worldZ(cr.y + cr.d / 2),
      w: cr.w / TILE_M, d: cr.d / TILE_M, h: hM / TILE_M, y: e / TILE_M, yaw: -rot * Math.PI / 180 });
    switch (a.kind) {
      case 'ground': case 'marker': break;
      case 'water': cells(tr, (x, y) => waterCells.add(key(x, y))); break;
      case 'bridge':
        if (surfaceM < 1) cells(tr, (x, y) => bridgeCells.add(key(x, y)));
        else { surfaces.push({ z: 1, ...tr, height: surfaceM }); SCENE.decks.push({ ...tr, h: surfaceM }); }
        break;
      case 'deck': surfaces.push({ z: 1, ...tr, height: surfaceM }); SCENE.decks.push({ ...tr, h: surfaceM }); break;
      case 'building': {
        buildingNo += 1;
        surfaces.push({ z: 1, ...tr, height: surfaceM });
        SCENE.buildings.push({ id: o.id, label: `${a.tag}-${buildingNo}`, ...tr, h: surfaceM, roof: true, wall: a.wall });
        cells(tr, (x, y) => block(x, y, 0, surfaceM));
        break;
      }
      case 'stairs': case 'ladder': stairObjects.push({ o, a, cr, tr }); break;
      case 'tree': { const t = tileOf(cr.x + cr.w / 2 - 0.5, cr.y + cr.d / 2 - 0.5); SCENE.trees.push(t); break; }
      default: // solid things: on the ground, or standing on a roof when lifted onto one
        if (e >= 1) { raised.push({ tr, h: hM, base: e, label: o.id }); break; }
        if (a.kind === 'container') SCENE.containers.push({ ...tr, h: hM, color: 0xd9dcdd });
        else if (a.kind === 'barricade') SCENE.barricades.push({ ...tr });
        else if (a.kind === 'crate') SCENE.crates.push({ ...tr });
        cells(tr, (x, y) => block(x, y, 0, a.kind === 'barricade' ? 1.1 : a.kind === 'crate' ? 1.8 : hM));
    }
  }
  // water blocks walking (h 0: it does not block sight) unless a ground bridge crosses it
  for (const k of waterCells) if (!bridgeCells.has(k)) { const [x, y] = k.split(':').map(Number); block(x, y, 0, 0); }

  const surfaceAt = (x, y, z) => { if (!z) return { height: 0 }; let best = null; for (const q of surfaces) if (q.z === z && x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.d && (!best || q.height > best.height)) best = q; return best; };
  for (const r of raised) cells(r.tr, (x, y) => {
    const q = surfaceAt(x, y, 1);
    if (q && Math.abs(q.height - r.base) < 1.2) block(x, y, 1, r.h); else warnings.push(`${r.label} is lifted off the ground but not onto a roof; it is scenery only.`);
  });

  // the relay: Forge (0, 0), a 1.5 m terminal on its tile (as Transit), linked by Technical from an adjacent tile
  const relay = { id: 'RELAY', x: origin.x, y: origin.y, h: 1.5 };
  block(relay.x, relay.y, 0, relay.h);
  SCENE.relay = relay;

  const ex = isRecord(doc.extraction) ? doc.extraction : { x: 0, y: 0, radius: 4 };
  const exT = tileOf(ex.x, ex.y), exR = Math.max(1, Math.round((ex.radius || 2) / TILE_M));
  SCENE.extraction = { x: exT.x, y: exT.y, r: exR };

  const standable = (x, y, z) => inMap(x, y) && !blockers.has(key(x, y, z)) && (!z || !!surfaceAt(x, y, z));
  const heightOf = (p) => (p.z ? (surfaceAt(p.x, p.y, p.z) || { height: 0 }).height : 0);
  const cellToTile = (p) => ({ ...tileOf(p.x, p.y), z: p.layer === 1 ? 1 : 0 });

  // links: every authored traversal connection, and every stair or ladder that meets a roof
  const links = [];
  const linkCost = (from, to, kind, minimumTiles = 0) => {
    const rise = Math.abs(heightOf(to) - heightOf(from));
    const walk = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    return Math.max(1, minimumTiles, walk + Math.ceil(rise / (kind === 'ladder' ? LADDER_CLIMB_M : STAIR_CLIMB_M)));
  };
  for (const c of Array.isArray(doc.connections) ? doc.connections : []) {
    if (!isRecord(c) || !isRecord(c.from) || !isRecord(c.to)) { errors.push('A traversal connection is malformed.'); continue; }
    const from = cellToTile(c.from), to = cellToTile(c.to);
    if (!standable(from.x, from.y, from.z) || !standable(to.x, to.y, to.z)) { errors.push(`Traversal ${c.id} has a blocked or unsupported end on the ${TILE_M} m grid.`); continue; }
    // an authored cost is metres of travel; it may never undercut the distance walked plus the climb
    const minM = Math.abs(c.from.x - c.to.x) + Math.abs(c.from.y - c.to.y) + Math.abs(heightOf(to) - heightOf(from));
    if ((c.cost ?? 1) < Math.ceil(minM)) { errors.push(`Traversal ${c.id} costs less than its travel distance (${Math.ceil(minM)}).`); continue; }
    if (from.x === to.x && from.y === to.y && from.z === to.z) continue;
    links.push({ id: String(c.id), from, to, cost: linkCost(from, to, c.type || 'stairs', Math.ceil((c.cost ?? 1) / TILE_M)) });
    if (from.z !== to.z) SCENE.stairs.push({ id: String(c.id), from: from.z ? to : from, to: from.z ? from : to, kind: c.type || 'stairs' });
  }
  for (const { o, a, cr } of stairObjects) {
    const cx = Math.floor(cr.x + cr.w / 2), cy = Math.floor(cr.y + cr.d / 2), rot = o.rotation || 0;
    const ends = rot === 0 ? [[cx, cr.y - 1], [cx, cr.y + cr.d]] : rot === 90 ? [[cr.x - 1, cy], [cr.x + cr.w, cy]]
      : rot === 180 ? [[cx, cr.y + cr.d], [cx, cr.y - 1]] : [[cr.x + cr.w, cy], [cr.x - 1, cy]];
    const from = { ...tileOf(ends[0][0], ends[0][1]), z: 0 }, to = { ...tileOf(ends[1][0], ends[1][1]), z: 1 };
    const rise = a.surface * (o.scale ?? 1) + (o.elevation || 0);
    const meets = (p) => { const q = surfaceAt(p.x, p.y, 1); return !!q && Math.abs(q.height - rise) <= 1.2 && standable(p.x, p.y, 1); };
    // the landing cell sits on the roof's edge in metres; on 3.54 m tiles the edge tile may be mostly yard, so the
    // landing steps on (at most two tiles, in the flight's own direction) to the first tile the roof covers
    const sx = Math.sign(to.x - from.x), sy = Math.sign(to.y - from.y);
    for (let i = 0; i < 2 && !meets(to) && inMap(to.x + sx, to.y + sy); i += 1) { to.x += sx; to.y += sy; }
    if (!meets(to) || !standable(from.x, from.y, 0)) {
      warnings.push(`${a.kind === 'ladder' ? 'Ladder' : 'Stair'} ${o.id} does not meet a roof of its height; add a traversal link or move it.`);
      continue;
    }
    if (links.some((l) => key(l.from.x, l.from.y, l.from.z) === key(from.x, from.y, 0) && key(l.to.x, l.to.y, l.to.z) === key(to.x, to.y, 1))) continue;
    // the flight is solid ground-level clutter, except its foot and where it is inside the building
    const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
    for (let x = from.x + dx, y = from.y + dy, i = 0; i < 8 && !(x === to.x && y === to.y); i += 1) {
      if (!SCENE.buildings.some((bb) => x >= bb.x && x < bb.x + bb.w && y >= bb.y && y < bb.y + bb.d)) block(x, y, 0, 3);
      if (x !== to.x) x += dx; else if (y !== to.y) y += dy;
    }
    links.push({ id: `${o.id}-access`, from, to, cost: linkCost(from, to, a.kind) });
    SCENE.stairs.push({ id: `${o.id}-access`, from, to, kind: a.kind === 'ladder' ? 'ladder' : 'stairs' });
  }

  // deployments: the tile a spawn is in; if the snap lands it on a blocked tile or a teammate, the nearest open tile
  const taken = new Set([key(relay.x, relay.y, 0)]), units = [];
  const place = (s, label) => {
    const want = cellToTile(s);
    for (let r = 0; r <= 3; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const p = { x: want.x + dx, y: want.y + dy, z: want.z };
      if (!standable(p.x, p.y, p.z) || taken.has(key(p.x, p.y, p.z))) continue;
      if (r) warnings.push(`${label} stands on the nearest open ${TILE_M} m tile.`);
      taken.add(key(p.x, p.y, p.z)); return p;
    }
    errors.push(`${label} spawns on blocked or unsupported ground.`); return null;
  };
  for (const role of ['T', 'E', 'R']) { // Technical places first: the mission is theirs
    const s = doc.spawns.find((q) => isRecord(q) && q.team === 'player' && q.id === role);
    if (!s) { errors.push(`Place the ${role} operative spawn before testing.`); continue; }
    const p = place(s, role); if (!p) continue;
    const { x, y, z, ...stats } = SQUAD[role]; // eslint-disable-line no-unused-vars
    units.push({ ...stats, id: `${role}1`, x: p.x, y: p.y, z: p.z });
  }
  for (const s of doc.spawns.filter((q) => isRecord(q) && q.team === 'enemy')) {
    const p = place(s, `Hostile ${s.id}`); if (!p) continue;
    units.push({ ...(HOSTILE[s.role] || HOSTILE.guard), id: String(s.id), faction: 'THREAT', x: p.x, y: p.y, z: p.z });
  }

  const blockerList = [...blockers.values()];
  const cover = deriveCover(blockerList, surfaces, W, H, FLOORS);
  const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim().slice(0, 80) : 'Forge level';
  const LEVEL_ID = `forge-${String(doc.id || 'draft').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'draft'}`;
  const D = (x, y) => `(${x - FRAME.x0}, ${FRAME.y0 - y})`;
  const MISSION = {
    title,
    objective: 'Secure the relay',
    brief: `${title}: Technical links the relay twice, then the squad extracts at ${D(exT.x, exT.y)}. A Level Forge play test.`,
    roles: { E: 'Lead the way. Protect the approach.' },
    help: [
      'Technical must stand next to the relay and <b>Link</b> twice. Then everyone still standing reaches the yellow ring and <b>Extracts</b>. If Technical is lost, the mission fails.',
      `A Level Forge play test on the ${TILE_M} m grid. Coordinates: X grows east, Y grows north, in tiles, as in the Forge's sector map; the relay is (0, 0). Rules are the Prim3 canonical engine; this page only draws them.`
    ],
    extractPlace: 'the yellow ring', logDone: 'Relay linked. Extract at the yellow ring.'
  };
  const level = {
    LEVEL_ID, W, H, FLOORS, TILE_M, FRAME, SCENE, MISSION,
    toDisplay: (x, y) => ({ X: x - FRAME.x0, Y: FRAME.y0 - y }),
    RETURN: { href: FORGE_URL, label: 'Level Forge' },
    FORGE_DOCUMENT_ID: doc.id,
    surfaces: () => surfaces.map((q) => ({ ...q })),
    engineConfig: ({ seed = 20261103 } = {}) => ({
      width: W, height: H, floors: FLOORS, seed,
      clock: TRANSIT.clock,
      extractionRequired: true,
      surfaces: surfaces.map((q) => ({ ...q })),
      links: links.map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to } })),
      blockers: blockerList.map((q) => ({ ...q })),
      cover: cover.map((c) => ({ ...c, sides: [...c.sides] })),
      units: units.map((u) => ({ ...u })),
      nodes: [{ id: 'RELAY', state: 'OBSERVED', required: true, at: { x: relay.x, y: relay.y, z: 0, range: 1, roles: ['T'] } }],
      technicalTruth: { nodes: { RELAY: JSON.parse(JSON.stringify(RELAY_TRUTH)) } },
      objectives: [],
      battlefield: { levelId: LEVEL_ID, coordinateFrame: FRAME, objectiveTiles: [{ id: 'RELAY', x: relay.x, y: relay.y }],
        extractionZone: { x: exT.x, y: exT.y, z: 0, r: exR } }
    })
  };
  return { level, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// Cover is derived, never hand-placed: Transit / Relay's buildCover rule, for any level's blockers and surfaces.
export function deriveCover(blockers, surfaces, W, H, FLOORS) {
  const bmap = new Map(blockers.map((b) => [key(b.x, b.y, b.z), b]));
  const walkable = (x, y, z) => {
    if (x < 0 || y < 0 || x >= W || y >= H || bmap.has(key(x, y, z))) return false;
    return z === 0 || surfaces.some((s) => s.z === z && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.d);
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

/** Playability, decided by the canonical resolver: every operative's reach is computeReach on the exported
    state (links a unit could not cross in one dash, cost > 2 × moveRange, are not crossable). Technical must
    reach a tile next to the relay; every operative must reach the extraction zone. */
export function validateForgeLevel(doc) {
  const { level, errors, warnings } = exportForgeLevel(doc);
  if (!level || errors.length) return { ok: false, errors: errors.length ? errors : ['The level could not be exported.'], warnings, level };
  let state;
  try { state = createState(level.engineConfig()); }
  catch (e) { return { ok: false, errors: [`The engine refused the level: ${e.message}`], warnings, level }; }
  const node = state.nodes.find((n) => n.id === 'RELAY').at, zone = state.battlefield.extractionZone;
  const reachable = (unit) => {
    const st = { ...state, links: state.links.filter((l) => l.cost <= 2 * unit.moveRange) };
    const reach = computeReach(st, unit.id, Infinity, { occupants: [] });
    return [{ x: unit.x, y: unit.y, z: unit.z }, ...reach.cells];
  };
  const out = [...errors];
  for (const u of state.units.filter((q) => q.faction === 'PLAYER')) {
    const tiles = reachable(u);
    if (u.role === 'T' && !tiles.some((t) => t.z === node.z && Math.abs(t.x - node.x) + Math.abs(t.y - node.y) <= node.range)) out.push('Technical has no walkable route to the relay.');
    if (!tiles.some((t) => t.z === (zone.z || 0) && Math.abs(t.x - zone.x) + Math.abs(t.y - zone.y) <= zone.r)) out.push(`${u.role} cannot reach extraction.`);
  }
  for (const bld of level.SCENE.buildings) if (!state.links.some((l) => [l.from, l.to].some((p) => p.z === 1 && p.x >= bld.x && p.x < bld.x + bld.w && p.y >= bld.y && p.y < bld.y + bld.d))) warnings.push(`Building ${bld.label} has no stair or ladder access.`);
  return { ok: out.length === 0, errors: [...new Set(out)], warnings: [...new Set(warnings)], level };
}

/** The page's hook: levels/index.mjs loads 'forge' through this, from the document the Forge handed over. */
export function loadPlaytest(storage = globalThis.localStorage) {
  let doc = null;
  try { doc = JSON.parse(storage.getItem(PLAYTEST_KEY) || 'null'); } catch (e) { doc = null; }
  if (!doc) return null;
  const v = validateForgeLevel(doc);
  return v.ok ? v.level : null;
}
