// The optional EXO integration deliberately separates observed state from
// configured claims. A model name, two visible nodes, or aggregate RAM must
// never become proof of a successful distributed benchmark.
// Source inspected: exo-explore/exo@fd707de30b42db4211d15da96b9052e1dc280ed1.
import { isIP } from 'node:net';

export const EXO_AUDITED_RELEASE = Object.freeze({
  name: 'exo', version: 'v1.0.71', package_version: '0.3.70',
  commit: 'fd707de30b42db4211d15da96b9052e1dc280ed1',
});
export const EXO_PAIR_MODEL = 'mlx-community/Qwen3.5-27B-4bit';
export const EXO_PAIR_CONFIG = 'mccluster-exo-probe/1';
const NODE = /^node_[0-9a-f]{32}$/;
const RUNTIME_NODE = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

export const EXO_EVIDENCE_GAPS = Object.freeze([
  { code: 'EXO_RUNTIME_BUILD_UNATTESTED', reason: 'This EXO API does not report an authoritative runtime version and commit for both devices.' },
  { code: 'EXO_MODEL_REVISION_UNATTESTED', reason: 'This EXO state does not prove the exact loaded model revision on both devices.' },
  { code: 'EXO_PER_NODE_PEAK_UNAVAILABLE', reason: 'The generation peak-memory field is not attributed to each device; per-device peak memory remains unverified.' },
  { code: 'EXO_NETWORK_BOUNDARY_UNATTESTED', reason: 'Private peer addresses are observations, not proof that all model traffic stays on the local network.' },
  { code: 'EXO_INSTANCE_LIFECYCLE_UNVERIFIED', reason: 'The audited release lacks the current documented instance-await API; creation, cancellation and watchdog cleanup need a pinned integration test.' },
]);

export function exoLoopbackOrigin(value = 'http://127.0.0.1:52415') {
  let url;
  try { url = new URL(value); } catch { throw new Error('EXO must use a literal loopback HTTP origin.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('EXO must use a literal loopback HTTP origin without credentials, query or path.');
  }
  return url.origin;
}

export function privateLanAddress(value) {
  if (typeof value !== 'string') return false;
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
  }
  return isIP(value) === 6 && /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(value);
}

export function validatePairConfig(value) {
  if (!object(value) || value.schema !== EXO_PAIR_CONFIG || typeof value.enabled !== 'boolean') throw new Error('Use a mccluster-exo-probe/1 configuration with an explicit enabled flag.');
  const keys = new Set(['schema', 'enabled', 'runtime_url', 'runtime', 'model_id', 'model_revision', 'local_node_id', 'members']);
  if (Object.keys(value).some(key => !keys.has(key))) throw new Error('The pair configuration contains unsupported fields. Do not put credentials in it.');
  const runtimeUrl = exoLoopbackOrigin(value.runtime_url);
  if (!value.enabled) return { schema: EXO_PAIR_CONFIG, enabled: false, runtime_url: runtimeUrl };
  if (!object(value.runtime) || Object.keys(value.runtime).some(key => !Object.hasOwn(EXO_AUDITED_RELEASE, key)) || Object.entries(EXO_AUDITED_RELEASE).some(([key, expected]) => value.runtime[key] !== expected)) {
    throw new Error('Only the explicitly audited EXO release pin is supported for diagnostics. It is not approved for shared inference.');
  }
  if (value.model_id !== EXO_PAIR_MODEL || !/^[0-9a-f]{40,64}$/i.test(value.model_revision || '')) throw new Error('Pin the complete model revision; a tag or short commit is insufficient.');
  if (!NODE.test(value.local_node_id || '') || !Array.isArray(value.members) || value.members.length !== 2) throw new Error('Map the two enrolled devices to their actual runtime node IDs.');
  const members = value.members.map(member => {
    if (!object(member) || Object.keys(member).some(key => !['node_id', 'runtime_node_id', 'lan_addresses'].includes(key)) || !NODE.test(member.node_id || '') || !RUNTIME_NODE.test(member.runtime_node_id || '')) throw new Error('Invalid pair member mapping.');
    if (!Array.isArray(member.lan_addresses) || !member.lan_addresses.length || member.lan_addresses.length > 8 || !member.lan_addresses.every(privateLanAddress)) throw new Error('Use literal private LAN addresses for each runtime member.');
    return { node_id: member.node_id, runtime_node_id: member.runtime_node_id, lan_addresses: [...new Set(member.lan_addresses)] };
  });
  if (new Set(members.map(member => member.node_id)).size !== 2 || new Set(members.map(member => member.runtime_node_id)).size !== 2 || !members.some(member => member.node_id === value.local_node_id)) throw new Error('Each of the two runtime members must map to a different enrolled device, including this device.');
  return { schema: EXO_PAIR_CONFIG, enabled: true, runtime_url: runtimeUrl, runtime: { ...EXO_AUDITED_RELEASE },
    model_id: value.model_id, model_revision: value.model_revision.toLowerCase(), local_node_id: value.local_node_id, members };
}

export function validatePairInput(body, config) {
  if (!object(body) || body.capability !== 'compute.pair.control' || body.implementation !== 'exo.mlx.local') throw new Error('This adapter accepts only compute.pair.control / exo.mlx.local.');
  const input = body.input;
  if (!object(input) || !['probe', 'prepare', 'benchmark', 'chat', 'release'].includes(input.action) || !UUID.test(input.pair_id || '') || !UUID.test(input.reservation_id || '')) throw new Error('A valid pair action and reservation are required.');
  if (!config.enabled) return input;
  if (!sameSet(input.node_ids, config.members.map(member => member.node_id)) || input.model_id !== config.model_id) throw new Error('The requested pair does not match this local configuration.');
  if (input.model_revision && input.model_revision !== config.model_revision || input.runtime_node_ids && !sameSet(input.runtime_node_ids, config.members.map(member => member.runtime_node_id))) throw new Error('The requested runtime or model pin does not match this local configuration.');
  return input;
}

function memoryBytes(value) { return Number.isSafeInteger(value?.inBytes) && value.inBytes >= 0 ? value.inBytes : null; }
function privateEdge(edge, allowed) {
  const address = edge?.sinkMultiaddr?.address;
  const match = typeof address === 'string' && address.match(/^\/ip([46])\/([^/]+)\/tcp\/([0-9]{1,5})(?:\/p2p\/[A-Za-z0-9]+)?$/);
  return Boolean(match && isIP(match[2]) === Number(match[1]) && privateLanAddress(match[2]) && allowed.includes(match[2]) && Number(match[3]) > 0 && Number(match[3]) <= 65535);
}

/** Parse the pinned release's real camelCase /state wire format; no heuristic identity conversion. */
export function observeExoState({ state, localRuntimeNodeId, config, now = Date.now() }) {
  const expected = config.members.map(member => member.runtime_node_id);
  const visible = Array.isArray(state?.topology?.nodes) ? state.topology.nodes : [];
  const exactlyTwo = visible.length === 2 && visible.every(id => typeof id === 'string') && sameSet(visible, expected);
  const localMember = config.members.find(member => member.node_id === config.local_node_id);
  const identityMatches = typeof localRuntimeNodeId === 'string' && localRuntimeNodeId === localMember.runtime_node_id;
  const fresh = exactlyTwo && expected.every(id => {
    const lastSeen = Date.parse(state?.lastSeen?.[id]);
    return Number.isFinite(lastSeen) && now >= lastSeen - 5000 && now - lastSeen <= 120_000;
  });
  const edges = state?.topology?.connections;
  const endpointsLocal = exactlyTwo && object(edges) && Object.keys(edges).every(id => expected.includes(id)) && expected.every(from => {
    const to = expected.find(id => id !== from);
    const outgoing = edges[from];
    const peerEdges = outgoing?.[to];
    return object(outgoing) && Object.keys(outgoing).every(id => id === to) && Array.isArray(peerEdges) && peerEdges.length > 0
      && peerEdges.every(edge => privateEdge(edge, config.members.find(member => member.runtime_node_id === to).lan_addresses));
  });
  const devices = config.members.map(member => ({ node_id: member.node_id, runtime_node_id: member.runtime_node_id,
    memory_bytes: memoryBytes(state?.nodeMemory?.[member.runtime_node_id]?.ramTotal),
    free_memory_bytes: memoryBytes(state?.nodeMemory?.[member.runtime_node_id]?.ramAvailable),
    peak_memory_bytes: null, peak_memory_verified: false }));
  const instances = object(state?.instances) ? state.instances : null;
  const runners = object(state?.runners) ? state.runners : null;
  const sharedInstances = Object.entries(instances || {}).flatMap(([id, tagged]) => {
    const instance = tagged?.MlxRingInstance;
    const assignments = instance?.shardAssignments;
    if (assignments?.modelId !== config.model_id || !sameSet(Object.keys(assignments.nodeToRunner || {}), expected)) return [];
    const active = Object.values(assignments.nodeToRunner).every(runner => object(runners?.[runner]) && (Object.hasOwn(runners[runner], 'RunnerReady') || Object.hasOwn(runners[runner], 'RunnerRunning')));
    return [{ instance_id: id, runtime_node_ids: expected, runners_ready_or_running: active }];
  });
  // A vanished instance alone is insufficient: its runner can still be shutting
  // down and holding memory. Never remove a user's independently created instance.
  const runtimeIdle = instances !== null && runners !== null && !Object.keys(instances).length
    && Object.values(runners).every(runner => object(runner) && Object.keys(runner).length === 1 && (Object.hasOwn(runner, 'RunnerIdle') || Object.hasOwn(runner, 'RunnerShutdown')));
  return { runtime_node_id: typeof localRuntimeNodeId === 'string' ? localRuntimeNodeId : null,
    visible_runtime_node_ids: visible.filter(id => typeof id === 'string').slice(0, 16),
    exactly_two_members: exactlyTwo, local_identity_matches: identityMatches, runtime_heartbeats_fresh: fresh,
    observed_lan_endpoints_match: endpointsLocal, observed_shared_instances: sharedInstances,
    runtime_idle: runtimeIdle && exactlyTwo && identityMatches && fresh, devices };
}

export function unavailablePairResult({ config, observation, action = 'probe', extraGaps = [] }) {
  const gaps = [
    ...(!config.enabled ? [{ code: 'PAIR_OPT_IN_REQUIRED', reason: 'The owner must explicitly configure and start the optional local pair diagnostics.' }] : []),
    ...extraGaps,
    ...(observation && !observation.exactly_two_members ? [{ code: 'PAIR_MEMBERS_MISMATCH', reason: 'EXO must see exactly the two configured runtime members.' }] : []),
    ...(observation && !observation.local_identity_matches ? [{ code: 'PAIR_LOCAL_IDENTITY_MISMATCH', reason: 'The local EXO identity changed or belongs to a different device. Recheck both runtime mappings.' }] : []),
    ...(observation && !observation.runtime_heartbeats_fresh ? [{ code: 'PAIR_RUNTIME_OFFLINE', reason: 'Both runtime members need current local-network heartbeats.' }] : []),
    ...(observation && !observation.observed_lan_endpoints_match ? [{ code: 'PAIR_LAN_UNVERIFIED', reason: 'The runtime topology does not match the configured private LAN addresses in both directions.' }] : []),
    ...EXO_EVIDENCE_GAPS,
  ];
  return { ok: false, state: 'unavailable', action, code: gaps[0].code, reason: gaps[0].reason,
    runtime: null, model_revision: null, runtime_configured: config.runtime || null,
    model_revision_configured: config.model_revision || null, model_id: config.model_id || EXO_PAIR_MODEL,
    shared_model_test: false, model_traffic_local: false, benchmark_verified: false,
    mutated: false, inference_enabled: false, gaps, ...(observation || {}) };
}

/** Explicit diagnostic capability only; never added by the ordinary installer. */
export function pairDiagnosticCapability(rawConfig) {
  const config = validatePairConfig(rawConfig);
  if (!config.enabled) throw new Error('Pair diagnostics require an explicitly enabled, validated configuration.');
  return { capability: 'compute.pair.control', implementation: 'exo.mlx.local', backend: 'exo',
    model: config.model_id, version: 'diagnostic-1', max_concurrency: 1, min_vram_bytes: 0,
    features: { diagnostics_only: true, inference: false, self_hosted: true, distributed_benchmark_verified: false },
    input_schema: { type: 'object', required: ['action', 'pair_id', 'reservation_id', 'node_ids', 'model_id'],
      properties: { action: { type: 'string', enum: ['probe', 'prepare', 'benchmark', 'chat', 'release'] },
        pair_id: { type: 'string' }, reservation_id: { type: 'string' }, node_ids: { type: 'array', minItems: 2, maxItems: 2 },
        runtime_node_ids: { type: 'array', minItems: 2, maxItems: 2 }, model_id: { type: 'string' }, model_revision: { type: 'string' } } },
    output_schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, state: { type: 'string' }, reason: { type: 'string' }, inference_enabled: { type: 'boolean' } } },
    executor: { type: 'http', url: 'http://127.0.0.1:4791/execute',
      // Liveness makes diagnostics schedulable; /ready remains 503 for inference.
      health_url: 'http://127.0.0.1:4791/health', health_method: 'GET', health_timeout_ms: 2000, timeout_ms: 10_000 } };
}
