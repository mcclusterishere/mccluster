/* ============================================================
   THE OPERATIONS MCP SURFACE.

   The same catalogue, spoken to models. A Claude, ChatGPT, Grok or
   local model pointed at this endpoint gets exactly the reach the
   owner has through the console and not one action more, because both
   go through runAction: same capability ladder, same estate
   containment, same approval requirement, same ledger row.

   The important consequence: a model can be given a token, discover
   `vps.reboot`, and still not be able to reboot anything. The tool is
   listed — hiding it would only mean the model asks a human to do it
   blind — but calling it without an owner-approved approval id comes
   back as a refusal explaining how to ask. Read and reversible work
   needs no ceremony; consequential work needs a human. That is the
   whole design, and here it is enforced by reusing the same function
   the REST route uses rather than by a second, weaker path.
   ============================================================ */

import { ACTION_LIST } from './catalog.js';
import { handleOpsRequest, runAction } from './router.js';
import { resolveActor } from './authority.js';
import { text } from './lib.js';

export const MCP_VERSION = '2026-07-28';

function toolFor(action) {
  const properties = { ...action.input };
  /* Every mutating tool advertises the two fields that make it safe to
     call: the approval it will need, and the key that makes a retry
     free. A model that cannot see them will not send them. */
  if (action.mutates) {
    properties.idempotency_key = { type: 'string', description: 'Stable key so a retry cannot run this twice.' };
  }
  if (action.capability === 'infra.mutate') {
    properties.approval_id = {
      type: 'string',
      description: 'Approval id from ops.approval.request, decided by a house owner. Required.'
    };
  }
  return {
    name: action.id,
    title: action.summary,
    description: [
      action.summary,
      `Capability: ${action.capability}.`,
      action.capability === 'infra.mutate'
        ? 'Consequential: a house owner must approve this exact request before it runs.'
        : action.mutates ? 'Reversible change. Written to the control ledger.' : 'Read-only.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties,
      ...(action.required?.length ? { required: action.required } : {}),
      additionalProperties: false
    }
  };
}

const REQUEST_APPROVAL = {
  name: 'ops.approval.request',
  title: 'Ask a house owner to approve one consequential action',
  description: 'Open an approval bound to one exact action and parameter set. A human decides it; nothing executes here.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      params: { type: 'object' },
      reason: { type: 'string' },
      ttl_seconds: { type: 'integer' }
    },
    required: ['action', 'reason'],
    additionalProperties: false
  }
};

export const OPS_TOOLS = Object.freeze([...ACTION_LIST.map(toolFor), REQUEST_APPROVAL]);

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message, detail) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, ...(detail ? { detail } : {}) }, null, 2) }],
    isError: true
  };
}

export async function handleOpsMcp(request, env) {
  if (request.method !== 'POST') {
    return { status: 405, body: { jsonrpc: '2.0', error: { code: -32601, message: 'POST only.' } } };
  }

  let rpc;
  try { rpc = await request.json(); }
  catch { return { status: 400, body: { jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON' } } }; }

  const id = rpc?.id ?? null;
  const method = request.headers.get('mcp-method') || rpc?.method;

  if (method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mccluster-operations', version: '1.0.0' }
        }
      }
    };
  }

  if (method === 'tools/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: OPS_TOOLS } } };
  }

  if (method === 'tools/call') {
    const name = text(rpc?.params?.name, 120);
    const args = rpc?.params?.arguments && typeof rpc.params.arguments === 'object' ? rpc.params.arguments : {};
    if (!OPS_TOOLS.some((tool) => tool.name === name)) {
      return { status: 200, body: { jsonrpc: '2.0', id, result: errorResult(`Unknown tool: ${name}`) } };
    }

    let actor;
    try {
      actor = await resolveActor(request, env);
    } catch (error) {
      return {
        status: 200,
        body: { jsonrpc: '2.0', id, result: errorResult(error.message || 'Authentication required', error.detail) }
      };
    }

    try {
      if (name === REQUEST_APPROVAL.name) {
        /* Deliberately routed back through the REST handler rather than
           reimplemented: the approval must be requested as the human
           whose token this is, and that logic lives in one place. */
        const url = new URL(request.url);
        url.pathname = '/v1/ops/approvals';
        url.search = '';
        const response = await handleOpsRequest(new Request(url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(args)
        }), env);
        return { status: 200, body: { jsonrpc: '2.0', id, result: textResult(await response.json()) } };
      }

      const run = await runAction(request, env, {
        actor,
        actionId: name,
        params: stripControlFields(args),
        idempotencyKey: text(args.idempotency_key, 200) || null,
        approvalId: text(args.approval_id, 40) || null,
        /* A model is not a human, and the ledger says so. `actor_kind`
           is what lets an audit separate what the owner did from what
           something acting on the owner's token did. */
        actorKind: 'model'
      });
      return { status: 200, body: { jsonrpc: '2.0', id, result: textResult(run.body) } };
    } catch (error) {
      return {
        status: 200,
        body: { jsonrpc: '2.0', id, result: errorResult(error.message || 'Action failed', error.detail) }
      };
    }
  }

  return { status: 400, body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported method: ${method}` } } };
}

function stripControlFields(args) {
  const { idempotency_key: _key, approval_id: _approval, ...params } = args;
  return params;
}
