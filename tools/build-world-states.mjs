#!/usr/bin/env node
/* THE STATES ON THE WORLD GLOBE (owner, 2026-10-20: "even within the countries clearly defined states within the countries,
   drawn accurately"). Lines only: where one state, province or region meets another inside a country. No names, codes or
   data travel with them.

     node tools/build-world-states.mjs        (after tools/build-world-countries.mjs; no download, no arguments)

   Source: the repo's own data/geo/admin1/<CC>.json (Natural Earth 1:10m Admin 1 States, Provinces, v5.1.2, public domain,
   built by tools/build-admin1-boundaries.mjs). Those were simplified for the whole world at once with the topology kept,
   so two neighbouring states hold the very same points along the edge they share. An edge held by two states of one
   country is a state line; an edge held once is a coast or the country's border (the border layer draws those), and an
   edge between states of two different countries is a country border too.

   Which country a state belongs to is where its label point falls on data/geo/world-countries-10m.json, the borders the
   globe draws, so the states agree with them (Natural Earth's states file files Crimea under Russia; on the US-view
   countries it is in Ukraine, so its line with Kherson is drawn as a line inside Ukraine). A label point within NEAR of
   its own country's drawn shape stays with that country: at this simplification San Marino's municipalities, Monaco,
   Liechtenstein's and a few border villages' points sit a few hundred metres across a line, and are not Italy's, France's
   or Switzerland's states.

   The level drawn is the one people call the country's states. Natural Earth's first level is that almost everywhere
   (US states, Canadian provinces, Indian states, Russian subjects …). Where it is a finer unit grouped into the
   well-known level, the grouping is drawn instead: GROUP below names the field (g: Natural Earth's region, u: the
   constituent unit), and a unit without one keeps its own line.

   Writes data/geo/world-states/<A2>.json ({c, lines}) and data/geo/world-states/index.json (each country's box, so the
   globe fetches only the countries in view). A line is whole hundredths of a degree, [x0, y0, dx1, dy1, ...], like
   data/geo/world-borders-10m.json.

   And data/geo/world-state-areas/<A2>.json, for the same countries: each state as a shape with its name (owner,
   2026-10-21: "once you've selected a country ... select a state thereafter ... double tapping the state"). The globe
   fetches one when its country is selected, to know which state a double tap landed in. A grouped country's state is
   its group (France's regions, England, Scotland …), made of its units' shapes, so the shape tapped is the one the lines
   draw. Rings as in data/geo/world-countries-10m.json: open, in hundredths of a degree, each point a step from the one
   before. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/geo/admin1');
const OUT = path.join(ROOT, 'data/geo/world-states');
const AREAS = path.join(ROOT, 'data/geo/world-state-areas');
/* France's departments → its regions, Italy's provinces → its regions, Spain's provinces → its autonomous communities,
   the Philippines' provinces → its regions, the United Kingdom's councils → England, Scotland, Wales, Northern Ireland … */
/* where Natural Earth's name would read as another state: its District of Columbia is "Washington" */
const NAMES = { 'US-DC': 'Washington, D.C.' };
export const GROUP = { FR: 'g', IT: 'g', ES: 'g', PH: 'g', GB: 'u', SI: 'g', LV: 'g', UG: 'g', MK: 'g', AZ: 'g', MT: 'g', BF: 'g', GN: 'g', XK: 'g', MW: 'g', LK: 'g' };

const C = createRequire(import.meta.url)(path.join(ROOT, 'js/world-countries.js'));
const countries = C.decode(JSON.parse(readFileSync(path.join(ROOT, 'data/geo/world-countries-10m.json'), 'utf8')));
const index = JSON.parse(readFileSync(path.join(SRC, 'index.json'), 'utf8'));

/* degrees from a point to a country's drawn shape (its nearest edge) */
const NEAR = 0.5;
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0, x = ax + t * dx - px, y = ay + t * dy - py; return Math.sqrt(x * x + y * y); }
function distTo(f, x, y) { let m = Infinity; const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const poly of polys) for (const r of poly) for (let i = 0; i + 1 < r.length; i++) m = Math.min(m, segDist(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1])); return m; }
const pts = (ring) => { const out = []; for (let i = 0; i + 1 < ring.length; i += 2) out.push(Math.round(ring[i] * 100) * 100000 + Math.round(ring[i + 1] * 100)); return out; };
const X = (k) => Math.round(k / 100000), Y = (k) => k - Math.round(k / 100000) * 100000;
const owners = [];           /* state number → { cc, group } */
const units = new Map();     /* group → { cc, key, name, type, polys: [[ring of point keys, ...holes], ...] } */
const edges = new Map();     /* "a|b" (a < b) → [state numbers] */
for (const file of Object.keys(index.countries).sort()) {
  const d = JSON.parse(readFileSync(path.join(SRC, file + '.json'), 'utf8')), own = countries.find((f) => f.properties.a2 === d.c);
  for (const s of d.states) {
    const here = Array.isArray(s.l) ? C.countryAt(countries, s.l[0], s.l[1]) : null, other = here && here.properties.a2;
    const cc = other && other !== d.c && !(own && distTo(own, s.l[0], s.l[1]) < NEAR) ? other : d.c;
    const field = GROUP[cc];
    const n = owners.push({ cc, group: cc + ':' + ((field && s[field]) || s.k) }) - 1;
    /* the state's shape, under the name the lines draw it by */
    const unit = owners[n].group, a = units.get(unit) || units.set(unit, { cc, key: field && s[field] ? unit : s.k, name: (field && s[field]) || NAMES[s.k] || s.n || s.k, type: field && s[field] ? null : s.t || null, polys: [] }).get(unit);
    for (const poly of s.p || []) { const rings = poly.map(pts).map((r) => (r.length > 1 && r[0] === r[r.length - 1] ? r.slice(0, -1) : r)).filter((r) => r.length >= 3); if (rings.length) a.polys.push(rings); }
    for (const poly of s.p || []) for (const ring of poly) {
      const p = pts(ring);
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if (a === b) continue;
        const key = a < b ? a + '|' + b : b + '|' + a;
        const list = edges.get(key);
        if (!list) edges.set(key, [n]); else if (!list.includes(n)) list.push(n);
      }
    }
  }
}

/* the state lines of each country, as segments */
const segs = new Map();      /* cc → [[a, b], ...] */
for (const [key, list] of edges) {
  if (list.length < 2) continue;
  const o = list.map((n) => owners[n]);
  if (o.some((x) => x.cc !== o[0].cc)) continue;
  if (o.every((x) => x.group === o[0].group)) continue;
  const [a, b] = key.split('|').map(Number);
  (segs.get(o[0].cc) || segs.set(o[0].cc, []).get(o[0].cc)).push([a, b]);
}

/* segments → the fewest lines: walk from every end or fork, then whatever is left is a loop */
function chain(list) {
  const adj = new Map(), used = new Set(), lines = [];
  const add = (a, b, i) => { (adj.get(a) || adj.set(a, []).get(a)).push([b, i]); };
  list.forEach(([a, b], i) => { add(a, b, i); add(b, a, i); });
  const walk = (start) => {
    for (const [first, i] of adj.get(start)) {
      if (used.has(i)) continue;
      used.add(i);
      const line = [start, first];
      let at = first;
      while (adj.get(at).length === 2) {
        const next = adj.get(at).find(([, j]) => !used.has(j));
        if (!next) break;
        used.add(next[1]); line.push(next[0]); at = next[0];
      }
      lines.push(line);
    }
  };
  for (const [p, nb] of adj) if (nb.length !== 2) walk(p);
  for (const [p] of adj) walk(p);
  return lines;
}
function delta(line) { const out = []; let px = 0, py = 0; for (const k of line) { const x = X(k), y = Y(k); out.push(x - px, y - py); px = x; py = y; } return out; }

if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(path.join(OUT, f));
mkdirSync(OUT, { recursive: true });
const out = {};
let total = 0;
for (const cc of [...segs.keys()].sort()) {
  const lines = chain(segs.get(cc));
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, points = 0;
  for (const line of lines) for (const k of line) { const x = X(k) / 100, y = Y(k) / 100; points++; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const body = JSON.stringify({ c: cc, lines: lines.map(delta) }) + '\n';
  writeFileSync(path.join(OUT, cc + '.json'), body);
  out[cc] = { bbox: [w, s, e, n].map((v) => Math.round(v * 100) / 100), lines: lines.length, points, bytes: Buffer.byteLength(body) };
  total += Buffer.byteLength(body);
}
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  source: 'Natural Earth 1:10m Admin 1 States, Provinces (naturalearthdata.com), v5.1.2, via data/geo/admin1 (tools/build-admin1-boundaries.mjs)',
  license: 'Public domain (Natural Earth terms of use: "No permission is needed to use Natural Earth"). Made with Natural Earth.',
  generated_by: 'tools/build-world-states.mjs',
  use: 'The World globe: lines only, fetched one country at a time for the countries in view (js/world-countries.js).',
  grouped: GROUP,
  format: 'each <A2>.json: {c, lines}; a line is whole hundredths of a degree, [x0, y0, dx1, dy1, ...]',
  total_bytes: total,
  countries: out,
}) + '\n');

/* the states as shapes, for the countries whose lines are drawn */
if (existsSync(AREAS)) for (const f of readdirSync(AREAS)) rmSync(path.join(AREAS, f));
mkdirSync(AREAS, { recursive: true });
let areaBytes = 0, areaCount = 0;
for (const cc of Object.keys(out)) {
  const states = [...units.values()].filter((u) => u.cc === cc && u.polys.length).sort((a, b) => a.key.localeCompare(b.key)).map((u) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of u.polys) for (const k of poly[0]) { const x = X(k) / 100, y = Y(k) / 100; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return { properties: { key: u.key, name: u.name, type: u.type, bbox: [w, s, e, n].map((v) => Math.round(v * 100) / 100) }, p: u.polys.map((poly) => poly.map(delta)) };
  });
  const body = JSON.stringify({ c: cc, format: 'states: each state\'s properties (key, name, type, bbox) and p, its polygons [outer ring, ...holes]; a ring is open, in hundredths of a degree, [x0, y0, dx1, dy1, ...] (HuCountries.decode in js/world-countries.js)', states }) + '\n';
  writeFileSync(path.join(AREAS, cc + '.json'), body);
  areaBytes += Buffer.byteLength(body); areaCount += states.length;
}
console.log(`${Object.keys(out).length} countries with state lines, ${total} bytes; ${areaCount} state shapes, ${areaBytes} bytes`);
