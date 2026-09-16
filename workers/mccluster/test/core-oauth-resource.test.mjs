import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_MCP_RESOURCE,
  CORE_MCP_RESOURCE_METADATA,
  SUPABASE_AUTHORIZATION_SERVER,
  coreOAuthChallenge,
  coreOAuthMetadata,
  coreOAuthMetadataResponse
} from '../src/core/oauth-resource.js';

test('protected resource metadata points Core MCP at Supabase Auth', async () => {
  const metadata = coreOAuthMetadata();
  assert.equal(metadata.resource, CORE_MCP_RESOURCE);
  assert.deepEqual(metadata.authorization_servers, [SUPABASE_AUTHORIZATION_SERVER]);
  assert.deepEqual(metadata.scopes_supported, ['email']);

  const response = coreOAuthMetadataResponse();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(await response.json(), metadata);
});

test('401 challenge advertises protected resource metadata', async () => {
  const request = new Request(CORE_MCP_RESOURCE, {
    method: 'POST',
    headers: { origin: 'https://matthew.mccluster.org' }
  });
  const body = {
    jsonrpc: '2.0',
    id: 2,
    error: { code: -32001, message: 'Authentication required' }
  };
  const response = coreOAuthChallenge(request, {}, body);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    response.headers.get('www-authenticate'),
    `Bearer resource_metadata="${CORE_MCP_RESOURCE_METADATA}", scope="email"`
  );
  assert.deepEqual(await response.json(), body);
});
