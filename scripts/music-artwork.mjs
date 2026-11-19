#!/usr/bin/env node
/* THE COVERS THE LOCK SCREEN IS HANDED, AS THEY ARE (music slice M2).

   js/now-playing.js declares every cover a player may hand the lock screen with the size
   and the type of the file itself: WebKit ranks artwork by its declared size (square, 512 px
   ideal, 128 px least) and a browser may skip a type it cannot draw. The album used to call
   every cover image/jpeg and one script re-labelled a single image as 96, 192 and 512 px
   (music map 03, EXT-6). This reads each cover's bytes (PNG, JPEG, WebP, GIF headers: no
   dependency, nothing decoded) and writes the registry between the ARTWORK BEGIN and
   ARTWORK END lines of js/now-playing.js.

   The covers are the albums' art in data/albums.json and the engine's fallback, the M
   (assets/img/m-mark.png). Each is the owner's supplied file, used whole: nothing here
   crops, scales, re-encodes or draws one (AGENTS.md, hard rule 10). A cover that is not
   square is listed; only Matthew can supply a square one.

     node scripts/music-artwork.mjs           write the registry
     node scripts/music-artwork.mjs --check   exit 1 if it is missing, stale or names a file
                                              that is not there (the root suite and CI run this) */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'js/now-playing.js';
const BEGIN = /^(\s*)\/\* ARTWORK BEGIN[^\n]*\n/m, END = /^\s*\/\* ARTWORK END \*\/\n/m;
const FALLBACK = ['assets/img/m-mark.png'];

export function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'image/jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { type: 'image/webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'image/webp', w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { type: 'image/webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (buf.length > 10 && buf.toString('latin1', 0, 4) === 'GIF8') return { type: 'image/gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  return null;
}

export function covers(root = ROOT) {
  const albums = JSON.parse(readFileSync(join(root, 'data/albums.json'), 'utf8')).albums || [];
  return [...new Set(albums.map(a => a && a.art).filter(a => typeof a === 'string' && /^assets\/img\/[a-z0-9._-]+$/i.test(a)).concat(FALLBACK))].sort();
}

export function registry(root = ROOT) {
  const out = [], problems = [];
  for (const path of covers(root)) {
    const file = join(root, path);
    if (!existsSync(file)) { problems.push(`${path}: named by data/albums.json, not in the repository`); continue; }
    const info = imageInfo(readFileSync(file));
    if (!info || !info.w || !info.h) { problems.push(`${path}: not a PNG, JPEG, WebP or GIF this script can read`); continue; }
    out.push({ path, sizes: `${info.w}x${info.h}`, type: info.type, square: info.w === info.h });
  }
  return { entries: out, problems };
}

export function render(entries, indent = '  ') {
  const lines = entries.map((e, i) => `${indent}  ${JSON.stringify(e.path)}: { sizes: ${JSON.stringify(e.sizes)}, type: ${JSON.stringify(e.type)} }${i < entries.length - 1 ? ',' : ''}`);
  return `${indent}var ARTWORK = {\n${lines.join('\n')}\n${indent}};\n`;
}

function block(src) {
  const b = BEGIN.exec(src), e = END.exec(src);
  if (!b || !e || e.index < b.index) return null;
  return { indent: b[1], start: b.index + b[0].length, end: e.index };
}

export function check(root = ROOT) {
  const src = readFileSync(join(root, TARGET), 'utf8');
  const at = block(src);
  const { entries, problems } = registry(root);
  if (!at) return { ok: false, problems: problems.concat([`${TARGET}: no ARTWORK BEGIN / ARTWORK END block`]), entries };
  const want = render(entries, at.indent), have = src.slice(at.start, at.end);
  if (have !== want) problems.push(`${TARGET}: the artwork registry is stale; run node scripts/music-artwork.mjs`);
  return { ok: problems.length === 0, problems, entries };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const r = check();
    for (const p of r.problems) console.error('FAIL', p);
    if (r.ok) console.log(`artwork registry is current (${r.entries.length} covers; not square: ${r.entries.filter(e => !e.square).map(e => e.path).join(', ') || 'none'})`);
    process.exit(r.ok ? 0 : 1);
  }
  const src = readFileSync(join(ROOT, TARGET), 'utf8');
  const at = block(src);
  if (!at) { console.error(`${TARGET}: no ARTWORK BEGIN / ARTWORK END block`); process.exit(1); }
  const { entries, problems } = registry();
  for (const p of problems) console.error('FAIL', p);
  if (problems.length) process.exit(1);
  writeFileSync(join(ROOT, TARGET), src.slice(0, at.start) + render(entries, at.indent) + src.slice(at.end));
  console.log(`wrote ${entries.length} covers into ${TARGET}`);
  for (const e of entries.filter(x => !x.square)) console.log(`not square (a square variant can only come from Matthew): ${e.path} ${e.sizes}`);
}
