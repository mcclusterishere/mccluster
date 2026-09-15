const DEFAULT_PROTOCOL_VERSION = '2026-07-28';
const DEFAULT_TIMEOUT_MS = 15_000;

function safeRemoteUrl(raw) {
  const url = new URL(raw);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
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

export async function mcpRpc(server, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: enriched }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  return parseRpcResponse(res);
}

export async function listMcpTools(server, options) {
  const result = await mcpRpc(server, 'tools/list', {}, options);
  return Array.isArray(result.tools) ? result.tools : [];
}

export async function callMcpTool(server, name, args = {}, options) {
  return mcpRpc(server, 'tools/call', { name, arguments: args }, options);
}

export { DEFAULT_PROTOCOL_VERSION };
