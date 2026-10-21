import { signEdgeRequest } from '../broker-edge-auth.mjs';

const HOST = process.env.CORE_BROKER_HOST || '127.0.0.1';
const PORT = Number(process.env.CORE_BROKER_PORT || 4777);
const CALL_PATH = '/v1/capabilities/call';

export async function callCoreCapability(capability, args = {}, { requirements = {}, timeoutMs = 0 } = {}) {
  if (!capability) throw new Error('capability is required');
  const body = JSON.stringify({ capability, arguments: args, requirements });
  const headers = { 'content-type': 'application/json' };
  const token = String(process.env.CORE_BROKER_TOKEN || '');
  if (token) headers.authorization = `Bearer ${token}`;
  // The broker reads the same /etc/mccluster/core.env as this process. When the
  // edge signing key is set there, the broker refuses every request that lacks
  // a fresh signature over its exact body, loopback callers included.
  const signingKey = String(process.env.CORE_EDGE_SIGNING_KEY || '');
  if (signingKey) {
    Object.assign(headers, signEdgeRequest({
      secret: signingKey,
      method: 'POST',
      path: CALL_PATH,
      bodyBytes: Buffer.from(body),
    }));
  }

  const res = await fetch(`http://${HOST}:${PORT}${CALL_PATH}`, {
    method: 'POST',
    headers,
    body,
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; }
  catch { parsed = { raw: text }; }

  if (!res.ok) {
    const error = new Error(parsed?.error || `Core capability call failed: ${res.status}`);
    error.status = res.status;
    error.detail = parsed;
    throw error;
  }
  return parsed;
}

export function unwrapCapabilityResult(value) {
  let current = value;
  for (let i = 0; i < 5; i += 1) {
    if (!current || typeof current !== 'object') break;
    if (Array.isArray(current)) break;
    if ('result' in current && Object.keys(current).length <= 12) {
      current = current.result;
      continue;
    }
    if ('data' in current && Object.keys(current).length <= 6) {
      current = current.data;
      continue;
    }
    break;
  }
  return current;
}
