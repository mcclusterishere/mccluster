/* Fictional City: metre-based street traversal. Independent of PRIM3's grid/rules. */
export const PLAYER_RADIUS = 0.43;
export const DISTRICT_SURFACES = Object.freeze([
  { minX: -72, maxX: 72, minZ: -58, maxZ: 45 },
  { minX: -5, maxX: 5, minZ: 44, maxZ: 70 },
  { minX: -20, maxX: 20, minZ: 68, maxZ: 108 }
]);

export function buildingBounds(b) {
  if (Array.isArray(b.footprint) && b.footprint.length >= 3) {
    return { minX: Math.min(...b.footprint.map(p => p[0])), maxX: Math.max(...b.footprint.map(p => p[0])),
      minZ: Math.min(...b.footprint.map(p => p[1])), maxZ: Math.max(...b.footprint.map(p => p[1])),
      id: b.id, footprint: b.footprint, footprintHoles: b.footprintHoles || [] };
  }
  const [x, z] = b.position, [w, d] = b.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, id: b.id };
}

export function yardFixtures(b) {
  const [x, z] = b.position, [w, d] = b.size;
  const front = b.entrance[1] > z ? 1 : -1;
  const furniture = b.yardType === 'vehicle' || /railside/.test(b.id) ? [
    { id: `${b.id}-car-west`, x: x - w * .22, z: z + front * d * .05, w: 4.8, d: 2.5, height: 1.6, type: 'car' },
    { id: `${b.id}-car-east`, x: x + w * .23, z: z - front * d * .2, w: 4.8, d: 2.5, height: 1.6, type: 'car' }
  ] : [{ id: `${b.id}-table`, x: x + w * .28, z: z - front * d * .18, w: 2.6, d: 1.3, height: 1.05, type: 'table' }];
  return [...furniture,
    { id: `${b.id}-fence`, x, z: z - front * (d / 2 - .2), w: w - .4, d: .2, height: 1.8, type: 'fence' }
  ];
}

export function createSpatialWorld(buildings, hq = null, extraSurfaces = [], storyBeats = []) {
  const blockers = buildings.filter(b => b.style !== 'yard').map(buildingBounds);
  for (const b of buildings.filter(b => b.style === 'yard')) for (const f of yardFixtures(b)) {
    blockers.push({ minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2, id: f.id });
  }
  for (const beat of storyBeats) if (beat.prop === 'donation-bin' && Array.isArray(beat.propPosition)) {
    const [x, z] = beat.propPosition;
    if (Number.isFinite(x) && Number.isFinite(z)) blockers.push({ minX: x - .8, maxX: x + .8, minZ: z - .675, maxZ: z + .675, id: `${beat.id}-donation-bin` });
  }
  if (hq?.footprintMeters) {
    const [w, d] = hq.footprintMeters;
    blockers.push({ minX: -w / 2, maxX: w / 2, minZ: 88 - d / 2, maxZ: 88 + d / 2, id: 'equity-uprise-hq' });
  }
  const extensions = extraSurfaces.filter(s => s && ['minX', 'maxX', 'minZ', 'maxZ'].every(k => Number.isFinite(s[k]))
    && s.minX < s.maxX && s.minZ < s.maxZ);
  return { surfaces: [...DISTRICT_SURFACES, ...extensions], blockers };
}

export function interiorWorld(garage = false, style = '') {
  const width = garage ? 23 : 16, depth = garage ? 13 : 11;
  const layout = garage ? 'garage' : /church|chapel/.test(style) ? 'church'
    : /laundry|laundromat/.test(style) ? 'laundry' : /home|apartment|residential|walkup/.test(style) ? 'home'
      : /warehouse|industrial/.test(style) ? 'warehouse' : 'shop';
  const fixtures = [];
  const fixture = (id, x, z, w, d, height, type) => fixtures.push({ id, x, z, w, d, height, type });
  if (layout === 'church') {
    for (const x of [-4.25, 4.25]) for (const z of [-1.9, .6]) fixture(`pew-${x}-${z}`, x, z, 4.3, 1.0, 1.15, 'pew');
    fixture('altar', 0, -4.2, 4.8, .9, 1.25, 'altar');
  } else if (layout === 'laundry') {
    for (const x of [-6.6, 6.6]) for (const z of [-3.2, -.9, 1.4]) fixture(`washer-${x}-${z}`, x, z, 1.7, 1.7, 1.7, 'washer');
    fixture('folding-table', 0, -3.7, 3.7, 1.1, 1.0, 'table');
  } else if (layout === 'home') {
    fixture('sofa', -4, -1.2, 4.0, 1.8, 1.3, 'sofa');
    fixture('armchair', 5, -2.5, 1.8, 1.8, 1.3, 'chair');
    fixture('coffee-table', 0, -1.8, 2.8, 1.1, .6, 'table');
  } else if (layout === 'warehouse') {
    fixture('west-crates', -5, -2.8, 3, 3, 2.1, 'crates');
    fixture('east-crates', 4, -3.2, 4, 2, 1.8, 'crates');
    fixture('loading-crates', 5, .7, 2, 2, 1.3, 'crates');
  }
  const storyPoint = layout === 'church' ? { x: 0, z: -2.6 } : layout === 'home' ? { x: 0, z: .4 } : { x: 0, z: -.6 };
  return {
    width, depth, layout, fixtures, storyPoint,
    surfaces: [{ minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 }],
    blockers: garage
      ? [{ minX: -9.5, maxX: -3.4, minZ: -4.6, maxZ: -1.2, id: 'work-van' }, { minX: 3, maxX: 9.4, minZ: -4.8, maxZ: -3.3, id: 'workbench' }]
      : fixtures.length ? fixtures.map(f => ({ minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2, id: f.id }))
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

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function touchesRing(x, z, ring, radiusSquared) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i], dx = bx - ax, dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < radiusSquared) return true;
  }
  return false;
}

function pointSegmentDistanceSquared(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
  return (px - ax - dx * t) ** 2 + (pz - az - dz * t) ** 2;
}

function segmentDistanceSquared(ax, az, bx, bz, cx, cz, dx, dz) {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, cross = ux * vz - uz * vx;
  if (Math.abs(cross) > 1e-12) {
    const t = ((cx - ax) * vz - (cz - az) * vx) / cross;
    const u = ((cx - ax) * uz - (cz - az) * ux) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegmentDistanceSquared(ax, az, cx, cz, dx, dz), pointSegmentDistanceSquared(bx, bz, cx, cz, dx, dz),
    pointSegmentDistanceSquared(cx, cz, ax, az, bx, bz), pointSegmentDistanceSquared(dx, dz, ax, az, bx, bz));
}

// The whole walking disc must clear a wall between cells. Checking just grid
// endpoints misses narrow projections and angled corners in actual footprints.
function clearWalkingSegment(a, b, world, radius = PLAYER_RADIUS) {
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
  const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
  const radiusSquared = radius * radius;
  for (const obstacle of world.blockers) {
    if (maxX < obstacle.minX || minX > obstacle.maxX || maxZ < obstacle.minZ || minZ > obstacle.maxZ) continue;
    const rings = obstacle.footprint ? [obstacle.footprint, ...(obstacle.footprintHoles || [])]
      : [[[obstacle.minX, obstacle.minZ], [obstacle.maxX, obstacle.minZ], [obstacle.maxX, obstacle.maxZ], [obstacle.minX, obstacle.maxZ]]];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (segmentDistanceSquared(a.x, a.z, b.x, b.z, ...ring[j], ...ring[i]) < radiusSquared - 1e-12) return false;
    }
  }
  if (world.surfaces.some(s => minX >= s.minX && maxX <= s.maxX && minZ >= s.minZ && maxZ <= s.maxZ)) return true;
  // Supported land is a union, so sample the same short-step scale used by the
  // movement integrator at joins; do not shrink each bridge rectangle separately.
  const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / .18);
  for (let i = 1; i < steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
    if (!supported(x - radius, z, world.surfaces) || !supported(x + radius, z, world.surfaces)
      || !supported(x, z - radius, world.surfaces) || !supported(x, z + radius, world.surfaces)) return false;
  }
  return true;
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
    if (dx * dx + dz * dz >= radius * radius) continue;
    if (!b.footprint) return false;
    const holes = b.footprintHoles || [];
    if ((pointInRing(x, z, b.footprint) && !holes.some(ring => pointInRing(x, z, ring)))
      || touchesRing(x, z, b.footprint, radius * radius)
      || holes.some(ring => touchesRing(x, z, ring, radius * radius))) return false;
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

function nearCell(p, world, connected = false) {
  const cx = Math.round(p.x), cz = Math.round(p.z);
  if (isWalkable(cx, cz, world) && (!connected || clearWalkingSegment(p, { x: cx, z: cz }, world))) return [cx, cz];
  for (let r = 1; r <= 4; r++) {
    let best = null, dist = Infinity;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.abs(x - cx) !== r && Math.abs(z - cz) !== r) continue;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < dist && isWalkable(x, z, world) && (!connected || clearWalkingSegment(p, { x, z }, world))) { best = [x, z]; dist = d; }
    }
    if (best) return best;
  }
  return null;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const key = (x, z) => `${x},${z}`;
const h = (x, z, ex, ez) => Math.max(Math.abs(ex - x), Math.abs(ez - z)) + 0.41421356237 * Math.min(Math.abs(ex - x), Math.abs(ez - z));
// Equal-cost open streets have many shortest routes. Prefer the deeper route on
// that plateau so a long cross-district walk does not flood-fill all of them.
const before = (a, b) => a.f < b.f - 1e-9 || (Math.abs(a.f - b.f) <= 1e-9 && a.g > b.g);

/* A bounded A* runs only on taps, never every frame. Diagonal moves cannot clip corners. */
export function findWalkingPath(start, destination, world, maxVisits = null) {
  if (maxVisits == null) {
    const landArea = world.surfaces.reduce((area, s) => area + (s.maxX - s.minX) * (s.maxZ - s.minZ), 0);
    maxVisits = Math.min(64000, Math.max(16000, Math.ceil(landArea)));
  }
  const a = nearCell(start, world, isWalkable(start.x, start.z, world));
  const b = nearCell(destination, world, isWalkable(destination.x, destination.z, world));
  if (!a || !b) return [];
  const nodes = new Map(), heap = [], walkableCells = new Map();
  const cellWalkable = (x, z, id = key(x, z)) => {
    if (walkableCells.has(id)) return walkableCells.get(id);
    const value = isWalkable(x, z, world); walkableCells.set(id, value); return value;
  };
  function push(n) {
    heap.push(n); let i = heap.length - 1;
    while (i) { const p = (i - 1) >> 1; if (!before(n, heap[p])) break; heap[i] = heap[p]; i = p; }
    heap[i] = n;
  }
  function pop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && before(heap[j + 1], heap[j])) j++;
        if (!before(heap[j], last)) break;
        heap[i] = heap[j]; i = j;
      }
      heap[i] = last;
    }
    return top;
  }
  const first = { x: a[0], z: a[1], g: 0, f: h(...a, ...b), parent: null, closed: false };
  nodes.set(key(...a), first); push(first);
  let visits = 0;
  while (heap.length && visits < maxVisits) {
    const n = pop(); if (n.closed) continue; n.closed = true; visits++;
    if (n.x === b[0] && n.z === b[1]) {
      const result = [];
      for (let p = n; p; p = p.parent) result.push({ x: p.x, z: p.z });
      result.reverse();
      if (isWalkable(start.x, start.z, world)) result.unshift({ x: start.x, z: start.z });
      if (isWalkable(destination.x, destination.z, world)) result.push({ x: destination.x, z: destination.z });
      return result;
    }
    for (const [dx, dz] of STEPS) {
      const x = n.x + dx, z = n.z + dz;
      const k = key(x, z), previous = nodes.get(k), g = n.g + (dx && dz ? Math.SQRT2 : 1);
      if (previous && (previous.closed || previous.g <= g)) continue;
      if (!cellWalkable(x, z, k)) continue;
      if (dx && dz && (!cellWalkable(n.x + dx, n.z) || !cellWalkable(n.x, n.z + dz))) continue;
      if (!clearWalkingSegment(n, { x, z }, world)) continue;
      // Replace the queue record rather than mutating a heap member's priority.
      if (previous) previous.closed = true;
      const next = { x, z, g, f: g + h(x, z, ...b), parent: n, closed: false };
      nodes.set(k, next); push(next);
    }
  }
  return [];
}
