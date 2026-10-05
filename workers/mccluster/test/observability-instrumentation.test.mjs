/* The highest-value paths write canonical observability events under the
   request's trace: paid media reservation and provider submission, the
   provider webhook (rejoining the original trace through the job row), and
   consequential AI decision transitions. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { observeControlRequest } from '../src/lib/observability.js';
import { createGeneration, handleFalWebhook } from '../src/media/router.js';
import { handleAiRequest } from '../src/ai/router.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'owner@example.com' };
const JOB = '523e4567-e89b-42d3-a456-426614174555';
const DECISION = '123e4567-e89b-42d3-a456-426614174999';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  FAL_KEY: 'test-key',
  MCCLUSTER_HOUSE_ORG_ID: ORG
};
const MODEL = { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function plane({ falOk = true, decisionStatus = 200 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url instanceof Request ? url.url : url);
    const method = options.method || (url instanceof Request ? url.method : 'GET');
    let body = null;
    const raw = options.body ?? null;
    if (raw) { try { body = JSON.parse(String(raw)); } catch { body = String(raw); } }
    calls.push({ href, method, body });
    if (href.includes('/rest/v1/orgs')) return json([{ id: ORG }]);
    if (href.includes('/rest/v1/org_members?')) return json([{ org_id: ORG, role: 'owner' }]);
    if (href.includes('/rest/v1/control_role_capabilities?')) return json([{ role: 'owner', capability: 'media.generate', allowed: true }]);
    if (href.includes('/rest/v1/media_models?')) return json([MODEL]);
    if (href.includes('/rest/v1/rpc/media_create_budgeted_job_v2')) return json([{ id: JOB, org_id: ORG }]);
    if (href.includes('/rest/v1/rpc/media_release_cost_reservation')) return json(null);
    if (href.includes('/rest/v1/media_jobs?') && method === 'PATCH') return json([{ id: JOB, org_id: ORG, status: body?.status }]);
    if (href.includes('queue.fal.run')) {
      return falOk ? json({ request_id: 'fal-req-1', status: 'IN_QUEUE' }) : json({ detail: 'provider down' }, 503);
    }
    if (href.includes('/functions/v1/context-decision')) {
      return json(decisionStatus < 400 ? { decision: { id: DECISION, status: 'approved' } } : { error: 'decision is not proposed' }, decisionStatus);
    }
    if (href.includes('/rest/v1/control_observability_events') && method === 'POST') return new Response(null, { status: 201 });
    throw new Error(`unexpected fetch ${method} ${href}`);
  };
  __resetCapabilityCache();
  return {
    calls,
    events() {
      return calls.filter((c) => c.href.includes('/control_observability_events') && c.method === 'POST').flatMap((c) => c.body);
    },
    restore() { globalThis.fetch = original; __resetCapabilityCache(); }
  };
}

function traced(path, body, handler) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const request = new Request(`https://api.mccluster.org${path}?org_id=${ORG}`, {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return observeControlRequest(request, env, ctx, handler).then(async (response) => {
    await Promise.all(pending);
    return response;
  });
}

test('a paid media generation records reservation and provider submission under the request trace', async () => {
  const be = plane();
  try {
    const response = await traced('/v1/media/generate', { org_id: ORG, model_id: 't2i', prompt: 'a lighthouse' },
      async (req) => json({ job: await createGeneration(req, env, USER) }, 202));
    assert.equal(response.status, 202);
    const trace = response.headers.get('x-mccluster-trace-id');
    const reserve = be.calls.find((c) => c.href.includes('media_create_budgeted_job_v2'));
    assert.equal(reserve.body.p_routing.trace_id, trace, 'the job row carries its trace for the webhook');
    const names = be.events().map((e) => e.event_name);
    assert.deepEqual(names, ['media.generation.reserved', 'media.generation.submitted']);
    for (const event of be.events()) {
      assert.equal(event.trace_id, trace);
      assert.equal(event.resource_type, 'media_job');
      assert.equal(event.resource_id, JOB);
      assert.equal(event.org_id, ORG);
      assert.equal(event.actor_user_id, USER.id);
    }
    assert.equal(be.events()[1].detail.provider_request_id, 'fal-req-1');
  } finally {
    be.restore();
  }
});

test('a failed provider submission records an error event and the reservation release', async () => {
  const be = plane({ falOk: false });
  try {
    await traced('/v1/media/generate', { org_id: ORG, model_id: 't2i', prompt: 'a lighthouse' },
      async (req) => {
        try { await createGeneration(req, env, USER); } catch (error) { return json({ error: error.message }, 502); }
        return json({}, 202);
      });
    const failed = be.events().find((e) => e.event_name === 'media.generation.submit_failed');
    assert.ok(failed, 'submission failure is an event');
    assert.equal(failed.level, 'error');
    assert.equal(failed.outcome, 'error');
    assert.equal(failed.resource_id, JOB);
    assert.ok(be.calls.some((c) => c.href.includes('media_release_cost_reservation')), 'the reservation is released');
  } finally {
    be.restore();
  }
});

test('an owner decision transition is recorded with its outcome', async () => {
  const be = plane();
  try {
    await traced(`/v1/ai/decisions/${DECISION}/status`, { status: 'approved', note: 'ship it' },
      (req) => handleAiRequest(req, env, USER));
    const event = be.events().find((e) => e.event_name === 'ai.decision.approved');
    assert.ok(event, 'decision transition event recorded');
    assert.equal(event.resource_type, 'ai_context.decision');
    assert.equal(event.resource_id, DECISION);
    assert.equal(event.outcome, 'ok');
    assert.equal(event.actor_user_id, USER.id);
  } finally {
    be.restore();
  }
});

test('a refused decision transition is recorded as refused, not as success', async () => {
  const be = plane({ decisionStatus: 409 });
  try {
    await traced(`/v1/ai/decisions/${DECISION}/status`, { status: 'rejected' },
      (req) => handleAiRequest(req, env, USER));
    const event = be.events().find((e) => e.event_name === 'ai.decision.rejected');
    assert.ok(event);
    assert.equal(event.outcome, 'refused');
    assert.equal(event.level, 'warn');
    assert.equal(event.detail.response_status, 409);
  } finally {
    be.restore();
  }
});
