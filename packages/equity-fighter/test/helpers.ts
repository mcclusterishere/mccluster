import { loadConfig, type Env } from '../src/config.js';
import type { DispatchClient, DispatchView, ExecuteResult } from '../src/harness/dispatch.js';
import type { EquityNetClient, EquityNetTask } from '../src/harness/equitynet.js';
import type { Checkpoint } from '../src/agent/loop.js';
import type { GatewayStore, NewRun, RunPatch, RunRow, Trust } from '../src/harness/store.js';
import type { ChannelAdapter, DispatchOutcome, DispatchRequest, InboundMessage, OutboundReply, Platform, ReplyAddress } from '../src/types.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OWNER = '22222222-2222-4222-8222-222222222222';

/** Placeholder values only. Nothing here is, or looks like, a real credential. */
export function baseEnv(extra: Env = {}): Env {
  return {
    EQUITY_FIGHTER_ENABLED: 'true',
    MCCLUSTER_ORG_ID: ORG,
    EQUITY_FIGHTER_OWNER_USER_ID: OWNER,
    EQUITY_FIGHTER_OWNER_ACCESS_TOKEN: 'test-owner-session',
    EQUITY_FIGHTER_PAIRING_SECRET: 'test-pairing-secret-0123456789',
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SECRET_KEY: 'test-service-key',
    ...extra,
  };
}

export function slackEnv(extra: Env = {}): Env {
  return baseEnv({
    EQUITY_FIGHTER_SLACK_ENABLED: 'true',
    SLACK_BOT_TOKEN: 'test-slack-bot-token',
    SLACK_SIGNING_SECRET: 'test-slack-signing-secret',
    EQUITY_FIGHTER_SLACK_OWNER_IDS: 'UOWNER',
    ...extra,
  });
}

export class MemoryStore implements GatewayStore {
  identities = new Map<string, Trust>();
  messages: { id: string; platform: string; conversation_id: string; direction: string; external_msg_id?: string; content: string }[] = [];
  runs = new Map<string, RunRow & { closed?: boolean; intent?: string | null; capability?: string | null; decision_id?: string | null }>();
  private n = 0;

  steps = new Map<string, Checkpoint[]>();
  async loadSteps(runId: string) {
    return [...(this.steps.get(runId) ?? [])];
  }
  async saveStep(runId: string, cp: Checkpoint) {
    const list = (this.steps.get(runId) ?? []).filter((c) => c.seq !== cp.seq);
    list.push(cp);
    this.steps.set(runId, list.sort((a, b) => a.seq - b.seq));
  }
  async messageText(id: string) {
    return this.messages.find((m) => m.id === id)?.content ?? null;
  }
  async listStalledRuns(_olderThanMs: number, limit: number) {
    return [...this.runs.values()].filter((r) => r.status === 'received' && !r.closed).slice(0, limit).map((r) => ({ ...r }));
  }
  async trustOf(platform: Platform, id: string) {
    return this.identities.get(`${platform}:${id}`) ?? null;
  }
  async pair(_org: string, platform: Platform, id: string) {
    this.identities.set(`${platform}:${id}`, 'owner');
  }
  async recordInbound(_org: string, m: InboundMessage) {
    if (this.messages.some((x) => x.platform === m.platform && x.external_msg_id === m.externalEventId)) return null;
    const id = `msg-${++this.n}`;
    this.messages.push({ id, platform: m.platform, conversation_id: m.reply.conversationId, direction: 'inbound', external_msg_id: m.externalEventId, content: m.text });
    return { id };
  }
  async recordOutbound(_org: string, platform: Platform, conversationId: string, text: string) {
    this.messages.push({ id: `msg-${++this.n}`, platform, conversation_id: conversationId, direction: 'outbound', content: text });
  }
  async createRun(run: NewRun) {
    const id = `run-${++this.n}`;
    const row = {
      id,
      org_id: run.org_id,
      message_row_id: run.message_row_id,
      platform: run.platform,
      platform_user_id: run.platform_user_id,
      conversation_id: run.conversation_id,
      reply_address: run.reply_address,
      status: run.status,
      route: run.route ?? null,
      turn_id: run.turn_id ?? null,
      job_id: run.job_id ?? null,
      compute_task_id: run.compute_task_id ?? null,
      approval_id: run.approval_id ?? null,
      intent: run.intent ?? null,
      capability: run.capability ?? null,
      decision_id: run.decision_id ?? null,
      last_relay: null,
      closed: Boolean(run.closed),
    };
    this.runs.set(id, row);
    return { ...row };
  }
  async updateRun(id: string, patch: RunPatch) {
    const row = this.runs.get(id);
    if (!row) throw new Error('no run');
    Object.assign(row, patch);
  }
  async listOpenRuns(limit: number) {
    return [...this.runs.values()].filter((r) => !r.closed && (r.status === 'running' || r.status === 'awaiting_approval')).slice(0, limit).map((r) => ({ ...r }));
  }
  async latestAwaitingApproval(platform: Platform, id: string) {
    const all = [...this.runs.values()].filter((r) => r.platform === platform && r.platform_user_id === id && r.status === 'awaiting_approval' && !r.closed);
    return all.length ? { ...all[all.length - 1]! } : null;
  }
  async forgetConversation(platform: Platform, conversationId: string) {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => !(m.platform === platform && m.conversation_id === conversationId));
    return before - this.messages.length;
  }
  onlyRun() {
    const all = [...this.runs.values()];
    if (all.length !== 1) throw new Error(`expected one run, got ${all.length}`);
    return all[0]!;
  }
}

export class MockAdapter implements ChannelAdapter {
  readonly implemented = true;
  sent: { address: ReplyAddress; reply: OutboundReply }[] = [];
  constructor(readonly platform: Platform = 'slack') {}
  async handleWebhook(): Promise<never> {
    throw new Error('not used');
  }
  async send(address: ReplyAddress, reply: OutboundReply) {
    this.sent.push({ address, reply });
  }
}

export class MockDispatch implements DispatchClient {
  calls: DispatchRequest[] = [];
  gets: string[] = [];
  executes: string[] = [];
  views = new Map<string, DispatchView>();
  executeResult: ExecuteResult = { executed: false, status: 'pending', job_id: null, relay: 'Still waiting for your approval in Control. Nothing has started.' };
  constructor(public next: DispatchOutcome | ((r: DispatchRequest) => DispatchOutcome)) {}
  async dispatch(request: DispatchRequest) {
    this.calls.push(request);
    return typeof this.next === 'function' ? this.next(request) : this.next;
  }
  async get(turnId: string) {
    this.gets.push(turnId);
    return this.views.get(turnId) ?? { status: null, route: null, job: null, approval: null, answer: null, relay: null };
  }
  async execute(turnId: string) {
    this.executes.push(turnId);
    return this.executeResult;
  }
}

export class MockEquityNet implements EquityNetClient {
  enqueued: string[] = [];
  tasks = new Map<string, EquityNetTask>();
  async enqueueChat(prompt: string) {
    this.enqueued.push(prompt);
    const task = { id: `task-${this.enqueued.length}`, status: 'queued' };
    this.tasks.set(task.id, task);
    return task;
  }
  async readTask(id: string) {
    return this.tasks.get(id) ?? null;
  }
}

export function message(text: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: 'slack',
    externalEventId: `Ev-${Math.random().toString(36).slice(2)}`,
    platformUserId: 'UOWNER',
    text,
    reply: { platform: 'slack', conversationId: 'D123', threadId: '1700000000.0001' },
    receivedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

export function config(env: Env = slackEnv()) {
  return loadConfig(env);
}

/** A fetch mock that records calls and answers from a handler. */
export function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response('{"ok":true}', { status: 200 })) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let body: any = init.body;
    if (body instanceof Uint8Array) body = new TextDecoder().decode(body);
    try {
      body = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      /* keep raw */
    }
    calls.push({ url, init, body });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}
