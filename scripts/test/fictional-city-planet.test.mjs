import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_POINTS, FRAMES, SCALE_CONTRACTS, M_PER_DEG, frame, createEnuFrame, createEquirectFrame, createFloatingOrigin,
  geodeticToEcef, ecefToGeodetic, geodeticToCtStatePlane, ctStatePlaneToGeodetic, metresToTacticsTiles
} from '../../js/fictional-city/planet/georeference.mjs';
import { TILE_M } from '../../js/prim3-tactics/scale.mjs';
import { buildRegion, loadInputs, DESCRIPTOR, CHUNK_M } from '../../tools/fictional-city/build-connecticut-region.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { descriptor, sources } = loadInputs(ROOT);
const built = buildRegion(descriptor, sources);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('CT State Plane conversions match independent PROJ control points to the millimetre', () => {
  for (const c of CONTROL_POINTS) {
    const ft = geodeticToCtStatePlane(c.lon, c.lat, 'ftUS'), m = geodeticToCtStatePlane(c.lon, c.lat);
    near(ft.E, c.spcsFtUS[0], 0.003, c.id + ' E ft'); near(ft.N, c.spcsFtUS[1], 0.003, c.id + ' N ft');
    near(m.E, c.spcsM[0], 0.001, c.id + ' E m'); near(m.N, c.spcsM[1], 0.001, c.id + ' N m');
    const back = ctStatePlaneToGeodetic(c.spcsFtUS[0], c.spcsFtUS[1], 'ftUS');
    near(back.lon, c.lon, 1e-8, c.id + ' lon'); near(back.lat, c.lat, 1e-8, c.id + ' lat');
    const e = geodeticToEcef(c.lon, c.lat, 10);
    e.forEach((v, i) => near(v, c.ecefH10[i], 0.001, c.id + ' ecef' + i));
    const g = ecefToGeodetic(...e);
    near(g.lon, c.lon, 1e-10, 'ecef lon'); near(g.lat, c.lat, 1e-10, 'ecef lat'); near(g.h, 10, 1e-4, 'ecef h');
  }
});

test('ENU frame round-trips and uses the city axes (+X east, +Y up, +Z south)', () => {
  const enu = createEnuFrame({ lon: -73.1903, lat: 41.1798 });
  const east = enu.toLocal(-73.1893, 41.1798), north = enu.toLocal(-73.1903, 41.1808), up = enu.toLocal(-73.1903, 41.1798, 25);
  assert.ok(east.x > 80 && Math.abs(east.z) < 0.1, 'east is +X');
  assert.ok(north.z < -110 && Math.abs(north.x) < 0.1, 'north is -Z');
  near(up.y, 25, 1e-6, 'up is +Y');
  for (const [x, y, z] of [[0, 0, 0], [1500, 12, -900], [-2500.25, -3, 2200.5]]) {
    const g = enu.toGeodetic(x, y, z), p = enu.toLocal(g.lon, g.lat, g.h);
    near(p.x, x, 1e-6, 'x'); near(p.y, y, 1e-6, 'y'); near(p.z, z, 1e-6, 'z');
  }
});

test('the named owner projection is expressed exactly, rounded to 4 dp, and invertible', () => {
  const spec = FRAMES['mccluster-city.bridgeport-equirect.v1'];
  assert.deepEqual([spec.lon0, spec.lat0, spec.zOffset, spec.xOffset, spec.decimals], [-73.1903, 41.1798, -220, 0, 4]);
  const f = frame(spec.id);
  for (const [lon, lat] of [[-73.1921, 41.1808], [-73.1885, 41.1788], [-73.18397, 41.17582], [-73.1903, 41.1798]]) {
    const want = (v) => Math.round(v * 1e4) / 1e4;
    const p = f.toLocal(lon, lat);
    assert.equal(p.x, want((lon - -73.1903) * 111320 * Math.cos(41.1798 * Math.PI / 180)));
    assert.equal(p.z, want(-(lat - 41.1798) * 111320 - 220));
    const g = f.toGeodetic(p.x, 0, p.z);
    near(g.lon, lon, 2e-9, 'lon back'); near(g.lat, lat, 2e-9, 'lat back');
  }
  assert.deepEqual(f.toLocal(-73.1903, 41.1798), { x: 0, y: 0, z: -220 });
  assert.equal(M_PER_DEG, 111320);
  assert.throws(() => frame('no-such-frame'));
  // the approximation against the ENU tangent plane: bounded, documented, never silently "corrected"
  const enu = createEnuFrame({ lon: -73.1903, lat: 41.1798 });
  for (const [dx, dz] of [[2000, 0], [0, 2000], [-1500, -1500], [600, 900]]) {
    const g = f.toGeodetic(dx, 0, dz - 220), p = enu.toLocal(g.lon, g.lat);
    const err = Math.hypot(p.x - dx, p.z - dz), dist = Math.hypot(dx, dz);
    assert.ok(err / dist < 0.0035, `equirect vs ENU ${err} m over ${dist} m`);
  }
  // a second configuration can be expressed without new code
  const g2 = createEquirectFrame({ id: 'test', lon0: -72.9279, lat0: 41.3083, zOffset: 10 });
  assert.deepEqual(g2.toLocal(-72.9279, 41.3083), { x: 0, y: 0, z: 10 });
});

test('floating origin rebases in whole steps and never moves world positions', () => {
  const fo = createFloatingOrigin({ threshold: 512, step: 128 });
  assert.equal(fo.update(100, -300), null);
  const shift = fo.update(700, -300);
  assert.deepEqual(shift, { x: 640, z: -256 });
  assert.deepEqual(fo.toRender(700, 2, -300), { x: 60, y: 2, z: -44 });
  assert.deepEqual(fo.toWorld(60, 2, -44), { x: 700, y: 2, z: -300 });
});

test('scale contracts stay distinct and come from their owners', () => {
  assert.equal(SCALE_CONTRACTS.tacticsTileM, TILE_M);
  assert.equal(TILE_M, 3.54);
  const hqCellM = 12 * 0.3048; // the HQ display cell, owned by the HQ tactical level module
  assert.notEqual(hqCellM, TILE_M);
  near(metresToTacticsTiles(3.54 * 4), 4, 1e-12, 'tiles');
  const src = readFileSync(join(ROOT, 'js/fictional-city/planet/georeference.mjs'), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/prim3-tactics\/scale\.mjs'/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /3\.54\b|3\.6576/, 'no copied tile/cell constants in code');
});

test('region descriptor: schema, sources with licence and capture dates, crops, overlay and budgets', () => {
  const d = descriptor;
  assert.equal(d.schema, 'mccluster.planet.region/v1');
  assert.equal(d.id, 'connecticut-pilot');
  assert.equal(d.idNamespace, 'ct2023');
  assert.ok(FRAMES[d.frame.id], 'frame is a named georeference configuration');
  for (const s of d.sources.filter((x) => x.id !== 'osm')) {
    for (const k of ['title', 'publisher', 'url', 'licence', 'capture', 'published', 'verified']) assert.ok(s[k], `${s.id}.${k}`);
    assert.match(s.capture.begin, /^2023-\d\d-\d\d$/); assert.match(s.capture.end, /^2023-\d\d-\d\d$/);
  }
  assert.match(d.sources.find((s) => s.id === 'ct-eco-2023-3d-buildings').licence, /CC0/);
  assert.match(d.sources.find((s) => s.id === 'osm').licence, /ODbL 1\.0/);
  const sw = d.bounds.statewide, f = frame(d.frame.id);
  for (const c of d.crops) {
    const [W, S, E, N] = c.bbox;
    assert.ok(W >= sw.west && E <= sw.east && S >= sw.south && N <= sw.north, 'crop inside Connecticut');
    assert.ok((E - W) * 84000 < 1500 && (N - S) * 111320 < 1500, 'crop stays small');
    const a = f.toLocal(W, N), b = f.toLocal(E, S);
    assert.deepEqual(c.cityBounds, { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z });
    assert.ok(statSync(join(ROOT, c.source)).size < 1_000_000, 'committed source crop stays small');
    for (const m of d.authoredOverlay.mask) {
      const overlap = c.cityBounds.minX < m.maxX && c.cityBounds.maxX > m.minX && c.cityBounds.minZ < m.maxZ && c.cityBounds.maxZ > m.minZ;
      assert.ok(!overlap, `${c.id} must not overlap authored mask ${m.id}`);
    }
  }
  const o = d.authoredOverlay, island = o.anchor.hqIslandCentre, auth = o.mask.find((m) => m.id === 'authored-district');
  assert.match(o.status, /proposal/); assert.match(o.statement, /not surveyed|does not contain/);
  assert.ok(island.x >= auth.minX && island.x <= auth.maxX && island.z >= auth.minZ && island.z <= auth.maxZ);
  const ig = f.toGeodetic(island.x, 0, island.z);
  near(ig.lon, island.lon, 1e-6, 'island lon'); near(ig.lat, island.lat, 1e-6, 'island lat');
  const gauge = d.environment.noaaCoops, gp = f.toLocal(gauge.lon, gauge.lat);
  assert.deepEqual([gp.x, gp.z], [gauge.city.x, gauge.city.z]);
  for (const k of ['firstDistrictCompressedBytes', 'visualChunkCompressedBytes', 'drawCalls', 'visibleTriangles', 'geometryCacheBytes', 'textureCacheBytes']) assert.ok(d.budgets[k] > 0, k);
});

test('chunk index in the descriptor is exactly what the builder produces, and rebuilds are byte-identical', () => {
  const again = buildRegion(descriptor, sources);
  assert.deepEqual(again.index, built.index);
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.chunkIndex)), JSON.parse(JSON.stringify(built.index)),
    'descriptor chunkIndex is stale: run node tools/fictional-city/build-connecticut-region.mjs --write');
  for (const f of built.files) {
    assert.equal(f.body.schema, 'mccluster.planet.chunk/v1');
    assert.equal(f.body.sizeM, CHUNK_M);
    assert.ok(f.body.originM.every((v) => Number.isInteger(v / CHUNK_M)), 'chunk origin on the grid');
    for (const b of f.body.buildings) {
      const [x, z] = b.centroid; assert.ok(x >= 0 && x < CHUNK_M && z >= 0 && z < CHUNK_M, b.id + ' centroid inside its chunk');
    }
  }
});

test('building IDs are stable, namespaced source IDs that survive input reordering and removals', () => {
  const src = sources['bridgeport-harbor-west'];
  const ids = built.buildings.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, src.footprints.length);
  for (const b of built.buildings) assert.match(b.id, /^ct2023:\d+$/);
  assert.deepEqual(new Set(ids), new Set(src.footprints.map((f) => 'ct2023:' + f.sourceId)));
  assert.equal(new Set(built.buildings.map((b) => b.globalId)).size, ids.length);
  // reorder + drop one footprint: every other building keeps its ID and identical derived geometry
  const shuffled = { ...src, footprints: [...src.footprints].reverse().slice(1) };
  const dropped = 'ct2023:' + src.footprints.at(-1).sourceId;
  const re = buildRegion(descriptor, { ...sources, 'bridgeport-harbor-west': shuffled });
  const byId = new Map(re.buildings.map((b) => [b.id, b]));
  assert.ok(!byId.has(dropped));
  for (const b of built.buildings) if (b.id !== dropped) assert.deepEqual(byId.get(b.id), b, b.id);
});

test('height provenance is explicit per building', () => {
  const allowed = new Set(['lidar-2023-3d-buildings', 'estimated-default']);
  for (const f of built.files) for (const b of f.body.buildings) {
    assert.ok(allowed.has(b.heightSource), b.heightSource);
    assert.ok(b.heightM >= descriptor.heightProvenance.minimumHeightM && b.heightM < 200, b.id + ' height');
    near(b.roofY - b.groundY, b.heightM, 0.011, b.id + ' roof - ground');
    assert.equal(b.lod.length, 3);
    assert.equal(b.lod[2].length, 8, 'LOD2 is a rectangle');
    assert.ok(b.lod[0].length >= b.lod[1].length && b.lod[1].length >= 6, 'LODs simplify monotonically');
  }
  assert.equal(built.index.totals.lidarHeights, built.buildings.filter((b) => b.heightSource.startsWith('lidar')).length);
});

test('scrub: published geometry carries no names, addresses, tenants or POIs', () => {
  const forbiddenKey = /^(name|names|addr.*|address|street|housenumber|brand|shop|amenity|operator|owner|tenant|occupant|business|phone|website|email|tags?|label|title|description)$/i;
  const okString = /^(ct2023:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|bridgeport-harbor-west|connecticut-pilot|ctp_-?\d+_-?\d+|mccluster\.planet\.chunk\/v1|mccluster-city\.bridgeport-equirect\.v1|lidar-2023-3d-buildings|estimated-default)$/;
  const walk = (v, path, strict) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, path + '[' + i + ']', strict));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => { assert.doesNotMatch(k, forbiddenKey, path + '.' + k); walk(x, path + '.' + k, strict); });
    if (typeof v === 'string' && strict) assert.match(v, okString, `unexpected string at ${path}: ${v}`);
  };
  for (const f of built.files) { walk(f.body.buildings, f.id + '.buildings', true); walk(f.body, f.id, false); }
  const src = sources['bridgeport-harbor-west'];
  walk(src.footprints, 'source.footprints', true);
  for (const f of src.footprints) assert.deepEqual(Object.keys(f).sort(), ['areaSqFt', 'globalId', 'holes', 'ring', 'roof', 'sourceId']);
  assert.deepEqual(src.sources['ct-gis-2023-buildings-2d'].fieldsKept, ['OBJECTID', 'GlobalID']);
});

test('budget: the crop fits the first-district and per-chunk targets', () => {
  const t = built.index.totals, b = descriptor.budgets;
  assert.ok(t.gzipBytes <= b.firstDistrictCompressedBytes, `${t.gzipBytes} compressed bytes`);
  for (const c of built.index.chunks) assert.ok(c.gzipBytes <= b.visualChunkCompressedBytes, c.id);
  assert.ok(t.lod0Triangles <= b.visibleTriangles, 'LOD0 of the whole crop fits the visible-triangle target');
  assert.ok(t.lod2Triangles < t.lod0Triangles);
  assert.equal(t.chunks, built.files.length);
});

test('derived chunks stay out of git; the descriptor and source crop are tracked inputs', () => {
  // check-ignore exits 0 only when the path is ignored
  execFileSync('git', ['check-ignore', '-q', '--no-index', 'data/fictional-city/regions/connecticut-pilot/ctp_0_3.json'], { cwd: ROOT, stdio: 'pipe' });
  for (const tracked of [DESCRIPTOR, descriptor.crops[0].source]) {
    assert.throws(() => execFileSync('git', ['check-ignore', '-q', '--no-index', tracked], { cwd: ROOT, stdio: 'pipe' }), tracked + ' must not be ignored');
  }
  assert.equal(DESCRIPTOR, 'core/data/fictional-city/regions/connecticut-pilot.v1.json');
});
