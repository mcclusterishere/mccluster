#!/usr/bin/env node
/* Builds data/geo/country-boundaries-110m.json from Natural Earth's
   1:110m Admin 0 Countries (public domain, naturalearthdata.com), pinned to
   the natural-earth-vector release below. One neutral file, keyed by
   ISO 3166-1 alpha-2 (the code Cloudflare puts in request.cf.country), so the
   analytics globe and the World can share it.

   Usage:
     node tools/build-country-boundaries.mjs                 # downloads the pinned release
     node tools/build-country-boundaries.mjs path/to.geojson # builds from a local copy

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
const URL_SRC = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_110m_admin_0_countries.geojson`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/geo/country-boundaries-110m.json');

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
  const src = process.argv[2];
  const text = src ? await readFile(src, 'utf8') : await (await fetch(URL_SRC)).text();
  const out = build(JSON.parse(text));
  await writeFile(OUT, JSON.stringify(out) + '\n');
  const pts = out.countries.reduce((n, c) => n + c.p.reduce((m, poly) => m + poly.reduce((k, r) => k + r.length / 2, 0), 0), 0);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${out.countries.length} countries, ${pts} vertices`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
