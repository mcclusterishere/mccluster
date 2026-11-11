/* stems_separate: every instrument of one track, separated and kept private.
 *
 * Input: { track_key, source: "shelf" | "creator", track_id? }
 *   shelf   — a track on matthew.mccluster.org (data/albums.json); the audio is
 *             fetched from the published site (assets/audio/ only)
 *   creator — an uploaded release; the master is downloaded with the service key
 * Runs the separator stage (Demucs htdemucs_6s, else htdemucs), uploads every
 * stem + the instrumental to the private bucket and records the manifest
 * (core/src/lyrics/stems.mjs). Owned weights, no paid API. Queued by Control
 * (music-access operator-stems-queue) or the stems.separate capability.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { rest, buildSupabaseHeaders } from '../supabase.mjs';
import { demucsSeparator } from '../lyrics/pipeline.mjs';
import { storeStems, stemsKeyValid } from '../lyrics/stems.mjs';

const SITE = 'https://matthew.mccluster.org/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = Number(process.env.LYRICS_MAX_MASTER_BYTES || 250 * 1024 * 1024);

async function fetchTo(url, to, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`audio download refused: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) throw new Error('audio larger than the separator accepts');
  await writeFile(to, buf);
}

/** Where to get the audio, checked: shelf audio only from the site's assets/audio/. */
export function shelfAudioUrl(src) {
  const rel = String(src || '');
  if (!/^assets\/audio\/[a-z0-9][a-z0-9-]*\.(mp3|m4a|wav|flac)$/.test(rel)) throw new Error('shelf audio must be assets/audio/<slug>.<ext>');
  return SITE + rel;
}

export async function stemsSeparate(job, deps = {}) {
  const input = job?.input || {};
  const source = input.source === 'creator' ? 'creator' : 'shelf';
  const _rest = deps.rest || rest;
  const _fetchTo = deps.fetchTo || fetchTo;
  const separator = deps.separator || demucsSeparator({ format: process.env.STEMS_FORMAT || 'mp3' });
  const _store = deps.storeStems || storeStems;
  let trackKey, audioUrl, headers = {}, ext, creatorTrackId = null, title;

  if (source === 'creator') {
    const id = String(input.track_id || '').trim();
    if (!UUID.test(id)) throw new Error('stems_separate (creator) requires track_id');
    const { body: rows = [] } = await _rest(`creator_tracks?id=eq.${id}&select=id,title,master_bucket,master_path&limit=1`);
    const t = rows[0];
    if (!t?.master_bucket || !t?.master_path) throw new Error('release has no master to separate');
    trackKey = `ct-${id.toLowerCase()}`; creatorTrackId = id; title = t.title;
    audioUrl = `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(t.master_bucket)}/${t.master_path.split('/').map(encodeURIComponent).join('/')}`;
    headers = buildSupabaseHeaders({ secretKey: process.env.SUPABASE_SECRET_KEY, legacyServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
    if (!headers.authorization) headers.authorization = `Bearer ${headers.apikey}`;
    ext = extname(t.master_path).toLowerCase() || '.audio';
  } else {
    trackKey = String(input.track_key || '').trim();
    if (!stemsKeyValid(trackKey) || trackKey.startsWith('ct-')) throw new Error('stems_separate (shelf) requires track_key = the audio file slug');
    audioUrl = shelfAudioUrl(input.src || `assets/audio/${trackKey}.${input.ext || 'mp3'}`);
    ext = extname(audioUrl);
    title = input.title || trackKey;
  }

  const dir = await mkdtemp(join(tmpdir(), 'mcc-stems-job-'));
  try {
    const audio = join(dir, 'source' + ext.replace(/[^.a-z0-9]/g, ''));
    await _fetchTo(audioUrl, audio, headers);
    const out = join(dir, 'stems');
    const { manifest } = await separator.run(audio, out);
    const stored = await _store({ trackKey, dir: out, manifest, source, creatorTrackId });
    return {
      executor: 'stems_separate:v1',
      summary: `Stems for "${title}": ${stored.stems} files (${manifest.model}), ${(stored.bytes / 1e6).toFixed(1)} MB, private`,
      track_key: trackKey, model: manifest.model, stems: stored.stems, bytes: stored.bytes,
      timing: manifest.timing || null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
