#!/usr/bin/env node
/* PRIM3 city levels — fetch a small OpenStreetMap extract and keep only what the city grid needs.

     node tools/prim3-city/fetch-osm-extract.mjs                       # the committed default area
     node tools/prim3-city/fetch-osm-extract.mjs --id my-area --bbox W,S,E,N [--name "…"]

   Writes tools/prim3-city/data/<id>.osm-extract.json: building footprints and parts (with the tags
   that carry height), water, coastline, piers, parks and street centrelines, as lon/lat rings.

   Source order: the Overpass API (the read-only service OSM asks bulk readers to use), then the main
   OSM API's /map call (fine for one small box, once; never loop it, see
   https://operations.osmfoundation.org/policies/api/). Keep boxes under ~0.6 km on a side.

   Licence: the output is a derivative database of OpenStreetMap, © OpenStreetMap contributors,
   available under the Open Database License 1.0 (https://www.openstreetmap.org/copyright). It stays
   ODbL: keep the attribution block in the file, and publish this file (or the means to rebuild it)
   alongside any level made from it. Dependency-free on purpose (Node ≥ 18 fetch). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'mccluster-prim3-city-grid/0.1 (+https://github.com/mcclusterishere/mccluster)';

// Paulus Hook / Exchange Place, Jersey City, on the New Jersey side of the Upper New York Bay.
export const DEFAULT_AREA = {
  id: 'jersey-city-paulus-hook',
  name: 'Paulus Hook / Exchange Place, Jersey City NJ',
  bbox: [-74.0385, 40.7118, -74.0315, 40.7172] // W, S, E, N (WGS84)
};

const KEEP_TAGS = ['building', 'building:part', 'height', 'min_height', 'building:levels', 'building:min_level',
  'roof:levels', 'roof:height', 'name', 'addr:housenumber', 'addr:street', 'natural', 'water', 'man_made',
  'leisure', 'landuse', 'highway', 'layer', 'bridge', 'tunnel', 'location'];

const ent = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], ent(m[2])]));

/* Minimal OSM XML (API 0.6) reader: nodes, ways, multipolygon relations. */
export function parseOsmXml(xml) {
  const nodes = new Map(), ways = new Map(), relations = [];
  for (const m of xml.matchAll(/<node\s([^>]*?)\/?>/g)) { const a = attrs(m[1]); nodes.set(a.id, [Number(a.lon), Number(a.lat)]); }
  for (const m of xml.matchAll(/<way\s([^>]*)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1]);
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => r[1]);
    const tags = Object.fromEntries([...m[2].matchAll(/<tag\s([^>]*)\/>/g)].map((t) => { const x = attrs(t[1]); return [x.k, x.v]; }));
    ways.set(a.id, { id: a.id, refs, tags });
  }
  for (const m of xml.matchAll(/<relation\s([^>]*)>([\s\S]*?)<\/relation>/g)) {
    const a = attrs(m[1]);
    const members = [...m[2].matchAll(/<member\s([^>]*)\/>/g)].map((t) => attrs(t[1]));
    const tags = Object.fromEntries([...m[2].matchAll(/<tag\s([^>]*)\/>/g)].map((t) => { const x = attrs(t[1]); return [x.k, x.v]; }));
    relations.push({ id: a.id, members, tags });
  }
  const coords = (w) => { const out = w.refs.map((r) => nodes.get(r)); return out.every(Boolean) ? out : null; };
  return { ways: [...ways.values()].map((w) => ({ id: w.id, tags: w.tags, coords: coords(w) })), relations, wayById: (id) => { const w = ways.get(id); return w ? { ...w, coords: coords(w) } : null; } };
}

/* Overpass JSON (out geom) reader into the same shape. */
export function parseOverpassJson(json) {
  const ways = [], relations = [], byId = new Map();
  for (const e of json.elements || []) {
    if (e.type === 'way') { const w = { id: String(e.id), tags: e.tags || {}, coords: (e.geometry || []).map((g) => [g.lon, g.lat]) }; ways.push(w); byId.set(w.id, w); }
    if (e.type === 'relation') relations.push({ id: String(e.id), tags: e.tags || {}, members: (e.members || []).map((m) => ({ type: m.type, ref: String(m.ref), role: m.role, coords: (m.geometry || []).map((g) => [g.lon, g.lat]) })) });
  }
  return { ways, relations, wayById: (id) => byId.get(id) || null };
}

function classify(tags) {
  if (tags['building:part']) return 'building:part';
  if (tags.building) return 'building';
  if (tags.natural === 'coastline') return 'coastline';
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water';
  if (tags.man_made === 'pier') return 'pier';
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass' || tags.leisure === 'playground' || tags.leisure === 'pitch') return 'park';
  if (tags.highway && !['corridor', 'elevator', 'proposed', 'construction'].includes(tags.highway) && tags.tunnel !== 'yes' && tags.location !== 'underground') return 'road';
  return null;
}
const round = (c) => c.map(([x, y]) => [Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]);
const pick = (tags) => Object.fromEntries(KEEP_TAGS.filter((k) => tags[k] != null).map((k) => [k, tags[k]]));
const closed = (c) => c && c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];

/* Reduce a parsed extract to the features the city grid reads. Deterministic order (by kind, then id). */
export function reduceExtract(parsed, area, { source, fetchedAt }) {
  const features = [];
  const inRelation = new Set();
  for (const r of parsed.relations) {
    if (r.tags.type !== 'multipolygon') continue;
    const kind = classify(r.tags);
    if (!kind || kind === 'road' || kind === 'coastline') continue;
    const rings = { outer: [], inner: [] };
    let complete = true;
    for (const m of r.members) {
      if (m.type !== 'way') continue;
      const c = m.coords && m.coords.length ? m.coords : parsed.wayById(m.ref)?.coords;
      if (!c || !closed(c)) { complete = false; break; } // multi-way rings are not stitched in this prototype
      (m.role === 'inner' ? rings.inner : rings.outer).push(round(c));
      inRelation.add(m.ref);
    }
    if (!complete || !rings.outer.length) continue; // an incomplete relation (members outside the box) is skipped, not guessed
    features.push({ osm: `relation/${r.id}`, kind, tags: pick(r.tags), outer: rings.outer, inner: rings.inner });
  }
  for (const w of parsed.ways) {
    const kind = classify(w.tags);
    if (!kind || !w.coords || w.coords.length < 2) continue;
    if (kind === 'road' || kind === 'coastline') features.push({ osm: `way/${w.id}`, kind, tags: pick(w.tags), line: round(w.coords) });
    else if (closed(w.coords)) features.push({ osm: `way/${w.id}`, kind, tags: pick(w.tags), outer: [round(w.coords)], inner: [] });
  }
  const ORDER = ['building', 'building:part', 'water', 'coastline', 'pier', 'park', 'road'];
  features.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Number(a.osm.split('/')[1]) - Number(b.osm.split('/')[1]));
  return {
    schema: 'mccluster.prim3.city-extract.v1',
    id: area.id,
    name: area.name,
    bbox: area.bbox,
    source,
    fetchedAt,
    licence: {
      name: 'Open Database License 1.0 (ODbL)',
      url: 'https://opendatacommons.org/licenses/odbl/1-0/',
      attribution: '© OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      note: 'Derivative database of OpenStreetMap. Share-alike: any public derivative database (including tactical grids made from it) is offered under ODbL with this attribution.'
    },
    features
  };
}

async function fetchText(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers || {}) }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

export async function fetchArea(area) {
  const [w, s, e, n] = area.bbox;
  const q = `[out:json][timeout:60];(way(${s},${w},${n},${e})[building];way(${s},${w},${n},${e})["building:part"];way(${s},${w},${n},${e})[natural];way(${s},${w},${n},${e})[man_made=pier];way(${s},${w},${n},${e})[leisure];way(${s},${w},${n},${e})[landuse=grass];way(${s},${w},${n},${e})[highway];relation(${s},${w},${n},${e})[type=multipolygon];);out geom tags;`;
  try {
    const body = await fetchText('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) });
    return { parsed: parseOverpassJson(JSON.parse(body)), source: 'overpass-api.de' };
  } catch (err) {
    console.warn(`Overpass unavailable (${err.message}); falling back to one OSM API /map call`);
    const xml = await fetchText(`https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`);
    return { parsed: parseOsmXml(xml), source: 'api.openstreetmap.org/api/0.6/map' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const area = opt('--bbox') ? { id: opt('--id') || 'area', name: opt('--name') || opt('--id') || 'area', bbox: opt('--bbox').split(',').map(Number) } : DEFAULT_AREA;
  const [w, s, e, n] = area.bbox;
  if (!(e > w && n > s) || (e - w) > 0.012 || (n - s) > 0.009) throw new Error('bbox must be W,S,E,N and smaller than ~1 km on a side');
  const { parsed, source } = await fetchArea(area);
  const out = reduceExtract(parsed, area, { source, fetchedAt: new Date().toISOString() });
  const file = join(HERE, 'data', `${area.id}.osm-extract.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out) + '\n');
  const count = (k) => out.features.filter((f) => f.kind === k).length;
  console.log(`${file}: ${count('building')} buildings, ${count('building:part')} parts, ${count('road')} roads, ${count('water')} water, ${count('pier')} piers (${source})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((err) => { console.error(err.message); process.exit(1); });
