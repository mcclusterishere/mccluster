#!/usr/bin/env node
/* PUBLISH A GATED MASTER, IN EVERY FORMAT IT IS OFFERED IN.
   ============================================================
   The preview cut is committed to this repo and ships with the site. The
   master is not, and must never be: this is a static host, and a file in
   assets/ is public the second it deploys. This script puts the master in
   the private bucket instead, which is the only place the gate is real.

   It reads data/albums.json, finds the track's gated block, and produces
   EVERY format that block offers from the one master you hand it. The
   registry is the source of truth: add a format there and it gets made
   here. Nothing is transcoded twice and nothing is invented — if the
   registry does not ask for a ringtone, none is uploaded.

   Run it from the repo root with the service key in the environment. The
   key is never printed, never written to a file, and never committed:

     SUPABASE_SERVICE_ROLE_KEY=... \
       node scripts/publish-gated-track.mjs ~/Music/niggy-nigg.wav niggy-nigg

   --check verifies what is already up there and uploads nothing.

   Needs ffmpeg on PATH for anything but a straight mp3 upload. Apply
   supabase/migrations/20260918230000_gated_audio.sql first, or the bucket
   this writes to does not exist yet.
   ============================================================ */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';

const run = promisify(execFile);

const SB = process.env.SUPABASE_URL || 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'mcc-gated-audio';

/* What each format is, and how ffmpeg is asked for it. RINGTONE is the one
   with a real constraint: iOS will not install an .m4r longer than 40
   seconds, so it is cut at 30 and faded, which is also what a ringtone
   should sound like. The rest are the whole record. */
const RECIPES = {
  mp3: { type: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100'] },
  wav: { type: 'audio/wav', args: ['-c:a', 'pcm_s16le', '-ar', '44100'] },
  flac: { type: 'audio/flac', args: ['-c:a', 'flac'] },
  m4a: { type: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '256k'] },
  m4r: {
    type: 'audio/mp4',
    args: ['-t', '30', '-af', 'afade=t=out:st=29:d=1', '-c:a', 'aac', '-b:a', '192k', '-f', 'ipod'],
  },
};

function die(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const [file, slug] = args.filter((a) => !a.startsWith('--'));

if (!slug) die('Usage: node scripts/publish-gated-track.mjs <master> <slug> [--check]');
if (!SRV) {
  die('SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      'Export it for this one command; do not put it in a file or a commit.');
}

/* The registry decides which formats exist. Reading it here is what keeps
   the uploader and the player from drifting apart. */
const { albums } = JSON.parse(await readFile('data/albums.json', 'utf8'));
const track = albums
  .flatMap((a) => a.tracks || [])
  .find((t) => t.gated && String(t.gated.object || '').split('/')[0] === slug);
if (!track) die(`No gated track in data/albums.json whose object path starts with "${slug}/".`);

const formats = track.gated.formats?.length
  ? track.gated.formats
  : [{ ext: extname(track.gated.object).slice(1) || 'mp3', object: track.gated.object, label: 'MP3' }];

async function info(object) {
  const path = object.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${SB}/storage/v1/object/info/${BUCKET}/${path}`, {
    headers: { apikey: SRV, authorization: `Bearer ${SRV}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) die(`Could not read ${object}: ${r.status} ${await r.text()}`);
  return r.json();
}

if (check) {
  for (const f of formats) {
    const got = await info(f.object);
    console.log(got
      ? `present  ${f.object}  (${got.size} bytes)`
      : `ABSENT   ${f.object}  — "${f.label}" will read Unavailable`);
  }
  process.exit(0);
}

if (!file) die('Usage: node scripts/publish-gated-track.mjs <master> <slug> [--check]');
const master = await readFile(file).catch(() => die(`Cannot read ${file}`));

const needsFfmpeg = formats.some((f) => f.ext !== extname(file).slice(1).toLowerCase());
if (needsFfmpeg) {
  await run('ffmpeg', ['-version']).catch(() => die(
    'ffmpeg is not on PATH, and the registry asks for formats that need it:\n  ' +
    formats.map((f) => f.ext).join(', ') +
    '\nInstall ffmpeg (brew install ffmpeg) and run this again.'));
}

const work = await mkdtemp(join(tmpdir(), 'gated-'));
try {
  for (const f of formats) {
    const recipe = RECIPES[f.ext];
    if (!recipe) die(`No recipe for .${f.ext} — add one to RECIPES or drop it from the registry.`);

    let bytes;
    if (f.ext === extname(file).slice(1).toLowerCase()) {
      bytes = master;                                   /* already that format */
    } else {
      const out = join(work, `${basename(slug)}.${f.ext}`);
      await run('ffmpeg', ['-v', 'error', '-y', '-i', file, ...recipe.args, out]);
      bytes = await readFile(out);
    }

    const path = f.object.split('/').map(encodeURIComponent).join('/');
    const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SRV,
        authorization: `Bearer ${SRV}`,
        'content-type': recipe.type,
        'cache-control': 'private, max-age=0, no-store',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!r.ok) die(`Upload of ${f.object} failed: ${r.status} ${(await r.text()).slice(0, 400)}`);
    console.log(`uploaded ${String(bytes.length).padStart(9)} bytes  ${f.object}  (${f.label})`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log('\nThe bucket is private. Signed-in listeners get a signed URL; nobody else gets one.');
