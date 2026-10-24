import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moshiReady, handleVoiceRequest, signVoiceTicket, verifyVoiceTicket, VOICE_CAPABILITY
} from '../src/voice/router.js';

const UID = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://matthew.mccluster.org';
const NOW = Date.parse('2026-10-24T17:00:00Z');
const READY = {
  VOICE_CONVERSATION_ENABLED: 'true',
  VOICE_SESSION_SIGNING_KEY: 'sign-'.repeat(12),
  VOICE_MOSHI_WS_URL: 'wss://voice.mccluster.org/api/chat',
  VOICE_MOSHI_GATEWAY_TOKEN: 'gateway-token-'.repeat(4),
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'private-test-service-key',
};
function req(path, method = 'GET', { origin = ORIGIN, auth = 'Bearer human-session', headers = {}, body } = {}) {
  const h = { origin, authorization: auth, ...headers };
  if (body) h['content-type'] = 'application/json';
  return new Request('https://api.mccluster.org' + path, {
    method, headers: h, ...(body ? { body: JSON.stringify(body) } : {})
  });
}
const response = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
function fixture(log, { member = true, owner = true, refuseGateway = false } = {}) {
  return async (url, options = {}) => {
    const u = new URL(url);
    log.push({ url: String(url), headers: options.headers || {} });
    if (u.pathname === '/auth/v1/user') return response(member ? { id: UID } : {}, member ? 200 : 401);
    if (u.pathname === '/rest/v1/orgs') return response([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]);
    if (u.pathname === '/rest/v1/org_members') return response(owner ? [{ role: 'owner' }] : []);
    if (u.hostname === 'voice.mccluster.org') {
      assert.equal(options.headers.Authorization, 'Bearer ' + READY.VOICE_MOSHI_GATEWAY_TOKEN);
      assert.equal(options.headers.Upgrade, 'websocket');
      assert.equal(options.redirect, 'manual');
      assert.ok(!JSON.stringify(options).includes('human-session'));
      return refuseGateway ? response({ message: 'closed' }, 401) : { status: 101, webSocket: { simulated: true } };
    }
    throw Error('Unexpected upstream ' + url);
  };
}
test('single provider-neutral capability and no unrelated route capture', async () => {
  assert.equal(VOICE_CAPABILITY, 'speech.converse.full_duplex');
  assert.equal(await handleVoiceRequest(req('/v1/compute'), READY), null);
});
test('enabled only with strict first-party WSS, explicit flag and all secrets', () => {
  assert.equal(moshiReady(READY), true);
  for (const value of ['', 'false', 'Trueish', '1', undefined])
    assert.equal(moshiReady({ ...READY, VOICE_CONVERSATION_ENABLED: value }), false);
  for (const value of ['ws://voice.mccluster.org/api/chat', 'wss://evil.com/api/chat',
    'wss://voice.mccluster.org/bad', 'wss://voice.mccluster.org/api/chat?redirect=a'])
    assert.equal(moshiReady({ ...READY, VOICE_MOSHI_WS_URL: value }), false);
  assert.equal(moshiReady({ ...READY, VOICE_MOSHI_GATEWAY_TOKEN: 'short' }), false);
  assert.equal(moshiReady({ ...READY, VOICE_SESSION_SIGNING_KEY: '' }), false);
});
test('status checks real owner role and never returns configured secrets', async () => {
  const denied = await handleVoiceRequest(req('/v1/voice/status'), READY,
    { fetchImpl: fixture([], { member: false }) });
  assert.equal(denied.status, 401);
  const nonOwner = await handleVoiceRequest(req('/v1/voice/status'), READY,
    { fetchImpl: fixture([], { owner: false }) });
  assert.equal(nonOwner.status, 403);
  const ok = await handleVoiceRequest(req('/v1/voice/status'), READY,
    { fetchImpl: fixture([]) });
  assert.equal(ok.status, 200);
  const result = await ok.json();
  assert.equal(result.providers[0].id, 'dessa');
  assert.equal(result.providers[0].executable, false);
  assert.equal(result.providers[1].id, 'moshi');
  assert.equal(result.providers[1].executable, true);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  assert.doesNotMatch(JSON.stringify(result), /gateway-token|private-test|sign-/);
});
test('Dessa is uncallable without an official release', async () => {
  const answer = await handleVoiceRequest(req('/v1/voice/sessions', 'POST',
    { body: { provider: 'dessa' } }), READY, { fetchImpl: fixture([]) });
  assert.equal(answer.status, 503);
  assert.equal((await answer.json()).detail.status, 'awaiting_official_release');
});
test('owner session gives short HMAC ticket, never a bearer in URL; streams only to the private gateway', async () => {
  const log = [];
  const created = await handleVoiceRequest(req('/v1/voice/sessions', 'POST',
    { body: { provider: 'moshi' } }), READY, { fetchImpl: fixture(log), now: () => NOW });
  assert.equal(created.status, 201);
  const info = await created.json();
  assert.equal(info.endpoint, 'wss://api.mccluster.org/v1/voice/stream');
  assert.equal(info.recording, false);
  assert.equal(info.protocols.length, 1);
  assert.doesNotMatch(info.endpoint, /mcv1|token|sid/);
  const ticket = info.protocols[0];
  assert.equal((await verifyVoiceTicket(READY, ticket, { origin: ORIGIN, nowMs: NOW }))?.provider, 'moshi');
  assert.equal(await verifyVoiceTicket(READY, ticket, { origin: 'https://mccluster.org', nowMs: NOW }), null);
  assert.equal(await verifyVoiceTicket(READY, ticket, { origin: ORIGIN, nowMs: NOW + 31_000 }), null);
  assert.equal(await verifyVoiceTicket(READY, ticket + 'x', { origin: ORIGIN, nowMs: NOW }), null);
  const result = await handleVoiceRequest(req('/v1/voice/stream', 'GET', {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': ticket }
  }), READY, { fetchImpl: fixture(log), now: () => NOW });
  assert.equal(result.status, 101);
  assert.equal(result.webSocket.simulated, true);
  assert.equal(log.at(-1).url, 'https://voice.mccluster.org/api/chat');
});
test('stream rejects bad upgrades, missing ticket, malicious origins, and disabled model', async () => {
  const fetchImpl = fixture([]);
  const missingUpgrade = await handleVoiceRequest(req('/v1/voice/stream'), READY, { fetchImpl });
  assert.equal(missingUpgrade.status, 426);
  const missingTicket = await handleVoiceRequest(req('/v1/voice/stream', 'GET',
    { headers: { upgrade: 'websocket' } }), READY, { fetchImpl });
  assert.equal(missingTicket.status, 401);
  const badOrigin = await handleVoiceRequest(req('/v1/voice/status', 'GET',
    { origin: 'https://attack.invalid' }), READY, { fetchImpl });
  assert.equal(badOrigin.status, 403);
  const off = await handleVoiceRequest(req('/v1/voice/sessions', 'POST',
    { body: { provider: 'moshi' } }), { ...READY, VOICE_CONVERSATION_ENABLED: 'false' }, { fetchImpl });
  assert.equal(off.status, 503);
});
test('rejected GPU gateway returns sanitized 502', async () => {
  const issuedAt = Math.floor(NOW / 1000);
  const ticket = await signVoiceTicket(READY, {
    version: 1, aud: 'mccluster.voice.stream', provider: 'moshi',
    sid: UID, origin: ORIGIN, iat: issuedAt, exp: issuedAt + 30
  });
  const result = await handleVoiceRequest(req('/v1/voice/stream', 'GET',
    { headers: { upgrade: 'websocket', 'sec-websocket-protocol': ticket } }),
    READY, { fetchImpl: fixture([], { refuseGateway: true }), now: () => NOW });
  assert.equal(result.status, 502);
  assert.doesNotMatch(await result.text(), /gateway-token|private-test-service-key/);
});
