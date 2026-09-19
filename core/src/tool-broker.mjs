import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCapabilityRegistry } from './capabilities/registry.mjs';
import { createToolRegistry } from './tools/registry.mjs';
import { createEdgeVerifier, DEFAULT_EDGE_CLOCK_SKEW_MS } from './broker-edge-auth.mjs';

const HOST = process.env.CORE_BROKER_HOST || '127.0.0.1';
const PORT = Number(process.env.CORE_BROKER_PORT || 4777);
const BODY_LIMIT = Number(process.env.CORE_BROKER_BODY_LIMIT || 1_048_576);
const EDGE_SIGNING_KEY = process.env.CORE_EDGE_SIGNING_KEY || '';
const EDGE_CLOCK_SKEW_MS = Number(process.env.CORE_EDGE_CLOCK_SKEW_MS || DEFAULT_EDGE_CLOCK_SKEW_MS);
const edgeVerifier = EDGE_SIGNING_KEY
  ? createEdgeVerifier({ secret: EDGE_SIGNING_KEY, maxClockSkewMs: EDGE_CLOCK_SKEW_MS })
  : null;
const registry = createToolRegistry();
const capabilities = createCapabilityRegistry({ toolRegistry: registry });

if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
  throw new Error('Core tool broker must bind to loopback');
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(payload);
}

function deployedRevision() {
  try {
    const parsed = JSON.parse(readFileSync('/opt/mccluster/core/.mccluster-deploy.json', 'utf8'));
    const sha = String(parsed?.commit_sha || '');
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function secretEqual(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Fail closed. This used to allow every request when CORE_BROKER_TOKEN was
// unset, which was survivable only while 4777 was unreachable from anywhere
// but the host itself. The moment the broker is published through a tunnel for
// the remote MCP bridge, an unconfigured broker must refuse service rather than
// serve Core's tool bus to whoever finds the hostname.
function authenticate(req, url, bodyBytes) {
  const token = process.env.CORE_BROKER_TOKEN;
  if (!token && !edgeVerifier) {
    throw Object.assign(
      new Error('Core tool broker authentication is not configured'),
      { status: 503, code: 'AUTH_NOT_CONFIGURED' }
    );
  }

  if (token) {
    const got = String(req.headers.authorization || '');
    const presented = got.startsWith('Bearer ') ? got.slice(7) : '';
    if (!secretEqual(presented, token)) {
      throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' });
    }
  }

  // When an edge signing key is configured the bearer alone is not enough:
  // every request must also carry a fresh, unreplayed signature over its own
  // body. Configured means required, so a stripped signature cannot downgrade
  // the hop back to a replayable shared secret.
  if (edgeVerifier) {
    edgeVerifier.verify({
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      bodyBytes
    });
  }
}

// The signed digest covers the exact bytes Core parses, so the body has to be
// buffered before authentication rather than streamed into JSON.parse.
async function readBody(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(bodyBytes) {
  const text = bodyBytes.toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function mcpText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function mcpToolList() {
  const [stable, raw] = await Promise.all([
    capabilities.asMcpTools(),
    registry.list()
  ]);
  const stableNames = new Set(stable.map((tool) => tool.name));
  const rawTools = raw.tools
    .filter((tool) => !stableNames.has(tool.name))
    .map(({ name, title, description, inputSchema, outputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
      ...(outputSchema ? { outputSchema } : {})
    }));
  return {
    tools: [...stable, ...rawTools],
    diagnostics: raw.diagnostics,
    stableCount: stable.length,
    rawCount: rawTools.length
  };
}

async function handleMcp(req, res, rpc) {
  const id = rpc?.id ?? null;
  const method = req.headers['mcp-method'] || rpc?.method;

  if (method === 'tools/list') {
    const listed = await mcpToolList();
    return json(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        tools: listed.tools,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'mccluster/catalogVersion': capabilities.catalogVersion,
          'mccluster/stableCapabilities': listed.stableCount,
          'mccluster/rawTools': listed.rawCount,
          'mccluster/diagnostics': listed.diagnostics
        }
      }
    });
  }

  if (method === 'tools/call') {
    const name = rpc?.params?.name;
    const args = rpc?.params?.arguments || {};
    try {
      const result = capabilities.has(name)
        ? await capabilities.call(name, args)
        : await registry.call(name, args);
      return json(res, 200, { jsonrpc: '2.0', id, result: mcpText(result) });
    } catch (error) {
      return json(res, 200, {
        jsonrpc: '2.0',
        id,
        result: {
          ...mcpText({ error: error.message, code: error.code ?? null, status: error.status ?? null }),
          isError: true
        }
      });
    }
  }

  return json(res, 400, {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unsupported method: ${method}` }
  });
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      // Liveness is public; inventory is not. /health used to answer every
      // caller with the upstream diagnostics, which name internal hosts and
      // carry the error text of failed upstreams. That was fine while 4777 was
      // loopback-only, but a reverse tunnel makes this hostname publicly
      // resolvable, and an unauthenticated detail payload here would hand out
      // exactly what the Worker strips from tools/list.
      let authenticated = false;
      try {
        authenticate(req, url, Buffer.alloc(0));
        authenticated = true;
      } catch {
        authenticated = false;
      }

      if (!authenticated) {
        return json(res, 200, {
          ok: true,
          service: 'mccluster-core-tool-broker',
          deployment_sha: deployedRevision()
        });
      }

      const [listedTools, listedCapabilities] = await Promise.all([
        registry.list(),
        capabilities.list()
      ]);
      const availableCapabilities = listedCapabilities.capabilities.filter((capability) => capability.available);
      return json(res, 200, {
        ok: true,
        service: 'mccluster-core-tool-broker',
        deployment_sha: deployedRevision(),
        catalog_version: listedCapabilities.catalogVersion,
        capabilities: {
          declared: listedCapabilities.capabilities.length,
          available: availableCapabilities.length
        },
        tools: listedTools.tools.length,
        transports: [...new Set(listedTools.tools.map((tool) => tool.transport))],
        upstreams: listedTools.diagnostics
      });
    }

    const bodyBytes = await readBody(req);
    authenticate(req, url, bodyBytes);

    if (url.pathname === '/v1/capabilities' && req.method === 'GET') {
      return json(res, 200, await capabilities.list({ force: url.searchParams.get('refresh') === '1' }));
    }

    if (url.pathname === '/v1/capabilities/resolve' && req.method === 'POST') {
      const body = parseJson(bodyBytes);
      if (!body.capability) return json(res, 400, { error: 'capability is required' });
      return json(res, 200, await capabilities.resolve(body.capability, {
        requirements: body.requirements || {},
        force: body.refresh === true
      }));
    }

    if (url.pathname === '/v1/capabilities/call' && req.method === 'POST') {
      const body = parseJson(bodyBytes);
      if (!body.capability) return json(res, 400, { error: 'capability is required' });
      return json(res, 200, await capabilities.call(
        body.capability,
        body.arguments || {},
        { requirements: body.requirements || {} }
      ));
    }

    if (url.pathname === '/v1/tools' && req.method === 'GET') {
      return json(res, 200, await registry.list({ force: url.searchParams.get('refresh') === '1' }));
    }

    if (url.pathname === '/v1/tools/call' && req.method === 'POST') {
      const body = parseJson(bodyBytes);
      if (!body.tool) return json(res, 400, { error: 'tool is required' });
      return json(res, 200, await registry.call(body.tool, body.arguments || {}));
    }

    if (url.pathname === '/mcp' && req.method === 'POST') {
      return handleMcp(req, res, parseJson(bodyBytes));
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    const status = Number(error.status || 500);
    return json(res, status, { error: error.message || 'Tool broker failure', code: error.code || null, detail: error.detail || null });
  } finally {
    console.log(JSON.stringify({
      event: 'core_tool_broker_request',
      method: req.method,
      path: url.pathname,
      duration_ms: Date.now() - startedAt
    }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'core_tool_broker_ready',
    host: HOST,
    port: PORT,
    pid: process.pid,
    capability_catalog: capabilities.catalogVersion
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'core_tool_broker_shutdown', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
