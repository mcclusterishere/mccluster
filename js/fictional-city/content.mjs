/* Shared authored-city selectors. New neighborhoods extend the existing city without
   becoming real businesses, new universes, or a second source of lore. */
export const neighborhoods = manifest => manifest.neighborhoods || [];
export const cityPlaces = manifest => [...manifest.businesses, manifest.garage, ...neighborhoods(manifest).flatMap(n => n.places || [])];
export const storyArcs = manifest => manifest.storyArcs || [];
export const citySurfaces = manifest => neighborhoods(manifest).flatMap(n => n.surfaces || []);
export const storyBeat = (manifest, id) => {
  for (const arc of storyArcs(manifest)) {
    const index = arc.beats.findIndex(beat => beat.id === id);
    if (index >= 0) return { arc, beat: arc.beats[index], index };
  }
  return null;
};
export const neighborhoodAt = (manifest, position) => neighborhoods(manifest).find(n =>
  n.places.some(p => p.id === position.interior) || n.surfaces.some(s =>
    position.x >= s.minX && position.x <= s.maxX && position.z >= s.minZ && position.z <= s.maxZ));

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const point = p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && Math.abs(v) < 5000);
const bounds = s => s && ['minX', 'maxX', 'minZ', 'maxZ'].every(k => Number.isFinite(s[k]) && Math.abs(s[k]) < 5000) && s.minX < s.maxX && s.minZ < s.maxZ;
const assert = (valid, message) => { if (!valid) throw new Error('Invalid city extension: ' + message); };

export function validateCityExtensions(manifest) {
  const areas = neighborhoods(manifest), arcs = storyArcs(manifest);
  assert(Array.isArray(areas) && areas.length <= 12, 'neighborhoods');
  assert(Array.isArray(arcs) && arcs.length <= 24, 'story arcs');
  const placeIds = new Set([...manifest.businesses, manifest.garage].map(p => p.id));
  const areaIds = new Set(), arcIds = new Set(), beatIds = new Set();
  for (const area of areas) {
    assert(ID.test(area.id) && !areaIds.has(area.id), 'neighborhood id'); areaIds.add(area.id);
    assert(typeof area.name === 'string' && point(area.spawn), 'neighborhood name/spawn');
    assert(bounds(area.bounds) && Array.isArray(area.surfaces) && area.surfaces.length > 0 && area.surfaces.length <= 32 && area.surfaces.every(bounds), 'walk surfaces');
    assert(Array.isArray(area.roads) && area.roads.length <= 64, 'roads');
    for (const road of area.roads) {
      assert(Number.isFinite(road.width) && road.width > 0 && road.width < 100, 'road width');
      assert(road.points ? Array.isArray(road.points) && road.points.length >= 2 && road.points.every(point)
        : point([road.x, road.z]) && Number.isFinite(road.depth) && road.depth > 0 && road.depth < 2000, 'road geometry');
    }
    assert(Array.isArray(area.places) && area.places.length <= 120, 'places');
    for (const place of area.places) {
      assert(ID.test(place.id) && !placeIds.has(place.id), 'place id'); placeIds.add(place.id);
      assert(typeof place.name === 'string' && place.name.length > 0 && point(place.position) && point(place.entrance), 'place location');
      assert(Array.isArray(place.size) && place.size.length === 3 && place.size.every(v => Number.isFinite(v) && v > 0 && v < 1000), 'place size');
      assert(Array.isArray(place.staffIds) && Array.isArray(place.itemIds), 'place references');
      if (place.sourceParcel?.ownershipClassification === 'government') assert(place.publicIdentity?.kind === 'government', 'government identity');
      if (place.publicIdentity?.kind === 'government') {
        assert(place.name === place.publicIdentity.officialName && typeof place.publicIdentity.publicFunction === 'string' &&
          typeof place.publicIdentity.sourceUrl === 'string', 'government identity');
      }
      if (place.footprint) assert(Array.isArray(place.footprint) && place.footprint.length >= 3 && place.footprint.length <= 3000 && place.footprint.every(point), 'footprint');
      if (place.footprintHoles) assert(Array.isArray(place.footprintHoles) && place.footprintHoles.every(r => Array.isArray(r) && r.length >= 3 && r.every(point)), 'footprint holes');
    }
  }
  for (const arc of arcs) {
    assert(ID.test(arc.id) && !arcIds.has(arc.id), 'arc id'); arcIds.add(arc.id);
    assert(typeof arc.title === 'string' && Array.isArray(arc.beats) && arc.beats.length > 0 && arc.beats.length <= 80, 'arc beats');
    for (const beat of arc.beats) {
      assert(ID.test(beat.id) && !beatIds.has(beat.id), 'beat id'); beatIds.add(beat.id);
      assert(placeIds.has(beat.placeId) && point(beat.position), 'beat location');
      assert(typeof beat.title === 'string' && Array.isArray(beat.paragraphs) && beat.paragraphs.every(p => typeof p === 'string'), 'beat text');
    }
  }
  for (const area of areas) for (const place of area.places) {
    if (place.storyArcId) assert(arcIds.has(place.storyArcId), 'place story arc');
    if (place.storyBeatIds) assert(place.storyBeatIds.every(id => beatIds.has(id)), 'place story beats');
  }
  return true;
}
