/* The Equity Fighter gateway: webhook in, harness dispatch, reply out.

   Every turn, in order:
     1. Signature check (adapter). An unsigned request never gets further.
     2. Idempotency: the inbound message is inserted once into ef_messages;
        a platform retry stops here.
     3. Owner-only: the sender must be allowlisted or paired. A stranger
        gets no reply at all (answering a non-owner is itself an outside
        message). The only thing a stranger can do is present a valid
        pairing code minted for that exact account.
     4. Gateway commands (/help, /forget, go, /local) are handled here; they
        reach the harness only through the allowlisted tools.
     5. Everything else goes to dispatch.turn. The dispatch layer
        classifies, gates against the capability catalog and records
        ai_context.dispatch_turns + ai_context.decisions (+ a pending
        control_approvals row when gated) before anything runs.
     6. One reply on the platform the owner wrote from; an ef_runs row is
        the checkpoint relay() resumes from after a crash or approval wait.

   This file never picks a runner, never executes a capability and never
   approves anything. Approval happens in Control; "go" only asks
   dispatch.execute, which the database refuses unless that approval is
   approved, unexpired and for the same request hash. */

import { publicStatus, type GatewayConfig } from './config.js';
import type { DispatchClient } from './harness/dispatch.js';
import { messageIdFor } from './harness/dispatch.js';
import { chatText, type EquityNetClient } from './harness/equitynet.js';
import type { GatewayStore, NewRun, RunRow, RunStatus } from './harness/store.js';
import { DEFAULT_LIMITS, runLoop, type LoopLimits, type Step } from './agent/loop.js';
import { PAIR_COMMAND, verifyPairingCode } from './pairing.js';
import { jsonResponse } from './adapters/util.js';
import { PLATFORMS, WebhookAuthError, type ChannelAdapter, type DispatchOutcome, type InboundMessage, type OwnerActor, type Platform, type ReplyAddress } from './types.js';

export interface GatewayDeps {
  config: GatewayConfig;
  adapters: ReadonlyMap<Platform, ChannelAdapter>;
  store: GatewayStore;
  dispatch: DispatchClient;
  equitynet: EquityNetClient;
  /** Run work after the HTTP answer (Slack wants one within 3 s). Without it the work is awaited. */
  waitUntil?: (work: Promise<unknown>) => void;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  limits?: LoopLimits;
}

export interface Gateway {
  fetch(request: Request): Promise<Response>;
  handleMessage(message: InboundMessage): Promise<void>;
  relay(limit?: number): Promise<{ checked: number; relayed: number }>;
}

const LOCAL_PREFIX = /^(?:\/local\s+|local:\s*)/i;
const GO = /^\/?(?:go|start it|run it)[.!]?$/i;
const FORGET = /^\/forget\s*$/i;
const HELP = /^\/(?:help|start)\s*$/i;

export const HELP_TEXT = [
  'Equity Fighter, your McCluster chat layer.',
  'Just write what you want. The harness dispatch layer routes it: status, research, repo checks and plans run now; code builds, previews and paid generation wait for your approval in Control; merges, outreach, deletions, payments and site edits are refused.',
  'go: start the request you approved in Control.',
  '/local <question>: answer on your own compute (EquityNet).',
  '/forget: delete the messages stored for this conversation.',
].join('\n');

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function summarize(output: unknown, max = 1500): string {
  if (output == null) return 'It finished with no output.';
  if (typeof output === 'string') return output.slice(0, max);
  const o = output as Record<string, unknown>;
  const text = chatText(output) ?? [o.summary, o.reply, o.message].find((x) => typeof x === 'string');
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, max);
  const json = JSON.stringify(output);
  return json.length > max ? `${json.slice(0, max - 1)}…` : json;
}

/** The EquityNet signed receipt id a device result carries, if any. Verifying the
    signature is EquityNet's and Core's job today; doing it here is phase 3. */
export function receiptId(output: unknown): string | null {
  const o = (output && typeof output === 'object' ? output : {}) as Record<string, any>;
  const id = o.receipt?.id ?? o.receipt?.receipt_id ?? o.receipt_id ?? o.metadata?.receipt_id;
  return typeof id === 'string' && id.trim() ? id.trim().slice(0, 120) : null;
}

/** Where a fresh dispatch turn leaves its run, and whether relay() still owes the owner a result. */
export function runState(outcome: DispatchOutcome): { status: RunStatus; open: boolean } {
  switch (outcome.decision) {
    case 'approval':
      return { status: 'awaiting_approval', open: true };
    case 'run':
      if (outcome.status === 'failed') return { status: 'failed', open: false };
      return outcome.job_id ? { status: 'running', open: true } : { status: 'done', open: false };
    case 'answer':
      return outcome.resident_turn_id ? { status: 'running', open: true } : { status: 'answered', open: false };
    case 'clarify':
      return { status: 'clarify', open: false };
    case 'refused':
      return { status: 'refused', open: false };
  }
}

export function createGateway(deps: GatewayDeps): Gateway {
  const { config, adapters, store, dispatch, equitynet } = deps;
  const log = deps.log ?? (() => {});
  const limits = deps.limits ?? DEFAULT_LIMITS;

  function actorFor(platform: Platform, platformUserId: string): OwnerActor {
    return { kind: 'owner', user_id: config.ownerUserId, via: { platform, platform_user_id: platformUserId } };
  }

  async function say(platform: Platform, address: ReplyAddress, text: string): Promise<boolean> {
    const adapter = adapters.get(platform);
    if (!adapter) return false;
    try {
      await adapter.send(address, { text });
    } catch (error) {
      log('reply_failed', { platform, error: String((error as Error)?.message || error) });
      return false;
    }
    await store.recordOutbound(config.orgId, platform, address.conversationId, text).catch(() => {});
    return true;
  }

  async function isOwner(platform: Platform, platformUserId: string): Promise<boolean> {
    if (config.owners[platform]?.has(platformUserId)) return true;
    return (await store.trustOf(platform, platformUserId)) === 'owner';
  }

  function runFor(message: InboundMessage, messageRowId: string, extra: Partial<NewRun> & { status: RunStatus }): NewRun {
    return {
      org_id: config.orgId,
      message_row_id: messageRowId,
      platform: message.platform,
      platform_user_id: message.platformUserId,
      conversation_id: message.reply.conversationId,
      reply_address: message.reply,
      ...extra,
    };
  }

  function replyFor(outcome: DispatchOutcome): string {
    switch (outcome.decision) {
      case 'approval':
        return `${outcome.reply ? `${outcome.reply}\n` : ''}That needs your approval before anything runs${outcome.capability ? ` (${outcome.capability})` : ''}. Approve or deny it in Control: ${config.controlUrl}. Then reply "go" here.`;
      case 'run':
        if (outcome.status === 'failed') return outcome.reply || 'That did not start.';
        if (outcome.job_id) return outcome.reply || `Queued ${outcome.capability || 'that'} on McCluster Core. I'll send the result here.`;
        return outcome.reply || summarize(outcome.result);
      case 'answer':
        return outcome.reply || (outcome.resident_turn_id ? 'Thinking it over; I will reply here.' : 'I do not have an answer for that yet.');
      case 'clarify':
        return outcome.reply || 'Can you say a bit more about what you want?';
      case 'refused':
        return outcome.reply || 'That is not something I start from chat. Nothing was run.';
    }
  }

  async function ownerTurn(message: InboundMessage, messageRowId: string): Promise<void> {
    const { platform, reply: address } = message;
    const actor = actorFor(platform, message.platformUserId);
    const text = message.text.trim();

    if (HELP.test(text)) {
      await say(platform, address, HELP_TEXT);
      return;
    }
    if (FORGET.test(text)) {
      const n = await store.forgetConversation(platform, address.conversationId);
      log('forget', { platform, deleted: n });
      // Said without recording: the confirmation itself should not be a new stored message.
      await adapters.get(platform)?.send(address, { text: `Deleted ${n} stored message${n === 1 ? '' : 's'} for this conversation. Routing decisions stay in the harness audit trail.` }).catch(() => {});
      return;
    }
    if (GO.test(text)) {
      const run = await store.latestAwaitingApproval(platform, message.platformUserId);
      if (!run?.turn_id) {
        await say(platform, address, 'Nothing here is waiting on your approval.');
        return;
      }
      const result = await dispatch.execute(run.turn_id, actor, { ownerPresent: true, ownerConfirmed: true });
      if (result.executed) {
        await store.updateRun(run.id, { status: result.job_id ? 'running' : 'done', job_id: result.job_id, closed: !result.job_id, last_relay: result.relay });
      }
      await say(platform, address, result.relay || (result.executed ? 'Started on McCluster Core.' : 'It is not approved in Control yet, so nothing started.'));
      return;
    }
    if (LOCAL_PREFIX.test(text)) {
      const prompt = text.replace(LOCAL_PREFIX, '').trim();
      if (!prompt) {
        await say(platform, address, 'Tell me what to ask your own compute, like "/local summarize this week".');
        return;
      }
      const task = await equitynet.enqueueChat(prompt, actor);
      await store.createRun(runFor(message, messageRowId, { status: 'running', route: 'equitynet', intent: 'equitynet.chat', capability: 'ai.chat', compute_task_id: task.id }));
      await say(platform, address, 'Sent to your own compute (EquityNet). I will reply here with the answer.');
      return;
    }

    const run = await store.createRun(runFor(message, messageRowId, { status: 'received' }));
    await dispatchLoop(run, { messageRowId, externalEventId: message.externalEventId, text });
  }

  /* The dispatch path as a checkpointed loop: receive -> route -> record -> reply.
     relay() re-enters it for runs a crash left at 'received'. */
  interface LoopInput {
    messageRowId: string;
    externalEventId: string;
    text: string;
  }
  async function dispatchLoop(run: RunRow, input: LoopInput): Promise<void> {
    const actor = actorFor(run.platform, run.platform_user_id);
    const steps: Step<LoopInput>[] = [
      { kind: 'receive', run: async (i) => ({ message_row_id: i.messageRowId, external_event_id: i.externalEventId }) },
      {
        kind: 'route',
        run: async (i) => dispatch.dispatch({ message_id: await messageIdFor(run.platform, i.externalEventId), message: i.text, actor }),
      },
      {
        kind: 'record',
        run: async (_i, saved) => {
          const outcome = saved.route as DispatchOutcome;
          const { status, open } = runState(outcome);
          await store.updateRun(run.id, {
            status,
            route: outcome.decision,
            intent: outcome.intent ?? null,
            capability: outcome.capability ?? null,
            turn_id: outcome.turn_id ?? null,
            job_id: outcome.job_id ?? null,
            approval_id: outcome.approval_id ?? null,
            decision_id: outcome.decision_id ?? null,
            closed: !open,
          });
          return { status, open };
        },
      },
      {
        kind: 'reply',
        run: async (_i, saved) => {
          const text = replyFor(saved.route as DispatchOutcome);
          return { sent: await say(run.platform, run.reply_address, text) };
        },
      },
    ];
    await runLoop(run.id, steps, input, store, limits);
  }

  async function resumeStalled(olderThanMs = 60_000): Promise<number> {
    let resumed = 0;
    for (const run of await store.listStalledRuns(olderThanMs, 10)) {
      if (!adapters.has(run.platform)) continue;
      try {
        const steps = await store.loadSteps(run.id);
        const receive = steps.find((s) => s.kind === 'receive' && s.status === 'done')?.output as { message_row_id?: string; external_event_id?: string } | undefined;
        const messageRowId = receive?.message_row_id ?? run.message_row_id ?? '';
        const text = messageRowId ? await store.messageText(messageRowId) : null;
        if (!text || !receive?.external_event_id) {
          // Forgotten or never received: nothing to resume, nothing ran from this gateway.
          await store.updateRun(run.id, { status: 'failed', closed: true });
          continue;
        }
        await dispatchLoop(run, { messageRowId, externalEventId: receive.external_event_id, text });
        resumed += 1;
      } catch (error) {
        log('resume_failed', { platform: run.platform, error: String((error as Error)?.message || error) });
      }
    }
    return resumed;
  }

  async function handleMessage(message: InboundMessage): Promise<void> {
    const inbound = await store.recordInbound(config.orgId, message);
    if (!inbound) {
      log('duplicate', { platform: message.platform });
      return;
    }
    if (!(await isOwner(message.platform, message.platformUserId))) {
      const pair = message.text.trim().match(PAIR_COMMAND);
      if (pair && (await verifyPairingCode(config.pairingSecret, message.platform, message.platformUserId, pair[1] ?? ''))) {
        if ((await store.trustOf(message.platform, message.platformUserId)) === 'blocked') return;
        await store.pair(config.orgId, message.platform, message.platformUserId);
        log('paired', { platform: message.platform });
        await say(message.platform, message.reply, `Paired. This ${message.platform} account now reaches your McCluster harness.\n\n${HELP_TEXT}`);
        return;
      }
      log('unauthorized', { platform: message.platform });
      return;
    }
    try {
      await ownerTurn(message, inbound.id);
    } catch (error) {
      log('turn_failed', { platform: message.platform, error: String((error as Error)?.message || error) });
      await say(message.platform, message.reply, 'Something went wrong on my side, so nothing new was started. Try again in a minute.');
    }
  }

  async function relayOne(run: RunRow): Promise<boolean> {
    const platform = run.platform;
    const actor = actorFor(platform, run.platform_user_id);
    const finish = async (text: string, status: RunStatus) => {
      const sent = await say(platform, run.reply_address, text);
      if (sent) await store.updateRun(run.id, { status, closed: true, last_relay: text });
      return sent;
    };
    const note = async (text: string) => {
      if (!text || text === run.last_relay) return false;
      const sent = await say(platform, run.reply_address, text);
      if (sent) await store.updateRun(run.id, { last_relay: text });
      return sent;
    };

    if (run.compute_task_id) {
      const task = await equitynet.readTask(run.compute_task_id, actor);
      if (!task) return false;
      if (task.status === 'done') {
        const receipt = receiptId(task.output);
        const answer = chatText(task.output) ?? summarize(task.output);
        return finish(receipt ? `${answer}\n\nEquityNet receipt: ${receipt}` : answer, 'done');
      }
      if (task.status === 'failed' || task.status === 'cancelled') return finish(`Your compute could not answer (${task.status})${task.last_error ? `: ${String(task.last_error).slice(0, 300)}` : '.'}`, 'failed');
      return false;
    }
    if (!run.turn_id) return false;
    const view = await dispatch.get(run.turn_id, actor);
    if (view.answer?.content && view.answer.status !== 'running' && view.answer.status !== 'queued') return finish(view.answer.content, 'done');
    if (view.job) {
      if (view.job.status === 'done') return finish(`Done: ${summarize(view.job.output)}`, 'done');
      if (view.job.status === 'failed' || view.job.status === 'dead' || view.job.status === 'cancelled') {
        return finish(`That job ${view.job.status}${view.job.last_error ? `: ${String(view.job.last_error).slice(0, 300)}` : '.'}`, 'failed');
      }
      return false;
    }
    if (run.status === 'awaiting_approval') {
      const state = view.approval?.state;
      if (view.status === 'denied' || state === 'denied') return finish('You denied it in Control, so nothing ran.', 'refused');
      if (view.status === 'expired' || state === 'expired') return finish('The approval expired before it was decided. Nothing ran; ask again if you still want it.', 'refused');
      if (state === 'approved') return note('You approved it in Control. Reply "go" and I will start it.');
    }
    return false;
  }

  async function relay(limit = 25) {
    if (!config.enabled) return { checked: 0, relayed: 0 };
    let relayed = await resumeStalled();
    const runs = await store.listOpenRuns(limit);
    for (const run of runs) {
      if (!isPlatform(run.platform) || !adapters.has(run.platform)) continue;
      try {
        if (await relayOne(run)) relayed += 1;
      } catch (error) {
        log('relay_failed', { platform: run.platform, error: String((error as Error)?.message || error) });
      }
    }
    return { checked: runs.length, relayed };
  }

  async function fetchHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return jsonResponse(publicStatus(config));
    const match = url.pathname.match(/^\/webhooks\/([a-z]+)\/?$/);
    if (!match) return jsonResponse({ error: 'not found' }, 404);
    if (!config.enabled) return jsonResponse({ error: 'Equity Fighter is disabled' }, 503);
    const name = match[1] ?? '';
    const adapter = isPlatform(name) ? adapters.get(name) : undefined;
    if (!adapter) return jsonResponse({ error: 'platform not enabled' }, 404);
    try {
      const parsed = await adapter.handleWebhook(request);
      if (parsed.kind === 'respond') return parsed.response;
      if (parsed.kind === 'ignore') return jsonResponse({ ok: true, ignored: parsed.reason });
      const work = Promise.all(parsed.messages.map((m) => handleMessage(m))).catch((error) => log('turn_failed', { error: String(error?.message || error) }));
      if (deps.waitUntil) deps.waitUntil(work);
      else await work;
      return parsed.ack ?? jsonResponse({ ok: true });
    } catch (error) {
      if (error instanceof WebhookAuthError) {
        log('webhook_rejected', { platform: name, status: error.status });
        return jsonResponse({ error: error.message }, error.status);
      }
      log('webhook_error', { platform: name, error: String((error as Error)?.message || error) });
      return jsonResponse({ error: 'internal error' }, 500);
    }
  }

  return { fetch: fetchHandler, handleMessage, relay };
}
