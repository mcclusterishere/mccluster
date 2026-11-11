/* Audit C5 (remaining work, 2026-11-09): Core's MCP client minted a fresh
   nonce on every request, so `core:<nonce>` could not survive a retry and a
   retried paid media call was a second operation on the Worker. These tests
   pin the stable per-call operation_id and the same-id transport retry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { callMcpTool, operationIdForCall } from '../src/tools/mcp-http.mjs';

const SIGNED = { url: 'https://api.mccluster.org/v1/media/mcp', signEnv: 'TEST_CORE_SIGNING_KEY_OP' };
const ok = (result = { content: [] }) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });

function capture(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    return responder(calls.length, body);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a signed media call carries one stable operation_id, independent of the nonce', async () => {
  process.env.TEST_CORE_SIGNING_KEY_OP = 'k';
  const c = capture(() => ok());
  try {
    await callMcpTool(SIGNED, 'image.generate', { org_id: 'o', prompt: 'p' });
    const args = c.calls[0].body.params.arguments;
    assert.match(args.operation_id, /^core:[0-9a-f-]{36}$/);
    assert.notEqual(args.operation_id, `core:${c.calls[0].headers['x-mccluster-nonce']}`);
  } finally { c.restore(); delete process.env.TEST_CORE_SIGNING_KEY_OP; }
});

test('a transport failure is retried once with the SAME operation_id and a fresh signature', async () => {
  process.env.TEST_CORE_SIGNING_KEY_OP = 'k';
  const c = capture((n) => { if (n === 1) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); return ok({ job: { id: 'j' } }); });
  try {
    const result = await callMcpTool(SIGNED, 'media.generate', { org_id: 'o', model_id: 'm' });
    assert.deepEqual(result, { job: { id: 'j' } });
    assert.equal(c.calls.length, 2);
    assert.equal(c.calls[0].body.params.arguments.operation_id, c.calls[1].body.params.arguments.operation_id);
    assert.notEqual(c.calls[0].headers['x-mccluster-nonce'], c.calls[1].headers['x-mccluster-nonce'], 'the envelope is new, the operation is not');
  } finally { c.restore(); delete process.env.TEST_CORE_SIGNING_KEY_OP; }
});

test('a JSON-RPC error is not retried, and the retry budget is bounded', async () => {
  process.env.TEST_CORE_SIGNING_KEY_OP = 'k';
  let c = capture(() => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'refused' } }), { headers: { 'content-type': 'application/json' } }));
  try {
    await assert.rejects(callMcpTool(SIGNED, 'media.generate', { org_id: 'o', model_id: 'm' }), /refused/);
    assert.equal(c.calls.length, 1);
  } finally { c.restore(); }
  c = capture(() => { throw new TypeError('fetch failed'); });
  try {
    await assert.rejects(callMcpTool(SIGNED, 'media.generate', { org_id: 'o', model_id: 'm' }), /fetch failed/);
    assert.equal(c.calls.length, 2, 'one retry, then give up; the Worker holds the operation');
  } finally { c.restore(); delete process.env.TEST_CORE_SIGNING_KEY_OP; }
});

test('explicit and caller-scoped ids win over a minted one; invalid ids are refused; unsigned servers get untouched arguments', async () => {
  assert.equal(operationIdForCall(SIGNED, { operation_id: 'job-7:3' }), 'job-7:3');
  assert.equal(operationIdForCall(SIGNED, {}, { operationId: 'core-job:abc:1' }), 'core-job:abc:1');
  assert.throws(() => operationIdForCall(SIGNED, { operation_id: 'bad id/with slash' }), /operation_id/);
  const c = capture(() => ok());
  try {
    await callMcpTool({ url: 'https://example.com/mcp' }, 'other.tool', { a: 1 });
    assert.deepEqual(c.calls[0].body.params.arguments, { a: 1 });
    assert.equal(c.calls.length, 1);
  } finally { c.restore(); }
});
