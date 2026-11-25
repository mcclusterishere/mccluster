import { createHash, randomUUID } from 'node:crypto';
import { signCoreRequest } from '../broker-edge-auth.mjs';

const DEFAULT_PROTOCOL_VERSION = '2026-07-28';
const DEFAULT_TIMEOUT_MS = 15_000;

function safeRemoteUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.hash) throw new Error('MCP endpoint must not contain credentials or a fragment');
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error(`MCP endpoint must use HTTPS (or loopback HTTP): ${url.origin}`);
  }
  return url;
}

function authHeaders(server) {
  const headers = {};
  if (server.bearerEnv) {
    const token = process.env[server.bearerEnv];
    if (token) headers.authorization = `Bearer ${token}`;
  }
  if (server.headerEnv?.name && server.headerEnv?.env) {
    const value = process.env[server.headerEnv.env];
    if (value) headers[server.headerEnv.name] = value;
  }
  return headers;
}

function clientMeta(server) {
  return {
    'io.modelcontextprotocol/protocolVersion': server.protocolVersion || DEFAULT_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'mccluster-core',
      version: '1.0.0'
    },
    'io.modelcontextprotocol/clientCapabilities': {}
  };
}

function withMeta(server, params = {}) {
  return {
    ...params,
    _meta: {
      ...clientMeta(server),
      ...(params?._meta || {})
    }
  };
}

function encodeHeaderValue(value) {
  const text = String(value);
  if (/^[\x21-\x7E](?:[\x20-\x7E\t]*[\x21-\x7E])?$/.test(text) && !/^=\?base64\?[\s\S]*\?=$/.test(text)) {
    return text;
  }
  return `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function parseSse(text) {
  let answer = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const candidate = JSON.parse(line.slice(5).trim());
      if (candidate && (candidate.result !== undefined || candidate.error !== undefined)) answer = candidate;
    } catch {
      // Ignore progress/keepalive frames that are not JSON responses.
    }
  }
  return answer;
}

async function parseRpcResponse(res) {
  const text = await res.text();
  const type = res.headers.get('content-type') || '';
  let payload = null;
  try {
    payload = /text\/event-stream/i.test(type) ? parseSse(text) : JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!res.ok && !payload) {
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500) || res.statusText}`);
  }
  if (!payload) throw new Error('MCP server returned no readable JSON-RPC response');
  if (payload.error) {
    const error = new Error(payload.error.message || 'MCP JSON-RPC error');
    error.code = payload.error.code;
    error.data = payload.error.data;
    throw error;
  }
  return payload.result ?? {};
}

/* Transport failures where the request may or may not have reached the
   server. A retry is safe only because the same operation id travels with
   it (below); the server dedupes paid work on that id, not on the nonce. */
function isTransportFailure(error) {
  if (!error) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true; /* undici: fetch failed */
  return error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'UND_ERR_SOCKET';
}

export async function mcpRpc(server, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await mcpRpcOnce(server, method, params, { timeoutMs });
    } catch (error) {
      if (attempt >= retries || !isTransportFailure(error)) throw error;
      attempt += 1;
    }
  }
}

async function mcpRpcOnce(server, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!server?.url) throw new Error('MCP server URL is required');
  const url = safeRemoteUrl(server.url);
  const protocolVersion = server.protocolVersion || DEFAULT_PROTOCOL_VERSION;
  const enriched = withMeta(server, params);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
    'Mcp-Method': method,
    ...authHeaders(server)
  };

  const name = enriched.name ?? enriched.uri;
  if (['tools/call', 'resources/read', 'prompts/get'].includes(method)) {
    if (!name) throw new Error(`${method} requires a name or uri`);
    headers['Mcp-Name'] = encodeHeaderValue(name);
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: enriched });
  // A server marked with signEnv gets a per-request signature over these exact
  // bytes instead of relying on a stored user token, which expires.
  if (server.signEnv) {
    const secret = process.env[server.signEnv];
    if (secret) {
      Object.assign(headers, signCoreRequest({
        secret,
        method: 'POST',
        path: url.pathname,
        bodyBytes: Buffer.from(body)
      }));
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    // A redirect must never forward custom auth/signature headers or private
    // tool arguments to a destination that was not configured by the owner.
    redirect: 'manual'
  });
  if (res.status >= 300 && res.status < 400) {
    // Cleanup must not turn this policy refusal into a retriable transport error.
    try { await res.body?.cancel(); } catch { /* preserve the redirect refusal */ }
    throw new Error('MCP endpoint redirected; verify and configure its exact destination before retrying');
  }
  return parseRpcResponse(res);
}

export async function listMcpTools(server, options) {
  const result = await mcpRpc(server, 'tools/list', {}, options);
  return Array.isArray(result.tools) ? result.tools : [];
}

/* Audit C5: every logical tool call to a Core-signed McCluster server carries
   ONE stable operation_id, minted here before the first attempt, so a retry
   with a fresh signature (and nonce) still maps to the one paid job on the
   Worker. Precedence: an explicit args.operation_id, then options.operationId
   (a caller-scoped identity such as a Core job id plus ordinal), else a fresh
   id for this call. The id is only injected for servers that sign requests
   (ours); third-party MCP servers get their arguments untouched. */
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function operationIdForCall(server, args = {}, options = {}) {
  const explicit = typeof args?.operation_id === 'string' ? args.operation_id : null;
  const scoped = typeof options?.operationId === 'string' ? options.operationId : null;
  const chosen = explicit || scoped || `core:${randomUUID()}`;
  if (!OPERATION_ID.test(chosen)) throw new Error('operation_id must be 1-128 characters of letters, digits, ".", "_", ":" or "-"');
  return chosen;
}

/* The job-scoped form of that id for Core's own executors:
   `core:<scope>:<step>`, scope being the Core job id and step the ordinal of
   the paid call inside that job. A re-attempt of the same job (crash, lost
   lease, requeue) composes the same id, so the Worker hands back the job it
   already holds instead of paying again; each step inside the job gets its
   own. The step never carries ":" so the last ":" always separates the two.
   When the direct form would not fit the Worker's 128-char rule, the scope is
   shortened deterministically and a sha256 prefix of the full scope keeps
   distinct scopes distinct; the step is never cut. */
const OPERATION_ID_MAX = 128;
const OPERATION_STEP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
export function scopedOperationId(scope, step) {
  const scopeText = String(scope ?? '').trim();
  const stepText = String(step ?? '').trim();
  if (!scopeText) throw new Error('operation id scope is required: the Core job id');
  if (!OPERATION_STEP.test(stepText)) throw new Error('operation id step must be 1-32 characters of letters, digits, ".", "_" or "-"');
  const direct = `core:${scopeText}:${stepText}`;
  if (OPERATION_ID.test(direct)) return direct;
  const digest = createHash('sha256').update(scopeText, 'utf8').digest('hex').slice(0, 16);
  const tail = `-${digest}:${stepText}`;
  const room = OPERATION_ID_MAX - 'core:'.length - tail.length;
  const head = scopeText.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, room);
  return `core:${head}${tail}`;
}

export async function callMcpTool(server, name, args = {}, options = {}) {
  const carriesOperationId = Boolean(server?.signEnv) || options.operationIds === true;
  const callArgs = carriesOperationId ? { ...args, operation_id: operationIdForCall(server, args, options) } : args;
  const retries = Number.isInteger(options.retries) ? options.retries : (carriesOperationId ? 1 : 0);
  return mcpRpc(server, 'tools/call', { name, arguments: callArgs }, { ...options, retries });
}

export { DEFAULT_PROTOCOL_VERSION };
