import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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

/* Audit finding C7b: houseOrgId() read the rest() envelope as the row array and always resolved null. Every
   owner text tries the relay first (sendOwnerSmsViaRelay), so with MCCLUSTER_ORG_ID unset each one answered
   house_org_not_found and fell back to Twilio, or, with MCCLUSTER_SMS_REQUIRE_RELAY=1 (core.env.example), was not
   sent at all. supabase.mjs reads its configuration at import, so this runs sendSms in a child process with every
   request answered by a stub: nothing leaves the machine. */
const HOUSE_ORG = '123e4567-e89b-42d3-a456-426614174000';
const RELAY_STUB = `const seen = [];
globalThis.fetch = async (url, init = {}) => {
  const href = new URL(String(url));
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  seen.push({ host: href.host, path: href.pathname, method, org_id: body?.org_id ?? href.searchParams.get('org_id') });
  if (href.host === 'api.twilio.com') return Response.json({ sid: 'SM-stub', status: 'queued' }, { status: 201 });
  if (href.pathname === '/rest/v1/orgs') return Response.json([{ id: '${HOUSE_ORG}' }]);
  if (href.pathname === '/rest/v1/comms_relay_devices') return Response.json([{ id: 'relay-1', phone_number: '+15555550100' }]);
  const rows = { comms_contacts: 'contact-1', comms_threads: 'thread-1', comms_messages: 'message-1', comms_outbox: 'outbox-1' };
  const table = href.pathname.replace('/rest/v1/', '');
  if (rows[table]) return Response.json([{ id: rows[table] }]);
  if (table === 'comms_audit') return new Response(null, { status: 201 });
  return Response.json([]);
};
process.on('exit', () => { process.stderr.write('SEEN=' + JSON.stringify(seen) + '\\n'); });\n`;

async function sendOwnerTextInChild(env) {
  const dir = await mkdtemp('/tmp/mccluster-notifier-test-');
  try {
    await writeFile(`${dir}/stub.mjs`, RELAY_STUB);
    await writeFile(`${dir}/send.mjs`, `import { sendSms } from ${JSON.stringify(new URL('../src/notifier.mjs', import.meta.url).href)};\nconsole.log(JSON.stringify(await sendSms('McCluster: notifier test')));\n`);
    return spawnSync(process.execPath, ['--import', pathToFileURL(`${dir}/stub.mjs`).href, `${dir}/send.mjs`], {
      env: {
        ...process.env,
        SUPABASE_URL: 'https://notifier.test', SUPABASE_SECRET_KEY: 'sb_secret_test', MCCLUSTER_ORG_ID: '', MCCLUSTER_ORG_SLUG: '',
        MCCLUSTER_SMS_NOTIFY: '1', MCCLUSTER_OWNER_PHONE: '+15555550123', MCCLUSTER_PHONE: '+15555550123',
        TWILIO_ACCOUNT_SID: 'AC_notifier_test', TWILIO_AUTH_TOKEN: 'notifier-test-token', TWILIO_API_KEY: '', TWILIO_API_SECRET: '', TWILIO_FROM: '+15555550199',
        ...env,
      },
      encoding: 'utf8', timeout: 15000,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('C7b: with MCCLUSTER_ORG_ID unset, owner texts resolve the house org and are queued through its relay device', async () => {
  for (const requireRelay of ['', '1']) {
    const result = await sendOwnerTextInChild({ MCCLUSTER_SMS_REQUIRE_RELAY: requireRelay });
    const label = `MCCLUSTER_SMS_REQUIRE_RELAY=${requireRelay || '(unset)'}`;
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { sent: true, status: 'queued', transport: 'android-sim-relay', outbox_id: 'outbox-1', relay_device_id: 'relay-1' }, label);
    const seen = JSON.parse(result.stderr.match(/SEEN=(.*)/)[1]);
    assert.equal(seen.filter((request) => request.path === '/rest/v1/orgs').length, 1, `${label}: one house org lookup`);
    assert.equal(seen.find((request) => request.path === '/rest/v1/comms_relay_devices')?.org_id, `eq.${HOUSE_ORG}`, label);
    for (const table of ['comms_contacts', 'comms_threads', 'comms_messages', 'comms_outbox', 'comms_audit']) {
      assert.equal(seen.find((request) => request.path === `/rest/v1/${table}` && request.method === 'POST')?.org_id, HOUSE_ORG, `${label}: ${table} written for the house org`);
    }
    assert.ok(!seen.some((request) => request.host === 'api.twilio.com'), `${label}: no Twilio fallback`);
  }
});
