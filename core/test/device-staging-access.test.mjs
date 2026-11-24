// Reaching the device-jobs staging through an Access-protected hostname
// (scripts/staging/device-jobs/staging-access.mjs, enroll-device.mjs,
// submit-job.mjs and the node agent they start). Everything here is a FIXTURE
// on 127.0.0.1: a loopback server that imitates a Cloudflare Access block (a
// 302 to a login path, a 403, a login page) and an Access pass that requires
// the two service-token headers. No hostname is resolved over the network, no
// Cloudflare API is called and nothing here is evidence about a real tunnel.
// Credentials are random per run; none is a literal in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMPUTE_PROTOCOL } from '../src/compute/protocol.mjs';
import { generateNodeIdentity, signRequest, verifySignedRequest } from '../src/compute/signature.mjs';
import { ACCESS_ENV, ACCESS_HEADERS, accessServiceToken, gatewayRequestHeaders, redactSecrets } from '../src/compute/node-agent-config.mjs';
import { DEFAULT_ORG, RUN_FILES, STAGING_SCHEMA, connectStaging, readStagingFile, requestJson, validateEnrollOptions, validateSubmitOptions } from '../../scripts/staging/device-jobs/real-device-lib.mjs';
import {
  ACCESS_FIX, PREFLIGHT_SCHEMA, PRODUCTION_HOSTS, assertNotProduction, classifyAccessBlock, isProductionHost, preflightExitCode, preflightStaging, resolveTrust, tlsOptionsFor
} from '../../scripts/staging/device-jobs/staging-access.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'scripts/staging/device-jobs');
const usage = (pattern) => (error) => error.code === 'USAGE' && pattern.test(error.message);
const fresh = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
const newToken = () => ({ id: `${fresh(16)}.access`, secret: fresh(32) });
const tokenEnv = (token) => ({ [ACCESS_ENV.id]: token.id, [ACCESS_ENV.secret]: token.secret });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The fixture. `mode` is what stands in front of the gateway:
//   open           nothing: every request reaches the gateway
//   redirect       Access with no session: 302 to a login path
//   forbidden      Access refusing: 403 with an HTML body
//   login-page     an edge that answers 200 with the Access login page
//   service-token  Access with a Service Auth policy: both headers must match
// Behind it stands a minimal compute gateway: /health, an enrolment that keeps
// the node's public key, and a heartbeat that verifies the node's signature
// exactly as the real gateway does (verifySignedRequest).
async function accessFixture({ mode = 'service-token', token = null, tls = null, health = null, upstream = null } = {}) {
  const state = { mode, seen: [], verified: [], rejected: [], nodeKeys: new Map() };
  const loginLocation = 'https://access-fixture.invalid/cdn-cgi/access/login/staging-fixture.invalid?kid=fixture&meta=fixture-request-state';
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBytes = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://fixture.invalid');
    const sent = { id: req.headers[ACCESS_HEADERS.id.toLowerCase()] ?? null, secret: req.headers[ACCESS_HEADERS.secret.toLowerCase()] ?? null };
    const passes = Boolean(token) && sent.id === token.id && sent.secret === token.secret;
    state.seen.push({ method: req.method, path: url.pathname, had_id: sent.id !== null, had_secret: sent.secret !== null, passed: passes });
    const reply = (status, body, headers = {}) => { const text = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json', 'content-length': Buffer.byteLength(text), ...headers }); res.end(text); };
    if (state.mode === 'redirect' || (state.mode === 'service-token' && !passes && !sent.id && !sent.secret)) return reply(302, '', { location: loginLocation });
    if (state.mode === 'forbidden' || (state.mode === 'service-token' && !passes)) return reply(403, '<html><body><h1>Forbidden</h1></body></html>');
    if (state.mode === 'login-page') return reply(200, '<html><body><form action="/cdn-cgi/access/login">Sign in</form></body></html>');
    if (upstream) {
      // Past Access: forward to a real gateway on loopback, as the tunnel's ingress rule does.
      const headers = { ...req.headers, host: `127.0.0.1:${upstream}` };
      delete headers[ACCESS_HEADERS.id.toLowerCase()]; delete headers[ACCESS_HEADERS.secret.toLowerCase()];
      const forward = http.request({ host: '127.0.0.1', port: upstream, method: req.method, path: req.url, headers }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
      forward.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      return forward.end(bodyBytes);
    }
    if (url.pathname === '/health' && req.method === 'GET') return reply(200, health || { ok: true, service: 'mccluster-compute-gateway', protocol: COMPUTE_PROTOCOL });
    if (url.pathname === '/echo-credentials') return reply(500, { error: `upstream said: ${sent.id} ${sent.secret} ${req.headers.authorization || ''}`, code: 'FIXTURE_ECHO' });
    if (url.pathname === '/v1/compute/enroll' && req.method === 'POST') {
      const body = JSON.parse(bodyBytes.toString('utf8'));
      const identity = { publicKeyPem: body.public_key };
      const nodeId = `node_${crypto.createHash('sha256').update(crypto.createPublicKey(identity.publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32)}`;
      state.nodeKeys.set(nodeId, identity.publicKeyPem);
      return reply(201, { protocol: COMPUTE_PROTOCOL, node: { id: nodeId } });
    }
    if (url.pathname.startsWith('/v1/compute/') && req.method === 'POST') {
      const nodeId = req.headers['x-mccluster-node-id'];
      try {
        const verified = verifySignedRequest({ publicKeyPem: state.nodeKeys.get(nodeId), method: req.method, path: url.pathname, headers: req.headers, bodyBytes });
        state.verified.push({ path: url.pathname, node_id: verified.nodeId, digest: verified.digest, body_bytes: bodyBytes.length });
        return reply(200, { ok: true, live_gpu_nodes: 0, lease: null });
      } catch (error) {
        state.rejected.push({ path: url.pathname, code: error.code || error.message });
        return reply(401, { error: error.message, code: error.code || 'BAD_SIGNATURE' });
      }
    }
    return reply(404, { error: 'not found', code: 'NOT_FOUND' });
  };
  const server = tls ? https.createServer({ key: tls.key, cert: tls.cert }, handler) : http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return { state, port, url: `${tls ? 'https' : 'http'}://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

test('trust is exactly one of --trust system or --ca <file>; nothing turns verification off', () => {
  assert.equal(resolveTrust({ trust: 'system' }), 'system');
  assert.equal(resolveTrust({ ca: 'ca.pem' }), 'ca');
  assert.equal(resolveTrust({ haveDefaultCa: true }), 'ca', 'the loopback mode pins the run directory CA when neither flag is given');
  assert.throws(() => resolveTrust({}), usage(/exactly one of --trust system .* or --ca <file>/));
  assert.throws(() => resolveTrust({ trust: 'system', ca: 'ca.pem' }), usage(/exactly one .* not both/));
  for (const value of ['none', 'insecure', 'off', 'skip', 'ca', '']) assert.throws(() => resolveTrust({ trust: value, ca: 'ca.pem' }), usage(/--trust must be "system"/), value);
  // A pinned CA replaces the default roots; system trust never sets rejectUnauthorized.
  const pinned = tlsOptionsFor({ trust: 'ca', ca: Buffer.from('pin') });
  assert.deepEqual(Object.keys(pinned), ['ca']);
  assert.equal('rejectUnauthorized' in tlsOptionsFor({ trust: 'system' }), false);

  const device = ['--implementation', 'qwen3.8b.local', '--model', 'qwen3:8b', '--state-dir', path.join(os.tmpdir(), 'state')];
  const remote = ['--compute-url', 'https://staging-fixture.invalid', '--org', DEFAULT_ORG];
  const system = validateEnrollOptions([...device, ...remote, '--trust', 'system']);
  assert.deepEqual([system.staging.trust, system.staging.ca, system.staging.computeUrl], ['system', null, 'https://staging-fixture.invalid']);
  const pin = validateEnrollOptions([...device, ...remote, '--ca', 'ca.pem']);
  assert.deepEqual([pin.staging.trust, path.basename(pin.staging.ca)], ['ca', 'ca.pem']);
  assert.throws(() => validateEnrollOptions([...device, ...remote]), usage(/exactly one of them/));
  assert.throws(() => validateEnrollOptions([...device, ...remote, '--trust', 'system', '--ca', 'ca.pem']), usage(/not both/));
  assert.throws(() => validateEnrollOptions([...device, ...remote, '--trust', 'none']), usage(/--trust must be "system"/));
  for (const flag of ['--insecure', '--no-verify', '--skip-tls-verify']) assert.throws(() => validateEnrollOptions([...device, ...remote, '--trust', 'system', flag]), usage(/unknown flag/), flag);
  // The loopback mode is as it was: the run directory CA, pinned.
  const local = validateEnrollOptions([...device, '--run-dir', path.join(os.tmpdir(), 'run')]);
  assert.deepEqual([local.staging.trust, path.basename(local.staging.ca)], ['ca', RUN_FILES.ca_cert]);
  assert.throws(() => validateEnrollOptions([...device, '--run-dir', 'r', '--trust', 'system', '--ca', 'ca.pem']), usage(/not both/));
  const submit = validateSubmitOptions(['--implementation', 'qwen3.8b.local', '--out', path.join(os.tmpdir(), 'out'), ...remote, '--trust', 'system']);
  assert.equal(submit.staging.trust, 'system');
  assert.throws(() => validateSubmitOptions(['--implementation', 'a.b', '--out', 'o', ...remote]), usage(/exactly one of them/));
  assert.throws(() => validateEnrollOptions([...device, '--compute-url', 'https://user:pw@staging-fixture.invalid', '--org', DEFAULT_ORG, '--trust', 'system']), usage(/must not carry credentials/));
});

test('--preflight needs only how to reach the staging: no device flags, no org, no token', () => {
  const enrol = validateEnrollOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid', '--trust', 'system']);
  assert.deepEqual([enrol.preflight, enrol.staging.trust, enrol.staging.org], [true, 'system', null]);
  const submit = validateSubmitOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid', '--ca', 'ca.pem']);
  assert.deepEqual([submit.preflight, submit.staging.trust], [true, 'ca']);
  assert.throws(() => validateEnrollOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid']), usage(/exactly one of them/));
  assert.throws(() => validateEnrollOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid', '--trust', 'system', '--org', 'house']), usage(/--org must be a UUID/));
  assert.throws(() => validateEnrollOptions(['--preflight']), usage(/--compute-url \(or --run-dir\) is required/));
  assert.equal(validateEnrollOptions(['--implementation', 'a.b', '--model', 'm', '--state-dir', 's', '--run-dir', 'r']).preflight, false);
});

test('the production compute and Core hosts are refused outright, before anything is read or sent', () => {
  assert.deepEqual([...PRODUCTION_HOSTS].sort(), ['compute.mccluster.org', 'core.mccluster.org']);
  const device = ['--implementation', 'qwen3.8b.local', '--model', 'qwen3:8b', '--state-dir', 's', '--org', DEFAULT_ORG, '--trust', 'system'];
  for (const host of PRODUCTION_HOSTS) {
    for (const spelled of [host, host.toUpperCase(), `${host}.`, `${host}:443`, `${host}/v1/compute`]) {
      assert.equal(isProductionHost(new URL(`https://${spelled}`).hostname), true, spelled);
      assert.throws(() => validateEnrollOptions([...device, '--compute-url', `https://${spelled}`]), usage(/production host/), spelled);
      assert.throws(() => validateEnrollOptions(['--preflight', '--trust', 'system', '--compute-url', `https://${spelled}`]), usage(/production host/), spelled);
      assert.throws(() => validateSubmitOptions(['--implementation', 'a.b', '--out', 'o', '--org', DEFAULT_ORG, '--trust', 'system', '--compute-url', `https://${spelled}`]), usage(/production host/), spelled);
    }
  }
  assert.equal(isProductionHost('staging-fixture.invalid'), false);
  assert.equal(isProductionHost('127.0.0.1'), false);
  assert.equal(assertNotProduction('https://staging-fixture.invalid'), 'https://staging-fixture.invalid');
  // A run directory whose staging.json names production is refused too.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-prod-'));
  fs.writeFileSync(path.join(dir, RUN_FILES.staging), JSON.stringify({ schema: STAGING_SCHEMA, org_id: DEFAULT_ORG, urls: { compute: `https://${PRODUCTION_HOSTS[0]}` } }));
  assert.equal(readStagingFile(dir).org_id, DEFAULT_ORG);
  assert.throws(() => connectStaging({ runDir: dir, computeUrl: null, org: null, trust: 'system', ca: null, tokenFile: null }, { tokenEnv: 'T', env: { T: 'x' } }), usage(/production host/));
});

test('both scripts exit 2 on a production host without opening a connection', async () => {
  for (const [script, extra] of [['enroll-device.mjs', ['--preflight']], ['enroll-device.mjs', ['--implementation', 'a.b', '--model', 'm', '--state-dir', path.join(os.tmpdir(), `never-${fresh(4)}`), '--org', DEFAULT_ORG]], ['submit-job.mjs', ['--preflight']], ['submit-job.mjs', ['--implementation', 'a.b', '--out', path.join(os.tmpdir(), `never-${fresh(4)}`), '--org', DEFAULT_ORG]]]) {
    for (const host of PRODUCTION_HOSTS) {
      const run = await runToExit(script, [...extra, '--compute-url', `https://${host}`, '--trust', 'system']);
      assert.equal(run.code, 2, `${script} ${host}: ${run.stderr}`);
      assert.match(run.stderr, /usage_error/);
      assert.match(run.stderr, /production host/);
    }
  }
});

test('the Access service token is read from two environment variables only: both or neither, never a value in an error', () => {
  assert.deepEqual(accessServiceToken({}), { configured: false, headers: {}, secrets: [] });
  const token = newToken();
  const access = accessServiceToken(tokenEnv(token));
  assert.equal(access.configured, true);
  assert.deepEqual(access.headers, { 'CF-Access-Client-Id': token.id, 'CF-Access-Client-Secret': token.secret });
  assert.deepEqual([ACCESS_ENV.id, ACCESS_ENV.secret], ['MCCLUSTER_ACCESS_CLIENT_ID', 'MCCLUSTER_ACCESS_CLIENT_SECRET']);
  for (const env of [{ [ACCESS_ENV.id]: token.id }, { [ACCESS_ENV.secret]: token.secret }, { [ACCESS_ENV.id]: token.id, [ACCESS_ENV.secret]: '   ' }]) {
    assert.throws(() => accessServiceToken(env), (error) => error.code === 'ACCESS_TOKEN_INCOMPLETE' && /must be set together/.test(error.message) && !error.message.includes(token.id) && !error.message.includes(token.secret));
  }
  assert.throws(() => accessServiceToken({ [ACCESS_ENV.id]: token.id, [ACCESS_ENV.secret]: `${token.secret} with space` }), (error) => error.code === 'ACCESS_TOKEN_INVALID' && !error.message.includes(token.secret));
  // There is no flag for it on either script.
  for (const flag of ['--access-client-id', '--access-client-secret', '--cf-access-client-secret']) {
    assert.throws(() => validateEnrollOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid', '--trust', 'system', flag, 'x']), usage(/unknown flag/), flag);
    assert.throws(() => validateSubmitOptions(['--preflight', '--compute-url', 'https://staging-fixture.invalid', '--trust', 'system', flag, 'x']), usage(/unknown flag/), flag);
  }
});

test('redaction removes every secret from strings and from JSON-shaped values', () => {
  const token = newToken();
  const enrol = fresh();
  const secrets = [token.secret, token.id, enrol];
  assert.equal(redactSecrets(`a ${token.secret} b ${token.secret} c ${token.id}`, secrets), 'a [redacted] b [redacted] c [redacted]');
  const record = redactSecrets({ event: 'x', error: `Bearer ${enrol}`, nested: [{ header: `${ACCESS_HEADERS.secret}: ${token.secret}` }], [token.id]: 1, n: 7, ok: true, none: null }, secrets);
  const text = JSON.stringify(record);
  for (const secret of secrets) assert.equal(text.includes(secret), false);
  assert.deepEqual([record.event, record.n, record.ok, record.none, record.error], ['x', 7, true, null, 'Bearer [redacted]']);
  // Nothing to redact, or a value too short to be a secret: unchanged.
  assert.equal(redactSecrets('plain text', []), 'plain text');
  assert.equal(redactSecrets('a b c', ['a', '', null, undefined]), 'a b c');
});

test('an Access block is recognised: a redirect, a 403, a login page; a gateway refusal is not one', () => {
  const login = classifyAccessBlock({ status: 302, headers: { location: 'https://access-fixture.invalid/cdn-cgi/access/login/staging-fixture.invalid?kid=k&meta=request-state' }, body: null });
  assert.deepEqual(login, { blocked: true, evidence: 'redirect-to-access-login', http_status: 302, location: 'https://access-fixture.invalid/cdn-cgi/access/login/staging-fixture.invalid' });
  assert.equal(JSON.stringify(login).includes('request-state'), false, 'the login URL query is never reported');
  assert.deepEqual(classifyAccessBlock({ status: 302, headers: { location: '/somewhere' }, body: null }), { blocked: true, evidence: 'redirect', http_status: 302, location: '/somewhere' });
  assert.equal(classifyAccessBlock({ status: 403, headers: {}, body: { raw: '<html>Forbidden</html>' } }).evidence, 'forbidden');
  assert.equal(classifyAccessBlock({ status: 403, headers: {}, body: null }).blocked, true);
  assert.equal(classifyAccessBlock({ status: 200, headers: {}, body: { raw: '<form action="/cdn-cgi/access/login">' } }).evidence, 'access-login-page');
  // The compute gateway's own refusals are JSON with a named code: not Access.
  assert.equal(classifyAccessBlock({ status: 403, headers: {}, body: { error: 'cross org', code: 'CROSS_ORG_DENIED' } }).blocked, false);
  assert.equal(classifyAccessBlock({ status: 401, headers: {}, body: { error: 'Unauthorized', code: 'UNAUTHORIZED' } }).blocked, false);
  assert.equal(classifyAccessBlock({ status: 503, headers: {}, body: { error: 'none', code: 'COMPUTE_NO_LIVE_NODE' } }).blocked, false);
  assert.equal(classifyAccessBlock({ status: 200, headers: {}, body: { ok: true, service: 'mccluster-compute-gateway' } }).blocked, false);
  for (const phrase of [ACCESS_ENV.id, ACCESS_ENV.secret, 'Service Auth', 'Bypass policy', 'public IP']) assert.ok(ACCESS_FIX.includes(phrase), phrase);
});

test('FIXTURE preflight: DNS, /health as the compute gateway with the protocol, and an Access block reported with the exact fix', async (t) => {
  const token = newToken();
  const access = accessServiceToken(tokenEnv(token));
  const none = accessServiceToken({});
  const fixture = await accessFixture({ mode: 'service-token', token });
  t.after(() => fixture.close());
  const check = (extra = {}) => preflightStaging({ computeUrl: fixture.url, request: requestJson, access: none, ...extra });

  // 302 to a login path: no service token was sent.
  const redirected = await check();
  assert.deepEqual([redirected.schema, redirected.ok, redirected.verdict, redirected.access_service_token_sent], [PREFLIGHT_SCHEMA, false, 'blocked-by-access', false]);
  assert.deepEqual(redirected.checks.access, { blocked: true, evidence: 'redirect-to-access-login', location: 'https://access-fixture.invalid/cdn-cgi/access/login/staging-fixture.invalid' });
  assert.match(redirected.fix, /^blocked by Access: /);
  assert.match(redirected.fix, /No service token was sent\./);
  assert.ok(redirected.fix.includes(ACCESS_FIX));
  assert.equal(preflightExitCode(redirected), 3);
  assert.deepEqual(redirected.checks.dns, { ok: true, literal: true, addresses: ['127.0.0.1'] });

  // 403: a token was sent and Access did not accept it.
  const wrong = await check({ access: accessServiceToken(tokenEnv({ id: token.id, secret: fresh(32) })) });
  assert.deepEqual([wrong.verdict, wrong.checks.access.evidence, wrong.access_service_token_sent, preflightExitCode(wrong)], ['blocked-by-access', 'forbidden', true, 3]);
  assert.match(wrong.fix, /A service token was sent and was not accepted/);

  // The pass: both headers, and the gateway answers by name with the protocol.
  const ready = await check({ access });
  assert.deepEqual([ready.ok, ready.verdict, ready.fix, preflightExitCode(ready)], [true, 'ready', null, 0]);
  assert.deepEqual(ready.checks.health, { ok: true, http_status: 200, service: 'mccluster-compute-gateway', protocol: 'mccluster-compute/1', expected_service: 'mccluster-compute-gateway', expected_protocol: 'mccluster-compute/1' });
  assert.deepEqual(fixture.state.seen.at(-1), { method: 'GET', path: '/health', had_id: true, had_secret: true, passed: true });
  // No report carries a credential.
  for (const report of [redirected, wrong, ready]) assert.equal(JSON.stringify(report).includes(token.secret) || JSON.stringify(report).includes(token.id), false);

  fixture.state.mode = 'forbidden';
  assert.deepEqual([(await check({ access })).verdict], ['blocked-by-access']);
  fixture.state.mode = 'login-page';
  const page = await check({ access });
  assert.deepEqual([page.verdict, page.checks.access.evidence, preflightExitCode(page)], ['blocked-by-access', 'access-login-page', 3]);

  // Something answers 200, but it is not this gateway or not this protocol.
  for (const health of [{ ok: true, service: 'something-else', protocol: COMPUTE_PROTOCOL }, { ok: true, service: 'mccluster-compute-gateway', protocol: 'mccluster-compute/0' }]) {
    const other = await accessFixture({ mode: 'open', health });
    const report = await preflightStaging({ computeUrl: other.url, request: requestJson, access: none });
    await other.close();
    assert.deepEqual([report.ok, report.verdict, report.checks.health.ok, preflightExitCode(report)], [false, 'not-the-compute-gateway', false, 1]);
  }

  // The name does not resolve (the resolver is injected: no network lookup here), and nothing is sent.
  const before = fixture.state.seen.length;
  const unresolved = await preflightStaging({ computeUrl: 'https://staging-fixture.invalid', trust: 'system', request: requestJson, access, lookup: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); } });
  assert.deepEqual([unresolved.verdict, unresolved.checks.dns.error, unresolved.checks.tls, preflightExitCode(unresolved)], ['dns-failed', 'ENOTFOUND', null, 1]);
  const production = await preflightStaging({ computeUrl: `https://${PRODUCTION_HOSTS[0]}`, trust: 'system', request: () => { throw new Error('must not be called'); }, access, lookup: () => { throw new Error('must not be called'); } });
  assert.deepEqual([production.verdict, production.checks.dns], ['production-host-refused', null]);
  assert.equal(fixture.state.seen.length, before);
  // Nothing listens: unreachable, named.
  const closed = await accessFixture({ mode: 'open' });
  await closed.close();
  assert.equal((await preflightStaging({ computeUrl: closed.url, request: requestJson, access: none })).verdict, 'unreachable');
});

test('FIXTURE staging requests: the two headers ride on every call, an Access block is a named error, and no error text carries a credential', async (t) => {
  const token = newToken();
  const admin = fresh();
  const fixture = await accessFixture({ mode: 'service-token', token });
  t.after(() => fixture.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-conn-'));
  fs.writeFileSync(path.join(dir, 'ca.pem'), 'read as bytes only; the fixture is plain http');
  fs.writeFileSync(path.join(dir, 'admin.token'), `${admin}\n`);
  const target = { runDir: null, computeUrl: fixture.url, org: DEFAULT_ORG, trust: 'ca', ca: path.join(dir, 'ca.pem'), tokenFile: path.join(dir, 'admin.token') };

  const staging = connectStaging(target, { tokenEnv: 'UNSET', env: tokenEnv(token) });
  assert.deepEqual([staging.access.configured, staging.token, staging.trust], [true, admin, 'ca']);
  for (const pathname of ['/health', '/health', '/v1/unknown']) await staging.request(pathname, { headers: { authorization: `Bearer ${staging.token}` } });
  assert.equal(fixture.state.seen.length, 3);
  assert.ok(fixture.state.seen.every((seen) => seen.had_id && seen.had_secret && seen.passed), 'every request carried both headers');
  // An upstream that echoes credentials back: what the scripts print or write is redacted.
  const echoed = await staging.request('/echo-credentials', { headers: { authorization: `Bearer ${staging.token}` } });
  assert.ok(echoed.body.error.includes(token.secret) && echoed.body.error.includes(admin), 'the fixture really echoed them');
  const shown = JSON.stringify(staging.redact({ event: 'submit_failed', error: echoed.body.error }));
  for (const secret of [token.secret, token.id, admin]) assert.equal(shown.includes(secret), false);
  assert.match(shown, /\[redacted\] \[redacted\] Bearer \[redacted\]/);

  // Without the token: a named error with the fix, and nothing of the login URL's query.
  const bare = connectStaging(target, { tokenEnv: 'UNSET', env: {} });
  await assert.rejects(() => bare.request('/health'), (error) => error.code === 'ACCESS_BLOCKED' && /^blocked by Access: .*HTTP 302/.test(error.message) && error.message.includes(ACCESS_FIX) && !error.message.includes('fixture-request-state'));
  // With a wrong token: 403, named, and the wrong secret is not in the message.
  const wrongSecret = fresh(32);
  const wrong = connectStaging(target, { tokenEnv: 'UNSET', env: tokenEnv({ id: token.id, secret: wrongSecret }) });
  await assert.rejects(() => wrong.request('/health'), (error) => error.code === 'ACCESS_BLOCKED' && /HTTP 403/.test(error.message) && /was not accepted/.test(error.message) && !error.message.includes(wrongSecret) && !error.message.includes(token.id));
  // Half a token is refused before any request.
  const seen = fixture.state.seen.length;
  assert.throws(() => connectStaging(target, { tokenEnv: 'UNSET', env: { [ACCESS_ENV.id]: token.id } }), (error) => error.code === 'ACCESS_TOKEN_INCOMPLETE');
  assert.equal(fixture.state.seen.length, seen);
  // The preflight needs no token at all.
  assert.equal(connectStaging({ ...target, tokenFile: null }, { tokenEnv: 'UNSET', env: {}, needToken: false }).token, '');
});

test('FIXTURE node signature: the Access headers change neither the signed headers nor the body digest, and the gateway check still verifies', async (t) => {
  const token = newToken();
  const access = accessServiceToken(tokenEnv(token));
  const fixture = await accessFixture({ mode: 'service-token', token });
  t.after(() => fixture.close());
  const identity = generateNodeIdentity();
  fixture.state.nodeKeys.set(identity.nodeId, identity.publicKeyPem);
  const pathname = '/v1/compute/heartbeat';
  const bodyBytes = Buffer.from(JSON.stringify({ agent_version: 'fixture', load: { running_leases: 0 } }));
  const signed = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: pathname, nodeId: identity.nodeId, bodyBytes });

  const withAccess = gatewayRequestHeaders(access, signed);
  const without = gatewayRequestHeaders(accessServiceToken({}), signed);
  for (const name of Object.keys(signed)) assert.equal(withAccess[name], signed[name], name);
  assert.deepEqual(Object.keys(withAccess).filter((name) => !(name in without)).sort(), ['CF-Access-Client-Id', 'CF-Access-Client-Secret']);
  // The Access headers come first: they cannot stand in for a signature or content header.
  const hostile = gatewayRequestHeaders({ headers: { 'x-mccluster-signature': 'forged', 'content-type': 'text/plain' } }, signed);
  assert.deepEqual([hostile['x-mccluster-signature'], hostile['content-type']], [signed['x-mccluster-signature'], 'application/json']);

  const send = (headers) => fetch(`${fixture.url}${pathname}`, { method: 'POST', headers, body: bodyBytes, redirect: 'manual' });
  const accepted = await send(withAccess);
  assert.equal(accepted.status, 200);
  assert.deepEqual(fixture.state.verified, [{ path: pathname, node_id: identity.nodeId, digest: signed['x-mccluster-content-sha256'], body_bytes: bodyBytes.length }]);
  // The same signed request without the Access headers never reaches the gateway.
  assert.equal((await send(without)).status, 302);
  assert.equal(fixture.state.verified.length, 1);
  // Past Access, a tampered body still fails the node's digest: Access is in front of the signature, not instead of it.
  const fresher = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: pathname, nodeId: identity.nodeId, bodyBytes });
  const tampered = await fetch(`${fixture.url}${pathname}`, { method: 'POST', headers: gatewayRequestHeaders(access, fresher), body: Buffer.from('{"agent_version":"other"}') });
  assert.equal(tampered.status, 401);
  assert.deepEqual(fixture.state.rejected, [{ path: pathname, code: 'BAD_DIGEST' }]);
});

test('the node agent sends the Access headers through one helper on both request paths and redacts what it logs', () => {
  const agent = fs.readFileSync(path.join(ROOT, 'core/src/compute/node-agent.mjs'), 'utf8');
  assert.match(agent, /const ACCESS = accessServiceToken\(process\.env\);/);
  assert.equal(agent.match(/headers: gatewayRequestHeaders\(ACCESS, headers\)/g)?.length, 2, 'rawRequest and signedRequest');
  assert.match(agent, /function log\(record\) \{ console\.log\(JSON\.stringify\(redactSecrets\(record, LOG_SECRETS\)\)\); \}/);
  assert.match(agent, /function warn\(record\) \{ console\.error\(JSON\.stringify\(redactSecrets\(record, LOG_SECRETS\)\)\); \}/);
  assert.equal(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/.test(agent), false);
  for (const name of ['enroll-device.mjs', 'submit-job.mjs', 'real-device-lib.mjs', 'staging-access.mjs']) {
    const source = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    // staging-access.mjs names the variable only to refuse it (assertTlsVerificationOn); nothing may set it.
    if (name === 'staging-access.mjs') assert.equal(/NODE_TLS_REJECT_UNAUTHORIZED\s*(=(?!=)|:)/.test(source), false, name);
    else assert.equal(/NODE_TLS_REJECT_UNAUTHORIZED/.test(source), false, name);
    assert.equal(/rejectUnauthorized\s*:/.test(source), false, name);
  }
  // The Access token reaches the agent by environment only; it is in no file the enrol script writes.
  const enrol = fs.readFileSync(path.join(SCRIPTS, 'enroll-device.mjs'), 'utf8');
  assert.match(enrol, /\[ACCESS_ENV\.id\]: process\.env\[ACCESS_ENV\.id\], \[ACCESS_ENV\.secret\]: process\.env\[ACCESS_ENV\.secret\]/);
  assert.equal(/writeFileSync\([^)]*(?:access\.headers|ACCESS_ENV|secrets)/.test(enrol), false);
});

// ---- Over TLS, with the scripts and the real node agent as processes --------
function runToExit(script, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function opensslMissing() {
  try { execFileSync(process.env.OPENSSL_BIN || 'openssl', ['version'], { stdio: 'ignore', windowsHide: true }); return null; } catch { return 'openssl is not available (PATH or OPENSSL_BIN)'; }
}

// A self-signed loopback certificate, exactly as serve.mjs makes its own.
function loopbackCertificate(dir) {
  const keyFile = path.join(dir, 'fixture-tls-key.pem');
  const certFile = path.join(dir, 'fixture-ca-cert.pem');
  execFileSync(process.env.OPENSSL_BIN || 'openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=device-staging-access-fixture', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), certFile };
}

// Environment for a child: nothing named for a node or for Access is inherited.
function childEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(?:MCCLUSTER_|SUPABASE_|CORE_)/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full)); else out.push(full);
  }
  return out;
}

test('FIXTURE over TLS: --preflight says "blocked by Access" with the fix and exits 3; with the service token it is ready; a pinned CA and system trust both verify', { skip: opensslMissing() || false, timeout: 120_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-tls-'));
  const tlsFiles = loopbackCertificate(work);
  const token = newToken();
  const fixture = await accessFixture({ mode: 'service-token', token, tls: tlsFiles });
  t.after(() => fixture.close());
  const reach = ['--preflight', '--compute-url', fixture.url];
  const report = (run) => JSON.parse(run.stdout.trim().split('\n').at(-1));

  for (const script of ['enroll-device.mjs', 'submit-job.mjs']) {
    const blocked = await runToExit(script, [...reach, '--ca', tlsFiles.certFile], childEnv());
    assert.equal(blocked.code, 3, `${script}: ${blocked.stdout}${blocked.stderr}`);
    const seen = report(blocked);
    assert.deepEqual([seen.event, seen.ok, seen.verdict, seen.trust, seen.trust_store, seen.access_service_token_sent], ['staging_preflight', false, 'blocked-by-access', 'ca', 'pinned-ca-file', false]);
    assert.deepEqual([seen.checks.dns.ok, seen.checks.tls.ok, seen.checks.access.evidence], [true, true, 'redirect-to-access-login']);
    assert.match(seen.fix, /^blocked by Access: /);
    for (const phrase of [ACCESS_ENV.id, ACCESS_ENV.secret, 'IP bypass']) assert.ok(seen.fix.includes(phrase), phrase);

    const ready = await runToExit(script, [...reach, '--ca', tlsFiles.certFile], childEnv(tokenEnv(token)));
    assert.equal(ready.code, 0, `${script}: ${ready.stdout}${ready.stderr}`);
    assert.deepEqual([report(ready).ok, report(ready).verdict, report(ready).access_service_token_sent, report(ready).checks.health.protocol], [true, 'ready', true, 'mccluster-compute/1']);
    // Nothing printed carries a credential, in either outcome.
    for (const run of [blocked, ready]) for (const secret of [token.id, token.secret]) assert.equal((run.stdout + run.stderr).includes(secret), false);

    // System trust does not accept this self-signed certificate: verification is on, and the report says which fix applies.
    const untrusted = await runToExit(script, [...reach, '--trust', 'system'], childEnv(tokenEnv(token)));
    assert.equal(untrusted.code, 1, `${script}: ${untrusted.stdout}${untrusted.stderr}`);
    assert.deepEqual([report(untrusted).verdict, report(untrusted).trust, report(untrusted).checks.tls.ok, report(untrusted).checks.health], ['tls-failed', 'system', false, null]);
    assert.match(report(untrusted).fix, /Verification is never turned off/);
  }
  // A pin on some other certificate fails the handshake too.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-other-'));
  const wrongPin = await runToExit('enroll-device.mjs', [...reach, '--ca', loopbackCertificate(other).certFile], childEnv(tokenEnv(token)));
  assert.deepEqual([wrongPin.code, report(wrongPin).verdict], [1, 'tls-failed']);
  const forwardedBefore = fixture.state.seen.filter((seen) => seen.passed).length;

  // 403 for a token Access does not accept: blocked, exit 3, and the wrong secret is not printed.
  const wrongSecret = fresh(32);
  const refused = await runToExit('enroll-device.mjs', [...reach, '--ca', tlsFiles.certFile], childEnv(tokenEnv({ id: token.id, secret: wrongSecret })));
  assert.deepEqual([refused.code, report(refused).verdict, report(refused).checks.access.evidence, report(refused).access_service_token_sent], [3, 'blocked-by-access', 'forbidden', true]);
  assert.equal((refused.stdout + refused.stderr).includes(wrongSecret), false);
  assert.equal(fixture.state.seen.filter((seen) => seen.passed).length, forwardedBefore);

  // An enrolment (not only the preflight) stops at the block before anything local starts or any token is sent.
  const stateDir = path.join(work, 'never-enrolled');
  const enrolToken = fresh();
  const enrol = await runToExit('enroll-device.mjs', ['--compute-url', fixture.url, '--ca', tlsFiles.certFile, '--org', DEFAULT_ORG, '--state-dir', stateDir, '--implementation', 'fixture.echo.local', '--model', 'fixture-echo', '--executor-url', 'http://127.0.0.1:9', '--no-stdin'], childEnv({ MCCLUSTER_NODE_ENROLL_TOKEN: enrolToken }));
  assert.equal(enrol.code, 3, enrol.stdout + enrol.stderr);
  const failure = JSON.parse(enrol.stderr.trim().split('\n').at(-1));
  assert.deepEqual([failure.event, failure.code, failure.preflight.verdict], ['enroll_failed', 'ACCESS_BLOCKED', 'blocked-by-access']);
  assert.match(failure.error, /blocked by Access/);
  assert.equal((enrol.stdout + enrol.stderr).includes(enrolToken), false, 'the enrolment token is never echoed');
  assert.equal(fs.existsSync(path.join(stateDir, 'identity.json')), false);
  assert.equal(fixture.state.seen.some((seen) => seen.path === '/v1/compute/enroll'), false);
});

test('FIXTURE over TLS: the real node agent enrols and heartbeats through the Access pass; its signature verifies and its logs carry no credential', { skip: opensslMissing() || false, timeout: 180_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-agent-'));
  const tlsFiles = loopbackCertificate(work);
  const token = newToken();
  const enrolToken = fresh();
  const fixture = await accessFixture({ mode: 'service-token', token, tls: tlsFiles });
  t.after(() => fixture.close());
  const agentEnv = (stateDir, extra = {}) => childEnv({
    MCCLUSTER_COMPUTE_URL: fixture.url, MCCLUSTER_ORG_ID: DEFAULT_ORG, MCCLUSTER_NODE_NAME: 'access-fixture-device', MCCLUSTER_NODE_ENROLL_TOKEN: enrolToken,
    MCCLUSTER_NODE_STATE_DIR: stateDir, MCCLUSTER_NODE_MANIFEST: path.join(stateDir, 'capabilities.json'), MCCLUSTER_NODE_STOP_FILE: path.join(stateDir, 'node-agent.stop'),
    MCCLUSTER_NODE_POLL_MS: '1000', NODE_EXTRA_CA_CERTS: tlsFiles.certFile, ...extra
  });
  const startAgent = (stateDir, extra) => {
    fs.mkdirSync(stateDir, { recursive: true });
    const child = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/node-agent.mjs')], { cwd: ROOT, env: agentEnv(stateDir, extra), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const output = { text: '' };
    child.stdout.on('data', (chunk) => { output.text += chunk; });
    child.stderr.on('data', (chunk) => { output.text += chunk; });
    t.after(() => { try { child.kill('SIGKILL'); } catch {} });
    return { child, output, exited: new Promise((resolve) => child.once('exit', resolve)) };
  };

  // Without the service token the agent never gets past Access: it fails, by exit code, and enrols nothing.
  const blocked = startAgent(path.join(work, 'blocked'));
  assert.equal(await blocked.exited, 1);
  assert.match(blocked.output.text, /compute_node_fatal/);
  assert.equal(fixture.state.nodeKeys.size, 0);
  assert.equal(blocked.output.text.includes(enrolToken), false);

  const stateDir = path.join(work, 'device');
  const agent = startAgent(stateDir, tokenEnv(token));
  for (let i = 0; i < 240 && !fixture.state.verified.some((seen) => seen.path === '/v1/compute/heartbeat'); i += 1) await sleep(250);
  assert.ok(fixture.state.verified.some((seen) => seen.path === '/v1/compute/heartbeat'), `a signed heartbeat verified at the gateway check: ${agent.output.text.slice(-600)}`);
  assert.deepEqual(fixture.state.rejected, [], 'no signed request failed verification');
  const passed = fixture.state.seen.filter((seen) => seen.passed);
  assert.ok(passed.some((seen) => seen.path === '/v1/compute/enroll') && passed.some((seen) => seen.path === '/v1/compute/heartbeat'));
  const identity = JSON.parse(fs.readFileSync(path.join(stateDir, 'identity.json'), 'utf8'));
  assert.equal(fixture.state.verified[0].node_id, identity.nodeId);
  // Every request this agent sent carried both headers (the blocked agent's one request did not).
  const sentByAgent = fixture.state.seen.slice(1);
  assert.ok(sentByAgent.length >= 2 && sentByAgent.every((seen) => seen.had_id && seen.had_secret && seen.passed));
  assert.deepEqual(fixture.state.seen[0], { method: 'POST', path: '/v1/compute/enroll', had_id: false, had_secret: false, passed: false });

  // The clean stop: through the stop file, as enroll-device.mjs does on every platform.
  fs.writeFileSync(path.join(stateDir, 'node-agent.stop'), '');
  assert.equal(await agent.exited, 0);
  // Not in what it printed, and not in anything it wrote.
  for (const secret of [token.secret, token.id, enrolToken]) {
    assert.equal(agent.output.text.includes(secret), false, 'agent output');
    for (const file of filesUnder(stateDir)) assert.equal(fs.readFileSync(file, 'utf8').includes(secret), false, path.basename(file));
  }
});

// The whole path: serve.mjs (the real gateway on loopback), an Access fixture
// in front of it as the tunnel's public hostname would be, then enroll-device
// and submit-job as a second device would run them. Needs the pinned PGlite
// and openssl, as run.mjs does; skipped with the reason otherwise. FIXTURE
// executor: not hardware proof.
function endToEndMissing() {
  if (!process.env.PGLITE_MODULE_PATH || !fs.existsSync(process.env.PGLITE_MODULE_PATH)) return 'PGLITE_MODULE_PATH is not set to an installed PGlite';
  return opensslMissing();
}

function firstJsonLine(child, label, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let buffer = ''; let errors = '';
    const timer = setTimeout(() => reject(new Error(`${label}: no ready line within ${timeoutMs} ms; stderr: ${errors.slice(0, 800)}`)), timeoutMs);
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${label} exited with ${code}; stderr: ${errors.slice(0, 800)}`)); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      resolve({ record: JSON.parse(buffer.slice(0, end)), raw: () => buffer + errors });
    });
  });
}

async function stopByFile(child, dir) {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  fs.writeFileSync(path.join(dir, 'stop'), '');
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 45_000);
  const code = await exited;
  clearTimeout(timer);
  return code;
}

test('FIXTURE end to end through an Access pass: a second device enrols and takes a job by hostname-style flags, the receipt verifies, and no credential is logged or written', { skip: endToEndMissing() || false, timeout: 300_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'device-access-e2e-'));
  const runDir = path.join(work, 'run');
  const stateDir = path.join(work, 'device');
  const portBase = 45600 + Math.floor(Math.random() * 400) * 3;
  const executorPort = portBase + 1700;
  const children = [];
  t.after(() => { for (const child of children) { try { child.kill('SIGKILL'); } catch {} } });
  const background = (script, args, env = process.env) => { const child = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); children.push(child); return child; };

  const serve = background(path.join(SCRIPTS, 'serve.mjs'), ['--run-dir', runDir, '--port-base', String(portBase), '--no-stdin']);
  assert.equal((await firstJsonLine(serve, 'serve')).record.event, 'staging_ready');
  // The fixture stands where the public hostname would: TLS in front, Access, then the loopback gateway.
  // It presents the staging's own certificate, so the device pins it with --ca (system trust is the Mac's path).
  const tlsFiles = { key: fs.readFileSync(path.join(runDir, RUN_FILES.tls_key)), cert: fs.readFileSync(path.join(runDir, RUN_FILES.ca_cert)) };
  const token = newToken();
  const front = await accessFixture({ mode: 'service-token', token, tls: tlsFiles, upstream: portBase });
  t.after(() => front.close());
  const executor = background(path.join(SCRIPTS, 'fixture-executor.mjs'), [], { ...process.env, FIXTURE_EXECUTOR_PORT: String(executorPort), FIXTURE_IMPLEMENTATION: 'fixture.echo.local' });
  await firstJsonLine(executor, 'fixture executor', 20_000);

  const reach = ['--compute-url', front.url, '--org', DEFAULT_ORG, '--ca', path.join(runDir, RUN_FILES.ca_cert)];
  const enrolFile = path.join(runDir, RUN_FILES.enroll_token);
  const adminFile = path.join(runDir, RUN_FILES.admin_token);
  const enrolToken = fs.readFileSync(enrolFile, 'utf8').trim();
  const adminToken = fs.readFileSync(adminFile, 'utf8').trim();
  const deviceArgs = [...reach, '--enroll-token-file', enrolFile, '--state-dir', stateDir, '--name', 'access-device', '--implementation', 'fixture.echo.local', '--model', 'fixture-echo', '--executor-url', `http://127.0.0.1:${executorPort}`, '--no-stdin'];

  // Without the service token: blocked by Access, exit 3, nothing enrolled.
  const blocked = await runToExit('enroll-device.mjs', deviceArgs.map((value) => (value === stateDir ? path.join(work, 'blocked') : value)), childEnv());
  assert.equal(blocked.code, 3, blocked.stdout + blocked.stderr);
  assert.match(blocked.stderr, /blocked by Access/);

  const device = background(path.join(SCRIPTS, 'enroll-device.mjs'), deviceArgs, childEnv(tokenEnv(token)));
  const enrolled = await firstJsonLine(device, 'enroll-device');
  assert.equal(enrolled.record.event, 'device_enrolled');
  assert.deepEqual([enrolled.record.trust, enrolled.record.access_service_token, enrolled.record.compute_url], ['ca', true, front.url]);

  const out = path.join(work, 'out');
  const submitted = await runToExit('submit-job.mjs', [...reach, '--admin-token-file', adminFile, '--implementation', 'fixture.echo.local', '--out', out, '--prompt', 'through access', '--timeout-ms', '90000'], childEnv(tokenEnv(token)));
  assert.equal(submitted.code, 0, submitted.stdout + submitted.stderr);
  const verify = JSON.parse(fs.readFileSync(path.join(out, 'verify.json'), 'utf8'));
  assert.deepEqual(Object.entries(verify.checks).filter(([, value]) => value !== true), []);
  // The real gateway verified the node's signed requests behind the Access pass, and the receipt carries its completion signature.
  assert.equal(verify.checks.node_signature_verifies_against_enrolled_key, true);
  assert.equal(verify.checks.node_attestation_binds_this_lease, true);
  assert.equal(verify.device.node_id, enrolled.record.node_id);
  assert.equal(verify.device.facts.bound, true);
  assert.deepEqual([verify.fixture, verify.hardware_proof], [true, false]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')).output.content, 'ECHO: through access');
  // A submit without the service token is told so, by name, and exits 3.
  const noToken = await runToExit('submit-job.mjs', [...reach, '--admin-token-file', adminFile, '--implementation', 'fixture.echo.local', '--out', path.join(work, 'blocked-out')], childEnv());
  assert.equal(noToken.code, 3, noToken.stdout + noToken.stderr);
  assert.match(noToken.stderr, /"code":"ACCESS_BLOCKED"/);

  // Every request that reached the gateway carried both headers; the node's lease traffic is among them.
  const passed = front.state.seen.filter((seen) => seen.passed);
  for (const pathname of ['/v1/compute/enroll', '/v1/compute/heartbeat', '/v1/compute/lease', '/v1/compute/jobs']) assert.ok(passed.some((seen) => seen.path === pathname), pathname);
  assert.ok(passed.some((seen) => /^\/v1\/compute\/leases\/[0-9a-f-]{36}\/complete$/.test(seen.path)), 'the signed completion went through the Access pass');
  assert.ok(front.state.seen.filter((seen) => !seen.passed).every((seen) => !seen.had_id && !seen.had_secret), 'the only requests turned away were the ones sent with no token');

  assert.equal(await stopByFile(device, stateDir), 0);
  // No credential in anything printed or written on the device side.
  const printed = enrolled.raw() + submitted.stdout + submitted.stderr + blocked.stdout + blocked.stderr + noToken.stdout + noToken.stderr;
  for (const secret of [token.secret, token.id, enrolToken, adminToken]) {
    assert.equal(printed.includes(secret), false, 'printed');
    for (const file of [...filesUnder(stateDir), ...filesUnder(out)]) assert.equal(fs.readFileSync(file, 'utf8').includes(secret), false, path.basename(file));
  }
  const deviceJson = JSON.parse(fs.readFileSync(path.join(stateDir, 'device.json'), 'utf8'));
  assert.deepEqual([deviceJson.trust, deviceJson.access_service_token], ['ca', true]);
  assert.equal(await stopByFile(serve, runDir), 0);
});

test('the staging scripts refuse to run with certificate verification disabled by environment', async () => {
  const { assertTlsVerificationOn, assertNotProduction } = await import('../../scripts/staging/device-jobs/staging-access.mjs');
  assert.throws(() => assertTlsVerificationOn({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), (e) => e.reason === 'TLS_VERIFICATION_DISABLED');
  assert.doesNotThrow(() => assertTlsVerificationOn({ NODE_TLS_REJECT_UNAUTHORIZED: '1' }));
  assert.doesNotThrow(() => assertTlsVerificationOn({}));
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try { assert.throws(() => assertNotProduction('https://127.0.0.1:1'), (e) => e.reason === 'TLS_VERIFICATION_DISABLED'); }
  finally { if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before; }
});