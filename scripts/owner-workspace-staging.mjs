// Temporary, access-code protected staging of the actual owner UI and Core.
// All Node egress is forced to loopback; data, identities and Ollama output are
// disposable fixtures. No production database or service credential is used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startOwnerWorkspaceRuntime } from '../core/test/helpers/owner-workspace-runtime.mjs';
import { WORKSPACE_FIXTURE_OWNER as OWNER, WORKSPACE_FIXTURE_MEMBER as MEMBER } from '../core/test/helpers/owner-workspace-db.mjs';
import { renderOwnerAiStagingPage, BOOTSTRAP_PATH } from './staging/owner-ai/render-page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.MCCLUSTER_STAGING_STATE_FILE;
if (!OUT || !path.isAbsolute(OUT) || OUT.startsWith(ROOT + path.sep)) throw new Error('Use an absolute private staging-state path outside the repository.');
const lifetimeMs = Math.max(10 * 60_000, Math.min(2 * 60 * 60_000, Number(process.env.MCCLUSTER_STAGING_LIFETIME_MS) || 2 * 60 * 60_000));
const expiresAt = Date.now() + lifetimeMs;
const authKey = randomBytes(32), accessCode = randomBytes(24).toString('base64url');
const sessions = new Map(), attempts = new Map(), users = {}, identities = {};
for (const [role, id] of [['owner', OWNER], ['member', MEMBER]]) {
  const user = { id, email: `${role}@staging.invalid`, role: 'authenticated', aud: 'authenticated', user_metadata: { name: `Staging ${role}` } };
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ sub: id, email: user.email, aud: 'authenticated', role: 'authenticated', exp: Math.floor(expiresAt / 1000), user_metadata: user.user_metadata })).toString('base64url');
  const access_token = `${head}.${claims}.${createHmac('sha256', authKey).update(`${head}.${claims}`).digest('base64url')}`;
  identities[role] = { access_token, refresh_token: randomBytes(32).toString('base64url'), expires_in: Math.floor(lifetimeMs / 1000), expires_at: Math.floor(expiresAt / 1000), token_type: 'bearer', user };
  users[access_token] = user;
}
const runtime = await startOwnerWorkspaceRuntime({ fixtureUsers: users, workers: 1 });
const runner = runtime.spawnService('core/src/runner.mjs');
await runtime.ready(runner, 'core_runner_started');
let publicOrigin = null, tunnel = null, closed = false;
let installingTestWorker = false;
const allowedTools = new Set(['core.ai.turn.submit', 'core.ai.turn.get', 'core.ai.turn.stop', 'core.compute.devices.list', 'core.compute.enrollment.create', 'core.compute.device.update', 'core.compute.device.test', 'core.compute.pairs.list', 'core.compute.pair.create', 'core.compute.pair.benchmark']);
const cookieName = 'mccluster_owner_staging';
const state = () => ({ url: publicOrigin, access_code: accessCode, expires_at: new Date(expiresAt).toISOString(), port: server.address().port, workers: runtime.workers.map(worker => ({ name: worker.name, node_id: worker.nodeId })), evidence: 'Synthetic auth identities and model text; actual Core, SQL, TLS worker enrollment, signatures, leases and streamed progress.' });
function writeState() { fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 }); fs.writeFileSync(OUT, JSON.stringify(state(), null, 2), { mode: 0o600 }); fs.chmodSync(OUT, 0o600); }
function sameSecret(left, right) { return timingSafeEqual(createHash('sha256').update(String(left || '')).digest(), createHash('sha256').update(String(right || '')).digest()); }
function send(res, status, value, type = 'application/json', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'", ...extra });
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
}
async function body(req, max = 1_048_576) { const chunks = []; let bytes = 0; for await (const part of req) { bytes += part.length; if (bytes > max) throw Object.assign(new Error('Request too large'), { status: 413 }); chunks.push(part); } return Buffer.concat(chunks); }
function gated(req) { const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1); return cookie && sessions.get(cookie) > Date.now(); }
function userFor(req) { return users[String(req.headers.authorization || '').replace(/^Bearer /i, '')] || null; }
function checkOrigin(req) { const origin = req.headers.origin; if (origin && origin !== publicOrigin && origin !== `http://127.0.0.1:${server.address().port}`) throw Object.assign(new Error('This staging request must originate from its own page.'), { status: 403 }); }
const gateHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Equity Upreneurs · Owner AI staging</title><style>body{margin:0;background:#0c1015;color:#edf2f7;font:16px/1.6 system-ui,sans-serif}main{max-width:520px;margin:10vh auto;padding:28px}h1{font-size:30px}label,input,button{display:block;box-sizing:border-box;width:100%}input,button{min-height:48px;margin:12px 0;padding:12px;font:inherit;border:1px solid #526070;border-radius:6px}button{background:#d39a41;color:#111;font-weight:700;cursor:pointer}.note{color:#aab8c7}</style><main><p>Equity Upreneurs · McCluster</p><h1>Owner AI staging</h1><p>Enter the temporary access code to review the workspace.</p><form method="post" action="/__staging/unlock"><label for="code">Access code</label><input id="code" name="code" type="password" autocomplete="off" required maxlength="128"><button>Open staging workspace</button></form><p class="note">This isolated walkthrough uses synthetic owner/member accounts and model text, with real Core, SQL and signed test workers. Do not enter your real password. The environment expires after ${Math.floor(lifetimeMs / 60_000)} minutes.</p></main></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://staging.invalid');
    // This separate worker transport uses the original enrollment credential
    // and Ed25519 protocol, never a browser cookie or unauthenticated proxy.
    if (/^\/v1\/compute\/(enroll|heartbeat|lease|pair-cleanup|leases\/[0-9a-f-]+\/(start|heartbeat|complete|fail))$/.test(url.pathname)) {
      if (req.method !== 'POST' || url.search) return send(res, 405, { error: 'Signed POST requests only.' });
      if (url.pathname.endsWith('/enroll') ? !/^Bearer mcen1_[A-Za-z0-9_-]{43}$/.test(req.headers.authorization || '') : !req.headers['x-mccluster-signature']) return send(res, 401, { error: 'Worker authentication required.' });
      const bytes = await body(req, 8_388_608);
      const response = await fetch(runtime.gatewayUrl + url.pathname, { method: 'POST', headers: Object.fromEntries(Object.entries(req.headers).filter(([name]) => name === 'authorization' || name === 'content-type' || name.startsWith('x-mccluster-'))), body: bytes });
      return send(res, response.status, await response.json());
    }
    if (url.pathname === '/__staging/unlock' && req.method === 'POST') {
      checkOrigin(req);
      const source = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';
      const attempt = attempts.get(source) || { count: 0, until: Date.now() + 60_000 };
      if (Date.now() > attempt.until) { attempt.count = 0; attempt.until = Date.now() + 60_000; }
      attempt.count += 1; attempts.set(source, attempt);
      if (attempt.count > 10) return send(res, 429, { error: 'Wait one minute before trying this staging code again.' });
      const supplied = new URLSearchParams((await body(req, 2048)).toString()).get('code');
      if (!sameSecret(supplied, accessCode)) return send(res, 401, { error: 'Invalid staging access code.' });
      const session = randomBytes(32).toString('base64url'); sessions.set(session, expiresAt);
      return send(res, 303, '', 'text/plain', { location: '/control.html#home:ask', 'set-cookie': `${cookieName}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor((expiresAt - Date.now()) / 1000)}` });
    }
    if (!gated(req)) {
      // A form navigation POST under no-referrer sends Origin:null. Preserve
      // the same-origin value for this gate only; never relax checkOrigin.
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/control.html')) return send(res, 200, gateHtml, 'text/html', { 'referrer-policy': 'same-origin' });
      return send(res, 401, { error: 'Temporary staging access code required.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') checkOrigin(req);
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const input = JSON.parse((await body(req, 4096)).toString());
      const identity = url.searchParams.get('grant_type') === 'refresh_token'
        ? Object.values(identities).find(value => sameSecret(value.refresh_token, input.refresh_token))
        : input.password === 'staging-fixture' ? Object.values(identities).find(value => value.user.email === input.email) : null;
      return identity ? send(res, 200, identity) : send(res, 401, { error: 'Choose a staging test identity. Real credentials are not accepted.' });
    }
    const user = userFor(req);
    if (url.pathname === '/__staging/workers' && req.method === 'POST') {
      if (user?.id !== OWNER) return send(res, 403, { error: 'Only the owner test identity can install a simulated worker.' });
      if (installingTestWorker || runtime.workers.length >= 6) return send(res, 409, { error: 'Wait for the current install; this disposable stage supports at most six test workers.' });
      const input = JSON.parse((await body(req, 2048)).toString());
      if (!/^mcen1_[A-Za-z0-9_-]{43}$/.test(input.credential || '') || typeof input.display_name !== 'string' || !input.display_name.trim() || input.display_name.length > 80 || /[\x00-\x1f]/.test(input.display_name)) return send(res, 400, { error: 'Paste a fresh enrollment credential and a device name.' });
      installingTestWorker = true;
      try { const worker = await runtime.addWorker(input.display_name.trim(), { credential: input.credential }, true); input.credential = ''; writeState(); return send(res, 201, { node_id: worker.nodeId, simulated: true, message: 'Simulated Mac worker installed. Refresh Devices, then run its device test. No physical Mac or GPU was verified.' }); }
      catch { return send(res, 409, { error: 'The simulated worker could not enroll. Create a fresh credential for macOS in Devices and try again.' }); }
      finally { input.credential = ''; installingTestWorker = false; }
    }
    if (url.pathname === '/auth/v1/user') return user ? send(res, 200, user) : send(res, 401, { error: 'Fixture session required.' });
    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') return send(res, 200, {});
    if (url.pathname === '/v1/workspaces/me') return user ? send(res, 200, { workspaces: [{ org_id: runtime.ORG, slug: 'mccluster', kind: 'studio', role: user.id === OWNER ? 'owner' : 'viewer', enabled: true, name: 'Equity Upreneurs' }], default_org_id: runtime.ORG, profile: user }) : send(res, 401, { error: 'Fixture session required.' });
    if (url.pathname === '/v1/core/mcp' && req.method === 'POST') {
      const bytes = await body(req); const rpc = JSON.parse(bytes.toString());
      if (rpc.method === 'tools/call' && !allowedTools.has(rpc.params?.name)) return send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: 'This integration is not connected in isolated staging.' }] } });
      const reply = await runtime.handleCoreMcp(new Request('http://localhost/v1/core/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes }), runtime.edgeEnv, user);
      return send(res, reply.status, reply.body);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!user) return send(res, 401, { error: 'Fixture session required.' });
      const table = url.pathname.slice('/rest/v1/'.length);
      if (!['ops_ai_threads', 'ops_ai_messages', 'ops_agent_jobs'].includes(table)) return send(res, 503, { error: 'This dataset is not connected in isolated staging.' });
      const bytes = ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req);
      const response = await fetch(runtime.restFixture.url + url.pathname + url.search, { method: req.method, headers: { authorization: req.headers.authorization, apikey: 'fixture-publishable', 'content-type': 'application/json', prefer: req.headers.prefer || '' }, ...(bytes ? { body: bytes } : {}) });
      return send(res, response.status, await response.json());
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'owner-ai-isolated-staging', production: false });
    if (['/v1/status', '/v1/core'].includes(url.pathname)) return user?.id === OWNER ? send(res, 200, { ok: true, connected: true, staging: true, owner_workspace: true, deployment: 'isolated working tree', summary: 'Disposable real Core and SQL, synthetic models.' }) : send(res, 403, { error: 'House owner required.' });
    if (url.pathname.startsWith('/v1/')) return send(res, 503, { error: 'This integration is not connected in isolated staging.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not available.' });
    if (url.pathname === '/' || url.pathname === '/control.html') return send(res, 200, await renderOwnerAiStagingPage({ root: ROOT }), 'text/html');
    if (url.pathname === '/__staging/owner-ai-bootstrap.js') return send(res, 200, fs.readFileSync(BOOTSTRAP_PATH), 'text/javascript');
    const decoded = decodeURIComponent(url.pathname);
    if (/%(?:2f|5c)/i.test(url.pathname) || decoded.includes('\\') || decoded.split('/').some(segment => segment === '.' || segment === '..') || !/^\/(?:css|js|assets|downloads|images)\//.test(decoded) || !/\.(?:js|css|png|svg|jpg|jpeg|webp|ico|woff2?|zip|json|sha256)$/.test(decoded)) return send(res, 404, { error: 'Not available in this walkthrough.' });
    const directory = path.join(ROOT, decoded.split('/')[1]);
    const candidate = path.resolve(ROOT, '.' + decoded);
    if (!candidate.startsWith(directory + path.sep) || !fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return send(res, 404, { error: 'Asset not found.' });
    const filename = fs.realpathSync(candidate);
    if (!filename.startsWith(fs.realpathSync(directory) + path.sep)) return send(res, 404, { error: 'Asset not found.' });
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.zip': 'application/zip', '.json': 'application/json', '.sha256': 'text/plain' }[path.extname(filename)] || 'application/octet-stream';
    const bytes = fs.readFileSync(filename); return send(res, 200, type === 'application/json' ? JSON.parse(bytes) : bytes, type);
  } catch (error) { return send(res, error.status || 500, { error: error.status ? error.message : 'The isolated staging request failed. Retry or consult its test report.' }); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); writeState();
console.log(JSON.stringify({ event: 'owner_staging_ready', local_port: server.address().port, expires_at: new Date(expiresAt).toISOString(), credentials_written_to_private_state: true }));

async function localRequest(route, { method = 'GET', headers = {}, value } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method, headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() })); });
    request.on('error', reject); request.end(value);
  });
}
// Establish the public listener's authorization boundaries before publishing
// any hostname. This proves the actual route handler, not a second mock.
const checks = [];
for (const route of ['/js/control-room-v2.js', '/v1/status', '/rest/v1/ops_ai_messages', '/downloads/mccluster-macos-worker.zip']) checks.push((await localRequest(route)).status === 401);
checks.push((await localRequest('/v1/compute/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, value: '{}' })).status === 401);
checks.push((await localRequest('/v1/compute/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, value: '{}' })).status === 401);
checks.push((await localRequest('/control.html')).headers['referrer-policy'] === 'same-origin');
checks.push((await localRequest('/__staging/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' }, value: new URLSearchParams({ code: accessCode }).toString() })).status === 403);
const unlocked = await localRequest('/__staging/unlock', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://127.0.0.1:${server.address().port}` }, value: new URLSearchParams({ code: accessCode }).toString() });
checks.push(unlocked.status === 303);
const smokeCookie = unlocked.headers['set-cookie']?.[0]?.split(';')[0];
checks.push((await localRequest('/control.html', { headers: { cookie: smokeCookie } })).text.includes('owner-ai-isolated-runtime'));
checks.push((await localRequest('/v1/status', { headers: { cookie: smokeCookie, authorization: `Bearer ${identities.member.access_token}` } })).status === 403);
checks.push((await localRequest('/v1/status', { headers: { cookie: smokeCookie, authorization: `Bearer ${identities.owner.access_token}` } })).status === 200);
checks.push(unlocked.headers['set-cookie'][0].includes('; Secure;'));
for (const route of ['/assets/%2e%2e%2fpackage.json', '/js/%2e%2e%2fcore%2fpackage.json']) checks.push((await localRequest(route, { headers: { cookie: smokeCookie } })).status === 404);
const ownerHeaders = { cookie: smokeCookie, authorization: `Bearer ${identities.owner.access_token}`, 'content-type': 'application/json' };
const issuedReply = await localRequest('/v1/core/mcp', { method: 'POST', headers: ownerHeaders, value: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'core.compute.enrollment.create', arguments: { org_id: runtime.ORG, display_name: 'Staging proof Mac (simulated)', platform: 'darwin' } } }) });
let issued = JSON.parse(JSON.parse(issuedReply.text).result.content[0].text);
while (issued?.result) issued = issued.result;
checks.push(Boolean(issued.credential && issued.setup?.compute_url.startsWith('https://localhost:')));
const installed = await localRequest('/__staging/workers', { method: 'POST', headers: ownerHeaders, value: JSON.stringify({ display_name: 'Staging proof Mac (simulated)', credential: issued.credential }) });
checks.push(installed.status === 201 && JSON.parse(installed.text).simulated === true);
const reused = await localRequest('/__staging/workers', { method: 'POST', headers: ownerHeaders, value: JSON.stringify({ display_name: 'Reused credential must fail', credential: issued.credential }) });
checks.push(reused.status === 409);
issued.credential = '';
if (checks.some(value => !value)) { await runtime.close(); server.close(); throw new Error('Staging authorization smoke failed; no public tunnel was started.'); }
sessions.delete(smokeCookie.split('=').slice(1).join('='));
writeState();
console.log(JSON.stringify({ event: 'owner_staging_gate_verified', checks: checks.length, passed: true, simulated_install_and_reuse_rejection: true }));

async function shutdown() { if (closed) return; closed = true; if (tunnel) tunnel.kill('SIGTERM'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime.close(); }
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { shutdown().then(() => process.exit(0)); });
setTimeout(() => { shutdown().then(() => process.exit(0)); }, lifetimeMs).unref();

if (process.argv.includes('--smoke')) { await shutdown(); process.exit(0); }

// Optional official CLI path is explicit. It publishes only the guarded
// fixture listener. Credentials never appear in tunnel arguments or URLs.
if (process.env.MCCLUSTER_STAGING_TUNNEL_BIN) {
  const binary = process.env.MCCLUSTER_STAGING_TUNNEL_BIN;
  if (!path.isAbsolute(binary)) throw new Error('Use an absolute verified cloudflared binary path.');
  tunnel = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let detected = false;
  tunnel.stderr.on('data', async chunk => {
    // Error messages can contain api.trycloudflare.com. Only a generated
    // multi-word tunnel hostname is a candidate; never report the API itself.
    const match = String(chunk).match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/);
    if (!match || detected) return; detected = true;
    try { publicOrigin = match[0]; await runtime.setPublicComputeUrl(publicOrigin); writeState(); console.log(JSON.stringify({ event: 'owner_staging_public_url', url: publicOrigin, expires_at: new Date(expiresAt).toISOString() })); }
    catch { console.error(JSON.stringify({ event: 'owner_staging_tunnel_failed' })); await shutdown(); process.exitCode = 1; }
  });
  tunnel.on('exit', code => { if (!closed) { publicOrigin = null; writeState(); console.error(JSON.stringify({ event: 'owner_staging_tunnel_exited', code })); } });
}
