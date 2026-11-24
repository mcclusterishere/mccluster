import { randomUUID } from 'node:crypto';
import { rest, enqueueJob } from '../supabase.mjs';
import { computeTaskById, listNodes } from './store.mjs';
import { assertWorkspaceSchema, enqueueWorkspaceTask, requireWorkspaceOwner, taskExecution, workspaceError } from './owner-routing.mjs';

export const PAIR_MODEL = 'mlx-community/Qwen3.5-27B-4bit';
export const PAIR_IMPLEMENTATION = 'exo.mlx.local';
const UUID = /^[0-9a-f-]{36}$/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const boundedName = value => {
  const name = String(value || '').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw workspaceError('PAIR_NAME_INVALID', 'Give the pair a name using 1–80 visible characters.', 400);
  return name;
};
function hasController(node) {
  return node?.capabilities?.some(item => item.capability === 'compute.pair.control' && item.implementation === PAIR_IMPLEMENTATION);
}
function online(node, now = Date.now()) { return node?.state === 'online' && !node.revoked_at && !node.pair_cleanup_required && Date.parse(node.last_seen_at) >= now - 180_000; }
function sameSet(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]); }

export function verifiedPairBenchmark(receipt, pair) {
  if (receipt?.ok !== true || receipt?.shared_model_test !== true || receipt?.model_id !== PAIR_MODEL || !/^[0-9a-f]{40,64}$/i.test(receipt?.model_revision || '')) return false;
  if (!sameSet(receipt.node_ids, pair.node_ids) || !Array.isArray(receipt.runtime_node_ids) || new Set(receipt.runtime_node_ids).size !== 2) return false;
  if (receipt.runtime?.name !== 'exo' || !receipt.runtime?.version || !/^[0-9a-f]{40}$/i.test(receipt.runtime?.commit || '') || receipt.network_backend !== 'mlx-ring-tcp') return false;
  if (receipt.model_traffic_local !== true || receipt.context_tokens !== 4096 || !Number.isInteger(receipt.prompt_tokens) || receipt.prompt_tokens < 1 || !Number.isInteger(receipt.output_tokens) || receipt.prompt_tokens + receipt.output_tokens > 4096) return false;
  if (!Number.isFinite(receipt.time_to_first_token_ms) || receipt.time_to_first_token_ms < 0 || !Number.isFinite(receipt.output_tokens_per_second) || receipt.output_tokens_per_second <= 0 || receipt.output_tokens < 1) return false;
  if (!Array.isArray(receipt.devices) || !sameSet(receipt.devices.map(device => device.node_id), pair.node_ids)) return false;
  return receipt.devices.every(device => device.platform === 'darwin' && device.arch === 'arm64' && Number.isFinite(device.memory_bytes) && device.memory_bytes >= 16 * 1024 ** 3 && Number.isFinite(device.peak_memory_bytes) && device.peak_memory_bytes > 0 && device.peak_memory_bytes < device.memory_bytes && Number.isFinite(device.free_memory_min_bytes) && device.free_memory_min_bytes >= 4 * 1024 ** 3 && device.peak_memory_verified === true && device.cleanup_confirmed === true);
}

export function pairSummary(pair, nodes, now = Date.now()) {
  const devices = pair.node_ids.map(id => nodes.find(node => node.id === id));
  let reason = pair.reason;
  let ready = pair.state === 'ready' && verifiedPairBenchmark(pair.benchmark, pair);
  if (!devices.every(node => online(node, now))) { ready = false; reason = 'Both Macs must be connected and resumed.'; }
  else if (!devices.every(hasController)) { ready = false; reason = 'Install the supported local pair runtime on both Macs, then run the shared-model test. Individual chat workers remain available.'; }
  else if (!pair.benchmark) { ready = false; reason = 'The exact model and these two Macs have not passed a shared-model benchmark.'; }
  else if (!verifiedPairBenchmark(pair.benchmark, pair)) { ready = false; reason = 'The benchmark is incomplete or does not prove this exact pair, model revision and memory usage.'; }
  const measured = Date.parse(pair.benchmark?.measured_at);
  if (ready && (!Number.isFinite(measured) || measured > now || now - measured > 7 * 86400_000)) { ready = false; reason = 'A current, dated benchmark is required. Run the shared-model test again before using Deep Reasoning.'; }
  return { ...pair, ready, reason, state: ready ? 'ready' : (['reserved', 'draining', 'running', 'cleanup', 'testing'].includes(pair.state) ? pair.state : 'unavailable') };
}

export function createPairService({ restImpl = rest, nodesImpl = listNodes, enqueueJobImpl = enqueueJob, env = process.env } = {}) {
  const authorize = (args, actor) => requireWorkspaceOwner(args.org_id, actor, env);
  async function readPair(orgId, id) {
    if (!UUID.test(id || '')) throw workspaceError('PAIR_NOT_FOUND', 'Choose an existing pair.', 404);
    const { body = [] } = await restImpl(`ops_compute_pairs?${new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${id}`, select: '*', limit: '1' })}`);
    if (!body[0]) throw workspaceError('PAIR_NOT_FOUND', 'This pair was not found.', 404);
    return body[0];
  }
  return {
    async list(args, actor) {
      authorize(args, actor); await assertWorkspaceSchema(restImpl);
      const [rows, nodes] = await Promise.all([restImpl(`ops_compute_pairs?${new URLSearchParams({ org_id: `eq.${args.org_id}`, select: '*', order: 'created_at.desc', limit: '50' })}`), nodesImpl({ orgId: args.org_id })]);
      return { pairs: (rows.body || []).map(pair => pairSummary(pair, nodes)), model_candidate: PAIR_MODEL };
    },
    async create(args, actor) {
      authorize(args, actor); await assertWorkspaceSchema(restImpl);
      if (!Array.isArray(args.node_ids) || args.node_ids.length !== 2 || new Set(args.node_ids).size !== 2) throw workspaceError('PAIR_TWO_MACS_REQUIRED', 'Select two different enrolled Macs.', 400);
      const nodes = await nodesImpl({ orgId: args.org_id });
      const selected = args.node_ids.map(id => nodes.find(node => node.id === id));
      if (!selected.every(node => node && node.inventory?.platform === 'darwin' && node.inventory?.arch === 'arm64' && !node.revoked_at && node.state !== 'revoked')) throw workspaceError('PAIR_TWO_MACS_REQUIRED', 'Select two enrolled Apple silicon Macs that have not been revoked.', 400);
      const pair = { id: randomUUID(), org_id: args.org_id, name: boundedName(args.name), node_ids: [...args.node_ids].sort(), state: 'unavailable', reason: 'Shared-model test required. Two independent Ollama workers are not a distributed model.', model_id: PAIR_MODEL };
      const { body } = await restImpl('ops_compute_pairs?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(pair) });
      return { pair: pairSummary(body[0], nodes) };
    },
    async benchmark(args, actor) {
      authorize(args, actor); await assertWorkspaceSchema(restImpl);
      const pair = await readPair(args.org_id, args.pair_id);
      const nodes = await nodesImpl({ orgId: args.org_id });
      if (!pair.node_ids.every(id => { const node = nodes.find(item => item.id === id); return online(node) && hasController(node); })) throw workspaceError('PAIR_UNAVAILABLE', 'Both Macs need the explicitly installed pair runtime before the benchmark can run.', 503);
      const job = await enqueueJobImpl({ orgId: args.org_id, jobType: 'compute_pair_benchmark', targetType: 'compute_pair', targetId: pair.id, priority: 80, maxAttempts: 1, input: { pair_id: pair.id, actor_kind: 'owner', actor_user_id: actor.user_id } });
      return { queued: true, job_id: job.id, pair_id: pair.id };
    },
    readPair,
  };
}

export async function runReservedPair({ orgId, pairId, input, benchmark = false, signal, onProgress, metadata = {}, ownerExecution }, dependencies = {}) {
  const restImpl = dependencies.rest || rest;
  const getNodes = dependencies.listNodes || listNodes;
  const enqueue = dependencies.enqueue || (async args => {
    const { body } = await restImpl('rpc/compute_enqueue_pair_task', { method: 'POST', body: JSON.stringify({
      p_org_id: orgId, p_reservation_id: reservationId,
      p_task: { capability: args.capability, implementation: args.implementation, input: args.input, requirements: args.requirements, max_attempts: args.maxAttempts, priority: args.priority, metadata: args.metadata },
      p_idempotency_key: args.idempotencyKey || null,
    }) });
    if (body?.conflict) throw workspaceError('IDEMPOTENCY_CONFLICT', 'This pair operation already queued a different request.');
    return { task: body?.task };
  });
  const readTask = dependencies.readTask || computeTaskById;
  const pause = dependencies.sleep || sleep;
  const now = dependencies.now || Date.now;
  const service = createPairService({ restImpl, nodesImpl: getNodes });
  await assertWorkspaceSchema(restImpl);
  const pair = await service.readPair(orgId, pairId);
  const nodes = await getNodes({ orgId });
  const summary = pairSummary(pair, nodes, now());
  if (!benchmark && !summary.ready) throw workspaceError('PAIR_UNAVAILABLE', summary.reason, 503);
  if (!pair.node_ids.every(id => hasController(nodes.find(node => node.id === id)) && online(nodes.find(node => node.id === id), now()))) throw workspaceError('PAIR_UNAVAILABLE', 'Both Macs need the supported pair runtime and current heartbeats.', 503);
  const reservationId = randomUUID();
  const deadline = now() + 840_000;
  let reserved = false, cleaned = [];
  const rpc = (name, args) => restImpl(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }).then(result => result.body);
  const update = values => restImpl(`ops_compute_pairs?${new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${pairId}` })}`, { method: 'PATCH', body: JSON.stringify({ ...values, updated_at: new Date(now()).toISOString() }) });
  async function command(nodeId, action, fields = {}, cleanup = false) {
    const taskArgs = { orgId, capability: 'compute.pair.control', implementation: PAIR_IMPLEMENTATION,
      requirements: { node_id: nodeId, pair_reservation_id: reservationId }, input: { action, pair_id: pairId, reservation_id: reservationId, node_ids: pair.node_ids, model_id: PAIR_MODEL, ...fields },
      maxAttempts: 1, priority: cleanup ? 100 : 90, idempotencyKey: `pair:${reservationId}:${randomUUID()}`, metadata: { ...metadata, source: 'owner-pair', pair_id: pairId, reservation_id: reservationId } };
    // Cleanup must still be possible after Stop, but no new model operation may
    // outlive the durable chat job that authorized it.
    const { task } = ownerExecution && !cleanup && !dependencies.enqueue ? await enqueueWorkspaceTask(taskArgs, ownerExecution, restImpl) : await enqueue(taskArgs);
    const until = cleanup ? now() + 35_000 : deadline;
    while (now() < until) {
      if (!cleanup && signal?.aborted) throw signal.reason;
      const current = await readTask({ orgId, taskId: task.id });
      if (!current) throw workspaceError('PAIR_TASK_LOST', 'The pair task could not be read.');
      const receipt = await taskExecution({ orgId, task: current, restImpl, nodes });
      if (!cleanup) await onProgress?.({ ...receipt, node: { ...receipt.node, node_ids: pair.node_ids, node_name: pair.name }, pair_id: pairId });
      if (current.status === 'done') {
        if (receipt.node?.node_id !== nodeId) throw workspaceError('PAIR_RECEIPT_MISMATCH', 'The pair task ran on the wrong worker.');
        if (current.output?.ok !== true) throw workspaceError('PAIR_UNAVAILABLE', current.output?.reason || 'The pair runtime could not verify this setup.');
        return current.output;
      }
      if (['failed', 'canceled'].includes(current.status)) throw workspaceError('PAIR_TASK_FAILED', 'The pair task failed or was stopped.');
      await pause(650);
    }
    throw workspaceError('PAIR_TIMEOUT', 'The pair operation exceeded its deadline.');
  }
  try {
    await rpc('compute_reserve_pair', { p_org_id: orgId, p_pair_id: pairId, p_reservation_id: reservationId, p_seconds: 900 });
    reserved = true;
    // Reserve first, then let all earlier ordinary leases finish before asking
    // either machine to unload. Never cancel unrelated work for a pair.
    while (true) {
      if (signal?.aborted) throw signal.reason;
      const { body: leases = [] } = await restImpl(`ops_compute_leases?${new URLSearchParams({ node_id: `in.(${pair.node_ids.join(',')})`, status: 'in.(leased,running)', expires_at: `gt.${new Date(now()).toISOString()}`, select: 'id', limit: '1' })}`);
      if (!leases.length) break;
      if (now() > deadline - 120_000) throw workspaceError('PAIR_DRAIN_TIMEOUT', 'Existing jobs did not finish within the pair deadline.');
      await onProgress?.({ status: 'draining', content: '', node: { node_name: pair.name, node_ids: pair.node_ids } });
      await pause(1000);
    }
    const probes = await Promise.all(pair.node_ids.map(id => command(id, 'probe')));
    const runtimeIds = probes.map(value => value.runtime_node_id);
    if (runtimeIds.some(id => typeof id !== 'string' || !id) || new Set(runtimeIds).size !== 2 || !probes.every(value => sameSet(value.visible_runtime_node_ids, runtimeIds) && value.runtime?.version === probes[0].runtime?.version && /^[0-9a-f]{40}$/i.test(value.runtime?.commit || '') && value.runtime.commit === probes[0].runtime.commit && /^[0-9a-f]{40,64}$/i.test(value.model_revision || '') && value.model_revision === probes[0].model_revision && value.model_traffic_local === true)) throw workspaceError('PAIR_TOPOLOGY_UNVERIFIED', 'The supported runtime has not proven exactly these two Macs on the same local network.');
    if (!benchmark && (probes[0].model_revision !== pair.benchmark.model_revision || probes[0].runtime.commit !== pair.benchmark.runtime.commit || !sameSet(runtimeIds, pair.benchmark.runtime_node_ids))) throw workspaceError('PAIR_BENCHMARK_UNVERIFIED', 'The runtime or model changed after its benchmark. Run the shared-model test again.');
    const shared = { runtime_node_ids: runtimeIds, runtime: probes[0].runtime, model_revision: probes[0].model_revision };
    const prepared = await Promise.all(pair.node_ids.map(id => command(id, 'prepare', shared)));
    if (!prepared.every(value => value.ollama_unloaded === true && value.free_memory_bytes >= 4 * 1024 ** 3)) throw workspaceError('PAIR_MEMORY_UNVERIFIED', 'Both Macs must unload their ordinary model and retain at least 4 GB of memory headroom.');
    await update({ state: benchmark ? 'testing' : 'running', reason: benchmark ? 'Running the shared-model benchmark.' : 'Both Macs are reserved for Deep Reasoning.' });
    const result = await command(pair.node_ids[0], benchmark ? 'benchmark' : 'chat', { ...shared, context_tokens: 4096, ...(input ? { chat: input } : {}) });
    // Release is part of the evidence: benchmark readiness is committed only
    // after both local runtimes confirm teardown below.
    if (benchmark) {
      const releases = await Promise.allSettled(pair.node_ids.map(id => command(id, 'release', shared, true)));
      cleaned = pair.node_ids.filter((id, i) => releases[i].status === 'fulfilled' && releases[i].value.unloaded === true);
      const receipt = { ...result.benchmark, node_ids: pair.node_ids, runtime_node_ids: runtimeIds, measured_at: new Date(now()).toISOString(), devices: (result.benchmark?.devices || []).map(device => ({ ...device, cleanup_confirmed: cleaned.includes(device.node_id) })) };
      if (!verifiedPairBenchmark(receipt, pair)) throw workspaceError('PAIR_BENCHMARK_UNVERIFIED', 'The shared-model test did not prove model revision, both workers, peak memory, timing, and cleanup. Deep Reasoning remains unavailable.');
      await update({ benchmark: receipt, model_revision: receipt.model_revision, runtime: receipt.runtime, reason: 'Shared-model benchmark passed; both Macs confirmed cleanup.' });
      return { benchmark: receipt, pair_id: pairId, verified: true };
    }
    return { model: PAIR_MODEL, implementation: 'qwen3.5.27b.pair', message: { role: 'assistant', content: String(result.content || '') }, usage: result.usage || {}, node: { route: 'pair', node_name: pair.name, node_ids: pair.node_ids, node_id: pair.node_ids[0] }, requested_route: { mode: 'pair', pair_id: pairId }, fallback_reason: null };
  } catch (error) {
    if (reserved) await update({ state: 'failed', benchmark: null, reason: String(error.message || 'The pair operation failed.').slice(0, 1000) }).catch(() => null);
    throw error;
  } finally {
    if (reserved) {
      if (cleaned.length < 2) {
        await update({ state: 'cleanup', reason: 'Unloading the shared runtime on both Macs.' }).catch(() => null);
        const results = await Promise.allSettled(pair.node_ids.map(id => command(id, 'release', {}, true)));
        cleaned = pair.node_ids.filter((id, i) => results[i].status === 'fulfilled' && results[i].value.unloaded === true);
      }
      // If a worker is offline/revoked, the SQL pauses it before releasing its
      // reservation. An unconfirmed unload never becomes an eligible worker.
      await rpc('compute_release_pair', { p_org_id: orgId, p_reservation_id: reservationId, p_clean_node_ids: cleaned });
    }
  }
}

export async function pairBenchmarkJob(job, { signal } = {}) {
  requireWorkspaceOwner(job.org_id, { kind: job.input?.actor_kind, user_id: job.input?.actor_user_id });
  const result = await runReservedPair({ orgId: job.org_id, pairId: job.input.pair_id, benchmark: true, signal, metadata: { job_id: job.id } });
  return { ...result, executor: 'compute-pair-benchmark:v1', summary: 'The exact two-worker shared-model benchmark and cleanup completed.' };
}
