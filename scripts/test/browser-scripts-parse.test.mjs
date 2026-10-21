/* EVERY BROWSER SCRIPT MUST PARSE.
   A single stray escape (a literal "\n" pasted into js/mnet.js) made the
   whole Action Network script a syntax error in production: the browser
   drops the file, so every button on the page went dead, and no other test
   noticed because they read the file as text. This compiles each classic
   script the site serves, and checks pages for escapes pasted as text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
async function walk(dir) {
  const out = [];
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('every script in js/ compiles', async () => {
  const broken = [];
  for (const f of await walk('js')) {
    const src = await readFile(join(ROOT, f), 'utf8');
    if (/^\s*(import|export)\s/m.test(src)) continue; // ES modules are checked by their own importers
    try { new vm.Script(src, { filename: f }); } catch (e) { broken.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(broken, [], `these scripts would be dropped by the browser:\n${broken.join('\n')}`);
});

test('no page carries an escape sequence pasted as text between tags', async () => {
  const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  const hits = [];
  for (const f of pages) {
    const html = await readFile(join(ROOT, f), 'utf8');
    if (/>\\n\s*</.test(html)) hits.push(f);
  }
  assert.deepEqual(hits, [], `literal "\\n" shows up as text on: ${hits.join(', ')}`);
});
