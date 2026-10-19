import test from 'node:test';
import assert from 'node:assert/strict';

import { handleExperienceRequest } from '../src/experience/router.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  EXPERIENCE_ASSIGNMENT_SECRET: 'assignment-secret'
};

const maturePolicy = {
  id: '77777777-7777-4777-8777-777777777777',
  key: 'production-mature', version: 'v1', plane: 'production',
  mode: 'promoted', algorithm: 'deterministic_score_mmr', enabled: true,
  config: {
    feature_schema: 'production-v1',
    behavior_window_days: 14,
    stable_ttl_seconds: 1800,
    weights: {
      editorial_prior: 0.20, recent_affinity: 0.35,
      explicit_preference: 0.30, novelty: 0.10, business_priority: 0.05
    },
    fatigue: { per_unanswered_visible: 0.12, max_penalty: 0.48 },
    diversity: { same_domain_penalty: 0.12, same_kind_penalty: 0.06, same_topic_penalty: 0.08 },
    business_priority: { 'music.next_step': { 'track-a': 0, 'track-b': 0, 'track-c': 0 } }
  }
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

function backend({
  experiments = [], experimentalPolicy = null, productionPolicy = null,
  events = [], preferences = [], priorDecisions = [], mUid = '88888888-8888-4888-8888-888888888888'
} = {}) {
  const writes = [];
  const snapshots = [];
  const preferenceWrites = [];
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
      if (u.searchParams.get('key') === 'eq.production-mature') {
        return response(productionPolicy ? [productionPolicy] : []);
      }
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
    if (path === 'm_auth_user_links') return response(mUid ? [{ m_uid: mUid }] : []);
    if (path === 'events') return response(events);
    if (path === 'experience_preferences') {
      if ((init.method || 'GET') === 'POST' || (init.method || 'GET') === 'PATCH') {
        preferenceWrites.push(JSON.parse(init.body));
        return response([], init.method === 'POST' ? 201 : 200);
      }
      return response(preferences);
    }
    if (path === 'experience_feature_snapshots') {
      const payload = JSON.parse(init.body);
      snapshots.push(...payload);
      return response([{ id: '99999999-9999-4999-8999-999999999999' }], 201);
    }
    if (path === 'experience_decisions') {
      if ((init.method || 'GET') !== 'POST') return response(priorDecisions);
      const payload = JSON.parse(init.body);
      writes.push(...payload);
      return response([{ id: '44444444-4444-4444-8444-444444444444', created_at: '2026-10-06T21:00:00Z' }], 201);
    }
    return response({ error: 'unexpected ' + path }, 500);
  };
  return { handler, writes, snapshots, preferenceWrites, calls };
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


test('Production Policy v1 can move a recently engaged candidate ahead of editorial order', async () => {
  const events = [{
    at: new Date().toISOString(),
    name: 'experience_interaction',
    path: '/listen.html',
    props: { candidate_id: 'track-c', experience_surface: 'music.next_step' }
  }];
  const { handler, writes, snapshots } = backend({ productionPolicy: maturePolicy, events });
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request(body), env, null);
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.policy.key, 'production-mature');
    assert.equal(out.evidence_only, false);
    assert.equal(out.candidates[0].id, 'track-c');
    assert.ok(out.reason_codes.includes('deterministic_score'));
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].schema_version, 'production-v1');
  assert.equal(writes[0].feature_snapshot_id, '99999999-9999-4999-8999-999999999999');
  assert.deepEqual(writes[0].objective_weights, maturePolicy.config.weights);
});

test('explicit member preference is separate and strong enough to change a near-cold ordering', async () => {
  const preferences = [
    { key: 'track-a', value: 'less', source: 'explicit' },
    { key: 'track-c', value: 'more', source: 'explicit' }
  ];
  const { handler, snapshots } = backend({ productionPolicy: maturePolicy, preferences, events: [] });
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  await withFetch(handler, async () => {
    const res = await handleExperienceRequest(request(body), env, user);
    const out = await res.json();
    assert.equal(out.candidates[0].id, 'track-c');
    assert.ok(out.reason_codes.includes('explicit_preference_applied'));
  });
  const features = snapshots[0].features.candidate_features;
  assert.equal(features.find((x) => x.id === 'track-a').explicit_preference, -1);
  assert.equal(features.find((x) => x.id === 'track-c').explicit_preference, 1);
});

test('repeated unanswered visibility creates bounded fatigue', async () => {
  const now = new Date().toISOString();
  const events = Array.from({ length: 5 }, () => ({
    at: now, name: 'experience_visible', path: '/listen.html',
    props: { candidate_id: 'track-a' }
  }));
  const { handler, snapshots } = backend({ productionPolicy: maturePolicy, events });
  await withFetch(handler, async () => {
    const out = await (await handleExperienceRequest(request(body), env, null)).json();
    assert.notEqual(out.candidates[0].id, 'track-a');
    assert.ok(out.reason_codes.includes('fatigue_applied'));
  });
  const trackA = snapshots[0].features.candidate_features.find((x) => x.id === 'track-a');
  assert.equal(trackA.fatigue_penalty, 0.48);
});

test('diversity reranking can break a near-tie without inventing relevance', async () => {
  const policy = structuredClone(maturePolicy);
  policy.config = {
    ...policy.config,
    weights: { editorial_prior: 0.01, recent_affinity: 0, explicit_preference: 0, novelty: 0, business_priority: 0 },
    diversity: { same_domain_penalty: 0.1, same_kind_penalty: 0, same_topic_penalty: 0 }
  };
  const diverseBody = {
    ...body,
    candidates: [
      { id: 'a', kind: 'destination', meta: { domain: 'music', topic: 'album' } },
      { id: 'b', kind: 'destination', meta: { domain: 'music', topic: 'video' } },
      { id: 'c', kind: 'destination', meta: { domain: 'action', topic: 'missions' } }
    ]
  };
  const { handler } = backend({ productionPolicy: policy });
  await withFetch(handler, async () => {
    const out = await (await handleExperienceRequest(request(diverseBody), env, null)).json();
    assert.deepEqual(out.candidates.map((x) => x.id), ['a','c']);
    assert.ok(out.reason_codes.includes('diversity_rerank_applied'));
  });
});

test('commercial/sponsor metadata does not buy recommendation rank', async () => {
  const policy = structuredClone(maturePolicy);
  policy.config = {
    ...policy.config,
    weights: { editorial_prior: 0.2, recent_affinity: 0, explicit_preference: 0, novelty: 0, business_priority: 0 }
  };
  const sponsored = {
    ...body,
    candidates: [
      { id: 'organic', kind: 'music', meta: { domain: 'music', topic: 'album' } },
      { id: 'paid', kind: 'music', meta: { domain: 'music', topic: 'album', sponsor: 'Brand', paid_cents: 1000000 } }
    ],
    max_items: 1
  };
  const { handler, snapshots } = backend({ productionPolicy: policy });
  await withFetch(handler, async () => {
    const out = await (await handleExperienceRequest(request(sponsored), env, null)).json();
    assert.equal(out.candidates[0].id, 'organic');
    assert.ok(out.reason_codes.includes('commercial_relationship_excluded_from_rank'));
  });
  const snap = JSON.stringify(snapshots[0].features);
  assert.doesNotMatch(snap, /sponsor|paid_cents|Brand/);
});

test('Production Policy v1 feature code has an explicit sensitive-trait exclusion boundary', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../src/experience/router.js', import.meta.url), 'utf8'
  ));
  const vector = source.slice(source.indexOf('function featureVector'), source.indexOf('async function hmacHex'));
  assert.doesNotMatch(vector, /race|ethnicity|religion|sexual|health|politic|address|latitude|longitude|personality|racist/i);
  assert.match(vector, /candidate\.meta\?\.domain/);
  assert.match(vector, /candidate\.meta\?\.topic/);
});

test('production-mature missing or disabled falls back to control-order', async () => {
  const { handler } = backend();
  await withFetch(handler, async () => {
    const out = await (await handleExperienceRequest(request(body), env, null)).json();
    assert.equal(out.policy.key, 'control-order');
    assert.deepEqual(out.candidates.map((x) => x.id), ['track-a','track-b']);
  });
});

test('explicit preference API is m_uid scoped and revocable', async () => {
  const { handler, preferenceWrites } = backend();
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const setReq = new Request('https://api.mccluster.org/v1/experience/preferences', {
    method: 'POST',
    headers: { 'content-type':'application/json', origin:'https://mccluster.org' },
    body: JSON.stringify({ surface:'music.next_step', key:'here-videos', value:'less' })
  });
  await withFetch(handler, async () => {
    const set = await (await handleExperienceRequest(setReq, env, user)).json();
    assert.equal(set.ok, true);
    assert.equal(set.value, 'less');
  });
  assert.equal(preferenceWrites.length, 1);
  assert.equal(preferenceWrites[0][0].m_uid, '88888888-8888-4888-8888-888888888888');
});
