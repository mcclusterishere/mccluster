/* ============================================================
   THE ASSET VAULT — WRITE SIDE.

   Content-addressed, loopback-bound, token-gated. A generated
   artifact is not finished when it exists on a GPU node's disk; it is
   finished when it is in here under its own SHA-256, with provenance
   beside it. That is what makes an asset McCluster's rather than a
   provider's.

   Storage layout, which the read gateway mirrors exactly:

     <root>/sha256/<ab>/<abcdef...64>/<filename>
     <root>/sha256/<ab>/<abcdef...64>/metadata.json
     <root>/.incoming/<timestamp>-<uuid>.part   (never served)

   Nothing here is Cloudflare-shaped. The service speaks plain HTTP on
   loopback and is reached through whatever TLS terminator is in front
   of it today; swapping a tunnel for a reverse proxy changes no code.
   ============================================================ */

import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readFile, writeFile } from 'node:fs/promises';

const SHA256 = /^[a-f0-9]{64}$/;

/* Configuration is read when the server is built, not when the module
   is imported, so tests can stand a real vault up in a temporary
   directory without the process needing a production token in its
   environment just to load the file. */
export function config(env = process.env) {
  const cfg = {
    host: env.MCCLUSTER_ASSET_INGRESS_HOST || '127.0.0.1',
    port: Number(env.MCCLUSTER_ASSET_INGRESS_PORT || 4811),
    root: env.MCCLUSTER_ASSET_ROOT || '/var/lib/mccluster-assets',
    publicBase: String(env.MCCLUSTER_ASSET_PUBLIC_BASE || 'https://assets.mccluster.org').replace(/\/+$/, ''),
    token: String(env.MCCLUSTER_ASSET_INGEST_TOKEN || ''),
    maxBytes: Number(env.MCCLUSTER_ASSET_MAX_BYTES || 8 * 1024 * 1024 * 1024),
    idleTimeoutMs: Number(env.MCCLUSTER_ASSET_INGRESS_IDLE_MS || 120_000)
  };
  if (!cfg.token) throw new Error('MCCLUSTER_ASSET_INGEST_TOKEN is required');
  if (cfg.token.length < 32) throw new Error('MCCLUSTER_ASSET_INGEST_TOKEN must be at least 32 characters');
  if (!Number.isFinite(cfg.maxBytes) || cfg.maxBytes <= 0) throw new Error('MCCLUSTER_ASSET_MAX_BYTES must be a positive number');
  if (!Number.isFinite(cfg.port) || cfg.port <= 0) throw new Error('MCCLUSTER_ASSET_INGRESS_PORT must be a positive number');
  return cfg;
}

/* The metadata sidecar lives in the same directory as the asset, so a
   client must never be able to name its upload `metadata.json` and
   overwrite the provenance record — or have the provenance write
   overwrite the asset. Dotfiles are reserved for the same reason. */
export const RESERVED_FILENAMES = new Set(['metadata.json']);

/* An uploader holding the ingest token could otherwise store
   `text/html` and get same-origin script execution on the public asset
   host. The vault stores media, so it stores a media content type or
   it stores bytes. */
const SAFE_MIME = /^(image|video|audio|model|application|text)\/[A-Za-z0-9.+-]+$/;
const FORBIDDEN_MIME = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/javascript)\b/i;

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

/* Comparing raw buffers leaks the token's length through the
   short-circuit on `.length`, and timingSafeEqual throws on a length
   mismatch, so the naive version cannot be written safely. Digesting
   both sides first makes every comparison the same fixed width and the
   same duration regardless of what was supplied. */
export function tokenMatches(provided, expected) {
  const a = createHash('sha256').update(String(provided ?? '')).digest();
  const b = createHash('sha256').update(String(expected ?? '')).digest();
  return timingSafeEqual(a, b);
}

export function authorized(req, token) {
  const value = String(req.headers?.authorization || '');
  if (!value.startsWith('Bearer ')) return false;
  return tokenMatches(value.slice(7), token);
}

export function filename(value) {
  const raw = String(value || 'asset.bin').trim();
  const base = path.basename(raw).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '');
  const cleaned = (base || 'asset.bin').slice(0, 180);
  return RESERVED_FILENAMES.has(cleaned.toLowerCase()) ? `asset-${cleaned}` : cleaned;
}

export function mimeType(value) {
  const raw = String(value || '').split(';')[0].trim().toLowerCase();
  if (!raw || !SAFE_MIME.test(raw) || FORBIDDEN_MIME.test(raw)) return 'application/octet-stream';
  return raw.slice(0, 120);
}

function header(req, name, max = 500) {
  const value = req.headers[name];
  return value == null ? null : String(value).slice(0, max);
}

/* The sidecar is written to a temporary file and renamed, exactly like
   the asset, so a crash between open and flush cannot leave a
   half-written provenance record that parses as valid JSON. */
async function writeAtomic(target, contents) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o640 });
  await rename(temporary, target);
}

async function ingest(req, res, cfg) {
  if (!authorized(req, cfg.token)) return json(res, 401, { error: 'Unauthorized' });

  const declared = req.headers['content-length'] == null ? null : Number(req.headers['content-length']);
  if (declared !== null && (!Number.isFinite(declared) || declared < 0)) {
    return json(res, 400, { error: 'Invalid Content-Length' });
  }
  if (declared !== null && declared > cfg.maxBytes) {
    return json(res, 413, { error: 'Asset exceeds configured maximum size', max_bytes: cfg.maxBytes });
  }

  const incoming = path.join(cfg.root, '.incoming');
  await mkdir(incoming, { recursive: true, mode: 0o750 });
  const temporary = path.join(incoming, `${Date.now()}-${randomUUID()}.part`);
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o640 });
  const digest = createHash('sha256');
  let bytes = 0;
  let tooLarge = false;

  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => { reject(error); };
      output.on('error', fail);
      output.on('finish', resolve);
      req.on('error', fail);
      req.on('aborted', () => fail(new Error('upload aborted by client')));
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > cfg.maxBytes) {
          tooLarge = true;
          req.destroy(new Error('asset too large'));
          return;
        }
        digest.update(chunk);
        if (!output.write(chunk)) {
          req.pause();
          output.once('drain', () => req.resume());
        }
      });
      req.on('end', () => output.end());
    });
  } catch (error) {
    output.destroy();
    await rm(temporary, { force: true }).catch(() => {});
    return json(res, tooLarge ? 413 : 400, {
      error: tooLarge ? 'Asset exceeds configured maximum size' : error.message
    });
  }

  /* A truncated upload still produces a valid SHA-256 — of the wrong
     bytes — and would be stored as a perfectly self-consistent asset
     that simply is not the file anybody meant to send. When the client
     declared a length, it has to match. */
  if (declared !== null && bytes !== declared) {
    await rm(temporary, { force: true }).catch(() => {});
    return json(res, 400, { error: 'Upload truncated', declared_bytes: declared, received_bytes: bytes });
  }

  const sha256 = digest.digest('hex');
  const expected = header(req, 'x-mccluster-sha256', 64)?.toLowerCase() || null;
  if (expected && (!SHA256.test(expected) || expected !== sha256)) {
    await rm(temporary, { force: true }).catch(() => {});
    return json(res, 422, { error: 'Asset SHA-256 mismatch', expected, actual: sha256 });
  }

  const name = filename(header(req, 'x-mccluster-filename', 200));
  const directory = path.join(cfg.root, 'sha256', sha256.slice(0, 2), sha256);
  const finalPath = path.join(directory, name);
  const metadataPath = path.join(directory, 'metadata.json');
  await mkdir(directory, { recursive: true, mode: 0o750 });

  /* Identical bytes are the same asset by definition. The first upload
     wins the provenance record: re-uploading the same GLB from a
     different job must not rewrite which node and which model
     revision produced it. */
  let duplicate = false;
  try {
    await stat(finalPath);
    duplicate = true;
    await rm(temporary, { force: true });
  } catch {
    await rename(temporary, finalPath);
  }

  if (duplicate) {
    const existing = await readFile(metadataPath, 'utf8').then(JSON.parse).catch(() => null);
    if (existing) return json(res, 200, { ...existing, duplicate: true });
  }

  const metadata = {
    schema_version: 1,
    asset_id: `sha256:${sha256}`,
    sha256,
    bytes,
    filename: name,
    mime_type: mimeType(header(req, 'content-type', 200)),
    canonical_url: `${cfg.publicBase}/a/${sha256}/${encodeURIComponent(name)}`,
    created_at: new Date().toISOString(),
    source: {
      capability: header(req, 'x-mccluster-capability'),
      task_id: header(req, 'x-mccluster-task-id'),
      job_id: header(req, 'x-mccluster-job-id'),
      node_id: header(req, 'x-mccluster-node-id'),
      node_gpu: header(req, 'x-mccluster-node-gpu'),
      implementation: header(req, 'x-mccluster-implementation'),
      model: header(req, 'x-mccluster-model'),
      model_revision: header(req, 'x-mccluster-model-revision'),
      model_sha256: header(req, 'x-mccluster-model-sha256', 64),
      core_commit: header(req, 'x-mccluster-core-commit', 40),
      prompt_sha256: header(req, 'x-mccluster-prompt-sha256', 64),
      started_at: header(req, 'x-mccluster-started-at', 40),
      finished_at: header(req, 'x-mccluster-finished-at', 40)
    }
  };
  await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return json(res, duplicate ? 200 : 201, duplicate ? { ...metadata, duplicate: true } : metadata);
}

export async function handle(req, res, cfg) {
  const url = new URL(req.url || '/', `http://${cfg.host}:${cfg.port}`);
  if (url.pathname === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'mccluster-asset-ingress', host: cfg.host, port: cfg.port, max_bytes: cfg.maxBytes });
  }
  if (url.pathname !== '/v1/assets') return json(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    return res.end();
  }
  return ingest(req, res, cfg);
}

export function createServer(cfg = config()) {
  const server = http.createServer((req, res) => {
    handle(req, res, cfg).catch((error) => {
      console.error(JSON.stringify({ event: 'asset_ingress_request_failed', error: error.message }));
      if (!res.headersSent) json(res, 500, { error: 'Asset ingress failure' });
      else res.destroy();
    });
  });
  /* A stalled uploader must not hold a socket and a .part file open
     forever. Large legitimate videos keep the socket busy, so this is
     an idle timeout, not a total one. */
  server.setTimeout(cfg.idleTimeoutMs);
  server.headersTimeout = 60_000;
  server.requestTimeout = 0;
  return server;
}

/* Importing this module for tests must not bind a port. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const cfg = config();
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(JSON.stringify({ event: 'asset_ingress_ready', host: cfg.host, port: cfg.port, root: cfg.root }));
  });

  const shutdown = (signal) => {
    console.log(JSON.stringify({ event: 'asset_ingress_shutdown', signal }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
