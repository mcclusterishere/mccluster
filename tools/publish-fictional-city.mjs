#!/usr/bin/env node
// One authored lore manifest is installed by OVH with core/. Publish only the public-safe fictional
// file to the static site. The screenplay reader is a generated view of existing creative canon.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityExtensions } from '../js/fictional-city/content.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildCityExport(root = ROOT) {
  const source = 'core/data/fictional-city/district.v1.json';
  const bytes = await readFile(resolve(root, source));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 'mccluster.fictional-city/v1' || manifest.npcs.length !== 24 || manifest.businesses.length !== 8) throw new Error('Invalid city manifest');
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
  return { bytes, manifest, story, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function publishCity(root = ROOT) {
  const result = await buildCityExport(root);
  const out = resolve(root, 'data/fictional-city');
  await mkdir(out, { recursive: true });
  // Do not reserialize: Core and browser use the identical bytes and SHA256.
  await writeFile(resolve(out, 'district.v1.json'), result.bytes);
  await writeFile(resolve(out, 'whip-story.v1.json'), JSON.stringify(result.story) + '\n');
  return { manifestSha256: result.sha256, businesses: result.manifest.businesses.length, newResidents: result.manifest.npcs.length, chapters: result.story.chapters.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishCity()));
}
