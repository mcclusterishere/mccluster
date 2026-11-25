#!/usr/bin/env node
/* McCluster Planet, Connecticut pilot — stage 2: deterministic derivation (no network).

     node tools/fictional-city/build-connecticut-region.mjs            # write chunks to data/fictional-city/regions/connecticut-pilot/
     node tools/fictional-city/build-connecticut-region.mjs --write    # also refresh the descriptor's chunkIndex
     node tools/fictional-city/build-connecticut-region.mjs --check    # fail if the descriptor's chunkIndex is stale

   Input: the committed normalized crop(s) from stage 1 (build-connecticut-region.py), listed in
   core/data/fictional-city/regions/connecticut-pilot.v1.json → crops[].source.
   Steps: State Plane → geodetic → city frame (georeference.mjs) → ground/roof heights → simplify → three
   building LODs → 128 m chunks with terrain posts → one JSON file per chunk + an index with byte counts and
   SHA-256. Same input, same bytes: the test suite rebuilds and compares hashes.

   Output is geometry and heights only, under stable source-derived IDs (ct2023:<OBJECTID>). No names, uses,
   addresses or tenants: those are invented by the game and live in the lore, never here. */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctStatePlaneToGeodetic, geodeticToCtStatePlane, frame, US_SURVEY_FOOT } from '../../js/fictional-city/planet/georeference.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DESCRIPTOR = 'core/data/fictional-city/regions/connecticut-pilot.v1.json';
export const CHUNK_SCHEMA = 'mccluster.planet.chunk/v1';
export const CHUNK_M = 128;
export const TERRAIN_POST_M = 4;
const LOD_TOLERANCE_M = [0.15, 1.5, null]; // LOD2 is the minimum-area oriented rectangle
const MIN_HEIGHT_M = 2.5;

const r2 = (v) => Math.round(v * 100) / 100;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

function signedArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; }
function inside(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function openRing(ring) { const r = ring.slice(); const [a, b] = [r[0], r[r.length - 1]]; if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop(); return r; }
function dp(points, tol) { // Douglas–Peucker on an open polyline
  if (points.length < 3) return points;
  const [ax, az] = points[0], [bx, bz] = points[points.length - 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  let best = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) { const d = Math.abs(dz * (points[i][0] - ax) - dx * (points[i][1] - az)) / L; if (d > best) { best = d; idx = i; } }
  if (best <= tol) return [points[0], points[points.length - 1]];
  return dp(points.slice(0, idx + 1), tol).slice(0, -1).concat(dp(points.slice(idx), tol));
}
function simplifyRing(ring, tol) { // anchor at the vertex farthest from the first so the closed ring keeps its extent
  let far = 0, fd = -1;
  ring.forEach((p, i) => { const d = Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = dp(ring.slice(0, far + 1), tol), b = dp(ring.slice(far).concat([ring[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : null;
}
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function orientedRect(pts) { // minimum-area rectangle over hull edge directions
  const h = hull(pts); let best = null;
  for (let i = 0; i < h.length; i++) {
    const [x0, z0] = h[i], [x1, z1] = h[(i + 1) % h.length], L = Math.hypot(x1 - x0, z1 - z0);
    if (!L) continue;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of h) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area - 1e-9) best = { area, ux, uz, a0, a1, b0, b1 };
  }
  const { ux, uz, a0, a1, b0, b1 } = best, P = (a, b) => [a * ux - b * uz, a * uz + b * ux];
  return [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
}
const ccw = (ring) => (signedArea(ring) < 0 ? ring.slice().reverse() : ring); // positive area in (x, z)
const flat = (ring, ox, oz) => ring.flatMap(([x, z]) => [r2(x - ox), r2(z - oz)]);

/** Terrain sampler over the stage-1 grid (State Plane metres, NAVD88 cm). Returns metres or null. */
export function terrainSampler(t) {
  const [x0, y1] = t.originM;
  const at = (c, r) => (c < 0 || r < 0 || c >= t.cols || r >= t.rows ? null : t.heightsCm[r * t.cols + c]);
  return (E, N) => {
    const fc = (E - x0) / t.stepM - 0.5, fr = (y1 - N) / t.stepM - 0.5, c = Math.floor(fc), r = Math.floor(fr), u = fc - c, v = fr - r;
    const q = [at(c, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1)];
    if (q.some((h) => h === null)) { const n = at(Math.round(fc), Math.round(fr)); return n === null ? null : n / 100; }
    return ((q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v) / 100;
  };
}

export function buildRegion(descriptor, sources) {
  const city = frame(descriptor.frame.id);
  const buildings = [], terrains = [];
  for (const crop of descriptor.crops) {
    const src = sources[crop.id];
    if (!src || src.schema !== 'mccluster.planet.source-crop/v1' || src.crop.id !== crop.id) throw new Error('Missing or mismatched source crop: ' + crop.id);
    const sample = terrainSampler(src.terrain);
    const toCity = ([E, N]) => { const g = ctStatePlaneToGeodetic(E, N, 'ftUS'); const p = city.toLocalExact(g.lon, g.lat); return [p.x, p.z]; };
    const [W, S, E, N] = src.crop.bbox;
    const a = city.toLocalExact(W, N), b = city.toLocalExact(E, S);
    terrains.push({ crop: crop.id, sample, bounds: { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z }, city });
    for (const f of src.footprints) {
      const ringFt = openRing(f.ring), ring = ccw(ringFt.map(toCity));
      // ground: median DEM post inside the footprint (State Plane metres), else bilinear at the centroid
      const ringM = ringFt.map(([e, n]) => [e * US_SURVEY_FOOT, n * US_SURVEY_FOOT]);
      const t = src.terrain, posts = [];
      const xs = ringM.map((p) => p[0]), ys = ringM.map((p) => p[1]);
      for (let r = 0; r < t.rows; r++) {
        const n = t.originM[1] - (r + 0.5) * t.stepM; if (n < Math.min(...ys) || n > Math.max(...ys)) continue;
        for (let c = 0; c < t.cols; c++) {
          const e = t.originM[0] + (c + 0.5) * t.stepM; if (e < Math.min(...xs) || e > Math.max(...xs)) continue;
          const h = t.heightsCm[r * t.cols + c]; if (h !== null && inside(e, n, ringM)) posts.push(h / 100);
        }
      }
      const cx = ringM.reduce((s, p) => s + p[0], 0) / ringM.length, cy = ringM.reduce((s, p) => s + p[1], 0) / ringM.length;
      const groundY = posts.length ? median(posts) : sample(cx, cy);
      const lidar = f.roof && Number.isFinite(f.roof.p95Ft);
      const roofY = lidar ? f.roof.p95Ft * US_SURVEY_FOOT : groundY + descriptor.heightProvenance.fallbackHeightM;
      const heightM = Math.max(MIN_HEIGHT_M, roofY - groundY);
      const lods = LOD_TOLERANCE_M.map((tol) => (tol === null ? null : simplifyRing(ring, tol)));
      lods[2] = ccw(orientedRect(ring));
      if (!lods[1]) lods[1] = lods[2];
      const c = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      buildings.push({
        id: `${descriptor.idNamespace}:${f.sourceId}`, globalId: f.globalId, crop: crop.id, c, lods,
        groundY: r2(groundY), roofY: r2(groundY + heightM), heightM: r2(heightM),
        heightSource: lidar ? 'lidar-2023-3d-buildings' : 'estimated-default',
        baseY: lidar ? r2(f.roof.baseFt * US_SURVEY_FOOT) : null,
        holes: (f.holes || []).length
      });
    }
  }
  const ids = new Set();
  for (const b of buildings) { if (ids.has(b.id)) throw new Error('Duplicate building ID ' + b.id); ids.add(b.id); }

  // chunk assignment by building centroid; terrain for every chunk touching a crop
  const key = (x, z) => `${Math.floor(x / CHUNK_M)}_${Math.floor(z / CHUNK_M)}`;
  const chunks = new Map();
  const get = (k) => { if (!chunks.has(k)) chunks.set(k, { k, buildings: [] }); return chunks.get(k); };
  for (const b of buildings) get(key(...b.c)).buildings.push(b);
  for (const t of terrains) {
    for (let cx = Math.floor(t.bounds.minX / CHUNK_M); cx * CHUNK_M < t.bounds.maxX; cx++)
      for (let cz = Math.floor(t.bounds.minZ / CHUNK_M); cz * CHUNK_M < t.bounds.maxZ; cz++) get(`${cx}_${cz}`);
  }
  const files = [];
  for (const ch of [...chunks.values()].sort((p, q) => (p.k < q.k ? -1 : p.k > q.k ? 1 : 0))) {
    const [cx, cz] = ch.k.split('_').map(Number), ox = cx * CHUNK_M, oz = cz * CHUNK_M, n = CHUNK_M / TERRAIN_POST_M + 1;
    const heights = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = ox + c * TERRAIN_POST_M, z = oz + r * TERRAIN_POST_M;
      const t = terrains.find((q) => x >= q.bounds.minX && x <= q.bounds.maxX && z >= q.bounds.minZ && z <= q.bounds.maxZ);
      if (!t) { heights.push(null); continue; }
      const g = t.city.toGeodetic(x, 0, z), m = geodeticToCtStatePlane(g.lon, g.lat, 'm'), h = t.sample(m.E, m.N);
      heights.push(h === null ? null : Math.round(h * 100));
    }
    const body = {
      schema: CHUNK_SCHEMA, region: descriptor.id, id: `${descriptor.chunkPrefix}${ch.k}`, frame: descriptor.frame.id,
      originM: [ox, oz], sizeM: CHUNK_M,
      units: { xz: 'metres relative to originM (city frame: +X east, +Z south), 0.01 m', y: 'NAVD88 metres', terrain: 'NAVD88 centimetres, row-major from originM, +X then +Z' },
      buildings: ch.buildings.sort((p, q) => (p.id < q.id ? -1 : 1)).map((b) => ({
        id: b.id, sourceGlobalId: b.globalId, crop: b.crop, centroid: [r2(b.c[0] - ox), r2(b.c[1] - oz)],
        groundY: b.groundY, roofY: b.roofY, heightM: b.heightM, heightSource: b.heightSource, baseY: b.baseY,
        lod: b.lods.map((ring) => flat(ring, ox, oz))
      })),
      terrain: { postM: TERRAIN_POST_M, cols: n, rows: n, heightsCm: heights }
    };
    const bytes = Buffer.from(JSON.stringify(body) + '\n');
    files.push({ id: body.id, path: `${descriptor.chunkPrefix}${ch.k}.json`, body, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), gzipBytes: gzipSync(bytes, { level: 9 }).length });
  }
  const tri = (ring) => (ring.length / 2) * 2 + Math.max(0, ring.length / 2 - 2); // walls + roof fan
  const index = {
    chunkSizeM: CHUNK_M, terrainPostM: TERRAIN_POST_M, lods: ['lod0 Douglas–Peucker 0.15 m', 'lod1 Douglas–Peucker 1.5 m', 'lod2 minimum-area oriented rectangle'],
    builder: 'tools/fictional-city/build-connecticut-region.mjs',
    sourceSha256: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.sha256])),
    chunks: files.map((f) => ({ id: f.id, path: f.path, origin: f.body.originM, buildings: f.body.buildings.length, bytes: f.bytes.length, gzipBytes: f.gzipBytes, sha256: f.sha256 })),
    totals: {
      chunks: files.length, buildings: buildings.length,
      lidarHeights: buildings.filter((b) => b.heightSource.startsWith('lidar')).length,
      bytes: files.reduce((s, f) => s + f.bytes.length, 0), gzipBytes: files.reduce((s, f) => s + f.gzipBytes, 0),
      lod0Triangles: files.reduce((s, f) => s + f.body.buildings.reduce((t, b) => t + tri(b.lod[0]), 0), 0),
      lod2Triangles: files.reduce((s, f) => s + f.body.buildings.reduce((t, b) => t + tri(b.lod[2]), 0), 0)
    }
  };
  return { index, files, buildings };
}

export function loadInputs(root = ROOT) {
  const descriptor = JSON.parse(readFileSync(resolve(root, DESCRIPTOR), 'utf8'));
  const sources = {};
  for (const crop of descriptor.crops) {
    const bytes = readFileSync(resolve(root, crop.source));
    sources[crop.id] = { ...JSON.parse(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return { descriptor, sources };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const { descriptor, sources } = loadInputs();
  const { index, files } = buildRegion(descriptor, sources);
  if (args.has('--check')) {
    if (JSON.stringify(descriptor.chunkIndex) !== JSON.stringify(index)) { console.error('chunkIndex is stale: run with --write'); process.exit(1); }
  } else {
    const out = resolve(ROOT, 'data/fictional-city/regions', descriptor.id);
    rmSync(out, { recursive: true, force: true }); // regenerate whole: no stale chunk survives
    mkdirSync(out, { recursive: true });
    for (const f of files) writeFileSync(resolve(out, f.path), f.bytes);
    writeFileSync(resolve(out, 'index.v1.json'), JSON.stringify({ schema: 'mccluster.planet.chunk-index/v1', region: descriptor.id, frame: descriptor.frame.id, ...index }) + '\n');
    if (args.has('--write')) {
      descriptor.chunkIndex = index;
      writeFileSync(resolve(ROOT, DESCRIPTOR), JSON.stringify(descriptor, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify(index.totals));
}
