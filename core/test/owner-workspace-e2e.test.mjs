import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startOwnerWorkspaceRuntime, fixtureUntil, fixturePause } from './helpers/owner-workspace-runtime.mjs';
import http from 'node:http';
import https from 'node:https';

const modulePath = process.env.PGLITE_MODULE_PATH;
const required = process.env.MCCLUSTER_DEVICE_SQL_TESTS_REQUIRED === '1';
const enabled = modulePath && fs.existsSync(modulePath);
test('the integration fixture rejects every non-loopback fetch and native HTTP request before dispatch', () => {
  for (const url of ['https://api.mccluster.org/v1/core/mcp', 'https://compute.mccluster.org/v1/compute/enroll', 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/rest/v1/ops_compute_nodes']) {
    assert.throws(() => fetch(url), { code: 'FIXTURE_EXTERNAL_NETWORK_DENIED' });
    assert.throws(() => https.request(url), { code: 'FIXTURE_EXTERNAL_NETWORK_DENIED' });
  }
  assert.throws(() => http.request({ hostname: 'example.com', path: '/' }), { code: 'FIXTURE_EXTERNAL_NETWORK_DENIED' });
});
function value(reply) {
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.ok(!reply.body.error, JSON.stringify(reply.body));
  const result = reply.body.result;
  assert.ok(!result?.isError, JSON.stringify(result));
  let output = result.structuredContent || JSON.parse(result.content.find(item => item.type === 'text').text);
  while (output?.result && typeof output.result === 'object') output = output.result;
  return output;
}

test('owner session to signed worker: parallel streamed durable turns, stop, review, reconnect and revoke', { timeout: 150_000, skip: !enabled && !required ? 'Requires the pinned PGlite/pgcrypto integration runtime.' : false }, async () => {
  assert.ok(enabled, 'Set PGLITE_MODULE_PATH for the required integration proof.');
  const runtime = await startOwnerWorkspaceRuntime({ modulePath });
  try {
    const { db, workers, ORG, OWNER } = runtime;
    const { claimNext, completeJob } = await import('../src/supabase.mjs');
    const { residentAiTurnWith } = await import('../src/executors/resident-ai-turn.mjs');
    const { buildCompletionEvidence } = await import('../src/completion-evidence.mjs');
    const call = async (name, args = {}) => value(await runtime.mcp(name, { org_id: ORG, ...args }));
    assert.equal((await runtime.mcp('core.compute.devices.list', { org_id: ORG }, 'anonymous')).status, 401);
    assert.equal((await runtime.mcp('core.compute.devices.list', { org_id: ORG }, 'member')).status, 403);
    const list = await call('core.compute.devices.list', { org_id: randomUUID() });
    assert.equal(list.devices.length, 2, 'edge replaces a caller-supplied foreign org with the authenticated house');
    for (const worker of workers) {
      assert.equal(fs.statSync(worker.identityPath).mode & 0o777, 0o600, 'device-generated private key protected locally');
      assert.equal(fs.statSync(worker.manifestPath).mode & 0o777, 0o600);
    }
    async function thread(title) {
      const id = randomUUID();
      const response = await fetch(`${runtime.restFixture.url}/rest/v1/ops_ai_threads`, { method: 'POST', headers: { apikey: 'fixture-publishable', authorization: 'Bearer fixture-owner-session', 'content-type': 'application/json' }, body: JSON.stringify({ id, org_id: ORG, title, created_by: OWNER }) });
      assert.equal(response.status, 200, await response.clone().text()); return id;
    }
    async function submit(threadId, worker, content = 'Describe this test execution.', reviewOfTurnId) {
      return call('core.ai.turn.submit', { thread_id: threadId, message_id: randomUUID(), content, route: { mode: 'node', node_id: worker.nodeId, implementation: 'qwen3.8b.local' }, ...(reviewOfTurnId ? { review_of_turn_id: reviewOfTurnId } : {}) });
    }
    async function executeClaim() {
      const job = await claimNext(['resident_ai_turn']); assert.ok(job, 'a saved turn is claimable');
      const startedAt = new Date().toISOString();
      const output = await residentAiTurnWith(job);
      await completeJob(job, buildCompletionEvidence(job, output, { startedAt, completedAt: new Date().toISOString() }));
      return { job, output };
    }
    const first = await submit(await thread('First worker'), workers[0]);
    const second = await submit(await thread('Second worker'), workers[1]);
    const runA = executeClaim(), runB = executeClaim();
    const observed = await fixtureUntil(async () => {
      const a = await call('core.ai.turn.get', { turn_id: first.turn_id });
      const b = await call('core.ai.turn.get', { turn_id: second.turn_id });
      return a.progress?.content && b.progress?.content && !a.assistant_message && !b.assistant_message ? [a, b] : null;
    }, 30_000);
    assert.equal(observed[0].progress.node.node_id, workers[0].nodeId); assert.equal(observed[1].progress.node.node_id, workers[1].nodeId);
    assert.equal(workers[0].generation.active, 1); assert.equal(workers[1].generation.active, 1, 'two distinct workers execute simultaneously');
    await Promise.all([runA, runB]);
    const saved = await call('core.ai.turn.get', { turn_id: first.turn_id });
    assert.equal(saved.turn.status, 'done'); assert.equal(saved.assistant_message.metadata.node.node_id, workers[0].nodeId);
    assert.match(saved.assistant_message.content, /synthetic/); assert.equal(saved.assistant_message.metadata.fallback_reason, null);
    assert.equal(workers[0].requests[0].stream, true); assert.equal(workers[0].requests[0].options.num_ctx, 4096);

    const review = await submit(await thread('Independent review'), workers[1], 'Review the first answer.', first.turn_id);
    await executeClaim();
    const reviewed = await call('core.ai.turn.get', { turn_id: review.turn_id });
    assert.equal(reviewed.assistant_message.metadata.node.node_id, workers[1].nodeId);
    assert.equal(reviewed.assistant_message.metadata.review_of_turn_id, first.turn_id);
    assert.ok(workers[1].requests.at(-1).messages.some(message => message.content.includes('<answer_to_review>')));

    workers[0].generation.delayMs = 1000;
    const stopped = await submit(await thread('Stop this run'), workers[0]);
    const stoppingJob = executeClaim().then(() => null, error => error);
    await fixtureUntil(async () => (await call('core.ai.turn.get', { turn_id: stopped.turn_id })).progress?.content, 20_000);
    const stop = await call('core.ai.turn.stop', { turn_id: stopped.turn_id }); assert.equal(stop.stopped, true);
    const stoppedError = await stoppingJob; assert.equal(stoppedError?.code, 'LEASE_LOST');
    await fixtureUntil(() => workers[0].generation.active === 0, 5000);
    const stoppedState = await call('core.ai.turn.get', { turn_id: stopped.turn_id });
    assert.equal(stoppedState.turn.status, 'canceled'); assert.equal(stoppedState.assistant_message, null, 'late content never replaces Stop');

    await workers[0].stop();
    await db.query("update ops_compute_nodes set last_seen_at=clock_timestamp()-interval '5 minutes' where id=$1", [workers[0].nodeId]);
    assert.equal((await call('core.compute.devices.list')).devices.find(node => node.id === workers[0].nodeId).state, 'offline');
    workers[0].start();
    await fixtureUntil(async () => (await call('core.compute.devices.list')).devices.find(node => node.id === workers[0].nodeId).eligible, 20_000);
    assert.equal((await db.query('select count(*)::int as count from ops_compute_nodes')).rows[0].count, 2, 'reconnect reuses its key instead of re-enrolling');
    const revoked = await call('core.compute.device.update', { node_id: workers[0].nodeId, action: 'revoke' }); assert.equal(revoked.device.state, 'revoked');
    assert.equal((await call('core.compute.devices.list')).devices.find(node => node.id === workers[0].nodeId).eligible, false);
    assert.equal(workers[0].generation.peak, 1); assert.equal(workers[1].generation.peak, 1);
    const memberMessages = await fetch(`${runtime.restFixture.url}/rest/v1/ops_ai_messages?select=id`, { headers: { apikey: 'fixture-publishable', authorization: 'Bearer fixture-member-session' } });
    assert.deepEqual(await memberMessages.json(), [], 'real conversation RLS conceals owner messages from a member');
    for (const credential of runtime.credentials) assert.equal(runtime.logs.join('').includes(credential), false, 'no enrollment credential in service/worker logs');
    // The gateway SQL integration separately proves revoked renew/start/finish
    // denial and expiry/reassignment; this case proves the actual UI tool path.
  } finally { await runtime.close(); }
});
