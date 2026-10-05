import test from 'node:test';
import assert from 'node:assert/strict';

import { observeControlRequest, listObservabilityEvents } from '../src/lib/observability.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_ORG = '223e4567-e89b-42d3-a456-426614174000';
const USER = '423e4567-e89b-42d3-a456-426614174333';
const TOKEN = 'human-token';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function env() {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    CF_VERSION_METADATA: { id: 'rev-1' }
  };
}

function mockBackend({ membershipOrg = ORG, eventRows = [] } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    let body = null;
    if (options.body) {
      try { body = JSON.parse(String(options.body)); } catch { body = String(options.body); }
    }
    calls.push({ href, method: options.method || 'GET', headers: options.headers || {}, body });
    if (href.endsWith('/auth/v1/user')) return json({ id: USER });
    if (href.includes('/rest/v1/org_members?')) {
      const wanted = new URL(href).searchParams.get('org_id');
      return json(wanted === `eq.${membershipOrg}` ? [{ org_id: membershipOrg, role: 'owner' }] : []);
    }
    if (href.includes('/rest/v1/control_observability_events') && (options.method || 'GET') === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (href.includes('/rest/v1/control_observability_events?')) return json(eventRows);
    throw new Error(`unexpected fetch ${href}`);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; }
  };
}

function controlRequest(org = ORG) {
  return new Request('https://api.mccluster.org/v1/work/tasks?org_id=' + org, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-mccluster-org-id': org
    }
  });
}

test('observed Control requests return stable correlation headers and persist after membership verification', async () => {
  const backend = mockBackend();
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  try {
    const response = await observeControlRequest(controlRequest(), env(), ctx, async () => json({ tasks: [] }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-mccluster-trace-id') || '', /^[0-9a-f-]{36}$/i);
    assert.match(response.headers.get('x-mccluster-request-id') || '', /^[0-9a-f-]{36}$/i);
    await Promise.all(pending);
    const write = backend.calls.find((call) => call.href.includes('/control_observability_events') && call.method === 'POST');
    assert.ok(write, 'expected a retained event write');
    assert.equal(write.body.org_id, ORG);
    assert.equal(write.body.actor_user_id, USER);
    assert.equal(write.body.route, '/v1/work/tasks');
    assert.equal(write.body.status_code, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(write.body.detail, 'authorization'), false);
  } finally {
    backend.restore();
  }
});

test('a spoofed workspace header cannot inject an event into an organization the caller does not belong to', async () => {
  const backend = mockBackend({ membershipOrg: ORG });
  const pending = [];
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  try {
    await observeControlRequest(controlRequest(OTHER_ORG), env(), ctx, async () => json({ ok: true }));
    await Promise.all(pending);
    assert.equal(
      backend.calls.some((call) => call.href.includes('/control_observability_events') && call.method === 'POST'),
      false
    );
  } finally {
    backend.restore();
  }
});

test('the observability tail is bounded, org scoped, and supports trace filtering', async () => {
  const rows = [{
    id: 9, org_id: ORG,
    trace_id: '523e4567-e89b-42d3-a456-426614174999',
    request_id: '623e4567-e89b-42d3-a456-426614174999',
    event_kind: 'request', level: 'info', service: 'mccluster-worker',
    route: '/v1/work/tasks', method: 'GET', status_code: 200,
    duration_ms: 12, created_at: '2026-10-05T07:00:00Z'
  }];
  const backend = mockBackend({ eventRows: rows });
  try {
    const url = new URL('https://api.mccluster.org/v1/observability/events?limit=500&level=info&trace_id=523e4567-e89b-42d3-a456-426614174999&since=2026-10-05T00:00:00Z');
    const result = await listObservabilityEvents(env(), ORG, url);
    assert.equal(result.events.length, 1);
    const read = backend.calls.find((call) => call.href.includes('/control_observability_events?'));
    const params = new URL(read.href).searchParams;
    assert.equal(params.get('org_id'), `eq.${ORG}`);
    assert.equal(params.get('limit'), '201', 'limit is capped at 200 plus one lookahead row');
    assert.equal(params.get('level'), 'eq.info');
    assert.equal(params.get('trace_id'), 'eq.523e4567-e89b-42d3-a456-426614174999');
  } finally {
    backend.restore();
  }
});

test('observability tail rejects malformed trace filters before querying storage', async () => {
  const backend = mockBackend();
  try {
    const url = new URL('https://api.mccluster.org/v1/observability/events?trace_id=not-a-uuid');
    await assert.rejects(() => listObservabilityEvents(env(), ORG, url), /trace_id must be a UUID/);
    assert.equal(backend.calls.some((call) => call.href.includes('/control_observability_events?')), false);
  } finally {
    backend.restore();
  }
});
