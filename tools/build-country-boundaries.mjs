#!/usr/bin/env node
/* Builds data/geo/country-boundaries-110m.json from Natural Earth's
   1:110m Admin 0 Countries (public domain, naturalearthdata.com), pinned to
   the natural-earth-vector release below. One neutral file, keyed by
   ISO 3166-1 alpha-2 (the code Cloudflare puts in request.cf.country), so the
   analytics globe and the World can share it.

   Usage:
     node tools/build-country-boundaries.mjs                 # downloads the pinned release
     node tools/build-country-boundaries.mjs path/to.geojson # builds from a local copy
     node tools/build-country-boundaries.mjs --scale 50m     # 1:50m countries + lakes, for the analytics globe
                                                            # (data/geo/country-boundaries-50m.json; local copies may follow)

   1:50m (owner, 2026-10-16: boundaries "realistically drawn and proper"): the
   analytics globe draws the whole world from 1:50m Admin 0 Countries (small
   islands included) and cuts the large 1:50m lakes (the Great
   Lakes, Victoria, Baikal, Ladoga, ...) out of the land, both quantized to 0.01 degree
   with no further simplification. The selected country is redrawn from 1:10m
   (data/geo/admin1/<CC>.json, tools/build-admin1-boundaries.mjs).

   Output shape:
     {source, version, license, url, keys, format, countries:[{c, n, p}]}
     c: ISO alpha-2 (ISO_A2, else ISO_A2_EH; "-99" stays as null and the
        feature is still drawn, never coloured: no data can be keyed to it)
     n: Natural Earth NAME
     p: polygons; each polygon is [outer, ...holes]; each ring is a flat
        [lon, lat, lon, lat, ...] array rounded to 0.01 degree. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const VERSION = 'v5.1.2';
const SCALE = process.argv.includes('--scale') ? process.argv[process.argv.indexOf('--scale') + 1] : '110m';
const URL_SRC = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_110m_admin_0_countries.geojson`;
const URL_50 = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_50m_admin_0_countries.geojson`;
const URL_LAKES_50 = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_50m_lakes.geojson`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, SCALE === '50m' ? 'data/geo/country-boundaries-50m.json' : 'data/geo/country-boundaries-110m.json');

const r2 = (v) => Math.round(v * 100) / 100;
function ring(coords) {
  const out = [];
  let pl = null, pa = null;
  for (const [lon, lat] of coords) {
    const x = r2(lon), y = r2(lat);
    if (x === pl && y === pa) continue; // rounding can collapse neighbours
    out.push(x, y); pl = x; pa = y;
  }
  // drop the closing duplicate (Cesium closes rings itself)
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out.length >= 6 ? out : null;
}
function iso2(p) {
  for (const k of ['ISO_A2', 'ISO_A2_EH']) {
    const v = String(p[k] || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) return v;
  }
  return null;
}

function polys(g) {
  const ps = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return ps.map((poly) => poly.map(ring).filter(Boolean)).filter((poly) => poly.length);
}
const LAKE_MIN = 0.35;
export function build50(countries, lakes) {
  const out = build(countries);
  out.source = 'Natural Earth 1:50m Cultural Vectors, Admin 0 Countries; 1:50m Physical Vectors, Lakes (naturalearthdata.com)';
  out.url = URL_50; out.lakes_url = URL_LAKES_50;
  out.format = 'p: polygons, each [outer, ...holes]; ring = flat [lon, lat, ...] rounded to 0.01 degree; lakes: polygons, same format (1:50m lakes of at least 0.35 square degrees, latitude-scaled)';
  out.build = 'node tools/build-country-boundaries.mjs --scale 50m';
  /* the lakes a globe reader expects to see (the Great Lakes, Winnipeg, Great Bear and Great Slave, Victoria,
     Tanganyika, Malawi, Baikal, Ladoga, Onega, Titicaca, Vanern, ...): at least LAKE_MIN square degrees, scaled by
     latitude; the 1:50m speckle of small lakes reads as noise on a phone */
  const area = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } let lat = 0; for (let i = 1; i < r.length; i += 2) lat += r[i]; lat /= r.length / 2; return Math.abs(a / 2) * Math.cos(lat * Math.PI / 180); };
  out.lakes = (lakes.features || []).flatMap((f) => polys(f.geometry)).filter((poly) => area(poly[0]) >= LAKE_MIN);
  /* delta-encoded hundredths of a degree: the same 0.01 grid, about 40% of the gzip size (a phone's first load) */
  const enc = (r) => { const o = []; let px = 0, py = 0; for (let i = 0; i < r.length; i += 2) { const x = Math.round(r[i] * 100), y = Math.round(r[i + 1] * 100); o.push(x - px, y - py); px = x; py = y; } return o; };
  out.countries = out.countries.map((c) => ({ ...c, p: c.p.map((poly) => poly.map(enc)) }));
  out.lakes = out.lakes.map((poly) => poly.map(enc));
  out.encoding = 'delta-0.01: each ring is [x0, y0, dx1, dy1, ...] in hundredths of a degree; x0, y0 absolute, the rest relative to the previous vertex';
  return out;
}
export function build(geojson) {
  const countries = [];
  for (const f of geojson.features || []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const p = polys.map((poly) => poly.map(ring).filter(Boolean)).filter((poly) => poly.length);
    if (!p.length) continue;
    countries.push({ c: iso2(f.properties || {}), n: String(f.properties.NAME || f.properties.ADMIN || ''), p });
  }
  countries.sort((a, b) => String(a.c || '~' + a.n).localeCompare(String(b.c || '~' + b.n)));
  return {
    source: 'Natural Earth 1:110m Cultural Vectors, Admin 0 Countries (naturalearthdata.com)',
    version: `natural-earth-vector ${VERSION}`,
    license: 'Public domain (Natural Earth terms of use)',
    url: URL_SRC,
    keys: 'ISO 3166-1 alpha-2 (ISO_A2, else ISO_A2_EH); null where Natural Earth has none (-99)',
    format: 'p: polygons, each [outer, ...holes]; ring = flat [lon, lat, ...] rounded to 0.01 degree',
    build: 'node tools/build-country-boundaries.mjs',
    countries
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a, i, all) => a !== '--scale' && all[i - 1] !== '--scale');
  const load = async (local, url) => JSON.parse(local ? await readFile(local, 'utf8') : await (await fetch(url)).text());
  const out = SCALE === '50m' ? build50(await load(args[0], URL_50), await load(args[1], URL_LAKES_50)) : build(await load(args[0], URL_SRC));
  await writeFile(OUT, JSON.stringify(out) + '\n');
  const pts = out.countries.reduce((n, c) => n + c.p.reduce((m, poly) => m + poly.reduce((k, r) => k + r.length / 2, 0), 0), 0);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${out.countries.length} countries, ${pts} vertices`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
