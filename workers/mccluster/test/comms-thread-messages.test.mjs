/* The Control Room operator inbox reads the transcript through
   GET /v1/comms/threads/{id}/messages. comms_messages is revoked from
   `authenticated` and granted only to service_role, so this route is the
   only way an operator can see a conversation — it has to stay owner
   gated, org scoped, and it has to actually return the messages. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleCommsRequest } from '../src/comms/router.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const THREAD_ID = '223e4567-e89b-42d3-a456-426614174111';
const CONTACT_ID = '323e4567-e89b-42d3-a456-426614174222';
const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'owner@example.com' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  MCCLUSTER_HOUSE_ORG_ID: ORG_ID
};

function withFetchMock(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

/* Stands in for the whole Supabase surface this route touches. `owner`
   decides what the membership lookup reports, so a non-owner can be tested
   against exactly the same data. */
function supabase({ owner = true, thread = true, messages = [] } = {}) {
  const calls = [];
  return {
    calls,
    handler: async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: options.method || 'GET' });

      if (href.includes('/rest/v1/org_members') || href.includes('/rest/v1/rpc/')) {
        return jsonResponse(owner ? [{ org_id: ORG_ID, user_id: OWNER.id, role: 'owner' }] : []);
      }
      if (href.includes('/rest/v1/orgs')) {
        return jsonResponse([{ id: ORG_ID, slug: 'mccluster' }]);
      }
      if (href.includes('/rest/v1/comms_threads')) {
        return jsonResponse(thread ? [{ id: THREAD_ID, org_id: ORG_ID, contact_id: CONTACT_ID, mode: 'assistant', channel: 'sms' }] : []);
      }
      if (href.includes('/rest/v1/comms_contacts')) {
        return jsonResponse([{ address: '+15555550100', display_name: 'Test Contact', blocked: false }]);
      }
      if (href.includes('/rest/v1/comms_messages')) {
        return jsonResponse(messages);
      }
      return jsonResponse([]);
    }
  };
}

function get(path) {
  return new Request(`https://api.mccluster.org${path}`, { method: 'GET' });
}

test('owner thread messages returns the transcript with delivery state', async () => {
  /* Newest-first, the way the query orders it. */
  const sb = supabase({
    messages: [
      { id: 'm2', direction: 'outbound', sender_type: 'owner', body: 'hi back', status: 'delivered', occurred_at: '2026-09-17T00:01:00Z' },
      { id: 'm1', direction: 'inbound', sender_type: 'contact', body: 'hello', status: 'received', occurred_at: '2026-09-17T00:00:00Z' }
    ]
  });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages`), env, OWNER);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].body, 'hello');
    // Delivery state is the whole point for an operator: a queued message
    // that never went out must not look like a delivered one.
    assert.equal(body.messages[1].status, 'delivered');
    assert.equal(body.thread.id, THREAD_ID);
    assert.equal(body.thread.comms_contacts.display_name, 'Test Contact');
  });
});

test('thread messages are scoped to the thread AND the org', async () => {
  const sb = supabase({ messages: [] });

  await withFetchMock(sb.handler, async () => {
    await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages`), env, OWNER);
  });

  const read = sb.calls.find((c) => c.href.includes('/rest/v1/comms_messages'));
  assert.ok(read, 'expected a comms_messages read');
  assert.ok(read.href.includes(`thread_id=eq.${THREAD_ID}`), 'must filter by thread');
  assert.ok(read.href.includes(`org_id=eq.${ORG_ID}`), 'must filter by org');
});

test('an empty transcript is an empty list, not a 404', async () => {
  const sb = supabase({ messages: [] });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages`), env, OWNER);
    assert.equal(response.status, 200);
    const body = await response.json();
    // The console distinguishes "no messages" from "could not read": the
    // route has to make that distinction possible by succeeding here.
    assert.deepEqual(body.messages, []);
  });
});

test('a thread the org does not own is 404, not an empty transcript', async () => {
  const sb = supabase({ thread: false });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages`), env, OWNER);
    assert.equal(response.status, 404);
  });
});

test('a non-owner cannot read a transcript', async () => {
  const sb = supabase({ owner: false, messages: [{ id: 'm1', body: 'private' }] });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages`), env, OWNER);
    assert.ok(response.status === 401 || response.status === 403, `expected an auth failure, got ${response.status}`);
    const body = await response.text();
    assert.ok(!body.includes('private'), 'must not leak message bodies to a non-owner');
  });
});

test('the newest page comes back oldest-first with a cursor when more remain', async () => {
  /* 4 stored messages, page size 2: the operator should get the two newest,
     in reading order, plus the cursor that walks backwards. */
  const stored = [
    { id: 'm4', occurred_at: '2026-09-17T00:04:00Z', body: 'fourth' },
    { id: 'm3', occurred_at: '2026-09-17T00:03:00Z', body: 'third' },
    { id: 'm2', occurred_at: '2026-09-17T00:02:00Z', body: 'second' },
    { id: 'm1', occurred_at: '2026-09-17T00:01:00Z', body: 'first' }
  ];
  const sb = supabase({ messages: stored });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages?limit=2`), env, OWNER);
    const body = await response.json();

    assert.equal(body.messages.length, 2, 'the extra look-ahead row must not be returned');
    assert.deepEqual(body.messages.map((m) => m.id), ['m3', 'm4'], 'oldest-first within the page');
    assert.equal(body.has_more, true);
    assert.equal(body.next_before, '2026-09-17T00:03:00Z');
    assert.equal(body.next_before_id, 'm3');
  });

  const read = sb.calls.find((c) => c.href.includes('/rest/v1/comms_messages'));
  assert.ok(read.href.includes('order=occurred_at.desc,id.desc'), 'must page from the newest end');
  assert.ok(read.href.includes('limit=3'), 'must request one extra row to detect more');
});

test('has_more is false when the page exactly drains the thread', async () => {
  const sb = supabase({ messages: [{ id: 'm2', occurred_at: '2026-09-17T00:02:00Z' }, { id: 'm1', occurred_at: '2026-09-17T00:01:00Z' }] });

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages?limit=2`), env, OWNER);
    const body = await response.json();
    assert.equal(body.messages.length, 2);
    assert.equal(body.has_more, false, 'exactly-full page with nothing behind it is not "more"');
  });
});

test('a cursor with an id tiebreak pages messages sharing a timestamp', async () => {
  const sb = supabase({ messages: [] });

  await withFetchMock(sb.handler, async () => {
    await handleCommsRequest(
      get(`/v1/comms/threads/${THREAD_ID}/messages?limit=25&before=2026-09-17T00:03:00Z&before_id=m3`),
      env,
      OWNER
    );
  });

  const read = sb.calls.find((c) => c.href.includes('/rest/v1/comms_messages'));
  /* Without the id tiebreak, messages stamped identically to the cursor are
     skipped entirely on the next page. */
  assert.ok(read.href.includes('or=('), 'composite keyset cursor expected');
  assert.ok(read.href.includes('occurred_at.lt.'), 'older-than clause expected');
  assert.ok(read.href.includes('id.lt.m3'), 'id tiebreak expected');
});

test('a cursor without an id falls back to a plain timestamp bound', async () => {
  const sb = supabase({ messages: [] });

  await withFetchMock(sb.handler, async () => {
    await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages?before=2026-09-17T00:03:00Z`), env, OWNER);
  });

  const read = sb.calls.find((c) => c.href.includes('/rest/v1/comms_messages'));
  assert.ok(read.href.includes('occurred_at=lt.'), 'plain bound expected');
  assert.ok(!read.href.includes('or=('), 'no composite cursor without an id');
});

test('limit is clamped so a caller cannot ask for the whole table', async () => {
  const sb = supabase({ messages: [] });

  await withFetchMock(sb.handler, async () => {
    await handleCommsRequest(get(`/v1/comms/threads/${THREAD_ID}/messages?limit=100000`), env, OWNER);
  });

  const read = sb.calls.find((c) => c.href.includes('/rest/v1/comms_messages'));
  assert.ok(read.href.includes('limit=201'), 'clamped to 200 (+1 look-ahead)');
});

test('POST is not accepted on the messages route', async () => {
  const sb = supabase({});

  await withFetchMock(sb.handler, async () => {
    const response = await handleCommsRequest(
      new Request(`https://api.mccluster.org/v1/comms/threads/${THREAD_ID}/messages`, { method: 'POST', body: '{}' }),
      env,
      OWNER
    );
    assert.equal(response.status, 404);
  });
});
