import test from 'node:test';
import assert from 'node:assert/strict';

import { handleExperienceRequest } from '../src/experience/router.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  EXPERIENCE_ASSIGNMENT_SECRET: 'assignment-secret'
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function request(body, origin = 'https://mccluster.org') {
  return new Request('https://api.mccluster.org/v1/experience/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body)
  });
}

function backend({ experiments = [], experimentalPolicy = null } = {}) {
  const writes = [];
  const calls = [];
  const handler = async (url, init = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace('/rest/v1/', '');
    calls.push({ path, method: init.method || 'GET', query: u.searchParams });

    if (path === 'experience_surfaces') {
      return response([{ id: '11111111-1111-4111-8111-111111111111', key: 'music.next_step', risk_tier: 0, allowed_mutations: ['order','content'] }]);
    }
    if (path === 'experience_experiments') return response(experiments);
    if (path === 'experience_policies') {
      if (u.searchParams.get('key') === 'eq.control-order') {
        return response([{
          id: '22222222-2222-4222-8222-222222222222',
          key: 'control-order', version: 'v1', plane: 'production',
          mode: 'promoted', algorithm: 'identity_order', config: {}, enabled: true
        }]);
      }
      if (u.searchParams.get('id') && experimentalPolicy) return response([experimentalPolicy]);
      return response([]);
    }
    if (path === 'experience_assignments') {
      if ((init.method || 'GET') === 'POST') return response([], 201);
      return response([]);
    }
    if (path === 'experience_experiment_arms') {
      if (u.searchParams.get('arm_key')) {
        return response([{ policy_id: '33333333-3333-4333-8333-333333333333' }]);
      }
      return response([{
        arm_key: 'treatment', policy_id: '33333333-3333-4333-8333-333333333333',
        weight: 100, is_control: false
      }]);
    }
    if (path === 'experience_decisions') {
      const payload = JSON.parse(init.body);
      writes.push(...payload);
      return response([{ id: '44444444-4444-4444-8444-444444444444', created_at: '2026-10-06T21:00:00Z' }], 201);
    }
    return response({ error: 'unexpected ' + path }, 500);
  };
  return { handler, writes, calls };
}

async function withFetch(handler, fn) {
  const old = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); }
  finally { globalThis.fetch = old; }
}

const body = {
  surface: 'music.next_step',
  device_id: 'device-1',
  session_id: 'session-1',
  candidates: [
    { id: 'track-a', kind: 'track', meta: { genre: 'rap' } },
    { id: 'track-b', kind: 'track' },
    { id: 'track-c', kind: 'track' }
  ],
  max_items: 2,
  context: { path: '/album.html', source: 'instagram' }
};

test('evidence-plane control decision preserves caller order and records opportunity set', async () => {
  const { handler, writes } = backend();
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request(body), env, null);
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.ok, true);
    assert.equal(out.evidence_only, true);
    assert.equal(out.policy.key, 'control-order');
    assert.deepEqual(out.candidates.map((x) => x.id), ['track-a','track-b']);
    assert.deepEqual(out.propensities, [
      { id: 'track-a', probability: 1 },
      { id: 'track-b', probability: 1 }
    ]);
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].eligible_candidates.map((x) => x.id), ['track-a','track-b','track-c']);
  assert.deepEqual(writes[0].selected_candidates.map((x) => x.id), ['track-a','track-b']);
  assert.ok(/^[a-f0-9]{64}$/.test(writes[0].subject_key_hash));
  assert.equal(writes[0].session_id, 'session-1');
});

test('anonymous experience decisions require a device key', async () => {
  const { handler } = backend();
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request({ ...body, device_id: null }), env, null);
    assert.equal(res.status, 400);
    const out = await res.json();
    assert.match(out.error, /device_id/i);
  });
});

test('untrusted origins are rejected before database reads', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return response([]); }, async () => {
    const res = await handleExperienceRequest(request(body, 'https://evil.example'), env, null);
    assert.equal(res.status, 403);
  });
  assert.equal(calls, 0);
});

test('research-intent experiment without exempt/approved review cannot affect traffic', async () => {
  const experiments = [{
    id: '55555555-5555-4555-8555-555555555555',
    key: 'research-pending',
    allocation: 1,
    intent: 'research',
    research_review: 'pending',
    consent_mode: 'research_consent',
    status: 'running'
  }];
  const { handler, writes } = backend({ experiments });
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request(body), env, null);
    const out = await res.json();
    assert.equal(out.experiment, null);
    assert.equal(out.policy.key, 'control-order');
  });
  assert.equal(writes[0].experiment_id, null);
  assert.equal(writes[0].arm_key, null);
});

test('unsupported experimental algorithms fail closed to production control', async () => {
  const experiments = [{
    id: '66666666-6666-4666-8666-666666666666',
    key: 'future-bandit',
    allocation: 1,
    intent: 'product',
    research_review: 'not_required',
    consent_mode: 'product_notice',
    status: 'canary'
  }];
  const experimentalPolicy = {
    id: '33333333-3333-4333-8333-333333333333',
    key: 'future-bandit', version: 'v1', plane: 'research',
    mode: 'live', algorithm: 'thompson_sampling', config: {}, enabled: true
  };
  const { handler, writes } = backend({ experiments, experimentalPolicy });
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request(body), env, null);
    const out = await res.json();
    assert.equal(out.policy.key, 'control-order');
    assert.equal(out.experiment, null);
    assert.ok(out.reason_codes.includes('experiment_fallback_to_control'));
  });
  assert.equal(writes[0].experiment_id, null);
});
