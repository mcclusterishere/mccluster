#!/usr/bin/env node
/* POST-DEPLOY SYNTHETIC CONTRACT CHECK for the remote MCP surface.
 *
 * Source tests prove the route exists in the tree that was built. This proves
 * it exists in the thing now answering the internet, which is a different
 * claim and the only one that matters to a connected client.
 *
 * The regression this catches: a deployment that is green, healthy, and
 * serving 404 where a connector used to be. Every check below is written as
 * the client experiences it.
 *
 *   1. OAuth protected-resource metadata is 200 and names an authorization
 *      server.
 *   2. initialize is 200 and negotiates exactly the protocol version already
 *      connected clients speak.
 *   3. unauthenticated tools/list is 401 WITH a WWW-Authenticate challenge —
 *      and explicitly NOT 404. A 404 is the outage signature: it tells the
 *      client the server is gone rather than that it needs to log in.
 *   4. health reports an exact 40-character deploy SHA, never "unknown". An
 *      unknown SHA means the running Worker cannot name its own commit, so no
 *      source/runtime parity claim about it can be trusted.
 *
 * Exit code is non-zero on any failure so a deploy pipeline stops.
 *
 *   node scripts/mcp-contract-check.mjs --base https://api.mccluster.org --sha <expected>
 */

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE = String(arg('base', process.env.MCP_CONTRACT_BASE || 'https://api.mccluster.org')).replace(/\/+$/, '');
const EXPECTED_SHA = arg('sha', process.env.GITHUB_SHA || '');
const PROTOCOL_VERSION = arg('protocol', '2025-11-25');
const TIMEOUT_MS = Number(arg('timeout', '15000'));
const RETRIES = Number(arg('retries', '6'));
const RETRY_DELAY_MS = Number(arg('retry-delay', '10000'));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; } }
  return { status: response.status, headers: response.headers, body };
}

/* Cloudflare propagation is not instant. Retrying only the first check keeps
   the rest honest: once the edge is serving the new build, everything else is
   a single observation with no second chances to paper over a real failure. */
async function waitForEdge() {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const health = await request('/healthz');
      if (health.status === 200) return health;
      console.log(`  edge attempt ${attempt}: /healthz ${health.status}`);
    } catch (error) {
      console.log(`  edge attempt ${attempt}: ${error.message}`);
    }
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  return null;
}

async function main() {
  console.log(`MCP contract check against ${BASE}\n`);

  const health = await waitForEdge();
  if (!health) {
    record('edge is reachable', false, `no 200 from /healthz after ${RETRIES} attempts`);
    return finish();
  }

  // 1. OAuth protected-resource discovery
  try {
    const meta = await request('/.well-known/oauth-protected-resource');
    const servers = meta.body?.authorization_servers;
    record(
      'GET /.well-known/oauth-protected-resource is 200 with an authorization server',
      meta.status === 200 && Array.isArray(servers) && servers.length > 0,
      `status=${meta.status} resource=${meta.body?.resource ?? '(none)'}`
    );
  } catch (error) {
    record('GET /.well-known/oauth-protected-resource is 200', false, error.message);
  }

  // 2. initialize handshake
  try {
    const init = await request('/v1/core/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    });
    const negotiated = init.body?.result?.protocolVersion;
    record(
      `POST initialize is 200 and negotiates ${PROTOCOL_VERSION}`,
      init.status === 200 && negotiated === PROTOCOL_VERSION,
      `status=${init.status} protocolVersion=${negotiated ?? '(none)'}`
    );
  } catch (error) {
    record('POST initialize is 200', false, error.message);
  }

  // 3. the outage signature: unauthenticated tools/list
  try {
    const unauth = await request('/v1/core/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    });
    const challenge = unauth.headers.get('www-authenticate') || '';

    record(
      'unauthenticated tools/list is NOT 404 (the connector-gone signature)',
      unauth.status !== 404,
      `status=${unauth.status}`
    );
    record(
      'unauthenticated tools/list is 401 with an OAuth WWW-Authenticate challenge',
      unauth.status === 401 && /^Bearer /.test(challenge) && challenge.includes('resource_metadata='),
      `status=${unauth.status} www-authenticate=${challenge || '(none)'}`
    );
  } catch (error) {
    record('unauthenticated tools/list challenges correctly', false, error.message);
  }

  // 4. the running Worker must be able to name its own commit
  try {
    const sha = health.body?.deployment_sha;
    const exact = typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha);
    record(
      'health reports an exact deploy SHA, never "unknown"',
      exact,
      `deployment_sha=${sha ?? '(absent)'}`
    );
    if (EXPECTED_SHA) {
      record(
        'the deployed SHA is the commit this run built',
        sha === EXPECTED_SHA,
        `expected=${EXPECTED_SHA} deployed=${sha ?? '(absent)'}`
      );
    }
  } catch (error) {
    record('health reports an exact deploy SHA', false, error.message);
  }

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error('\nMCP contract check FAILED:');
    for (const failure of failed) console.error(`  - ${failure.name} (${failure.detail})`);
    console.error('\nThe remote MCP surface is not serving its contract. Roll back or fix before relying on it.');
    process.exit(1);
  }
  console.log('Remote MCP contract verified.');
}

main().catch((error) => {
  console.error(`MCP contract check crashed: ${error.message}`);
  process.exit(1);
});
