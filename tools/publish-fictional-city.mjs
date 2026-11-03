#!/usr/bin/env node
// One authored lore manifest is installed by OVH with core/. Publish only the public-safe fictional
// file to the static site. The screenplay reader is a generated view of existing creative canon.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlaces, bindCity, ORIGINAL_BUSINESS_IDS } from '../js/fictional-city/places.mjs';
import { buildChunks } from '../js/fictional-city/chunks.mjs';
import { validateCityExtensions } from '../js/fictional-city/content.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildCityExport(root = ROOT) {
  const source = 'core/data/fictional-city/district.v1.json';
  const bytes = await readFile(resolve(root, source));
  const manifest = JSON.parse(bytes);
  // Newer lore may add businesses and residents; the original eight, 24 residents and the garage must remain.
  if (!/^mccluster\.fictional-city\/v\d+$/.test(manifest.schema) || manifest.npcs.length < 24 || !ORIGINAL_BUSINESS_IDS.every(id => manifest.businesses.some(b => b.id === id)) || manifest.garageCrew?.length !== 3) throw new Error('Invalid city manifest');
  // Geography: exported byte-for-byte like the lore; every lore parcel reference must resolve.
  const placesSource = 'core/data/fictional-city/places.v1.json';
  const placesBytes = await readFile(resolve(root, placesSource));
  const places = validatePlaces(JSON.parse(placesBytes));
  const runtime = bindCity(manifest, places);
  const unresolved = [...runtime.manifest.businesses, ...runtime.manifest.npcs, ...(manifest.parcels || []), ...(manifest.families || [])]
    .flatMap(e => [e.parcelId, e.homeParcelId, e.residenceParcelId, ...(e.routeAnchors || [])].filter(Boolean))
    .filter(id => !runtime.index.resolve(id));
  if (unresolved.length) throw new Error('Lore names unknown places: ' + [...new Set(unresolved)].join(', '));
  const { index, chunks: cityChunks } = buildChunks(places);
  const chunkFiles = [...cityChunks.values()].map(c => {
    const body = Buffer.from(JSON.stringify(c) + '\n');
    return { id: c.id, path: `chunks/${c.id}.json`, body, sha256: createHash('sha256').update(body).digest('hex') };
  });
  for (const entry of index.chunks) { const f = chunkFiles.find(x => x.id === entry.id); entry.bytes = f.body.length; entry.sha256 = f.sha256; }
  const indexBytes = Buffer.from(JSON.stringify(index) + '\n');
  // Schema revision 2 adds parcel-bound expansion lore beside the unchanged v1 arrays.
  if (manifest.schemaRevision === 2 && !(['expansionNeighborhoods', 'parcels', 'expansionBusinesses', 'expansionNpcs', 'families', 'expansionItems']
    .every(key => Array.isArray(manifest[key]) && manifest[key].length) && manifest.families.length === 10)) throw new Error('Invalid city expansion');
  validateCityExtensions(manifest);
  const canon = JSON.parse(await readFile(resolve(root, 'docs/music/whip-equipped/CANON.json'), 'utf8'));
  const screenplay = await readFile(resolve(root, 'docs/music/whip-equipped/SCREENPLAY.md'), 'utf8');
  const roadYears = await readFile(resolve(root, 'docs/music/whip-equipped/ROAD-YEARS.md'), 'utf8');
  const section = (text, heading, next) => {
    const begin = text.indexOf('## ' + heading + '\n');
    if (begin < 0) throw new Error('Missing screenplay section: ' + heading);
    const start = begin + heading.length + 4;
    const end = next ? text.indexOf('## ' + next + '\n', start) : text.length;
    if (end < start) throw new Error('Missing screenplay section boundary');
    return text.slice(start, end).trim();
  };
  const chunks = [...screenplay.matchAll(/^# (\d+ .+|Earlier interlude .+)\n([\s\S]*?)(?=^# |$(?![\s\S]))/gm)];
  if (chunks.length !== canon.document_sequence.length) throw new Error('Chapter count disagrees with canon');
  const chapters = chunks.map((match, i) => ({
    id: canon.document_sequence[i], title: match[1],
    before: section(match[2], 'Before the song', 'Music video'),
    video: section(match[2], 'Music video', 'After the song'),
    after: section(match[2], 'After the song')
  }));
  if (chapters.at(-2).id !== 'tears-wont-fall' || chapters.at(-1).id !== 'salvage-title') throw new Error('Ending order changed');
  const story = {
    schema: 'mccluster.whip-city-reader/v1', revision: canon.revision,
    source: 'docs/music/whip-equipped/SCREENPLAY.md',
    sourceSha256: createHash('sha256').update(screenplay).digest('hex'),
    chapterContract: canon.chapter_contract, chapters, roadYears
  };
  return { bytes, manifest, story, sha256: createHash('sha256').update(bytes).digest('hex'),
    placesBytes, places, placesSha256: createHash('sha256').update(placesBytes).digest('hex'),
    chunkIndex: index, chunkIndexBytes: indexBytes, chunkIndexSha256: createHash('sha256').update(indexBytes).digest('hex'), chunkFiles };
}
export async function publishCity(root = ROOT) {
  const result = await buildCityExport(root);
  const out = resolve(root, 'data/fictional-city');
  await mkdir(out, { recursive: true });
  // Do not reserialize: Core and browser use the identical bytes and SHA256.
  await writeFile(resolve(out, 'district.v1.json'), result.bytes);
  await writeFile(resolve(out, 'whip-story.v1.json'), JSON.stringify(result.story) + '\n');
  await writeFile(resolve(out, 'places.v1.json'), result.placesBytes);
  // Chunks are regenerated whole: a stale chunk from an older layout can never survive a publish.
  await rm(resolve(out, 'chunks'), { recursive: true, force: true });
  await mkdir(resolve(out, 'chunks'), { recursive: true });
  for (const f of result.chunkFiles) await writeFile(resolve(out, f.path), f.body);
  await writeFile(resolve(out, 'chunks/index.v1.json'), result.chunkIndexBytes);
  const m = result.manifest;
  return { manifestSha256: result.sha256, placesSha256: result.placesSha256, chunkIndexSha256: result.chunkIndexSha256, chunks: result.chunkFiles.length,
    businesses: m.businesses.length, newResidents: m.npcs.length,
    expansionBusinesses: m.expansionBusinesses?.length || 0, expansionResidents: m.expansionNpcs?.length || 0,
    families: m.families?.length || 0, parcels: m.parcels?.length || 0, chapters: result.story.chapters.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishCity()));
}
