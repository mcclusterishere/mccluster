/* Provider fetch with Workers-compatible, bounded redirect handling.

   Cloudflare Workers' fetch() accepts only redirect: 'follow' | 'manual'.
   redirect: 'error' (which Node's fetch accepts, so mocked unit tests never
   noticed) throws a TypeError in workerd before any request is made, so every
   caller that used it failed in production on every call.

   The intent of 'error' was "never follow a provider somewhere else". This
   keeps that intent with redirect: 'manual':
     - a 3xx is followed at most MAX_REDIRECTS times, only for GET/HEAD,
       only over https, only to the SAME hostname the request started on
       (or an explicit per-caller allowlist), with no userinfo and no port
       other than 443;
     - anything else is an UpstreamError with code 'upstream_redirect',
       never a silent follow and never a success.

   Callers keep their own host/SSRF checks on the first URL; this only governs
   where a provider's answer may send us next. */

export const MAX_REDIRECTS = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/* Typed upstream failure. code is stable and machine-readable:
   upstream_redirect, upstream_timeout, upstream_network, upstream_http,
   upstream_rate_limited, upstream_invalid_json. */
export class UpstreamError extends Error {
  constructor(code, message, { providerStatus = null } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

function hostAllowed(url, hosts) {
  return url.protocol === 'https:'
    && !url.username
    && !url.password
    && (url.port === '' || url.port === '443')
    && hosts.includes(url.hostname.toLowerCase());
}

async function discard(response) {
  try { await response.body?.cancel(); } catch { /* already consumed or not cancellable */ }
}

/* fetch(url, init) with redirect: 'manual' and the policy above. Returns the
   final non-redirect Response (ok or not; the caller judges status).
   options.fetchImpl defaults to the global fetch looked up at call time.
   options.allowedHosts widens "same hostname" to a fixed list. */
export async function fetchNoCrossHostRedirect(input, init = {}, { fetchImpl = null, allowedHosts = null, maxRedirects = MAX_REDIRECTS } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const start = new URL(String(input));
  const hosts = (allowedHosts && allowedHosts.length ? allowedHosts : [start.hostname]).map((h) => String(h).toLowerCase());
  const method = String(init.method || 'GET').toUpperCase();
  const { redirect: _ignored, ...rest } = init;
  let current = start;
  for (let hop = 0; ; hop += 1) {
    const response = await doFetch(current.toString(), { ...rest, redirect: 'manual' });
    if (response && response.type === 'opaqueredirect') {
      throw new UpstreamError('upstream_redirect', 'provider redirected (opaque redirect)', { providerStatus: 0 });
    }
    if (!response || !REDIRECT_STATUSES.has(response.status)) return response;
    const status = response.status;
    const location = response.headers.get('location');
    await discard(response);
    let next = null;
    try { next = location ? new URL(location, current) : null; } catch { next = null; }
    if (method !== 'GET' && method !== 'HEAD') {
      throw new UpstreamError('upstream_redirect', `provider HTTP ${status} redirect on ${method} is not followed`, { providerStatus: status });
    }
    if (!next || !hostAllowed(next, hosts)) {
      throw new UpstreamError('upstream_redirect', `provider HTTP ${status} redirect to a non-allowlisted location`, { providerStatus: status });
    }
    if (hop >= maxRedirects) {
      throw new UpstreamError('upstream_redirect', `provider exceeded ${maxRedirects} redirects`, { providerStatus: status });
    }
    current = next;
  }
}
