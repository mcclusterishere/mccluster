// The remote MCP bridge is the only path from the public internet into Core's
// execution plane, so its boundary is worth pinning rather than eyeballing.
//
// What these tests are actually defending:
//
// 1. Core's tool bus carries raw, provider-namespaced tools and upstream
//    diagnostics. Neither is part of the remote contract, and the diagnostics
//    can name internal hosts. tools/list must publish only the allowlist.
// 2. A tool name outside the allowlist must be refused *before* dispatch, so
//    Core never sees it.
// 3. A rejection of the Worker's own machine credential is an edge fault, not
//    the caller's authorization failure, and must not be reported as 401/403.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleCoreMcp, handleCoreStatus } from '../src/core/mcp.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = { id: 'aaaaaaaa-0000-4000-8000-000000000001' };

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  CORE_BROKER_URL: 'https://core.example.org',
  CORE_BROKER_TOKEN: 'broker-token',
  CORE_EDGE_SIGNING_KEY: 'edge-signing-key'
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function rpcRequest(body) {
  return new Request('https://api.mccluster.org/v1/core/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// Core's real tools/list answer: allowlisted capabilities, a capability that is
// deliberately not allowlisted, a raw provider-namespaced tool, and the
// upstream diagnostics block.
function brokerToolList() {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        { name: 'system.health', title: 'System health', _meta: { 'mccluster/risk': 'read', 'mccluster/approval': 'none' } },
        { name: 'ai.chat', title: 'Home-base AI', _meta: { 'mccluster/risk': 'read', 'mccluster/approval': 'none', 'mccluster/providers': ['mccluster-compute'] } },
        { name: 'compute.task.get', title: 'Read compute task', _meta: { 'mccluster/risk': 'read', 'mccluster/approval': 'none' } },
        { name: 'research.web', title: 'Research web', _meta: { 'mccluster/risk': 'read', 'mccluster/approval': 'none' } },
        { name: 'objective.plan', title: 'Plan objective', _meta: { 'mccluster/risk': 'write', 'mccluster/approval': 'none' } },
        { name: 'model3d.generate', title: 'Generate 3D model', _meta: { 'mccluster/risk': 'spend', 'mccluster/approval': 'budget-gated', 'mccluster/providers': ['fal'] } },
        { name: 'code.build', title: 'Build', _meta: { 'mccluster/risk': 'write', 'mccluster/approval': 'review-required' } },
        { name: 'game.build', title: 'Build game', _meta: { 'mccluster/risk': 'write', 'mccluster/approval': 'review-required' } },
        { name: 'mccluster.media.generate', title: 'Raw provider tool' }
      ],
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2025-11-25',
        'mccluster/catalogVersion': '1.4.0',
        'mccluster/diagnostics': [
          { id: 'internal-upstream', transport: 'mcp-http', ok: false, error: 'connect ECONNREFUSED 10.0.0.7:8080' }
        ]
      }
    }
  };
}

// `role` drives the membership lookup. `broker` overrides the Core response.
// Every outbound URL is recorded so a test can prove where a call stopped.
function withPlane({ role = 'owner', broker, brokerStatus = 200 } = {}, fn) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    seen.push({ href, headers: init?.headers || {} });
    if (href.includes('/rest/v1/orgs?')) return jsonResponse([{ id: ORG_ID }]);
    if (href.includes('/rest/v1/org_members?')) return jsonResponse(role ? [{ org_id: ORG_ID }] : []);
    if (href.includes('/mcp')) return jsonResponse(broker ?? brokerToolList(), brokerStatus);
    if (href.includes('/health')) return jsonResponse(broker ?? { ok: true, tools: 30 }, brokerStatus);
    throw new Error(`unexpected fetch: ${href}`);
  };
  return Promise.resolve(fn(seen)).finally(() => { globalThis.fetch = original; });
}

test('initialize is answered at the edge without touching Core', async () => {
  await withPlane({}, async (seen) => {
    const { status, body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }), env, null);
    assert.equal(status, 200);
    assert.equal(body.result.protocolVersion, '2025-11-25');
    assert.equal(body.result.serverInfo.name, 'mccluster-core');
    assert.equal(seen.length, 0, 'initialize must not reach Core');
  });
});

test('ping is answered at the edge', async () => {
  await withPlane({}, async (seen) => {
    const { status, body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 2, method: 'ping' }), env, null);
    assert.equal(status, 200);
    assert.deepEqual(body.result, {});
    assert.equal(seen.length, 0);
  });
});

test('tools/list requires authentication', async () => {
  await withPlane({}, async (seen) => {
    const { status, body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }), env, null);
    assert.equal(status, 401);
    assert.match(body.error.message, /Authentication required/i);
    assert.equal(seen.length, 0, 'an unauthenticated call must not reach Core');
  });
});

test('a non-owner is refused and never reaches Core', async () => {
  await withPlane({ role: null }, async (seen) => {
    const { status, body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 4, method: 'tools/list' }), env, OWNER);
    assert.equal(status, 403);
    assert.match(body.error.message, /house owner/i);
    assert.ok(!seen.some((call) => call.href.includes('core.example.org')), 'Core must not be called for a non-owner');
  });
});

test('tools/list publishes only allowlisted capabilities', async () => {
  await withPlane({}, async () => {
    const { status, body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 5, method: 'tools/list' }), env, OWNER);
    assert.equal(status, 200);
    const names = body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), ['ai.chat', 'code.build', 'compute.task.get', 'game.build', 'model3d.generate', 'objective.plan', 'research.web', 'system.health']);
    assert.ok(!names.includes('mccluster.media.generate'), 'raw provider tool leaked');
  });
});

test('tools/list strips upstream diagnostics', async () => {
  await withPlane({}, async () => {
    const { body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 6, method: 'tools/list' }), env, OWNER);
    const serialized = JSON.stringify(body);
    assert.equal(body.result._meta['mccluster/diagnostics'], undefined);
    assert.ok(!serialized.includes('ECONNREFUSED'), 'upstream error text leaked to a remote client');
    assert.ok(!serialized.includes('10.0.0.7'), 'internal host leaked to a remote client');
    assert.equal(body.result._meta['mccluster/surface'], 'remote-allowlist');
  });
});

test('tools/list preserves risk and approval metadata', async () => {
  await withPlane({}, async () => {
    const { body } = await handleCoreMcp(rpcRequest({ jsonrpc: '2.0', id: 7, method: 'tools/list' }), env, OWNER);
    const model3d = body.result.tools.find((tool) => tool.name === 'model3d.generate');
    assert.equal(model3d._meta['mccluster/risk'], 'spend');
    assert.equal(model3d._meta['mccluster/approval'], 'budget-gated');
    assert.deepEqual(model3d._meta['mccluster/providers'], ['fal']);
    const build = body.result.tools.find((tool) => tool.name === 'code.build');
    assert.equal(build._meta['mccluster/approval'], 'review-required');
  });
});

test('tools/call refuses a raw provider tool before dispatch', async () => {
  await withPlane({}, async (seen) => {
    const { status, body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'mccluster.media.generate', arguments: {} } }),
      env,
      OWNER
    );
    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /not exposed to remote clients/i);
    assert.ok(!seen.some((call) => call.href.includes('core.example.org')), 'refused tool reached Core');
  });
});

test('tools/call refuses a real but non-allowlisted capability', async () => {
  await withPlane({}, async (seen) => {
    const { body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'media.generate', arguments: {} } }),
      env,
      OWNER
    );
    assert.equal(body.result.isError, true);
    assert.ok(!seen.some((call) => call.href.includes('core.example.org')));
  });
});

test('tools/call forwards an allowlisted capability, signed', async () => {
  const called = { jsonrpc: '2.0', id: 10, result: { content: [{ type: 'text', text: '{"ok":true}' }] } };
  await withPlane({ broker: called }, async (seen) => {
    const { status, body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'system.health', arguments: {} } }),
      env,
      OWNER
    );
    assert.equal(status, 200);
    assert.equal(body.result.content[0].text, '{"ok":true}');

    const dispatch = seen.find((call) => call.href === 'https://core.example.org/mcp');
    assert.ok(dispatch, 'system.health was not dispatched to Core');
    assert.equal(dispatch.headers.authorization, 'Bearer broker-token');
    assert.equal(dispatch.headers['x-mccluster-edge-protocol'], 'mccluster-edge/v1');
    assert.ok(dispatch.headers['x-mccluster-signature'], 'dispatch was not signed');
    assert.ok(dispatch.headers['x-mccluster-nonce'], 'dispatch carried no nonce');
    assert.ok(dispatch.headers['x-mccluster-content-sha256'], 'dispatch carried no body digest');
  });
});

test('each dispatch carries a fresh nonce', async () => {
  await withPlane({ broker: { jsonrpc: '2.0', id: 11, result: {} } }, async (seen) => {
    const call = () => handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'system.health', arguments: {} } }),
      env,
      OWNER
    );
    await call();
    await call();
    const nonces = seen
      .filter((entry) => entry.href.endsWith('/mcp'))
      .map((entry) => entry.headers['x-mccluster-nonce']);
    assert.equal(nonces.length, 2);
    assert.notEqual(nonces[0], nonces[1], 'nonce was reused across dispatches');
  });
});

test('an unsupported MCP method is rejected', async () => {
  await withPlane({}, async (seen) => {
    const { status, body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 12, method: 'resources/list' }),
      env,
      OWNER
    );
    assert.equal(status, 400);
    assert.equal(body.error.code, -32601);
    assert.equal(seen.length, 0);
  });
});

test('Core rejecting the machine credential is reported as an edge fault', async () => {
  await withPlane({ broker: { error: 'Unauthorized' }, brokerStatus: 401 }, async () => {
    const { status, body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'system.health', arguments: {} } }),
      env,
      OWNER
    );
    assert.equal(status, 502, 'a Worker credential failure must not surface as the caller being unauthorized');
    assert.notEqual(status, 401);
    assert.notEqual(status, 403);
  });
});

test('the bridge fails closed when it is not provisioned', async () => {
  const unprovisioned = { ...env, CORE_BROKER_URL: '', CORE_BROKER_TOKEN: '' };
  await withPlane({}, async (seen) => {
    const { status } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'system.health', arguments: {} } }),
      unprovisioned,
      OWNER
    );
    assert.equal(status, 503);
    assert.ok(!seen.some((call) => call.href.includes('core.example.org')));
  });
});

test('a plaintext broker origin is refused', async () => {
  const plaintext = { ...env, CORE_BROKER_URL: 'http://core.example.org' };
  await withPlane({}, async () => {
    const { status, body } = await handleCoreMcp(
      rpcRequest({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'system.health', arguments: {} } }),
      plaintext,
      OWNER
    );
    assert.equal(status, 503);
    assert.match(body.error.message, /HTTPS/i);
  });
});

test('status is owner-gated', async () => {
  await withPlane({ role: null }, async () => {
    const { status } = await handleCoreStatus(new Request('https://api.mccluster.org/v1/core'), env, OWNER);
    assert.equal(status, 403);
  });
});

test('status reports the bridge and signed-dispatch state for an owner', async () => {
  await withPlane({ broker: { ok: true, service: 'mccluster-core-tool-broker', tools: 30 } }, async () => {
    const { status, body } = await handleCoreStatus(new Request('https://api.mccluster.org/v1/core'), env, OWNER);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.signed_dispatch, true);
    assert.equal(body.core.tools, 30);
  });
});
