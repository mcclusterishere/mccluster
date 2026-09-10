/*
  Raw payload archive.

  Rewinding time is only meaningful if the bytes we reasoned over are still
  there. Normalized rows are lossy: a schema changes, a normalizer is fixed, a
  provider quietly restates history, and the record no longer explains the
  decision that was made from it. So every upstream response is stored verbatim
  before anything interprets it, and every derived row can name the exact
  archived object it came from.

  Two properties make this affordable at catalog scale.

  Content addressing. The key contains a hash of the body, so a source that has
  not changed since the last poll writes nothing new -- it resolves to the same
  key and is skipped. Polling a slow-moving catalog hourly for a year costs
  roughly as much as the number of times it actually changed.

  R2 has no egress fee. Replaying an archive means reading a great deal of it
  back; on an object store that bills egress, the read is what makes historical
  replay unaffordable, and it is precisely the operation this exists for.
*/

const MAX_BODY_BYTES = 96 * 1024 * 1024;

export class ArchiveError extends Error {
  constructor(message, code = 'archive_error') {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function segment(value, fallback = 'unknown') {
  const cleaned = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

/**
 * Keys are date-partitioned then content-addressed:
 *   raw/{source}/{YYYY}/{MM}/{DD}/{sha256}.json
 *
 * The date comes from when we FETCHED it, not from anything the payload claims,
 * so a provider restating its own timestamps cannot move an object we already
 * hold. Listing a day is a prefix scan; proving a body is unchanged is a key
 * comparison.
 */
export function archiveKey({ source, fetchedAt, hash, extension = 'json' }) {
  const when = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt ?? Date.now());
  if (Number.isNaN(when.getTime())) throw new ArchiveError('fetchedAt is not a valid time', 'bad_time');
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new ArchiveError('hash must be a sha256 hex digest', 'bad_hash');
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  const d = String(when.getUTCDate()).padStart(2, '0');
  return `raw/${segment(source)}/${y}/${m}/${d}/${hash}.${segment(extension, 'bin')}`;
}

function requireBucket(env) {
  const bucket = env?.SEEK_FIRST_ARCHIVE;
  if (!bucket || typeof bucket.put !== 'function') {
    throw new ArchiveError('SEEK_FIRST_ARCHIVE R2 binding is not configured', 'archive_unavailable');
  }
  return bucket;
}

/**
 * Store a payload verbatim. Returns the key, digest, and whether this content
 * was already held -- `stored: false` means the upstream had not changed.
 */
export async function putRaw(env, {
  source,
  body,
  contentType = 'application/json',
  fetchedAt = new Date(),
  sourceUrl = null,
  extension = 'json',
  metadata = {}
}) {
  const bucket = requireBucket(env);
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
  if (bytes.byteLength === 0) throw new ArchiveError('refusing to archive an empty body', 'empty_body');
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new ArchiveError(`payload exceeds archive limit (${bytes.byteLength} bytes)`, 'too_large');
  }

  const hash = await sha256Hex(bytes);
  const key = archiveKey({ source, fetchedAt, hash, extension });

  // Content-addressed: identical bytes on the same day are already archived.
  const existing = await bucket.head(key);
  if (existing) {
    return Object.freeze({ key, hash, bytes: bytes.byteLength, stored: false, deduplicated: true });
  }

  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      source: String(source ?? ''),
      fetched_at: new Date(fetchedAt).toISOString(),
      sha256: hash,
      // The URL is provenance, so it is recorded -- but a query string can
      // carry an API key, so only the origin and path are kept.
      source_url: sourceUrl ? safeUrl(sourceUrl) : '',
      ...Object.fromEntries(
        Object.entries(metadata).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 240)])
      )
    }
  });

  return Object.freeze({ key, hash, bytes: bytes.byteLength, stored: true, deduplicated: false });
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw));
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

/** Read an archived payload back, with the provenance it was stored under. */
export async function getRaw(env, key) {
  const bucket = requireBucket(env);
  const object = await bucket.get(key);
  if (!object) return null;
  return Object.freeze({
    key,
    body: await object.text(),
    size: object.size,
    uploaded: object.uploaded instanceof Date ? object.uploaded.toISOString() : object.uploaded ?? null,
    contentType: object.httpMetadata?.contentType ?? null,
    provenance: Object.freeze({ ...(object.customMetadata ?? {}) })
  });
}

/** Everything archived for a source, optionally narrowed to a UTC day. */
export async function listRaw(env, { source, day = null, limit = 100, cursor = null } = {}) {
  const bucket = requireBucket(env);
  let prefix = `raw/${segment(source)}/`;
  if (day) {
    const when = day instanceof Date ? day : new Date(day);
    if (Number.isNaN(when.getTime())) throw new ArchiveError('day is not a valid date', 'bad_time');
    const m = String(when.getUTCMonth() + 1).padStart(2, '0');
    const d = String(when.getUTCDate()).padStart(2, '0');
    prefix += `${when.getUTCFullYear()}/${m}/${d}/`;
  }
  const listed = await bucket.list({ prefix, limit: Math.min(limit, 1000), cursor: cursor ?? undefined });
  return Object.freeze({
    prefix,
    truncated: Boolean(listed.truncated),
    cursor: listed.truncated ? listed.cursor : null,
    objects: Object.freeze((listed.objects ?? []).map((o) => Object.freeze({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : o.uploaded ?? null,
      sha256: o.customMetadata?.sha256 ?? null,
      source_url: o.customMetadata?.source_url ?? null
    })))
  });
}
