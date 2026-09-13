const HOST = process.env.CORE_BROKER_HOST || '127.0.0.1';
const PORT = Number(process.env.CORE_BROKER_PORT || 4777);
const TOKEN = String(process.env.CORE_BROKER_TOKEN || '');

export async function callCoreCapability(capability, args = {}, { requirements = {} } = {}) {
  if (!capability) throw new Error('capability is required');
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

  const res = await fetch(`http://${HOST}:${PORT}/v1/capabilities/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ capability, arguments: args, requirements }),
  });

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = { raw: text }; }

  if (!res.ok) {
    const error = new Error(body?.error || `Core capability call failed: ${res.status}`);
    error.status = res.status;
    error.detail = body;
    throw error;
  }
  return body;
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
