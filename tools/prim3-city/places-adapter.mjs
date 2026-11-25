/* PRIM3 city levels → the McCluster City places contract (places.v1.json shape).

   The bridge between #711's OpenStreetMap converter (city-grid.mjs) and the city's placement authority, so a
   real-geometry level and the authored city speak one schema: surfaces, parcels with footprints, entrances,
   heights with provenance, and chunk IDs. Used today for converter verification on the committed Jersey City
   sample (it stays labelled Jersey City). It is not a source of playable McCluster City geography.

   OSM supplies geometry only. Real names, addresses and businesses are dropped here: a parcel gets a synthetic
   ID (`<area>/B12`), its OSM element reference and how its height was obtained (tagged height, levels × storey,
   or a per-type default estimate). Any output is a derivative database of OpenStreetMap: ODbL 1.0, attribution
   "© OpenStreetMap contributors", share-alike (owner accepted ODbL for city levels, 2026-11-03).

   Frame: city metres centred on the extract's grid, +X east, +Z south (tile y grows south as +Z does). */
import { TILE_M } from '../../js/prim3-tactics/scale.mjs';

export function osmLevelToPlaces(level, { area = level.LEVEL_ID.replace(/^city-/, ''), chunkMeters = 64 } = {}) {
  const { W, H, grids } = level;
  if (!grids?.owner || !grids?.kind) throw new Error('Pass the live level from buildCityLevel(), not its JSON (typed grids are needed).');
  const tileM = level.TILE_M || TILE_M;
  const X = tx => (tx - W / 2) * tileM, Z = ty => (ty - H / 2) * tileM;
  const boxes = new Map();
  for (let k = 0; k < W * H; k++) {
    const o = grids.owner[k]; if (o < 0) continue;
    const x = k % W, y = (k - x) / W, b = boxes.get(o) || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
    boxes.set(o, b);
  }
  const r2 = v => Math.round(v * 100) / 100;
  const chunk = (x, z) => `c${Math.floor(x / chunkMeters)}_${Math.floor(z / chunkMeters)}`;
  const parcels = [];
  for (const [i, b] of boxes) {
    const bld = level.SCENE.buildings[i];
    const minX = X(b.minX), maxX = X(b.maxX + 1), minZ = Z(b.minY), maxZ = Z(b.maxY + 1);
    const cx = r2((minX + maxX) / 2), cz = r2((minZ + maxZ) / 2);
    // entrance: the first street tile beside the footprint, scanning south, east, north, west
    let entrance = null;
    const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grids.kind[y * W + x] !== 6 && grids.kind[y * W + x] !== 4;
    for (const [x, y] of [[Math.round((b.minX + b.maxX) / 2), b.maxY + 1], [b.maxX + 1, Math.round((b.minY + b.maxY) / 2)], [Math.round((b.minX + b.maxX) / 2), b.minY - 1], [b.minX - 1, Math.round((b.minY + b.maxY) / 2)]]) {
      if (open(x, y)) { entrance = [r2(X(x + .5)), r2(Z(y + .5))]; break; }
    }
    parcels.push({
      id: `${area}/${bld.id.toLowerCase()}`, neighborhood: area, use: 'osm-building', footprint: { center: [cx, cz], size: [r2(maxX - minX), r2(maxZ - minZ)] },
      height: bld.h, front: 'south', entrances: entrance ? [{ id: 'main', position: entrance }] : [], chunk: chunk(cx, cz),
      provenance: { source: 'osm', element: bld.osm, heightSource: bld.heightSource, storeys: bld.storeys, tiles: bld.tiles }
    });
  }
  // land: row runs of tiles that are neither water nor building interior
  const surfaces = [];
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const land = x < W && grids.kind[y * W + x] !== 4;
      if (land && start < 0) start = x;
      if (!land && start >= 0) { surfaces.push({ id: `land-${y}-${start}`, minX: r2(X(start)), maxX: r2(X(x)), minZ: r2(Z(y)), maxZ: r2(Z(y + 1)), kind: 'land' }); start = -1; }
    }
  }
  const bounds = { minX: r2(X(0)), maxX: r2(X(W)), minZ: r2(Z(0)), maxZ: r2(Z(H)) };
  return {
    schema: 'mccluster.fictional-city.places/v1', id: `osm-${area}`, revision: level.geo?.fetchedAt || 'sample',
    authority: 'Converter verification sample. OSM geometry only; no real names or uses.',
    frame: { units: 'metres', axes: '+X east, +Z south (north is -Z), +Y up', origin: 'centre of the extract grid', groundY: 0, chunkMeters, bounds, tactical: { origin: [bounds.minX, bounds.minZ] } },
    geography: { source: 'osm', licence: 'ODbL-1.0', attribution: level.attribution, bbox: level.geo?.bbox, heights: 'per-parcel provenance.heightSource' },
    neighborhoods: [{ id: area, name: level.title || area, kind: 'osm-sample', bounds, status: 'sample' }],
    surfaces, streets: [], legacyParcels: [], parcels, anchors: [], landmarks: [], parks: []
  };
}
