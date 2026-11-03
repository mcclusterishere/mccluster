import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCoreMcp } from '../src/core/mcp.js';
import { createEdgeVerifier } from '../../../core/src/broker-edge-auth.mjs';

const owner = { id: 'aaaaaaaa-0000-4000-8000-000000000001' };
const orgId = '123e4567-e89b-42d3-a456-426614174000';
const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  CORE_BROKER_URL: 'https://core.example.org', CORE_BROKER_TOKEN: 'broker-token', CORE_EDGE_SIGNING_KEY: 'edge-key'
};

function request(name = 'game.lore.read', args = {}) {
  return new Request('https://api.mccluster.org/v1/core/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name, arguments: args, _meta: { 'mccluster/actor': { user_id: 'forged-actor', kind: 'owner' } }
    } })
  });
}

async function withPlane(member, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url); calls.push({ href, init });
    let body;
    if (href.includes('/rest/v1/orgs?')) body = [{ id: orgId }];
    else if (href.includes('/rest/v1/org_members?')) body = member ? [{ org_id: orgId }] : [];
    else if (href === 'https://core.example.org/mcp') body = {
      jsonrpc: '2.0', id: 1, result: {
        tools: [
          { name: 'game.lore.read', _meta: { 'mccluster/risk': 'read', 'mccluster/approval': 'none' } },
          { name: 'core.game.lore.read' }
        ],
        content: [{ type: 'text', text: '{"read_only":true}' }]
      }
    };
    else throw new Error(`Unexpected request ${href}`);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('city lore cannot cross the existing bridge without a house-owner session', async () => {
  await withPlane(true, async (calls) => {
    assert.equal((await handleCoreMcp(request(), env, null)).status, 401);
    assert.equal(calls.length, 0);
  });
  await withPlane(false, async (calls) => {
    assert.equal((await handleCoreMcp(request(), env, owner)).status, 403);
    assert.ok(!calls.some((call) => call.href.startsWith(env.CORE_BROKER_URL)));
  });
});

test('owner lore request keeps fixed selectors and uses verified signed actor context', async () => {
  await withPlane(true, async (calls) => {
    const args = { universe_id: 'mccluster-fictional-city', section: 'npcs', business_id: 'tea-shop', limit: 3 };
    const result = await handleCoreMcp(request('game.lore.read', args), env, owner);
    assert.equal(result.status, 200);
    const dispatch = calls.find((call) => call.href === `${env.CORE_BROKER_URL}/mcp`);
    assert.ok(dispatch);
    const bodyBytes = Buffer.from(dispatch.init.body);
    assert.equal(dispatch.init.headers.authorization, 'Bearer broker-token');
    createEdgeVerifier({ secret: env.CORE_EDGE_SIGNING_KEY }).verify({ method: 'POST', path: '/mcp', bodyBytes, headers: dispatch.init.headers });
    const forwarded = JSON.parse(bodyBytes.toString());
    assert.deepEqual(forwarded.params.arguments, args);
    assert.deepEqual(forwarded.params._meta['mccluster/actor'], { user_id: owner.id, kind: 'owner', source: 'cloudflare-owner-session' });
    assert.equal(result.body.result.content[0].text, '{"read_only":true}');
  });
});

test('only semantic read-only city capability is exposed, never its raw Core tool', async () => {
  await withPlane(true, async (calls) => {
    const list = new Request('https://api.mccluster.org/v1/core/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    const result = await handleCoreMcp(list, env, owner);
    assert.deepEqual(result.body.result.tools.map((tool) => tool.name), ['game.lore.read']);
    assert.deepEqual(result.body.result.tools[0]._meta, { 'mccluster/risk': 'read', 'mccluster/approval': 'none' });
    const before = calls.filter((call) => call.href.startsWith(env.CORE_BROKER_URL)).length;
    const raw = await handleCoreMcp(request('core.game.lore.read'), env, owner);
    assert.equal(raw.body.result.isError, true);
    assert.equal(calls.filter((call) => call.href.startsWith(env.CORE_BROKER_URL)).length, before);
  });
});
