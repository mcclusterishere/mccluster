// ONE-CLICK DEVICE OPT-IN, staged end to end (owner, 2026-11-24: "log into the Mac on the website and just click the
// opt-in button ... any computer ... including possibly a phone").
//
// The REAL gateway (core/src/compute/gateway.mjs) on the real compute SQL (PGlite behind the PostgREST shim), a
// stand-in for Supabase Auth and control_authorize_service (owner allowed, member refused), a REAL Chromium running
// js/device-node.js (WebCrypto Ed25519, IndexedDB) from an allowed origin as a phone, and the REAL node agent
// enrolling with MCCLUSTER_NODE_ENROLL_GRANT. Checks:
//   grants: owner 201, member 403, no session 401; tampered and expired grants 401;
//   the phone opts in, enrols as owned / browser / opted_in_by the owner, and heartbeats live;
//   the same grant cannot enrol a second device (409 GRANT_USED); the same device may retry;
//   CORS: the allowed origin gets its headers, another origin is refused at preflight;
//   the full node agent enrols with an installer grant, labelled website.
//
//   PGLITE_MODULE_PATH=<pglite dist/index.js> [PLAYWRIGHT_DIR=<node_modules>] node scripts/staging/device-jobs/device-optin.mjs [--out dir]
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadComputeSchema, openPglite, startPostgrestShim } from './pglite-postgrest.mjs';
import { issueGrant } from '../../../core/src/compute/device-grant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(argOut > 0 ? process.argv[argOut + 1] : path.join(os.tmpdir(), `device-optin-${Date.now()}`));
fs.mkdirSync(OUT, { recursive: true });
const ORG = '00000000-0000-4000-8000-00000000c0de';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000b2';
const secrets = { apiKey: crypto.randomBytes(24).toString('hex'), enroll: crypto.randomBytes(24).toString('hex'), admin: crypto.randomBytes(24).toString('hex') };
const SESSIONS = { 'owner-session': OWNER, 'member-session': MEMBER };
const results = [];
const children = [];
const closers = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + JSON.stringify(detail))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } return null; }
async function call(url, init = {}) {
  const r = await fetch(url, init); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t }; }
  return { status: r.status, body: j, headers: r.headers };
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const db = await openPglite();
await loadComputeSchema(db, ROOT);
await db.query('insert into public.orgs(id, slug, enabled) values ($1, $2, true)', [ORG, 'mccluster']);
const shim = await startPostgrestShim({ db, apiKey: secrets.apiKey });

/* Supabase Auth and the ops.use check, in front of the shim */
const front = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname === '/auth/v1/user') {
    const uid = SESSIONS[String(req.headers.authorization || '').replace(/^Bearer /, '')];
    return uid ? send(200, { id: uid }) : send(401, { msg: 'invalid JWT' });
  }
  if (url.pathname === '/rest/v1/rpc/control_authorize_service') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    return send(200, [{ allowed: b.p_actor === OWNER && b.p_org === ORG && b.p_capability === 'ops.use' }]);
  }
  const up = http.request(`${shim.url}${req.url}`, { method: req.method, headers: { ...req.headers, host: new URL(shim.url).host } }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res); });
  req.pipe(up);
});
const frontPort = await listen(front);

/* the website: this checkout's files, on an origin the gateway allows */
const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };
const site = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/node.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><script src="/js/device-node.js"></script>'); }
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const sitePort = await listen(site);
const SITE = `http://127.0.0.1:${sitePort}`;

const gwPort = 46000 + Math.floor(Math.random() * 1000);
const GW = `http://127.0.0.1:${gwPort}`;
function spawnChild(name, script, env) {
  const out = fs.createWriteStream(path.join(OUT, `${name}.log`));
  const c = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.pipe(out); c.stderr.pipe(out); children.push(c); return c;
}
spawnChild('gateway', path.join(ROOT, 'core/src/compute/gateway.mjs'), {
  SUPABASE_URL: `http://127.0.0.1:${frontPort}`, SUPABASE_SERVICE_ROLE_KEY: secrets.apiKey, MCCLUSTER_ORG_ID: ORG, MCCLUSTER_CORE_ID: 'staging-gateway',
  CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(gwPort), CORE_COMPUTE_ENROLL_TOKEN: secrets.enroll, CORE_COMPUTE_ADMIN_TOKEN: secrets.admin,
  CORE_COMPUTE_BROWSER_ORIGINS: SITE, MCCLUSTER_COMPUTE_PUBLIC_URL: GW
});
let browser;
try {
  check('gateway starts', await waitFor(async () => (await call(`${GW}/health`)).status === 200), {});
  const grantFor = (session, kind) => call(`${GW}/v1/compute/device-grants`, { method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) }, body: JSON.stringify({ kind }) });

  /* grants: only the owner */
  const g1 = await grantFor('owner-session', 'browser');
  check('the owner gets a browser grant (201), 15 minutes, with the org', g1.status === 201 && /^mccg1\./.test(g1.body.grant) && g1.body.org_id === ORG && Date.parse(g1.body.expires_at) - Date.now() > 14 * 60_000, g1);
  check('a signed-in member who is not the owner is refused (403)', (await grantFor('member-session', 'browser')).status === 403);
  check('no session is refused (401)', (await grantFor(null, 'browser')).status === 401);

  /* CORS */
  const pre = await fetch(`${GW}/v1/compute/device-grants`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
  check('the website origin passes preflight with its own origin echoed', pre.status === 204 && pre.headers.get('access-control-allow-origin') === SITE && /x-mccluster-signature/.test(pre.headers.get('access-control-allow-headers')));
  const bad = await fetch(`${GW}/v1/compute/device-grants`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  check('another origin is refused at preflight, with no allow header', bad.status === 403 && !bad.headers.get('access-control-allow-origin'));

  /* a phone opts in from the page: real WebCrypto Ed25519, real IndexedDB */
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
  catch { ({ chromium } = createRequire(path.join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await phone.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${SITE}/node.html`);
  const optIn = await page.evaluate(async ([gw, grant, org]) => {
    const states = [];
    const n = new window.MCC_DEVICE_NODE.DeviceNode({ computeUrl: gw, onState: (s) => states.push(s) });
    try { await n.optIn(grant, org, 'phone browser'); } catch (e) { return { error: e.message, code: e.code }; }
    const st = await n.status();
    n.stop();
    return { st, state: states[0] };
  }, [GW, g1.body.grant, ORG]);
  check('the phone opts in and its first heartbeat is live', optIn.st?.enrolled === true && optIn.state?.live === true, optIn);
  const nodes = (await call(`${GW}/v1/compute/nodes?org_id=${ORG}`, { headers: { authorization: `Bearer ${secrets.admin}` } })).body;
  const list = nodes?.nodes || nodes || [];
  const phoneNode = list.find((n) => n.id === optIn.st?.nodeId);
  const L = phoneNode?.labels || {};
  check('the network has it: owned, a browser phone, opted in by the owner, from the browser', !!phoneNode && L.enrolled_trust === 'owned' && L.role === 'browser-phone' && L.enrolled_via === 'browser' && L.opted_in_by === OWNER, { labels: L, ids: list.map((n) => n.id) });
  check('its inventory is what the browser measured', /^browser:/.test(phoneNode?.inventory?.platform || '') && Number(phoneNode?.inventory?.cpu_count) >= 0, phoneNode?.inventory);
  check('it advertises no work it cannot do (no runners yet)', Array.isArray(phoneNode?.capabilities) && phoneNode.capabilities.length === 0, phoneNode?.capabilities);

  /* one grant, one device */
  const second = await browser.newContext();
  const p2 = await second.newPage(); await p2.goto(`${SITE}/node.html`);
  const reuse = await p2.evaluate(async ([gw, grant, org]) => {
    try { await new window.MCC_DEVICE_NODE.DeviceNode({ computeUrl: gw }).optIn(grant, org, 'second'); return { ok: true }; } catch (e) { return { status: e.status, code: e.code }; }
  }, [GW, g1.body.grant, ORG]);
  check('the same grant cannot enrol a second device (409 GRANT_USED)', reuse.status === 409 && reuse.code === 'GRANT_USED', reuse);
  const again = await page.evaluate(async (gw) => { const n = new window.MCC_DEVICE_NODE.DeviceNode({ computeUrl: gw }); await n.start(); n.stop(); return (await n.status()).enrolled; }, GW);
  check('the phone keeps its key across a reload and starts again without a grant', again === true);

  /* bad grants */
  const tampered = g1.body.grant.slice(0, -2) + (g1.body.grant.endsWith('A') ? 'BB' : 'AA');
  const expired = issueGrant({ key: secrets.enroll, orgId: ORG, userId: OWNER, kind: 'browser', now: Date.now() - 20 * 60_000 }).grant;
  for (const [label, grant, code] of [['tampered', tampered, 'INVALID_GRANT'], ['expired', expired, 'GRANT_EXPIRED']]) {
    const p3 = await (await browser.newContext()).newPage(); await p3.goto(`${SITE}/node.html`);
    const r = await p3.evaluate(async ([gw, grant, org]) => { try { await new window.MCC_DEVICE_NODE.DeviceNode({ computeUrl: gw }).optIn(grant, org, 'x'); return {}; } catch (e) { return { status: e.status, code: e.code }; } }, [GW, grant, ORG]);
    check(`a ${label} grant is refused (401 ${code})`, r.status === 401 && r.code === code, r);
  }
  check('no page errors', errors.length === 0, errors);

  /* the full node: the real agent with an installer grant */
  const g2 = await grantFor('owner-session', 'installer');
  /* the agent only speaks https: a loopback TLS front door, as in run.mjs */
  const key = path.join(OUT, 'tls-key.pem'), cert = path.join(OUT, 'tls-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const tls = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const up = http.request({ host: '127.0.0.1', port: gwPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${gwPort}` } }, (u) => { res.writeHead(u.statusCode, u.headers); u.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  const tlsPort = await listen(tls);
  closers.push(() => tls.close());
  const stateDir = path.join(OUT, 'agent-state'); fs.mkdirSync(stateDir, { recursive: true });
  const manifest = path.join(OUT, 'capabilities.json');
  fs.writeFileSync(manifest, JSON.stringify({ max_leases: 1, labels: { site: 'owner-mac-m1', trust: 'owned', role: 'apple-silicon-laptop' }, capabilities: [] }));
  spawnChild('node-agent', path.join(ROOT, 'core/src/compute/node-agent.mjs'), {
    MCCLUSTER_COMPUTE_URL: `https://127.0.0.1:${tlsPort}`, NODE_EXTRA_CA_CERTS: cert, MCCLUSTER_ORG_ID: ORG, MCCLUSTER_NODE_NAME: 'shiloh-mac', MCCLUSTER_NODE_ENROLL_GRANT: g2.body.grant,
    MCCLUSTER_NODE_ENROLL_TOKEN: '', MCCLUSTER_NODE_STATE_DIR: stateDir, MCCLUSTER_NODE_MANIFEST: manifest, MCCLUSTER_NODE_ENROLL_ONLY: '1'
  });
  const agentNode = await waitFor(async () => {
    const b = (await call(`${GW}/v1/compute/nodes?org_id=${ORG}`, { headers: { authorization: `Bearer ${secrets.admin}` } })).body;
    return (b?.nodes || b || []).find((n) => n.display_name === 'shiloh-mac');
  }, 30000);
  check('the full node agent enrols with an installer grant, labelled website and owned', agentNode?.labels?.enrolled_via === 'website' && agentNode?.labels?.enrolled_trust === 'owned' && agentNode?.labels?.opted_in_by === OWNER,
    { labels: agentNode?.labels, log: fs.existsSync(path.join(OUT, 'node-agent.log')) ? fs.readFileSync(path.join(OUT, 'node-agent.log'), 'utf8').slice(-1500) : '' });
} finally {
  if (browser) await browser.close();
  for (const c of children) try { c.kill('SIGTERM'); } catch {}
  for (const c of closers) try { c(); } catch {}
  front.close(); site.close(); await shim.close?.();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
