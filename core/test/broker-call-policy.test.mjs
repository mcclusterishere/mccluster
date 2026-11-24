// The tool broker's per-call policy for stable capabilities, as a pure module:
// ai.chat images are validated at the edge of Core and turn into a vision
// requirement, a missing vision node answers AI_CHAT_NO_VISION_NODE instead of
// a generic binding error, and a capability whose interfaces exclude mcp is
// refused on the MCP path before any resolution (browser.act never reaches a
// remote client).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/capabilities/registry.mjs';
import { capabilityCallPolicy, mapCapabilityCallError, requireCapabilityInterface } from '../src/capabilities/call-policy.mjs';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const registry = new CapabilityRegistry({ toolRegistry: { async list() { return { tools: [], diagnostics: [], refreshedAt: 'now' }; }, async call() { throw new Error('unused'); } } });

test('ai.chat with images gains requirements.vision and keeps the caller options; without images nothing changes', () => {
  const withImage = capabilityCallPolicy(registry, 'ai.chat', { messages: [{ role: 'user', content: 'x', images: [PNG_1X1] }] }, { actor: { user_id: 'u' }, requirements: { chat: true } });
  assert.deepEqual(withImage.options, { actor: { user_id: 'u' }, requirements: { chat: true, vision: true } });
  assert.equal(withImage.vision, true);
  assert.equal(withImage.images, 1);
  const text = capabilityCallPolicy(registry, 'ai.chat', { prompt: 'x' }, { requirements: { chat: true } });
  assert.deepEqual(text.options, { requirements: { chat: true } });
  assert.equal(text.vision, false);
  const other = capabilityCallPolicy(registry, 'research.web', { objective: 'x' }, {});
  assert.deepEqual(other, { options: {}, vision: false, images: 0 });
  const unknown = capabilityCallPolicy(registry, 'not.a.capability', { images: ['x'] }, {});
  assert.equal(unknown.vision, false, 'raw tools are not policed here');
});

test('invalid ai.chat images are refused with their 400 codes before any resolution', () => {
  for (const [args, code] of [
    [{ messages: [{ role: 'user', content: 'x', images: ['%%%'] }] }, 'AI_CHAT_IMAGE_INVALID'],
    [{ prompt: 'x', images: [PNG_1X1] }, 'AI_CHAT_IMAGE_INVALID'],
    [{ messages: [{ role: 'user', content: 'x', images: [Buffer.from('GIF89a..........').toString('base64')] }] }, 'AI_CHAT_IMAGE_TYPE'],
    [{ messages: [{ role: 'user', content: 'x', images: [PNG_1X1, PNG_1X1, PNG_1X1, PNG_1X1, PNG_1X1] }] }, 'AI_CHAT_IMAGES_TOO_MANY']
  ]) {
    assert.throws(() => capabilityCallPolicy(registry, 'ai.chat', args, {}), (error) => error.code === code && error.status === 400);
  }
});

test('NO_CAPABILITY_BINDING for a vision request becomes AI_CHAT_NO_VISION_NODE (503, not retryable); other errors pass through', () => {
  const binding = Object.assign(new Error('No available implementation satisfies ai.chat'), { status: 503, code: 'NO_CAPABILITY_BINDING', detail: { capability: 'ai.chat', requirements: { vision: true } } });
  const mapped = mapCapabilityCallError(binding, { vision: true });
  assert.equal(mapped.code, 'AI_CHAT_NO_VISION_NODE');
  assert.equal(mapped.status, 503);
  assert.equal(mapped.retryable, false);
  assert.match(mapped.message, /vision/i);
  assert.deepEqual(mapped.detail, binding.detail);
  assert.equal(mapCapabilityCallError(binding, { vision: false }), binding, 'a text request keeps the generic code');
  const other = Object.assign(new Error('bad'), { status: 400, code: 'INPUT_REQUIRED' });
  assert.equal(mapCapabilityCallError(other, { vision: true }), other);
  const noLiveNode = Object.assign(new Error('No live compute node serves ai.chat/qwen3-vl.8b.local'), { status: 503, code: 'COMPUTE_NO_LIVE_NODE' });
  assert.equal(mapCapabilityCallError(noLiveNode, { vision: true }).code, 'AI_CHAT_NO_VISION_NODE', 'the last candidate going stale is the same answer');
});

test('the MCP path refuses a capability whose interfaces exclude mcp with 403 CAPABILITY_INTERFACE_REFUSED; others and raw tools pass', () => {
  assert.throws(() => requireCapabilityInterface(registry, 'browser.act', 'mcp'), (error) => {
    assert.equal(error.code, 'CAPABILITY_INTERFACE_REFUSED');
    assert.equal(error.status, 403);
    assert.match(error.message, /browser\.act/);
    return true;
  });
  assert.equal(requireCapabilityInterface(registry, 'browser.act', 'agent'), true);
  assert.equal(requireCapabilityInterface(registry, 'ai.chat', 'mcp'), true);
  assert.equal(requireCapabilityInterface(registry, 'mccluster.health', 'mcp'), true, 'not a stable capability: nothing to refuse here');
});

test('the loopback call route is the http and agent interface: workstream.checkpoint (mcp only) is refused there, browser.act and the rest pass', () => {
  assert.deepEqual(registry.get('workstream.checkpoint').interfaces, ['mcp'], 'only the MCP path carries the actor a checkpoint needs');
  assert.throws(() => requireCapabilityInterface(registry, 'workstream.checkpoint', ['http', 'agent']), (error) => {
    assert.equal(error.code, 'CAPABILITY_INTERFACE_REFUSED');
    assert.equal(error.status, 403);
    assert.match(error.message, /workstream\.checkpoint is not exposed over http or agent/);
    return true;
  });
  assert.equal(requireCapabilityInterface(registry, 'workstream.checkpoint', 'mcp'), true);
  assert.equal(requireCapabilityInterface(registry, 'workstream.list', ['http', 'agent']), true, 'the read is callable on the loopback (internal ceiling)');
  assert.equal(requireCapabilityInterface(registry, 'browser.act', ['http', 'agent']), true);
  assert.equal(requireCapabilityInterface(registry, 'ai.chat', ['http', 'agent']), true);
});

// The running broker, on the two paths that need no network: a stable
// capability outside the MCP interface is refused with its code, and an
// invalid ai.chat image is refused before any resolution.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('the running broker refuses browser.act over MCP and invalid ai.chat images before touching any upstream', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mccluster-broker-policy-'));
  const manifest = join(dir, 'deploy.json');
  await writeFile(manifest, JSON.stringify({ commit_sha: 'c'.repeat(40) }));
  const port = await unusedPort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/tool-broker.mjs', import.meta.url))], {
    env: { ...process.env, CORE_BROKER_HOST: '127.0.0.1', CORE_BROKER_PORT: String(port), CORE_BROKER_TOKEN: 'policy-test-token', CORE_EDGE_SIGNING_KEY: '', MCCLUSTER_DEPLOY_MANIFEST: manifest, MCCLUSTER_ORG_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000); });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`broker start timeout: ${stderr}`)), 15000);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`broker exited ${code}: ${stderr}`)); });
      child.stdout.on('data', (data) => { if (String(data).includes('core_tool_broker_ready')) { clearTimeout(timer); resolve(); } });
    });
    const call = async (name, args) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer policy-test-token' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: { 'mccluster/actor': { user_id: '00000000-0000-4000-8000-000000000009', kind: 'owner' } } } })
      });
      const body = await response.json();
      return { status: response.status, body, payload: JSON.parse(body.result.content[0].text) };
    };
    const refused = await call('browser.act', { actions: [{ type: 'done' }] });
    assert.equal(refused.status, 200);
    assert.equal(refused.body.result.isError, true);
    assert.equal(refused.payload.code, 'CAPABILITY_INTERFACE_REFUSED');
    assert.equal(refused.payload.status, 403);
    const image = await call('ai.chat', { messages: [{ role: 'user', content: 'x', images: ['not-base64!'] }] });
    assert.equal(image.body.result.isError, true);
    assert.equal(image.payload.code, 'AI_CHAT_IMAGE_INVALID');
    assert.equal(image.payload.status, 400);
    const topLevel = await call('ai.chat', { prompt: 'x', images: [PNG_1X1] });
    assert.equal(topLevel.payload.code, 'AI_CHAT_IMAGE_INVALID');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    await rm(dir, { recursive: true, force: true });
  }
});
