/* McCluster Planet — georeference. Pure module: no DOM, no three.js, no scene wiring.

   Geographic coordinates are kept in double precision (persisted state, manifests). Rendering and
   physics happen in a local metric frame near the player. This module is the one place that converts
   between them, and it names every frame it knows about so nothing converts "by eye".

   Frames (never mix them; the docs are docs/fictional-city/PLANET-CONNECTICUT.md):
   - Geodetic: longitude/latitude in degrees. CT sources are NAD83(2011); the game treats NAD83(2011) and
     WGS84 as the same ellipsoid frame (GRS80 ~ WGS84; the datum offset in Connecticut is about 1–1.5 m,
     below anything a player can see). Recorded, not hidden: see DATUM_NOTE.
   - City frame (McCluster City, js/fictional-city/): metres, +X east, +Y up, +Z south (north is −Z).
   - CT State Plane: NAD83(2011) / Connecticut, Lambert Conformal Conic 2SP, EPSG:6434 (US survey feet)
     and EPSG:6433 (metres). Heights in CT products are NAVD88 orthometric (GEOID18 for CT ECO,
     Geoid12B named by the NOAA DEM mirror), not ellipsoidal heights.
   - HQ building frame: metres, Z-up GLBs; HQ display cells are 12 ft (3.6576 m), owned by
     the HQ tactical level module in js/prim3-tactics/levels/ (WORLD_M). Not converted here.
   - PRIM3 tactics: 3.54 m rule tiles, owned by js/prim3-tactics/scale.mjs (TILE_M), imported below.
   The HQ cell and the tactics tile are distinct contracts: never resize one to match the other. */
import { TILE_M } from '../../prim3-tactics/scale.mjs';

export const DATUM_NOTE = 'NAD83(2011) treated as WGS84 for game placement (GRS80 ellipsoid; ~1–1.5 m datum offset in Connecticut). Heights: NAVD88 orthometric metres, not ellipsoidal.';

// ---------- ellipsoid ----------
export const WGS84 = Object.freeze({ a: 6378137, f: 1 / 298.257223563 });
export const GRS80 = Object.freeze({ a: 6378137, f: 1 / 298.257222101 });
const RAD = Math.PI / 180;
const e2Of = (ell) => ell.f * (2 - ell.f);

/** lon/lat degrees, h metres (ellipsoidal) → Earth-centred Earth-fixed metres. */
export function geodeticToEcef(lon, lat, h = 0, ell = WGS84) {
  const e2 = e2Of(ell), sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
  const N = ell.a / Math.sqrt(1 - e2 * sl * sl);
  return [(N + h) * cl * Math.cos(lon * RAD), (N + h) * cl * Math.sin(lon * RAD), (N * (1 - e2) + h) * sl];
}

/** ECEF metres → { lon, lat, h } (Bowring start, then fixed-point refinement to sub-millimetre). */
export function ecefToGeodetic(x, y, z, ell = WGS84) {
  const e2 = e2Of(ell), b = ell.a * (1 - ell.f), ep2 = (ell.a * ell.a - b * b) / (b * b);
  const p = Math.hypot(x, y), th = Math.atan2(z * ell.a, p * b);
  let lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * ell.a * Math.cos(th) ** 3), h = 0;
  for (let i = 0; i < 4; i++) {
    const s = Math.sin(lat), N = ell.a / Math.sqrt(1 - e2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + h)));
  }
  return { lon: Math.atan2(y, x) / RAD, lat: lat / RAD, h };
}

/** East-North-Up tangent frame at an anchor; returns converters in ENU and in the city frame. */
export function createEnuFrame({ lon, lat, h = 0, ell = WGS84 }) {
  const o = geodeticToEcef(lon, lat, h, ell);
  const sl = Math.sin(lon * RAD), cl = Math.cos(lon * RAD), sp = Math.sin(lat * RAD), cp = Math.cos(lat * RAD);
  const toEnu = (lo, la, hh = 0) => {
    const p = geodeticToEcef(lo, la, hh, ell), dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    return { e: -sl * dx + cl * dy, n: -sp * cl * dx - sp * sl * dy + cp * dz, u: cp * cl * dx + cp * sl * dy + sp * dz };
  };
  const fromEnu = (e, n, u) => {
    const dx = -sl * e - sp * cl * n + cp * cl * u, dy = cl * e - sp * sl * n + cp * sl * u, dz = cp * n + sp * u;
    return ecefToGeodetic(o[0] + dx, o[1] + dy, o[2] + dz, ell);
  };
  return {
    kind: 'enu', anchor: { lon, lat, h }, toEnu, fromEnu,
    // city frame: X = east, Y = up, Z = south
    toLocal: (lo, la, hh = 0) => { const r = toEnu(lo, la, hh); return { x: r.e, y: r.u, z: -r.n }; },
    toGeodetic: (x, y, z) => fromEnu(x, -z, y)
  };
}

// ---------- the owner's named city projection ----------
/* Owner-adopted equirectangular placement for McCluster City around downtown Bridgeport (2026-11-03):
     x = (lon − lon0) · 111320 · cos(lat0 rad);  z = −(lat − lat0) · 111320 + zOffset;  rounded to 4 dp.
   with lon0 −73.1903, lat0 41.1798, zOffset −220. No rescaling. It is an approximation (constant metres per
   degree on a sphere-like scale): at 41.18° N the true meridian degree is ~111,050 m, so north–south distances
   read ~0.25 % long and east–west ~0.1 % long against the ENU tangent plane — about 2.5 m per km, 6 m at a
   2 km corner (tested). That is the owner's adopted, fixed contract: do not "correct" it in place, because
   placed content depends on it. Use createEnuFrame for anything measured. Heights are carried through unchanged. This module expresses the
   projection only; the neighbourhood data placed with it is merged separately. */
export const M_PER_DEG = 111320;
export function createEquirectFrame({ id, lon0, lat0, xOffset = 0, zOffset = 0, decimals = 4 }) {
  const kx = M_PER_DEG * Math.cos(lat0 * RAD), q = 10 ** decimals;
  const round = (v) => Math.round(v * q) / q;
  return {
    kind: 'equirect', id, anchor: { lon: lon0, lat: lat0 }, xOffset, zOffset, decimals,
    toLocal: (lon, lat, h = 0) => ({ x: round((lon - lon0) * kx + xOffset), y: h, z: round(-(lat - lat0) * M_PER_DEG + zOffset) }),
    toLocalExact: (lon, lat, h = 0) => ({ x: (lon - lon0) * kx + xOffset, y: h, z: -(lat - lat0) * M_PER_DEG + zOffset }),
    toGeodetic: (x, y, z) => ({ lon: lon0 + (x - xOffset) / kx, lat: lat0 - (z - zOffset) / M_PER_DEG, h: y })
  };
}

export const FRAMES = Object.freeze({
  'mccluster-city.bridgeport-equirect.v1': Object.freeze({
    id: 'mccluster-city.bridgeport-equirect.v1', kind: 'equirect', lon0: -73.1903, lat0: 41.1798, xOffset: 0, zOffset: -220, decimals: 4,
    axes: '+X east, +Y up, +Z south (city frame)',
    note: 'Owner-adopted placement of McCluster City relative to downtown Bridgeport. City (0, 0) is lon −73.1903, lat 41.1798 − 220/111320.'
  })
});
export function frame(id) {
  const spec = FRAMES[id];
  if (!spec) throw new Error('Unknown frame: ' + id);
  return spec.kind === 'equirect' ? createEquirectFrame(spec) : createEnuFrame(spec);
}

// ---------- Connecticut State Plane (Lambert Conformal Conic 2SP, NAD83(2011)) ----------
export const US_SURVEY_FOOT = 1200 / 3937;
export const CT_SPCS = Object.freeze({
  epsgFeet: 6434, epsgMetres: 6433, lat1: 41 + 52 / 60, lat2: 41 + 12 / 60, lat0: 40 + 50 / 60, lon0: -72.75,
  falseEastingM: 304800.6096, falseNorthingM: 152400.3048
});
function lccConstants(ell = GRS80) {
  const e = Math.sqrt(e2Of(ell));
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const p1 = CT_SPCS.lat1 * RAD, p2 = CT_SPCS.lat2 * RAD, p0 = CT_SPCS.lat0 * RAD;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  return { e, n, F, a: ell.a, t, r0: ell.a * F * t(p0) ** n };
}
const LCC = lccConstants();
/** lon/lat (NAD83(2011)) → CT State Plane easting/northing in metres, or US survey feet with unit 'ftUS'. */
export function geodeticToCtStatePlane(lon, lat, unit = 'm') {
  const { n, F, a, t, r0 } = LCC, r = a * F * t(lat * RAD) ** n, th = n * (lon - CT_SPCS.lon0) * RAD;
  const E = CT_SPCS.falseEastingM + r * Math.sin(th), N = CT_SPCS.falseNorthingM + r0 - r * Math.cos(th);
  return unit === 'ftUS' ? { E: E / US_SURVEY_FOOT, N: N / US_SURVEY_FOOT } : { E, N };
}
/** CT State Plane easting/northing (metres, or 'ftUS') → { lon, lat } NAD83(2011). */
export function ctStatePlaneToGeodetic(E, N, unit = 'm') {
  const { e, n, F, a, r0 } = LCC, k = unit === 'ftUS' ? US_SURVEY_FOOT : 1;
  const x = E * k - CT_SPCS.falseEastingM, y = r0 - (N * k - CT_SPCS.falseNorthingM);
  const r = Math.sign(n) * Math.hypot(x, y), tt = (r / (a * F)) ** (1 / n), th = Math.atan2(x, y);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2));
  return { lon: th / n / RAD + CT_SPCS.lon0, lat: phi / RAD };
}

// ---------- floating origin ----------
/* Rendering in float32 loses centimetres a few kilometres from the origin. The scene keeps a render
   origin near the player and shifts it in whole-chunk steps once the player strays past `threshold`.
   World (double) positions never change; only the render offset does. */
export function createFloatingOrigin({ threshold = 512, step = 128 } = {}) {
  let ox = 0, oz = 0;
  return {
    get origin() { return { x: ox, z: oz }; },
    toRender: (x, y, z) => ({ x: x - ox, y, z: z - oz }),
    toWorld: (x, y, z) => ({ x: x + ox, y, z: z + oz }),
    /** Returns the shift applied (add to every rendered object's position as −shift), or null. */
    update(px, pz) {
      if (Math.abs(px - ox) < threshold && Math.abs(pz - oz) < threshold) return null;
      const nx = Math.round(px / step) * step, nz = Math.round(pz / step) * step;
      const shift = { x: nx - ox, z: nz - oz }; ox = nx; oz = nz; return shift;
    }
  };
}

// ---------- scale contracts (documentation in code; constants come from their owners) ----------
export const SCALE_CONTRACTS = Object.freeze({
  cityMetresPerUnit: 1,
  tacticsTileM: TILE_M, // js/prim3-tactics/scale.mjs
  hqDisplayCell: 'HQ tactical level module WORLD_M (12 ft per display cell)',
  hqModelAxes: 'metres, Z-up (canonical HQ GLBs)',
  cityAxes: 'metres, Y-up, +X east, +Z south'
});
export const metresToTacticsTiles = (m) => m / TILE_M;

/* Control points. lon/lat → CT State Plane values were computed independently with PROJ (pyproj 3.x,
   EPSG:6318 → EPSG:6434/6433, 2026-11-03); ECEF with EPSG:4979 → EPSG:4978 at h = 10 m. The tests hold this
   module to them at millimetre level. */
export const CONTROL_POINTS = Object.freeze([
  { id: 'bridgeport-harbor-west-crop-centre', lon: -73.1885, lat: 41.172, spcsFtUS: [879274.6679, 623702.7184], spcsM: [268003.4548, 190104.9688], ecefH10: [1390601.7566, -4602556.3708, 4176827.0812] },
  { id: 'new-haven-green', lon: -72.9279, lat: 41.3083, spcsFtUS: [951123.6493, 673109.4329], spcsM: [289903.0681, 205164.1655], ecefH10: [1408591.7237, -4586644.8163, 4188209.6222] },
  { id: 'hartford-old-state-house', lon: -72.6734, lat: 41.7658, spcsFtUS: [1020897.3658, 839771.4508], spcsM: [311170.1394, 255962.8501], ecefH10: [1418916.4557, -4548178.1799, 4226243.6766] },
  { id: 'ct-spcs-projection-origin', lon: -72.75, lat: 40 + 50 / 60, spcsFtUS: [1000000, 500000], spcsM: [304800.6096, 152400.3048], ecefH10: [1433102.7141, -4615344.9968, 4148443.3926] }
]);
