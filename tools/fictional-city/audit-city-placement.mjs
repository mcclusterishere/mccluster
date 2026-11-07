/* Read-only placement audit. Existing metric source and source-attributed address points only.
   node tools/fictional-city/audit-city-placement.mjs > /tmp/city-placement-audit.json */
import { readFile } from 'node:fs/promises';
import { frame } from '../../js/fictional-city/planet/georeference.mjs';
const read = async p => JSON.parse(await readFile(new URL('../../' + p, import.meta.url), 'utf8'));
const places = await read('core/data/fictional-city/places.v1.json');
const district = await read('core/data/fictional-city/district.v1.json');
const institutions = await read('docs/fictional-city/geography/real-institutions.v1.json');
const frameId = 'mccluster-city.bridgeport-equirect.v1', projection = frame(frameId);
const surfaces = [...places.surfaces, ...district.neighborhoods.flatMap(n => n.surfaces)];
const supported = ({ x, z }) => surfaces.some(s => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ);
const overlaps = ({ x, z }) => places.parcels.filter(p => {
  const [cx, cz] = p.footprint.center, [w, d] = p.footprint.size;
  return Math.abs(x - cx) < w / 2 && Math.abs(z - cz) < d / 2;
}).map(p => p.id);
const report = { schema: 'mccluster.city.placement-audit/v1', frameId, sourceMutation: false,
  institutions: institutions.institutions.map(i => {
    const parcel = places.parcels.find(p => p.id === i.loreParcelId), point = projection.toLocal(i.lon, i.lat);
    return { id: i.loreBusinessId, parcelId: i.loreParcelId, current: parcel.footprint.center,
      sourcedPoint: point, separationMeters: Math.hypot(parcel.footprint.center[0] - point.x, parcel.footprint.center[1] - point.z),
      supportedByCurrentLand: supported(point), collidingAuthoredParcelsAtPoint: overlaps(point),
      provenance: i.provenance.lonLat, footprintBinding: i.provenance.footprint.status };
  }),
  surveyedNeighborhoods: district.neighborhoods.map(n => ({ id: n.id, footprintPlaces: n.places.filter(p => p.footprint?.length).length,
    roadPolylines: n.roads.filter(r => r.points?.length).length })),
  jimmys: { source: 'docs/fictional-city/JIMMYS-STOREFRONT-CONTINUATION-2026-11-03.md',
    pointScreenOnlyNotFootprintIntersection: true,
    note: 'Parcel centroid, not a building placement or claim of vacancy/affiliation; the source footprint merges adjoining area.',
    ...(() => { const point = projection.toLocal(-73.188889787733, 41.178156188008); return { point, collidingAuthoredParcelsAtPoint: overlaps(point) }; })() },
  cityTrustBinding: 'No binding found in inspected city source; requires authoritative record, not inferred coordinates.',
  activationPrerequisites: ['versioned metric region/frame plus legacy-save mapping', 'verified parcel and institutional-use binding',
    'owner draft/preview/publish/restore with scoped authorization', 'collision and route parity before activation',
    'topology is a derived square/hex view; do not snap or scale source metric geometry'] };
console.log(JSON.stringify(report, null, 2));
