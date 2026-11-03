#!/usr/bin/env node
// The globe's Games overlay reads one published file, data/games/world.v1.json. It is derived, never authored:
// the places, destinations and storyline schedules are authored once in docs/universe/universe-registry.json
// (`gamesWorld`), and their scenes come from the canonical story sources the registry names
// (core/data/fictional-city/district.v1.json, docs/music/whip-equipped/*, data/prim3/world-missions.json).
//   node tools/publish-games-world.mjs          write the file
//   node tools/publish-games-world.mjs --check  fail if the committed file is stale
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = 'docs/universe/universe-registry.json';
export const OUTPUT = 'data/games/world.v1.json';

const json = async (root, path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const fail = (msg) => { throw new Error('games world: ' + msg); };
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* the numbered song titles of the approved narrative order (story guide table: | n | Song | basis |) */
function storyGuideTitles(markdown) {
  const at = markdown.indexOf('## Approved narrative order');
  if (at < 0) fail('story guide has no approved narrative order');
  const rows = [...markdown.slice(at).matchAll(/^\| (\d+) \| ([^|]+?) \|/gm)];
  return new Map(rows.map((m) => [Number(m[1]), m[2].trim()]));
}

async function storylineScenes(root, s, gw) {
  const from = s.scenesFrom;
  if (!from) {
    if (!Array.isArray(s.scenes) || !s.scenes.length) fail(s.id + ' has no scenes');
    return { title: s.title, source: s.source, scenes: s.scenes.map((x) => ({ ...x, durationMs: x.durationMs || s.sceneSlotMs, timing: x.durationMs ? 'source' : 'slot' })) };
  }
  if (from.kind === 'fictional-city-story-arc') {
    const city = await json(root, from.source);
    const arc = (city.storyArcs || []).find((a) => a.id === from.arc) || fail('missing story arc ' + from.arc);
    if (arc.neighborhoodId !== s.neighborhood) fail(s.id + ' neighborhood disagrees with its arc');
    const places = new Map(((city.neighborhoods || []).find((n) => n.id === arc.neighborhoodId) || {}).places?.map((p) => [p.id, p]) || []);
    return {
      title: arc.title, source: from.source,
      scenes: arc.beats.map((b) => ({
        id: b.id, title: b.title, act: b.act, summary: b.summary, durationMs: s.sceneSlotMs, timing: 'slot',
        anchor: { frame: 'fictional-city', placeId: b.placeId, place: (places.get(b.placeId) || fail('beat ' + b.id + ' has no place')).name, position: b.position }
      }))
    };
  }
  if (from.kind === 'whip-equipped-chapters') {
    const canon = await json(root, from.source);
    const timing = await json(root, from.timing);
    const titles = storyGuideTitles(await readFile(resolve(root, from.titles), 'utf8'));
    const city = await json(root, from.anchor.source);
    const garage = city.garage && city.garage.id === from.anchor.placeId ? city.garage : fail('missing anchor ' + from.anchor.placeId);
    const tracks = new Map(timing.tracks.map((t) => [t.id, t]));
    return {
      title: canon.project, source: from.source,
      scenes: canon[from.sequence].map((id, i) => {
        const t = tracks.get(id) || fail('no timing for ' + id);
        if (t.core_position !== i + 1) fail('timing order disagrees with canon at ' + id);
        return {
          id: 'whip-' + id, title: titles.get(i + 1) || fail('no story-guide title for chapter ' + (i + 1)), chapter: i + 1,
          durationMs: t.chapter_target_ms, timing: 'source',
          anchor: { frame: 'fictional-city', placeId: garage.id, place: garage.name, position: garage.entrance }
        };
      })
    };
  }
  fail('unknown scene source ' + from.kind);
}

export async function buildGamesWorld(root = ROOT) {
  const registry = await json(root, REGISTRY);
  const gw = registry.gamesWorld || fail('registry has no gamesWorld');
  if (gw.schema !== 'here.games-world/v1') fail('unexpected schema');
  const epoch = Date.parse(gw.scheduleEpoch);
  if (!Number.isFinite(epoch)) fail('bad scheduleEpoch');

  /* the authored tree, copied; imports append real places to it */
  const countries = structuredClone(gw.places).map((c) => ({ ...c, states: c.states.map((st) => ({ ...st, towns: st.towns.map((t) => ({ storylines: [], ...t })) })) }));
  for (const imp of gw.imports || []) {
    if (imp.kind !== 'prim3-world-missions') fail('unknown import ' + imp.kind);
    const doc = await json(root, imp.source);
    for (const m of doc.missions) {
      const at = imp.places[m.id];
      if (!at) continue; // a mission without a mapped place is omitted, never guessed
      const cid = slug(m.country.code);
      let c = countries.find((x) => x.id === cid);
      if (!c) countries.push(c = { id: cid, name: m.country.name, region: m.region, states: [] });
      let st = c.states.find((x) => x.name === at.state);
      if (!st) c.states.push(st = { id: slug(at.state), name: at.state, towns: [] });
      let t = st.towns.find((x) => x.name === at.town);
      if (!t) st.towns.push(t = { id: slug(at.town), name: at.town, lat: m.lat, lon: m.lon, neighborhoods: [], entries: [], storylines: [] });
      t.entries.push({
        id: 'prim3-' + m.id, title: m.title, kind: 'mission', universe: 'prim3-world',
        route: imp.route.replace('{id}', encodeURIComponent(m.id)),
        character: m.character && m.character.name || null,
        place: m.place, status: m.status,
        blurb: { text: m.objective, source: imp.source }
      });
    }
  }
  countries.sort((a, b) => (a.id === 'us' ? -1 : b.id === 'us' ? 1 : a.name.localeCompare(b.name)));
  for (const c of countries) {
    c.states.sort((a, b) => a.name.localeCompare(b.name));
    for (const st of c.states) st.towns.sort((a, b) => a.name.localeCompare(b.name));
  }

  const storylines = [];
  for (const s of gw.storylines) {
    const { title, source, scenes } = await storylineScenes(root, s, gw);
    let offset = 0;
    const timed = scenes.map((x) => { if (!(Number.isInteger(x.durationMs) && x.durationMs > 0)) fail(x.id + ' has no duration'); const o = { ...x, offsetMs: offset }; offset += x.durationMs; return o; });
    storylines.push({ id: s.id, title, town: s.town, neighborhood: s.neighborhood, start: s.start, source, loop: { epoch: gw.scheduleEpoch, periodMs: offset }, scenes: timed });
  }
  return {
    schema: gw.schema,
    note: 'Generated by ' + gw.publisher + ' from ' + REGISTRY + '#/gamesWorld. Do not edit by hand.',
    status: gw.status,
    countries,
    storylines
  };
}

export const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = serialize(await buildGamesWorld());
  const target = resolve(ROOT, OUTPUT);
  if (process.argv.includes('--check')) {
    const now = await readFile(target, 'utf8').catch(() => '');
    if (now !== out) { console.error(OUTPUT + ' is stale: run node tools/publish-games-world.mjs'); process.exit(1); }
    console.log(OUTPUT + ' is current');
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, out);
    console.log('wrote ' + OUTPUT);
  }
}
