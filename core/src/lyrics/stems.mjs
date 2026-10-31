/* McCluster stems: every instrument of a track, kept private.
 *
 * The separator stage (separate.py, Demucs htdemucs_6s, else htdemucs) writes
 * vocals / drums / bass / guitar / piano / other plus an instrumental mix and a
 * manifest. Stems are the owner's unreleased material, so they never enter the
 * public repository: they go to the private bucket `mcc-gated-audio` under
 * stems/<track_key>/<stem>.<ext>, and the manifest goes to the service-role-only
 * table public.music_stem_sets (supabase/pending/20261031190000_music_stem_sets_v1.sql).
 * The owner hears and downloads them through music-access (operator-stems-*),
 * which signs short-lived URLs only for the house operator.
 *
 * Format: 320 kbps MP3 by default (measured: 18-46 MB for all seven files of a
 * 1-2.5 minute track). FLAC is lossless but roughly twice that or more per track
 * (16-bit stereo PCM is ~10 MB/min per stem before compression); stems here are for
 * listening, practice, remix sketches and handing to an engineer, who can ask
 * for a lossless re-run (STEMS_FORMAT=flac) of one track.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STEMS_BUCKET = 'mcc-gated-audio';
export const KNOWN_STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other', 'instrumental'];
const KEY = /^(?:[a-z0-9][a-z0-9-]{0,79}|ct-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav' };

export function stemsKeyValid(key) { return KEY.test(String(key || '')); }
export function stemPath(trackKey, file) { return `stems/${trackKey}/${file}`; }

/** Problems with a separator manifest; [] when it is safe to store and serve. */
export function validateStemsManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest must be an object'];
  if (m.separator !== 'demucs') errs.push('separator must be demucs');
  if (!['htdemucs_6s', 'htdemucs', 'htdemucs_ft', 'mdx_extra'].includes(m.model)) errs.push(`unknown model ${m.model}`);
  if (!['mp3', 'flac', 'wav'].includes(m.format)) errs.push(`unknown format ${m.format}`);
  if (!(m.seconds > 0)) errs.push('seconds must be positive');
  if (!Array.isArray(m.stems) || !m.stems.length) { errs.push('stems must be a non-empty array'); return errs; }
  const names = m.stems.map((s) => s.stem);
  for (const need of ['vocals', 'instrumental']) if (!names.includes(need)) errs.push(`missing ${need} stem`);
  if (m.model === 'htdemucs_6s') for (const need of ['drums', 'bass', 'guitar', 'piano', 'other']) if (!names.includes(need)) errs.push(`htdemucs_6s must give ${need}`);
  if (new Set(names).size !== names.length) errs.push('stems repeat');
  for (const s of m.stems) {
    const at = `stem ${s.stem}`;
    if (!KNOWN_STEMS.includes(s.stem)) errs.push(`${at}: unknown stem`);
    if (s.file !== `${s.stem}.${m.format}`) errs.push(`${at}: file must be ${s.stem}.${m.format}`);
    if (!(Number.isInteger(s.bytes) && s.bytes > 0)) errs.push(`${at}: bytes must be a positive integer`);
    if (!/^[0-9a-f]{64}$/.test(String(s.sha256 || ''))) errs.push(`${at}: sha256 required`);
    if (!(Math.abs((s.seconds || 0) - m.seconds) <= 0.5)) errs.push(`${at}: length differs from the track`);
    for (const k of ['peak_dbfs', 'rms_dbfs']) if (s[k] != null && !(typeof s[k] === 'number' && s[k] <= 0.5)) errs.push(`${at}: ${k} must be dBFS (<= 0)`);
  }
  return errs;
}

function env() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required to store stems');
  return { url, key };
}

/** Upload every stem of one separation and record its manifest. Idempotent (upsert). */
export async function storeStems({ trackKey, dir, manifest, source = 'shelf', creatorTrackId = null }, deps = {}) {
  if (!stemsKeyValid(trackKey)) throw new Error(`bad stems key ${trackKey}`);
  const errs = validateStemsManifest(manifest);
  if (errs.length) throw new Error(`stems manifest refused: ${errs.slice(0, 4).join('; ')}`);
  const _fetch = deps.fetch || fetch;
  const _read = deps.readFile || readFile;
  const { url, key } = deps.env || env();
  const auth = { apikey: key, authorization: `Bearer ${key}` };
  const stored = [];
  for (const s of manifest.stems) {
    const body = await _read(join(dir, s.file));
    const path = stemPath(trackKey, s.file);
    const res = await _fetch(`${url}/storage/v1/object/${STEMS_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': MIME[manifest.format], 'x-upsert': 'true', 'cache-control': 'private, max-age=0' },
      body,
    });
    if (!res.ok) throw new Error(`stem upload refused (${s.stem}): ${res.status}`);
    stored.push({ ...s, path });
  }
  const row = {
    track_key: trackKey, source, creator_track_id: creatorTrackId,
    separator: manifest.separator, model: manifest.model, format: manifest.format,
    seconds: manifest.seconds, manifest: { ...manifest, stems: stored, bucket: STEMS_BUCKET },
    status: 'ready', updated_at: new Date().toISOString(),
  };
  const res = await _fetch(`${url}/rest/v1/music_stem_sets?on_conflict=track_key`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`stems manifest write refused: ${res.status}`);
  return { trackKey, stems: stored.length, bytes: stored.reduce((a, s) => a + s.bytes, 0) };
}
