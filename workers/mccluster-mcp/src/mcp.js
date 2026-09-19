// Remote MCP bridge: authenticated edge -> McCluster Core tool broker.
//
// docs/control-plane/MCCLUSTER-CORE.md already specifies this path. Remote
// clients reach Core over HTTPS through api.mccluster.org; the Worker owns
// protocol and authentication, and Core stays loopback-bound behind an
// authenticated tunnel. This module is the hop that was missing between them.
//
// It is deliberately not a generic proxy. Only MCP methods Core implements are
// forwarded, the caller must be a McCluster house owner, and the machine
// credential on the Worker -> Core hop is signed per request so a captured
// envelope cannot be replayed.

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY = 1_048_576;
const MCP_VERSION = '2025-11-25';
const EDGE_PROTOCOL = 'mccluster-edge/v1';

// Methods the Worker answers itself so a standard MCP client can complete a
// handshake. Core only implements the two tool methods.
const FORWARDED_METHODS = new Set(['tools/list', 'tools/call']);

// Remote clients get the normalized McCluster capability surface and nothing
// else. Core's own tool bus also carries raw, provider-namespaced tools
// (`mccluster.media.generate`, compute-node tools, whatever an upstream MCP
// server happens to advertise); those are for local agents and diagnostics on
// the host, and none of them are reachable through this route.
//
// This is an allowlist by construction, not a denylist: a capability that is
// not named here is invisible to tools/list and refused by tools/call, so
// adding a capability to Core's catalog does not silently publish it to the
// internet. Widening this set is a deliberate, reviewed edit.
//
// Risk and approval semantics are Core's to enforce, not this route's to
// relax. The spend-risk and review-required entries below stay budget-gated
// and review-gated downstream exactly as the catalog declares them; listing a
// capability here only means a remote owner may *ask*.
const REMOTE_CAPABILITIES = new Set([
  // risk: read, approval: none
  //
  // core.resume is first because it is what a fresh or context-lost
  // session calls before anything else: it returns the durable state the
  // model no longer holds. Read-only, so exposing it remotely costs
  // nothing and removes the failure mode where a reconnecting client
  // starts by guessing.
  'core.resume',
  'system.health',
  'ai.chat',
  'research.web',
  'media.models.search',
  'media.model.recommend',
  'media.job.get',
  'repo.inspect',
  'objective.plan',
  // risk: spend, approval: budget-gated
  'image.generate',
  'video.generate',
  'audio.generate',
  'model3d.generate',
  'world.generate',
  // risk: write, approval: review-required
  'code.build',
  'game.build',
  'deploy.preview'
]);

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function houseOrgId(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!res.ok) throw Object.assign(new Error('House organization lookup unavailable'), { status: 503 });
  const rows = await res.json();
  if (!Array.isArray(rows)) throw Object.assign(new Error('Invalid house organization response'), { status: 503 });
  return rows?.[0]?.id || null;
}

// Core executes code, drives builds and reaches provider credentials. Any
// authenticated Supabase user is nowhere near a sufficient gate for that, so
// this reuses the same house-owner rule the /v1/ai harness applies.
async function isHouseOwner(env, user) {
  const orgId = await houseOrgId(env);
  if (!orgId || !user?.id) return false;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=org_id&limit=1`,
    { headers: serviceHeaders(env) }
  );
  if (!res.ok) throw Object.assign(new Error('Owner membership lookup unavailable'), { status: 503 });
  const memberships = await res.json();
  if (!Array.isArray(memberships)) throw Object.assign(new Error('Invalid owner membership response'), { status: 503 });
  return Array.isArray(memberships) && memberships.length > 0;
}

function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Body(bodyBytes) {
  return b64url(await crypto.subtle.digest('SHA-256', bodyBytes));
}

// Mirrors canonicalEdgeRequest() in core/src/broker-edge-auth.mjs. The two must
// agree byte for byte; core/test/broker-edge-auth.test.mjs pins the format.
function canonicalEdgeRequest({ method, path, timestamp, nonce, digest }) {
  return ['MCCLUSTER-EDGE-V1', String(method).toUpperCase(), path, timestamp, nonce, digest].join('\n');
}

async function signEdgeRequest({ secret, method, path, bodyBytes }) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const digest = await sha256Body(bodyBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const canonical = new TextEncoder().encode(canonicalEdgeRequest({ method, path, timestamp, nonce, digest }));
  const signature = b64url(await crypto.subtle.sign('HMAC', key, canonical));
  return {
    'x-mccluster-edge-protocol': EDGE_PROTOCOL,
    'x-mccluster-timestamp': timestamp,
    'x-mccluster-nonce': nonce,
    'x-mccluster-content-sha256': digest,
    'x-mccluster-signature': signature
  };
}

function brokerConfig(env) {
  const base = String(env.CORE_BROKER_URL || '').replace(/\/+$/, '');
  if (!base) {
    throw Object.assign(new Error('Core broker URL is not configured'), { status: 503 });
  }
  const url = new URL(base);
  // Core must never be reachable over plaintext from the edge. Loopback is
  // allowed so `wrangler dev` can talk to a broker on the same machine.
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw Object.assign(new Error('Core broker URL must be HTTPS'), { status: 503 });
  }
  if (!env.CORE_EDGE_SIGNING_KEY) {
    throw Object.assign(new Error('Core edge signing key is not configured'), { status: 503 });
  }
  if (!env.CORE_BROKER_TOKEN) {
    throw Object.assign(new Error('Core broker credential is not configured'), { status: 503 });
  }
  return {
    base,
    token: env.CORE_BROKER_TOKEN,
    signingKey: env.CORE_EDGE_SIGNING_KEY || '',
    timeoutMs: Number(env.CORE_BROKER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

async function callBroker(env, { path, method = 'POST', payload }) {
  const config = brokerConfig(env);
  const bodyBytes = payload === undefined
    ? new Uint8Array(0)
    : new TextEncoder().encode(JSON.stringify(payload));

  const headers = {
    authorization: `Bearer ${config.token}`,
    accept: 'application/json'
  };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (config.signingKey) {
    Object.assign(headers, await signEdgeRequest({
      secret: config.signingKey,
      method,
      path,
      bodyBytes
    }));
  }

  let res;
  try {
    res = await fetch(`${config.base}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : bodyBytes,
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(
      new Error(timedOut ? 'Core did not respond in time' : 'Core is unreachable from the edge'),
      { status: 504, detail: error?.message || String(error) }
    );
  }

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('Core returned a non-JSON response'), { status: 502 }); }

  if (!res.ok) {
    // A 401/403 here means the Worker's own machine credential was rejected.
    // That is an edge misconfiguration, not the caller's fault, so it must not
    // surface to the client as their authorization failure.
    throw Object.assign(new Error(body?.error || `Core rejected the request (${res.status})`), {
      status: res.status === 401 || res.status === 403 ? 502 : res.status,
      detail: body?.code || null
    });
  }
  return body;
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

function toolError(id, message) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } };
}

// Core answers tools/list with every capability and raw tool it can currently
// resolve, plus diagnostics naming each upstream and the error text of any that
// failed. None of that belongs on a public response: the diagnostics can carry
// internal hostnames, and the raw tools are not part of the remote contract.
// Per-capability _meta is kept, because risk, execution and approval are what
// let a remote caller see that model3d.generate is spend-risk and budget-gated
// before it asks.
function restrictToolList(body) {
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return body;

  const exposed = tools.filter((tool) => REMOTE_CAPABILITIES.has(tool?.name));
  const meta = body.result._meta || {};
  return {
    ...body,
    result: {
      ...body.result,
      tools: exposed,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': meta['io.modelcontextprotocol/protocolVersion'] || MCP_VERSION,
        'mccluster/catalogVersion': meta['mccluster/catalogVersion'] ?? null,
        'mccluster/surface': 'remote-allowlist',
        'mccluster/exposedCapabilities': exposed.length,
        'mccluster/allowlistedCapabilities': REMOTE_CAPABILITIES.size
      }
    }
  };
}

export async function handleCoreMcp(request, env, user) {
  if (request.method !== 'POST') {
    return { status: 405, body: rpcError(null, -32601, 'POST only.') };
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return { status: 413, body: rpcError(null, -32600, 'Request body too large') };
  }

  let rpc;
  try { rpc = raw ? JSON.parse(raw) : {}; }
  catch { return { status: 400, body: rpcError(null, -32700, 'Invalid JSON') }; }

  const id = rpc?.id ?? null;
  const method = rpc?.method;
  const methodHeader = request.headers.get('mcp-method');
  if (methodHeader && methodHeader !== method) {
    return { status: 400, body: rpcError(id, -32600, 'MCP method header and body disagree') };
  }

  if (method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mccluster-core', version: '1.0.0' }
        }
      }
    };
  }

  if (method === 'notifications/initialized') return { status: 202, body: {} };
  if (method === 'ping') return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };

  if (!FORWARDED_METHODS.has(method)) {
    return { status: 400, body: rpcError(id, -32601, `Unsupported method: ${method}`) };
  }

  if (!user) {
    return { status: 401, body: rpcError(id, -32001, 'Authentication required') };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 503, body: rpcError(id, -32002, 'McCluster is not configured') };
  }
  if (!await isHouseOwner(env, user)) {
    return { status: 403, body: rpcError(id, -32003, 'McCluster house owner access required') };
  }

  // Enforced before dispatch, so a name outside the allowlist never reaches
  // Core at all. Raw provider-namespaced tools fail here by construction.
  if (method === 'tools/call') {
    const name = rpc?.params?.name;
    if (!REMOTE_CAPABILITIES.has(name)) {
      return {
        status: 200,
        body: toolError(id, `Capability is not exposed to remote clients: ${name ?? '(missing name)'}`)
      };
    }
  }

  try {
    const forwarded = { jsonrpc: '2.0', id, method, params: rpc?.params ?? {} };
    const body = await callBroker(env, { path: '/mcp', payload: forwarded });
    return { status: 200, body: method === 'tools/list' ? restrictToolList(body) : body };
  } catch (error) {
    return {
      status: error.status || 502,
      body: rpcError(id, -32003, error.message || 'Core MCP dispatch failed', error.detail || undefined)
    };
  }
}

// Owner-only reachability probe. Core's own /health is unauthenticated on
// loopback, but exposing it through the edge would leak the upstream inventory
// to anyone, so this stays behind the same gate as the MCP surface.
export async function handleCoreStatus(request, env, user) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 503, body: { error: 'McCluster is not configured' } };
  }
  if (!user) return { status: 401, body: { error: 'Authentication required' } };
  if (!await isHouseOwner(env, user)) {
    return { status: 403, body: { error: 'McCluster house owner access required' } };
  }

  try {
    const health = await callBroker(env, { path: '/health', method: 'GET' });
    return {
      status: 200,
      body: {
        ok: true,
        bridge: 'core-mcp/v1',
        mcp: '/v1/core/mcp',
        protocol_version: MCP_VERSION,
        signed_dispatch: Boolean(env.CORE_EDGE_SIGNING_KEY),
        core: health
      }
    };
  } catch (error) {
    return {
      status: error.status || 502,
      body: { ok: false, bridge: 'core-mcp/v1', error: error.message, detail: error.detail || null }
    };
  }
}
