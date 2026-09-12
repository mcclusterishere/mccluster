// The media harness's own MCP surface — the "Agent interface" phase of
// docs/control-plane/GENERATIVE-MEDIA-HARNESS.md, made real.
//
// This is the SERVER half. supabase/functions/inbox/mcp.ts is the other
// direction entirely (McCluster calling OUT to a customer's building
// automation server); this file is McCluster answering IN, so a remote
// MCP client (Claude, or anything else that speaks the protocol) can
// drive generation, Director Compare, and job/lineage lookups.
//
// Same transport rules as the client half, because there is only one
// protocol in this codebase: 2026-07-28, stateless. No initialize
// handshake, no Mcp-Session-Id, no GET stream. One POST per call.
//
// Every tool here is a thin re-entry into the REST handlers in
// router.js/orchestrator.js/recommend.js. That keeps exactly one
// implementation of org membership, capability checks, budget
// enforcement, cost tracking and asset/lineage writes.

import { createGeneration, getGeneration, listModels } from './router.js';
import { createBakeoff } from './orchestrator.js';
import { recommendModels } from './recommend.js';

export const MCP_VERSION = '2026-07-28';

const TOOLS = [
  {
    name: 'media.models.search',
    title: 'Search media models',
    description: 'List enabled generative-media models in the McCluster registry, optionally filtered by capability or provider.',
    inputSchema: {
      type: 'object',
      properties: { capability: { type: 'string' }, provider: { type: 'string' } }
    }
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
        budget_cents: { type: 'number' }
      }
    }
  },
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

async function callTool(name, args, request, env, user) {
  switch (name) {
    case 'media.models.search':
      return textResult({ models: await listModels(synthetic(request, { path: '/v1/media/models', query: args }), env) });
    case 'media.recommend':
      return textResult(await recommendModels(synthetic(request, { method: 'POST', body: args }), env));
    case 'media.generate':
      return textResult({ job: await createGeneration(synthetic(request, { method: 'POST', body: args }), env, user) });
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

export async function handleMediaMcp(request, env, user) {
  if (request.method !== 'POST') {
    return { status: 405, body: { jsonrpc: '2.0', error: { code: -32601, message: 'POST only.' } } };
  }

  let rpc;
  try { rpc = await request.json(); }
  catch { return { status: 400, body: { jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON' } } }; }

  const id = rpc?.id ?? null;
  const method = request.headers.get('mcp-method') || rpc?.method;

  if (method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: TOOLS } } };
  }

  if (method === 'tools/call') {
    if (!user) return { status: 401, body: { jsonrpc: '2.0', id, error: { code: -32001, message: 'Authentication required' } } };
    const name = rpc?.params?.name;
    const args = rpc?.params?.arguments || {};
    if (!TOOLS.some((tool) => tool.name === name)) {
      return { status: 200, body: { jsonrpc: '2.0', id, result: errorResult(`Unknown tool: ${name}`) } };
    }
    try {
      return { status: 200, body: { jsonrpc: '2.0', id, result: await callTool(name, args, request, env, user) } };
    } catch (error) {
      return { status: 200, body: { jsonrpc: '2.0', id, result: errorResult(error.message || 'Tool call failed') } };
    }
  }

  return { status: 400, body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported method: ${method}` } } };
}
