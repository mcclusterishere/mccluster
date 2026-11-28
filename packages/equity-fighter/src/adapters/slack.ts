/* Slack, through the official Events API (HTTP request URL) and Web API
   chat.postMessage. Request signing: https://api.slack.com/authentication/verifying-requests-from-slack
   Scopes the app needs: app_mentions:read, im:history, chat:write. */

import { hmacSha256Hex, timingSafeEqual } from '../crypto.js';
import { WebhookAuthError, type ChannelAdapter, type InboundMessage, type OutboundReply, type ParseResult, type ReplyAddress } from '../types.js';
import { clip, expectOk, jsonResponse, parseJsonBody, readRawBody } from './util.js';

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
}

const MAX_SKEW_SECONDS = 60 * 5;
const MAX_TEXT = 3900;

export function createSlackAdapter(config: SlackConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): ChannelAdapter {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());

  async function verify(request: Request, raw: string): Promise<void> {
    const ts = request.headers.get('x-slack-request-timestamp') || '';
    const sig = request.headers.get('x-slack-signature') || '';
    const tsNum = Number(ts);
    if (!ts || !Number.isFinite(tsNum) || Math.abs(now() / 1000 - tsNum) > MAX_SKEW_SECONDS) throw new WebhookAuthError('Slack timestamp missing or stale');
    const expected = `v0=${await hmacSha256Hex(config.signingSecret, `v0:${ts}:${raw}`)}`;
    if (!timingSafeEqual(sig, expected)) throw new WebhookAuthError('Slack signature mismatch');
  }

  return {
    platform: 'slack',
    implemented: true,
    async handleWebhook(request): Promise<ParseResult> {
      if (request.method !== 'POST') return { kind: 'respond', response: new Response('Method not allowed', { status: 405 }) };
      const raw = await readRawBody(request);
      await verify(request, raw);
      const body = parseJsonBody(raw);
      if (body.type === 'url_verification') return { kind: 'respond', response: jsonResponse({ challenge: String(body.challenge || '') }) };
      if (body.type !== 'event_callback') return { kind: 'ignore', reason: `slack ${body.type || 'unknown'} payload` };
      const event = body.event || {};
      if (event.bot_id || event.subtype) return { kind: 'ignore', reason: 'bot echo or message subtype' };
      const direct = event.type === 'message' && event.channel_type === 'im';
      const mention = event.type === 'app_mention';
      if (!direct && !mention) return { kind: 'ignore', reason: `slack event ${event.type}` };
      const text = String(event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text || !event.user || !body.event_id) return { kind: 'ignore', reason: 'empty slack message' };
      const message: InboundMessage = {
        platform: 'slack',
        externalEventId: String(body.event_id),
        platformUserId: String(event.user),
        text,
        reply: { platform: 'slack', conversationId: String(event.channel), threadId: String(event.thread_ts || event.ts || ''), extra: { team: String(body.team_id || '') } },
        receivedAt: new Date(now()).toISOString(),
      };
      return { kind: 'messages', messages: [message] };
    },
    async send(address: ReplyAddress, reply: OutboundReply) {
      const res = await doFetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.botToken}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: address.conversationId, text: clip(reply.text, MAX_TEXT), ...(address.threadId ? { thread_ts: address.threadId } : {}) }),
      });
      const body = await expectOk(res, 'Slack chat.postMessage');
      if (body?.ok !== true) throw new Error(`Slack chat.postMessage error: ${body?.error || 'unknown'}`);
    },
  };
}
