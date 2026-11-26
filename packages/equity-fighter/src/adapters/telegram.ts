/* Telegram, through the official Bot API with a webhook
   (setWebhook with secret_token; Telegram echoes it in
   X-Telegram-Bot-Api-Secret-Token). https://core.telegram.org/bots/api
   Private chats are accepted; in groups only messages starting with /ask. */

import { timingSafeEqual } from '../crypto.js';
import { WebhookAuthError, type ChannelAdapter, type InboundMessage, type ParseResult } from '../types.js';
import { clip, expectOk, parseJsonBody, readRawBody } from './util.js';

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
}

const MAX_TEXT = 4000;

export function createTelegramAdapter(config: TelegramConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): ChannelAdapter {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  return {
    platform: 'telegram',
    implemented: true,
    async handleWebhook(request): Promise<ParseResult> {
      if (request.method !== 'POST') return { kind: 'respond', response: new Response('Method not allowed', { status: 405 }) };
      const presented = request.headers.get('x-telegram-bot-api-secret-token') || '';
      if (!timingSafeEqual(presented, config.webhookSecret)) throw new WebhookAuthError('Telegram secret token mismatch');
      const update = parseJsonBody(await readRawBody(request));
      const msg = update.message;
      if (!msg || typeof msg.text !== 'string' || !msg.from || msg.from.is_bot) return { kind: 'ignore', reason: 'not a user text message' };
      const isPrivate = msg.chat?.type === 'private';
      let text = msg.text.trim();
      const ask = /^\/ask(?:@\w+)?\s+/i;
      if (!isPrivate) {
        if (!ask.test(text)) return { kind: 'ignore', reason: 'group message without /ask' };
      }
      text = text.replace(ask, '').trim();
      if (!text || /^\/start\b/i.test(text)) return { kind: 'ignore', reason: 'empty or /start' };
      const message: InboundMessage = {
        platform: 'telegram',
        externalEventId: String(update.update_id),
        platformUserId: String(msg.from.id),
        text,
        reply: { platform: 'telegram', conversationId: String(msg.chat.id), threadId: String(msg.message_id) },
        receivedAt: new Date(now()).toISOString(),
      };
      return { kind: 'messages', messages: [message] };
    },
    async send(address, reply) {
      const res = await doFetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: address.conversationId,
          text: clip(reply.text, MAX_TEXT),
          ...(address.threadId ? { reply_parameters: { message_id: Number(address.threadId), allow_sending_without_reply: true } } : {}),
        }),
      });
      const body = await expectOk(res, 'Telegram sendMessage');
      if (body?.ok !== true) throw new Error('Telegram sendMessage returned ok=false');
    },
  };
}
