/* Audit C5 (remaining work, 2026-11-09): ToolRegistry.call dropped its options
   on the mcp-http hop, so a caller-scoped operation id never reached
   callMcpTool and the same logical call minted a fresh core:<uuid> each time,
   two paid operations on the Worker for one job step. These tests pin the id
   end to end through the registry, the job-scoped composer and its 128-char
   bound. The Supabase/Worker plane is a fetch stub; nothing leaves the process. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, mcpTransportOptions } from '../src/tools/registry.mjs';
import { scopedOperationId } from '../src/tools/mcp-http.mjs';

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY = 'TEST_CORE_SIGNING_KEY_REG';
const SIGNED = { id: 'mccluster-media', namespace: 'mccluster', url: 'https://api.mccluster.org/v1/media/mcp', signEnv: KEY };
const THIRD = { id: 'third', namespace: 'third', url: 'https://example.com/mcp' };
const ARGS = Object.freeze({ org_id: 'o', model_id: 'm', prompt: 'p' });
/* What the broker really passes today (tool-broker.mjs, capabilities/registry.mjs). */
const BROKER = Object.freeze({ actor: { user_id: 'u', kind: 'owner', source: 'signed-edge' }, source: 'capability:media.generate', requirements: {} });

const rpc = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });

/* Every server answers tools/list with one tool; tools/call is captured. */
function plane(onCall = () => ({ content: [] })) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'tools/list') return rpc(body.id, { tools: [{ name: 'media.generate', inputSchema: { type: 'object' } }] });
    calls.push({ url: String(url), headers: init.headers, body });
    return rpc(body.id, onCall(calls.length, body));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const registry = (servers) => new ToolRegistry({ mcpServers: servers, httpTools: [], localTools: [], computeDiscovery: null });
const wireIds = (p) => p.calls.map((c) => c.body.params.arguments.operation_id);

test('registry.call forwards a caller-scoped operation id to a signed server: same for the same logical call, distinct per step', async () => {
  process.env[KEY] = 'k';
  const p = plane();
  try {
    const r = registry([SIGNED]);
    await r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0' });
    await r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0' });
    await r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:1' });
    assert.deepEqual(wireIds(p), ['core:job-1:0', 'core:job-1:0', 'core:job-1:1']);
    assert.deepEqual(p.calls[0].body.params.arguments, { ...ARGS, operation_id: 'core:job-1:0' });
    assert.equal(p.calls[0].body.params.name, 'media.generate');
    assert.ok(p.calls[0].headers['x-mccluster-nonce'], 'the call is signed');
    assert.notEqual(p.calls[0].headers['x-mccluster-nonce'], p.calls[1].headers['x-mccluster-nonce'], 'new envelope, same operation');
  } finally { p.restore(); delete process.env[KEY]; }
});

test('an explicit args.operation_id still wins over the forwarded scoped id', async () => {
  process.env[KEY] = 'k';
  const p = plane();
  try {
    await registry([SIGNED]).call('mccluster.media.generate', { ...ARGS, operation_id: 'owner:explicit-7' }, { ...BROKER, operationId: 'core:job-1:0' });
    assert.deepEqual(wireIds(p), ['owner:explicit-7']);
  } finally { p.restore(); delete process.env[KEY]; }
});

test('a transport retry through the registry keeps the forwarded id and takes a fresh nonce', async () => {
  process.env[KEY] = 'k';
  const p = plane((n) => { if (n === 1) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); return { job: { id: 'j' } }; });
  try {
    const out = await registry([SIGNED]).call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0' });
    assert.deepEqual(out.result, { job: { id: 'j' } });
    assert.equal(out.transport, 'mcp-http');
    assert.deepEqual(wireIds(p), ['core:job-1:0', 'core:job-1:0']);
    assert.notEqual(p.calls[0].headers['x-mccluster-nonce'], p.calls[1].headers['x-mccluster-nonce']);
  } finally { p.restore(); delete process.env[KEY]; }
});

test('an unsigned third-party server gets untouched arguments even when a scoped id is offered; operationIds opts it in', async () => {
  process.env[KEY] = 'k';
  const p = plane();
  try {
    const r = registry([SIGNED, THIRD]);
    await r.call('third.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0' });
    assert.deepEqual(p.calls[0].body.params.arguments, ARGS);
    assert.equal('operation_id' in p.calls[0].body.params.arguments, false);
    assert.equal(p.calls[0].headers['x-mccluster-nonce'], undefined, 'no Core signature for a third party');
    await r.call('third.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0', operationIds: true });
    assert.equal(p.calls[1].body.params.arguments.operation_id, 'core:job-1:0');
    await r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0' });
    assert.equal(p.calls[2].body.params.arguments.operation_id, 'core:job-1:0', 'the signed server in the same registry still carries it');
  } finally { p.restore(); delete process.env[KEY]; }
});

test('only the options the transport understands cross the hop; broker context stays behind, and retries/timeoutMs are honoured', async () => {
  assert.deepEqual(
    mcpTransportOptions({ ...BROKER, operationId: 'core:j:0', operationIds: true, retries: 0, timeoutMs: 500 }),
    { operationId: 'core:j:0', operationIds: true, retries: 0, timeoutMs: 500 }
  );
  assert.deepEqual(mcpTransportOptions(BROKER), {});
  assert.deepEqual(mcpTransportOptions(undefined), {});
  assert.deepEqual(mcpTransportOptions({ operationId: undefined, retries: undefined }), {});
  assert.equal('actor' in mcpTransportOptions({ ...BROKER, operationId: 'core:j:0' }), false);

  process.env[KEY] = 'k';
  const p = plane(() => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
  try {
    await assert.rejects(registry([SIGNED]).call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'core:job-1:0', retries: 0 }), /timeout/);
    assert.equal(p.calls.length, 1, 'retries: 0 reached mcpRpc through the registry');
  } finally { p.restore(); delete process.env[KEY]; }
});

test('a malformed or over-long scoped id is refused before any request leaves', async () => {
  process.env[KEY] = 'k';
  const p = plane();
  try {
    const r = registry([SIGNED]);
    await assert.rejects(r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: `core:${'x'.repeat(130)}` }), /operation_id/);
    await assert.rejects(r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: 'has space' }), /operation_id/);
    await assert.rejects(r.call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: ':leading-colon' }), /operation_id/);
    assert.equal(p.calls.length, 0);
  } finally { p.restore(); delete process.env[KEY]; }
});

test('scopedOperationId composes core:<job>:<step>: deterministic, distinct per step and per job, strict about its parts', () => {
  assert.equal(scopedOperationId('studio-1', 0), 'core:studio-1:0');
  assert.equal(scopedOperationId('studio-1', 0), scopedOperationId('studio-1', 0));
  assert.notEqual(scopedOperationId('studio-1', 0), scopedOperationId('studio-1', 1));
  assert.notEqual(scopedOperationId('studio-1', 0), scopedOperationId('studio-2', 0));
  const uuid = '3ecea177-5a1e-4b1c-9c7d-0f2a6b8e4d11';
  assert.equal(scopedOperationId(uuid, 5), `core:${uuid}:5`);
  assert.equal(scopedOperationId(uuid, 5).length, 43);
  assert.throws(() => scopedOperationId('', 0), /job id/);
  assert.throws(() => scopedOperationId(undefined, 0), /job id/);
  assert.throws(() => scopedOperationId('job', ''), /step/);
  assert.throws(() => scopedOperationId('job', 'a:b'), /step/, 'the step never carries ":" so the last ":" always separates scope from step');
  assert.throws(() => scopedOperationId('job', 'x'.repeat(33)), /step/);
});

test('length bound: a scope that would push the id past 128 chars is shortened with a hash; the step survives and distinct scopes stay distinct', async () => {
  const fits = 'a'.repeat(121); /* "core:" + 121 + ":0" = 128, the Worker's limit */
  assert.equal(scopedOperationId(fits, 0), `core:${fits}:0`);
  assert.equal(scopedOperationId(fits, 0).length, 128);

  const long = 'b'.repeat(122);
  const id = scopedOperationId(long, 7);
  assert.ok(id.length <= 128, `${id.length} chars`);
  assert.match(id, OPERATION_ID);
  assert.ok(id.startsWith('core:b'), 'a readable head of the scope is kept');
  assert.ok(id.endsWith(':7'), 'the distinguishing step is never cut');
  assert.equal(id, scopedOperationId(long, 7), 'deterministic');
  assert.notEqual(id, scopedOperationId(long, 8));
  const sibling = scopedOperationId(`${long}c`, 7);
  assert.notEqual(id, sibling, 'scopes that share their first 122 chars still get distinct ids');
  assert.notEqual(id.slice(0, -2), sibling.slice(0, -2), 'they differ in the scope part, not only the step');

  const huge = scopedOperationId('z'.repeat(5000), 'final');
  assert.ok(huge.length <= 128);
  assert.match(huge, OPERATION_ID);
  assert.ok(huge.endsWith(':final'));

  const slashed = scopedOperationId('jobs/2026/11', 0);
  assert.match(slashed, OPERATION_ID);
  assert.ok(slashed.endsWith(':0'));
  assert.notEqual(slashed, scopedOperationId('jobs-2026-11', 0), 'sanitising never collapses two scopes into one id');
  assert.equal(scopedOperationId('jobs-2026-11', 0), 'core:jobs-2026-11:0');

  process.env[KEY] = 'k';
  const p = plane();
  try {
    await registry([SIGNED]).call('mccluster.media.generate', { ...ARGS }, { ...BROKER, operationId: id });
    assert.deepEqual(wireIds(p), [id], 'the shortened id is accepted by the transport and reaches the wire');
  } finally { p.restore(); delete process.env[KEY]; }
});
