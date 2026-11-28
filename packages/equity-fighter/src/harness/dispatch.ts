/* Equity Fighter's use of the harness dispatch layer (draft PR #843,
   docs/control-plane/DISPATCH-LAYER.md). The dispatch layer is the front
   router: the small resident model (qwen3:4b-instruct on the OVH Ollama
   adapter) plus a deterministic routing table classifies the message, the
   capability catalog gates it, and ai_context.dispatch_turns +
   ai_context.decisions (+ control_approvals when gated) are written in one
   transaction BEFORE anything runs. Equity Fighter does not copy any of
   that. It sends one message and reads back what happened.

     dispatch.turn     one owner message -> answer | clarify | run | approval | refused
     dispatch.get      poll a turn: live job, approval state, resident answer, relay line
     dispatch.execute  start a turn the owner approved in Control (the database
                       checks the approval, its expiry and its request hash)

   message_id is derived from (platform, platform event id), so a platform
   retry replays the recorded outcome instead of running anything twice. */

import { sha256Hex } from '../crypto.js';
import type { DispatchDecision, DispatchOutcome, DispatchRequest, OwnerActor } from '../types.js';
import { HarnessError, type HarnessClient } from './mcp-client.js';
import type { PolicyContext } from '../policy/approval-policy.js';

const BACKGROUND: PolicyContext = { ownerPresent: false, unattended: true };

export const DISPATCH_TOOLS = Object.freeze({ turn: 'dispatch.turn', get: 'dispatch.get', execute: 'dispatch.execute' });

export interface DispatchView {
  status: string | null;
  route: string | null;
  job: { status: string; output?: unknown; last_error?: string | null } | null;
  approval: { state: string } | null;
  answer: { status: string | null; content: string | null } | null;
  relay: string | null;
}

export interface ExecuteResult {
  executed: boolean;
  status: string | null;
  job_id: string | null;
  relay: string | null;
}

export interface DispatchClient {
  dispatch(request: DispatchRequest): Promise<DispatchOutcome>;
  get(turnId: string, actor: OwnerActor): Promise<DispatchView>;
  /** Policy must carry ownerConfirmed: the owner typed "go" in this turn. The harness re-checks the Control approval. */
  execute(turnId: string, actor: OwnerActor, policy: PolicyContext): Promise<ExecuteResult>;
}

const ROUTES: ReadonlySet<DispatchDecision> = new Set(['answer', 'clarify', 'refused', 'approval', 'run']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A stable UUID (version 5 layout, SHA-256 based) for one platform event. */
export async function messageIdFor(platform: string, externalEventId: string): Promise<string> {
  const h = (await sha256Hex(`equity-fighter:${platform}:${externalEventId}`)).slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Read dispatch.turn's answer in its documented shape; anything else is a fail-closed refusal. */
export function normalizeTurn(raw: unknown): DispatchOutcome {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const route = str(body.route) as DispatchDecision | undefined;
  if (!route || !ROUTES.has(route) || !str(body.turn_id)) {
    return { decision: 'refused', reply: 'The harness gave an answer I could not read, so I am treating it as not done.', result: { unreadable: true } };
  }
  const outcome: DispatchOutcome = { decision: route };
  for (const key of ['schema', 'turn_id', 'intent', 'capability', 'tool', 'reply', 'job_id', 'approval_id', 'decision_id', 'status', 'error', 'resident_turn_id'] as const) {
    const v = str(body[key]);
    if (v) outcome[key] = v;
  }
  if (body.result !== undefined && body.result !== null) outcome.result = body.result;
  // A run whose tool failed to start is reported as such, never as done.
  if (route === 'run' && outcome.status === 'failed' && !outcome.reply) outcome.reply = `That did not start${outcome.error ? `: ${outcome.error}` : '.'}`;
  return outcome;
}

export function createDispatchClient(harness: HarnessClient, opts: { orgId: string; threadId?: string }): DispatchClient {
  return {
    async dispatch(request) {
      const args: Record<string, unknown> = {
        org_id: opts.orgId,
        message_id: request.message_id,
        message: request.message.slice(0, 12000),
      };
      if (opts.threadId && UUID.test(opts.threadId)) args.thread_id = opts.threadId;
      try {
        return normalizeTurn(await harness.callTool(DISPATCH_TOOLS.turn, args, request.actor, { ownerPresent: true }));
      } catch (error) {
        const e = error as HarnessError;
        const notApplied = e?.code === 'DISPATCH_NOT_APPLIED' || e?.status === 503;
        const unknown = e?.status === 404 || /unknown (tool|capability)|not allowed remotely|not found/i.test(String(e?.message || ''));
        return {
          decision: 'refused',
          reply: unknown || notApplied
            ? 'The harness dispatch layer is not live yet, so I could not route that. Nothing was run.'
            : 'I could not reach the harness just now, so nothing was run. Try again in a minute.',
          result: { error: String(e?.message || error), code: e?.code ?? null, status: e?.status ?? null },
        };
      }
    },
    async get(turnId, actor) {
      const raw = (await harness.callTool(DISPATCH_TOOLS.get, { org_id: opts.orgId, turn_id: turnId }, actor, BACKGROUND)) as Record<string, any>;
      return {
        status: str(raw?.turn?.status) ?? null,
        route: str(raw?.turn?.route) ?? null,
        job: raw?.job && typeof raw.job === 'object' ? { status: String(raw.job.status || ''), output: raw.job.output, last_error: raw.job.last_error ?? null } : null,
        approval: raw?.approval && typeof raw.approval === 'object' ? { state: String(raw.approval.state || '') } : null,
        answer: raw?.answer && typeof raw.answer === 'object' ? { status: raw.answer.status ?? null, content: str(raw.answer.content) ?? null } : null,
        relay: str(raw?.relay) ?? null,
      };
    },
    async execute(turnId, actor, policy) {
      const raw = (await harness.callTool(DISPATCH_TOOLS.execute, { org_id: opts.orgId, turn_id: turnId }, actor, policy)) as Record<string, any>;
      return { executed: raw?.executed === true, status: str(raw?.status) ?? str(raw?.state) ?? null, job_id: str(raw?.job_id) ?? null, relay: str(raw?.relay) ?? null };
    },
  };
}
