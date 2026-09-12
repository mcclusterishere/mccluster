// media/mcp.js is a thin re-entry into router.js/orchestrator.js/recommend.js,
// built the same way orchestrator.js already builds a synthetic Request to
// reuse createGeneration for a bakeoff leg. These tests exist to prove that
// re-entry actually holds: no auth is skipped, and every tool answers the
// exact JSON-RPC shape a real MCP client expects, not this repo's own
// envelope conventions.

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMediaMcp, MCP_VERSION } from '../src/media/mcp.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function rpcRequest(method, params, id = 1) {
  return new Request('https://api.mccluster.org/v1/media/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-method': method },
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

test('MCP_VERSION matches the one protocol this codebase speaks', () => {
  assert.equal(MCP_VERSION, '2026-07-28');
});

test('tools/list needs no auth and names Director Compare', async () => {
  const { status, body } = await handleMediaMcp(rpcRequest('tools/list', {}), env, null);
  assert.equal(status, 200);
  const names = body.result.tools.map((t) => t.name);
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

test('media.generate still enforces the media.generate capability, not just membership', async () => {
  await withPlane({ role: 'viewer', grants: [{ role: 'viewer', capability: 'media.generate', allowed: false }] }, async (seen) => {
    const { status, body } = await handleMediaMcp(
      rpcRequest('tools/call', {
        name: 'media.generate',
        arguments: { org_id: ORG_ID, model_id: 'model-1', prompt: 'test' }
      }),
      env,
      { id: 'user-1' }
    );
    // The transport call itself succeeds (200, valid JSON-RPC) — the
    // denial surfaces as a tool result the model can read, same as any
    // other tool failure.
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
