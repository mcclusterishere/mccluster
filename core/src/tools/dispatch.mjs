/* ============================================================
   core.dispatch.* — THE DISPATCH LAYER'S TOOLS.

     core.dispatch.turn     one owner message -> classified, recorded,
                            then answered, clarified, run, held for
                            approval or refused.
     core.dispatch.get      read a dispatch turn with its live job,
                            approval and resident answer (poll this).
     core.dispatch.execute  start a turn the owner has approved in
                            Control. The database checks the approval.

   Reached over MCP only (the actor the signed edge stamps is required),
   as catalog capabilities dispatch.turn / dispatch.get /
   dispatch.execute. Contract: docs/control-plane/DISPATCH-LAYER.md
   ============================================================ */

import { readFileSync } from 'node:fs';
import { rest, enqueueJob } from '../supabase.mjs';
import { localAiChat } from '../compute/local-ai-client.mjs';
import { submitResidentAiTurn, getResidentAiTurn } from '../resident-ai.mjs';
import { relevantMemory } from '../resident-context.mjs';
import { dispatchTurn, getDispatch, executeDispatch, makeRpc } from '../dispatch/dispatch.mjs';

let catalogCache = null;
function loadCatalog() {
  if (!catalogCache) catalogCache = JSON.parse(readFileSync(new URL('../../capabilities/catalog.json', import.meta.url), 'utf8'));
  return catalogCache;
}

const ID = { type: 'string', description: 'UUID' };

export const DISPATCH_TOOLS = Object.freeze([
  {
    name: 'core.dispatch.turn', title: 'Dispatch an owner message',
    description: 'McCluster\'s conversational front end. Classifies one owner message with the routing table and the small resident model, records the routing decision (ai_context.dispatch_turns + ai_context.decisions) and then: answers (resident McCluster turn when thread_id is given), asks one clarifying question, runs an approval-free catalog capability or OVH runner job on Core, or files a pending owner approval for anything the catalog gates. Never sends outside messages, merges, deploys to production, spends or deletes. Owner session only. Idempotent on message_id.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'message_id', 'message'],
      properties: {
        org_id: ID,
        message_id: { ...ID, description: 'client-generated UUID for this message; a retry with the same id replays the recorded outcome' },
        message: { type: 'string', minLength: 1, maxLength: 12000 },
        thread_id: { ...ID, description: 'optional active ops_ai_threads id; conversational answers then come from a durable resident McCluster turn' },
        intent: { type: 'string', maxLength: 80, description: 'optional explicit route (a catalog capability id or job.<job_type>); skips classification but is gated exactly the same' },
        args: { type: 'object', description: 'optional structured arguments for the route; only names the route accepts are used, org_id is always set by dispatch' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.dispatch.get', title: 'Read a dispatch turn',
    description: 'Read one dispatch turn with its live ops_agent_jobs row, its control approval and its resident answer, plus a one-line relay for the conversation. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'turn_id'], properties: { org_id: ID, turn_id: ID }, additionalProperties: false },
  },
  {
    name: 'core.dispatch.execute', title: 'Start an approved dispatch',
    description: 'Start a dispatch turn that is waiting on approval, only if the owner has approved its control approval in Control, it has not expired and the request is byte-for-byte the one approved. Runs once; a second call starts nothing.',
    inputSchema: { type: 'object', required: ['org_id', 'turn_id'], properties: { org_id: ID, turn_id: ID }, additionalProperties: false },
  },
]);

/* The broker wires its capability registry in here once it exists, so a
   dispatched catalog route takes the same resolve/bind/fallback path an
   MCP tools/call does. Recursion into dispatch itself is refused. */
let capabilityCaller = null;
export function setDispatchCapabilityCaller(fn) {
  capabilityCaller = typeof fn === 'function' ? fn : null;
}

function guardedCapabilityCaller() {
  if (!capabilityCaller) return null;
  return (id, args, options) => {
    if (String(id).startsWith('dispatch.')) throw Object.assign(new Error('dispatch cannot route into itself'), { status: 400 });
    return capabilityCaller(id, args, options);
  };
}

export function dispatchDependencies(callTool, overrides = {}) {
  return {
    rpc: makeRpc(rest),
    chat: localAiChat,
    callTool,
    callCapability: guardedCapabilityCaller(),
    enqueue: enqueueJob,
    catalog: loadCatalog(),
    submitAnswer: submitResidentAiTurn,
    getAnswer: getResidentAiTurn,
    memory: relevantMemory,
    ...overrides,
  };
}

export async function callDispatchTool(name, args, options, deps) {
  if (name === 'core.dispatch.turn') return dispatchTurn(args, options, deps);
  if (name === 'core.dispatch.get') return getDispatch(args, options, deps);
  if (name === 'core.dispatch.execute') return executeDispatch(args, options, deps);
  throw Object.assign(new Error(`Unknown dispatch tool: ${name}`), { status: 404 });
}
