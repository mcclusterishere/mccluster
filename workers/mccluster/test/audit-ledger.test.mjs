/* The ledger writer.

   Its whole contract is that it never throws — a privileged operation must
   not fail because the record of it could not be written — while never
   pretending a write landed that did not. Both halves are tested here,
   along with the bound on detail size and the org scoping on the read. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { recentAudit, recordAudit } from '../src/lib/audit.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

test('a written row reports its id', async () => {
  const seen = [];
  const result = await withFetchMock(async (url, options) => {
    seen.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonResponse([{ id: 42, at: '2026-09-22T12:00:00Z' }]);
  }, () => recordAudit(env, {
    orgId: ORG, actorUserId: 'u1', event: 'lead.status_changed',
    capability: 'crm.write', resourceType: 'lead', resourceId: 'l1', detail: { from: 'new', to: 'booked' }
  }));

  assert.deepEqual(result, { recorded: true, id: 42, at: '2026-09-22T12:00:00Z' });
  assert.match(seen[0].url, /\/rest\/v1\/control_audit$/);
  assert.equal(seen[0].body.actor_kind, 'user', 'actor_kind defaults to user rather than system');
});

test('an unreachable ledger never throws and says why', async () => {
  const result = await withFetchMock(async () => { throw new Error('connection reset'); },
    () => recordAudit(env, { orgId: ORG, event: 'lead.status_changed' }));

  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'ledger_unreachable');
  assert.match(result.detail, /connection reset/);
});

test('a rejecting ledger never throws and carries the status', async () => {
  const result = await withFetchMock(async () => new Response('nope', { status: 503 }),
    () => recordAudit(env, { orgId: ORG, event: 'media.generated' }));

  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'ledger_rejected');
  assert.equal(result.status, 503);
});

test('an entry with no event is refused without a round trip', async () => {
  let touched = false;
  const result = await withFetchMock(async () => { touched = true; return jsonResponse([]); },
    () => recordAudit(env, { orgId: ORG }));

  assert.deepEqual(result, { recorded: false, reason: 'event_required' });
  assert.equal(touched, false);
});

test('an unconfigured Worker reports that rather than attempting a write', async () => {
  let touched = false;
  const result = await withFetchMock(async () => { touched = true; return jsonResponse([]); },
    () => recordAudit({}, { orgId: ORG, event: 'lead.status_changed' }));

  assert.equal(result.reason, 'supabase_not_configured');
  assert.equal(touched, false);
});

test('an enormous detail is kept by shape, not stored whole', async () => {
  let written = null;
  await withFetchMock(async (url, options) => {
    written = JSON.parse(options.body);
    return jsonResponse([{ id: 1, at: 'now' }]);
  }, () => recordAudit(env, {
    orgId: ORG, event: 'media.generated', detail: { blob: 'x'.repeat(20000) }
  }));

  assert.equal(written.detail.truncated, true);
  assert.ok(written.detail.bytes > 8000);
  assert.ok(written.detail.preview.length <= 8000, 'the row keeps evidence, not payload');
});

test('the read is scoped to one org and newest first', async () => {
  let seen = '';
  await withFetchMock(async (url) => {
    seen = String(url);
    return jsonResponse([]);
  }, () => recentAudit(env, ORG, 5));

  assert.ok(seen.includes(`org_id=eq.${encodeURIComponent(ORG)}`), 'a tenant must never read another tenant history');
  assert.ok(seen.includes('order=at.desc'));
  assert.ok(seen.includes('limit=5'));
});

test('the read refuses a missing org rather than returning everything', async () => {
  let touched = false;
  await withFetchMock(async () => { touched = true; return jsonResponse([]); }, async () => {
    await assert.rejects(() => recentAudit(env, ''), (error) => error.status === 400);
  });
  assert.equal(touched, false);
});

test('an absurd limit is capped instead of honoured', async () => {
  let seen = '';
  await withFetchMock(async (url) => { seen = String(url); return jsonResponse([]); },
    () => recentAudit(env, ORG, 99999));

  assert.ok(seen.includes('limit=100'));
});
