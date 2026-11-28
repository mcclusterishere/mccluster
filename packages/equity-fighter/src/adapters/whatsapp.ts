/* WhatsApp, through Meta's official WhatsApp Business Cloud API only (no
   WhatsApp Web automation). Webhook verification (hub.challenge) and
   X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the Meta app
   secret). https://developers.facebook.com/docs/whatsapp/cloud-api
   Free-form replies are only allowed inside the 24-hour customer service
   window that the owner's own message opens. */

import { hmacSha256Hex, timingSafeEqual } from '../crypto.js';
import { WebhookAuthError, type ChannelAdapter, type InboundMessage, type ParseResult } from '../types.js';
import { clip, expectOk, parseJsonBody, readRawBody, textResponse } from './util.js';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
}

const MAX_TEXT = 4000;

export function createWhatsAppAdapter(config: WhatsAppConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): ChannelAdapter {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  return {
    platform: 'whatsapp',
    implemented: true,
    async handleWebhook(request): Promise<ParseResult> {
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token') || '';
        const challenge = url.searchParams.get('hub.challenge') || '';
        if (mode === 'subscribe' && timingSafeEqual(token, config.verifyToken)) return { kind: 'respond', response: textResponse(challenge) };
        throw new WebhookAuthError('WhatsApp verify token mismatch', 403);
      }
      if (request.method !== 'POST') return { kind: 'respond', response: new Response('Method not allowed', { status: 405 }) };
      const raw = await readRawBody(request);
      const sig = request.headers.get('x-hub-signature-256') || '';
      const expected = `sha256=${await hmacSha256Hex(config.appSecret, raw)}`;
      if (!timingSafeEqual(sig, expected)) throw new WebhookAuthError('WhatsApp signature mismatch');
      const body = parseJsonBody(raw);
      if (body.object !== 'whatsapp_business_account') return { kind: 'ignore', reason: 'not a WhatsApp Business payload' };
      const messages: InboundMessage[] = [];
      for (const entry of Array.isArray(body.entry) ? body.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
          const value = change?.value || {};
          if (String(value.metadata?.phone_number_id || '') !== config.phoneNumberId) continue;
          for (const m of Array.isArray(value.messages) ? value.messages : []) {
            if (m?.type !== 'text' || typeof m.text?.body !== 'string' || !m.from || !m.id) continue;
            const text = m.text.body.trim();
            if (!text) continue;
            messages.push({
              platform: 'whatsapp',
              externalEventId: String(m.id),
              platformUserId: String(m.from),
              text,
              reply: { platform: 'whatsapp', conversationId: String(m.from), threadId: String(m.id) },
              receivedAt: new Date(now()).toISOString(),
            });
          }
        }
      }
      return messages.length ? { kind: 'messages', messages } : { kind: 'ignore', reason: 'status update or non-text message' };
    },
    async send(address, reply) {
      const res = await doFetch(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: address.conversationId,
          type: 'text',
          text: { preview_url: false, body: clip(reply.text, MAX_TEXT) },
          ...(address.threadId ? { context: { message_id: address.threadId } } : {}),
        }),
      });
      await expectOk(res, 'WhatsApp Cloud API send');
    },
  };
}
