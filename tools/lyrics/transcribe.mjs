#!/usr/bin/env node
/* ============================================================
   THE LYRIC MACHINE — offline / CI front end.

   One track:
     node tools/lyrics/transcribe.mjs assets/audio/hundun-b-side.mp3 \
       --out data/lyrics/hundun-b-side.json \
       [--sheet data/lyrics/src/hundun-b-side.txt | sheet.docx] [--title "Hundun (B-Side)"]

   Every shelf track that has audio but no lyrics yet (what CI runs):
     node tools/lyrics/transcribe.mjs --missing [--wire]
       --wire also writes the new "lyrics" path into data/albums.json.

   Stages (core/src/lyrics/pipeline.mjs): Demucs separation -> faster-whisper on
   the vocal -> sheet/line mapping -> wav2vec2 CTC word alignment -> tidy.

   Options:
     --sheet FILE      owner lyric sheet (.txt or .docx); when given, the words are
                       the owner's and only the timing comes from the audio
                       (source "aligned"); otherwise source "auto".
     --timed FILE      DistroKid TTML or LRC: line times kept, words aligned (source "imported")
     --sheet-out FILE  save the sheet as plain text (data/lyrics/src/<slug>.txt)
     --stems-dir DIR   keep every stem + manifest here (default ~/.cache/mccluster/stems/<slug>,
                       or $LYRICS_STEMS_DIR/<slug>; never inside the published checkout)
     --asr FILE        reuse saved recogniser output instead of running it
     --vocals FILE     reuse a separated 16 kHz vocal instead of separating again
     --save-asr FILE   keep the recogniser output (scratch, never committed)
     --asr-model NAME  faster-whisper model (default large-v3-turbo, LYRICS_ASR_MODEL)
     --separator NAME  demucs model (default htdemucs_6s; htdemucs = 4 stems)
     --no-separate / --no-align   skip a stage
     --prompt          pass the sheet to Whisper as initial_prompt (off by default)
     --threads N       CPU threads per stage
     --python PATH     python with faster-whisper/demucs/torchaudio (LYRICS_PYTHON)

   The output is the data/lyrics JSON every player reads, marked
   reviewed:false until the owner signs it off in Control → Create → Music.
   Same engine as the Core executor: core/src/lyrics/.
   ============================================================ */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { transcribe, demucsSeparator, whisperRecogniser, ctcAligner } from '../../core/src/lyrics/pipeline.mjs';
import { sheetToText } from '../../core/src/lyrics/sheet.mjs';
import { parseTimedLyrics } from '../../core/src/lyrics/import.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['missing', 'wire', 'force', 'no-separate', 'no-align', 'prompt'].includes(k)) o[k] = true;
      else o[k] = argv[++i];
    } else o._.push(a);
  }
  return o;
}

const exists = (p) => access(p).then(() => true, () => false);
export const slugOf = (src) => basename(src, extname(src));

async function readSheet(path) {
  if (!path) return '';
  return sheetToText(await readFile(path), path);
}

function serialise(doc) {
  /* one line per word keeps diffs readable when the owner nudges a time */
  return JSON.stringify(doc, null, 1) + '\n';
}

function stagesFrom(o) {
  const threads = o.threads ? Number(o.threads) : undefined;
  return {
    separator: o['no-separate'] ? null : demucsSeparator({ model: o.separator, python: o.python, threads }),
    recogniser: whisperRecogniser({ model: o['asr-model'], python: o.python, threads, prompt: !!o.prompt }),
    aligner: o['no-align'] ? null : ctcAligner({ python: o.python, threads }),
  };
}

async function one(o) {
  const { audio, out } = o;
  const sheetText = await readSheet(o.sheet);
  if (o['sheet-out'] && sheetText) { await mkdir(dirname(o['sheet-out']), { recursive: true }); await writeFile(o['sheet-out'], sheetText.trim() + '\n'); }
  const imported = o.timed ? parseTimedLyrics(await readFile(o.timed, 'utf8'), o.timed) : null;
  const cached = o.asr ? JSON.parse(await readFile(o.asr, 'utf8')) : null;
  /* stems are the owner's unreleased material: outside the checkout by default (never published) */
  const workDir = o['stems-dir'] || join(process.env.LYRICS_STEMS_DIR || join(homedir(), '.cache', 'mccluster', 'stems'), slugOf(audio));
  await mkdir(workDir, { recursive: true });
  const { doc, asr: heard, stems } = await transcribe({
    audio, sheetText, imported, title: o.title || '', asr: cached, vocals: o.vocals, workDir,
    stages: stagesFrom(o), log: (m) => console.error(m),
  });
  if (o['save-asr']) { await mkdir(dirname(o['save-asr']), { recursive: true }); await writeFile(o['save-asr'], JSON.stringify(heard)); }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, serialise(doc));
  const m = doc.machine;
  console.log(`${out}: ${doc.source}, ${doc.timed.line.length} lines, confidence ${m.confidence ?? '-'}, ${m.mismatched_lines} flagged, ` +
    `engine ${JSON.stringify(m.engine)}, timing ${JSON.stringify(m.timing)}${stems ? `, ${stems.stems.length} stems in ${workDir}` : ''}`);
  return doc;
}

async function missing(o) {
  const { wire, force } = o;
  const albumsPath = join(ROOT, 'data/albums.json');
  const albums = JSON.parse(await readFile(albumsPath, 'utf8'));
  const made = [];
  for (const a of albums.albums) for (const t of a.tracks) {
    if (!t.src || t.gated || (t.lyrics && !force)) continue;
    const slug = slugOf(t.src);
    const out = `data/lyrics/${slug}.json`;
    if (await exists(join(ROOT, out)) && !force) continue;
    let sheet = null;
    for (const ext of ['.txt', '.docx']) if (await exists(join(ROOT, `data/lyrics/src/${slug}${ext}`))) { sheet = join(ROOT, `data/lyrics/src/${slug}${ext}`); break; }
    await one({ ...o, audio: join(ROOT, t.src), out: join(ROOT, out), sheet, title: t.title });
    if (wire) t.lyrics = out;
    made.push(out);
  }
  if (wire && made.length) await writeFile(albumsPath, JSON.stringify(albums, null, 2) + '\n');
  console.log(made.length ? `made ${made.length}: ${made.join(', ')}` : 'every shelf track with audio already has lyrics');
  return made;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  const job = o.missing
    ? missing(o)
    : (o._[0] && o.out)
      ? one({ ...o, audio: o._[0] })
      : Promise.reject(new Error('usage: transcribe.mjs AUDIO --out FILE [--sheet FILE] | --missing [--wire]'));
  job.catch((e) => { console.error(e.message || e); process.exit(1); });
}
