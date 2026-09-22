/* ============================================================
   THE NODE HOST.

   Runs the Worker's own source, unmodified. src/entry-platform.js is
   imported and its default export called exactly as Cloudflare calls it:
   fetch(request, env, ctx). Nothing in src/ knows this file exists.

   That is the point. The whole migration plan rests on running the two
   in parallel and comparing responses, and a comparison between the real
   code and a hand-ported copy of it would prove nothing. One source, two
   hosts.

   WHAT THIS PROVIDES
     Request/Response  native in Node 18+, so the handler's own types are
                       already right; this only bridges node:http at the
                       edges.
     env               process.env plus the three shimmed bindings.
     ctx.waitUntil     real: the process tracks the promise and the
                       shutdown path awaits it, so background work is not
                       cut off mid-flight the way a naive no-op would.
     request.cf        geo from MaxMind, see shims/geo.mjs.
     scheduled()       the cron the [triggers] block declares, run by a
                       timer here rather than by Cloudflare.
   ============================================================ */
import { createServer } from 'node:http';
import { makeR2Bucket } from './shims/r2.mjs';
import { makeNamespace } from './shims/cloudflare-workers.mjs';
import { lookupGeo } from './shims/geo.mjs';

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
/* Behind nginx. The client IP is whatever the proxy says it is, and
   trusting XFF from an arbitrary source would let anyone forge their own
   country -- which this feeds straight into telemetry. Only the last hop
   added by our own proxy is read. */
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';

const worker = (await import('../src/entry-platform.js')).default;
const { HereTenantAgent } = await import('../src/here-tenant-agent.js');

/* Background work, tracked rather than dropped. */
const inflight = new Set();
function waitUntil(p) {
  const t = Promise.resolve(p).catch((e) => console.error('waitUntil failed:', e?.message || e));
  inflight.add(t);
  t.finally(() => inflight.delete(t));
  return t;
}

const env = {
  ...process.env,
  SEEK_FIRST_ARCHIVE: makeR2Bucket(),
};
env.HereTenantAgent = makeNamespace(HereTenantAgent, 'HereTenantAgent', env);

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',').pop().trim();
  }
  return req.socket.remoteAddress || '';
}

async function toRequest(req, ip) {
  const proto = (TRUST_PROXY && req.headers['x-forwarded-proto']) || 'https';
  const host = req.headers.host || 'api.mccluster.org';
  const url = new URL(req.url, `${proto}://${host}`);

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length) body = Buffer.concat(chunks);
  }

  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]),
    body,
  });

  /* Cloudflare hangs geo off request.cf. It is read-only on a real
     Request, so it is defined rather than assigned. */
  Object.defineProperty(request, 'cf', { value: lookupGeo(ip), enumerable: true });
  return request;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    const ip = clientIp(req);
    const request = await toRequest(req, ip);
    // The Worker reads the visitor's address from this header on Cloudflare.
    if (ip && !request.headers.has('cf-connecting-ip')) {
      request.headers.set('cf-connecting-ip', ip);
    }

    const response = await worker.fetch(request, env, { waitUntil, passThroughOnException() {} });

    res.statusCode = response.status;
    for (const [k, v] of response.headers) res.setHeader(k, v);
    if (response.body) {
      const buf = Buffer.from(await response.arrayBuffer());
      res.setHeader('content-length', String(buf.length));
      res.end(buf);
    } else res.end();

    if (process.env.LOG_REQUESTS !== 'false') {
      console.log(`${req.method} ${req.url} -> ${response.status} ${Date.now() - started}ms`);
    }
  } catch (error) {
    console.error(`${req.method} ${req.url} -> 500`, error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'internal error' }));
  }
});

/* The [triggers] cron, run here. Cloudflare fires this every 5 minutes;
   so does this, and it is skipped while a previous run is still going so
   a slow run cannot pile up on itself. */
const CRON_MS = Number(process.env.CRON_INTERVAL_MS || 5 * 60 * 1000);
let cronBusy = false;
const cron = setInterval(async () => {
  if (cronBusy || !worker.scheduled) return;
  cronBusy = true;
  try {
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env, { waitUntil });
  } catch (e) {
    console.error('scheduled run failed:', e?.message || e);
  } finally { cronBusy = false; }
}, CRON_MS);

async function shutdown(signal) {
  console.log(`${signal}: draining`);
  clearInterval(cron);
  server.close();
  // Let tracked background work finish rather than killing it mid-write.
  await Promise.allSettled([...inflight]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  console.log(`mccluster api host listening on http://${HOST}:${PORT}`);
});
