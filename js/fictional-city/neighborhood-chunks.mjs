/* McCluster City — a tile source for surveyed neighbourhoods (Bridgeport today, any footprint set tomorrow).

   `district.v1.json → neighborhoods[]` carries surveyed footprints and street centrelines. Before this module the
   whole neighbourhood was built into the base scene at start-up, so its ~5,500 window boxes were allocated and drawn
   from the original block, where none of them can be seen. This module cuts a neighbourhood into the same 64 m
   chunks the authored city streams (js/fictional-city/chunks.mjs, scene.mjs → updateChunks), so detail is built only
   when the player is within CHUNK_LOAD_RADIUS of it and freed again past CHUNK_UNLOAD_RADIUS.

   Pure module: no DOM, no three.js; it derives everything from the neighbourhood data at runtime (nothing is
   published), so a set of N footprints needs no new files: add places/roads to the neighbourhood and they land in
   their chunks. Tile-source contract (the shape scene.mjs already consumes):

     index     { chunks: [{ id, bounds, neighborhood, places, roads }] }    bounds in city metres: the chunk square
                                                                             widened to cover its own buildings, so a
                                                                             long footprint loads before any part of
                                                                             it could enter the view
     loadChunk(id) → Promise<{ id, roads: [], props: [], parcels: [],       (empty: the authored-city fields)
                               neighborhood: { id, roads: [piece], dashes: [dash], signs: [sign], lamps, trees, places: [placeId] } }>

   What stays resident in scene.mjs: the neighbourhood's land surfaces (one box each, so a slow chunk can never open
   a hole in the ground), collision (spatial.mjs, always resident), story markers/props, interaction targets and
   camera occluders. Chunks carry render detail only.

   Content is assigned to chunks by position: a place by the centre of its footprint bounds, a road piece by its
   midpoint, a dash/sign/lamp/tree by its own point. Long road segments are cut at `maxSegment` so a piece never
   strays far from its chunk; pieces abut exactly (the kerb/road overhang stays only at a segment's real ends), and
   dashes are laid along the original segment so the painted pattern is identical to the unstreamed build. */

export const NEIGHBORHOOD_CHUNK_PREFIX = 'n';
const r4 = v => Math.round(v * 10000) / 10000;

export function neighborhoodChunkId(x, z, size = 64) { return `${NEIGHBORHOOD_CHUNK_PREFIX}${Math.floor(x / size)}_${Math.floor(z / size)}`; }
export function isNeighborhoodChunkId(id) { return typeof id === 'string' && new RegExp(`^${NEIGHBORHOOD_CHUNK_PREFIX}-?\\d+_-?\\d+$`).test(id); }
export function neighborhoodChunkBounds(id, size = 64) {
  const m = new RegExp(`^${NEIGHBORHOOD_CHUNK_PREFIX}(-?\\d+)_(-?\\d+)$`).exec(id); if (!m) return null;
  const ix = Number(m[1]), iz = Number(m[2]);
  return { minX: ix * size, maxX: (ix + 1) * size, minZ: iz * size, maxZ: (iz + 1) * size };
}
export function placeBounds(b) {
  if (Array.isArray(b.footprint) && b.footprint.length >= 3) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of b.footprint) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    return { minX, maxX, minZ, maxZ };
  }
  const [x, z] = b.position, [w, d] = b.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

/* One street segment (a → b) → abutting pieces of at most maxSegment metres, each knowing whether it holds the
   segment's real start or end (where the kerb and road surface overhang the centreline end). */
export function splitSegment(a, b, maxSegment = 24) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < .05) return [];
  const n = Math.max(1, Math.ceil(length / maxSegment)), pieces = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    pieces.push({ ax: r4(a[0] + dx * t0), az: r4(a[1] + dz * t0), bx: r4(a[0] + dx * t1), bz: r4(a[1] + dz * t1), startCap: i === 0, endCap: i === n - 1 });
  }
  return pieces;
}

/* Street dashes exactly as the unstreamed build laid them: along the whole segment from 2.5 m, every 8 m. */
export function segmentDashes(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), out = [];
  if (length < .05) return out;
  const angle = -Math.atan2(dz, dx);
  for (let at = 2.5; at < length - 1.5; at += 8) out.push({ x: r4(a[0] + dx * at / length), z: r4(a[1] + dz * at / length), length: Math.min(3.5, length - at), angle });
  return out;
}

export function neighborhoodChunks(neighborhoods = [], { chunkMeters = 64, maxSegment = 24 } = {}) {
  const chunks = new Map();
  const chunkFor = (x, z) => {
    const id = neighborhoodChunkId(x, z, chunkMeters);
    if (!chunks.has(id)) chunks.set(id, { id, bounds: { ...neighborhoodChunkBounds(id, chunkMeters) }, neighborhood: null, roads: [], dashes: [], signs: [], lamps: [], trees: [], places: [] });
    return chunks.get(id);
  };
  for (const n of neighborhoods) {
    const nid = n.id, namedRoads = new Set();
    const mark = c => { c.neighborhood = c.neighborhood || nid; return c; };
    for (const road of n.roads || []) {
      const roadWidth = road.width || 10;
      if (Array.isArray(road.points) && road.points.length > 1) {
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i];
          for (const p of splitSegment(a, b, maxSegment)) mark(chunkFor((p.ax + p.bx) / 2, (p.az + p.bz) / 2)).roads.push({ ...p, width: roadWidth });
          if (roadWidth >= 5) for (const d of segmentDashes(a, b)) mark(chunkFor(d.x, d.z)).dashes.push(d);
        }
        if (road.name && !namedRoads.has(road.name)) {
          namedRoads.add(road.name);
          const a = road.points[0], b = road.points[1], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const sx = a[0] + (b[1] - a[1]) / length * (roadWidth / 2 + 1.1), sz = a[1] - (b[0] - a[0]) / length * (roadWidth / 2 + 1.1);
          mark(chunkFor(sx, sz)).signs.push({ name: road.name, x: r4(sx), z: r4(sz) });
        }
        continue;
      }
      // an axis-aligned rectangle street (older authoring): one piece, drawn as before
      const { x, z, width: w, depth: d } = road;
      const rect = { rect: true, x, z, width: w, depth: d };
      mark(chunkFor(x, z)).roads.push(rect);
      if (road.name && w >= d && !namedRoads.has(road.name)) { namedRoads.add(road.name); mark(chunkFor(x - w / 2 + 5, z + d / 2 + 2.1)).signs.push({ name: road.name, x: r4(x - w / 2 + 5), z: r4(z + d / 2 + 2.1) }); }
    }
    for (const p of n.lamps || []) mark(chunkFor(p[0], p[1])).lamps.push([p[0], p[1]]);
    for (const [i, p] of (n.trees || []).entries()) mark(chunkFor(p[0], p[1])).trees.push([p[0], p[1], i]);
    for (const b of n.places || []) {
      const pb = placeBounds(b), c = mark(chunkFor((pb.minX + pb.maxX) / 2, (pb.minZ + pb.maxZ) / 2));
      c.places.push(b.id);
      // the chunk must be wanted before any part of this building could be seen
      c.bounds.minX = Math.min(c.bounds.minX, pb.minX); c.bounds.maxX = Math.max(c.bounds.maxX, pb.maxX);
      c.bounds.minZ = Math.min(c.bounds.minZ, pb.minZ); c.bounds.maxZ = Math.max(c.bounds.maxZ, pb.maxZ);
    }
  }
  for (const [id, c] of chunks) if (!c.roads.length && !c.dashes.length && !c.signs.length && !c.lamps.length && !c.trees.length && !c.places.length) chunks.delete(id);
  const index = { chunks: [...chunks.values()].map(c => ({ id: c.id, bounds: c.bounds, neighborhood: c.neighborhood, places: c.places.length, roads: c.roads.length })) };
  const has = id => chunks.has(id);
  const loadChunk = id => {
    const c = chunks.get(id);
    return c ? Promise.resolve({ id, roads: [], props: [], parcels: [], neighborhood: { id: c.neighborhood, roads: c.roads, dashes: c.dashes, signs: c.signs, lamps: c.lamps, trees: c.trees, places: c.places } })
      : Promise.reject(new Error('unknown neighbourhood chunk ' + id));
  };
  return { index, has, loadChunk, chunks };
}
