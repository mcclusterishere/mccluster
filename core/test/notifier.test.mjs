import test from 'node:test';
import assert from 'node:assert/strict';

import { notifyJobFailure, notifyJobSuccess } from '../src/notifier.mjs';

function clearSmsEnv() {
  for (const key of [
    'TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET',
    'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'MCCLUSTER_PHONE', 'MCCLUSTER_SMS_NOTIFY',
    'MCCLUSTER_OWNER_PHONE', 'MCCLUSTER_SMS_REQUIRE_RELAY'
  ]) delete process.env[key];
}

test('routine jobs do not text the owner by default', async () => {
  clearSmsEnv();
  const result = await notifyJobSuccess({ job_type: 'local_analysis', input: {} }, { summary: 'done' });
  assert.deepEqual(result, { sent: false, reason: 'not_routable' });
});

test('meaningful autonomous outcomes route to SMS when configured', async () => {
  clearSmsEnv();
  const result = await notifyJobSuccess({ job_type: 'code_patch', input: {} }, { summary: 'draft ready' });
  assert.deepEqual(result, { sent: false, reason: 'relay_not_configured' });
});

test('explicit notify_owner can elevate an otherwise quiet job', async () => {
  clearSmsEnv();
  const result = await notifyJobSuccess({ job_type: 'host_health', input: { notify_owner: true } }, { summary: 'healthy' });
  assert.deepEqual(result, { sent: false, reason: 'relay_not_configured' });
});

test('retryable failures stay quiet but exhausted failures alert', async () => {
  clearSmsEnv();
  const retry = await notifyJobFailure({ job_type: 'repo_health' }, new Error('temporary'), 'queued');
  assert.deepEqual(retry, { sent: false, reason: 'retry_pending' });
  const exhausted = await notifyJobFailure({ job_type: 'repo_health' }, new Error('boom'), 'failed');
  assert.deepEqual(exhausted, { sent: false, reason: 'relay_not_configured' });
});
