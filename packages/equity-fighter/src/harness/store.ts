/* Supabase state for Equity Fighter (pending SQL:
   supabase/pending/20261125003000_equity_fighter_chat_v1.sql, NOT applied).

     ef_identities  who may talk to the agent: owner (allowlisted or paired)
                    or blocked, per platform user id. Revocable.
     ef_messages    inbound and outbound messages; (platform, external_msg_id)
                    is unique, which is the idempotency claim for platform
                    retries. Deletable by the owner (/forget).
     ef_runs        one row per request: the dispatch turn it became, its job,
                    approval and the reply address. relay() resumes open runs
                    after a crash or an approval wait.
     ef_steps       the agent loop's checkpoints (agent/loop.ts): one row per
                    finished step. Outputs hold ids and harness outcomes, not
                    message text, so /forget leaves nothing readable behind.

   Routing decisions and approvals are NOT stored here: the dispatch layer
   records them in ai_context.dispatch_turns, ai_context.decisions and
   public.control_approvals, and ef_runs only points at them. */

import type { InboundMessage, Platform, ReplyAddress } from '../types.js';
import type { Checkpoint, CheckpointStore } from '../agent/loop.js';

export type RunStatus =
  | 'received'
  | 'answered'
  | 'clarify'
  | 'refused'
  | 'running'
  | 'awaiting_approval'
  | 'done'
  | 'failed';

export interface RunRow {
  id: string;
  org_id: string;
  message_row_id?: string | null;
  platform: Platform;
  platform_user_id: string;
  conversation_id: string;
  reply_address: ReplyAddress;
  status: RunStatus;
  route: string | null;
  turn_id: string | null;
  job_id: string | null;
  compute_task_id: string | null;
  approval_id: string | null;
  last_relay?: string | null;
  created_at?: string;
}

export interface NewRun {
  org_id: string;
  message_row_id: string;
  platform: Platform;
  platform_user_id: string;
  conversation_id: string;
  reply_address: ReplyAddress;
  status: RunStatus;
  route?: string | null;
  intent?: string | null;
  capability?: string | null;
  turn_id?: string | null;
  job_id?: string | null;
  compute_task_id?: string | null;
  approval_id?: string | null;
  decision_id?: string | null;
  closed?: boolean;
}

export interface RunPatch {
  status?: RunStatus;
  route?: string | null;
  intent?: string | null;
  capability?: string | null;
  turn_id?: string | null;
  job_id?: string | null;
  compute_task_id?: string | null;
  approval_id?: string | null;
  decision_id?: string | null;
  closed?: boolean;
  last_relay?: string | null;
}

export type Trust = 'owner' | 'blocked';

export interface GatewayStore extends CheckpointStore {
  /** The stored text of one inbound message, or null once the owner used /forget. */
  messageText(messageRowId: string): Promise<string | null>;
  /** Runs still at 'received' after `olderThanMs`: the process died mid-loop. */
  listStalledRuns(olderThanMs: number, limit: number): Promise<RunRow[]>;
  trustOf(platform: Platform, platformUserId: string): Promise<Trust | null>;
  pair(orgId: string, platform: Platform, platformUserId: string): Promise<void>;
  /** Insert the inbound message once. Returns null for a duplicate delivery. */
  recordInbound(orgId: string, message: InboundMessage): Promise<{ id: string } | null>;
  recordOutbound(orgId: string, platform: Platform, conversationId: string, text: string): Promise<void>;
  createRun(run: NewRun): Promise<RunRow>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  /** Open runs (running or awaiting approval) to resume relaying. */
  listOpenRuns(limit: number): Promise<RunRow[]>;
  /** The newest run awaiting approval for this owner on this platform. */
  latestAwaitingApproval(platform: Platform, platformUserId: string): Promise<RunRow | null>;
  /** Delete this conversation's stored message content. Returns rows deleted. */
  forgetConversation(platform: Platform, conversationId: string): Promise<number>;
}

export interface SupabaseStoreConfig {
  url: string;
  serviceKey: string;
}

const RUN_COLUMNS = 'id,org_id,message_row_id,platform,platform_user_id,conversation_id,reply_address,status,route,turn_id,job_id,compute_task_id,approval_id,last_relay,created_at';

export function createSupabaseStore(config: SupabaseStoreConfig, fetchImpl: typeof fetch = fetch): GatewayStore {
  const base = String(config.url || '').replace(/\/+$/, '');
  if (!base || !config.serviceKey) throw new Error('Supabase URL and service key are required for Equity Fighter state');
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
    'content-type': 'application/json',
    ...extra,
  });
  async function rest(path: string, init: RequestInit): Promise<any> {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 200) };
    }
    if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} failed (${res.status}): ${body?.message || ''}`.slice(0, 400));
    return body;
  }
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

  return {
    async trustOf(platform, platformUserId) {
      const rows = await rest(
        `ef_identities?${q({ platform: `eq.${platform}`, platform_user_id: `eq.${platformUserId}`, revoked_at: 'is.null', select: 'trust', limit: '1' })}`,
        { method: 'GET', headers: headers() },
      );
      const trust = rows?.[0]?.trust;
      return trust === 'owner' || trust === 'blocked' ? trust : null;
    },
    async pair(orgId, platform, platformUserId) {
      await rest('ef_identities?on_conflict=platform,platform_user_id', {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ org_id: orgId, platform, platform_user_id: platformUserId, trust: 'owner', paired_at: new Date().toISOString(), revoked_at: null }),
      });
    },
    async recordInbound(orgId, message) {
      const rows = await rest('ef_messages?on_conflict=platform,external_msg_id', {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
        body: JSON.stringify({
          org_id: orgId,
          platform: message.platform,
          conversation_id: message.reply.conversationId,
          direction: 'inbound',
          external_msg_id: message.externalEventId,
          platform_user_id: message.platformUserId,
          content: message.text,
        }),
      });
      return Array.isArray(rows) && rows.length ? { id: String(rows[0].id) } : null;
    },
    async recordOutbound(orgId, platform, conversationId, text) {
      await rest('ef_messages', {
        method: 'POST',
        headers: headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ org_id: orgId, platform, conversation_id: conversationId, direction: 'outbound', content: text }),
      });
    },
    async createRun(run) {
      const rows = await rest(`ef_runs?select=${RUN_COLUMNS}`, {
        method: 'POST',
        headers: headers({ Prefer: 'return=representation' }),
        body: JSON.stringify({ ...run, closed_at: run.closed ? new Date().toISOString() : null, closed: undefined }),
      });
      if (!rows?.[0]) throw new Error('ef_runs insert returned nothing');
      return rows[0] as RunRow;
    },
    async updateRun(id, patch) {
      const { closed, ...rest_ } = patch;
      await rest(`ef_runs?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ ...rest_, ...(closed ? { closed_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }),
      });
    },
    async listOpenRuns(limit) {
      return (
        (await rest(
          `ef_runs?${q({ closed_at: 'is.null', status: 'in.(running,awaiting_approval)', select: RUN_COLUMNS, order: 'created_at.asc', limit: String(Math.max(1, Math.min(100, limit))) })}`,
          { method: 'GET', headers: headers() },
        )) || []
      );
    },
    async latestAwaitingApproval(platform, platformUserId) {
      const rows = await rest(
        `ef_runs?${q({ platform: `eq.${platform}`, platform_user_id: `eq.${platformUserId}`, status: 'eq.awaiting_approval', closed_at: 'is.null', select: RUN_COLUMNS, order: 'created_at.desc', limit: '1' })}`,
        { method: 'GET', headers: headers() },
      );
      return rows?.[0] ?? null;
    },
    async messageText(messageRowId) {
      const rows = await rest(`ef_messages?${q({ id: `eq.${messageRowId}`, select: 'content', limit: '1' })}`, { method: 'GET', headers: headers() });
      const content = rows?.[0]?.content;
      return typeof content === 'string' ? content : null;
    },
    async listStalledRuns(olderThanMs, limit) {
      const before = new Date(Date.now() - olderThanMs).toISOString();
      return (
        (await rest(
          `ef_runs?${q({ closed_at: 'is.null', status: 'eq.received', created_at: `lt.${before}`, select: RUN_COLUMNS, order: 'created_at.asc', limit: String(Math.max(1, Math.min(100, limit))) })}`,
          { method: 'GET', headers: headers() },
        )) || []
      );
    },
    async loadSteps(runId) {
      const rows = await rest(`ef_steps?${q({ run_id: `eq.${runId}`, select: 'seq,kind,status,output', order: 'seq.asc' })}`, { method: 'GET', headers: headers() });
      return (Array.isArray(rows) ? rows : []) as Checkpoint[];
    },
    async saveStep(runId, cp) {
      await rest('ef_steps?on_conflict=run_id,seq', {
        method: 'POST',
        headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ run_id: runId, seq: cp.seq, kind: cp.kind, status: cp.status, output: cp.output }),
      });
    },
    async forgetConversation(platform, conversationId) {
      const rows = await rest(`ef_messages?${q({ platform: `eq.${platform}`, conversation_id: `eq.${conversationId}`, select: 'id' })}`, {
        method: 'DELETE',
        headers: headers({ Prefer: 'return=representation' }),
      });
      return Array.isArray(rows) ? rows.length : 0;
    },
  };
}
