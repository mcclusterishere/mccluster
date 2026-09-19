import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MCCLUSTER_RELAY_PHONE = '+12035550123';
const { normalizeIncoming } = await import('../src/relay/smsgate-bridge.mjs?test=1');

test('normalizes SMS Gateway sms:received webhook into McCluster relay payload', () => {
  assert.deepEqual(
    normalizeIncoming({
      event: 'sms:received',
      payload: {
        messageId: 'msg_123',
        message: 'hello prim3',
        phoneNumber: '+12035550199',
        receivedAt: '2026-09-19T09:00:00.000Z',
      },
    }),
    {
      from: '+12035550199',
      to: '+12035550123',
      body: 'hello prim3',
      external_id: 'msg_123',
      occurred_at: '2026-09-19T09:00:00.000Z',
    },
  );
});

test('ignores unsupported webhook events', () => {
  assert.equal(normalizeIncoming({ event: 'system:ping', payload: {} }), null);
});
