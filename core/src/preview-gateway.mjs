import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { open, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { PREVIEW_ROOT, SLUG, confinedPath, publicAsset } from './preview-policy.mjs';

const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.wasm':'application/wasm','.woff2':'font/woff2',
  '.mp3':'audio/mpeg','.mp4':'video/mp4','.glb':'model/gltf-binary','.gltf':'model/gltf+json' };
function json(res, status, value) {
  res.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end(JSON.stringify(value));
}
function validMetadata(meta, slug) {
  return meta?.slug === slug && meta.production === false && /^[a-f0-9]{40}$/.test(meta.commit || '')
    && Number.isFinite(Date.parse(meta.expires_at));
}
export async function cleanupExpired(root = PREVIEW_ROOT, now = Date.now()) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    let meta;
    try { meta = JSON.parse(await readFile(await confinedPath(root, `${entry.name}/metadata.json`), 'utf8')); }
    catch { continue; } // Invalid state is never treated as permission to delete.
    if (validMetadata(meta, entry.name) && Date.parse(meta.expires_at) <= now) {
      await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }
}
export function createPreviewServer({ root = PREVIEW_ROOT, prefix = '/p', now = Date.now } = {}) {
  return http.createServer(async (req, res) => {
    let file;
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.setHeader('allow','GET, HEAD'); return json(res,405,{error:'Method not allowed'}); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') {
        await readdir(root); // An unreadable preview root cannot report healthy.
        return json(res,200,{ok:true,service:'mccluster-preview-gateway'});
      }
      if (!url.pathname.startsWith(prefix + '/')) return json(res,404,{error:'Not found'});
      const parts = decodeURIComponent(url.pathname.slice(prefix.length + 1)).split('/');
      const slug = parts.shift();
      if (!SLUG.test(slug) || parts.some(p => p === '..' || p.includes('\\') || p.includes('\0'))) return json(res,404,{error:'Not found'});
      const metadataPath = await confinedPath(root, `${slug}/metadata.json`);
      const meta = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (!validMetadata(meta, slug)) return json(res,503,{error:'Invalid preview metadata'});
      if (Date.parse(meta.expires_at) <= now()) return json(res,410,{error:'Preview expired'});
      if (!url.pathname.endsWith('/') && parts.length === 0) {
        res.writeHead(308,{location:url.pathname + '/', 'cache-control':'no-store'}); return res.end();
      }
      if (!parts.at(-1)) parts[parts.length - 1] = 'index.html';
      if (!publicAsset(parts)) return json(res,404,{error:'Not found'});
      const publicRoot = await confinedPath(root, `${slug}/public`);
      let target = await confinedPath(publicRoot, parts.join('/'));
      if ((await lstat(target)).isDirectory()) target = await confinedPath(publicRoot, parts.join('/') + '/index.html');
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await file.stat();
      if (!info.isFile()) { await file.close(); file = null; return json(res,404,{error:'Not found'}); }
      res.writeHead(200, {
        'content-type':MIME[path.extname(target)] || 'application/octet-stream', 'content-length':info.size,
        'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer',
        'access-control-allow-origin':'*',
        'content-security-policy':"sandbox allow-scripts allow-forms; worker-src 'none'; frame-ancestors 'self' https://matthew.mccluster.org",
        'permissions-policy':'camera=(), microphone=(), geolocation=()'
      });
      if (req.method === 'HEAD') { await file.close(); file = null; return res.end(); }
      const stream = file.createReadStream(); file = null;
      stream.on('error',() => res.destroy()); res.on('close',() => stream.destroy()); stream.pipe(res);
    } catch (error) {
      if (file) await file.close();
      if (res.headersSent) return res.destroy();
      const status = error instanceof URIError ? 400 : ['ENOENT','ENOTDIR','ELOOP'].includes(error.code) || /symbolic|escaped/.test(error.message) ? 404 : 503;
      json(res,status,{error:status === 404 ? 'Not found' : 'Preview unavailable'});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.MCCLUSTER_PREVIEW_HOST || '127.0.0.1';
  if (!['127.0.0.1','::1'].includes(host)) throw new Error('Preview gateway must bind to loopback');
  const server = createPreviewServer();
  server.listen(Number(process.env.MCCLUSTER_PREVIEW_PORT || 4799), host);
  const clean = () => cleanupExpired().catch(() => console.error('Preview cleanup failed'));
  await clean(); const timer = setInterval(clean, 3600000); timer.unref();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(); });
}
