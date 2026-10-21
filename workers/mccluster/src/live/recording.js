/* LIVE MISSIONS: the recording that becomes the proof.

   Stream cannot record a WHIP (WebRTC) input, so the browser records the
   same camera/mic tracks it is publishing (MediaRecorder, one WebM stream,
   a chunk every few seconds) and uploads each chunk while the run is live.
   A crash loses at most the last chunk. Each chunk is hashed on arrival
   (SHA-256) and its receipt written by the database (action_live_record_chunk),
   so a gap or a swapped chunk is visible to the reviewer; the server-side
   connected/disconnected record (webhooks) is what proves the run was live,
   not the file.

   After "Mission complete", the cron assembles the chunks, in order and
   hash-checked, into ONE Stream video over tus (requiresignedurls), so the
   desk reviews a single private video. Stream's tus rules (docs): chunks of
   at least 5,242,880 bytes and divisible by 256 KiB except the last; the
   video id comes from the stream-media-id header. Chunks are deleted from
   the bucket only after Stream accepted every byte. */

export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
export const TUS_PART = 5 * 1024 * 1024; // 5,242,880 = 20 x 256 KiB
const TUS_ALIGN = 256 * 1024;

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function chunkPath(sessionId, seq) {
  return `${sessionId}/${String(seq).padStart(6, '0')}.webm`;
}

/* Feed chunk bytes in; emit tus parts that satisfy the size rules. */
export function makeTusPacker() {
  let buf = new Uint8Array(0);
  return {
    push(bytes) {
      const next = new Uint8Array(buf.length + bytes.length);
      next.set(buf); next.set(bytes, buf.length); buf = next;
      const out = [];
      while (buf.length >= TUS_PART) {
        const take = Math.floor(buf.length / TUS_ALIGN) * TUS_ALIGN;
        out.push(buf.slice(0, take)); buf = buf.slice(take);
      }
      return out;
    },
    flush() { const last = buf; buf = new Uint8Array(0); return last.length ? [last] : []; }
  };
}

/* One session: chunks -> one Stream video. db/stream are the store/client. */
export async function assembleRecording(session, { db, stream }) {
  const chunks = await db.serviceGet(`action_live_recording_chunks?session_id=eq.${session.id}&select=seq,object_path,bytes,sha256&order=seq.asc`);
  if (!chunks || !chunks.length) {
    await db.serviceRpc('action_live_set_recording', { p_session: session.id, p_state: 'discarded', p_video_uid: null });
    return { state: 'discarded' };
  }
  const total = chunks.reduce((n, c) => n + Number(c.bytes), 0);
  const missing = chunks.some((c, i) => Number(c.seq) !== i);
  const upload = await stream.tusCreate(total, { name: `live-mission ${session.id}` });
  const packer = makeTusPacker();
  let offset = 0;
  for (const c of chunks) {
    const bytes = await db.storageGet(c.object_path);
    if (bytes.length !== Number(c.bytes) || (await sha256Hex(bytes)) !== c.sha256) {
      await db.serviceRpc('action_live_set_recording', { p_session: session.id, p_state: 'failed', p_video_uid: null });
      return { state: 'failed', reason: `chunk ${c.seq} does not match its receipt` };
    }
    for (const part of packer.push(bytes)) offset = await stream.tusPatch(upload.url, offset, part);
  }
  for (const part of packer.flush()) offset = await stream.tusPatch(upload.url, offset, part);
  if (offset !== total) throw new Error(`tus offset ${offset} != ${total}`);
  await db.serviceRpc('action_live_set_recording', { p_session: session.id, p_state: 'ready', p_video_uid: upload.uid });
  await db.storageDelete(chunks.map((c) => c.object_path)).catch(() => false);
  return { state: 'ready', video_uid: upload.uid, bytes: total, chunks: chunks.length, sequence_gaps: missing };
}
