/* Equity Fighter shared types.

   Equity Fighter is a transport: it turns a platform webhook into one
   InboundMessage, asks the harness dispatch layer what to do with it, and
   turns the answer back into a platform reply. Nothing in this package
   executes work. */

export const PLATFORMS = [
  'slack',
  'telegram',
  'whatsapp',
  'discord',
  'msteams',
  'googlechat',
  'matrix',
  'signal',
  'imessage',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Where a reply goes. Opaque to everything except the adapter that made it. */
export interface ReplyAddress {
  platform: Platform;
  /** Slack channel, Telegram chat id, WhatsApp wa_id, Discord application id. */
  conversationId: string;
  /** Slack thread_ts, Telegram message id, Discord interaction token, etc. */
  threadId?: string;
  /** Anything else the adapter needs to answer (never a secret). */
  extra?: Record<string, string>;
}

export interface InboundMessage {
  platform: Platform;
  /** Platform-unique id of this event, used for idempotency. */
  externalEventId: string;
  /** Stable platform user id (Slack U…, Telegram numeric id, WhatsApp wa_id, Discord snowflake). */
  platformUserId: string;
  text: string;
  reply: ReplyAddress;
  receivedAt: string;
}

/** What a webhook parse produced. */
export type ParseResult =
  /** One or more messages. `ack` is the platform's required immediate answer (e.g. Discord deferred response). */
  | { kind: 'messages'; messages: InboundMessage[]; ack?: Response }
  /** Answer the platform directly (URL verification, ping, challenge). */
  | { kind: 'respond'; response: Response }
  /** A valid but irrelevant event (bot echo, edit, reaction). */
  | { kind: 'ignore'; reason: string };

export interface OutboundReply {
  text: string;
}

export interface AdapterStatus {
  platform: Platform;
  implemented: boolean;
  enabled: boolean;
  /** Why the adapter is off, or what it still needs. Never a secret value. */
  reason?: string;
}

export interface ChannelAdapter {
  readonly platform: Platform;
  readonly implemented: boolean;
  /** Verify the platform signature, then parse. Throws WebhookAuthError on a bad signature. */
  handleWebhook(request: Request): Promise<ParseResult>;
  send(address: ReplyAddress, reply: OutboundReply): Promise<void>;
}

export class WebhookAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'WebhookAuthError';
    this.status = status;
  }
}

/** The owner as the harness knows him: a house-org owner UUID. Never taken from a message. */
export interface OwnerActor {
  kind: 'owner';
  user_id: string;
  via: { platform: Platform; platform_user_id: string };
}

/* ---------------- Dispatch contract ----------------

   What dispatch.turn (harness dispatch layer, draft PR #843,
   docs/control-plane/DISPATCH-LAYER.md) answers with. Equity Fighter reads
   only these fields. */

export type DispatchDecision =
  /** The front-end model (or a resident turn) answered; nothing ran. */
  | 'answer'
  /** A required argument is missing; one question back. */
  | 'clarify'
  /** Never started from chat (production, outreach, destructive, spend, owner-only). */
  | 'refused'
  /** Gated by the catalog: a pending control_approvals row exists; nothing ran. */
  | 'approval'
  /** Approval-free catalog capability: started on Core (job queued or answered). */
  | 'run';

export interface DispatchOutcome {
  decision: DispatchDecision;
  schema?: string;
  turn_id?: string;
  intent?: string;
  capability?: string;
  tool?: string;
  reply?: string;
  job_id?: string;
  approval_id?: string;
  decision_id?: string;
  status?: string;
  error?: string;
  resident_turn_id?: string;
  result?: unknown;
}

export interface DispatchRequest {
  /** Deterministic per platform event, so a retry replays rather than re-runs. */
  message_id: string;
  message: string;
  actor: OwnerActor;
}
