#!/usr/bin/env node
/* PUBLISH A GATED MASTER.
   ============================================================
   The preview cut is committed to this repo and ships with the site. The
   master is not, and must never be: this is a static host, and a file in
   assets/ is public the second it deploys. This script puts the master in
   the private bucket instead, which is the only place the gate is real.

   Run it from the repo root with the service key in the environment. The
   key is never printed, never written to a file, and never committed:

     SUPABASE_SERVICE_ROLE_KEY=... \
       node scripts/publish-gated-track.mjs ~/Music/niggy-nigg.mp3 niggy-nigg

   The second argument is the track slug, which must match the "object"
   path in data/albums.json. Pass --check to verify what is already up
   there without uploading anything.

   Apply supabase/migrations/20260918230000_gated_audio.sql first, or the
   bucket this writes to does not exist yet.
   ============================================================ */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const SB = process.env.SUPABASE_URL || 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'mcc-gated-audio';

const TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

function die(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const rest = args.filter((a) => a !== '--check');
const [file, slug] = rest;

if (!SRV) {
  die('SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      'Export it for this one command; do not put it in a file or a commit.');
}
if (!slug) die('Usage: node scripts/publish-gated-track.mjs <file> <slug> [--check]');

/* The object path the player asks for. data/albums.json carries the same
   string, and if the two ever drift the row says "Unavailable" rather than
   pretending to be locked — so keep them equal. */
const object = `${slug}/${slug}${file ? extname(file) : '.mp3'}`;

async function head() {
  const r = await fetch(`${SB}/storage/v1/object/info/${BUCKET}/${object}`, {
    headers: { apikey: SRV, authorization: `Bearer ${SRV}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) die(`Could not read ${object}: ${r.status} ${await r.text()}`);
  return r.json();
}

if (check) {
  const info = await head();
  console.log(info
    ? `present: ${BUCKET}/${object} (${info.size} bytes, ${info.contentType || 'unknown type'})`
    : `absent:  ${BUCKET}/${object} — the row will read "Unavailable" until this is uploaded`);
  process.exit(0);
}

if (!file) die('Usage: node scripts/publish-gated-track.mjs <file> <slug> [--check]');

const type = TYPES[extname(file).toLowerCase()];
if (!type) die(`Unsupported audio type: ${extname(file) || basename(file)}`);

const bytes = await readFile(file).catch(() => die(`Cannot read ${file}`));

const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${object}`, {
  method: 'POST',
  headers: {
    apikey: SRV,
    authorization: `Bearer ${SRV}`,
    'content-type': type,
    'cache-control': 'private, max-age=0, no-store',
    'x-upsert': 'true',
  },
  body: bytes,
});

if (!r.ok) die(`Upload failed: ${r.status} ${(await r.text()).slice(0, 500)}`);

console.log(`uploaded ${bytes.length} bytes to ${BUCKET}/${object}`);
console.log('The bucket is private. Signed-in listeners get a signed URL; nobody else gets one.');
