import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';

const HOST = process.env.MCCLUSTER_PREVIEW_HOST || '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_PREVIEW_PORT || 4799);
const PREVIEW_ROOT = process.env.MCCLUSTER_PREVIEW_ROOT || '/var/lib/mccluster-core/previews';
const URL_PREFIX = `/${String(process.env.MCCLUSTER_PREVIEW_URL_PREFIX || 'p').replace(/^\/+|\/+$/g, '')}`;
const SLUG = /^[a-z0-9][a-z0-9-]{0,71}$/;
const CLEANUP_INTERVAL_MS = Number(process.env.MCCLUSTER_PREVIEW_CLEANUP_INTERVAL_MS || 60 * 60_000);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.wasm', 'application/wasm'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json']
]);

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

function safeHeaders(type, size) {
  return {
    'content-type': type,
    'content-length': size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN'
  };
}

async function metadataFor(slug) {
  try {
    return JSON.parse(await readFile(path.join(PREVIEW_ROOT, slug, 'metadata.json'), 'utf8'));
  } catch {
    return null;
  }
}

function expired(metadata) {
  const time = Date.parse(metadata?.expires_at || '');
  return Number.isFinite(time) && Date.now() >= time;
}

async function resolveFile(publicRoot, relativePath, accept) {
  const decoded = decodeURIComponent(relativePath || '');
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((part) => part === '..' || part.includes('\0'))) return null;

  const requested = path.resolve(publicRoot, segments.join('/'));
  if (!(requested === publicRoot || requested.startsWith(`${publicRoot}${path.sep}`))) return null;

  const candidates = [requested];
  if (!segments.length || decoded.endsWith('/')) candidates.unshift(path.join(requested, 'index.html'));
  if (accept?.includes('text/html') && path.extname(requested) === '') candidates.push(path.join(publicRoot, 'index.html'));

  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        const index = path.join(candidate, 'index.html');
        const indexInfo = await lstat(index);
        if (!indexInfo.isSymbolicLink() && indexInfo.isFile()) return { file: index, info: indexInfo };
        continue;
      }
      if (info.isFile()) return { file: candidate, info };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function previewCounts() {
  let active = 0;
  let stale = 0;
  try {
    const entries = await readdir(PREVIEW_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
      const meta = await metadataFor(entry.name);
      if (meta && expired(meta)) stale += 1;
      else if (meta) active += 1;
    }
  } catch {}
  return { active, stale };
}

async function cleanupExpired() {
  try {
    const entries = await readdir(PREVIEW_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
      const meta = await metadataFor(entry.name);
      if (meta && expired(meta)) {
        await rm(path.join(PREVIEW_ROOT, entry.name), { recursive: true, force: true });
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error(JSON.stringify({ event: 'preview_cleanup_failed', error: error.message }));
  }
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (url.pathname === '/health') {
    const counts = await previewCounts();
    return json(res, 200, { ok: true, service: 'mccluster-preview-gateway', host: HOST, port: PORT, previews: counts });
  }

  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }

  if (!url.pathname.startsWith(`${URL_PREFIX}/`)) return json(res, 404, { error: 'Not found' });
  const remainder = url.pathname.slice(URL_PREFIX.length + 1);
  const slash = remainder.indexOf('/');
  const slug = slash === -1 ? remainder : remainder.slice(0, slash);
  const relativePath = slash === -1 ? '' : remainder.slice(slash + 1);
  if (!SLUG.test(slug)) return json(res, 404, { error: 'Preview not found' });

  const meta = await metadataFor(slug);
  if (!meta) return json(res, 404, { error: 'Preview not found' });
  if (expired(meta)) return json(res, 410, { error: 'Preview expired', expires_at: meta.expires_at });

  const publicRoot = path.resolve(PREVIEW_ROOT, slug, 'public');
  let resolved;
  try {
    resolved = await resolveFile(publicRoot, relativePath, req.headers.accept || '');
  } catch (error) {
    if (error instanceof URIError) return json(res, 400, { error: 'Invalid preview path' });
    throw error;
  }
  if (!resolved) return json(res, 404, { error: 'Preview asset not found' });

  const type = MIME.get(path.extname(resolved.file).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, safeHeaders(type, resolved.info.size));
  if (req.method === 'HEAD') return res.end();
  createReadStream(resolved.file).pipe(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(JSON.stringify({ event: 'preview_gateway_request_failed', error: error.message }));
    if (!res.headersSent) json(res, 500, { error: 'Preview gateway failure' });
    else res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: 'preview_gateway_ready', host: HOST, port: PORT, preview_root: PREVIEW_ROOT, url_prefix: URL_PREFIX }));
});

await cleanupExpired();
const cleanupTimer = setInterval(cleanupExpired, Math.max(60_000, CLEANUP_INTERVAL_MS));
cleanupTimer.unref();

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'preview_gateway_shutdown', signal }));
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
