/* McCluster City — the geography/placement contract (places.v1.json) and its resolver.

   Two authorities, joined only by stable IDs:
     core/data/fictional-city/district.v1.json  authored lore: brands, people, dialogue, items, interactions
     core/data/fictional-city/places.v1.json    geography: land, streets, neighbourhoods, parcels, entrances, anchors, chunks
   Lore binds to geography with `parcelId` (a business or venue), `homeParcelId` (where a resident lives),
   `routeAnchors` (ordered anchor/parcel IDs a resident walks between) and `interactions` (e.g. a bribe).
   The eight original businesses and the garage keep their authored coordinates in district.v1.json; the
   places file mirrors them as `legacyParcels` (checked equal by the tests) so every place is resolvable here.

   Pure module: no DOM, no three.js. Used by the browser scene, the publisher, the tests and the tactical adapter. */
import { findWalkingPath, isWalkable } from './spatial.mjs';

export const PLACES_SCHEMA = 'mccluster.fictional-city.places/v1';
export const ORIGINAL_BUSINESS_IDS = Object.freeze(['gauranfucking-tea', 'hordash', 'mike-hawk', 'robbery-1s', 'hitman-gear', 'real-camera-men', 'pressure-tv', 'baddies-on-wheels']);
export const NEIGHBORHOOD_IDS = Object.freeze(['original-block', 'hq-waterfront', 'civic-center', 'northside-residential', 'workshop-waterfront']);

export function validatePlaces(places) {
  if (!places || places.schema !== PLACES_SCHEMA) throw new Error('Unsupported places contract');
  for (const key of ['neighborhoods', 'surfaces', 'parcels', 'legacyParcels', 'anchors', 'landmarks', 'streets']) {
    if (!Array.isArray(places[key])) throw new Error('places.' + key + ' is missing');
  }
  const ids = new Set();
  for (const p of [...places.parcels, ...places.legacyParcels, ...places.anchors, ...places.landmarks]) {
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9/#._-]{0,79}$/.test(p.id)) throw new Error('Bad place id ' + p.id);
    // a landmark may share its id with the street/park it names, never with a parcel or anchor
    if (ids.has(p.id) && !places.landmarks.includes(p)) throw new Error('Duplicate place id ' + p.id);
    ids.add(p.id);
  }
  return places;
}

export const chunkSize = (places) => places.frame?.chunkMeters || 64;
export function chunkIdAt(places, x, z) {
  const s = chunkSize(places);
  return `c${Math.floor(x / s)}_${Math.floor(z / s)}`;
}
export function chunkBounds(places, id) {
  const m = /^c(-?\d+)_(-?\d+)$/.exec(id); if (!m) return null;
  const s = chunkSize(places), ix = Number(m[1]), iz = Number(m[2]);
  return { id, minX: ix * s, maxX: (ix + 1) * s, minZ: iz * s, maxZ: (iz + 1) * s };
}
export function footprintBounds(p) {
  const [x, z] = p.footprint.center, [w, d] = p.footprint.size;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}
const inside = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

/* The index: parcel/anchor ID → world coordinates, neighbourhood and chunk. */
export function createPlacesIndex(places, manifest = null) {
  validatePlaces(places);
  const parcels = new Map(places.parcels.map(p => [p.id, p]));
  const legacy = new Map(places.legacyParcels.map(p => [p.id, p]));
  const anchors = new Map(places.anchors.map(a => [a.id, a]));
  const landmarks = new Map(places.landmarks.map(l => [l.id, l]));
  const byIdManifest = new Map(manifest ? [...(manifest.businesses || []), manifest.garage].filter(Boolean).map(b => [b.id, b]) : []);
  function neighborhoodAt(x, z) {
    // the island and bridge before the larger rectangles they sit inside
    const order = [...places.neighborhoods].sort((a, b) => (a.kind === 'landmark' ? -1 : 0) - (b.kind === 'landmark' ? -1 : 0));
    return order.find(n => inside(n.bounds, x, z)) || null;
  }
  function resolve(id) {
    if (typeof id !== 'string') return null;
    const [base, entranceId] = id.split('#');
    const parcel = parcels.get(base);
    if (parcel) {
      const e = (entranceId ? parcel.entrances.find(n => n.id === entranceId) : parcel.entrances[0]);
      if (!e) return null;
      return { id, kind: 'parcel', parcelId: parcel.id, x: e.position[0], z: e.position[1], neighborhood: parcel.neighborhood, chunk: chunkIdAt(places, ...e.position) };
    }
    const old = byIdManifest.get(base) || legacy.get(base);
    if (old) {
      const entrance = old.entrance;
      return { id, kind: 'legacy-parcel', parcelId: base, x: entrance[0], z: entrance[1], neighborhood: 'original-block', chunk: chunkIdAt(places, ...entrance) };
    }
    const a = anchors.get(base) || landmarks.get(base);
    if (a) return { id, kind: anchors.has(base) ? 'anchor' : 'landmark', x: a.position[0], z: a.position[1], neighborhood: a.neighborhood, chunk: chunkIdAt(places, ...a.position) };
    return null;
  }
  return { places, parcels, legacy, anchors, landmarks, resolve, neighborhoodAt, chunkIdAt: (x, z) => chunkIdAt(places, x, z) };
}

/* Route anchors → a walkable polyline through the actual collision world (bounded grid A* per leg). */
export function resolveRoute(index, ids, world, { maxVisits = 160000 } = {}) {
  const points = (ids || []).map(id => index.resolve(id)).filter(Boolean);
  if (!points.length) return { ok: false, path: [], missing: ids || [] };
  const missing = (ids || []).filter(id => !index.resolve(id));
  const path = [{ x: points[0].x, z: points[0].z }];
  for (let i = 1; i < points.length; i++) {
    const leg = findWalkingPath(path[path.length - 1], points[i], world, maxVisits);
    if (!leg.length) return { ok: false, path, missing, brokenAt: ids[i] };
    // drop collinear grid steps so a patrol keeps a handful of corners, not hundreds of cells
    for (const p of simplify(leg).slice(1)) path.push(p);
  }
  return { ok: !missing.length, path, missing };
}
function simplify(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/* Lore → runtime view. Lore schema revision 2 keeps the original arrays unchanged and adds parcel-bound records
   in separate arrays (expansionBusinesses, expansionNpcs, expansionItems, families); this merges them into one
   runtime manifest. Every business ends up with position/size/entrance (lore that names a parcelId takes the
   parcel's geometry); parcels no lore has claimed stay generic. Residents get a placement the scene understands:
     'route' (walks routeAnchors)        → 'patrol', starting at the first anchor
     'interior' at a parcel business     → drawn inside that business
     at home (homeParcelId, no business) → standing by their front door ('door')
   The source lore object is never mutated. */
export function bindCity(manifest, places) {
  const index = createPlacesIndex(places, manifest);
  const claimed = new Set();
  const loreBusinesses = [...(manifest.businesses || []), ...(manifest.expansionBusinesses || [])];
  const businesses = loreBusinesses.map(b => {
    if (!b.parcelId || (Array.isArray(b.position) && Array.isArray(b.entrance))) return b;
    const parcel = index.parcels.get(b.parcelId);
    // an unknown parcel, or one another business already holds, is never placed (reported by the publisher and tests)
    if (!parcel || claimed.has(parcel.id)) return null;
    claimed.add(parcel.id);
    return { ...b, position: parcel.footprint.center.slice(), size: [...parcel.footprint.size, parcel.height], entrance: parcel.entrances[0].position.slice(), neighborhood: parcel.neighborhood, front: parcel.front, roof: parcel.roof, use: parcel.use };
  }).filter(Boolean);
  const businessIds = new Set(businesses.map(b => b.id));
  // a household is not a business: its house stays a generic parcel that carries the family's name and lore
  const households = new Map((manifest.families || []).filter(f => f.parcelId).map(f => [f.parcelId, f]));
  const vacant = places.parcels.filter(p => !claimed.has(p.id)).map(p => ({
    id: p.id, name: households.get(p.id)?.name || p.label || p.use, familyId: households.get(p.id)?.id || null, generic: true, use: p.use, neighborhood: p.neighborhood, enterable: !!p.enterable,
    role: p.role || 'parcel', position: p.footprint.center.slice(), size: [...p.footprint.size, p.height], entrance: p.entrances[0].position.slice(), front: p.front, roof: p.roof || 'flat', staffIds: [], itemIds: []
  }));
  // a household's front door is its house parcel; residents stand a step to one side of it
  const homeDoor = (id, k) => { const r = index.resolve(id); return r ? [[Math.round((r.x + (k % 2 ? 1.6 : -1.6)) * 100) / 100, r.z]] : []; };
  const npcs = [...(manifest.npcs || []), ...(manifest.expansionNpcs || [])].map((n, k) => {
    const out = { ...n };
    if (!n.businessId && n.parcelId) {
      const owner = businesses.find(b => b.parcelId === n.parcelId);
      if (owner) out.businessId = owner.id;
    }
    if (Array.isArray(n.route) && n.route.length) return out; // the original 24 keep their authored routes
    const anchors = (n.routeAnchors || []).filter(Boolean);
    if (n.placement === 'route' || (!n.placement && anchors.length > 1)) {
      const first = index.resolve(anchors[0] || n.homeParcelId);
      out.placement = 'patrol'; out.route = first ? [[first.x, first.z]] : [];
    } else if (n.placement === 'interior' && out.businessId && businessIds.has(out.businessId)) {
      out.route = [];
    } else if (n.homeParcelId || n.residenceParcelId) {
      out.placement = 'door'; out.route = homeDoor(n.homeParcelId || n.residenceParcelId, k);
    }
    return out;
  });
  const items = [...(manifest.items || []), ...(manifest.expansionItems || [])];
  return { manifest: { ...manifest, businesses, npcs, items }, vacant, index };
}

/* Patrol polylines for residents who walk between route anchors, resolved against the collision world. */
export function resolveResidentRoutes(bound, world) {
  const out = new Map();
  for (const n of bound.manifest.npcs) {
    if (!n.routeAnchors?.length || n.routeAnchors.length < 2) continue;
    const r = resolveRoute(bound.index, n.routeAnchors, world);
    if (r.path.length) out.set(n.id, r.path.map(p => [p.x, p.z]));
  }
  return out;
}

/* Collision data for the whole city is small (a few dozen rectangles) and always resident, so bodies
   never fall through an unloaded chunk; only render detail streams. */
export function placesCollision(places) {
  const surfaces = places.surfaces.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ }));
  const blockers = places.parcels.map(p => ({ ...footprintBounds(p), id: p.id }));
  return { surfaces, blockers };
}

export function walkableArea(world, bounds, step = 1) {
  let n = 0;
  for (let x = bounds.minX + step / 2; x < bounds.maxX; x += step) for (let z = bounds.minZ + step / 2; z < bounds.maxZ; z += step) if (isWalkable(x, z, world, .05)) n++;
  return n * step * step;
}
