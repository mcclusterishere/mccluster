/* POST /v1/leads/status — the pipeline mutation, off the browser.

   What matters here: a viewer or staff member cannot move a lead however
   the request is shaped, a status outside the column's own vocabulary is
   refused before it reaches Postgres, a malformed id never becomes a
   PostgREST filter fragment, the ledger gets what the value was before,
   and a ledger that is down does not swallow the operation silently. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { setLeadStatus } from '../src/leads.js';

const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const LEAD = '723e4567-e89b-42d3-a456-426614174777';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

function req(body) {
  return new Request('https://api.mccluster.org/v1/leads/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function backend({ role = 'owner', lead = { id: LEAD, status: 'new', email: 'sam@example.com', name: 'Sam' }, auditOk = true } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      const method = options.method || 'GET';
      calls.push({ href, method, body: options.body ? JSON.parse(options.body) : null });

      if (href.includes('/rest/v1/org_members')) {
        return jsonResponse([
          { role, added_at: '2026-01-01T00:00:00Z', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }
        ]);
      }
      if (href.includes('/rest/v1/control_audit')) {
        if (!auditOk) return new Response('ledger exploded', { status: 500 });
        return jsonResponse([{ id: 9001, at: '2026-09-22T00:00:00Z' }]);
      }
      if (href.includes('/rest/v1/leads')) {
        if (method === 'PATCH') {
          return jsonResponse([{ ...lead, status: JSON.parse(options.body).status }]);
        }
        return jsonResponse(lead ? [lead] : []);
      }
      return jsonResponse([]);
    }
  };
}

test('an owner moves a lead and the ledger records what it was before', async () => {
  const be = backend();
  const result = await withFetchMock(be.handler, () =>
    setLeadStatus(req({ lead_id: LEAD, status: 'booked', org_id: HOUSE }), env, USER));

  assert.equal(result.changed, true);
  assert.equal(result.lead.status, 'booked');
  assert.equal(result.audit.recorded, true);

  const audit = be.calls.find((c) => c.href.includes('control_audit'));
  assert.equal(audit.body.event, 'lead.status_changed');
  assert.equal(audit.body.resource_id, LEAD);
  assert.equal(audit.body.org_id, HOUSE);
  assert.equal(audit.body.actor_user_id, USER.id);
  assert.deepEqual(
    { from: audit.body.detail.from, to: audit.body.detail.to },
    { from: 'new', to: 'booked' },
    'an audit row that cannot say what changed is only a timestamp'
  );
});

test('staff cannot move a lead even with a valid org and status', async () => {
  const be = backend({ role: 'staff' });
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: LEAD, status: 'closed', org_id: HOUSE }), env, USER),
      (error) => error.status === 403
    );
  });
  assert.equal(
    be.calls.some((c) => c.method === 'PATCH'),
    false,
    'refusal must happen before the write, not after'
  );
});

test('a viewer cannot move a lead', async () => {
  const be = backend({ role: 'viewer' });
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: LEAD, status: 'replied', org_id: HOUSE }), env, USER),
      (error) => error.status === 403
    );
  });
});

test('a status outside the column vocabulary is refused before Postgres sees it', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: LEAD, status: 'archived', org_id: HOUSE }), env, USER),
      (error) => error.status === 400 && error.detail.allowed.includes('booked')
    );
  });
  assert.equal(be.calls.length, 0, 'a bad status must not cost a database round trip');
});

test('a malformed lead id never becomes a filter fragment', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: 'eq.anything&select=*', status: 'booked', org_id: HOUSE }), env, USER),
      (error) => error.status === 400
    );
  });
  assert.equal(be.calls.length, 0);
});

test('an org the caller does not belong to is refused', async () => {
  const be = backend();
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: LEAD, status: 'booked', org_id: '999e4567-e89b-42d3-a456-426614174999' }), env, USER),
      (error) => error.status === 403
    );
  });
});

test('a lead that does not exist is a 404, not a silent success', async () => {
  const be = backend({ lead: null });
  await withFetchMock(be.handler, async () => {
    await assert.rejects(
      () => setLeadStatus(req({ lead_id: LEAD, status: 'booked', org_id: HOUSE }), env, USER),
      (error) => error.status === 404
    );
  });
});

test('setting the status it already has writes nothing', async () => {
  const be = backend({ lead: { id: LEAD, status: 'booked', email: 'sam@example.com', name: 'Sam' } });
  const result = await withFetchMock(be.handler, () =>
    setLeadStatus(req({ lead_id: LEAD, status: 'booked', org_id: HOUSE }), env, USER));

  assert.equal(result.changed, false);
  assert.equal(be.calls.some((c) => c.method === 'PATCH'), false);
  assert.equal(be.calls.some((c) => c.href.includes('control_audit')), false, 'a no-op is not ledger history');
});

test('a broken ledger reports the hole instead of hiding it or losing the work', async () => {
  const be = backend({ auditOk: false });
  const result = await withFetchMock(be.handler, () =>
    setLeadStatus(req({ lead_id: LEAD, status: 'replied', org_id: HOUSE }), env, USER));

  assert.equal(result.changed, true, 'the operation the person asked for still completes');
  assert.equal(result.audit.recorded, false, 'and the caller is told the record did not land');
  assert.equal(result.audit.reason, 'ledger_rejected');
});
