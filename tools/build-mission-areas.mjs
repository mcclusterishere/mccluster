/* THIS SITE'S AREAS FOR A MISSION CATALOG: data/missions/drawdown-areas.json, derived from the frozen catalog
   (data/missions/drawdown/missions.json, each mission's "sector": the nine groups this site wrote the missions under, not
   Project Drawdown's sectors).

   The catalog folder stays out of the published site (D10, docs/control-plane/WORLD-MISSION-SOURCES.md: a default adopted
   pending Matthew's confirmation), so the World's source page (js/world-source-profile.js) reads this small map instead: the
   area names and, for each mission slug, the index of its area. No title, description, quotation, credit or image address.

     node tools/build-mission-areas.mjs           write the map
     node tools/build-mission-areas.mjs --check   exit 1 when the committed map differs from the catalog's

   Areas are ordered by how many missions the catalog puts in each, then by name; slugs are sorted. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CATALOG_PATH = 'data/missions/drawdown/missions.json';
export const MAP_PATH = 'data/missions/drawdown-areas.json';
export const SCHEMA = 'mission-areas/v1';
export const GROUPING = "This site's own grouping of the missions; not a source's sectors.";
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const AREA = /^[^\u0000-\u001f\u007f]{1,40}$/;

/** The map for a parsed catalog: { schema, catalog, generated_from, grouping, areas, slugs }. Throws on a mission without a
    usable slug or area, or a slug seen twice. */
export function buildAreaMap(catalog) {
  if (!catalog || !Array.isArray(catalog.missions) || !catalog.missions.length) throw new Error('the catalog has no missions');
  const counts = new Map(), seen = new Set();
  for (const m of catalog.missions) {
    if (!m || typeof m.slug !== 'string' || !SLUG.test(m.slug)) throw new Error(`a mission without a usable slug: ${JSON.stringify(m && m.slug)}`);
    if (seen.has(m.slug)) throw new Error(`slug ${m.slug} twice`);
    seen.add(m.slug);
    if (typeof m.sector !== 'string' || !AREA.test(m.sector) || m.sector !== m.sector.trim()) throw new Error(`${m.slug} has no usable area`);
    counts.set(m.sector, (counts.get(m.sector) || 0) + 1);
  }
  const areas = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'en'));
  const index = new Map(areas.map((a, i) => [a, i]));
  const slugs = {};
  for (const m of [...catalog.missions].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) slugs[m.slug] = index.get(m.sector);
  return { schema: SCHEMA, catalog: typeof catalog.catalog === 'string' ? catalog.catalog : 'drawdown', generated_from: CATALOG_PATH, grouping: GROUPING, areas, slugs };
}

/** The file's text: the head on one line each, the areas on one line, one slug per line. */
export function renderAreaMap(map) {
  const head = ['schema', 'catalog', 'generated_from', 'grouping'].map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`);
  const slugs = Object.keys(map.slugs).map((s, i, all) => `    ${JSON.stringify(s)}: ${map.slugs[s]}${i < all.length - 1 ? ',' : ''}`);
  return ['{', ...head, `  "areas": ${JSON.stringify(map.areas)},`, '  "slugs": {', ...slugs, '  }', '}', ''].join('\n');
}

export function readCatalog(root = ROOT) {
  return JSON.parse(readFileSync(new URL(CATALOG_PATH, `file://${root.endsWith('/') ? root : root + '/'}`), 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = renderAreaMap(buildAreaMap(readCatalog()));
  const target = new URL(MAP_PATH, `file://${ROOT}`);
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (committed !== text) {
      console.error(`${MAP_PATH} differs from ${CATALOG_PATH}: run node tools/build-mission-areas.mjs`);
      process.exit(1);
    }
    console.log(`${MAP_PATH} matches ${CATALOG_PATH}`);
  } else {
    writeFileSync(target, text);
    console.log(`wrote ${MAP_PATH} (${Buffer.byteLength(text)} bytes)`);
  }
}
