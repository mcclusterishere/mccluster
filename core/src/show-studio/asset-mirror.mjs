// Copy generated assets out of the provider and into McCluster storage.
//
// Until this runs, media_assets rows carry only the provider's URL, which
// fails twice: the lineage dies when fal expires the link, and the show
// renderer cannot open a URL — Blender needs a file. MCCLUSTER-CORE.md
// already requires the copy ("hashed, inspected, and assigned canonical
// storage paths"); this is that half.
//
// Storage paths are content-addressed by sha256, so the same bytes mirror
// to the same path and a re-download can be proven identical rather than
// merely assumed.

import { createHash } from 'node:crypto';
import { rest } from '../supabase.mjs';

const DEFAULT_BUCKET = 'media-assets';
const MAX_BYTES = 512 * 1024 * 1024;

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function resolveBucket(env = process.env) {
  return text(env.MCCLUSTER_MEDIA_BUCKET, 200) || DEFAULT_BUCKET;
}

// Literal addresses that must never be fetched on behalf of a queued row.
const BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;
const BLOCKED_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** Refuse any asset URL that does not point at the public internet.
 *
 *  The URL is provider-supplied and reaches this process from a job row, so
 *  it is attacker-influenceable in the cases that matter. Core deliberately
 *  runs its own services on loopback and sits on a cloud host whose
 *  metadata service answers on a link-local address; fetching either and
 *  filing the response as a "generated asset" would turn this mirror into
 *  an exfiltration path. engine-probes.mjs asserts the mirror image of this
 *  rule for executor health checks.
 *
 *  This blocks literal addresses. A hostname that resolves to a private
 *  address still gets through, which would need resolve-and-pin to close. */
export function assertPublicHttpUrl(value) {
  const raw = text(value, 4000);
  if (!raw) throw new Error('asset has no url to mirror');

  let url;
  try { url = new URL(raw); }
  catch { throw new Error(`asset url is not a url: ${raw.slice(0, 120)}`); }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`asset url must be http(s): ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST.test(host)) throw new Error(`asset url host is not public: ${host}`);
  if (BLOCKED_V4.some((pattern) => pattern.test(host))) throw new Error(`asset url host is not public: ${host}`);
  // ::1, ::, and the fc00::/7 unique-local range.
  if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    throw new Error(`asset url host is not public: ${host}`);
  }

  return url;
}

function extensionFor(url, mimeType) {
  const fromPath = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(url.pathname);
  if (fromPath) return `.${fromPath[1].toLowerCase()}`;
  const mime = text(mimeType, 200).toLowerCase();
  if (mime.includes('glb') || mime.includes('gltf-binary')) return '.glb';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg')) return '.mp3';
  return '';
}

/** Content-addressed, and namespaced by org so one tenant's bytes never
 *  land under another's prefix. */
export function buildStoragePath({ orgId, sha256, url, mimeType }) {
  const org = text(orgId, 100) || 'unscoped';
  if (!/^[0-9a-f]{64}$/.test(text(sha256, 64))) throw new Error('storage path requires a sha256');
  return `${org}/${sha256.slice(0, 2)}/${sha256}${extensionFor(url, mimeType)}`;
}

export async function claimAssets({ limit = 10, maxAttempts = 5, restImpl = rest } = {}) {
  const { body } = await restImpl('rpc/media_claim_assets_for_mirror_service', {
    method: 'POST',
    body: JSON.stringify({ p_limit: integer(limit, 10, 1, 100), p_max_attempts: integer(maxAttempts, 5, 1, 20) }),
  });
  return Array.isArray(body) ? body : [];
}

/** Download one asset, refusing anything oversized or non-public. */
export async function downloadAsset(asset, { fetchImpl = fetch, maxBytes = MAX_BYTES, timeoutMs = 120_000 } = {}) {
  const url = assertPublicHttpUrl(asset?.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`provider returned HTTP ${res.status} for the asset`);

    const declared = Number(res.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`asset is ${declared} bytes, over the ${maxBytes} mirror limit`);
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`asset is ${bytes.byteLength} bytes, over the ${maxBytes} mirror limit`);
    }
    if (!bytes.byteLength) throw new Error('provider returned an empty asset');

    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: text(res.headers?.get?.('content-type'), 200) || asset?.mime_type || null,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadToStorage({ path: storagePath, bytes, mimeType, bucket, env = process.env, fetchImpl = fetch, headersImpl }) {
  const base = text(env.SUPABASE_URL, 500).replace(/\/$/, '');
  if (!base) throw new Error('SUPABASE_URL is required to mirror an asset');
  const target = `${base}/storage/v1/object/${bucket}/${storagePath}`;

  const res = await fetchImpl(target, {
    method: 'POST',
    headers: {
      ...headersImpl(),
      'content-type': mimeType || 'application/octet-stream',
      // Content-addressed: the same bytes are the same object, so a repeat
      // upload is a no-op rather than a conflict to fail on.
      'x-upsert': 'true',
    },
    body: bytes,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`storage upload failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return storagePath;
}

/** Mirror one claimed asset, recording either the result or the reason. */
export async function mirrorAsset(asset, {
  env = process.env,
  fetchImpl = fetch,
  restImpl = rest,
  headersImpl,
  maxBytes = MAX_BYTES,
} = {}) {
  const bucket = resolveBucket(env);
  try {
    const downloaded = await downloadAsset(asset, { fetchImpl, maxBytes });
    const storagePath = buildStoragePath({
      orgId: asset.org_id,
      sha256: downloaded.sha256,
      url: downloaded.url,
      mimeType: downloaded.mimeType,
    });

    await uploadToStorage({
      path: storagePath,
      bytes: downloaded.bytes,
      mimeType: downloaded.mimeType,
      bucket,
      env,
      fetchImpl,
      headersImpl,
    });

    await restImpl('rpc/media_record_asset_mirror', {
      method: 'POST',
      body: JSON.stringify({
        p_asset_id: asset.id,
        p_storage_path: storagePath,
        p_sha256: downloaded.sha256,
        p_bytes: downloaded.bytes.byteLength,
        p_mime_type: downloaded.mimeType,
      }),
    });

    return {
      asset_id: asset.id,
      ok: true,
      storage_path: storagePath,
      sha256: downloaded.sha256,
      bytes: downloaded.bytes.byteLength,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await restImpl('rpc/media_fail_asset_mirror', {
      method: 'POST',
      body: JSON.stringify({ p_asset_id: asset.id, p_reason: reason }),
    }).catch(() => {});
    return { asset_id: asset.id, ok: false, error: reason };
  }
}

export async function mirrorClaimedAssets({ limit = 10, ...options } = {}) {
  const assets = await claimAssets({ limit, restImpl: options.restImpl });
  const results = [];
  for (const asset of assets) results.push(await mirrorAsset(asset, options));
  return {
    claimed: assets.length,
    mirrored: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
