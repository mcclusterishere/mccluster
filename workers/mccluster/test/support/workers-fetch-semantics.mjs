/**
 * Test double that enforces Cloudflare Workers `fetch()` RequestInit semantics.
 * (Ported from Hitman's Halo src/testSupport/workersFetchSemantics.mjs.)
 *
 * Node's undici fetch accepts `redirect: 'error'` (and other browser-only init
 * fields) that the Workers runtime rejects with a TypeError, so a plain mocked
 * fetch cannot catch Worker-only failures. Wrap a fixture handler with
 * `workersFetch(handler)` and every call is validated the way workerd would
 * before the handler sees it.
 *
 * Mirrored rules (workerd RequestInitializerDict):
 * - redirect must be "follow" or "manual"
 *   ("Invalid redirect value, must be one of \"follow\" or \"manual\" ...").
 * - mode, credentials, referrer, referrerPolicy, keepalive, integrity (non-empty),
 *   priority and window are not implemented and throw.
 * - cache is only accepted as "no-store" / "no-cache" (recent compatibility dates);
 *   anything else throws.
 */

const ALLOWED_REDIRECT = new Set(['follow', 'manual']);
const UNIMPLEMENTED_FIELDS = ['mode', 'credentials', 'referrer', 'referrerPolicy', 'keepalive', 'priority', 'window'];
const ALLOWED_CACHE = new Set(['no-store', 'no-cache']);

export function assertWorkersRequestInit(init = {}) {
  if (init == null) return;
  if (init.redirect !== undefined && !ALLOWED_REDIRECT.has(init.redirect)) {
    throw new TypeError(`Invalid redirect value, must be one of "follow" or "manual" ("error" will be supported if/when it becomes standardized). Got: ${JSON.stringify(init.redirect)}`);
  }
  for (const field of UNIMPLEMENTED_FIELDS) {
    if (init[field] !== undefined) {
      throw new TypeError(`The '${field}' field on 'RequestInitializerDict' is not implemented.`);
    }
  }
  if (init.integrity !== undefined && init.integrity !== '') {
    throw new TypeError("The 'integrity' field on 'RequestInitializerDict' is not implemented.");
  }
  if (init.cache !== undefined && !ALLOWED_CACHE.has(init.cache)) {
    throw new TypeError(`Unsupported cache mode: ${JSON.stringify(init.cache)}`);
  }
}

/**
 * Wrap a `(url, init, call) => Response | Promise<Response>` fixture with
 * Workers init validation plus a call log. With `redirect: 'manual'` the handler's
 * 3xx response is returned as-is (Workers semantics: no opaque-redirect filtering).
 */
export function workersFetch(handler) {
  const calls = [];
  const impl = async (input, init = {}) => {
    assertWorkersRequestInit(init);
    const url = new URL(String(input));
    const call = { url: url.toString(), init };
    calls.push(call);
    return handler(url, init, call);
  };
  impl.calls = calls;
  return impl;
}

/** A fetch fixture that never answers and rejects like real fetch on abort. */
export function hangingResponse(init) {
  return new Promise((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    // AbortSignal.timeout() timers are unref'd in Node; hold the event loop open
    // (as an in-flight socket would) until the signal fires.
    const keepAlive = setTimeout(() => {}, 60_000);
    signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(signal.reason);
    }, { once: true });
  });
}
