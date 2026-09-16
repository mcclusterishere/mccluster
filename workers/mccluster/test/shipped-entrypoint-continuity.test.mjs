/* The deployable Worker is entry-platform.js, not entry.js.
 *
 * core-mcp-continuity.test.mjs pins routes on entry.js. That is necessary
 * and not sufficient: wrangler.toml main is entry-platform.js. A wrapper
 * that stops falling through to existing.fetch can 404 /v1/core/mcp while
 * every entry.js assertion still passes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFile(resolve(repoRoot, path), 'utf8');

test('wrangler ships entry-platform.js, which must fall through to entry.js', async () => {
  const wrangler = await read('workers/mccluster/wrangler.toml');
  const platform = await read('workers/mccluster/src/entry-platform.js');
  assert.match(wrangler, /^main = "src\/entry-platform\.js"$/m,
    'the deployed Worker entry is entry-platform.js; changing it without updating these tests hides MCP behind the wrong file');
  assert.match(platform, /import existing from '\.\/entry\.js'/,
    'the platform wrapper must import the compatibility entry that owns /v1/core/mcp');
  assert.match(platform, /return existing\.fetch\(request, env, ctx\)/,
    'unhandled platform paths must fall through; otherwise MCP 404s on the shipped entry');
  assert.doesNotMatch(platform, /\/v1\/core\/mcp/,
    'the wrapper must not claim the MCP route itself; that belongs in entry.js until MCP_EDGE is activated');
});

test('MCP_EDGE is not bound on the API Worker yet', async () => {
  const wrangler = await read('workers/mccluster/wrangler.toml');
  assert.doesNotMatch(wrangler, /binding\s*=\s*"MCP_EDGE"/,
    'binding MCP_EDGE before mccluster-mcp exists in the account will fail the API Worker deploy');
  assert.match(wrangler, /MCP_EDGE service binding is intentionally absent/,
    'the activation comment must stay so the next PR does not guess the binding');
});

test('health on the shipped entry reports deployment_sha so the contract check can trip on unknown', async () => {
  const platform = await read('workers/mccluster/src/entry-platform.js');
  assert.match(platform, /deployment_sha: env\.DEPLOY_SHA \|\| 'unknown'/,
    'the live /healthz the contract check hits is the platform wrapper');
});
