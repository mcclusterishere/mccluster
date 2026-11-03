/* McCluster City — render chunks derived from the places contract.

   The publisher writes one small JSON file per chunk (data/fictional-city/chunks/<id>.json) plus an index
   with each file's byte length and SHA-256. A chunk carries render detail only: road and sidewalk pieces
   clipped exactly at the chunk edge (so neighbouring chunks meet without gaps or overlaps), the parcels whose
   centre lies inside it, and deterministic street furniture (lamps, trees, benches, bollards, planters).
   Collision never lives here: the whole city's walk surfaces and footprints come from places.v1.json and are
   always resident, so a slow or failed chunk download can never let a body fall into the harbour.

   The original block, the footbridge and the island are the resident hub drawn by scene.mjs exactly as before;
   chunk detail is clipped out of the hub so nothing is drawn twice. Pure module: no DOM, no three.js.

   Tile-source contract (what scene.mjs consumes, so a second source, e.g. a georeferenced region, can feed it):
     index  { chunks: [{ id, bounds: { minX, maxX, minZ, maxZ }, file?, sha256? }] }   in city metres
     loadChunk(id) → Promise<{ id, roads: [rect & { kind }], props: [{ kind, x, z }], parcels: [parcelId] }> */
import { chunkIdAt, chunkBounds, footprintBounds } from './places.mjs';

export const CHUNK_SCHEMA = 'mccluster.fictional-city.chunk/v1';
export const CHUNK_INDEX_SCHEMA = 'mccluster.fictional-city.chunk-index/v1';
const HUB = [{ minX: -72, maxX: 72, minZ: -58, maxZ: 45 }, { minX: -5, maxX: 5, minZ: 44, maxZ: 70 }, { minX: -20, maxX: 20, minZ: 68, maxZ: 108 }];
const r2 = v => Math.round(v * 100) / 100;
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inRect = (r, x, z, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
function clip(a, b) {
  const out = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
  return out.minX < out.maxX && out.minZ < out.maxZ ? out : null;
}
// rectangle minus the hub rectangles, as a list of disjoint rectangles
function subtractHub(rect) {
  let pieces = [rect];
  for (const h of HUB) {
    const next = [];
    for (const p of pieces) {
      if (!overlap(p, h)) { next.push(p); continue; }
      if (p.minX < h.minX) next.push({ ...p, maxX: h.minX });
      if (p.maxX > h.maxX) next.push({ ...p, minX: h.maxX });
      const midX = { minX: Math.max(p.minX, h.minX), maxX: Math.min(p.maxX, h.maxX) };
      if (p.minZ < h.minZ) next.push({ ...midX, minZ: p.minZ, maxZ: h.minZ });
      if (p.maxZ > h.maxZ) next.push({ ...midX, minZ: h.maxZ, maxZ: p.maxZ });
    }
    pieces = next.filter(p => p.minX < p.maxX && p.minZ < p.maxZ);
  }
  return pieces;
}
const onLand = (places, x, z) => places.surfaces.some(s => inRect(s, x, z, -0.6));
const inHub = (x, z) => HUB.some(h => inRect(h, x, z, .5));
const blocked = (places, x, z, pad = 1.2) => places.parcels.some(p => inRect(footprintBounds(p), x, z, pad)) || places.legacyParcels.some(p => inRect(footprintBounds(p), x, z, pad));
const isRoad = (places, x, z) => places.streets.some(s => (s.kind === 'road' || s.kind === 'lane') && inRect(s, x, z, .3));

/* Deterministic street furniture for the whole city; each item belongs to the chunk containing it. */
export function cityProps(places) {
  const props = [];
  const add = (kind, x, z, extra = {}) => {
    if (!onLand(places, x, z) || inHub(x, z) || blocked(places, x, z) || isRoad(places, x, z)) return;
    props.push({ kind, x: r2(x), z: r2(z), ...extra });
  };
  for (const s of places.streets) {
    const along = (s.maxX - s.minX) >= (s.maxZ - s.minZ);
    if (s.kind === 'road' || s.kind === 'lane') {
      const step = s.kind === 'lane' ? 22 : 16;
      if (along) for (let x = s.minX + 8; x < s.maxX; x += step) { add('lamp', x, s.minZ - 1.6); add('lamp', x + step / 2, s.maxZ + 1.6); if (s.kind === 'road' && Math.round(x) % 3 === 0) add('tree', x + 4, s.maxZ + 3.2); }
      else for (let z = s.minZ + 8; z < s.maxZ; z += step) { add('lamp', s.minX - 1.6, z); add('lamp', s.maxX + 1.6, z + step / 2); }
    } else if (s.kind === 'promenade') {
      const waterX = s.minX === -56 ? s.maxX - .8 : s.minX + .8; // the bay side of each wharf walk
      for (let z = s.minZ + 5; z < s.maxZ; z += 6) add('bollard', waterX, z);
      for (let z = s.minZ + 9; z < s.maxZ; z += 14) add('bench', waterX + (s.minX === -56 ? -2.2 : 2.2), z, { yaw: s.minX === -56 ? -Math.PI / 2 : Math.PI / 2 });
      for (let z = s.minZ + 16; z < s.maxZ; z += 22) add('tree', (s.minX + s.maxX) / 2, z);
    } else if (s.kind === 'plaza') {
      props.push({ kind: 'fountain', x: r2((s.minX + s.maxX) / 2), z: r2((s.minZ + s.maxZ) / 2 + 2) });
      for (const dx of [-10, 10]) for (const dz of [-6, 6]) add('planter', (s.minX + s.maxX) / 2 + dx, (s.minZ + s.maxZ) / 2 + dz);
    }
  }
  for (const p of places.parks || []) {
    for (let x = p.minX + 7; x < p.maxX; x += 13) for (let z = p.minZ + 6; z < p.maxZ; z += 11) {
      const j = ((Math.abs(x * 31 + z * 17)) % 7) - 3;
      add('tree', x + j, z - j / 2, { variant: Math.abs(j) % 2 });
    }
    for (let x = p.minX + 13; x < p.maxX; x += 26) add('bench', x, p.maxZ - 3, { yaw: Math.PI });
  }
  // quay edges facing open water: the harbour's southern sea wall
  for (let x = -166; x <= 166; x += 6) if (Math.abs(x) > 42) add('bollard', x, 139.2);
  // piers
  for (const s of places.surfaces.filter(s => s.kind === 'pier')) {
    for (let x = s.minX + 1; x < s.maxX; x += 3) { props.push({ kind: 'bollard', x: r2(x), z: r2(s.minZ + .4) }, { kind: 'bollard', x: r2(x), z: r2(s.maxZ - .4) }); }
  }
  return props;
}

/* Every chunk that touches a walk surface. Returns { index, chunks: Map(id → chunk JSON) }. */
export function buildChunks(places) {
  const size = places.frame?.chunkMeters || 64, b = places.frame.bounds;
  const props = cityProps(places);
  const chunks = new Map();
  for (let ix = Math.floor(b.minX / size); ix * size < b.maxX; ix++) for (let iz = Math.floor(b.minZ / size); iz * size < b.maxZ; iz++) {
    const id = `c${ix}_${iz}`, cb = chunkBounds(places, id);
    const land = places.surfaces.flatMap(s => { const c = clip(s, cb); return c ? subtractHub(c).map(p => ({ kind: s.kind, ...round(p) })) : []; });
    if (!land.length) continue;
    const roads = places.streets.flatMap(s => { const c = clip(s, cb); return c ? subtractHub(c).map(p => ({ street: s.id, kind: s.kind, ...round(p) })) : []; });
    const parcels = places.parcels.filter(p => chunkIdAt(places, ...p.footprint.center) === id).map(p => p.id);
    const items = props.filter(p => chunkIdAt(places, p.x, p.z) === id);
    const neighborhoods = places.neighborhoods.filter(n => overlap(n.bounds, cb)).map(n => n.id);
    chunks.set(id, { schema: CHUNK_SCHEMA, id, bounds: { minX: cb.minX, maxX: cb.maxX, minZ: cb.minZ, maxZ: cb.maxZ }, neighborhoods, land, roads, parcels, props: items });
  }
  const index = { schema: CHUNK_INDEX_SCHEMA, places: places.id, revision: places.revision, chunkMeters: size,
    chunks: [...chunks.values()].map(c => ({ id: c.id, file: `chunks/${c.id}.json`, bounds: c.bounds, parcels: c.parcels.length, props: c.props.length })) };
  return { index, chunks };
}
const round = r => ({ minX: r2(r.minX), maxX: r2(r.maxX), minZ: r2(r.minZ), maxZ: r2(r.maxZ) });

/* Which chunks a player at (x, z) needs, with hysteresis: load inside loadRadius, keep until unloadRadius. */
export function chunkWanted(bounds, x, z, radius) {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX), dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);
  return Math.hypot(dx, dz) <= radius;
}
