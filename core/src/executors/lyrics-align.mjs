/* lyrics_align: timed lyrics for an uploaded release, on McCluster Core.
 *
 * Queued by the creator_tracks trigger (supabase/pending/20261031180000_lyrics_machine_v1.sql)
 * or by the owner's "Re-run" in Control → Create → Music → Lyrics (music-access
 * operator-lyrics-queue). Input: { track_id }.
 *
 * 1. read the release (master object, title, optional lyric sheet / TTML / LRC)
 * 2. download the master with Core's service key into a private temp dir
 * 3. core/src/lyrics/pipeline.mjs: Demucs -> faster-whisper -> sheet mapping -> wav2vec2 CTC
 * 4. write creator_tracks.lyrics — only when the current lyrics are empty or
 *    machine-made and unreviewed; lyrics the owner reviewed are never replaced
 *
 * Owned/self-hosted models only (capability lyrics.align, economics owned/compute):
 * no paid API is called, so there is no spend to approve. The written lyrics are
 * reviewed:false, so nothing claims the owner signed them off.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { rest, buildSupabaseHeaders } from '../supabase.mjs';
import { transcribe } from '../lyrics/pipeline.mjs';
import { parseTimedLyrics } from '../lyrics/import.mjs';
import { storeStems } from '../lyrics/stems.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MASTER_BYTES = Number(process.env.LYRICS_MAX_MASTER_BYTES || 250 * 1024 * 1024);

/** May the machine write over what is there now? */
export function mayReplace(current) {
  if (current == null) return true;
  if (typeof current !== 'object') return true;
  if (current.reviewed === true) return false;
  return ['auto', 'aligned', 'imported'].includes(current.source) || !current.timed;
}

/** TTML (after an XML declaration / comments) or LRC: any line that opens with a
 *  [mm:ss] stamp, even when [ti:]/[ar:] metadata comes first. */
export function isTimedText(t) {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<tt[\s>]/.test(t) || /^[ \t]*(\[[a-z]+:[^\]\n]*\][ \t]*)*\[\d+:\d{1,2}(?:[.:]\d+)?\]/im.test(t);
}

/** Sheet text -> what the pipeline wants: a TTML/LRC import, or plain sheet words. */
export function sheetInput(text) {
  const t = String(text || '').trim();
  if (!t) return { sheetText: '', imported: null };
  if (isTimedText(t)) {
    const parsed = parseTimedLyrics(t);
    if (parsed.lines.length) return { sheetText: '', imported: parsed };
  }
  return { sheetText: t, imported: null };
}

/** The revision of a release's lyric inputs, and the PostgREST filter that holds a write to it. */
export function inputRev(track) {
  if (typeof track.lyrics_input_rev === 'string' && /^[0-9a-f]{32}$/.test(track.lyrics_input_rev)) {
    return { value: track.lyrics_input_rev, filter: `lyrics_input_rev=eq.${track.lyrics_input_rev}` };
  }
  /* before the column exists: at least the master must still be the one heard */
  return { value: null, filter: `master_path=eq.${encodeURIComponent(track.master_path)}` };
}

async function download(bucket, path, to) {
  const url = `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = buildSupabaseHeaders({ secretKey: process.env.SUPABASE_SECRET_KEY, legacyServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  if (!headers.authorization) headers.authorization = `Bearer ${headers.apikey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`master download refused: ${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_MASTER_BYTES) throw new Error('master is larger than the lyric machine accepts');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MASTER_BYTES) throw new Error('master is larger than the lyric machine accepts');
  await writeFile(to, buf);
}

export async function lyricsAlign(job, deps = {}) {
  const trackId = String(job?.input?.track_id || job?.target_id || '').trim();
  if (!UUID.test(trackId)) throw new Error('lyrics_align requires input.track_id (uuid)');
  const _rest = deps.rest || rest;
  const _download = deps.download || download;
  const _transcribe = deps.transcribe || transcribe;

  const cols = 'id,title,master_bucket,master_path,lyrics,lyrics_sheet';
  let rows;
  try { ({ body: rows = [] } = await _rest(`creator_tracks?id=eq.${trackId}&select=${cols},lyrics_input_rev&limit=1`)); }
  catch (e) {
    /* the revision column arrives with the pending SQL; until then, read without it */
    if (!/lyrics_input_rev|lyrics_sheet/.test(String(e?.message || ''))) throw e;
    ({ body: rows = [] } = await _rest(`creator_tracks?id=eq.${trackId}&select=id,title,master_bucket,master_path,lyrics&limit=1`));
  }
  const track = rows[0];
  if (!track) throw new Error(`creator track ${trackId} not found`);
  if (!track.master_bucket || !track.master_path) throw new Error('release has no master to listen to');
  if (!mayReplace(track.lyrics)) {
    return { executor: 'lyrics_align:v1', summary: `Lyrics for "${track.title}" are owner-reviewed; left as they are`, track_id: trackId, written: false };
  }

  const dir = await mkdtemp(join(tmpdir(), 'mcc-lyrics-job-'));
  try {
    const audio = join(dir, 'master' + (extname(track.master_path).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.audio'));
    await _download(track.master_bucket, track.master_path, audio);
    const { sheetText, imported } = sheetInput(track.lyrics_sheet);
    const { doc, stems, stemsDir } = await _transcribe({ audio, sheetText, imported, title: track.title || '', workDir: join(dir, 'work') });
    /* the separation already made every stem: keep them, privately (never fails the lyrics) */
    let stemsResult = null;
    if (stems && stemsDir && job?.input?.stems !== false) {
      try { stemsResult = await (deps.storeStems || storeStems)({ trackKey: `ct-${trackId.toLowerCase()}`, dir: stemsDir, manifest: stems, source: 'creator', creatorTrackId: trackId }); }
      catch (e) { stemsResult = { error: String(e.message || e).slice(0, 300) }; }
    }
    doc.track_id = trackId;
    /* Write only onto the inputs this run listened to. lyrics_input_rev is kept by
       the database (md5 of master_path + lyrics_sheet, pending SQL); if the master
       or sheet changed while this ran, the filter matches nothing and the newer
       job the trigger queued writes instead. The owner may also have reviewed
       while this ran: never write over that. */
    const rev = inputRev(track);
    doc.input_rev = rev.value;
    const patch = `creator_tracks?id=eq.${trackId}&${rev.filter}&or=(lyrics.is.null,lyrics->>reviewed.is.null,lyrics->>reviewed.eq.false)`;
    const { body: updated = [] } = await _rest(patch, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ lyrics: doc }),
    });
    const m = doc.machine || {};
    if (!updated.length) {
      return { executor: 'lyrics_align:v1', summary: `Lyrics for "${track.title}" not written: the master, sheet or review changed while McCluster listened (a newer job takes it)`, track_id: trackId, written: false, input_rev: rev.value };
    }
    return {
      executor: 'lyrics_align:v1',
      summary: `Lyrics ${doc.source} for "${track.title}": ${doc.timed.line.length} lines, ${m.mismatched_lines || 0} flagged for review`,
      track_id: trackId,
      written: updated.length > 0,
      source: doc.source,
      lines: doc.timed.line.length,
      mismatched_lines: m.mismatched_lines || 0,
      engine: m.engine || null,
      timing: m.timing || null,
      stems: stemsResult,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
