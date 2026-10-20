import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://context.test';
process.env.SUPABASE_SECRET_KEY = 'service-test-key';
delete process.env.MCCLUSTER_CONTEXT_TOKEN;
const { searchPrivateContext } = await import('../src/context-client.mjs');

test('private memory works through the existing backend credential when the optional context token is absent', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://context.test/rest/v1/rpc/ops_ai_context_search');
    assert.equal(init.headers.apikey, 'service-test-key');
    assert.equal(init.headers.authorization, undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.p_org_id, 'trusted-house');
    assert.equal(body.p_query, 'Skylark');
    assert.equal(body.p_before, '2026-10-20T12:00:00Z');
    return Response.json({ memories: [], messages: [], resident_messages: [{ id: 'old', content: 'Remembered fact' }] });
  };
  try {
    const result = await searchPrivateContext({ orgId: 'trusted-house', query: 'Skylark', before: '2026-10-20T12:00:00Z' });
    assert.equal(result.available, true);
    assert.equal(result.transport, 'service_rpc');
    assert.equal(result.resident_messages[0].id, 'old');
  } finally { globalThis.fetch = original; }
});
