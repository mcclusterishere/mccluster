#!/usr/bin/env node
/* Builds data/geo/admin1/<CC>.json (one file per country) and
   data/geo/admin1/index.json from Natural Earth's 1:10m Admin 1 States,
   Provinces (public domain, naturalearthdata.com), pinned to the
   natural-earth-vector release below.

   Admin analytics only (owner, 2026-10-16: "each state mapped accordingly
   across the countries"). The analytics globe downloads ONE country's file,
   on demand, when that country is selected; nothing here is ever loaded by
   the public or member globe.

   The 10m source is about 40 MB, so it is simplified first, once, with
   mapshaper (topology-preserving, so neighbouring states keep one shared
   edge), and the country's own 1:10m outline is the DISSOLVE of those same
   simplified states, so a state edge and its country edge are the same line:

     npx mapshaper@0.6.102 ne_10m_admin_1_states_provinces.geojson \
       -simplify 10% keep-shapes \
       -filter-fields iso_a2,iso_3166_2,name,name_en,name_alt,woe_name,gn_name,name_local,region,region_cod,postal,latitude,longitude,type_en,geonunit,admin \
       -o precision=0.01 admin1-simplified.geojson
     npx mapshaper@0.6.102 admin1-simplified.geojson -filter '/^[A-Z]{2}$/.test(iso_a2)' \
       -dissolve iso_a2 -o precision=0.01 admin0-10m-dissolved.geojson
     node tools/build-admin1-boundaries.mjs admin1-simplified.geojson admin0-10m-dissolved.geojson

   Output, per country file:
     {c, source, version, license, format, outline, states:[{k, n, t, g, u, l, codes, names, p}]}
     outline: the country at 1:10m (polygons, same format as p), drawn when it is selected
     k: ISO 3166-2 code (Natural Earth iso_3166_2), the selection key
     n: Natural Earth name;  t: type (State, Province, ...)
     g: Natural Earth's grouping region when there is one (Ile-de-France, North West, ...)
     u: the constituent unit when the country has them (England, Scotland, Wales, ...)
     l: Natural Earth label point [lon, lat]
     codes: subdivision codes without the country prefix (ISO suffix, postal,
            region code): what Cloudflare's request.cf.regionCode carries
     names: normalised names and alternates (lower case, no accents, letters
            and digits only): what Cloudflare's request.cf.region carries
     p: polygons, each [outer, ...holes]; ring = flat [lon, lat, ...] at 0.01 degree */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const VERSION = 'v5.1.2';
const URL_SRC = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${VERSION}/geojson/ne_10m_admin_1_states_provinces.geojson`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/geo/admin1');
const LICENSE = 'Public domain (Natural Earth terms of use: "No permission is needed to use Natural Earth"). Made with Natural Earth.';

const r2 = (v) => Math.round(v * 100) / 100;
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function ring(coords) {
  const out = [];
  let pl = null, pa = null;
  for (const [lon, lat] of coords) {
    const x = r2(lon), y = r2(lat);
    if (x === pl && y === pa) continue;
    out.push(x, y); pl = x; pa = y;
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out.length >= 6 ? out : null;
}
function suffix(code) { const m = /^[A-Z]{2}-([A-Z0-9]{1,4})$/.exec(String(code || '').toUpperCase()); return m ? m[1] : null; }

function polysOf(g) {
  const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => poly.map(ring).filter(Boolean)).filter((poly) => poly.length);
}
export function outlines(geojson) {
  const out = {};
  for (const f of (geojson && geojson.features) || []) {
    const cc = String(f.properties?.iso_a2 || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) out[cc] = (out[cc] || []).concat(polysOf(f.geometry));
  }
  return out;
}
export function build(geojson) {
  const by = {};
  for (const f of geojson.features || []) {
    const pr = f.properties || {}, cc = String(pr.iso_a2 || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const p = polys.map((poly) => poly.map(ring).filter(Boolean)).filter((poly) => poly.length);
    if (!p.length) continue;
    const k = /^[A-Z]{2}-[A-Z0-9]{1,4}$/.test(String(pr.iso_3166_2 || '').toUpperCase()) ? String(pr.iso_3166_2).toUpperCase() : null;
    const codes = new Set([suffix(k), /^[A-Z0-9]{1,4}$/i.test(pr.postal || '') ? String(pr.postal).toUpperCase() : null,
      suffix(pr.region_cod) || (/^[A-Z0-9]{1,4}$/i.test(pr.region_cod || '') ? String(pr.region_cod).toUpperCase() : null)].filter(Boolean));
    const names = new Set([pr.name, pr.name_en, pr.woe_name, pr.gn_name, ...String(pr.name_local || '').split('|'), ...String(pr.name_alt || '').split('|')]
      .map(norm).filter((x) => x.length > 1));
    const lon = Number(pr.longitude), lat = Number(pr.latitude);
    const st = { k, n: String(pr.name_en || pr.name || ''), t: pr.type_en || null, g: pr.region && norm(pr.region) !== norm(pr.name) ? String(pr.region) : null,
      u: pr.geonunit && pr.admin && norm(pr.geonunit) !== norm(pr.admin) ? String(pr.geonunit) : null,
      l: Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0) ? [r2(lon), r2(lat)] : null, codes: [...codes], names: [...names], p };
    (by[cc] = by[cc] || []).push(st);
  }
  /* a state without an ISO code gets a stable key inside its country */
  for (const [cc, list] of Object.entries(by)) {
    list.sort((a, b) => String(a.k || '~').localeCompare(String(b.k || '~')) || a.n.localeCompare(b.n));
    const seen = new Set();
    list.forEach((s, i) => { if (!s.k || seen.has(s.k)) s.k = `${cc}-~${i}`; seen.add(s.k); });
  }
  return by;
}

async function main() {
  const src = process.argv[2];
  if (!src) { console.error(`usage: node tools/build-admin1-boundaries.mjs <simplified.geojson>\n(source: ${URL_SRC}; simplify first, see the header)`); process.exit(2); }
  const by = build(JSON.parse(await readFile(src, 'utf8')));
  const outl = process.argv[3] ? outlines(JSON.parse(await readFile(process.argv[3], 'utf8'))) : {};
  await mkdir(OUT, { recursive: true });
  for (const f of await readdir(OUT)) if (/^[A-Z]{2}\.json$/.test(f)) await unlink(path.join(OUT, f));
  const index = {};
  let total = 0;
  for (const [cc, states] of Object.entries(by).sort()) {
    const body = JSON.stringify({ c: cc, source: 'Natural Earth 1:10m Cultural Vectors, Admin 1 States, Provinces (naturalearthdata.com)', version: `natural-earth-vector ${VERSION}`,
      license: LICENSE, format: 'outline and states[].p: polygons, each [outer, ...holes]; ring = flat [lon, lat, ...] at 0.01 degree; simplified 10% (mapshaper, keep-shapes); outline = the dissolve of the states',
      outline: outl[cc] || null, states }) + '\n';
    await writeFile(path.join(OUT, `${cc}.json`), body);
    index[cc] = { states: states.length, bytes: Buffer.byteLength(body) };
    total += Buffer.byteLength(body);
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify({
    source: 'Natural Earth 1:10m Cultural Vectors, Admin 1 States, Provinces (naturalearthdata.com)', version: `natural-earth-vector ${VERSION}`, url: URL_SRC,
    license: LICENSE, use: 'Admin analytics only. One country file is fetched when that country is selected; never loaded by the public or member globe.',
    build: 'node tools/build-admin1-boundaries.mjs (see its header for the simplification step)', total_bytes: total, countries: index }) + '\n');
  console.log(`wrote ${Object.keys(by).length} country files, ${total} bytes`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
