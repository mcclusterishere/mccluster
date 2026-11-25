/* McCluster City ↔ PRIM3 tactics: one set of places, two games, explicit scales.

   Scales are per level and never unified (owner, 2026-11-03):
     city / PRIM3 city tactics  CITY_TILE_M = TILE_M from js/prim3-tactics/scale.mjs (3.54 m a tile)
     Equity Uprise HQ adapter   HQ_CELL_M = 12 ft = 3.6576 m a cell (adapters/equity-uprise/adapter.mjs), so the
                                72-ft plate is exactly 6 × 6 cells. The HQ is never resized to the city grid.
   Free walking stays continuous metres; this module only derives tactical boards from the same places and
   maps anchors between frames. It does not replace free walking with turn-based movement.

   City frame (places.v1.json): metres, +X east, +Z south, +Y up.
   City tactical frame: tile x = floor((X − originX) / CITY_TILE_M), tile y = floor((Z − originZ) / CITY_TILE_M).
     Tactical y grows north → south, exactly as city +Z does, so there is no axis flip; z is the engine floor.
   HQ frame (building authority): feet, +X east, +Y north, plate SW corner (0, 0). The city places the building
     rotated 180° about its centre at (0, 88) so its Floor 1 public entrance faces the footbridge:
       cityX = −(xf − 36) · 0.3048,  cityZ = 88 + (yf − 36) · 0.3048,  cityY = groundY + elevationFt · 0.3048. */
import { TILE_M } from '../prim3-tactics/scale.mjs';
import { isWalkable } from './spatial.mjs';
import { footprintBounds, createPlacesIndex } from './places.mjs';

export const CITY_TILE_M = TILE_M;
export const FT = 0.3048;
export const HQ_FT_PER_CELL = 12;
export const HQ_CELL_M = HQ_FT_PER_CELL * FT; // 3.6576
export const HQ_PLATE_FT = 72;
export const HQ_CENTER = Object.freeze([0, 88]);

export function hqFtToCity(xf, yf, elevationFt = 0, groundY = .16) {
  return { x: -(xf - HQ_PLATE_FT / 2) * FT + HQ_CENTER[0], z: HQ_CENTER[1] + (yf - HQ_PLATE_FT / 2) * FT, y: groundY + elevationFt * FT };
}
export function cityToHqFt(x, z) {
  return { xf: HQ_PLATE_FT / 2 - (x - HQ_CENTER[0]) / FT, yf: HQ_PLATE_FT / 2 + (z - HQ_CENTER[1]) / FT };
}

export function cityFrame(places) {
  const [ox, oz] = places.frame?.tactical?.origin || [places.frame.bounds.minX, places.frame.bounds.minZ];
  return {
    tileM: CITY_TILE_M, originX: ox, originZ: oz,
    toTile: (x, z) => ({ x: Math.floor((x - ox) / CITY_TILE_M), y: Math.floor((z - oz) / CITY_TILE_M) }),
    tileCentre: (tx, ty) => ({ x: ox + (tx + .5) * CITY_TILE_M, z: oz + (ty + .5) * CITY_TILE_M })
  };
}

/* A tactical board for a rectangle of the city, built from the always-resident collision world:
   a tile is open when its centre carries a standing body; a parcel footprint is a blocker as tall as the
   building (it blocks sight); open water is a blocker of height 0 (no walking, sight passes), the same
   convention as the PRIM3 city grid (tools/prim3-city/city-grid.mjs). Bridges and piers are surfaces in
   places.v1.json, so they stay walkable tiles over the water mask. */
export function tacticalRegion(places, world, rect, { manifest = null } = {}) {
  const f = cityFrame(places);
  const a = f.toTile(rect.minX, rect.minZ), b = f.toTile(rect.maxX - 1e-6, rect.maxZ - 1e-6);
  const W = b.x - a.x + 1, H = b.y - a.y + 1;
  const heights = [...places.parcels, ...places.legacyParcels].map(p => ({ ...footprintBounds(p), h: p.height }));
  heights.push({ minX: -10.97, maxX: 10.97, minZ: 77.03, maxZ: 98.97, h: 24.69 }); // the HQ's 72 ft plate, 81 ft roof
  const blockers = [], kinds = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const c = f.tileCentre(a.x + x, a.y + y);
      const building = heights.find(r => c.x >= r.minX && c.x <= r.maxX && c.z >= r.minZ && c.z <= r.maxZ);
      if (building) { blockers.push({ x, y, z: 0, h: building.h }); row += '#'; continue; }
      const land = world.surfaces.some(s => c.x >= s.minX && c.x <= s.maxX && c.z >= s.minZ && c.z <= s.maxZ);
      if (!land) { blockers.push({ x, y, z: 0, h: 0 }); row += '~'; continue; }
      row += isWalkable(c.x, c.z, world, .3) ? '.' : '#';
      if (row.endsWith('#')) blockers.push({ x, y, z: 0, h: 3 });
    }
    kinds.push(row);
  }
  const index = createPlacesIndex(places, manifest);
  const anchors = {};
  for (const id of [...places.parcels.map(p => p.id), ...places.anchors.map(p => p.id), ...places.landmarks.map(p => p.id), ...places.legacyParcels.map(p => p.id)]) {
    const r = index.resolve(id); if (!r) continue;
    const t = f.toTile(r.x, r.z), local = { x: t.x - a.x, y: t.y - a.y };
    if (local.x >= 0 && local.y >= 0 && local.x < W && local.y < H) anchors[id] = { ...local, z: 0 };
  }
  return {
    schema: 'mccluster.fictional-city.tactical-region/v1', tileM: CITY_TILE_M, W, H, FLOORS: 1,
    origin: { tileX: a.x, tileY: a.y, ...f.tileCentre(a.x, a.y) }, kindRows: kinds, anchors,
    engineConfig: { width: W, height: H, floors: 1, blockers, links: [], cover: [], units: [] },
    toLocalTile: (x, z) => { const t = f.toTile(x, z); return { x: t.x - a.x, y: t.y - a.y, z: 0 }; },
    toCity: (tx, ty) => f.tileCentre(tx + a.x, ty + a.y)
  };
}
