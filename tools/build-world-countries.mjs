/* THE WORLD'S COUNTRIES — borders, label points and flags for the globe.

   Natural Earth 1:10m (owner, 2026-10-20: "The map needs to be clearly defined with clearly defined borders … drawn
   accurately"). The 1:110m file this replaced had no shape at all for 72 countries (Singapore, Hong Kong, Bahrain, Malta,
   Monaco, Andorra …) and put Geneva in France and Windsor in the United States; at 1:10m simplified to 10% those land
   where they are. 10% is the floor: at 5% Geneva and Windsor go wrong again.

   The US-view edition (ne_10m_admin_0_countries_usa): the news on the globe is placed by GDELT, whose place names come from
   the US government's gazetteer, so a story from Crimea says "Ukraine" and one from Laayoune "Western Sahara". Natural
   Earth's default edition draws those places inside other countries; the US view draws them where the stories say they
   are, so a pin and the country it names agree. Drawing a border is not a statement on any dispute.

     curl -L -o ne_10m_admin_0_countries_usa.geojson \
       https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries_usa.geojson
     npx mapshaper@0.6.102 -i ne_10m_admin_0_countries_usa.geojson -simplify 10% keep-shapes \
       -each 'key = /^[A-Z]{2}$/.test(ISO_A2_EH) ? ISO_A2_EH : ADM0_A3' \
       -filter-fields key,ISO_A2_EH,ISO_A3_EH,ADM0_A3,NAME,CONTINENT,REGION_UN,SUBREGION,LABEL_X,LABEL_Y,LABELRANK \
       -o precision=0.01 countries.geojson -dissolve2 key -innerlines -o precision=0.01 borders.geojson
     node tools/build-world-countries.mjs ne_10m_admin_0_countries_usa.geojson countries.geojson borders.geojson [flag-icons dir]
     node tools/build-world-states.mjs                                  # the states, placed in these countries
     node tools/build-flag-sprite.mjs                                   # only when the flags change (Playwright)

   mapshaper simplifies the whole world at once and keeps one shared edge between neighbours, so a border line and the two
   countries it divides are the same points. -dissolve2 key first makes a country's pieces one shape, so no line is drawn
   between Georgia and Abkhazia, or between Australia and its island territories.

   What it writes
   - data/geo/world-countries-10m.json: one entry per country (pieces Natural Earth splits off
     under the same ISO code, such as Clipperton under France, joined to it). Coordinates at 0.01° (about 1 km). Per
     feature: a2 / a3 (ISO 3166-1, Natural Earth's "_EH" columns, which carry France FR and Norway NO where the plain
     ISO_A2 column says -99), name, continent, region (UN), subregion, label point (LABEL_X / LABEL_Y), rank (LABELRANK),
     bbox of the whole country and of its largest polygon (the fade on zoom uses the main body, so Alaska and Hawaii do not
     make the United States "fill" a view it does not), and whether a flag ships. For taps, flags and a selected outline.
   - data/geo/world-borders-10m.json: the land borders only, as lines. The coastline is the
     imagery's; each border is drawn once, not once per neighbour.
   - assets/flags/4x3/<a2>.svg, only when a flag-icons package is named: the flags of the countries drawn, copied byte for
     byte from flag-icons (MIT, Copyright (c) 2013 Panayiotis Lipiridis), with its LICENSE beside them. Without it, the
     flags already in assets/flags/4x3 (and the atlas built from them) are the ones shown.

   No code: Dhekelia, Akrotiri, Guantanamo Bay, Bir Tawil, the Spratly Islands and Scarborough Reef have no ISO 3166-1 code
   in Natural Earth (-99). They keep their outlines, carry Natural Earth's own ADM0_A3 as a3, a2 null and no flag: nothing
   is invented for them. Kosovo is XK, the user-assigned code Natural Earth, flag-icons and the European Commission use.

   Both files store a line as whole hundredths of a degree, each point a step from the one before (about a third of the
   size of plain coordinates); HuCountries.decode (js/world-countries.js) turns them back into [lon, lat] points.

   Nothing here is fetched at run time; the inputs are the files named on the command line. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [nePath, countriesPath, bordersPath, flagPkg] = process.argv.slice(2);
if (!nePath || !countriesPath || !bordersPath) { console.error("usage: node tools/build-world-countries.mjs <ne_10m_admin_0_countries_usa.geojson> <countries.geojson> <borders.geojson> [flag-icons package dir]"); process.exit(2); }

const NO_FLAG = new Set(["AQ"]);
const sha256 = createHash("sha256").update(readFileSync(nePath)).digest("hex");
const src = JSON.parse(readFileSync(countriesPath, "utf8"));
const r2 = (n) => Math.round(n * 100) / 100;
const code = (v) => (typeof v === "string" && /^[A-Z]{2,3}$/.test(v) ? v : null);
const flagFile = (a2) => (flagPkg ? join(flagPkg, "flags/4x3", a2.toLowerCase() + ".svg") : join(ROOT, "assets/flags/4x3", a2.toLowerCase() + ".svg"));

function ringArea(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); }
function bboxOf(rings) { let w = 180, s = 90, e = -180, n = -90; for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } return [r2(w), r2(s), r2(e), r2(n)]; }
/* drop consecutive duplicates that rounding creates; keep rings closed and at least 4 points */
function cleanRing(ring) { const out = []; for (const [x, y] of ring) { const p = [r2(x), r2(y)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); } const a = out[0], z = out[out.length - 1]; if (a && (a[0] !== z[0] || a[1] !== z[1])) out.push([a[0], a[1]]); return out.length >= 4 ? out : null; }
/* [lon, lat, lon, lat, …] in degrees → integers in hundredths: the first point whole, then each step from the one before */
function delta(flat) { const out = []; let px = 0, py = 0; for (let i = 0; i < flat.length; i += 2) { const x = Math.round(flat[i] * 100), y = Math.round(flat[i + 1] * 100); out.push(x - px, y - py); px = x; py = y; } return out; }
const polysOf = (g) => (!g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);

/* one country per key: its pieces joined, with the properties of the piece that IS the country (ADM0_A3 = ISO_A3_EH) */
const byKey = new Map();
for (const f of src.features) {
  const p = f.properties;
  const polys = polysOf(f.geometry).map((poly) => poly.map(cleanRing).filter(Boolean)).filter((poly) => poly.length);
  if (!polys.length) continue;
  const it = byKey.get(p.key) || { main: null, polys: [] };
  it.polys.push(...polys);
  if (!it.main || p.ADM0_A3 === p.ISO_A3_EH) it.main = p;
  byKey.set(p.key, it);
}

const features = [];
const flags = [];
for (const { main: p, polys } of byKey.values()) {
  const a2 = /^[A-Z]{2}$/.test(String(p.ISO_A2_EH)) ? p.ISO_A2_EH : null, a3 = code(p.ISO_A3_EH) || code(p.ADM0_A3);
  const big = polys.slice().sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  const flag = !!a2 && !NO_FLAG.has(a2) && existsSync(flagFile(a2));
  if (flag) flags.push(a2);
  features.push({
    properties: {
      a2, a3, name: p.NAME, continent: p.CONTINENT, region: p.REGION_UN, subregion: p.SUBREGION,
      label: [r2(p.LABEL_X), r2(p.LABEL_Y)], rank: p.LABELRANK, flag,
      bbox: bboxOf(polys.flat()), main_bbox: bboxOf(big),
    },
    /* each ring open (the first point is not repeated), in hundredths of a degree, every point after the first as a step */
    p: polys.map((poly) => poly.map((ring) => delta(ring.slice(0, -1).flat()))),
  });
}
features.sort((a, b) => String(a.properties.a3).localeCompare(String(b.properties.a3)));

const ABOUT = {
  version: "Natural Earth v5.1.2 (nvkelso/natural-earth-vector tag v5.1.2, geojson/ne_10m_admin_0_countries_usa.geojson)",
  source_sha256: sha256,
  licence: "Public domain (Natural Earth terms of use: https://www.naturalearthdata.com/about/terms-of-use/). No permission needed; credit given anyway.",
  generated_by: "tools/build-world-countries.mjs",
  precision: "simplified to 10% with mapshaper 0.6.102 (keep-shapes; neighbours share one edge); coordinates rounded to 0.01 degree",
  borders_note: "Natural Earth's US point of view, matching the gazetteer GDELT's place names come from. Drawing a border is not a statement on any dispute.",
};
mkdirSync(join(ROOT, "data/geo"), { recursive: true });
writeFileSync(join(ROOT, "data/geo/world-countries-10m.json"), JSON.stringify({
  format: "countries: each country's properties and p, its polygons [outer ring, ...holes]; a ring is open, in hundredths of a degree, [x0, y0, dx1, dy1, ...] (HuCountries.decode in js/world-countries.js)",
  source: "Natural Earth 1:10m Cultural Vectors, Admin 0 – Countries, US point of view (ne_10m_admin_0_countries_usa), naturalearthdata.com",
  ...ABOUT,
  flags: "flag-icons 7.5.0 by Panayiotis Lipiridis (lipis), MIT licence: assets/flags/LICENSE-flag-icons.txt",
  countries: features,
}) + "\n");

/* the land borders: every line two countries share, flat, consecutive duplicates dropped */
const borders = JSON.parse(readFileSync(bordersPath, "utf8"));
const lines = [];
for (const g of borders.geometries || (borders.features || []).map((f) => f.geometry)) {
  const parts = !g ? [] : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  for (const part of parts) {
    const flat = [];
    for (const [x, y] of part) { const a = r2(x), b = r2(y); if (flat.length && flat[flat.length - 2] === a && flat[flat.length - 1] === b) continue; flat.push(a, b); }
    if (flat.length >= 4) lines.push(delta(flat));
  }
}
writeFileSync(join(ROOT, "data/geo/world-borders-10m.json"), JSON.stringify({
  source: "Natural Earth 1:10m Admin 0 – Countries, US point of view: the lines two countries share (mapshaper -innerlines)",
  ...ABOUT,
  format: "lines: each in hundredths of a degree, [x0, y0, dx1, dy1, ...]",
  lines,
}) + "\n");

if (flagPkg) {
  mkdirSync(join(ROOT, "assets/flags/4x3"), { recursive: true });
  for (const a2 of flags) copyFileSync(flagFile(a2), join(ROOT, "assets/flags/4x3", a2.toLowerCase() + ".svg"));
  copyFileSync(join(flagPkg, "LICENSE"), join(ROOT, "assets/flags/LICENSE-flag-icons.txt"));
}
console.log(`${features.length} countries, ${flags.length} flags, ${lines.length} border lines (${lines.reduce((n, l) => n + l.length / 2, 0)} points), source sha256 ${sha256}`);
