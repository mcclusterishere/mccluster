/* THE WORLD'S COUNTRIES — borders, label points and flags for the globe.

     curl -L -o ne_110m_admin_0_countries.geojson \
       https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
     npm pack flag-icons@7.5.0 && tar xzf flag-icons-7.5.0.tgz        # -> ./package
     node tools/build-world-countries.mjs ne_110m_admin_0_countries.geojson package
     node tools/build-flag-sprite.mjs                                  # the one-image flag atlas (Playwright)

   What it writes
   - data/geo/world-countries-110m.json: a GeoJSON FeatureCollection, one Feature per Natural Earth
     1:110m Admin 0 country (v5.1.2, public domain). Coordinates rounded to 0.01° (about 1 km; the
     1:110m source is far coarser than that). Per feature: a2 / a3 (ISO 3166-1, Natural Earth's "_EH"
     columns, which carry France FR and Norway NO where the plain ISO_A2 column says -99), name,
     continent, region (UN), subregion, label point (LABEL_X / LABEL_Y), rank (LABELRANK), bbox of
     the whole country and of its largest polygon (the fade on zoom uses the main body, so Alaska
     and Hawaii do not make the United States "fill" a view it does not), and whether a flag ships.
   - assets/flags/4x3/<a2>.svg: only the flags of the countries drawn, copied byte for byte from
     flag-icons (MIT, Copyright (c) 2013 Panayiotis Lipiridis), with its LICENSE beside them.

   No code: Northern Cyprus and Somaliland have no ISO 3166-1 code in Natural Earth (-99). They keep
   their borders, carry Natural Earth's own ADM0_A3 (CYN, SOL) as a3, a2 null and no flag: nothing
   is invented for them. Antarctica has no national flag, so it has none. Kosovo is XK, the
   user-assigned code Natural Earth, flag-icons and the European Commission use.

   Nothing here is fetched at run time; the inputs are the two files named on the command line. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [srcPath, flagPkg] = process.argv.slice(2);
if (!srcPath || !flagPkg) { console.error("usage: node tools/build-world-countries.mjs <ne_110m_admin_0_countries.geojson> <flag-icons package dir>"); process.exit(2); }

const NO_FLAG = new Set(["AQ"]);
const raw = readFileSync(srcPath);
const sha256 = createHash("sha256").update(raw).digest("hex");
const src = JSON.parse(raw);
const r2 = (n) => Math.round(n * 100) / 100;
const code = (v) => (typeof v === "string" && /^[A-Z]{2,3}$/.test(v) ? v : null);

function ringArea(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); }
function bboxOf(rings) { let w = 180, s = 90, e = -180, n = -90; for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } return [r2(w), r2(s), r2(e), r2(n)]; }
/* drop consecutive duplicates that rounding creates; keep rings closed and at least 4 points */
function cleanRing(ring) { const out = []; for (const [x, y] of ring) { const p = [r2(x), r2(y)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); } const a = out[0], z = out[out.length - 1]; if (a && (a[0] !== z[0] || a[1] !== z[1])) out.push([a[0], a[1]]); return out.length >= 4 ? out : null; }

const features = [];
const flags = [];
for (const f of src.features) {
  const p = f.properties;
  const a2 = code(p.ISO_A2_EH), a3 = code(p.ISO_A3_EH) || code(p.ADM0_A3);
  const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map(cleanRing).filter(Boolean)).filter((poly) => poly.length);
  const main = polys.slice().sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  const flag = !!a2 && !NO_FLAG.has(a2) && existsSync(join(flagPkg, "flags/4x3", a2.toLowerCase() + ".svg"));
  if (flag) flags.push(a2);
  features.push({
    type: "Feature",
    properties: {
      a2, a3, name: p.NAME, continent: p.CONTINENT, region: p.REGION_UN, subregion: p.SUBREGION,
      label: [r2(p.LABEL_X), r2(p.LABEL_Y)], rank: p.LABELRANK, flag,
      bbox: bboxOf(polys.flat()), main_bbox: bboxOf(main),
    },
    geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys },
  });
}
features.sort((a, b) => String(a.properties.a3).localeCompare(String(b.properties.a3)));

const out = {
  type: "FeatureCollection",
  source: "Natural Earth 1:110m Cultural Vectors, Admin 0 – Countries (ne_110m_admin_0_countries), naturalearthdata.com",
  version: "Natural Earth v5.1.2 (nvkelso/natural-earth-vector tag v5.1.2, geojson/ne_110m_admin_0_countries.geojson)",
  source_sha256: sha256,
  licence: "Public domain (Natural Earth terms of use: https://www.naturalearthdata.com/about/terms-of-use/). No permission needed; credit given anyway.",
  flags: "flag-icons 7.5.0 by Panayiotis Lipiridis (lipis), MIT licence: assets/flags/LICENSE-flag-icons.txt",
  generated_by: "tools/build-world-countries.mjs",
  precision: "coordinates rounded to 0.01 degree",
  borders_note: "Natural Earth shows de facto boundaries. Drawing a border is not a statement on any dispute.",
  features,
};
mkdirSync(join(ROOT, "data/geo"), { recursive: true });
writeFileSync(join(ROOT, "data/geo/world-countries-110m.json"), JSON.stringify(out) + "\n");

mkdirSync(join(ROOT, "assets/flags/4x3"), { recursive: true });
for (const a2 of flags) copyFileSync(join(flagPkg, "flags/4x3", a2.toLowerCase() + ".svg"), join(ROOT, "assets/flags/4x3", a2.toLowerCase() + ".svg"));
copyFileSync(join(flagPkg, "LICENSE"), join(ROOT, "assets/flags/LICENSE-flag-icons.txt"));
console.log(`${features.length} countries, ${flags.length} flags, source sha256 ${sha256}`);
