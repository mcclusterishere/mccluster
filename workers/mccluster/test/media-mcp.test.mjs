import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMediaMcp, MCP_VERSION } from '../src/media/mcp.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function rpcRequest(method, params, id = 1, headers = {}) {
  return new Request('https://api.mccluster.org/v1/media/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-method': method, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
}

function withPlane({ role, grants }, fn) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('/rest/v1/org_members?')) return jsonResponse(role ? [{ org_id: ORG_ID, role }] : []);
    if (href.includes('/rest/v1/control_role_capabilities?')) return jsonResponse(grants);
    throw new Error(`Unexpected fetch: ${href}`);
  };
  __resetCapabilityCache();
  return Promise.resolve().then(() => fn(seen)).finally(() => {
    globalThis.fetch = original;
    __resetCapabilityCache();
  });
}

test('MCP_VERSION matches the canonical protocol contract', () => {
  assert.equal(MCP_VERSION, '2026-07-28');
});

test('tools/list needs no auth and exposes controlled media tools', async () => {
  const { status, body } = await handleMediaMcp(rpcRequest('tools/list', {}), env, null);
  assert.equal(status, 200);
  const names = body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('media.compare'));
  assert.ok(names.includes('media.generate'));
  assert.ok(names.includes('media.job.get'));
});

test('tools/call without a user is rejected before any tool runs', async () => {
  const { status, body } = await handleMediaMcp(
    rpcRequest('tools/call', { name: 'media.generate', arguments: { org_id: ORG_ID, model_id: 'model-1' } }),
    env,
    null
  );
  assert.equal(status, 401);
  assert.equal(body.error.code, -32001);
});

test('media.generate still enforces media.generate capability', async () => {
  await withPlane({ role: 'viewer', grants: [{ role: 'viewer', capability: 'media.generate', allowed: false }] }, async (seen) => {
    const { status, body } = await handleMediaMcp(
      rpcRequest('tools/call', {
        name: 'media.generate',
        arguments: { org_id: ORG_ID, model_id: 'model-1', prompt: 'test' }
      }),
      env,
      { id: 'user-1' }
    );
    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /does not include media\.generate/);
    assert.equal(seen.some((href) => href.includes('media_models')), false);
  });
});

test('an unknown tool name is a tool-result error, not a transport error', async () => {
  const { status, body } = await handleMediaMcp(
    rpcRequest('tools/call', { name: 'media.nonexistent', arguments: {} }),
    env,
    { id: 'user-1' }
  );
  assert.equal(status, 200);
  assert.equal(body.result.isError, true);
});

// ---- 2026-07-28 transport conformance -------------------------------------

test('server/discover advertises the supported version without a credential', async () => {
  const { status, body } = await handleMediaMcp(rpcRequest('server/discover', {}), env, null);
  assert.equal(status, 200);
  assert.deepEqual(body.result.protocolVersions, [MCP_VERSION]);
  assert.equal(body.result.serverInfo.name, 'mccluster-media');
});

test('every result carries resultType and identifies the server', async () => {
  const list = await handleMediaMcp(rpcRequest('tools/list', {}), env, null);
  assert.equal(list.body.result.resultType, 'complete');
  assert.ok(list.body.result._meta['io.modelcontextprotocol/serverInfo']);

  const call = await handleMediaMcp(
    rpcRequest('tools/call', { name: 'media.nonexistent', arguments: {} }), env, { id: 'user-1' }
  );
  assert.equal(call.body.result.resultType, 'complete');
});

test('tools/list is cacheable, so clients need not re-poll it every turn', async () => {
  const { body } = await handleMediaMcp(rpcRequest('tools/list', {}), env, null);
  assert.equal(typeof body.result.ttlMs, 'number');
  assert.equal(body.result.cacheScope, 'public');
});

test('a header that disagrees with the body is refused, not executed', async () => {
  // A gateway routing on Mcp-Method and this server executing on the body
  // must never be able to act on two different requests.
  const mismatched = await handleMediaMcp(
    rpcRequest('tools/list', {}, 1, { 'mcp-method': 'tools/call' }), env, null
  );
  assert.equal(mismatched.status, 400);
  assert.equal(mismatched.body.error.code, -32020);

  const wrongName = await handleMediaMcp(
    rpcRequest('tools/call', { name: 'media.generate', arguments: {} }, 1, { 'mcp-name': 'media.compare' }),
    env,
    { id: 'user-1' }
  );
  assert.equal(wrongName.status, 400);
  assert.equal(wrongName.body.error.code, -32020);
});

test('a base64-wrapped Mcp-Name is decoded before it is compared', async () => {
  const encoded = `=?base64?${Buffer.from('media.generate', 'utf8').toString('base64')}?=`;
  const { status } = await handleMediaMcp(
    rpcRequest('tools/call', { name: 'media.generate', arguments: {} }, 1, { 'mcp-name': encoded }),
    env,
    null
  );
  // Passes wire validation and stops at auth, not at a header mismatch.
  assert.equal(status, 401);
});

test('a protocol version this server does not implement is refused with its own', async () => {
  const { status, body } = await handleMediaMcp(
    rpcRequest('tools/list', {}, 1, { 'mcp-protocol-version': '2025-06-18' }), env, null
  );
  assert.equal(status, 400);
  assert.equal(body.error.code, -32022);
  assert.deepEqual(body.error.data.supported, [MCP_VERSION]);
});

test('an unimplemented method is 404 with -32601, not a bare 400', async () => {
  const { status, body } = await handleMediaMcp(rpcRequest('resources/list', {}), env, { id: 'user-1' });
  assert.equal(status, 404);
  assert.equal(body.error.code, -32601);
});

test('a notification gets 202 and no body', async () => {
  const request = new Request('https://api.mccluster.org/v1/media/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })
  });
  const { status, body } = await handleMediaMcp(request, env, null);
  assert.equal(status, 202);
  assert.equal(body, undefined);
});

// ---- semantic tools describe only what the Worker can actually execute ----

test('semantic tools do not advertise inputs no registered model can honour', async () => {
  const { body } = await handleMediaMcp(rpcRequest('tools/list', {}), env, null);
  const byName = Object.fromEntries(body.result.tools.map((tool) => [tool.name, tool]));

  // Exactly one text-to-audio model is registered and nothing reads `kind`,
  // so voice/music/sfx was a choice the surface could not honour.
  assert.equal(byName['audio.generate'].inputSchema.properties.kind, undefined);

  // No image-to-3d model is registered, and `target_format` had one legal
  // value that was never read.
  assert.equal(byName['model3d.generate'].inputSchema.properties.references, undefined);
  assert.equal(byName['model3d.generate'].inputSchema.properties.target_format, undefined);

  // Where references genuinely route somewhere, they stay advertised.
  assert.ok(byName['image.generate'].inputSchema.properties.references);
  assert.ok(byName['video.generate'].inputSchema.properties.references);
});

test('a duration the chosen model cannot accept fails before a job is reserved', async () => {
  const model = {
    id: 'model-video-1',
    provider: 'fal',
    provider_model_id: 'fal-ai/kling-video/v2.6/pro/text-to-video',
    display_name: 'Kling Video 2.6 Pro Text to Video',
    capability: 'text-to-video',
    commercial_use: true,
    health_state: 'healthy',
    quality_profile: { tier: 'premium' },
    // The registered model takes a string enum, while the tool takes a number.
    parameter_schema: { properties: { duration: { enum: ['5', '10'] } } }
  };

  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('capability=eq.text-to-video')) return jsonResponse([model]);
    throw new Error(`Unexpected fetch: ${href}`);
  };

  try {
    const { status, body } = await handleMediaMcp(
      rpcRequest('tools/call', {
        name: 'video.generate',
        arguments: { org_id: ORG_ID, prompt: 'a shot', duration_seconds: 7 }
      }),
      env,
      { id: 'user-1' }
    );
    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /duration must be one of "5", "10"/);
    // The cost reservation lives in media_create_budgeted_job_v2; a request
    // the provider would reject must never get that far.
    assert.equal(seen.some((href) => href.includes('media_create_budgeted_job')), false);
  } finally {
    globalThis.fetch = original;
  }
});
