/* Shared shapes for the infrastructure control surface.

   Provider adapters all return the same envelope so one audit record,
   one console and one MCP client can read GitHub, Cloudflare, Supabase
   and OVH results without a special case per provider. */

export function opsError(message, status = 400, detail) {
  return Object.assign(new Error(message), { status, detail });
}

export function notConfigured(provider, secrets) {
  return opsError(
    `${provider} control is not configured on this Worker`,
    503,
    { code: 'provider_not_configured', provider, required_secrets: secrets }
  );
}

export function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function requireParams(params, names) {
  for (const name of names || []) {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw opsError(`${name} is required`, 400, { code: 'missing_parameter', parameter: name });
    }
  }
}

/* A JSON call to a provider API that never lets a provider's error body
   masquerade as a McCluster success, and never leaks the credential that
   made it. Provider 4xx stays 4xx so the caller can tell "you asked for
   something wrong" from "the provider is down". */
export async function providerFetch(provider, url, init = {}) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw opsError(`${provider} is unreachable`, 502, {
      code: 'provider_unreachable',
      provider,
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const raw = await res.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 2000) }; }
  }
  if (!res.ok) {
    throw opsError(`${provider} request failed`, res.status >= 400 && res.status < 500 ? res.status : 502, {
      code: 'provider_error',
      provider,
      provider_status: res.status,
      provider_body: truncate(body)
    });
  }
  return { status: res.status, body, headers: res.headers };
}

/* Provider bodies can be enormous (a log page, a file listing, a Worker
   script). The audit ledger keeps the shape, not the payload. */
export function truncate(value, max = 8000) {
  if (value === null || value === undefined) return value;
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  if (json.length <= max) return value;
  return { truncated: true, bytes: json.length, preview: json.slice(0, max) };
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
