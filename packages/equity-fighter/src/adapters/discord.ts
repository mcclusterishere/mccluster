/* Discord, through the official Interactions endpoint (HTTP, Ed25519
   signed) and a global slash command `/ask message:<text>`.
   https://discord.com/developers/docs/interactions/overview
   The reply is a deferred response followed by the interaction webhook;
   interaction tokens last 15 minutes, so a late job result falls back to a
   channel message with the bot token when one is configured. */

import { ed25519Verify } from '../crypto.js';
import { WebhookAuthError, type ChannelAdapter, type InboundMessage, type ParseResult } from '../types.js';
import { clip, jsonResponse, parseJsonBody, readRawBody } from './util.js';

export interface DiscordConfig {
  applicationId: string;
  publicKey: string;
  botToken?: string;
}

const MAX_TEXT = 1900;
const API = 'https://discord.com/api/v10';

/** The command definition to register once (PUT /applications/{id}/commands). */
export const ASK_COMMAND = {
  name: 'ask',
  description: 'Ask Equity Fighter (McCluster harness)',
  type: 1,
  options: [{ type: 3, name: 'message', description: 'What you want', required: true }],
} as const;

export function createDiscordAdapter(config: DiscordConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): ChannelAdapter {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  return {
    platform: 'discord',
    implemented: true,
    async handleWebhook(request): Promise<ParseResult> {
      if (request.method !== 'POST') return { kind: 'respond', response: new Response('Method not allowed', { status: 405 }) };
      const raw = await readRawBody(request);
      const signature = request.headers.get('x-signature-ed25519') || '';
      const timestamp = request.headers.get('x-signature-timestamp') || '';
      const ok = signature && timestamp && (await ed25519Verify(config.publicKey, signature, new TextEncoder().encode(timestamp + raw)));
      if (!ok) throw new WebhookAuthError('Discord signature mismatch');
      const body = parseJsonBody(raw);
      if (body.type === 1) return { kind: 'respond', response: jsonResponse({ type: 1 }) };
      if (body.type !== 2 || body.data?.name !== ASK_COMMAND.name) return { kind: 'ignore', reason: 'not the /ask command' };
      const option = Array.isArray(body.data.options) ? body.data.options.find((o: any) => o?.name === 'message') : null;
      const text = String(option?.value || '').trim();
      const userId = String(body.member?.user?.id || body.user?.id || '');
      if (!text || !userId) return { kind: 'ignore', reason: 'empty /ask' };
      const message: InboundMessage = {
        platform: 'discord',
        externalEventId: String(body.id),
        platformUserId: userId,
        text,
        reply: {
          platform: 'discord',
          conversationId: String(body.application_id || config.applicationId),
          threadId: String(body.token),
          extra: { channelId: String(body.channel_id || body.channel?.id || '') },
        },
        receivedAt: new Date(now()).toISOString(),
      };
      // Type 5: "thinking…", answered later through the interaction webhook.
      return { kind: 'messages', messages: [message], ack: jsonResponse({ type: 5 }) };
    },
    async send(address, reply) {
      const content = clip(reply.text, MAX_TEXT);
      const res = await doFetch(`${API}/webhooks/${encodeURIComponent(address.conversationId)}/${encodeURIComponent(address.threadId || '')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      });
      if (res.ok) return;
      const channelId = address.extra?.channelId;
      if ((res.status === 401 || res.status === 404) && config.botToken && channelId) {
        const fallback = await doFetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
          method: 'POST',
          headers: { authorization: `Bot ${config.botToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        });
        if (fallback.ok) return;
        throw new Error(`Discord channel message failed (${fallback.status})`);
      }
      throw new Error(`Discord interaction follow-up failed (${res.status})`);
    },
  };
}
