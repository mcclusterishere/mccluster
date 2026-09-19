import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../js/control-room-v2.js', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../workers/mccluster-mcp/src/mcp.js', import.meta.url), 'utf8');
const catalog = JSON.parse(await readFile(new URL('../../core/capabilities/catalog.json', import.meta.url), 'utf8'));

test('Operator OS commands the signed Core MCP surface, not the legacy task route', () => {
  assert.match(source, /request\("\/v1\/core\/mcp"/);
  assert.match(source, /coreMcp\("tools\/list"\)/);
  assert.match(source, /callCoreTool\("objective\.plan"/);
  assert.match(source, /callCoreTool\("ai\.chat"/);
  assert.match(source, /callCoreTool\("compute\.task\.get"/);
  assert.match(source, /callCoreTool\("core\.resume"/);
  assert.match(source, /callCoreTool\("research\.web"/);
  assert.doesNotMatch(source, /request\("\/v1\/ai\/task"/);
});

test('Operator OS exposes a command-center system surface', () => {
  assert.match(source, /SYSTEM_VIEWS = \["command", "overview", "workload", "observability", "resources"\]/);
  assert.match(source, /function renderCommandCenter\(\)/);
  assert.match(source, /Signed Cloudflare → Core MCP/);
  assert.match(source, /same capability bus used by agents/);
});

test('home AI is durable: the UI polls the canonical compute task result', () => {
  assert.match(source, /function waitForComputeTask\(/);
  assert.match(source, /task\.status === "done"/);
  assert.match(source, /task\.status === "failed" \|\| task\.status === "canceled"/);
});

test('edge allowlist and capability catalog carry the command spine', () => {
  for (const capability of ['core.resume', 'ai.chat', 'compute.task.get', 'objective.plan', 'research.web']) {
    assert.ok(mcp.includes(`'${capability}'`), `edge allowlist missing ${capability}`);
    assert.ok(catalog.capabilities.some((entry) => entry.id === capability), `catalog missing ${capability}`);
  }
  assert.ok(catalog.bindings.some((entry) => entry.capability === 'compute.task.get' && entry.status === 'active'));
  assert.ok(catalog.bindings.some((entry) => entry.capability === 'objective.plan' && entry.status === 'active'));
});


test('owner approvals stay human-gated at Cloudflare', () => {
  assert.match(source, /\/v1\/ai\/approvals\/.*\/decision/);
  assert.match(source, /data-action="approval-decide"/);
  assert.match(source, /pending_approvals/);
});
