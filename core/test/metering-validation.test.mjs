import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { generateNodeIdentity } from '../src/compute/signature.mjs';
import { DEFAULT_USAGE_BOUNDS, RECEIPT_SCHEMA, buildReceipt, generateReceiptKey, meteringBlock, normalizedUsageCounters, signReceipt, validateResultUsage, verifyReceipt } from '../src/compute/jobs.mjs';
import { validateCompletion } from '../src/compute/jobs-service.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const TASK = '10000000-0000-4000-8000-000000000001';
const LEASE = '20000000-0000-4000-8000-000000000001';

function usage(over = {}) {
  return { prompt_eval_count: 100, prompt_eval_cached_count: 20, eval_count: 50, total_duration_ns: 3_000_000_000, load_duration_ns: 1_000_000_000, prompt_eval_duration_ns: 500_000_000, eval_duration_ns: 1_000_000_000, model_digest: 'sha256:0123456789abcdef', ollama_version: '0.6.0', ...over };
}

test('validateResultUsage: absent or all-null usage is not metered and ok; present counters must be non-negative safe integers', () => {
  assert.deepEqual(validateResultUsage(undefined), { ok: true, metered: false, code: null, reason: null });
  assert.deepEqual(validateResultUsage(null), { ok: true, metered: false, code: null, reason: null });
  assert.equal(validateResultUsage({ prompt_eval_count: null, eval_count: null }).metered, false);
  assert.equal(validateResultUsage(usage()).ok, true);
  assert.equal(validateResultUsage(usage()).metered, true);
  assert.equal(validateResultUsage('x').code, 'RESULT_USAGE_INVALID');
  assert.equal(validateResultUsage([1]).code, 'RESULT_USAGE_INVALID');
  for (const bad of [{ eval_count: -1 }, { eval_count: 12.5 }, { eval_count: '50' }, { total_duration_ns: Number.MAX_SAFE_INTEGER + 2 }, { prompt_eval_cached_count: '0' }, { load_duration_ns: true }]) {
    const verdict = validateResultUsage(usage(bad));
    assert.equal(verdict.ok, false, JSON.stringify(bad));
    assert.equal(verdict.code, 'RESULT_USAGE_INVALID', JSON.stringify(bad));
    assert.match(verdict.reason, /usage\./);
  }
});

test('validateResultUsage: a counter the runtime did not report (null or absent) is 0, never an error', () => {
  // Ollama's /api/chat never reports prompt_eval_cached_count and omits zero counters (omitempty).
  for (const missing of [{ prompt_eval_cached_count: null }, { prompt_eval_cached_count: undefined }, { load_duration_ns: undefined }, { load_duration_ns: null }, { prompt_eval_count: null, prompt_eval_cached_count: null, prompt_eval_duration_ns: null }, { total_duration_ns: null }]) {
    const verdict = validateResultUsage(usage(missing));
    assert.deepEqual(verdict, { ok: true, metered: true, code: null, reason: null }, JSON.stringify(missing));
  }
  const { prompt_eval_cached_count, load_duration_ns, ...omitted } = usage();
  assert.equal(validateResultUsage(omitted).ok, true, 'keys that are simply not there');
  assert.deepEqual(normalizedUsageCounters({ eval_count: 5, prompt_eval_cached_count: null }), { prompt_eval_count: 0, prompt_eval_cached_count: 0, eval_count: 5, total_duration_ns: 0, load_duration_ns: 0, prompt_eval_duration_ns: 0, eval_duration_ns: 0 });
  // An absent prompt count is 0, so a reported cache hit above it is still inconsistent.
  assert.equal(validateResultUsage(usage({ prompt_eval_count: null })).code, 'RESULT_USAGE_INVALID');
  // Tokens generated with no duration reported is still refused: the rate window cannot be checked.
  assert.equal(validateResultUsage(usage({ eval_duration_ns: null })).code, 'RESULT_USAGE_INVALID');
});

test('validateResultUsage: cached <= prompt, positive eval duration when tokens were generated, bounds from the class or the conservative defaults', () => {
  assert.equal(validateResultUsage(usage({ prompt_eval_cached_count: 101 })).code, 'RESULT_USAGE_INVALID');
  assert.equal(validateResultUsage(usage({ prompt_eval_cached_count: 100 })).ok, true);
  assert.equal(validateResultUsage(usage({ eval_duration_ns: 0 })).code, 'RESULT_USAGE_INVALID');
  assert.equal(validateResultUsage(usage({ eval_count: 0, eval_duration_ns: 0 })).ok, true, 'no tokens, no duration is consistent');
  assert.equal(validateResultUsage(usage({ eval_count: DEFAULT_USAGE_BOUNDS.max_eval_count + 1 })).code, 'RESULT_USAGE_OUT_OF_BOUNDS');
  assert.equal(validateResultUsage(usage({ eval_count: DEFAULT_USAGE_BOUNDS.max_eval_count })).ok, true);
  assert.equal(validateResultUsage(usage({ prompt_eval_count: DEFAULT_USAGE_BOUNDS.max_prompt_eval_count + 1 })).code, 'RESULT_USAGE_OUT_OF_BOUNDS');
  assert.equal(validateResultUsage(usage({ total_duration_ns: DEFAULT_USAGE_BOUNDS.max_duration_ns + 1 })).code, 'RESULT_USAGE_OUT_OF_BOUNDS');
  // Class bounds replace the defaults; a non-positive or missing bound falls back.
  assert.equal(validateResultUsage(usage({ eval_count: 4097 }), { max_eval_count: 4096, max_prompt_eval_count: 32768 }).code, 'RESULT_USAGE_OUT_OF_BOUNDS');
  assert.equal(validateResultUsage(usage({ eval_count: 4096 }), { max_eval_count: 4096 }).ok, true);
  assert.equal(validateResultUsage(usage({ eval_count: 5000 }), { max_eval_count: 0 }).ok, true, 'a zero bound is ignored, the default applies');
  assert.equal(validateResultUsage(usage({ model_digest: 'bad digest!' })).code, 'RESULT_USAGE_INVALID');
  assert.equal(validateResultUsage(usage({ ollama_version: 'v'.repeat(65) })).code, 'RESULT_USAGE_INVALID');
  assert.equal(validateResultUsage(usage({ model_digest: null, ollama_version: null })).ok, true);
});

test('meteringBlock carries the contract fields from the output, the lease and the node; null without counters', () => {
  const node = { id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', key_fingerprint: 'fp', inventory: { runtime: { hardware_mode: 'gpu-verified' } } };
  const lease = { id: LEASE, node_id: node.id, attempt: 2, started_at: '2026-11-23T00:00:01.000Z', completed_at: '2026-11-23T00:00:04.500Z' };
  const block = meteringBlock({ task: { output: { model: 'qwen3:8b', usage: usage() } }, lease, node });
  assert.deepEqual(block, {
    prompt_eval_count: 100, prompt_eval_cached_count: 20, eval_count: 50, total_duration_ns: 3_000_000_000, load_duration_ns: 1_000_000_000, prompt_eval_duration_ns: 500_000_000, eval_duration_ns: 1_000_000_000,
    model: 'qwen3:8b', model_digest: 'sha256:0123456789abcdef', runtime_version: '0.6.0', node_id: node.id, node_key_fingerprint: 'fp', hardware_mode: 'gpu-verified', attempt: 2, duration_ms: 3500
  });
  assert.equal(meteringBlock({ task: { output: { model: 'fixture', content: 'ECHO' } }, lease, node }), null);
  assert.equal(meteringBlock({ task: { output: null } }), null);
  assert.equal(meteringBlock({ task: { output: { usage: usage({ ollama_version: null, runtime_version: 'llama.cpp b1' }) } } }).runtime_version, 'llama.cpp b1');
});

test('the receipt stays mccluster-job-receipt/1, gains metering as an optional member, and still verifies', () => {
  const identity = generateNodeIdentity();
  const key = generateReceiptKey();
  const output = { model: 'qwen3:8b', content: 'hello', usage: usage() };
  const node = { id: identity.nodeId, key_fingerprint: identity.fingerprint, public_key_pem: identity.publicKeyPem, display_name: 'fixture', inventory: { platform: 'win32', runtime: { hardware_mode: 'gpu-verified' } } };
  const task = { id: TASK, org_id: ORG, capability: 'ai.chat', status: 'done', attempts: 1, max_attempts: 3, input: { prompt: 'hi' }, output, metadata: {} };
  const lease = { id: LEASE, task_id: TASK, node_id: node.id, implementation: 'qwen3.8b.local', attempt: 1, status: 'done', result: output, started_at: '2026-11-23T00:00:01.000Z', completed_at: '2026-11-23T00:00:04.000Z' };
  const receipt = signReceipt(buildReceipt({ task, leases: [lease], node, issuedAt: '2026-11-23T00:00:09.000Z' }), key);
  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.schema, 'mccluster-job-receipt/1');
  assert.equal(receipt.metering.eval_count, 50);
  assert.equal(receipt.metering.model_digest, 'sha256:0123456789abcdef');
  assert.equal(receipt.metering.node_id, node.id);
  assert.equal(receipt.metering.duration_ms, 3000);
  assert.deepEqual(verifyReceipt(receipt, key.publicKeyPem), { ok: true, reason: null });
  const tampered = { ...receipt, metering: { ...receipt.metering, eval_count: 5000 } };
  assert.equal(verifyReceipt(tampered, key.publicKeyPem).ok, false, 'the Core signature covers the metering block');
  const echo = signReceipt(buildReceipt({ task: { ...task, output: { content: 'ECHO' } }, leases: [{ ...lease, result: { content: 'ECHO' } }], node, issuedAt: '2026-11-23T00:00:09.000Z' }), key);
  assert.equal(echo.metering, null, 'an output without counters has no block');
  const failed = signReceipt(buildReceipt({ task: { ...task, status: 'failed', output: null }, leases: [{ ...lease, status: 'failed' }], node, issuedAt: '2026-11-23T00:00:09.000Z' }), key);
  assert.equal(failed.metering, null);
});

const PILOT_CLASS = { model_class: 'pilot.qwen3-8b', unit_version: 1, implementations: ['qwen3.8b.local'], max_eval_count: 4096, max_prompt_eval_count: 32768 };
// What inferenceUsage() makes of a real Ollama /api/chat reply: seven counters, the cached one always null.
const OLLAMA_USAGE = { prompt_eval_count: 100, prompt_eval_cached_count: null, eval_count: 50, total_duration_ns: 3_000_000_000, load_duration_ns: 1_000_000_000, prompt_eval_duration_ns: 500_000_000, eval_duration_ns: 1_000_000_000, prompt_tokens_per_second: 200, generation_tokens_per_second: 50, model_digest: 'sha256:feedfacefeedface', ollama_version: '0.6.0' };

function completionDeps({ ledgerOn = false, capability = 'ai.chat', classes = [PILOT_CLASS], reservation = null, input = { prompt: 'hi' } } = {}) {
  const logs = [];
  const reads = [];
  return {
    logs,
    reads,
    deps: {
      env: {},
      ledgerEnabled: () => ledgerOn,
      leaseById: async ({ leaseId }) => { reads.push('lease'); return (leaseId === LEASE ? { id: LEASE, task_id: TASK, node_id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', implementation: 'qwen3.8b.local', attempt: 1, status: 'running' } : null); },
      taskRowById: async ({ taskId }) => { reads.push('task'); return (taskId === TASK ? { id: TASK, org_id: ORG, capability, implementation: 'qwen3.8b.local', status: 'running', input } : null); },
      reservationForTask: async () => { reads.push('reservation'); return reservation; },
      modelClasses: async () => { reads.push('classes'); return classes; },
      log: (record) => logs.push(record)
    }
  };
}
const OPEN = { task_id: TASK, status: 'open', model_class: 'pilot.qwen3-8b', unit_version: 1, max_units_micro: 7_372_800 };

test('with CORE_CONTRIBUTION_LEDGER_ENABLED unset /complete is PR #823\'s: validateCompletion reads nothing and refuses nothing, a real Ollama result included', async () => {
  const off = completionDeps({ ledgerOn: false, reservation: OPEN });
  const skipped = { checked: false, metered: false };
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { model: 'qwen3:8b', content: 'x', usage: OLLAMA_USAGE } }, off.deps), skipped, 'prompt_eval_cached_count: null is what Ollama always sends');
  const { load_duration_ns, prompt_eval_count, ...omitempty } = OLLAMA_USAGE;
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: omitempty } }, off.deps), skipped, 'counters Ollama omitted');
  // Nothing PR #823 accepted is refused now, however odd.
  for (const result of [{ content: 'ECHO' }, {}, { usage: 'garbage' }, { usage: usage({ prompt_eval_cached_count: 999 }) }, { usage: usage({ eval_count: 1_000_000 }) }, { usage: usage({ eval_count: -1 }) }]) {
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result }, off.deps), skipped, JSON.stringify(result));
  }
  assert.deepEqual(off.reads, [], 'not one read is added to the completion path');
  assert.deepEqual(off.logs, []);
});

test('with the ledger on only an ai.* task holding an open reservation is checked; everything else completes as before', async () => {
  const skipped = { checked: false, metered: false };
  const garbage = { usage: 'garbage' };
  // No reservation (submitted before the flag, or through POST /v1/compute/tasks): not the ledger's business.
  const unreserved = completionDeps({ ledgerOn: true, reservation: null });
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: garbage }, unreserved.deps), skipped);
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 1_000_000 }) } }, unreserved.deps), skipped);
  for (const status of ['settled', 'released']) {
    const closed = completionDeps({ ledgerOn: true, reservation: { ...OPEN, status } });
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: garbage }, closed.deps), skipped, status);
  }
  const browser = completionDeps({ ledgerOn: true, capability: 'browser.act', reservation: OPEN });
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: garbage }, browser.deps), skipped);
  assert.equal(browser.reads.includes('reservation'), false);
  assert.deepEqual(await validateCompletion({ leaseId: '20000000-0000-4000-8000-000000000009', result: garbage }, completionDeps({ ledgerOn: true, reservation: OPEN }).deps), skipped, 'unknown lease: the SQL fence decides');
  // A read that fails never blocks a completion: the settle enforces the same bounds.
  const down = completionDeps({ ledgerOn: true, reservation: OPEN });
  down.deps.reservationForTask = async () => { throw new Error('database away'); };
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: garbage }, down.deps), skipped);
  assert.equal(down.logs.at(-1).event, 'compute_ledger_validate_unavailable');
});

test('validateCompletion for a reserved task: a real Ollama result passes; counters are required, well formed, and inside the task\'s own caps and the class maxima', async () => {
  const { deps } = completionDeps({ ledgerOn: true, reservation: OPEN });
  const checked = { checked: true, metered: true };
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { model: 'qwen3:8b', content: 'x', usage: OLLAMA_USAGE } }, deps), checked, 'prompt_eval_cached_count: null means 0');
  const { load_duration_ns, ...omitempty } = OLLAMA_USAGE;
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: omitempty } }, deps), checked, 'an omitted optional counter is tolerated');
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage() } }, deps), checked);
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { content: 'no usage' } }, deps), (e) => e.code === 'RESULT_USAGE_MISSING' && e.status === 422 && e.lease_id === LEASE);
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: { prompt_eval_count: null, eval_count: null } } }, deps), (e) => e.code === 'RESULT_USAGE_MISSING');
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ prompt_eval_cached_count: 999 }) } }, deps), (e) => e.code === 'RESULT_USAGE_INVALID' && e.status === 422);
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: 'garbage' } }, deps), (e) => e.code === 'RESULT_USAGE_INVALID');
  // Class maxima (no caps on the task).
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 4097 }) } }, deps), (e) => e.code === 'RESULT_USAGE_OUT_OF_BOUNDS');
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 4096 }) } }, deps), checked);
  // The task's own caps: num_predict 64 reserved 64 tokens of output, so 4096 (inside the class) is out of bounds.
  const capped = completionDeps({ ledgerOn: true, reservation: OPEN, input: { prompt: 'hi', num_predict: 64, num_ctx: 4096 } });
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 4096 }) } }, capped.deps), (e) => e.code === 'RESULT_USAGE_OUT_OF_BOUNDS' && /exceeds 64/.test(e.message));
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 65 }) } }, capped.deps), (e) => e.code === 'RESULT_USAGE_OUT_OF_BOUNDS');
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 64 }) } }, capped.deps), checked);
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ prompt_eval_count: 4097, prompt_eval_cached_count: 0 }) } }, capped.deps), (e) => e.code === 'RESULT_USAGE_OUT_OF_BOUNDS' && /exceeds 4096/.test(e.message));
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage({ prompt_eval_count: 4096, prompt_eval_cached_count: 0 }) } }, capped.deps), checked);
  // The class the reservation pinned bounds the attempt even when two classes price the implementation list differently.
  const two = completionDeps({ ledgerOn: true, reservation: { ...OPEN, model_class: 'pilot.small' }, classes: [PILOT_CLASS, { model_class: 'pilot.small', unit_version: 1, implementations: ['other.local'], max_eval_count: 128, max_prompt_eval_count: 4096 }] });
  await assert.rejects(() => validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 129, eval_duration_ns: 3_000_000_000 }) } }, two.deps), (e) => e.code === 'RESULT_USAGE_OUT_OF_BOUNDS' && /exceeds 128/.test(e.message));
  const noClass = completionDeps({ ledgerOn: true, reservation: OPEN, classes: [] });
  assert.deepEqual(await validateCompletion({ leaseId: LEASE, result: { usage: usage({ eval_count: 4097 }) } }, noClass.deps), checked, 'without a class the conservative defaults bound the counters');
});

test('the real Ollama adapter returns model_digest and ollama_version inside usage on the /execute response', { timeout: 20000 }, async () => {
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const responses = {
      '/api/version': { version: '0.6.0-test' },
      '/api/tags': { models: [{ name: 'qwen3:8b', digest: 'sha256:feedfacefeedface', size: 123 }] },
      '/api/chat': { message: { role: 'assistant', content: 'hello' }, done_reason: 'stop', total_duration: 3e9, load_duration: 1e9, prompt_eval_duration: 5e8, eval_duration: 1e9, prompt_eval_count: 100, eval_count: 50 }
    };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(responses[req.url] || {}));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/compute/ollama-adapter.mjs', import.meta.url))], { env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const result = await fetch(`http://127.0.0.1:${port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ai.chat', input: { prompt: 'hi' } }) }).then((r) => r.json());
    assert.equal(result.model, 'qwen3:8b');
    assert.equal(result.usage.model_digest, 'sha256:feedfacefeedface');
    assert.equal(result.usage.ollama_version, '0.6.0-test');
    assert.equal(result.usage.eval_count, 50);
    assert.equal(result.usage.prompt_eval_cached_count, null, 'a counter the daemon did not report stays null');
    assert.deepEqual(validateResultUsage(result.usage), { ok: true, metered: true, code: null, reason: null }, 'the real adapter result is valid: the unreported cached count is 0');
    // The whole /complete gate, both ways, on the adapter's actual result.
    const skipped = { checked: false, metered: false };
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result }, completionDeps({ ledgerOn: false }).deps), skipped, 'flag unset: not inspected, committed as on PR #823');
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result }, completionDeps({ ledgerOn: true, reservation: null }).deps), skipped, 'ledger on, unreserved task: not inspected');
    assert.deepEqual(await validateCompletion({ leaseId: LEASE, result }, completionDeps({ ledgerOn: true, reservation: OPEN }).deps), { checked: true, metered: true }, 'ledger on, reserved task: accepted');
  } finally {
    child.kill(); await once(child, 'exit');
    upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
  }
});
