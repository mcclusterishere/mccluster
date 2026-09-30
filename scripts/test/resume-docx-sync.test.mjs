/* The Word résumé is generated from its page by scripts/resume-docx.py and
   committed. An edit to the page that is not followed by a re-run would
   deploy a Word file that still says the old thing, and the Word file is
   the one recruiters upload. This reads the committed .docx (a zip) and
   fails if any heading, skill line or job bullet on the page is missing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

function zipEntry(buf, name) {
  // central directory → local header → data (deflate or stored)
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : data;
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error(`${name} not found`);
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const flat = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

for (const [page, file] of [
  ['resume-it-support.html', 'assets/resume/matthew-mccluster-resume-it-support.docx']
]) {
  test(`${file} says everything ${page} says`, async () => {
    const html = (await readFile(page, 'utf8')).split('<main')[1].split('</main>')[0];
    const xml = zipEntry(await readFile(file), 'word/document.xml').toString('utf8');
    const docText = decode(xml.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+/g, ' ');
    const lines = [
      ...[...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => flat(m[1])),
      /* single facts and bullets; a job's own <li> wraps a whole block and is
         covered by its title and its bullets */
      ...[...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].filter((m) => !m[1].includes('class="yr"')).map((m) => flat(m[1])),
      ...[...html.matchAll(/<span class="ti">([\s\S]*?)<\/span>/g)].map((m) => flat(m[1]))
    ];
    assert.ok(lines.length > 30, 'could not read the page');
    const missing = lines.filter((l) => !docText.includes(l));
    assert.deepEqual(missing, [], `the Word résumé is stale; run: python3 scripts/resume-docx.py ${page} ${file}`);
  });
}
