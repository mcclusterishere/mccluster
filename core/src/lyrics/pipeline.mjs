/* McCluster lyric machine: the whole pipeline for one audio file.
 *
 *   1 separator   Demucs (htdemucs_6s, else htdemucs): all stems + vocals16k.wav
 *   2 recogniser  faster-whisper on the isolated vocal: words with rough times
 *   3 mapper      align.mjs: the owner's sheet lines placed against what was heard
 *                 (or, with no sheet, the heard words broken into lines)
 *   4 aligner     wav2vec2 CTC forced alignment of each line's words to the vocal
 *   5 tidy        times made monotonic, inside the audio, words inside their lines
 *
 * Every stage is pluggable (an object with a name and run()), and every stage can
 * be skipped: no separator -> the mix goes to the recogniser; no aligner -> the
 * recogniser's word times stand. The JSON records which models made it and how
 * long each stage took, so the production runner can be sized from real numbers.
 *
 * Used by tools/lyrics/transcribe.mjs (offline / CI) and the Core executor
 * (core/src/executors/lyrics-align.mjs). Nothing here talks to a paid API.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLyrics, validateLyrics, tidy } from './align.mjs';
import { buildImported } from './import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = {
  separate: join(HERE, 'separate.py'),
  asr: join(HERE, 'asr_faster_whisper.py'),
  ctc: join(HERE, 'ctc_align.py'),
};
/* large-v3-turbo is the production default; medium.en is the CPU/disk-light fallback */
export const DEFAULT_ASR_MODEL = process.env.LYRICS_ASR_MODEL || 'large-v3-turbo';
export const DEFAULT_SEPARATOR_MODEL = process.env.LYRICS_SEPARATOR_MODEL || 'htdemucs_6s';

export function run(cmd, args, { timeoutMs = 60 * 60 * 1000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
    const out = []; const err = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err.push(d); if (err.length > 200) err.shift(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(-800)}`));
    });
  });
}

const exists = (p) => access(p).then(() => true, () => false);

export async function probeDuration(audio) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { timeoutMs: 60_000 });
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`could not read the duration of ${audio}`);
  return d;
}

const py = (o) => o.python || process.env.LYRICS_PYTHON || 'python3';

/* ---- stage implementations (each replaceable) ---- */

export const demucsSeparator = (opts = {}) => ({
  name: 'demucs',
  model: opts.model || DEFAULT_SEPARATOR_MODEL,
  /** -> {vocals, manifest} ; writes every stem into outDir */
  async run(audio, outDir) {
    const args = ['-I', SCRIPTS.separate, audio, outDir, '--model', this.model, '--format', opts.format || 'mp3'];
    if (opts.vocalsOnly) args.push('--vocals-only');
    if (opts.threads) args.push('--threads', String(opts.threads));
    const manifest = JSON.parse(await run(py(opts), args));
    return { vocals: join(outDir, 'vocals16k.wav'), manifest };
  },
});

export const whisperRecogniser = (opts = {}) => ({
  name: 'faster-whisper',
  model: opts.model || DEFAULT_ASR_MODEL,
  async run(audio, { promptText = '' } = {}) {
    let dir = null;
    const args = ['-I', SCRIPTS.asr, audio, '--model', this.model];
    if (opts.threads) args.push('--threads', String(opts.threads));
    try {
      /* The sheet as initial_prompt is optional: on separated vocals it made Whisper
         collapse a sung intro into one segment (Hundun), so it is off by default. */
      if (opts.prompt && promptText.trim()) {
        dir = await mkdtemp(join(tmpdir(), 'mcc-lyrics-'));
        await writeFile(join(dir, 'sheet.txt'), promptText, 'utf8');
        args.push('--prompt-file', join(dir, 'sheet.txt'));
      }
      return JSON.parse(await run(py(opts), args));
    } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
  },
});

export const ctcAligner = (opts = {}) => ({
  name: 'wav2vec2-ctc',
  model: 'WAV2VEC2_ASR_BASE_960H',
  async run(doc, vocals) {
    const dir = await mkdtemp(join(tmpdir(), 'mcc-ctc-'));
    try {
      await writeFile(join(dir, 'in.json'), JSON.stringify(doc));
      await run(py(opts), ['-I', SCRIPTS.ctc, join(dir, 'in.json'), vocals, join(dir, 'out.json')], { env: opts.threads ? { LYRICS_THREADS: String(opts.threads) } : undefined });
      return JSON.parse(await readFile(join(dir, 'out.json'), 'utf8'));
    } finally { await rm(dir, { recursive: true, force: true }); }
  },
});

/** After word refinement: lines take their bounds from their words, then the usual tidy. */
export function finalize(doc, duration) {
  for (const l of doc.timed.line) {
    if (!Array.isArray(l.words) || !l.words.length) continue;
    l.words.sort((a, b) => a.begin - b.begin);
    l.begin = l.words[0].begin;
    l.end = Math.max(...l.words.map((w) => w.end));
  }
  doc.timed.line.sort((a, b) => a.begin - b.begin);
  tidy(doc.timed.line, duration);
  return doc;
}

/**
 * Audio (+ optional sheet or timed import) -> validated lyrics document.
 * @param {object} p
 * @param {string} p.audio
 * @param {string} [p.sheetText]   owner lyric sheet (plain text)
 * @param {object} [p.imported]    parsed TTML/LRC ({lines}) — line times are kept
 * @param {object} [p.asr]         cached recogniser output (skips stage 2)
 * @param {string} [p.vocals]      cached vocal stem (skips stage 1)
 * @param {object} [p.stages]      {separator, recogniser, aligner}; null disables one
 * @param {string} [p.workDir]     where stems go (gitignored / private), default a temp dir
 */
export async function transcribe({ audio, sheetText = '', imported = null, title = '', asr = null, vocals = null, stages = {}, workDir = null, generatedAt, duration: knownDuration = null, log = () => {} } = {}) {
  const timing = {};
  const t = async (k, fn) => { const s = Date.now(); try { return await fn(); } finally { timing[k] = Math.round((Date.now() - s) / 100) / 10; } };
  const duration = knownDuration ?? await probeDuration(audio);
  const separator = stages.separator === undefined ? demucsSeparator() : stages.separator;
  const recogniser = stages.recogniser === undefined ? whisperRecogniser() : stages.recogniser;
  const aligner = stages.aligner === undefined ? ctcAligner() : stages.aligner;
  const tmp = workDir ? null : await mkdtemp(join(tmpdir(), 'mcc-stems-'));
  const outDir = workDir || tmp;
  const engine = {};
  let stems = null;
  try {
    let listenTo = audio;
    if (vocals && await exists(vocals)) { listenTo = vocals; engine.separator = `${separator?.name || 'cached'} ${separator?.model || ''}`.trim(); }
    else if (separator) {
      try {
        const r = await t('separate_seconds', () => separator.run(audio, outDir));
        listenTo = r.vocals; stems = r.manifest; engine.separator = `${separator.name} ${separator.model}`;
      } catch (e) { log(`separator unavailable, using the full mix: ${e.message}`); engine.separator = 'none (fallback: full mix)'; }
    } else engine.separator = 'none';

    let heard = asr;
    if (!heard && recogniser) heard = await t('asr_seconds', () => recogniser.run(listenTo, { promptText: sheetText }));
    engine.asr = heard ? `${heard.engine || recogniser?.name} ${heard.model || recogniser?.model || ''}`.trim() : 'none';

    let doc = await t('map_seconds', async () => imported
      ? buildImported({ parsed: imported, asr: heard, duration, title, generatedAt })
      : buildLyrics({ asr: heard, sheet: sheetText, duration, title, generatedAt }));

    if (aligner && listenTo !== audio) {
      try { doc = await t('align_seconds', () => aligner.run(doc, listenTo)); engine.aligner = `${aligner.name} ${aligner.model}`; }
      catch (e) { log(`aligner unavailable, keeping recogniser word times: ${e.message}`); engine.aligner = 'none (fallback: whisper word times)'; }
    } else engine.aligner = aligner ? 'none (no isolated vocal)' : 'none';

    finalize(doc, duration);
    doc.machine = { ...(doc.machine || {}), engine, timing: { ...(doc.machine?.timing || {}), ...timing } };
    delete doc.machine.model;
    if (doc.machine.timing.align_seconds == null) delete doc.machine.timing.align_seconds;
    doc.machine.mismatched_lines = doc.timed.line.filter((l) => l.mismatch).length;
    const errs = validateLyrics(doc, { duration });
    if (errs.length) throw new Error(`lyrics failed validation: ${errs.slice(0, 5).join('; ')}`);
    return { doc, asr: heard, duration, stems, stemsDir: stems ? outDir : null };
  } finally {
    if (tmp && !stems) await rm(tmp, { recursive: true, force: true });
  }
}
