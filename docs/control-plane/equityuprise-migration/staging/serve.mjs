// Local staging preview: node docs/control-plane/equityuprise-migration/staging/serve.mjs [port]
// Serves the staged equityuprise.com front door at / and every other path from the repository's static tree,
// the way the platform would answer them on equityuprise.com at stage F. Local only; deploys nothing.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = normalize(join(here, '../../../..'));
const port = Number(process.argv[2] || 8790);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let file = url.pathname === '/' ? join(here, 'site/index.html') : normalize(join(repo, decodeURIComponent(url.pathname)));
  if (!file.startsWith(repo)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-staging': 'equityuprise.com' });
    res.end(body);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); }
}).listen(port, () => console.log(`equityuprise.com staging preview on http://localhost:${port}/`));
