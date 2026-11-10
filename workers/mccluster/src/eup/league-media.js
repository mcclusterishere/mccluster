/* E=Up → Environmental Justice League → media: the Worker-owned half of a member's audio or video proof.

   Called only by ./league.js (owner routes) and ./league-member.js (member routes), each time AFTER the SQL has
   decided who may act on which row (MEDIA.order in ./league-contract.js). This module never decides that. It turns a
   row the SQL answered into calls on the one private, service-only bucket, and it measures what storage really holds:

     beginUpload      sign one single-object, no-overwrite upload for a staged row
     completeUpload   list the object, read it once (count, magic bytes, SHA-256), then the seal with what was measured
     discardUpload    delete the object of a discarded row
     signOwnRead      re-check the identity stored at the seal, then sign one short read
     signReviewRead   the same for every upload of the proof revision a reviewer was shown
     purgeDue         delete the objects of the rows the SQL says are due, and report each

   ctx = { env, fetchImpl, fail, now, seal }
     env        SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
     fetchImpl  fetch. It is always called bare, never as a method of ctx: the runtime's own fetch refuses to run
                as a method of another object.
     fail       (status, message, reason) => the Error to throw (the router's)
     now        () => epoch milliseconds
     seal       async ({ p_upload, p_actor, p_result }) => the upload row after the seal. Injected by the member route,
                which owns the RPC call and the SQLSTATE table; whatever it throws passes through unchanged. Read by
                completeUpload only. This file names no RPC and maps no SQLSTATE.

   What this file holds on its own, whatever its caller does:
   - A storage path is made ONLY by mediaObjectPath from row ids. Before a grant, an inspection or a signed read the
     row's extension also has to be the media table's for its MIME type; a deletion needs the ids and an allowed
     extension only. No path, bucket, name or URL is ever read from a row or a request.
   - Every storage call carries the service key, redirect "manual" and a deadline. A redirect, a deadline, a refusal
     storage did not explain and an answer of the wrong shape are all 503 storage_unavailable with a fixed sentence.
   - Nothing is logged. No URL, token or key is put in an error, kept in this module or handed to the seal. The upload
     grant and the signed reads exist only in the value returned to the caller.
   - A sealed result is what was READ: the byte count, the first bytes and the digest of the stream, bound to the
     storage identity (object id, eTag, size) listed just before the read. Nothing the client declared is trusted.
   - An object is deleted only for a row the SQL answered as discarded, rejected, expired or due.

   SHA-256 is node:crypto createHash, fed one chunk at a time, so the object is never held in memory (only its first
   MEDIA.sniff_bytes are kept). It is the one incremental digest that exists both in the Worker (wrangler.toml:
   compatibility_date 2026-09-02, nodejs_compat) and in the Node test runner: crypto.subtle.digest takes the whole
   message at once, and crypto.DigestStream exists in the Worker runtime only. Measured in a local workerd with those
   settings: 104857600 bytes in 1600 chunks digested correctly. NOT measured: the same read against real storage and
   under the production CPU and memory limits.

   Inspection is not malware scanning: a sealed row keeps scan_state "not_scanned". */
import { createHash } from 'node:crypto';
import { DOCUMENTS, ENUMS, ERRORS, HTTP_REASONS, LIMITS, MEDIA, PATTERNS, bareMime, checkDocument, mediaObjectPath, mediaType, sniffMediaFamily } from './league-contract.js';

/* Technical ceilings of one storage call. Not policy: how long a call may take, and how much of a control answer is read. */
export const STORAGE_LIMITS = Object.freeze({
  control_timeout_ms: 12000, // sign, list, delete: the same bound the other storage callers in this Worker use
  read_timeout_ms: 60000, // the one streamed read of an object of at most MEDIA.hard_max_bytes
  control_answer_max_bytes: 262144, // a list or delete answer is a few kilobytes; anything longer is not that answer
  list_limit: 10
});

/* reason → [status, the fixed sentence]. The first five are answers the Worker produces without SQL (HTTP_REASONS);
   the hold repeats, with the contract's own status and code for EU016, what the SQL already refuses. */
const HOLD = ERRORS.EU016;
const REFUSALS = Object.freeze({
  storage_unavailable: [HTTP_REASONS.storage_unavailable, 'League media storage unavailable'],
  upload_expired: [HTTP_REASONS.upload_expired, 'This upload can no longer receive a file'],
  upload_missing: [HTTP_REASONS.upload_missing, 'No stored file was found for this upload'],
  media_changed: [HTTP_REASONS.media_changed, 'The stored file is not the file that was sealed'],
  not_available: [HTTP_REASONS.not_available, 'Not available'],
  [HOLD.code]: [HOLD.owner_status, 'The proof is held']
});
const plain = (status, message, reason) => Object.assign(new Error(message), { status, reason });
function refusal(ctx, reason) {
  const [status, message] = REFUSALS[reason];
  const make = typeof ctx?.fail === 'function' ? ctx.fail : plain;
  return make(status, message, reason);
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isUuid = (value) => typeof value === 'string' && PATTERNS.uuid.test(value);
const sameId = (a, b) => isUuid(a) && isUuid(b) && a.toLowerCase() === b.toLowerCase();
const isCount = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const isState = (value) => ENUMS.UPLOAD_STATES.includes(value);

/* The object path of a row: its ids and nothing else. null when the row cannot name one. */
function pathOf(row) {
  if (!isObject(row)) return null;
  try { return mediaObjectPath({ tenant: row.tenant, assignment: row.assignment_id, upload: row.id, ext: row.ext }); } catch { return null; }
}
/* The media table entry of an upload row whose kind, MIME type and extension agree with it; otherwise null. */
function typeOf(row) {
  const type = isObject(row) ? mediaType(row.mime) : null;
  return type && type.ext === row.ext && type.kind === row.kind ? type : null;
}

/* ------------------------------------------------------------------ storage calls */

const IDENTITY = DOCUMENTS.seal_result.variants.sealed.fields.storage; // { object_id, etag, size } as the seal stores it
const baseOf = (env) => String(env.SUPABASE_URL).replace(/\/+$/, '');

/* Reads a body to its end, or until it is longer than `limit`. Each chunk is handed to `take`; nothing is kept here. */
async function drain(body, expired, limit, take) {
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader) return { bytes: 0, over: false };
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) return { bytes, over: false };
      if (!(value instanceof Uint8Array)) throw new TypeError('a body chunk that is not bytes');
      bytes += value.byteLength;
      if (bytes > limit) {
        reader.cancel().catch(() => {});
        return { bytes, over: true };
      }
      take(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
}

/* measureMediaStream(body, limit): one pass over a byte stream. Returns the bytes read, whether the read stopped
   because more than `limit` bytes arrived (the digest is then null), the first MEDIA.sniff_bytes, and the SHA-256. */
export async function measureMediaStream(body, limit, expired = new Promise(() => {})) {
  const hash = createHash('sha256');
  const head = new Uint8Array(MEDIA.sniff_bytes);
  let kept = 0;
  const { bytes, over } = await drain(body, expired, limit, (chunk) => {
    if (kept < head.length) {
      const n = Math.min(head.length - kept, chunk.byteLength);
      head.set(chunk.subarray(0, n), kept);
      kept += n;
    }
    hash.update(chunk);
  });
  return { bytes, over, head: head.subarray(0, kept), sha256: over ? null : hash.digest('hex') };
}

async function jsonAnswer(response, expired) {
  if (!response.ok) throw new Error('storage refused the call');
  const chunks = [];
  const { bytes, over } = await drain(response.body, expired, STORAGE_LIMITS.control_answer_max_bytes, (chunk) => chunks.push(chunk));
  if (over) throw new Error('a control answer that is too long');
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
}

/* One call to the storage service. `consume(response, expired)` reads the answer inside the same deadline. Whatever
   goes wrong in here, the caller sees one thing: 503 storage_unavailable, with no upstream text. */
async function storageCall(ctx, { method, route, json, timeoutMs = STORAGE_LIMITS.control_timeout_ms }, consume) {
  const env = ctx?.env;
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw refusal(ctx, 'storage_unavailable');
  const fetchImpl = typeof ctx.fetchImpl === 'function' ? ctx.fetchImpl : globalThis.fetch;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  /* The deadline is also raced directly, so it holds even where an abort does not reach a stalled body. */
  const expired = new Promise((_, reject) => { controller.signal.addEventListener('abort', () => reject(new Error('storage deadline')), { once: true }); });
  expired.catch(() => {});
  let response = null;
  try {
    const headers = { apikey: key, authorization: `Bearer ${key}` };
    const init = { method, headers, redirect: 'manual', signal: controller.signal };
    if (json !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(json); }
    response = await Promise.race([fetchImpl(`${baseOf(env)}/storage/v1/${route}`, init), expired]);
    if (!response || !Number.isInteger(response.status) || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new Error('storage redirected');
    return await consume(response, expired);
  } catch {
    try { response?.body?.cancel().catch(() => {}); } catch { /* nothing left to release */ }
    throw refusal(ctx, 'storage_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/* A signed location storage answered, accepted only when it is for exactly the route that was asked. */
function signedLocation(env, value, route) {
  if (typeof value !== 'string' || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value)) throw new Error('not a signed location');
  const rest = value.startsWith('/') ? value : `/${value}`;
  if (!rest.startsWith(`/${route}?`) || !/[?&]token=[^&]+/.test(rest)) throw new Error('a signed location for something else');
  return `${baseOf(env)}/storage/v1${rest}`;
}
const signUpload = (ctx, path) => storageCall(ctx, { method: 'POST', route: `object/upload/sign/${MEDIA.bucket}/${path}` },
  async (response, expired) => signedLocation(ctx.env, (await jsonAnswer(response, expired))?.url, `object/upload/sign/${MEDIA.bucket}/${path}`));
const signRead = (ctx, path) => storageCall(ctx, { method: 'POST', route: `object/sign/${MEDIA.bucket}/${path}`, json: { expiresIn: MEDIA.signed_read_seconds } },
  async (response, expired) => { const data = await jsonAnswer(response, expired); return signedLocation(ctx.env, data?.signedURL ?? data?.signedUrl, `object/sign/${MEDIA.bucket}/${path}`); });

/* What storage holds at a path: null when nothing, else its identity and the content type it will be served as. */
function lookUp(ctx, path) {
  const cut = path.lastIndexOf('/');
  const name = path.slice(cut + 1);
  return storageCall(ctx, { method: 'POST', route: `object/list/${MEDIA.bucket}`, json: { prefix: path.slice(0, cut), search: name, limit: STORAGE_LIMITS.list_limit } }, async (response, expired) => {
    const rows = await jsonAnswer(response, expired);
    if (!Array.isArray(rows)) throw new Error('a listing that is not a list');
    const row = rows.find((r) => isObject(r) && r.name === name && r.id !== null && r.id !== undefined);
    if (!row) return null;
    const meta = isObject(row.metadata) ? row.metadata : {};
    const size = typeof meta.size === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(meta.size) ? Number(meta.size) : meta.size;
    if (!isUuid(row.id) || checkDocument(IDENTITY.fields.etag, meta.eTag) !== null || !isCount(size) || typeof meta.mimetype !== 'string') throw new Error('a listing without an identity');
    return { object_id: row.id.toLowerCase(), etag: meta.eTag, size, mimetype: meta.mimetype };
  });
}
/* The one read of an object: its bytes go through the counter, the sniffer and the digest, and nowhere else. */
const measure = (ctx, path, limit) => storageCall(ctx, { method: 'GET', route: `object/authenticated/${MEDIA.bucket}/${path}`, timeoutMs: STORAGE_LIMITS.read_timeout_ms }, async (response, expired) => {
  if (response.status !== 200) throw new Error('the object could not be read');
  return measureMediaStream(response.body, limit, expired);
});
/* Deletes exactly the named objects. Resolves only when storage answered the deletion; an object that was already absent counts. */
const remove = (ctx, paths) => storageCall(ctx, { method: 'DELETE', route: `object/${MEDIA.bucket}`, json: { prefixes: paths } }, async (response, expired) => {
  if (!Array.isArray(await jsonAnswer(response, expired))) throw new Error('a deletion answer that is not a list');
  return true;
});

/* ------------------------------------------------------------------ uploads.begin → grant */

/* beginUpload(ctx, upload): upload is the row member:uploads.begin answered (a replayed receipt included).
   Returns { method, url, headers, expires_in }: the only place the upload URL ever exists.
   409 upload_expired when the row is not staged, or when a grant signed now could outlive the row. */
export async function beginUpload(ctx, upload) {
  const path = typeOf(upload) ? pathOf(upload) : null;
  const expires = isObject(upload) && typeof upload.expires_at === 'string' ? Date.parse(upload.expires_at) : NaN;
  const now = typeof ctx?.now === 'function' ? ctx.now() : Date.now();
  if (!path || !isState(upload.state) || !Number.isFinite(expires) || !Number.isFinite(now)) throw refusal(ctx, 'storage_unavailable');
  if (upload.state !== 'staged' || now + MEDIA.upload_grant_seconds * 1000 > expires) throw refusal(ctx, 'upload_expired');
  const url = await signUpload(ctx, path);
  return { method: MEDIA.grant.method, url, headers: { 'content-type': upload.mime, 'x-upsert': MEDIA.grant.upsert }, expires_in: MEDIA.upload_grant_seconds };
}

/* ------------------------------------------------------------------ uploads/:id/complete → inspect → seal */

const rejected = (reason) => ({ outcome: 'rejected', reason });
/* What the stored object is. Reasons are decided in this order, the cheapest evidence first:
   empty, too_large, size_mismatch (from the listing, nothing is read), then from the one read: empty, too_large,
   size_mismatch, unrecognised, family_mismatch. The read stops as soon as more bytes than the listing named have arrived,
   which is never more than max_bytes or the hard ceiling.
   family_mismatch also answers an object storage would serve as a type that does not allow its bytes: the content type
   sent with the upload decides what a signed read is served as, so it has to be a media type of the same family. */
async function inspect(ctx, upload, type, path, listed) {
  const cap = Math.min(upload.max_bytes, MEDIA.hard_max_bytes);
  if (listed.size === 0) return rejected('empty');
  if (listed.size > cap) return rejected('too_large');
  if (listed.size !== upload.declared_bytes) return rejected('size_mismatch');
  const read = await measure(ctx, path, listed.size);
  if (read.bytes === 0) return rejected('empty');
  if (read.bytes > cap) return rejected('too_large');
  if (read.over || read.bytes !== listed.size) return rejected('size_mismatch');
  const family = sniffMediaFamily(read.head);
  if (!family) return rejected('unrecognised');
  const served = mediaType(bareMime(listed.mimetype));
  if (!type.families.includes(family) || !served || !served.families.includes(family)) return rejected('family_mismatch');
  return { outcome: 'sealed', bytes: read.bytes, sha256: read.sha256, family, storage: { object_id: listed.object_id, etag: listed.etag, size: listed.size } };
}

/* completeUpload(ctx, upload, actor): upload is the row member:uploads.get answered, actor the verified session user.
   Returns the row after the seal; its state says sealed, rejected or expired.
   - A row that is not staged is answered as it stands: nothing is listed, read or sealed. That is how a second
     complete never downloads again, and it holds for every later state, because the seal cannot change such a row.
   - No object: 409 upload_missing, and the row stays staged.
   - The seal refuses (module draining, policy, state moved): its error passes through and the object is kept.
   - After a rejected or expired answer the object is deleted; a failed deletion is left to the purge.
   404 not_available when the actor is not the row's participant: the SQL refuses that first on both sides of this call,
   so it is a second check that costs nothing. */
export async function completeUpload(ctx, upload, actor) {
  if (!isObject(upload) || !isUuid(upload.id) || !isUuid(upload.participant) || !isState(upload.state)) throw refusal(ctx, 'storage_unavailable');
  if (!sameId(upload.participant, actor)) throw refusal(ctx, 'not_available');
  if (upload.state !== 'staged') return upload;
  const type = typeOf(upload);
  const path = type ? pathOf(upload) : null;
  if (!path || typeof ctx?.seal !== 'function' || !isCount(upload.declared_bytes, 1) || !isCount(upload.max_bytes, 1)) throw refusal(ctx, 'storage_unavailable');
  const listed = await lookUp(ctx, path);
  if (!listed) throw refusal(ctx, 'upload_missing');
  const result = await inspect(ctx, upload, type, path, listed);
  if (checkDocument(DOCUMENTS.seal_result, result) !== null) throw refusal(ctx, 'storage_unavailable');
  const row = await ctx.seal({ p_upload: upload.id.toLowerCase(), p_actor: actor.toLowerCase(), p_result: result });
  if (!isObject(row) || !sameId(row.id, upload.id) || !['sealed', 'rejected', 'expired'].includes(row.state)) throw refusal(ctx, 'storage_unavailable');
  if (row.state !== 'sealed') await remove(ctx, [path]).catch(() => false);
  return row;
}

/* ------------------------------------------------------------------ uploads.discard → delete */

/* discardUpload(ctx, upload): upload is the row member:uploads.discard answered. Returns { deleted } and never throws:
   the row is already discarded, and whatever stays behind is removed by the purge. Only a discarded row is touched. */
export async function discardUpload(ctx, upload) {
  const path = isObject(upload) && upload.state === 'discarded' ? pathOf(upload) : null;
  if (!path) return { deleted: false };
  try { return { deleted: await remove(ctx, [path]) }; } catch { return { deleted: false }; }
}

/* ------------------------------------------------------------------ signed reads */

/* A sealed upload row and the identity stored for it at the seal. A row in another state answers 409 media_changed. */
function sealedTarget(ctx, upload) {
  if (!isObject(upload) || !isState(upload.state)) throw refusal(ctx, 'storage_unavailable');
  if (upload.state !== 'sealed') throw refusal(ctx, 'media_changed');
  const path = typeOf(upload) ? pathOf(upload) : null;
  if (!path || checkDocument(IDENTITY, upload.storage) !== null || upload.storage.size !== upload.bytes) throw refusal(ctx, 'storage_unavailable');
  return { path, identity: upload.storage };
}
/* The object at the row's own path must still be the sealed one: same object id, eTag and size. */
async function unchanged(ctx, { path, identity }) {
  const listed = await lookUp(ctx, path);
  if (!listed || !sameId(listed.object_id, identity.object_id) || listed.etag !== identity.etag || listed.size !== identity.size) throw refusal(ctx, 'media_changed');
}

/* signOwnRead(ctx, upload): upload is the row member:uploads.get answered with sign true, so the SQL already decided
   that this reader (the participant, or the released audience of an effective publication) may hear it.
   Returns { url, expires_in }. 409 media_changed when the stored object moved. */
export async function signOwnRead(ctx, upload) {
  const target = sealedTarget(ctx, upload);
  await unchanged(ctx, target);
  return { url: await signRead(ctx, target.path), expires_in: MEDIA.signed_read_seconds };
}

/* signReviewRead(ctx, proof): proof is what owner:proofs.get answered with media true for the revision asked.
   Returns [{ upload_id, kind, mime, bytes, sha256, url, expires_in }] in the order of proof.media; [] for a proof
   on the accommodation path. All or nothing: every upload is checked before the first read is signed.
   409 media_changed when an upload is not bound to this proof (another tenant, assignment or participant, not
   sealed, or a digest, size, kind or type that is not the one the revision lists) or its stored object moved. */
export async function signReviewRead(ctx, proof) {
  if (!isObject(proof) || !isUuid(proof.tenant) || !isUuid(proof.assignment_id) || !isUuid(proof.participant) || !ENUMS.MODERATION_STATES.includes(proof.moderation_state)
    || !Array.isArray(proof.media) || proof.media.length > LIMITS.count.proof_media) throw refusal(ctx, 'storage_unavailable');
  if (proof.moderation_state !== 'clear') throw refusal(ctx, HOLD.code);
  const uploads = Array.isArray(proof.uploads) ? proof.uploads : [];
  const seen = new Set();
  const targets = proof.media.map((entry) => {
    const listedType = isObject(entry) ? mediaType(entry.mime) : null;
    if (!listedType || listedType.kind !== entry.kind || !isUuid(entry.upload_id) || seen.has(entry.upload_id.toLowerCase())
      || typeof entry.sha256 !== 'string' || !PATTERNS.sha256.test(entry.sha256) || !isCount(entry.bytes, 1)) throw refusal(ctx, 'storage_unavailable');
    seen.add(entry.upload_id.toLowerCase());
    const upload = uploads.find((u) => isObject(u) && sameId(u.id, entry.upload_id));
    if (!upload || !sameId(upload.tenant, proof.tenant) || !sameId(upload.assignment_id, proof.assignment_id) || !sameId(upload.participant, proof.participant)
      || upload.sha256 !== entry.sha256 || upload.bytes !== entry.bytes || upload.kind !== entry.kind || upload.mime !== entry.mime) throw refusal(ctx, 'media_changed');
    return { entry, ...sealedTarget(ctx, upload) };
  });
  for (const target of targets) await unchanged(ctx, target);
  const out = [];
  for (const { entry, path } of targets) {
    out.push({ upload_id: entry.upload_id, kind: entry.kind, mime: entry.mime, bytes: entry.bytes, sha256: entry.sha256, url: await signRead(ctx, path), expires_in: MEDIA.signed_read_seconds });
  }
  return out;
}

/* ------------------------------------------------------------------ media.due → delete → media.purged */

/* purgeDue(ctx, due): due is what owner:media.due answered for the uploads asked for ({ uploads: [...] }, or the list).
   Deletes exactly the objects of the rows whose due flag is true and returns { deleted, failed }: two lists of upload
   ids. The caller records media.purged only when failed is empty.
   - A row that is already purged is left alone and reported in neither list.
   - If any row is neither due nor already purged, NOTHING is deleted and every due id is reported failed: the batch
     is one decision, and the route refuses it (409) before it gets here.
   - A deletion storage did not answer puts its whole batch in failed; nothing is thrown for it.
   503 storage_unavailable only when `due` is not a due list: a row that cannot name its object is never guessed at. */
export async function purgeDue(ctx, due) {
  const rows = Array.isArray(due) ? due : isObject(due) && Array.isArray(due.uploads) ? due.uploads : null;
  if (!rows) throw refusal(ctx, 'storage_unavailable');
  const paths = new Map();
  let foreign = false;
  for (const row of rows) {
    const path = pathOf(row);
    if (!path || typeof row.due !== 'boolean' || !isState(row.state)) throw refusal(ctx, 'storage_unavailable');
    if (row.due) paths.set(row.id.toLowerCase(), path);
    else if (row.state !== 'purged') foreign = true;
  }
  const ids = [...paths.keys()];
  if (foreign) return { deleted: [], failed: ids };
  const deleted = [];
  const failed = [];
  for (let start = 0; start < ids.length; start += LIMITS.list.purge_batch) {
    const batch = ids.slice(start, start + LIMITS.list.purge_batch);
    try {
      await remove(ctx, batch.map((id) => paths.get(id)));
      deleted.push(...batch);
    } catch {
      failed.push(...batch);
    }
  }
  return { deleted, failed };
}
