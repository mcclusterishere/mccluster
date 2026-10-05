import test from 'node:test';
import assert from 'node:assert/strict';

import {
  observeControlRequest,
  observeScheduled,
  listObservabilityEvents,
  pruneObservabilityEvents,
  recordEvent,
  currentTrace,
  eventName
} from '../src/lib/observability.js';
import { recordAudit } from '../src/lib/audit.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_ORG = '223e4567-e89b-42d3-a456-426614174000';
const USER = '423e4567-e89b-42d3-a456-426614174333';
const TOKEN = 'human-token';
const ROW_KEYS = [
  'org_id', 'trace_id', 'request_id', 'span_id', 'parent_span_id', 'event_kind', 'event_name',
  'level', 'outcome', 'source', 'service', 'route', 'method', 'status_code', 'duration_ms',
  'actor_user_id', 'resource_type', 'resource_id', 'message', 'detail', 'occurred_at'
];

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
    const method = options.method || 'GET';
    calls.push({ href, method, headers: options.headers || {}, body });
    if (href.endsWith('/auth/v1/user')) return json({ id: USER });
    if (href.includes('/rest/v1/org_members?')) {
      const wanted = new URL(href).searchParams.get('org_id');
      return json(wanted === `eq.${membershipOrg}` ? [{ org_id: membershipOrg, role: 'owner' }] : []);
    }
    if (href.includes('/rest/v1/control_audit') && method === 'POST') return json([{ id: 77, at: '2026-10-05T07:00:00Z' }], 201);
    if (href.includes('/rest/v1/control_observability_events') && method === 'POST') return new Response(null, { status: 201 });
    if (href.includes('/rest/v1/control_observability_events') && method === 'DELETE') return new Response(null, { status: 204 });
    if (href.includes('/rest/v1/control_observability_events?')) return json(eventRows);
    throw new Error(`unexpected fetch ${method} ${href}`);
  };
  return {
    calls,
    writes() {
      return calls.filter((call) => call.href.includes('/control_observability_events') && call.method === 'POST');
    },
    restore() { globalThis.fetch = original; }
  };
}

function controlRequest({ org = ORG, method = 'GET', path = '/v1/work/tasks' } = {}) {
  return new Request(`https://api.mccluster.org${path}?org_id=${org}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-mccluster-org-id': org,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' })
    },
    ...(method === 'GET' ? {} : { body: '{}' })
  });
}

function waitCtx() {
  const pending = [];
  return { pending, ctx: { waitUntil(promise) { pending.push(promise); } } };
}

test('a Control mutation returns correlation headers and persists a request row after membership verification', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    const response = await observeControlRequest(controlRequest({ method: 'POST' }), env(), ctx, async () => json({ task: {} }, 201));
    assert.equal(response.status, 201);
    assert.match(response.headers.get('x-mccluster-trace-id') || '', /^[0-9a-f-]{36}$/i);
    assert.match(response.headers.get('x-mccluster-request-id') || '', /^[0-9a-f-]{36}$/i);
    await Promise.all(pending);
    const [write] = backend.writes();
    assert.ok(write, 'expected a retained event write');
    assert.ok(Array.isArray(write.body), 'rows are written as one batch');
    const [row] = write.body;
    assert.deepEqual(Object.keys(row), ROW_KEYS, 'every row has the same keys, as PostgREST bulk insert requires');
    assert.equal(row.org_id, ORG);
    assert.equal(row.actor_user_id, USER);
    assert.equal(row.route, '/v1/work/tasks');
    assert.equal(row.event_kind, 'request');
    assert.equal(row.event_name, 'http.request');
    assert.equal(row.status_code, 201);
    assert.equal(row.outcome, 'ok');
    assert.equal(row.source, 'worker');
    assert.equal(row.trace_id, response.headers.get('x-mccluster-trace-id'));
    assert.equal(row.request_id, response.headers.get('x-mccluster-request-id'));
    assert.match(row.span_id, /^[0-9a-f-]{36}$/);
    assert.equal(Object.prototype.hasOwnProperty.call(row.detail, 'authorization'), false);
    assert.doesNotMatch(JSON.stringify(write.body), new RegExp(TOKEN), 'the bearer token is never stored');
  } finally {
    backend.restore();
  }
});

test('a spoofed workspace header cannot inject an event into an organization the caller does not belong to', async () => {
  const backend = mockBackend({ membershipOrg: ORG });
  const { pending, ctx } = waitCtx();
  try {
    await observeControlRequest(controlRequest({ org: OTHER_ORG, method: 'POST' }), env(), ctx, async () => json({ ok: true }));
    await Promise.all(pending);
    assert.equal(backend.writes().length, 0);
  } finally {
    backend.restore();
  }
});

test('fast successful reads are not retained; failed and slow reads are', async () => {
  const backend = mockBackend();
  const originalNow = Date.now;
  try {
    let run = waitCtx();
    await observeControlRequest(controlRequest(), env(), run.ctx, async () => json({ tasks: [] }));
    await Promise.all(run.pending);
    assert.equal(backend.writes().length, 0, 'Control polling itself is not an event');
    assert.equal(backend.calls.some((call) => call.href.endsWith('/auth/v1/user')), false, 'and costs no verification round trips');

    run = waitCtx();
    await observeControlRequest(controlRequest(), env(), run.ctx, async () => json({ error: 'no' }, 403));
    await Promise.all(run.pending);
    assert.equal(backend.writes().length, 1);
    assert.equal(backend.writes()[0].body[0].level, 'warn');
    assert.equal(backend.writes()[0].body[0].outcome, 'refused');

    run = waitCtx();
    let clock = originalNow();
    Date.now = () => clock;
    await observeControlRequest(controlRequest(), env(), run.ctx, async () => { clock += 1500; return json({ tasks: [] }); });
    Date.now = originalNow;
    await Promise.all(run.pending);
    assert.equal(backend.writes().length, 2, 'a slow read is retained');
    assert.ok(backend.writes()[1].body[0].duration_ms >= 1500);
  } finally {
    Date.now = originalNow;
    backend.restore();
  }
});

test('domain events share the request trace, point at the request span, and are written in the same batch', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    const response = await observeControlRequest(controlRequest({ method: 'PATCH' }), env(), ctx, async () => {
      assert.ok(currentTrace(), 'handler code can see its trace');
      assert.equal(recordEvent({ orgId: ORG, name: 'work.task.update', resourceType: 'work_task', resourceId: 't-1', actorUserId: USER }), true);
      assert.equal(recordEvent({ orgId: 'not-an-org', name: 'x.y' }), false, 'an event without a real org is refused');
      return json({ ok: true });
    });
    await Promise.all(pending);
    const rows = backend.writes()[0].body;
    assert.equal(rows.length, 2);
    const [requestRow, domain] = rows;
    assert.equal(domain.event_kind, 'domain');
    assert.equal(domain.event_name, 'work.task.update');
    assert.equal(domain.trace_id, response.headers.get('x-mccluster-trace-id'));
    assert.equal(domain.request_id, requestRow.request_id);
    assert.equal(domain.parent_span_id, requestRow.span_id);
    assert.notEqual(domain.span_id, requestRow.span_id);
    assert.equal(domain.resource_type, 'work_task');
    assert.equal(domain.resource_id, 't-1');
    assert.deepEqual(Object.keys(domain), ROW_KEYS);
  } finally {
    backend.restore();
  }
});

test('domain events persist even when the request itself is not retained or carries no workspace header', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    const webhook = new Request('https://api.mccluster.org/v1/media/webhooks/fal', { method: 'POST', body: '{}' });
    await observeControlRequest(webhook, env(), ctx, async () => {
      recordEvent({ orgId: ORG, name: 'media.generation.completed', kind: 'dependency', resourceType: 'media_job', resourceId: 'j-1', traceId: '0af7651916cd43dd8448eb211c80319c'.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') });
      return json({ accepted: true });
    });
    await Promise.all(pending);
    const rows = backend.writes()[0].body;
    assert.equal(rows.length, 1, 'only the domain event: an unauthenticated webhook has no verified request row');
    assert.equal(rows[0].event_name, 'media.generation.completed');
    assert.equal(rows[0].trace_id, '0af76519-16cd-43dd-8448-eb211c80319c', 'a provider callback rejoins the original trace');
  } finally {
    backend.restore();
  }
});

test('a request cannot write more than 25 domain events, and the drop is counted', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    await observeControlRequest(controlRequest({ method: 'POST' }), env(), ctx, async () => {
      for (let i = 0; i < 40; i += 1) recordEvent({ orgId: ORG, name: 'loop.event' });
      return json({ ok: true });
    });
    await Promise.all(pending);
    const rows = backend.writes()[0].body;
    assert.equal(rows.filter((row) => row.event_kind === 'domain').length, 25);
    assert.equal(rows[0].detail.dropped_domain_events, 15);
  } finally {
    backend.restore();
  }
});

test('outside a traced request recordEvent is a no-op', () => {
  assert.equal(currentTrace(), null);
  assert.equal(recordEvent({ orgId: ORG, name: 'orphan.event' }), false);
});

test('an audited mutation carries its trace into control_audit and emits a domain event', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    const response = await observeControlRequest(controlRequest({ method: 'POST' }), env(), ctx, async () => {
      const audit = await recordAudit(env(), {
        orgId: ORG, actorUserId: USER, event: 'work.task.create', capability: 'crm.write',
        resourceType: 'work_task', resourceId: 't-9', detail: { title: 'Call back' }
      });
      assert.equal(audit.recorded, true);
      return json({ ok: true }, 201);
    });
    await Promise.all(pending);
    const auditWrite = backend.calls.find((call) => call.href.includes('/rest/v1/control_audit'));
    assert.equal(auditWrite.body.detail.title, 'Call back');
    assert.equal(auditWrite.body.detail.trace.trace_id, response.headers.get('x-mccluster-trace-id'));
    assert.equal(auditWrite.body.detail.trace.request_id, response.headers.get('x-mccluster-request-id'));
    const domain = backend.writes()[0].body.find((row) => row.event_kind === 'domain');
    assert.equal(domain.event_name, 'work.task.create');
    assert.equal(domain.resource_id, 't-9');
    assert.equal(domain.detail.audit_recorded, true);
  } finally {
    backend.restore();
  }
});

test('scheduled work writes its domain events under its own trace', async () => {
  const backend = mockBackend();
  const { pending, ctx } = waitCtx();
  try {
    const result = await observeScheduled(env(), ctx, 'social.publish_queue', async () => {
      recordEvent({ orgId: ORG, name: 'social.publish.failed', kind: 'job', level: 'error', resourceType: 'social_publish_job', resourceId: 'p-1' });
      return 'done';
    });
    assert.equal(result, 'done');
    await Promise.all(pending);
    const [row] = backend.writes()[0].body;
    assert.equal(row.route, 'cron:social.publish_queue');
    assert.equal(row.level, 'error');
    assert.equal(row.outcome, 'error');
    assert.equal(row.event_kind, 'job');
  } finally {
    backend.restore();
  }
});

test('an upgraded socket response is passed through untouched', async () => {
  const backend = mockBackend();
  const { ctx } = waitCtx();
  try {
    const upgraded = { status: 101, webSocket: {}, headers: new Headers() };
    const response = await observeControlRequest(controlRequest(), env(), ctx, async () => upgraded);
    assert.equal(response, upgraded);
  } finally {
    backend.restore();
  }
});

test('the observability tail is bounded, org scoped, and paginates with an opaque cursor', async () => {
  const rows = [
    { id: 12, org_id: ORG, created_at: '2026-10-05T07:00:02Z' },
    { id: 11, org_id: ORG, created_at: '2026-10-05T07:00:01Z' },
    { id: 10, org_id: ORG, created_at: '2026-10-05T07:00:00Z' }
  ];
  const backend = mockBackend({ eventRows: rows });
  try {
    const first = await listObservabilityEvents(env(), ORG, new URL('https://api.mccluster.org/v1/observability/events?limit=2&level=info'));
    assert.equal(first.events.length, 2);
    assert.equal(first.has_more, true);
    assert.ok(first.next_cursor);
    let params = new URL(backend.calls.at(-1).href).searchParams;
    assert.equal(params.get('org_id'), `eq.${ORG}`);
    assert.equal(params.get('limit'), '3');
    assert.equal(params.get('level'), 'eq.info');
    assert.equal(params.get('order'), 'created_at.desc,id.desc');

    await listObservabilityEvents(env(), ORG, new URL(`https://api.mccluster.org/v1/observability/events?limit=500&cursor=${first.next_cursor}`));
    params = new URL(backend.calls.at(-1).href).searchParams;
    assert.equal(params.get('limit'), '201', 'limit is capped at 200 plus one lookahead row');
    assert.equal(params.get('or'), '(created_at.lt."2026-10-05T07:00:01.000Z",and(created_at.eq."2026-10-05T07:00:01.000Z",id.lt.11))');
  } finally {
    backend.restore();
  }
});

test('trace, request and resource drilldowns look back across the retention window', async () => {
  const backend = mockBackend({ eventRows: [] });
  const otelTrace = '4bf92f35-77b3-4da6-a3ce-929d0e0e4736';
  try {
    const before = Date.now();
    await listObservabilityEvents(env(), ORG, new URL(`https://api.mccluster.org/v1/observability/events?trace_id=${otelTrace}`));
    let params = new URL(backend.calls.at(-1).href).searchParams;
    assert.equal(params.get('trace_id'), `eq.${otelTrace}`);
    const since = Date.parse(params.get('created_at').replace(/^gte\./, ''));
    assert.ok(before - since >= 89 * 24 * 60 * 60 * 1000, 'a drilldown is not limited to the last day');

    await listObservabilityEvents(env(), ORG, new URL('https://api.mccluster.org/v1/observability/events?resource_type=media_job&resource_id=j-1&event_kind=dependency&source=worker'));
    params = new URL(backend.calls.at(-1).href).searchParams;
    assert.equal(params.get('resource_type'), 'eq.media_job');
    assert.equal(params.get('resource_id'), 'eq.j-1');
    assert.equal(params.get('event_kind'), 'eq.dependency');
    assert.equal(params.get('source'), 'eq.worker');
  } finally {
    backend.restore();
  }
});

test('malformed filters are refused before querying storage', async () => {
  const backend = mockBackend();
  try {
    for (const [query, message] of [
      ['trace_id=not-a-uuid', /trace_id must be a UUID/],
      ['request_id=nope', /request_id must be a UUID/],
      ['cursor=%%%', /cursor is malformed/],
      ['resource_id=j-1', /resource_id requires resource_type/],
      ['resource_type=Bad%20Type', /malformed/],
      ['event_kind=everything', /event_kind/],
      ['source=anywhere', /source/],
      ['level=debug', /level must be/]
    ]) {
      await assert.rejects(
        () => listObservabilityEvents(env(), ORG, new URL(`https://api.mccluster.org/v1/observability/events?${query}`)),
        message,
        query
      );
    }
    assert.equal(backend.calls.length, 0);
  } finally {
    backend.restore();
  }
});

test('retention prunes info after 14 days and warnings or errors after 90', async () => {
  const backend = mockBackend();
  try {
    const now = Date.parse('2026-10-05T00:00:00Z');
    const result = await pruneObservabilityEvents(env(), now);
    assert.equal(result.pruned, true);
    const deletes = backend.calls.filter((call) => call.method === 'DELETE');
    assert.equal(deletes.length, 3);
    const cutoff = (level) => new URL(deletes.find((call) => call.href.includes(`level=eq.${level}`)).href).searchParams.get('created_at');
    assert.equal(cutoff('info'), 'lt.2026-09-21T00:00:00.000Z');
    assert.equal(cutoff('warn'), 'lt.2026-07-07T00:00:00.000Z');
    assert.equal(cutoff('error'), 'lt.2026-07-07T00:00:00.000Z');
  } finally {
    backend.restore();
  }
});

test('event names are normalised to dotted lowercase identifiers', () => {
  assert.equal(eventName('lead.status_changed'), 'lead.status_changed');
  assert.equal(eventName('Social Publish/Retried'), 'social_publish_retried');
  assert.equal(eventName('  '), null);
});
