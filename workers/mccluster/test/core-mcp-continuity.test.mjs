/* CONTROL-PLANE CONTINUITY: the remote MCP surface cannot silently vanish.
 *
 * This file exists because it already happened. The Core MCP bridge shipped,
 * Claude connected to it and saw ten tools, and a later Worker deployment from
 * a main that never carried `/v1/core/mcp` replaced that Worker with one where
 * the route simply did not exist. Nothing failed loudly: the deploy was green,
 * health was 200, and the only symptom was a 404 where a connector used to be.
 *
 * `.github/workflows/deploy-mccluster-worker.yml` deploys on every push
 * touching `workers/mccluster/**`, so any change in this directory can carry
 * that regression to production. These tests run before the deploy step. A
 * source tree that has lost the MCP or OAuth surface fails here and never
 * reaches Cloudflare.
 *
 * Two layers deliberately:
 *   - source assertions, because the failure mode was a missing route/import,
 *     which is a property of the file rather than of a function;
 *   - runtime assertions against the real handlers, because a route that is
 *     wired but answers the wrong thing is the same outage with extra steps.
 *
 * If you are here because this file failed: do not delete the assertion. The
 * route it names is a production connector contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { handleCoreMcp } from '../src/core/mcp.js';
import {
  CORE_MCP_RESOURCE,
  CORE_MCP_RESOURCE_METADATA,
  coreOAuthChallenge,
  coreOAuthMetadata,
  coreOAuthMetadataResponse
} from '../src/core/oauth-resource.js';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..');
const repoRoot = resolve(workerRoot, '..', '..');

const PROTOCOL_VERSION = '2025-11-25';

const read = (path) => readFile(resolve(repoRoot, path), 'utf8');
const entry = () => read('workers/mccluster/src/entry.js');

/* ---------- the routes must be wired ---------- */

test('entry.js imports the Core MCP and OAuth handlers', async () => {
  const source = await entry();
  assert.match(source, /import\s*\{[^}]*handleCoreMcp[^}]*\}\s*from\s*'\.\/core\/mcp\.js'/,
    'handleCoreMcp import is missing — the MCP route cannot work without it');
  assert.match(source, /import\s*\{[^}]*coreOAuthChallenge[^}]*\}\s*from\s*'\.\/core\/oauth-resource\.js'/,
    'coreOAuthChallenge import is missing — unauthenticated callers would get a bare 401 or 404');
  assert.match(source, /coreOAuthMetadataResponse/,
    'coreOAuthMetadataResponse import is missing — OAuth discovery would 404');
});

test('entry.js serves every route the connector depends on', async () => {
  const source = await entry();
  for (const [route, pattern] of [
    ['/v1/core/mcp', /path === '\/v1\/core\/mcp'/],
    ['/v1/core', /path === '\/v1\/core'/],
    ['/.well-known/oauth-protected-resource', /oauth-protected-resource/]
  ]) {
    assert.match(source, pattern, `${route} is not routed in entry.js`);
  }
});

test('the MCP route answers an unauthenticated caller with an OAuth challenge, not a 404', async () => {
  const source = await entry();
  /* The specific regression: a 404 tells an MCP client the server does not
     exist, so it gives up. A 401 carrying resource metadata tells it where to
     authenticate, which is what makes the connector self-healing. */
  assert.match(
    source,
    /if \(status === 401\) return coreOAuthChallenge\(request, env, body\)/,
    'the 401 path must return the OAuth challenge so clients can discover the authorization server'
  );
});

test('the Core MCP source files exist and are non-trivial', async () => {
  for (const path of ['workers/mccluster/src/core/mcp.js', 'workers/mccluster/src/core/oauth-resource.js']) {
    const source = await read(path);
    assert.ok(source.length > 500, `${path} is missing or has been emptied`);
  }
});

/* ---------- the contract the client already speaks ---------- */

test('the protocol version stays exactly the one working clients negotiated', async () => {
  const source = await read('workers/mccluster/src/core/mcp.js');
  assert.match(source, new RegExp(`MCP_VERSION = '${PROTOCOL_VERSION}'`),
    `protocol must remain ${PROTOCOL_VERSION}; changing it breaks connected clients`);

  const response = await handleCoreMcp(
    new Request('https://api.mccluster.org/v1/core/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    }),
    {},
    null
  );
  assert.equal(response.status, 200, 'initialize must succeed before authentication');
  assert.equal(response.body.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(response.body.result.serverInfo.name, 'mccluster-core');
});

test('tools/list without a user is 401 — never 404, never a silent success', async () => {
  const response = await handleCoreMcp(
    new Request('https://api.mccluster.org/v1/core/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    }),
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' },
    null
  );
  assert.equal(response.status, 401);
  assert.notEqual(response.status, 404);
  assert.equal(response.body.error.code, -32001);
});

test('the OAuth challenge carries resource metadata a client can follow', () => {
  const challenge = coreOAuthChallenge(
    new Request('https://api.mccluster.org/v1/core/mcp'),
    {},
    { error: 'Authentication required' }
  );
  assert.equal(challenge.status, 401);
  const header = challenge.headers.get('www-authenticate');
  assert.ok(header, 'a 401 without WWW-Authenticate gives the client nowhere to go');
  assert.match(header, /^Bearer /);
  assert.match(header, new RegExp(`resource_metadata="${CORE_MCP_RESOURCE_METADATA}"`));
});

test('OAuth protected-resource metadata is complete and points at the real authorization server', async () => {
  const metadata = coreOAuthMetadata();
  assert.equal(metadata.resource, CORE_MCP_RESOURCE);
  assert.ok(Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0);
  assert.match(metadata.authorization_servers[0], /supabase\.co\/auth\/v1$/);

  const response = coreOAuthMetadataResponse();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*',
    'discovery is fetched cross-origin by MCP clients');
});

/* ---------- authorization and exposure ---------- */

test('owner-only authorization and signed dispatch are still in the bridge', async () => {
  const source = await read('workers/mccluster/src/core/mcp.js');
  assert.match(source, /role=eq\.owner/, 'the house-owner gate is missing');
  assert.match(source, /slug=eq\.mccluster/, 'the house org lookup is missing');
  assert.match(source, /HMAC/, 'the Worker→Core signing key usage is missing');
  assert.match(source, /x-mccluster-signature/, 'signed dispatch headers are missing');
  assert.match(source, /x-mccluster-nonce/, 'replay protection is missing');
});

test('the remote allowlist is enforced and still carries media.job.get', async () => {
  const source = await read('workers/mccluster/src/core/mcp.js');
  assert.match(source, /REMOTE_CAPABILITIES = new Set\(/);
  for (const capability of [
    'core.resume', 'system.health', 'media.job.get', 'media.models.search',
    'image.generate', 'video.generate', 'audio.generate', 'model3d.generate', 'world.generate'
  ]) {
    assert.ok(source.includes(`'${capability}'`), `${capability} dropped out of the remote allowlist`);
  }
  assert.match(source, /if \(!REMOTE_CAPABILITIES\.has\(name\)\)/,
    'tools/call must refuse names outside the allowlist before dispatch');
  assert.match(source, /restrictToolList/,
    'tools/list must filter raw provider tools out of the remote surface');
});

test('a tools/call for a non-allowlisted capability never reaches Core', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ id: 'org-1' }]), { status: 200 });
  };
  try {
    const response = await handleCoreMcp(
      new Request('https://api.mccluster.org/v1/core/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'mccluster.media.generate', arguments: {} }
        })
      }),
      { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', CORE_BROKER_URL: 'https://core.mccluster.org', CORE_BROKER_TOKEN: 't' },
      { id: 'user-1' }
    );
    assert.equal(response.body.result.isError, true);
    assert.match(response.body.result.content[0].text, /not exposed to remote clients/);
    assert.equal(calls.filter((url) => url.includes('core.mccluster.org')).length, 0,
      'a raw provider tool name must never be dispatched to Core');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ---------- deployment configuration ---------- */

test('the Worker ships CORE_BROKER_URL, without which the bridge is dead on arrival', async () => {
  const wrangler = await read('workers/mccluster/wrangler.toml');
  assert.match(wrangler, /^CORE_BROKER_URL = "https:\/\/core\.mccluster\.org"$/m,
    'CORE_BROKER_URL must be in [vars]; wrangler deploy uploads that block, and the route 503s without it');
  /* The two credentials stay secrets. If either appears here, it has been
     committed to a public repository. */
  assert.doesNotMatch(wrangler, /CORE_BROKER_TOKEN\s*=/, 'CORE_BROKER_TOKEN must never be a var');
  assert.doesNotMatch(wrangler, /CORE_EDGE_SIGNING_KEY\s*=/, 'CORE_EDGE_SIGNING_KEY must never be a var');
});

test('the deploy workflow guards before deploying, and verifies after', async () => {
  const workflow = await read('.github/workflows/deploy-mccluster-worker.yml');
  const guard = workflow.indexOf('core-mcp-continuity');
  const upload = workflow.indexOf('versions upload');
  const promote = workflow.indexOf('--version-tag');
  const check = workflow.indexOf('mcp-contract-check');

  assert.ok(guard > 0, 'the continuity guard is not run by the deploy workflow');
  assert.ok(upload > 0, 'the staged version upload step is missing');
  assert.ok(promote > 0, 'the promote step is missing');
  assert.ok(check > 0, 'the post-deploy synthetic contract check is not wired in');
  assert.ok(guard < upload && upload < promote && promote < check,
    'order must be guard -> upload -> promote -> verify; a guard after the deploy prevents nothing');
});

test('a failed verification rolls production back instead of leaving a bad build serving', async () => {
  const workflow = await read('.github/workflows/deploy-mccluster-worker.yml');
  /* The whole point of separating upload from promote: without a recorded
     rollback target and an automatic revert, a post-deploy check can only
     report that production is already broken. */
  assert.match(workflow, /deployments list --json/,
    'the previously serving version must be recorded before traffic moves');
  assert.match(workflow, /if: failure\(\) && steps\.rollback_target\.outputs\.version_id != ''/,
    'there is no automatic rollback on verification failure');
  assert.match(workflow, /Automatic rollback from/,
    'the rollback step does not promote the previous version');

  const promote = workflow.indexOf('--version-tag');
  const rollback = workflow.indexOf('Roll back to the last known-good');
  assert.ok(rollback > promote, 'the rollback step must come after promotion');
});

test('provenance stamping survives the staged flow', async () => {
  const workflow = await read('.github/workflows/deploy-mccluster-worker.yml');
  /* The SHA is stamped on `versions upload`, not on a plain `deploy`. If
     this moves and nobody notices, /healthz goes back to reporting
     "unknown" and the contract check's fourth assertion starts failing. */
  const upload = workflow.slice(workflow.indexOf('versions upload'), workflow.indexOf('Promote the new version'));
  assert.match(upload, /--var DEPLOY_SHA:\$\{GITHUB_SHA\}/, 'DEPLOY_SHA is not stamped on the uploaded version');
  assert.match(upload, /--tag \$\{GITHUB_SHA\}/, 'the version is not tagged with the commit, so promote cannot resolve it');
});
