import { describe, expect, it } from 'vitest';
import { createSlackAdapter } from '../src/adapters/slack.js';
import { createTelegramAdapter } from '../src/adapters/telegram.js';
import { createWhatsAppAdapter } from '../src/adapters/whatsapp.js';
import { createDiscordAdapter } from '../src/adapters/discord.js';
import { createPlannedAdapter } from '../src/adapters/planned.js';
import { hmacSha256Hex, toHex } from '../src/crypto.js';
import { WebhookAuthError } from '../src/types.js';
import { mockFetch } from './helpers.js';

const NOW = 1_764_000_000_000;

async function slackRequest(body: object, secret = 'test-slack-signing-secret', ts = Math.floor(NOW / 1000)) {
  const raw = JSON.stringify(body);
  const sig = `v0=${await hmacSha256Hex(secret, `v0:${ts}:${raw}`)}`;
  return new Request('https://ef.example.test/webhooks/slack', { method: 'POST', body: raw, headers: { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig } });
}

describe('Slack (Events API)', () => {
  const f = mockFetch(() => new Response('{"ok":true}'));
  const slack = createSlackAdapter({ botToken: 'test-slack-bot-token', signingSecret: 'test-slack-signing-secret' }, { fetch: f.fn, now: () => NOW });

  it('answers url_verification', async () => {
    const r = await slack.handleWebhook(await slackRequest({ type: 'url_verification', challenge: 'abc' }));
    expect(r.kind).toBe('respond');
    if (r.kind === 'respond') expect(await r.response.json()).toEqual({ challenge: 'abc' });
  });

  it('rejects a bad signature and a stale timestamp', async () => {
    await expect(slack.handleWebhook(await slackRequest({ type: 'event_callback' }, 'wrong-secret'))).rejects.toBeInstanceOf(WebhookAuthError);
    await expect(slack.handleWebhook(await slackRequest({ type: 'event_callback' }, undefined, Math.floor(NOW / 1000) - 600))).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it('parses a DM and a mention, ignores bot echoes', async () => {
    const dm = await slack.handleWebhook(await slackRequest({ type: 'event_callback', event_id: 'Ev1', team_id: 'T1', event: { type: 'message', channel_type: 'im', user: 'U1', text: 'status', channel: 'D1', ts: '1.1' } }));
    expect(dm).toMatchObject({ kind: 'messages', messages: [{ platform: 'slack', externalEventId: 'Ev1', platformUserId: 'U1', text: 'status', reply: { conversationId: 'D1', threadId: '1.1' } }] });
    const mention = await slack.handleWebhook(await slackRequest({ type: 'event_callback', event_id: 'Ev2', event: { type: 'app_mention', user: 'U1', text: '<@UBOT> plan it', channel: 'C1', ts: '2.2' } }));
    expect(mention.kind === 'messages' && mention.messages[0]?.text).toBe('plan it');
    const echo = await slack.handleWebhook(await slackRequest({ type: 'event_callback', event_id: 'Ev3', event: { type: 'message', channel_type: 'im', bot_id: 'B1', text: 'x' } }));
    expect(echo.kind).toBe('ignore');
  });

  it('replies in thread with chat.postMessage', async () => {
    await slack.send({ platform: 'slack', conversationId: 'D1', threadId: '1.1' }, { text: 'done' });
    expect(f.calls[0]?.url).toBe('https://slack.com/api/chat.postMessage');
    expect(f.calls[0]?.body).toEqual({ channel: 'D1', text: 'done', thread_ts: '1.1' });
  });
});

describe('Telegram (Bot API webhook)', () => {
  const f = mockFetch(() => new Response('{"ok":true}'));
  const tg = createTelegramAdapter({ botToken: 'test-telegram-token', webhookSecret: 'test-telegram-secret' }, { fetch: f.fn, now: () => NOW });
  const req = (update: object, secret = 'test-telegram-secret') =>
    new Request('https://ef.example.test/webhooks/telegram', { method: 'POST', body: JSON.stringify(update), headers: { 'x-telegram-bot-api-secret-token': secret } });

  it('requires the secret token', async () => {
    await expect(tg.handleWebhook(req({}, 'nope'))).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it('accepts private chats; groups only with /ask', async () => {
    const dm = await tg.handleWebhook(req({ update_id: 7, message: { message_id: 3, text: 'status', from: { id: 42 }, chat: { id: 42, type: 'private' } } }));
    expect(dm).toMatchObject({ kind: 'messages', messages: [{ externalEventId: '7', platformUserId: '42', text: 'status' }] });
    const group = await tg.handleWebhook(req({ update_id: 8, message: { message_id: 4, text: 'hello all', from: { id: 42 }, chat: { id: -1, type: 'group' } } }));
    expect(group.kind).toBe('ignore');
    const ask = await tg.handleWebhook(req({ update_id: 9, message: { message_id: 5, text: '/ask@efbot plan it', from: { id: 42 }, chat: { id: -1, type: 'group' } } }));
    expect(ask.kind === 'messages' && ask.messages[0]?.text).toBe('plan it');
  });

  it('replies with sendMessage', async () => {
    await tg.send({ platform: 'telegram', conversationId: '42', threadId: '3' }, { text: 'hi' });
    expect(f.calls[0]?.url).toBe('https://api.telegram.org/bottest-telegram-token/sendMessage');
    expect(f.calls[0]?.body).toMatchObject({ chat_id: '42', text: 'hi', reply_parameters: { message_id: 3 } });
  });
});

describe('WhatsApp (official Business Cloud API)', () => {
  const f = mockFetch(() => new Response('{"messages":[{"id":"x"}]}'));
  const wa = createWhatsAppAdapter({ accessToken: 'test-wa-token', phoneNumberId: '100', verifyToken: 'test-verify', appSecret: 'test-app-secret', graphVersion: 'v21.0' }, { fetch: f.fn, now: () => NOW });

  it('answers the verification challenge only with the verify token', async () => {
    const ok = await wa.handleWebhook(new Request('https://ef.example.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123'));
    expect(ok.kind === 'respond' && (await ok.response.text())).toBe('123');
    await expect(wa.handleWebhook(new Request('https://ef.example.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1'))).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it('checks X-Hub-Signature-256 and only takes this phone number id', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '100' }, messages: [{ id: 'wamid.1', from: '15550001', type: 'text', text: { body: 'status' } }] } }, { value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'wamid.2', from: '1', type: 'text', text: { body: 'x' } }] } }] }] });
    const sig = `sha256=${await hmacSha256Hex('test-app-secret', body)}`;
    const r = await wa.handleWebhook(new Request('https://ef.example.test/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } }));
    expect(r).toMatchObject({ kind: 'messages', messages: [{ externalEventId: 'wamid.1', platformUserId: '15550001' }] });
    expect(r.kind === 'messages' && r.messages).toHaveLength(1);
    await expect(wa.handleWebhook(new Request('https://ef.example.test/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=00' } }))).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it('sends through graph.facebook.com', async () => {
    await wa.send({ platform: 'whatsapp', conversationId: '15550001' }, { text: 'ok' });
    expect(f.calls[0]?.url).toBe('https://graph.facebook.com/v21.0/100/messages');
    expect(f.calls[0]?.body).toMatchObject({ messaging_product: 'whatsapp', to: '15550001', type: 'text' });
  });
});

describe('Discord (interactions endpoint)', () => {
  it('verifies Ed25519, answers PING, defers /ask', async () => {
    const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = toHex(await crypto.subtle.exportKey('raw', keys.publicKey));
    const discord = createDiscordAdapter({ applicationId: 'app1', publicKey });
    const signed = async (body: object) => {
      const raw = JSON.stringify(body);
      const ts = '1764000000';
      const sig = toHex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(ts + raw)));
      return new Request('https://ef.example.test/webhooks/discord', { method: 'POST', body: raw, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } });
    };
    const ping = await discord.handleWebhook(await signed({ type: 1 }));
    expect(ping.kind === 'respond' && (await ping.response.json())).toEqual({ type: 1 });
    const ask = await discord.handleWebhook(await signed({ type: 2, id: 'i1', token: 'tok', application_id: 'app1', channel_id: 'c1', member: { user: { id: 'u1' } }, data: { name: 'ask', options: [{ name: 'message', value: 'status' }] } }));
    expect(ask).toMatchObject({ kind: 'messages', messages: [{ platformUserId: 'u1', text: 'status' }] });
    expect(ask.kind === 'messages' && (await ask.ack?.json())).toEqual({ type: 5 });
    const bad = new Request('https://ef.example.test/webhooks/discord', { method: 'POST', body: '{"type":1}', headers: { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': '1' } });
    await expect(discord.handleWebhook(bad)).rejects.toBeInstanceOf(WebhookAuthError);
  });
});

describe('planned platforms', () => {
  it('refuse everything', async () => {
    for (const p of ['msteams', 'googlechat', 'matrix', 'signal', 'imessage'] as const) {
      const a = createPlannedAdapter(p);
      expect(a.implemented).toBe(false);
      await expect(a.handleWebhook(new Request('https://ef.example.test'))).rejects.toBeInstanceOf(WebhookAuthError);
    }
  });
});
