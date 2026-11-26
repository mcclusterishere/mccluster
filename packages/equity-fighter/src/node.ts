/* Node 20+ runner: an HTTP listener for platform webhooks plus a relay loop.
   Binds to loopback by default; publish it through the same authenticated
   tunnel / reverse proxy as Core rather than opening a port. Hosting is the
   owner's call (docs/control-plane/EQUITY-FIGHTER.md, "Hosting"). */

import http from 'node:http';
import { createFromEnv, publicStatus } from './index.js';

const HOST = process.env.EQUITY_FIGHTER_HOST || '127.0.0.1';
const PORT = Number(process.env.EQUITY_FIGHTER_PORT || 4790);
const RELAY_MS = Math.max(5_000, Number(process.env.EQUITY_FIGHTER_RELAY_INTERVAL_MS || 20_000));

const log = (event: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), service: 'equity-fighter', event, ...detail }));

const { gateway, config } = createFromEnv(process.env, { waitUntil: (work) => void work.catch(() => {}), log });
log('start', publicStatus(config));

const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 256 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url || '/'}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers, body });
    const response = gateway
      ? await gateway.fetch(request)
      : new URL(url).pathname === '/health'
        ? new Response(JSON.stringify(publicStatus(config)), { headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'Equity Fighter is disabled' }), { status: 503, headers: { 'content-type': 'application/json' } });
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    res.writeHead(response.status, outHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    log('http_error', { error: String((error as Error)?.message || error) });
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, HOST, () => log('listening', { host: HOST, port: PORT }));

if (gateway) {
  setInterval(() => {
    gateway.relay().catch((error) => log('relay_error', { error: String(error?.message || error) }));
  }, RELAY_MS).unref();
}
