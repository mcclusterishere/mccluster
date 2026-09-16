import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

const HOST = process.env.MCCLUSTER_ASSET_HOST || '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_ASSET_PORT || 4810);
const ROOT = process.env.MCCLUSTER_ASSET_ROOT || '/var/lib/mccluster-assets';
const SHA256 = /^[a-f0-9]{64}$/;

const MIME = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.gif', 'image/gif'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
  ['.wav', 'audio/wav'], ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.m4a', 'audio/mp4'],
  ['.glb', 'model/gltf-binary'], ['.gltf', 'model/gltf+json'], ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'], ['.bin', 'application/octet-stream']
]);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*'
  });
  res.end(payload);
}

function assetDirectory(sha256) {
  return path.join(ROOT, 'sha256', sha256.slice(0, 2), sha256);
}

function safeFilename(value) {
  const decoded = decodeURIComponent(String(value || ''));
  if (!decoded || decoded !== path.basename(decoded) || decoded.includes('\0')) return null;
  return decoded;
}

function parseRange(value, size) {
  if (!value || !value.startsWith('bytes=')) return null;
  const [first] = value.slice(6).split(',');
  const match = /^(\d*)-(\d*)$/.exec(first.trim());
  if (!match) return null;
  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function metadata(sha256) {
  try {
    return JSON.parse(await readFile(path.join(assetDirectory(sha256), 'metadata.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function serveAsset(req, res, sha256, rawName) {
  if (!SHA256.test(sha256)) return json(res, 404, { error: 'Asset not found' });
  const name = safeFilename(rawName);
  if (!name) return json(res, 404, { error: 'Asset not found' });

  const directory = assetDirectory(sha256);
  const file = path.join(directory, name);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) return json(res, 404, { error: 'Asset not found' });

  let info;
  try { info = await stat(resolved); }
  catch { return json(res, 404, { error: 'Asset not found' }); }
  if (!info.isFile()) return json(res, 404, { error: 'Asset not found' });

  const meta = await metadata(sha256);
  const type = meta?.filename === name && meta?.mime_type
    ? meta.mime_type
    : (MIME.get(path.extname(name).toLowerCase()) || 'application/octet-stream');
  const range = parseRange(req.headers.range, info.size);
  const common = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin'
  };

  if (req.headers.range && !range) {
    res.writeHead(416, { ...common, 'content-range': `bytes */${info.size}` });
    return res.end();
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...common,
      'content-length': length,
      'content-range': `bytes ${range.start}-${range.end}/${info.size}`
    });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(resolved, { start: range.start, end: range.end }).pipe(res);
  }

  res.writeHead(200, { ...common, 'content-length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(resolved).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/health') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    return json(res, 200, { ok: true, service: 'mccluster-asset-gateway', host: HOST, port: PORT, root: ROOT });
  }
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }

  const match = /^\/a\/([a-f0-9]{64})\/([^/]+)$/.exec(url.pathname);
  if (match) return serveAsset(req, res, match[1], match[2]);

  const meta = /^\/meta\/([a-f0-9]{64})$/.exec(url.pathname);
  if (meta) {
    const value = await metadata(meta[1]);
    return value ? json(res, 200, value) : json(res, 404, { error: 'Asset not found' });
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(JSON.stringify({ event: 'asset_gateway_request_failed', error: error.message }));
    if (!res.headersSent) json(res, 500, { error: 'Asset gateway failure' });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'asset_gateway_ready', host: HOST, port: PORT, root: ROOT }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'asset_gateway_shutdown', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
