import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundedThreadContext,
  enforceReplyRate,
  findSensitiveKinds,
  normalizeAssistantDecision,
  shouldEscalateInbound,
  withAssistantDisclosure,
} from '../src/comms-policy.mjs';

test('detects sensitive legal, financial, credential, identity and medical topics', () => {
  assert.deepEqual(findSensitiveKinds('My lawyer needs the contract and bank routing number plus my 2FA code'), ['legal', 'financial', 'credentials']);
  assert.deepEqual(findSensitiveKinds('Here is my SSN and medical record'), ['identity', 'medical']);
});

test('fails closed to escalation for sensitive inbound requests', () => {
  const result = shouldEscalateInbound({
    body: 'Can you agree to this contract and send payment?',
    thread: { mode: 'assistant', assistant_enabled: true },
    contact: { blocked: false, assistant_allowed: true },
  });
  assert.equal(result.escalate, true);
  assert.equal(result.reason, 'sensitive_topic');
});

test('does not respond when a thread is in human takeover mode or contact is blocked', () => {
  assert.equal(shouldEscalateInbound({ body: 'hello', thread: { mode: 'human', assistant_enabled: false }, contact: {} }).ignore, true);
  assert.equal(shouldEscalateInbound({ body: 'hello', thread: { mode: 'assistant', assistant_enabled: true }, contact: { blocked: true } }).ignore, true);
});

test('bounds thread context by count and characters', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: String(index), body: 'x'.repeat(100), direction: 'inbound', sender_type: 'contact' }));
  const bounded = boundedThreadContext(rows, { maxRecentMessages: 3, maxRecentChars: 250 });
  assert.equal(bounded.length, 3);
  assert.ok(bounded.reduce((sum, row) => sum + row.body.length, 0) <= 250);
});

test('rate guard blocks reply floods and too-tight loops', () => {
  assert.equal(enforceReplyRate({ recentAssistantReplies: 8 }).allowed, false);
  assert.equal(enforceReplyRate({ recentAssistantReplies: 0, lastAgentReplyAt: new Date(Date.now() - 1000).toISOString() }).reason, 'reply_gap');
  assert.equal(enforceReplyRate({ recentAssistantReplies: 1, lastAgentReplyAt: new Date(Date.now() - 10000).toISOString() }).allowed, true);
});

test('invalid model output escalates instead of inventing a reply', () => {
  assert.equal(normalizeAssistantDecision({ action: 'reply', reply: '' }).action, 'escalate');
  assert.equal(normalizeAssistantDecision({ action: 'hack', reply: 'nope' }).action, 'escalate');
});

test('first automated reply clearly identifies PRIM3 personal assistant', () => {
  assert.equal(withAssistantDisclosure('Thanks. What time works?', null), "PRIM3's personal assistant here — Thanks. What time works?");
  assert.equal(withAssistantDisclosure('Thanks.', null, 'Matthew'), "Matthew's personal assistant here — Thanks.");
  assert.equal(withAssistantDisclosure('Thanks.', '2026-09-13T00:00:00Z'), 'Thanks.');
});
