// (f) Approval is bound to the exact audio bytes the reviewer heard.
//
// music-access `operator-review-prepare` pins the release's master as a
// version (public.music_prepare_review, which also locks the object against
// overwrite/move/delete), streams that pinned object through an incremental
// SHA-256 once, and records the hash write-once
// (public.music_record_asset_sha256). The operator's player streams the same
// pinned object and the desk shows the hash; `operator-review` then carries
// that hash, and the database refuses approval unless it equals the recorded
// one (supabase/pending/music_release_payment_integrity_v1.sql, part (f)).
//
// Pure apart from the client and the object reader it is handed, so
// scripts/test/music-payment-integrity.test.mjs runs it under Node.
// node:crypto's createHash is native and incremental in both Deno (Supabase
// Edge Runtime) and Node: chunks are hashed as they arrive and never
// buffered, so a large WAV costs one streaming read and constant memory.

import { createHash } from "node:crypto";
import { DependencyMissing, notApplied, type DbError, type MusicDb, type Refusal } from "./delivery.ts";

/** The hash cap: the creator-masters bucket's own file_size_limit (524288000
    bytes, read-only check of production on 2026-10-29), so every master the
    bucket accepts can be verified and nothing larger is read at all. */
export const MAX_HASH_BYTES = 524_288_000;

export type HashOutcome =
  | { ok: true; sha256: string; size: number }
  | { ok: false; reason: "missing" | "too_large" | "read_failed"; size?: number };

type ByteSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

/** SHA-256 of a byte stream, chunk by chunk. Fails closed: no stream is
    "missing", more than maxBytes is "too_large" (the read is cancelled at the
    first chunk over the cap), and any read error is "read_failed". */
export async function sha256OfStream(source: ByteSource | null | undefined, maxBytes: number): Promise<HashOutcome> {
  if (!source) return { ok: false, reason: "missing" };
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return { ok: false, reason: "too_large" };
  const hash = createHash("sha256");
  let size = 0;
  const reader = "getReader" in source ? source.getReader() : null;
  const iterator = reader ? null : (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const stop = async () => {
    try {
      if (reader) await reader.cancel();
      else await iterator?.return?.();
    } catch (_) { /* already closed */ }
  };
  try {
    for (;;) {
      const step = reader ? await reader.read() : await iterator!.next();
      if (step.done) break;
      const chunk = step.value;
      if (!chunk || chunk.byteLength === 0) continue;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await stop();
        return { ok: false, reason: "too_large", size };
      }
      hash.update(chunk);
    }
  } catch (_) {
    await stop();
    return { ok: false, reason: "read_failed", size };
  } finally {
    try { reader?.releaseLock(); } catch (_) { /* released */ }
  }
  return { ok: true, sha256: hash.digest("hex"), size };
}

/** Reads one Storage object as a stream (music-access: the Storage API with
    the service key). length is the Content-Length when the server sent one. */
export type ObjectReader = (bucket: string, path: string) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  length: number | null;
}>;

type PreparedRow = {
  track_id: string;
  track_status: string;
  track_updated_at: string;
  version_id: string;
  bucket_id: string;
  object_name: string;
  size_bytes: number | string | null;
  etag: string | null;
  content_sha256: string | null;
  invalidated: boolean;
  invalid_reason: string | null;
  identity_intact: boolean;
};

export type ReviewAudio = {
  ok: true;
  trackId: string;
  versionId: string;
  bucket: string;
  path: string;
  sha256: string;
  sizeBytes: number | null;
  trackUpdatedAt: string;
  hashedNow: boolean;
};

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

function prepareRefusal(error: DbError): Refusal | null {
  const m = String(error?.message || "");
  if (/track_not_found/.test(m)) return { ok: false, status: 404, error: "track not found" };
  if (/release_not_in_review/.test(m)) return { ok: false, status: 409, error: "only a release submitted for review can be verified" };
  if (/release_asset_not_owned/.test(m)) return { ok: false, status: 409, error: "this release points at audio or artwork its creator did not upload" };
  if (/release_master_missing/.test(m)) return { ok: false, status: 409, error: "this release has no master audio to review" };
  return null;
}

/** The reviewer's step: the pinned master under review and the SHA-256 of
    its bytes, computing and recording the hash the first time. recheck
    re-reads and re-hashes a version that already has one (an operator
    audit): a disagreeing recompute invalidates the version in the database.
    Every uncertain outcome refuses; nothing is recorded unless the whole
    object was read. */
export async function prepareReviewAudio(
  db: MusicDb,
  readObject: ObjectReader,
  trackId: string,
  maxBytes = MAX_HASH_BYTES,
  recheck = false,
): Promise<ReviewAudio | Refusal> {
  const { data, error } = await db.rpc("music_prepare_review", { p_track: trackId });
  if (error) {
    if (notApplied(error)) throw new DependencyMissing("music_prepare_review");
    const refusal = prepareRefusal(error);
    if (refusal) return refusal;
    throw new Error("could_not_prepare_review");
  }
  const row = firstRow<PreparedRow>(data);
  if (!row?.version_id || !row.object_name || row.bucket_id !== "creator-masters") {
    return { ok: false, status: 409, error: "this release has no master audio to review" };
  }
  const sizeBytes = row.size_bytes == null ? null : Number(row.size_bytes);
  const base = {
    ok: true as const, trackId: row.track_id, versionId: row.version_id, bucket: row.bucket_id, path: row.object_name,
    sizeBytes, trackUpdatedAt: row.track_updated_at,
  };
  if (row.invalidated) {
    return { ok: false, status: 409, error: "this master failed byte verification: the creator must upload it again", log: { version: row.version_id, reason: row.invalid_reason } };
  }
  if (row.identity_intact !== true) {
    return { ok: false, status: 409, error: "the pinned master no longer matches storage", log: { version: row.version_id, reason: "identity" } };
  }
  if (row.content_sha256 && !recheck) return { ...base, sha256: row.content_sha256, hashedNow: false };

  if (sizeBytes != null && sizeBytes > maxBytes) {
    return { ok: false, status: 413, error: "this master is too large to verify", log: { version: row.version_id, size: sizeBytes } };
  }
  let object: Awaited<ReturnType<ObjectReader>>;
  try {
    object = await readObject(row.bucket_id, row.object_name);
  } catch (_) {
    return { ok: false, status: 502, error: "the master could not be read: try again", log: { version: row.version_id, reason: "fetch" } };
  }
  if (!object.ok || !object.body) {
    try { await object.body?.cancel(); } catch (_) { /* closed */ }
    return { ok: false, status: object.status === 404 ? 409 : 502, error: "the master could not be read", log: { version: row.version_id, status: object.status } };
  }
  if (object.length != null && object.length > maxBytes) {
    try { await object.body.cancel(); } catch (_) { /* closed */ }
    return { ok: false, status: 413, error: "this master is too large to verify", log: { version: row.version_id, size: object.length } };
  }
  const hashed = await sha256OfStream(object.body, maxBytes);
  if (!hashed.ok) {
    if (hashed.reason === "too_large") return { ok: false, status: 413, error: "this master is too large to verify", log: { version: row.version_id } };
    return { ok: false, status: 502, error: "the master could not be read: try again", log: { version: row.version_id, reason: hashed.reason } };
  }

  const recorded = await db.rpc("music_record_asset_sha256", { p_version: row.version_id, p_sha256: hashed.sha256, p_size: hashed.size });
  if (recorded.error) {
    if (notApplied(recorded.error)) throw new DependencyMissing("music_record_asset_sha256");
    throw new Error("could_not_record_hash");
  }
  const outcome = String(recorded.data ?? "");
  if (outcome === "recorded" || outcome === "already_recorded") return { ...base, sha256: hashed.sha256, hashedNow: true };
  if (outcome === "size_mismatch") {
    return { ok: false, status: 502, error: "the master was not read completely: try again", log: { version: row.version_id, read: hashed.size, pinned: sizeBytes } };
  }
  return { ok: false, status: 409, error: "this master failed byte verification: the creator must upload it again", log: { version: row.version_id, outcome } };
}

/** What operator-review answers for a refused decision; null means the
    error is not a review outcome (a 500). */
export function reviewDecisionRefusal(error: DbError): Refusal | null {
  if (notApplied(error)) throw new DependencyMissing("music_operator_review");
  const m = String(error?.message || "");
  if (/release_asset_not_owned/.test(m)) return { ok: false, status: 409, error: "this release points at audio or artwork its creator did not upload" };
  if (/release_master_missing/.test(m)) return { ok: false, status: 409, error: "this release's master file is missing" };
  if (/release_master_invalid/.test(m)) return { ok: false, status: 409, error: "this master failed byte verification: the creator must upload it again" };
  if (/release_master_unhashed/.test(m)) return { ok: false, status: 409, error: "verify the audio before approving it" };
  if (/release_master_hash_mismatch/.test(m)) return { ok: false, status: 409, error: "the audio is not the version you listened to: verify it again" };
  if (/release_master_hash_required|review_expected_updated_at_required/.test(m)) return { ok: false, status: 400, error: "verify the audio and review it again" };
  return null;
}

/** The first and last characters of a hash, as the desk shows it. */
export function shortHash(sha256: string) {
  return /^[0-9a-f]{64}$/.test(sha256) ? `${sha256.slice(0, 12)}…${sha256.slice(-4)}` : "";
}
