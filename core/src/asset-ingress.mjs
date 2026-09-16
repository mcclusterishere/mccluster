import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';

const HOST = process.env.MCCLUSTER_ASSET_INGRESS_HOST || '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_ASSET_INGRESS_PORT || 4811);
const ROOT = process.env.MCCLUSTER_ASSET_ROOT || '/var/lib/mccluster-assets';
const PUBLIC_BASE = String(process.env.MCCLUSTER_ASSET_PUBLIC_BASE || 'https://assets.mccluster.org').replace(/\/+$/, '');
const TOKEN = String(process.env.MCCLUSTER_ASSET_INGEST_TOKEN || '');
const MAX_BYTES = Number(process.env.MCCLUSTER_ASSET_MAX_BYTES || 8 * 1024 * 1024 * 1024);
const SHA256 = /^[a-f0-9]{64}$/;

if (!TOKEN) throw new Error('MCCLUSTER_ASSET_INGEST_TOKEN is required');
if (!Number.isFinite(MAX_BYTES) || MAX_BYTES <= 0) throw new Error('MCCLUSTER_ASSET_MAX_BYTES must be a positive number');

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function authorized(req) {
  const value = String(req.headers.authorization || '');
  if (!value.startsWith('Bearer ')) return false;
  const provided = Buffer.from(value.slice(7));
  const expected = Buffer.from(TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function filename(value) {
  const raw = String(value || 'asset.bin').trim();
  const base = path.basename(raw).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || 'asset.bin').slice(0, 180);
}

function header(req, name, max = 500) {
  const value = req.headers[name];
  return value == null ? null : String(value).slice(0, max);
}

async function ingest(req, res) {
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return json(res, 413, { error: 'Asset exceeds configured maximum size' });
  }

  const incoming = path.join(ROOT, '.incoming');
  await mkdir(incoming, { recursive: true });
  const temporary = path.join(incoming, `${Date.now()}-${randomUUID()}.part`);
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o640 });
  const digest = createHash('sha256');
  let bytes = 0;
  let aborted = false;

  try {
    await new Promise((resolve, reject) => {
      output.on('error', reject);
      output.on('finish', resolve);
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('request aborted')));
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          aborted = true;
          req.destroy(new Error('asset too large'));
          return;
        }
        digest.update(chunk);
        if (!output.write(chunk)) req.pause(), output.once('drain', () => req.resume());
      });
      req.on('end', () => output.end());
    });
  } catch (error) {
    output.destroy();
    await rm(temporary, { force: true }).catch(() => {});
    return json(res, aborted ? 413 : 400, { error: aborted ? 'Asset exceeds configured maximum size' : error.message });
  }

  const sha256 = digest.digest('hex');
  const expected = header(req, 'x-mccluster-sha256', 64)?.toLowerCase() || null;
  if (expected && (!SHA256.test(expected) || expected !== sha256)) {
    await rm(temporary, { force: true }).catch(() => {});
    return json(res, 422, { error: 'Asset SHA-256 mismatch', expected, actual: sha256 });
  }

  const name = filename(header(req, 'x-mccluster-filename', 200));
  const directory = path.join(ROOT, 'sha256', sha256.slice(0, 2), sha256);
  const finalPath = path.join(directory, name);
  await mkdir(directory, { recursive: true });

  try {
    await stat(finalPath);
    await rm(temporary, { force: true });
  } catch {
    await rename(temporary, finalPath);
  }

  const metadata = {
    schema_version: 1,
    asset_id: `sha256:${sha256}`,
    sha256,
    bytes,
    filename: name,
    mime_type: header(req, 'content-type', 200) || 'application/octet-stream',
    canonical_url: `${PUBLIC_BASE}/a/${sha256}/${encodeURIComponent(name)}`,
    created_at: new Date().toISOString(),
    source: {
      capability: header(req, 'x-mccluster-capability'),
      task_id: header(req, 'x-mccluster-task-id'),
      job_id: header(req, 'x-mccluster-job-id'),
      node_id: header(req, 'x-mccluster-node-id'),
      implementation: header(req, 'x-mccluster-implementation'),
      model: header(req, 'x-mccluster-model'),
      model_revision: header(req, 'x-mccluster-model-revision'),
      model_sha256: header(req, 'x-mccluster-model-sha256', 64)
    }
  };
  await writeFile(path.join(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
  return json(res, 201, metadata);
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'mccluster-asset-ingress', host: HOST, port: PORT, max_bytes: MAX_BYTES });
  }
  if (url.pathname !== '/v1/assets') return json(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    return res.end();
  }
  return ingest(req, res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(JSON.stringify({ event: 'asset_ingress_request_failed', error: error.message }));
    if (!res.headersSent) json(res, 500, { error: 'Asset ingress failure' });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'asset_ingress_ready', host: HOST, port: PORT, root: ROOT }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'asset_ingress_shutdown', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
