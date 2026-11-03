/* Fictional City: metre-based street traversal. Independent of PRIM3's grid/rules. */
export const PLAYER_RADIUS = 0.43;
export const DISTRICT_SURFACES = Object.freeze([
  { minX: -72, maxX: 72, minZ: -58, maxZ: 45 },
  { minX: -5, maxX: 5, minZ: 44, maxZ: 70 },
  { minX: -20, maxX: 20, minZ: 68, maxZ: 108 }
]);

export function buildingBounds(b) {
  const [x, z] = b.position, [w, d] = b.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, id: b.id };
}

/* `places` (places.v1.json) adds the expanded city's land, quays, piers and parcel footprints. Without it the
   world is exactly the original block, bridge and island, so older callers and saves behave as before. */
export function createSpatialWorld(buildings, hq = null, places = null) {
  const blockers = buildings.map(buildingBounds);
  const surfaces = places?.surfaces?.length
    ? places.surfaces.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ }))
    : DISTRICT_SURFACES;
  if (places?.parcels) {
    const known = new Set(blockers.map(b => b.id));
    for (const p of places.parcels) {
      if (known.has(p.id)) continue;
      const [x, z] = p.footprint.center, [w, d] = p.footprint.size;
      blockers.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, id: p.id });
    }
  }
  if (hq?.footprintMeters) {
    const [w, d] = hq.footprintMeters;
    blockers.push({ minX: -w / 2, maxX: w / 2, minZ: 88 - d / 2, maxZ: 88 + d / 2, id: 'equity-uprise-hq' });
  }
  return { surfaces, blockers };
}

export function interiorWorld(garage = false) {
  const width = garage ? 23 : 16, depth = garage ? 13 : 11;
  return {
    width, depth,
    surfaces: [{ minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 }],
    blockers: garage
      ? [{ minX: -9.5, maxX: -3.4, minZ: -4.6, maxZ: -1.2, id: 'work-van' }, { minX: 3, maxX: 9.4, minZ: -4.8, maxZ: -3.3, id: 'workbench' }]
      : [{ minX: -4.6, maxX: 4.6, minZ: -3, maxZ: -1.7, id: 'counter' }]
  };
}

function supported(x, z, surfaces) {
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return true;
  }
  return false;
}

export function isWalkable(x, z, world, radius = PLAYER_RADIUS) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  // A disc must be supported by the union of land/bridge/island, including their joins.
  if (!supported(x, z, world.surfaces) || !supported(x - radius, z, world.surfaces)
    || !supported(x + radius, z, world.surfaces) || !supported(x, z - radius, world.surfaces)
    || !supported(x, z + radius, world.surfaces)) return false;
  const r = radius * 0.7071067811865476;
  if (!supported(x - r, z - r, world.surfaces) || !supported(x + r, z - r, world.surfaces)
    || !supported(x - r, z + r, world.surfaces) || !supported(x + r, z + r, world.surfaces)) return false;
  for (let i = 0; i < world.blockers.length; i++) {
    const b = world.blockers[i];
    const dx = x - Math.max(b.minX, Math.min(b.maxX, x));
    const dz = z - Math.max(b.minZ, Math.min(b.maxZ, z));
    if (dx * dx + dz * dz < radius * radius) return false;
  }
  return true;
}

/* Sliding and short steps prevent tunnelling. Pass a reusable out object from an animation loop. */
export function moveWithCollisions(position, dx, dz, world, out = { x: position.x, z: position.z }, radius = PLAYER_RADIUS) {
  let x = position.x, z = position.z;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.18));
  const sx = dx / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    if (isWalkable(x + sx, z + sz, world, radius)) { x += sx; z += sz; }
    else {
      if (isWalkable(x + sx, z, world, radius)) x += sx;
      if (isWalkable(x, z + sz, world, radius)) z += sz;
    }
  }
  out.x = x; out.z = z;
  return out;
}

function nearCell(p, world) {
  const cx = Math.round(p.x), cz = Math.round(p.z);
  if (isWalkable(cx, cz, world)) return [cx, cz];
  for (let r = 1; r <= 4; r++) {
    let best = null, dist = Infinity;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.abs(x - cx) !== r && Math.abs(z - cz) !== r) continue;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < dist && isWalkable(x, z, world)) { best = [x, z]; dist = d; }
    }
    if (best) return best;
  }
  return null;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const key = (x, z) => `${x},${z}`;
const h = (x, z, ex, ez) => Math.max(Math.abs(ex - x), Math.abs(ez - z)) + 0.41421356237 * Math.min(Math.abs(ex - x), Math.abs(ez - z));

/* A bounded A* runs only on taps, never every frame. Diagonal moves cannot clip corners. */
export function findWalkingPath(start, destination, world, maxVisits = 16000) {
  const a = nearCell(start, world), b = nearCell(destination, world);
  if (!a || !b) return [];
  const nodes = new Map(), heap = [];
  function push(n) {
    heap.push(n); let i = heap.length - 1;
    while (i) { const p = (i - 1) >> 1; if (heap[p].f <= n.f) break; heap[i] = heap[p]; i = p; }
    heap[i] = n;
  }
  function pop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++;
        if (heap[j].f >= last.f) break;
        heap[i] = heap[j]; i = j;
      }
      heap[i] = last;
    }
    return top;
  }
  const first = { x: a[0], z: a[1], g: 0, f: h(...a, ...b), parent: null, closed: false };
  nodes.set(key(...a), first); push(first);
  let visits = 0;
  while (heap.length && visits++ < maxVisits) {
    const n = pop(); if (n.closed) continue; n.closed = true;
    if (n.x === b[0] && n.z === b[1]) {
      const result = [];
      for (let p = n; p; p = p.parent) result.push({ x: p.x, z: p.z });
      result.reverse();
      if (isWalkable(destination.x, destination.z, world)) result.push({ x: destination.x, z: destination.z });
      return result;
    }
    for (const [dx, dz] of STEPS) {
      const x = n.x + dx, z = n.z + dz;
      if (!isWalkable(x, z, world)) continue;
      if (dx && dz && (!isWalkable(n.x + dx, n.z, world) || !isWalkable(n.x, n.z + dz, world))) continue;
      const k = key(x, z), previous = nodes.get(k), g = n.g + (dx && dz ? Math.SQRT2 : 1);
      if (previous && (previous.closed || previous.g <= g)) continue;
      // Replace the queue record rather than mutating a heap member's priority.
      if (previous) previous.closed = true;
      const next = { x, z, g, f: g + h(x, z, ...b), parent: n, closed: false };
      nodes.set(k, next); push(next);
    }
  }
  return [];
}
