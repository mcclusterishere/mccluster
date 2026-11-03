/* PRIM3 city levels — real-city footprints and heights → the PRIM3 tactical grid.

   Pure and deterministic (no DOM, no three.js): the same extract always gives the same level, so the
   page, the tests and an OVH Core batch job all produce identical bytes. Input is an extract written by
   fetch-osm-extract.mjs (OpenStreetMap, ODbL); output is level data in the shape the tactics levels use
   (W, H, FLOORS, FRAME, SCENE, MISSION, engineConfig) — see docs/prim3/CITY-LEVELS-RESEARCH.md.

   Coordinate frame
     A local east/north tangent plane at the centre of the extract's bbox (equirectangular; under
     1 km the error is far below a tile). The grid is centred on the box. Engine tiles follow the
     tactics convention: x grows west → east, y grows north → south. Players read signed coordinates
     through FRAME (X = x − x0, Y = y0 − y, north is +Y), as in levels/transit-relay.mjs.
   Scale
     One tile = TILE_M = 3.54 m (js/prim3-tactics/scale.mjs, owner 2026-11-03). Heights stay metres.
   Footprints
     A polygon covers a tile when the tile's centre is inside it (even-odd, so courtyards stay open).
     A footprint that covers no centre takes the tile under its centroid, so no building disappears.
   Heights
     OSM `height` (metres, or feet with ' / ft), else `building:levels` (+ `roof:levels`) × STOREY_M,
     else a per-type default. Every building records which of the three it came from.
     `building:part`s override their outline where they cover it (OSM Simple 3D Buildings).
   Rules layers
     z0 is the street. Building tiles are z0 blockers as tall as the building (they block sight).
     Water is a z0 blocker of height 0 (no walking, sight passes), as the canal in Transit / Relay.
     Every roof is a walkable surface. Adjacent roof tiles within ROOF_JOIN_M of each other form one
     roof patch; adjacent patches that differ more than that get different z (a greedy colouring), so
     the resolver — which walks freely between same-z neighbours — never lets anyone step up a
     30 m wall. z is a roof LAYER, not a storey.
   Links
     A fire-escape ladder from the street to every roof patch no taller than GROUND_ACCESS_MAX_M,
     and a short ladder between adjacent roof patches within ROOF_STEP_MAX_M of each other.
     Taller roofs are reachable only once interiors (lobbies, stairs, lifts) are modelled. */

export const TILE_M = 3.54;          // mirrors js/prim3-tactics/scale.mjs
export const STOREY_M = 3.2;         // assumed floor-to-floor when only levels are tagged
export const ROOF_JOIN_M = 0.75;     // neighbouring roof tiles closer than this are one walkable roof
export const GROUND_ACCESS_MAX_M = 18;
export const ROOF_STEP_MAX_M = 4.5;
export const FLOATING_PART_M = 3;    // a part starting this high (an overhang, a bridge) does not block the street
const EARTH_R = 6378137;
const FT = 0.3048, IN = 0.0254;

export const KIND = { ground: '.', road: 'r', walk: 'w', park: 'p', water: '~', pier: 'P', building: '#' };
const KIND_CODE = { '.': 0, r: 1, w: 2, p: 3, '~': 4, P: 5, '#': 6 };
const CODE_KIND = ['.', 'r', 'w', 'p', '~', 'P', '#'];

// storeys assumed when a building has neither height nor levels (OSM building=* value → storeys)
export const DEFAULT_STOREYS = {
  yes: 3, house: 2, detached: 2, semidetached_house: 2, terrace: 3, residential: 3, apartments: 5,
  commercial: 3, retail: 1, office: 6, hotel: 8, industrial: 2, warehouse: 2, garage: 1, garages: 1,
  shed: 1, roof: 1, kiosk: 1, school: 3, church: 3, transportation: 2, government: 4, museum: 3,
  construction: 3, parking: 4
};

/* ---------- tags → metres ---------- */
// "30", "30 m", "30m", "30.5", "30,5", "100'", "100 ft", "12'6\"" → metres; anything else → null
export function parseLength(raw) {
  if (raw == null) return null;
  const s = String(raw).split(';')[0].trim().toLowerCase().replace(/(\d),(\d)/, '$1.$2');
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in))?$/);
  if (m) return Number(m[1]) * FT + (m[2] ? Number(m[2]) * IN : 0);
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:m|metres|meters)?$/);
  return m ? Number(m[1]) : null;
}

const num = (v) => { const n = Number(String(v ?? '').split(';')[0].replace(',', '.')); return Number.isFinite(n) ? n : null; };

// → { h, storeys, source: 'height' | 'levels' | 'default' }
export function heightFromTags(tags = {}) {
  const levels = num(tags['building:levels']);
  const roofLevels = num(tags['roof:levels']) || 0;
  const tagged = parseLength(tags.height);
  if (tagged != null && tagged > 0) {
    return { h: round1(tagged), storeys: levels && levels > 0 ? Math.round(levels) : Math.max(1, Math.round(tagged / STOREY_M)), source: 'height' };
  }
  if (levels != null && levels > 0) return { h: round1((levels + roofLevels) * STOREY_M), storeys: Math.round(levels), source: 'levels' };
  const type = tags.building || tags['building:part'] || 'yes';
  const storeys = DEFAULT_STOREYS[type] ?? DEFAULT_STOREYS.yes;
  return { h: round1(storeys * STOREY_M), storeys, source: 'default' };
}
export const storeysForHeight = (h) => Math.max(1, Math.round(h / STOREY_M));
const round1 = (v) => Math.round(v * 10) / 10;

/* ---------- coordinate frame ---------- */
export function makeFrame(bbox, tileM = TILE_M) {
  const [w, s, e, n] = bbox;
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const ky = EARTH_R * Math.PI / 180, kx = ky * Math.cos(lat0 * Math.PI / 180);
  const toENU = (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const [eMin, nMin] = toENU(w, s), [eMax, nMax] = toENU(e, n);
  const W = Math.floor((eMax - eMin) / tileM), H = Math.floor((nMax - nMin) / tileM);
  const ox = eMin + ((eMax - eMin) - W * tileM) / 2;   // west edge of tile column 0, metres east of centre
  const oy = nMax - ((nMax - nMin) - H * tileM) / 2;   // north edge of tile row 0, metres north of centre
  const x0 = Math.floor(W / 2), y0 = Math.ceil(H / 2) - 1;
  return {
    W, H, tileM, lon0, lat0, ox, oy,
    FRAME: { x0, y0, yUp: true },
    toENU,
    // fractional tile coordinates of a lon/lat (tile (x, y) spans [x, x+1) × [y, y+1))
    toTile: (lon, lat) => { const [ee, nn] = toENU(lon, lat); return [(ee - ox) / tileM, (oy - nn) / tileM]; },
    // lon/lat of a fractional tile coordinate (the inverse of toTile)
    fromTile: (tx, ty) => [lon0 + (ox + tx * tileM) / kx, lat0 + (oy - ty * tileM) / ky],
    tileCentreENU: (x, y) => [ox + (x + 0.5) * tileM, oy - (y + 0.5) * tileM],
    tileCentreLonLat: (x, y) => { const ee = ox + (x + 0.5) * tileM, nn = oy - (y + 0.5) * tileM; return [lon0 + ee / kx, lat0 + nn / ky]; },
    toDisplay: (x, y) => ({ X: x - x0, Y: y0 - y })
  };
}

/* ---------- rasterisation ---------- */
// rings: arrays of [x, y] in fractional tile coords (outer and inner together; even-odd decides holes).
// Calls fn(x, y) for every tile whose centre is inside. Returns the count.
export function rasterizeRings(rings, W, H, fn) {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const [, y] of r) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  let count = 0;
  const y0 = Math.max(0, Math.floor(minY - 0.5)), y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let ty = y0; ty <= y1; ty += 1) {
    const yc = ty + 0.5, xs = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
        const [ax, ay] = r[j], [bx, by] = r[i];
        if ((ay > yc) !== (by > yc)) xs.push(ax + (yc - ay) * (bx - ax) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let tx = from; tx <= to; tx += 1) { fn(tx, ty); count += 1; }
    }
  }
  return count;
}

export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) { const n = ring.length; return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cy / (3 * a)];
}

// every tile covered by a footprint; the centroid tile if the footprint is smaller than a tile centre
export function footprintTiles(rings, W, H) {
  const out = [];
  rasterizeRings(rings, W, H, (x, y) => out.push([x, y]));
  if (!out.length && rings.length) {
    const [cx, cy] = ringCentroid(rings[0]);
    const x = Math.floor(cx), y = Math.floor(cy);
    if (x >= 0 && y >= 0 && x < W && y < H) out.push([x, y]);
  }
  return out;
}

export function markSea(lines, W, H, fn) {
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const px = x + 0.5, py = y + 0.5;
    let best = Infinity, line = -1, seg = -1, tt = 0;
    lines.forEach((p, li) => {
      for (let i = 1; i < p.length; i += 1) {
        const [ax, ay] = p[i - 1], [bx, by] = p[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        const qx = ax + t * dx - px, qy = ay + t * dy - py, d = qx * qx + qy * qy;
        if (d < best - 1e-12) { best = d; line = li; seg = i; tt = t; }
      }
    });
    if (line < 0) continue;
    const p = lines[line];
    if ((seg === 1 && tt === 0) || (seg === p.length - 1 && tt === 1)) continue; // beyond an open end
    // right-hand normal of a segment in tile space (y grows south, so "right of travel" is +cross)
    const nrm = (i) => { const [ax, ay] = p[i - 1], [bx, by] = p[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
    let [nx, ny] = nrm(seg), vx, vy;
    if (tt === 0) { const m = nrm(seg - 1); nx += m[0]; ny += m[1]; [vx, vy] = p[seg - 1]; }
    else if (tt === 1) { const m = nrm(seg + 1); nx += m[0]; ny += m[1]; [vx, vy] = p[seg]; }
    else { [vx, vy] = p[seg - 1]; }
    if ((px - vx) * nx + (py - vy) * ny > 0) fn(x, y);
  }
}

const ROAD_HALF_M = { motorway: 9, trunk: 8, primary: 7, secondary: 6.5, tertiary: 6, residential: 4.5, unclassified: 4.5, living_street: 3.5, service: 3, pedestrian: 3, footway: 1.6, path: 1.4, cycleway: 1.6, steps: 1.6 };
const WALK = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps', 'track', 'bridleway']);

/* ---------- the build ---------- */
export function buildCityLevel(extract, { tileM = TILE_M, seed = 20261103 } = {}) {
  const frame = makeFrame(extract.bbox, tileM);
  const { W, H } = frame;
  const N = W * H, idx = (x, y) => y * W + x;
  const kind = new Uint8Array(N);                 // KIND codes
  const height = new Float64Array(N);             // metres of the roof over a tile (0 = none)
  const owner = new Int32Array(N).fill(-1);       // building index
  const partH = new Float64Array(N).fill(NaN);
  const toRings = (f) => [...f.outer, ...(f.inner || [])].map((r) => r.map(([lon, lat]) => frame.toTile(lon, lat)));
  const set = (code) => (x, y) => { kind[idx(x, y)] = code; };

  // ground cover first; later layers overwrite earlier ones
  for (const f of extract.features) if (f.kind === 'park') rasterizeRings(toRings(f), W, H, set(3));
  // coastline: OSM draws it with land on the left. A tile centre is sea when it lies right of its
  // nearest coastline point (at a shared vertex the two segments' normals are summed, the usual
  // pseudo-normal). Tiles whose nearest point is the open END of a coastline way are left as land:
  // beyond an end the side is unknown, and guessing paints a false sea across the city.
  const coastLines = extract.features.filter((f) => f.kind === 'coastline').map((f) => f.line.map(([lon, lat]) => frame.toTile(lon, lat)));
  if (coastLines.length) markSea(coastLines, W, H, (x, y) => { kind[idx(x, y)] = 4; });
  for (const f of extract.features) if (f.kind === 'water') rasterizeRings(toRings(f), W, H, set(4));
  for (const f of extract.features) if (f.kind === 'pier') rasterizeRings(toRings(f), W, H, set(5));
  // streets (render only: every street tile is ordinary walkable ground to the rules)
  for (const f of extract.features) {
    if (f.kind !== 'road') continue;
    const half = (ROAD_HALF_M[f.tags.highway] ?? 3) / tileM, code = WALK.has(f.tags.highway) ? 2 : 1;
    const p = f.line.map(([lon, lat]) => frame.toTile(lon, lat));
    for (let i = 1; i < p.length; i += 1) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
      const xa = Math.max(0, Math.floor(Math.min(ax, bx) - half)), xb = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + half));
      const ya = Math.max(0, Math.floor(Math.min(ay, by) - half)), yb = Math.min(H - 1, Math.ceil(Math.max(ay, by) + half));
      for (let y = ya; y <= yb; y += 1) for (let x = xa; x <= xb; x += 1) {
        const px = x + 0.5, py = y + 0.5, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
        const qx = ax + t * dx - px, qy = ay + t * dy - py;
        if (qx * qx + qy * qy > half * half) continue;
        const k = idx(x, y);
        if (kind[k] === 4 || kind[k] === 5) continue;          // a street line over water is a bridge/ferry line: leave the water
        if (code === 1 || kind[k] !== 1) kind[k] = code;       // a road beats a footway on the same tile
      }
    }
  }

  // buildings, then parts
  const buildings = [];
  for (const f of extract.features) {
    if (f.kind !== 'building') continue;
    const minH = parseLength(f.tags.min_height) || 0;
    if (minH >= FLOATING_PART_M) continue;
    const hh = heightFromTags(f.tags), tiles = footprintTiles(toRings(f), W, H);
    if (!tiles.length) continue;
    const b = { id: `B${buildings.length + 1}`, osm: f.osm, name: f.tags.name || (f.tags['addr:housenumber'] ? `${f.tags['addr:housenumber']} ${f.tags['addr:street'] || ''}`.trim() : null), type: f.tags.building, h: hh.h, storeys: hh.storeys, heightSource: hh.source, tiles: 0 };
    const bi = buildings.push(b) - 1;
    for (const [x, y] of tiles) {
      const k = idx(x, y);
      if (owner[k] < 0 || height[k] < b.h) { owner[k] = bi; height[k] = b.h; }
      kind[k] = 6;
    }
  }
  const parts = [];
  for (const f of extract.features) {
    if (f.kind !== 'building:part') continue;
    const minH = parseLength(f.tags.min_height) || 0;
    const hh = heightFromTags(f.tags);
    if (minH >= FLOATING_PART_M) { parts.push({ osm: f.osm, h: hh.h, skipped: 'floating' }); continue; }
    const tiles = footprintTiles(toRings(f), W, H);
    parts.push({ osm: f.osm, h: hh.h, heightSource: hh.source, tiles: tiles.length });
    for (const [x, y] of tiles) { const k = idx(x, y); partH[k] = Number.isNaN(partH[k]) ? hh.h : Math.max(partH[k], hh.h); }
  }
  for (let k = 0; k < N; k += 1) {
    if (Number.isNaN(partH[k])) continue;
    if (owner[k] < 0) { // a part outside any outline becomes its own building
      const [x, y] = [k % W, Math.floor(k / W)];
      const b = { id: `B${buildings.length + 1}`, osm: null, name: null, type: 'part', h: partH[k], storeys: storeysForHeight(partH[k]), heightSource: 'part', tiles: 0 };
      owner[k] = buildings.push(b) - 1; void x; void y;
    }
    height[k] = partH[k]; kind[k] = 6;
  }
  for (let k = 0; k < N; k += 1) if (owner[k] >= 0) buildings[owner[k]].tiles += 1;

  // roof patches: 4-connected roof tiles within ROOF_JOIN_M of each other
  const patchOf = new Int32Array(N).fill(-1);
  const patches = [];
  const NB = [[0, 1], [1, 0], [-1, 0], [0, -1]]; // S, E, W, N
  for (let k = 0; k < N; k += 1) {
    if (kind[k] !== 6 || patchOf[k] >= 0) continue;
    const p = { id: `R${patches.length + 1}`, tiles: [], hMin: Infinity, hMax: 0, buildings: new Set(), z: 0 };
    const pi = patches.push(p) - 1, stack = [k]; patchOf[k] = pi;
    while (stack.length) {
      const c = stack.pop(), x = c % W, y = (c - x) / W;
      p.tiles.push(c); p.hMin = Math.min(p.hMin, height[c]); p.hMax = Math.max(p.hMax, height[c]); p.buildings.add(owner[c]);
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = idx(nx, ny);
        if (kind[n] === 6 && patchOf[n] < 0 && Math.abs(height[n] - height[c]) <= ROOF_JOIN_M) { patchOf[n] = pi; stack.push(n); }
      }
    }
    p.tiles.sort((a, b) => a - b);
  }
  // adjacency between patches, with the first (lowest-index) touching tile pair for links
  const adj = patches.map(() => new Map());
  for (let k = 0; k < N; k += 1) {
    const a = patchOf[k]; if (a < 0) continue;
    const x = k % W, y = (k - x) / W;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy; if (nx >= W || ny >= H) continue;
      const n = idx(nx, ny), b = patchOf[n];
      if (b < 0 || b === a) continue;
      if (!adj[a].has(b)) adj[a].set(b, [k, n]);
      if (!adj[b].has(a)) adj[b].set(a, [n, k]);
    }
  }
  // greedy colouring, tallest first (ties by id): adjacent patches never share a z
  const order = patches.map((_, i) => i).sort((a, b) => patches[b].hMax - patches[a].hMax || a - b);
  for (const i of order) {
    const used = new Set([...adj[i].keys()].map((j) => patches[j].z).filter(Boolean));
    let z = 1; while (used.has(z)) z += 1; patches[i].z = z;
  }
  const FLOORS = 1 + patches.reduce((m, p) => Math.max(m, p.z), 0);

  // rules data
  const blockers = [];
  for (let k = 0; k < N; k += 1) {
    const x = k % W, y = (k - x) / W;
    if (kind[k] === 6) blockers.push({ x, y, z: 0, h: round1(height[k]) });
    else if (kind[k] === 4) blockers.push({ x, y, z: 0, h: 0 });
  }
  const surfaces = [];
  for (const p of patches) { // row runs of equal height
    let run = null;
    for (const k of p.tiles) {
      const x = k % W, y = (k - x) / W, h = round1(height[k]);
      if (run && run.y === y && run.x + run.w === x && run.height === h) run.w += 1;
      else { if (run) surfaces.push(run); run = { z: p.z, x, y, w: 1, d: 1, height: h }; }
    }
    if (run) surfaces.push(run);
  }
  const groundOK = (x, y) => x >= 0 && y >= 0 && x < W && y < H && kind[idx(x, y)] !== 6 && kind[idx(x, y)] !== 4;
  const links = [];
  for (let i = 0; i < patches.length; i += 1) {
    const p = patches[i];
    if (p.hMax <= GROUND_ACCESS_MAX_M) {
      // the southernmost roof-edge tile with street beside it (scan rows south → north, then west → east)
      let found = null;
      for (let t = p.tiles.length - 1; t >= 0 && !found; t -= 1) {
        const k = p.tiles[t], x = k % W, y = (k - x) / W;
        for (const [dx, dy] of NB) if (groundOK(x + dx, y + dy)) { found = { from: { x: x + dx, y: y + dy, z: 0 }, to: { x, y, z: p.z }, h: height[k] }; break; }
      }
      if (found) links.push({ id: `ladder-${p.id}`, kind: 'ladder', from: found.from, to: found.to, cost: 2 + Math.ceil(found.h / STOREY_M) });
    }
    for (const [j, [ka, kb]] of adj[i]) {
      if (j < i) continue;
      const dh = Math.abs(height[ka] - height[kb]);
      if (dh > ROOF_STEP_MAX_M) continue;
      const xa = ka % W, ya = (ka - xa) / W, xb = kb % W, yb = (kb - xb) / W;
      links.push({ id: `step-${p.id}-${patches[j].id}`, kind: 'roof-step', from: { x: xa, y: ya, z: p.z }, to: { x: xb, y: yb, z: patches[j].z }, cost: 1 + Math.ceil(dh / STOREY_M) });
    }
  }
  // derived cover, as Transit / Relay derives it: street tiles beside a wall get HIGH cover on that
  // side; a roof edge gets LOW (the parapet) unless a taller neighbouring roof makes it a wall
  const cover = [];
  const SIDES = [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const k = idx(x, y);
    if (groundOK(x, y)) {
      const sides = [];
      for (const [s, dx, dy] of SIDES) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && kind[idx(nx, ny)] === 6 && height[idx(nx, ny)] >= 1) sides.push(s); }
      if (sides.length) cover.push({ x, y, z: 0, type: 'HIGH', sides });
    } else if (kind[k] === 6) {
      const sides = []; let tall = 0;
      for (const [s, dx, dy] of SIDES) {
        const nx = x + dx, ny = y + dy;
        const n = nx >= 0 && ny >= 0 && nx < W && ny < H ? idx(nx, ny) : -1;
        if (n >= 0 && patchOf[n] === patchOf[k]) continue;
        sides.push(s);
        const rise = n >= 0 && kind[n] === 6 ? height[n] - height[k] : 0;
        tall = Math.max(tall, rise >= 1.8 ? 1.8 : 1.1);
      }
      if (sides.length) cover.push({ x, y, z: patches[patchOf[k]].z, type: tall >= 1.8 ? 'HIGH' : 'LOW', sides });
    }
  }
  // a squad start: the three open street tiles nearest the grid centre (breadth-first, deterministic),
  // each with at least three open neighbours and two tiles apart, so nobody starts boxed in
  const start = [];
  { const seen = new Uint8Array(N), q = [[frame.FRAME.x0, frame.FRAME.y0]]; seen[idx(frame.FRAME.x0, frame.FRAME.y0)] = 1;
    while (q.length && start.length < 3) {
      const [x, y] = q.shift();
      const open = NB.filter(([dx, dy]) => groundOK(x + dx, y + dy)).length;
      if (groundOK(x, y) && open >= 3 && start.every((t) => Math.abs(t.x - x) + Math.abs(t.y - y) >= 2)) start.push({ x, y });
      for (const [dx, dy] of NB) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[idx(nx, ny)]) { seen[idx(nx, ny)] = 1; q.push([nx, ny]); } }
    } }
  const ROLES = ['E', 'R', 'T'];
  const units = start.map((t, i) => ({ id: `${ROLES[i]}1`, faction: 'PLAYER', role: ROLES[i], x: t.x, y: t.y, hp: 6, maxHp: 6, moveRange: 7, aim: 70, weaponDamage: 3, ammo: 4, magazineSize: 4, reserveAmmo: 8, detectionRadius: 10 }));

  const levelId = `city-${extract.id}`;
  const attribution = `${extract.licence?.attribution || '© OpenStreetMap contributors'} · ${extract.licence?.name || 'ODbL 1.0'}`;
  const kindRows = [];
  for (let y = 0; y < H; y += 1) { let row = ''; for (let x = 0; x < W; x += 1) row += CODE_KIND[kind[idx(x, y)]]; kindRows.push(row); }
  const stats = {
    tiles: N, buildingTiles: blockers.filter((b) => b.h > 0).length, waterTiles: blockers.filter((b) => b.h === 0).length,
    buildings: buildings.length, parts: parts.length, patches: patches.length, roofLayers: FLOORS - 1,
    links: links.length, cover: cover.length, surfaces: surfaces.length,
    heightSources: buildings.reduce((m, b) => (m[b.heightSource] = (m[b.heightSource] || 0) + 1, m), {}),
    tallest: buildings.reduce((m, b) => (b.h > m.h ? { h: b.h, name: b.name, osm: b.osm } : m), { h: 0 })
  };

  return {
    schema: 'mccluster.prim3.city-level.v1',
    LEVEL_ID: levelId,
    title: extract.name,
    W, H, FLOORS, TILE_M: tileM, STOREY_M,
    FRAME: frame.FRAME,
    attribution,
    licence: extract.licence,
    geo: {
      bbox: extract.bbox, origin: { lon: frame.lon0, lat: frame.lat0 }, crs: 'local east-north tangent plane at bbox centre (equirectangular)',
      // the tile grid in metres east/north of origin: tile (x, y) spans east [ox + x·TILE_M, …), north (oy − (y+1)·TILE_M, oy − y·TILE_M]
      ox: Math.round(frame.ox * 1000) / 1000, oy: Math.round(frame.oy * 1000) / 1000,
      source: extract.source, fetchedAt: extract.fetchedAt
    },
    SCENE: {
      kindRows,
      buildings,
      parts,
      patches: patches.map((p) => ({ id: p.id, z: p.z, hMin: round1(p.hMin), hMax: round1(p.hMax), tiles: p.tiles.length, buildings: [...p.buildings].map((b) => buildings[b].id) }))
    },
    MISSION: { title: `${extract.name} — survey`, objective: 'Survey the block', brief: 'Prototype city grid: no opposition placed yet.', linkActions: [] },
    stats,
    engineConfig: {
      width: W, height: H, floors: FLOORS, seed, clock: 14, extractionRequired: false,
      surfaces, links: links.map(({ kind: _k, ...l }) => l), blockers, cover, units, nodes: [], technicalTruth: { nodes: {} }, objectives: [],
      battlefield: { levelId, coordinateFrame: frame.FRAME, geo: { bbox: extract.bbox, tileM } }
    },
    // typed views for renderers in the same process (dropped by JSON.stringify via toJSON below)
    grids: { kind, height, owner, patchOf, patchZ: Int16Array.from(patches, (p) => p.z) },
    linkKinds: links.map((l) => l.kind)
  };
}

// the level as the JSON a levels/*.mjs adapter would import (typed arrays left out)
export function levelToJSON(level) {
  const { grids: _g, linkKinds: _l, ...rest } = level;
  return rest;
}
