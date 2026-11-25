// Reaching the device-jobs staging through an Access-protected hostname
// (docs/control-plane/DEVICE-STAGING-ACCESS.md). Side-effect free: importing
// this file starts nothing. It holds the production-host refusal, the trust
// choice (--trust system or --ca <file>, never "no verification"), the
// optional Cloudflare Access service-token headers (environment only), the
// recognition of an Access block, and the preflight a device runs before it
// enrols. The loopback mode (a run directory and its own CA) does not change.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { COMPUTE_PROTOCOL } from '../../../core/src/compute/protocol.mjs';
import { ACCESS_ENV, ACCESS_HEADERS, accessServiceToken, redactSecrets } from '../../../core/src/compute/node-agent-config.mjs';

export { ACCESS_ENV, ACCESS_HEADERS, redactSecrets };
export const PREFLIGHT_SCHEMA = 'mccluster-device-staging-preflight/1';
export const GATEWAY_SERVICE = 'mccluster-compute-gateway';
// These scripts are staging tools. The production compute and Core hosts are
// refused before anything is read, resolved or sent.
export const PRODUCTION_HOSTS = Object.freeze(['compute.mccluster.org', 'core.mccluster.org']);
export const PREFLIGHT_EXIT = Object.freeze({ ready: 0, failed: 1, blocked_by_access: 3 });
export const ACCESS_FIX = `Allow this device in the Access application that protects the staging hostname, one of two ways: (1) a service token: the owner adds a Service Auth policy that includes a service token, and this device sets ${ACCESS_ENV.id} and ${ACCESS_ENV.secret} to that token's two values in its environment; or (2) an IP bypass: the owner adds a Bypass policy for this device's public IP address. Nothing else changes; then run the same command again.`;

function usageError(message) {
  return Object.assign(new Error(message), { code: 'USAGE' });
}

export function isProductionHost(hostname) {
  const name = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  return PRODUCTION_HOSTS.includes(name);
}

// Node turns certificate verification off for the whole process when this variable is '0'.
// These scripts send an admin token, an enrolment token and an Access service token, so they
// refuse to run that way rather than send a secret over an unverified connection.
export function assertTlsVerificationOn(env = process.env) {
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED ?? '').trim() === '0') {
    throw Object.assign(usageError('NODE_TLS_REJECT_UNAUTHORIZED is set to 0; unset it. The staging scripts never run with certificate verification disabled'), { code: 'USAGE', reason: 'TLS_VERIFICATION_DISABLED' });
  }
}

export function assertNotProduction(url, flag = 'compute-url') {
  assertTlsVerificationOn();
  let host;
  try { host = new URL(url).hostname; } catch { throw usageError(`--${flag} must be a URL`); }
  if (isProductionHost(host)) throw Object.assign(usageError(`--${flag} names a production host; the device-jobs staging scripts never talk to production`), { code: 'USAGE', reason: 'PRODUCTION_HOST_REFUSED' });
  return url;
}

// --trust system | --ca <file>: exactly one. `haveDefaultCa` is the loopback
// mode, where the run directory's own CA is pinned when neither is given.
export function resolveTrust({ trust, ca, haveDefaultCa = false } = {}) {
  if (trust !== undefined && trust !== 'system') throw usageError('--trust must be "system"; to pin a certificate authority pass --ca <file> instead (there is no option that turns verification off)');
  if (trust === 'system' && ca) throw usageError('pass exactly one of --trust system or --ca <file>, not both');
  if (trust === 'system') return 'system';
  if (ca || haveDefaultCa) return 'ca';
  throw usageError('pass exactly one of --trust system (a public-CA hostname) or --ca <file> (a pinned certificate authority)');
}

export function accessFromEnv(env = process.env) {
  try { return accessServiceToken(env); }
  catch (error) { throw Object.assign(new Error(error.message), { code: error.code || 'ACCESS_TOKEN_INVALID' }); }
}

// The certificate authorities "--trust system" verifies against: the runtime's
// bundled public roots plus, where this Node can read it, the operating
// system's trust store. `undefined` leaves Node's own default in force.
let systemCa;
export function systemTrust() {
  if (systemCa !== undefined) return systemCa;
  systemCa = { ca: undefined, store: 'node-default' };
  try {
    if (typeof tls.getCACertificates === 'function') {
      const merged = [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])];
      if (merged.length) systemCa = { ca: merged, store: 'node-default+operating-system' };
    }
  } catch { /* keep Node's default */ }
  return systemCa;
}

// TLS options for a request: a pinned CA replaces every default root; system
// trust never sets rejectUnauthorized and never accepts an unverified peer.
export function tlsOptionsFor({ trust = 'ca', ca } = {}) {
  if (trust === 'system') { const { ca: roots } = systemTrust(); return roots ? { ca: roots } : {}; }
  return { ca };
}

function headerValue(headers, name) {
  if (!headers) return null;
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return value == null ? null : String(Array.isArray(value) ? value[0] : value);
}

// A redirect target, reduced to scheme, host and path: an Access login URL
// carries request state in its query, and none of it belongs in a report.
function barePath(location) {
  if (!location) return null;
  try { const url = new URL(location, 'https://relative.invalid'); return `${url.hostname === 'relative.invalid' ? '' : `${url.protocol}//${url.host}`}${url.pathname}`.slice(0, 300); }
  catch { return null; }
}

// Is this response Cloudflare Access (or the edge in front of it) refusing the
// device, instead of the compute gateway answering? The gateway never
// redirects, and its own refusals are JSON with a named `code`.
export function classifyAccessBlock({ status, headers = {}, body = null } = {}) {
  const location = headerValue(headers, 'location');
  const raw = typeof body === 'string' ? body : typeof body?.raw === 'string' ? body.raw : '';
  const accessMarkers = /cloudflareaccess\.com|\/cdn-cgi\/access\//i;
  if ([301, 302, 303, 307, 308].includes(Number(status))) {
    return { blocked: true, evidence: accessMarkers.test(String(location || '')) ? 'redirect-to-access-login' : 'redirect', http_status: Number(status), location: barePath(location) };
  }
  if (Number(status) === 403) {
    const gatewayRefusal = body && typeof body === 'object' && typeof body.code === 'string' && typeof body.raw !== 'string';
    if (!gatewayRefusal) return { blocked: true, evidence: 'forbidden', http_status: 403, location: null };
  }
  if (raw && accessMarkers.test(raw)) return { blocked: true, evidence: 'access-login-page', http_status: Number(status), location: null };
  return { blocked: false, evidence: null, http_status: Number(status), location: null };
}

export function accessBlockedError(block, { tokenSent = false } = {}) {
  const how = block.evidence === 'forbidden' ? 'HTTP 403' : block.evidence === 'access-login-page' ? 'an Access login page' : `HTTP ${block.http_status} to ${block.location || 'a login page'}`;
  const sent = tokenSent ? 'A service token was sent and was not accepted (wrong token, expired, or not included in the policy).' : 'No service token was sent.';
  return Object.assign(new Error(`blocked by Access: the staging hostname answered ${how} instead of the compute gateway. ${sent} ${ACCESS_FIX}`), { code: 'ACCESS_BLOCKED', block });
}

function resolveHost(hostname, lookup) {
  if (net.isIP(hostname.replace(/^\[|\]$/g, ''))) return Promise.resolve({ ok: true, literal: true, addresses: [hostname.replace(/^\[|\]$/g, '')] });
  return lookup(hostname, { all: true }).then(
    (found) => ({ ok: found.length > 0, literal: false, addresses: found.map((item) => item.address).slice(0, 8) }),
    (error) => ({ ok: false, literal: false, addresses: [], error: String(error.code || error.message).slice(0, 80) })
  );
}

function tlsHandshake({ hostname, port, trust, ca, timeoutMs }) {
  return new Promise((resolve) => {
    const bare = hostname.replace(/^\[|\]$/g, '');
    const socket = tls.connect({ host: bare, port, ...(net.isIP(bare) ? {} : { servername: bare }), ...tlsOptionsFor({ trust, ca }) });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: 'TLS_TIMEOUT' }));
    socket.once('error', (error) => done({ ok: false, error: String(error.code || error.message).slice(0, 80) }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate() || {};
      done({ ok: socket.authorized === true, protocol: socket.getProtocol(), subject: cert.subject?.CN ?? null, issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null, valid_to: cert.valid_to ?? null, ...(socket.authorized ? {} : { error: String(socket.authorizationError || 'UNAUTHORIZED') }) });
    });
  });
}

// From this device: does the name resolve, does TLS verify under the chosen
// trust, and does /health answer as the compute gateway with the protocol this
// checkout speaks? An Access login page, a redirect or a 403 is reported as
// "blocked by Access" with the fix. `request` is real-device-lib's requestJson.
export async function preflightStaging({ computeUrl, trust = 'ca', ca, access = { configured: false, headers: {}, secrets: [] }, request, lookup = dns.promises.lookup, timeoutMs = 8_000 }) {
  const url = new URL(computeUrl);
  const secure = url.protocol === 'https:';
  const port = Number(url.port || (secure ? 443 : 80));
  const report = {
    schema: PREFLIGHT_SCHEMA, ok: false, verdict: null, host: url.hostname, port, trust: secure ? trust : 'none (http)',
    trust_store: secure ? (trust === 'system' ? systemTrust().store : 'pinned-ca-file') : null,
    access_service_token_sent: access.configured === true,
    checks: { dns: null, tls: null, health: null, access: null },
    fix: null
  };
  const finish = (verdict, fix = null) => redactSecrets({ ...report, ok: verdict === 'ready', verdict, fix }, access.secrets);
  if (isProductionHost(url.hostname)) return finish('production-host-refused', 'Use the staging hostname the owner named; these scripts never talk to production.');

  report.checks.dns = await resolveHost(url.hostname, lookup);
  if (!report.checks.dns.ok) return finish('dns-failed', 'The staging hostname does not resolve from this device. Check the name the owner gave you and this device\'s DNS.');

  if (secure) {
    report.checks.tls = await tlsHandshake({ hostname: url.hostname, port, trust, ca, timeoutMs });
    if (!report.checks.tls.ok) {
      return finish('tls-failed', trust === 'system'
        ? 'TLS did not verify against the system trust store. A public staging hostname presents a public-CA certificate; if this endpoint uses the staging\'s own certificate, pin it with --ca <file> instead. Verification is never turned off.'
        : 'TLS did not verify against the pinned CA file. Use the ca-cert.pem of the staging that is running, or --trust system for a public-CA hostname. Verification is never turned off.');
    }
  } else report.checks.tls = { ok: null, skipped: 'not https' };

  let reply;
  try { reply = await request(`${url.origin}/health`, { trust, ca, timeoutMs, headers: { ...access.headers } }); }
  catch (error) {
    report.checks.health = { ok: false, error: String(error.code || error.message).slice(0, 120) };
    return finish('unreachable', 'The staging hostname resolved and TLS verified, but /health did not answer. Ask the owner whether the staging and its tunnel are running.');
  }
  const block = classifyAccessBlock(reply);
  report.checks.access = { blocked: block.blocked, evidence: block.evidence, location: block.location };
  const service = reply.body && typeof reply.body === 'object' ? reply.body.service ?? null : null;
  const protocol = reply.body && typeof reply.body === 'object' ? reply.body.protocol ?? null : null;
  report.checks.health = { ok: reply.status === 200 && service === GATEWAY_SERVICE && protocol === COMPUTE_PROTOCOL, http_status: reply.status, service, protocol, expected_service: GATEWAY_SERVICE, expected_protocol: COMPUTE_PROTOCOL };
  if (block.blocked) return finish('blocked-by-access', accessBlockedError(block, { tokenSent: access.configured === true }).message);
  if (!report.checks.health.ok) return finish('not-the-compute-gateway', `/health answered HTTP ${reply.status} but not as ${GATEWAY_SERVICE} with protocol ${COMPUTE_PROTOCOL}. The hostname's ingress rule must point at the staging gateway, and this checkout must be the branch the staging runs.`);
  return finish('ready');
}

export function preflightExitCode(report) {
  if (report?.ok === true) return PREFLIGHT_EXIT.ready;
  return report?.verdict === 'blocked-by-access' ? PREFLIGHT_EXIT.blocked_by_access : PREFLIGHT_EXIT.failed;
}
