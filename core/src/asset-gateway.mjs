import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

const SHA256 = /^[a-f0-9]{64}$/;

/* Read when the server is built, not when the module is imported, so a
   test can serve a temporary vault without production environment. */
export function config(env = process.env) {
  return {
    host: env.MCCLUSTER_ASSET_HOST || '127.0.0.1',
    port: Number(env.MCCLUSTER_ASSET_PORT || 4810),
    root: env.MCCLUSTER_ASSET_ROOT || '/var/lib/mccluster-assets'
  };
}

/* The provenance sidecar is reachable at /meta/<sha>, which is the
   route built for it. Serving it through the asset route as well would
   make it collide with an upload literally named `metadata.json`. */
const RESERVED_FILENAMES = new Set(['metadata.json']);

/* A cross-origin 3D viewer or video element issues a preflight before
   a ranged fetch, and cannot read Content-Range unless it is exposed.
   Without both of these, GLB loading and MP4 seeking fail in a browser
   while curl looks perfectly healthy — which is exactly the kind of bug
   that gets discovered in a demo. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range, content-type',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges, etag, last-modified',
  'access-control-max-age': '86400'
};

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
    ...CORS
  });
  res.end(payload);
}

function assetDirectory(root, sha256) {
  return path.join(root, 'sha256', sha256.slice(0, 2), sha256);
}

export function safeFilename(value) {
  let decoded;
  try { decoded = decodeURIComponent(String(value || '')); }
  catch { return null; }
  if (!decoded || decoded !== path.basename(decoded) || decoded.includes('\0')) return null;
  if (decoded === '.' || decoded === '..' || decoded.startsWith('.')) return null;
  if (RESERVED_FILENAMES.has(decoded.toLowerCase())) return null;
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

async function metadata(root, sha256) {
  try {
    return JSON.parse(await readFile(path.join(assetDirectory(root, sha256), 'metadata.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function serveAsset(req, res, sha256, rawName, root) {
  if (!SHA256.test(sha256)) return json(res, 404, { error: 'Asset not found' });
  const name = safeFilename(rawName);
  if (!name) return json(res, 404, { error: 'Asset not found' });

  const directory = assetDirectory(root, sha256);
  const file = path.join(directory, name);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) return json(res, 404, { error: 'Asset not found' });

  let info;
  try { info = await stat(resolved); }
  catch { return json(res, 404, { error: 'Asset not found' }); }
  if (!info.isFile()) return json(res, 404, { error: 'Asset not found' });

  /* The stored mime_type came from an uploader's Content-Type header.
     The extension is derived from a name this service already
     sanitised, so the extension wins and the stored value is only
     consulted for types the table does not know. Anything unknown is
     served as opaque bytes with nosniff. */
  const meta = await metadata(root, sha256);
  const byExtension = MIME.get(path.extname(name).toLowerCase());
  const stored = meta?.filename === name ? String(meta?.mime_type || '') : '';
  const type = byExtension
    || (/^(image|video|audio|model)\/[A-Za-z0-9.+-]+$/.test(stored) ? stored : 'application/octet-stream');
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
    return pipeFile(res, resolved, { start: range.start, end: range.end });
  }

  res.writeHead(200, { ...common, 'content-length': info.size });
  if (req.method === 'HEAD') return res.end();
  return pipeFile(res, resolved);
}

/* Headers are already sent by the time a read fails, so there is no
   status code left to send: the only honest response is to drop the
   connection rather than let an unhandled 'error' event take the whole
   gateway down with it. */
function pipeFile(res, file, options) {
  const stream = createReadStream(file, options);
  stream.on('error', (error) => {
    console.error(JSON.stringify({ event: 'asset_gateway_stream_failed', file, error: error.message }));
    res.destroy();
  });
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

export async function handle(req, res, cfg) {
  const url = new URL(req.url || '/', `http://${cfg.host}:${cfg.port}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'content-length': '0' });
    return res.end();
  }

  if (url.pathname === '/health') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
    return json(res, 200, { ok: true, service: 'mccluster-asset-gateway', host: cfg.host, port: cfg.port, root: cfg.root });
  }
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { allow: 'GET, HEAD, OPTIONS', ...CORS });
    return res.end();
  }

  const match = /^\/a\/([a-f0-9]{64})\/([^/]+)$/.exec(url.pathname);
  if (match) return serveAsset(req, res, match[1], match[2], cfg.root);

  const meta = /^\/meta\/([a-f0-9]{64})$/.exec(url.pathname);
  if (meta) {
    const value = await metadata(cfg.root, meta[1]);
    return value ? json(res, 200, value) : json(res, 404, { error: 'Asset not found' });
  }

  return json(res, 404, { error: 'Not found' });
}

export function createServer(cfg = config()) {
  return http.createServer((req, res) => {
    handle(req, res, cfg).catch((error) => {
      console.error(JSON.stringify({ event: 'asset_gateway_request_failed', error: error.message }));
      if (!res.headersSent) json(res, 500, { error: 'Asset gateway failure' });
      else res.destroy();
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const cfg = config();
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(JSON.stringify({ event: 'asset_gateway_ready', host: cfg.host, port: cfg.port, root: cfg.root }));
  });

  const shutdown = (signal) => {
    console.log(JSON.stringify({ event: 'asset_gateway_shutdown', signal }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
