// McCluster generative-media MCP surface. All generation paths re-enter the
// canonical REST handlers so org authorization, budgets, provider costs and
// asset lineage have one implementation.
//
// Wire protocol is MCP 2026-07-28, Streamable HTTP, stateless: no
// initialize/notifications/initialized handshake, no Mcp-Session-Id, no GET
// stream. Routing fields are mirrored into Mcp-Method / Mcp-Name headers and
// the server rejects a header that disagrees with the body, so a gateway
// routing on the header and this server executing on the body can never act
// on different requests. supabase/functions/inbox/mcp.ts is the same protocol
// in the outbound direction.

import { createGeneration, getGeneration, listModels } from './router.js';
import { createBakeoff } from './orchestrator.js';
import { recommendModels } from './recommend.js';

export const MCP_VERSION = '2026-07-28';

const SERVER_NAME = 'mccluster-media';
const SERVER_VERSION = '1.0.0';
const TOOLS_TTL_MS = 300_000;

const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

// Only tools/call, resources/read and prompts/get carry Mcp-Name.
const NAMED_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);

function semanticTool(name, title, description, extra = {}) {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      required: ['org_id', 'prompt'],
      properties: {
        org_id: { type: 'string' },
        prompt: { type: 'string' },
        budget_cents: { type: 'number', minimum: 0 },
        preference: { type: 'string', enum: ['quality', 'balanced', 'speed', 'price'] },
        ...extra,
      },
    },
  };
}

// `references` is only advertised where a registered model can actually
// consume one. Audio and 3D have no reference-taking route in the
// catalogue, and advertising an input nothing can honour is the same defect
// as advertising a capability nothing implements.
const REFERENCES = { references: { type: 'array' } };

const TOOLS = [
  {
    name: 'media.models.search',
    title: 'Search media models',
    description: 'List enabled generative-media models in the McCluster registry, optionally filtered by capability or provider.',
    inputSchema: { type: 'object', properties: { capability: { type: 'string' }, provider: { type: 'string' } } }
  },
  {
    name: 'media.recommend',
    title: 'Recommend a model',
    description: 'Rank candidate models for a capability against required features and a quality/speed/price preference.',
    inputSchema: {
      type: 'object',
      required: ['capability'],
      properties: {
        capability: { type: 'string' },
        preference: { type: 'string', enum: ['quality', 'balanced', 'speed', 'price'] },
        required: {
          type: 'object',
          properties: {
            reference_images: { type: 'boolean' },
            first_last_frame: { type: 'boolean' },
            native_audio: { type: 'boolean' },
            commercial_use: { type: 'boolean' }
          }
        },
        top_k: { type: 'integer' }
      }
    }
  },
  {
    name: 'media.generate',
    title: 'Generate media',
    description: 'Submit a tracked generation job to one model using the existing budget, cost and lineage controls.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'model_id'],
      properties: {
        org_id: { type: 'string' },
        model_id: { type: 'string' },
        prompt: { type: 'string' },
        input: { type: 'object' },
        budget_cents: { type: 'number' },
        strategy: { type: 'string' }
      }
    }
  },
  semanticTool('image.generate', 'Generate image', 'Provider-independent tracked image generation.', REFERENCES),
  semanticTool('video.generate', 'Generate video', 'Provider-independent tracked video generation.', {
    ...REFERENCES,
    duration_seconds: { type: 'number', minimum: 0 },
    aspect_ratio: { type: 'string' }
  }),
  semanticTool('audio.generate', 'Generate audio', 'Provider-independent tracked audio generation from a text prompt.'),
  semanticTool('model3d.generate', 'Generate 3D model', 'Provider-independent tracked 3D generation returning a GLB engine asset.'),
  {
    name: 'media.compare',
    title: 'Director Compare',
    description: 'Fan the same prompt/input out to 2-5 models as one tracked bakeoff run.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'model_ids'],
      properties: {
        org_id: { type: 'string' },
        model_ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
        prompt: { type: 'string' },
        input: { type: 'object' },
        budget_cents: { type: 'number' }
      }
    }
  },
  {
    name: 'media.job.get',
    title: 'Get media job',
    description: 'Fetch one job including status, costs, provider result and asset lineage.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'job_id'],
      properties: { org_id: { type: 'string' }, job_id: { type: 'string' } }
    }
  }
];

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function synthetic(request, { method = 'GET', path, query, body } = {}) {
  const url = new URL(request.url);
  if (path) url.pathname = path;
  url.search = '';
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const init = { method, headers: request.headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

function hasReferences(args) {
  return Array.isArray(args.references) && args.references.length > 0;
}

function capabilityForSemanticTool(name, args) {
  if (name === 'image.generate') return hasReferences(args) ? 'image-to-image' : 'text-to-image';
  if (name === 'video.generate') return hasReferences(args) ? 'image-to-video' : 'text-to-video';
  if (name === 'audio.generate') return 'text-to-audio';
  if (name === 'model3d.generate') return 'text-to-3d';
  return null;
}

/** Coerce a value to what the chosen model's own parameter_schema accepts.
 *
 *  The text-to-video route declares `duration` as the string enum
 *  ["5","10"] with additionalProperties:false, while the tool takes
 *  `duration_seconds` as a number — so passing the number straight through
 *  is a provider rejection raised only after the job row and its cost
 *  reservation already exist. Where the model declares an enum, match it or
 *  say which values are allowed, rather than submitting a doomed request. */
function coerceToSchema(model, field, value) {
  const allowed = model?.parameter_schema?.properties?.[field]?.enum;
  if (!Array.isArray(allowed) || !allowed.length) return value;
  const match = allowed.find((option) => String(option) === String(value));
  if (match === undefined) {
    throw Object.assign(
      new Error(`${field} must be one of ${allowed.map((o) => JSON.stringify(o)).join(', ')} for ${model.display_name || model.provider_model_id}`),
      { status: 400 }
    );
  }
  return match;
}

function providerInputForSemanticTool(name, args, model) {
  const input = { prompt: args.prompt };
  if (name === 'video.generate') {
    if (args.duration_seconds !== undefined) input.duration = coerceToSchema(model, 'duration', args.duration_seconds);
    if (args.aspect_ratio) input.aspect_ratio = coerceToSchema(model, 'aspect_ratio', args.aspect_ratio);
  }
  if (hasReferences(args)) {
    const first = args.references[0];
    const url = typeof first === 'string' ? first : first?.url;
    if (url) input.image_url = url;
  }
  return input;
}

async function semanticGenerate(name, args, request, env, user) {
  if (!args.org_id || !args.prompt) throw Object.assign(new Error('org_id and prompt are required'), { status: 400 });
  const capability = capabilityForSemanticTool(name, args);
  const recommended = await recommendModels(synthetic(request, {
    method: 'POST',
    body: {
      capability,
      preference: args.preference || 'quality',
      required: {
        commercial_use: true,
        reference_images: hasReferences(args)
      },
      top_k: 1
    }
  }), env);
  const model = recommended?.candidates?.[0]?.model;
  if (!model?.id) throw Object.assign(new Error(`No enabled model is registered for ${capability}`), { status: 503 });

  const job = await createGeneration(synthetic(request, {
    method: 'POST',
    body: {
      org_id: args.org_id,
      model_id: model.id,
      prompt: args.prompt,
      input: providerInputForSemanticTool(name, args, model),
      budget_cents: args.budget_cents,
      strategy: `semantic:${name}`
    }
  }), env, user);

  return textResult({ capability: name, routed_capability: capability, model, job });
}

async function callTool(name, args, request, env, user) {
  switch (name) {
    case 'media.models.search':
      return textResult({ models: await listModels(synthetic(request, { path: '/v1/media/models', query: args }), env) });
    case 'media.recommend':
      return textResult(await recommendModels(synthetic(request, { method: 'POST', body: args }), env));
    case 'media.generate':
      return textResult({ job: await createGeneration(synthetic(request, { method: 'POST', body: args }), env, user) });
    case 'image.generate':
    case 'video.generate':
    case 'audio.generate':
    case 'model3d.generate':
      return semanticGenerate(name, args, request, env, user);
    case 'media.compare':
      return textResult(await createBakeoff(synthetic(request, { method: 'POST', body: args }), env, user));
    case 'media.job.get':
      if (!args.job_id) throw Object.assign(new Error('job_id is required'), { status: 400 });
      return textResult(await getGeneration(
        synthetic(request, { path: `/v1/media/jobs/${args.job_id}`, query: { org_id: args.org_id } }),
        env, user, args.job_id, true
      ));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 404 });
  }
}

// ============================================================
// WIRE VALIDATION
//
// Mcp-Name may arrive base64-wrapped when the name is not safely
// representable as an ASCII header value, so the server has to decode it
// before comparing against the body. The encoding side lives in
// supabase/functions/inbox/mcp.ts.
// ============================================================

const SENTINEL = /^=\?base64\?([\s\S]*)\?=$/;

function decodeHeaderValue(value) {
  const match = SENTINEL.exec(value);
  if (!match) return value;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function jsonRpcError(status, id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { status, body: { jsonrpc: '2.0', id, error } };
}

const headerMismatch = (id, detail) => jsonRpcError(400, id, -32020, `Header mismatch: ${detail}`);

function complete(result) {
  return {
    ...result,
    resultType: 'complete',
    _meta: { [META_SERVER_INFO]: { name: SERVER_NAME, version: SERVER_VERSION } }
  };
}

/** Reject any request whose mirrored headers disagree with its body.
 *
 *  Absence is treated differently from disagreement on purpose: a missing
 *  header is tolerated so clients this endpoint already serves keep
 *  working, but a header that contradicts the body — or names a protocol
 *  version this server does not implement — is refused, which is the whole
 *  point of mirroring them. */
function validateWire(request, rpc, id) {
  const method = rpc?.method;

  const versionHeader = request.headers.get('mcp-protocol-version');
  const bodyVersion = rpc?.params?._meta?.[META_PROTOCOL_VERSION];
  if (versionHeader && bodyVersion && versionHeader !== bodyVersion) {
    return headerMismatch(id, `MCP-Protocol-Version '${versionHeader}' does not match body '${bodyVersion}'`);
  }
  const declared = versionHeader || bodyVersion;
  if (declared && declared !== MCP_VERSION) {
    return jsonRpcError(400, id, -32022, `Unsupported protocol version '${declared}'.`, { supported: [MCP_VERSION] });
  }

  const methodHeader = request.headers.get('mcp-method');
  if (methodHeader && methodHeader !== method) {
    return headerMismatch(id, `Mcp-Method '${methodHeader}' does not match body method '${method}'`);
  }

  if (NAMED_METHODS.has(method)) {
    const nameHeader = request.headers.get('mcp-name');
    if (nameHeader) {
      const decoded = decodeHeaderValue(nameHeader);
      if (decoded === null) return headerMismatch(id, 'Mcp-Name is not validly base64-encoded');
      const bodyName = rpc?.params?.name ?? rpc?.params?.uri;
      if (decoded !== bodyName) {
        return headerMismatch(id, `Mcp-Name '${decoded}' does not match body name '${bodyName}'`);
      }
    }
  }

  return null;
}

export async function handleMediaMcp(request, env, user) {
  if (request.method !== 'POST') {
    return jsonRpcError(405, null, -32601, 'POST only.');
  }

  let rpc;
  try { rpc = await request.json(); }
  catch { return jsonRpcError(400, null, -32700, 'Invalid JSON'); }

  // A JSON-RPC message with no id is a notification: it gets 202 and no
  // body, never a response object.
  if (rpc && typeof rpc === 'object' && !Array.isArray(rpc) && !('id' in rpc) && rpc.method) {
    return { status: 202, body: undefined };
  }

  const id = rpc?.id ?? null;
  const method = rpc?.method;

  const invalid = validateWire(request, rpc, id);
  if (invalid) return invalid;

  // Version/capability discovery. Answered without a credential so a client
  // can negotiate before presenting one; it exposes no org data.
  if (method === 'server/discover') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: complete({
          protocolVersions: [MCP_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        })
      }
    };
  }

  if (method === 'tools/list') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: complete({ tools: TOOLS, ttlMs: TOOLS_TTL_MS, cacheScope: 'public' })
      }
    };
  }

  if (method === 'tools/call') {
    if (!user) return jsonRpcError(401, id, -32001, 'Authentication required');
    const name = rpc?.params?.name;
    const args = rpc?.params?.arguments || {};
    if (!TOOLS.some((tool) => tool.name === name)) {
      return { status: 200, body: { jsonrpc: '2.0', id, result: complete(errorResult(`Unknown tool: ${name}`)) } };
    }
    try {
      return { status: 200, body: { jsonrpc: '2.0', id, result: complete(await callTool(name, args, request, env, user)) } };
    } catch (error) {
      return { status: 200, body: { jsonrpc: '2.0', id, result: complete(errorResult(error.message || 'Tool call failed')) } };
    }
  }

  return jsonRpcError(404, id, -32601, `Method not found: ${method}`);
}
