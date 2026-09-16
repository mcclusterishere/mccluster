import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/entry.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
  CORE_BROKER_URL: 'https://core.test', CORE_BROKER_TOKEN: 'test', CORE_EDGE_SIGNING_KEY: 'test',
  CORE_MCP_RESOURCE_METADATA: 'https://mcp.mccluster.org/.well-known/oauth-protected-resource' };
const rpc = (method, params = {}, headers = {}) => new Request('https://mcp.mccluster.org/mcp', {
  method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
});
test('new and compatibility endpoints initialize without credentials or upstream calls', async () => {
  globalThis.fetch = () => { throw new Error('unexpected upstream request'); };
  for (const path of ['/mcp', '/v1/core/mcp']) {
    const result = await worker.fetch(new Request(`https://mcp.mccluster.org${path}`, rpc('initialize')), {});
    assert.equal(result.status, 200);
    assert.equal((await result.json()).result.protocolVersion, '2025-11-25');
  }
});
test('unauthenticated clients discover OAuth even before secret provisioning', async () => {
  const result = await worker.fetch(rpc('tools/list'), {});
  assert.equal(result.status, 401);
  assert.match(result.headers.get('www-authenticate'), /resource_metadata=/);
});
test('the new host preserves the authorized resource identity and supplies its own discovery URL', async () => {
  const result = await worker.fetch(new Request('https://mcp.mccluster.org/.well-known/oauth-protected-resource'), env);
  assert.equal((await result.json()).resource, 'https://api.mccluster.org/v1/core/mcp');
  const challenge = await worker.fetch(rpc('tools/list'), env);
  assert.match(challenge.headers.get('www-authenticate'), /https:\/\/mcp.mccluster.org\//);
});
test('a mismatched method header cannot turn a handshake into a tool call', async () => {
  const result = await worker.fetch(rpc('tools/call', {}, { 'mcp-method': 'initialize' }), env);
  assert.equal(result.status, 400);
});
test('an owner lookup error cannot authorize dispatch', async () => {
  let dispatched = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/')) return Response.json({ id: 'owner' });
    if (String(url).includes('/orgs?')) return Response.json([{ id: 'org' }]);
    if (String(url).includes('/org_members?')) return Response.json([{ org_id: 'org' }], { status: 500 });
    dispatched = true;
    return Response.json({});
  };
  const result = await worker.fetch(rpc('tools/list', {}, { authorization: 'Bearer test' }), env);
  assert.equal(result.status, 503);
  assert.equal(dispatched, false);
});
test('missing signing key fails closed before Core receives a request', async () => {
  let dispatched = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/')) return Response.json({ id: 'owner' });
    if (String(url).includes('/orgs?')) return Response.json([{ id: 'org' }]);
    if (String(url).includes('/org_members?')) return Response.json([{ org_id: 'org' }]);
    dispatched = true;
    return Response.json({});
  };
  const result = await worker.fetch(rpc('tools/list', {}, { authorization: 'Bearer test' }), { ...env, CORE_EDGE_SIGNING_KEY: '' });
  assert.equal(result.status, 503);
  assert.equal(dispatched, false);
});
test('no media, billing, social, or arbitrary proxy routes exist on the transport', async () => {
  for (const path of ['/v1/media/models', '/v1/billing', '/v1/social', '/proxy']) {
    assert.equal((await worker.fetch(new Request(`https://mcp.mccluster.org${path}`), env)).status, 404);
  }
});
test('health identifies the transport and exact source version', async () => {
  const result = await worker.fetch(new Request('https://mcp.mccluster.org/healthz'), { DEPLOY_SHA: 'a'.repeat(40) });
  assert.equal((await result.json()).deployment_sha, 'a'.repeat(40));
});
