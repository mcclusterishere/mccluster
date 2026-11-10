/* The plain-object-path rule: one answer in three deployables.

   A path stored on a row is a pointer somebody wrote. Before the service role
   follows one, it must be a plain relative object path
   (supabase/functions/_shared/storage-object-path.ts). The Edge Functions,
   McCluster Core and the Worker are deployed separately, so each carries the
   rule; this file holds the three copies to the same answer and checks the
   rule against the URL parser itself rather than against a list of examples
   alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeObjectPath as edge } from '../../supabase/functions/_shared/storage-object-path.ts';
import { safeObjectPath as core } from '../../core/src/storage-object-path.mjs';
import { safeObjectPath as worker } from '../../workers/mccluster/src/lib/storage-object-path.js';

const COPIES = { edge, core, worker };
const FILES = {
  edge: 'supabase/functions/_shared/storage-object-path.ts',
  core: 'core/src/storage-object-path.mjs',
  worker: 'workers/mccluster/src/lib/storage-object-path.js',
};
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
/* Written as code points so this file stays plain ASCII and nothing in it is invisible. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);
const E_ACUTE = String.fromCodePoint(0xe9);
const NBSP = String.fromCodePoint(0xa0);
const FULLWIDTH_DOT = String.fromCodePoint(0xff0e);
const FULLWIDTH_SLASH = String.fromCodePoint(0xff0f);
const DIVISION_SLASH = String.fromCodePoint(0x2215);
const RTL_OVERRIDE = String.fromCodePoint(0x202e);
const SMILE = String.fromCodePoint(0x1f600); // one character, two UTF-16 halves
const HIGH_HALF = String.fromCharCode(0xd83d); // either half on its own is not text
const LOW_HALF = String.fromCharCode(0xde00);
const U = '123e4567-e89b-42d3-a456-426614174000';

const PLAIN = [
  'a', 'a/b', 'packs/sound-pack-v1.zip', 'u/1-song.mp3', 'u/1 song.mp3',
  `${U}/${U}-master.wav`, `${U}/${U}.mp4`, `stems/ct-${U}/r20261031184512-7fffff/vocals.mp3`,
  'a..b', '..a', 'a..', '...', '.hidden', 'v1.2/final..mix.zip', 'a/.../b', '. ./a', 'a b', 'a  b/c d',
  'packs/Drum Kit (v2) + extras, [final] & more!.zip', 'a:b', 'a;b', 'a@b=c', '~x', "it's.zip", 'a*b$c',
  `packs/${E_ACUTE}t${E_ACUTE}-2026.zip`, `a${NBSP}b`, NBSP, `${NBSP}a${NBSP}`, `${FULLWIDTH_DOT}${FULLWIDTH_DOT}/x`, `a${SMILE}b`,
];
const REFUSED = [
  undefined, null, 0, 1, true, {}, [], ['a/b'], new String('a/b'),
  '', '/', '//', '.', '..', './x', '../x', 'a/.', 'a/..', 'a/./b', 'a/../b', '../../x', 'a/../../other-bucket/x',
  '/a', 'a/', 'a//b', '/a/b', 'a/b/',
  ' ', '  ', 'a/ /b', ' /a', 'a/ ', '. ', ' .', '.. ', ' ..', ' .. ', ' .. /x', 'a/.. ', 'a/ ./b',
  ' a', 'a ', 'a /b', 'a/ b', 'a. /b', 'packs/sound-pack-v1.zip ', ' packs/sound-pack-v1.zip', 'packs /sound-pack-v1.zip',
  'a\\b', '\\', '..\\x', 'a\\..\\..\\x',
  '%', 'a%b', '%2e', '%2e%2e/x', '%2E%2E/x', '.%2e/x', '%2e./x', 'a%2fb', 'a%2Fb', 'a%00', 'a%25b',
  'a?b', '?', 'a?', 'a#b', '#', 'a#',
  'a\nb', 'a\n', '\na', '.\n./x', 'a\rb', 'a\tb', '.\t./x', 'a\u0000b', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u009fb',
  'a' + LINE_SEPARATOR + 'b', 'a' + PARAGRAPH_SEPARATOR,
  'a' + HIGH_HALF + 'b', 'a' + LOW_HALF + 'b', HIGH_HALF, LOW_HALF + HIGH_HALF, SMILE.slice(0, 1) + '/x', 'x/' + SMILE.slice(1),
];

test('a plain relative object path is accepted by every copy', () => {
  for (const [name, safe] of Object.entries(COPIES)) for (const path of PLAIN) assert.equal(safe(path), true, `${name}: ${JSON.stringify(path)}`);
});

test('anything else is refused by every copy', () => {
  for (const [name, safe] of Object.entries(COPIES)) for (const path of REFUSED) assert.equal(safe(path), false, `${name}: ${typeof path === 'string' ? JSON.stringify(path) : String(path)}`);
});

test('the three copies are the same rule, character for character', () => {
  const rules = Object.fromEntries(Object.entries(FILES).map(([name, file]) => {
    const text = read(file);
    assert.ok(!/[^\x00-\x7f]/.test(text), `${file} is plain ASCII: every special character is written as an escape`);
    return [name, ['NOT_IN_A_NAME', 'NOT_A_SEGMENT', 'LONE_SURROGATE'].map((rule) => new RegExp(`const ${rule} = (\\/.+\\/);`).exec(text)?.[1])];
  }));
  assert.ok(rules.edge.every(Boolean), 'the Edge module states all three rules');
  assert.deepEqual(rules.core, rules.edge, FILES.core);
  assert.deepEqual(rules.worker, rules.edge, FILES.worker);
});

/* ---- the rule against the URL parser ----
   A row path reaches Storage in a URL in two ways in this codebase: encoded
   segment by segment, or placed in the URL as it is (what the Storage client
   does, after dropping leading slashes). For a path the rule accepts, neither
   may reach anything but that same object: the request stays under the
   bucket, gains no query or fragment, and every segment arrives as it was
   written. */
const BASE = 'https://db.test/storage/v1/object/sign/the-bucket';
const PREFIX = ['', 'storage', 'v1', 'object', 'sign', 'the-bucket'];
function sentSegments(href) {
  const url = new URL(href);
  if (url.search || url.hash || url.origin !== 'https://db.test') return null;
  const parts = url.pathname.split('/');
  if (PREFIX.some((p, i) => parts[i] !== p)) return null;
  try { return parts.slice(PREFIX.length).map(decodeURIComponent); } catch { return null; }
}
function sameObject(path) {
  const segments = path.split('/');
  let encodedPath;
  try { encodedPath = segments.map(encodeURIComponent).join('/'); } catch { return 'it cannot be encoded at all'; }
  const encoded = sentSegments(`${BASE}/${encodedPath}`);
  if (!encoded || encoded.join('/') !== path) return `encoded segment by segment it reaches ${JSON.stringify(encoded)}`;
  const raw = sentSegments(`${BASE}/${path.replace(/^\/+/, '')}`);
  if (!raw || raw.length !== segments.length || raw.join('/') !== path) return `placed in the URL as it is it reaches ${JSON.stringify(raw)}`;
  return null;
}

test('the checker itself tells a path that stays put from one that does not', () => {
  assert.equal(sameObject('packs/sound-pack-v1.zip'), null);
  for (const moved of ['../other-bucket/x', 'a/../../other-bucket/x', './x', '%2e%2e/other-bucket/x', 'a\\..\\..\\x', '.\n./x', 'a?b', 'a#b', '.. ', 'a%2fb',
    'packs/file.zip ', 'a' + HIGH_HALF, LOW_HALF + 'a']) {
    assert.notEqual(sameObject(moved), null, JSON.stringify(moved));
  }
});

test('every short string over the characters that matter: accepted means it reaches the same object', () => {
  const alphabet = ['.', '/', '\\', '%', '2', 'e', ' ', '\n', 'a', '?', '#'];
  let checked = 0, accepted = 0;
  const walk = (prefix, depth) => {
    if (prefix) {
      checked += 1;
      if (edge(prefix)) { accepted += 1; assert.equal(sameObject(prefix), null, `accepted ${JSON.stringify(prefix)}`); }
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 5);
  assert.equal(checked, 11 + 11 ** 2 + 11 ** 3 + 11 ** 4 + 11 ** 5);
  assert.ok(accepted > 1000 && accepted < checked, `${accepted} of ${checked} accepted`);
});

test('longer paths built from hostile and ordinary pieces: accepted means it reaches the same object', () => {
  const pieces = ['.', '..', '...', '/', '//', '\\', '%2e', '%2E', '%2f', '%', '%25', ' ', '  ', '\t', '\n', '\r', '\u0000', '\u007f', '\u0085',
    LINE_SEPARATOR, HIGH_HALF, LOW_HALF, SMILE, '?', '#', ';', ':', '@', '&', '=', '+', ',', '~', '!', '*', "'", '(', ')', '[', ']', '{', '}', '<', '>', '"', '`', '^', '|',
    'a', 'B', 'x', '0', '-', '_', 'packs', 'file.zip', E_ACUTE, NBSP, FULLWIDTH_DOT, FULLWIDTH_SLASH, DIVISION_SLASH, RTL_OVERRIDE, U];
  let seed = 0x5eed1e55;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let accepted = 0;
  for (let i = 0; i < 60000; i += 1) {
    let path = '';
    for (let n = 1 + Math.floor(random() * 9); n > 0; n -= 1) path += pieces[Math.floor(random() * pieces.length)];
    if (!edge(path)) continue;
    accepted += 1;
    assert.equal(sameObject(path), null, `accepted ${JSON.stringify(path)}`);
    assert.equal(core(path), true); assert.equal(worker(path), true);
  }
  assert.ok(accepted > 2000, `only ${accepted} generated paths were accepted; the generator no longer exercises the rule`);
});

test('the rule is linear: a megabyte of spaces, slashes or dots answers at once', () => {
  const big = [' '.repeat(1 << 20) + 'a', 'a/' + ' '.repeat(1 << 20) + 'a', '. '.repeat(1 << 19) + 'a', 'a/'.repeat(1 << 19) + 'a', '.'.repeat(1 << 20), 'a' + ' .'.repeat(1 << 19),
    'a' + ' '.repeat(1 << 20) + 'a', HIGH_HALF.repeat(1 << 19) + LOW_HALF.repeat(1 << 19), SMILE.repeat(1 << 19)];
  for (const [name, safe] of Object.entries(COPIES)) {
    const started = performance.now();
    for (const path of big) safe(path);
    assert.ok(performance.now() - started < 2000, `${name} took ${Math.round(performance.now() - started)} ms`);
  }
});
