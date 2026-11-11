#!/usr/bin/env node
/* ============================================================
   STEMS — every instrument of a track, separated locally.

     node tools/lyrics/stems.mjs assets/audio/hundun-b-side.mp3 [--out DIR]
          [--model htdemucs_6s|htdemucs] [--format mp3|flac] [--threads N] [--upload]

   Writes vocals, drums, bass, guitar, piano, other (htdemucs_6s; four stems
   with htdemucs), instrumental.<ext>, vocals16k.wav and manifest.json to
   DIR (default ~/.cache/mccluster/stems/<slug>, never inside the published
   checkout: stems are the owner's unreleased material).
   --upload stores them privately (mcc-gated-audio/stems/<slug>/ + the
   music_stem_sets manifest); needs SUPABASE_URL and SUPABASE_SECRET_KEY.
   Same separator as McCluster Core's stems_separate / lyrics_align executors.
   ============================================================ */
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demucsSeparator } from '../../core/src/lyrics/pipeline.mjs';
import { storeStems, validateStemsManifest } from '../../core/src/lyrics/stems.mjs';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const a = process.argv.slice(2); const o = { _: [] };
  for (let i = 0; i < a.length; i++) { if (a[i] === '--upload') o.upload = true; else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i]; else o._.push(a[i]); }
  const audio = o._[0];
  if (!audio) { console.error('usage: stems.mjs AUDIO [--out DIR] [--model M] [--format F] [--upload]'); process.exit(1); }
  const slug = basename(audio, extname(audio));
  const out = o.out || join(process.env.LYRICS_STEMS_DIR || join(homedir(), '.cache', 'mccluster', 'stems'), slug);
  await mkdir(out, { recursive: true });
  const t0 = Date.now();
  const { manifest } = await demucsSeparator({ model: o.model, format: o.format || 'mp3', threads: o.threads ? Number(o.threads) : undefined }).run(audio, out);
  const errs = validateStemsManifest(manifest);
  if (errs.length) { console.error('manifest refused: ' + errs.join('; ')); process.exit(1); }
  const bytes = manifest.stems.reduce((s, x) => s + x.bytes, 0);
  console.log(`${slug}: ${manifest.stems.length} files (${manifest.model}, ${manifest.format}) ${(bytes / 1e6).toFixed(1)} MB in ${out}; separate ${manifest.timing.separate_seconds}s, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (o.upload) console.log(JSON.stringify(await storeStems({ trackKey: slug, dir: out, manifest, source: 'shelf' })));
}
