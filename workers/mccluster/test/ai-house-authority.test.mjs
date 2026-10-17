import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAiRequest } from '../src/ai/router.js';

const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const FOREIGN = '223e4567-e89b-42d3-a456-426614174000';
const OWNER = { id: '323e4567-e89b-42d3-a456-426614174000' };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service' };
const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function simulate(request, { houseOwner = true } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/rest/v1/orgs?')) return json([{ id: HOUSE }]);
    if (href.includes('/rest/v1/org_members?')) return json(houseOwner ? [{ org_id: HOUSE, role: 'owner' }] : []);
    throw new Error('Unexpected privileged request: ' + href);
  };
  try { return { response: await handleAiRequest(request, env, OWNER), calls }; }
  finally { globalThis.fetch = originalFetch; }
}

test('tenant owners cannot select their organization to access the house Core API', async () => {
  const { response, calls } = await simulate(new Request('https://api.mccluster.org/v1/ai?org_id=' + FOREIGN));
  assert.equal(response.status, 403);
  assert.equal(calls.filter(x => x.includes('/rest/v1/org_members?')).length, 0, 'reject selector before membership lookup');
  assert.ok(!calls.some(x => x.includes('ops_agent_jobs')));
});

test('canonical house owner still sees Core API without tenant selection', async () => {
  const { response, calls } = await simulate(new Request('https://api.mccluster.org/v1/ai'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.durable_jobs, 'ops_agent_jobs');
  assert.ok(calls.some(x => x.includes('org_id=eq.' + HOUSE)));
});

test('canonical house selector works, foreign house member is denied', async () => {
  const allowed = await simulate(new Request('https://api.mccluster.org/v1/ai?org_id=' + HOUSE));
  assert.equal(allowed.response.status, 200);
  const denied = await simulate(new Request('https://api.mccluster.org/v1/ai?org_id=' + HOUSE), { houseOwner: false });
  assert.equal(denied.response.status, 403);
});
