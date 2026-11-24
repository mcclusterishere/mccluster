// Pure helpers the node agent uses for its Windows defaults, ACLs, signals,
// the yield claim body and the measured-inference sidecar; plus source
// assertions on node-agent.mjs itself (it starts its loop on import, so its
// wiring is checked as text).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_HARDWARE_REFRESH_MS,
  MEASURED_INFERENCE_SCHEMA,
  aclCommand,
  browserPaths,
  gpuEvidenceTtlMs,
  hardwareRefreshMs,
  isPositiveGpuEvidence,
  readMeasuredInferenceSidecar,
  resolveNodePaths,
  selectGpuEvidence,
  selectMeasuredInference,
  shutdownSignals,
  watchStopFile,
  yieldClaimBody,
  yieldToGpuMs
} from '../src/compute/node-agent-config.mjs';

const agentSource = readFileSync(new URL('../src/compute/node-agent.mjs', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../src/compute/node-agent-config.mjs', import.meta.url), 'utf8');

test('win32 defaults live under ProgramData and say which defaults were applied', () => {
  const paths = resolveNodePaths({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData' } });
  assert.equal(paths.stateDir, 'C:\\ProgramData\\mccluster-node');
  assert.equal(paths.manifest, 'C:\\ProgramData\\mccluster-node\\capabilities.json');
  assert.deepEqual(paths.defaultsApplied, ['MCCLUSTER_NODE_STATE_DIR', 'MCCLUSTER_NODE_MANIFEST']);

  const noProgramData = resolveNodePaths({ platform: 'win32', env: {} });
  assert.equal(noProgramData.stateDir, 'C:\\ProgramData\\mccluster-node');

  const overridden = resolveNodePaths({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData', MCCLUSTER_NODE_STATE_DIR: 'D:\\node-state' } });
  assert.equal(overridden.stateDir, 'D:\\node-state');
  assert.equal(overridden.manifest, 'D:\\node-state\\capabilities.json', 'the manifest default follows the chosen state dir');
  assert.deepEqual(overridden.defaultsApplied, ['MCCLUSTER_NODE_MANIFEST']);

  const explicit = resolveNodePaths({ platform: 'win32', env: { MCCLUSTER_NODE_STATE_DIR: 'D:\\s', MCCLUSTER_NODE_MANIFEST: 'D:\\m\\capabilities.json' } });
  assert.deepEqual(explicit.defaultsApplied, []);
});

test('browser executor paths: the profile under the state dir and the policy file beside the manifest, env values winning', () => {
  const win = browserPaths({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData' } });
  assert.equal(win.profileDir, 'C:\\ProgramData\\mccluster-node\\browser-profile');
  assert.equal(win.policyPath, 'C:\\ProgramData\\mccluster-node\\browser-policy.json');
  assert.deepEqual(win.defaultsApplied, ['MCCLUSTER_BROWSER_PROFILE_DIR', 'MCCLUSTER_BROWSER_POLICY']);
  const movedManifest = browserPaths({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData', MCCLUSTER_NODE_MANIFEST: 'D:\\node\\capabilities.json' } });
  assert.equal(movedManifest.policyPath, 'D:\\node\\browser-policy.json', 'the policy file follows the manifest');
  assert.equal(movedManifest.profileDir, 'C:\\ProgramData\\mccluster-node\\browser-profile', 'the profile follows the state dir');
  const posix = browserPaths({ platform: 'linux', env: {} });
  assert.equal(posix.profileDir, '/var/lib/mccluster-node/browser-profile');
  assert.equal(posix.policyPath, '/etc/mccluster-node/browser-policy.json');
  const explicit = browserPaths({ platform: 'linux', env: { MCCLUSTER_BROWSER_PROFILE_DIR: '/srv/profile', MCCLUSTER_BROWSER_POLICY: '/srv/policy.json' } });
  assert.deepEqual(explicit, { profileDir: '/srv/profile', policyPath: '/srv/policy.json', defaultsApplied: [] });
  const reused = browserPaths({ platform: 'linux', env: {}, nodePaths: { stateDir: '/opt/state', manifest: '/opt/etc/capabilities.json' } });
  assert.equal(reused.profileDir, '/opt/state/browser-profile');
  assert.equal(reused.policyPath, '/opt/etc/browser-policy.json');
});

test('POSIX defaults are unchanged', () => {
  const paths = resolveNodePaths({ platform: 'linux', env: {} });
  assert.equal(paths.stateDir, '/var/lib/mccluster-node');
  assert.equal(paths.manifest, '/etc/mccluster-node/capabilities.json');
  assert.deepEqual(paths.defaultsApplied, ['MCCLUSTER_NODE_STATE_DIR', 'MCCLUSTER_NODE_MANIFEST']);
  const custom = resolveNodePaths({ platform: 'darwin', env: { MCCLUSTER_NODE_STATE_DIR: '/opt/node', MCCLUSTER_NODE_MANIFEST: '/opt/node/caps.json' } });
  assert.equal(custom.stateDir, '/opt/node');
  assert.equal(custom.manifest, '/opt/node/caps.json');
  assert.deepEqual(custom.defaultsApplied, []);
});

test('the ACL command is icacls for the current user on win32 only', () => {
  assert.deepEqual(aclCommand({ platform: 'win32', env: { USERNAME: 'owner', USERDOMAIN: 'LAPTOP' }, target: 'C:\\ProgramData\\mccluster-node', isDirectory: true }), {
    command: 'icacls.exe',
    args: ['C:\\ProgramData\\mccluster-node', '/inheritance:r', '/grant:r', 'LAPTOP\\owner:(OI)(CI)F']
  });
  assert.deepEqual(aclCommand({ platform: 'win32', env: { USERNAME: 'owner' }, target: 'C:\\ProgramData\\mccluster-node\\identity.json', isDirectory: false }).args, [
    'C:\\ProgramData\\mccluster-node\\identity.json', '/inheritance:r', '/grant:r', 'owner:F'
  ]);
  assert.equal(aclCommand({ platform: 'win32', env: {}, target: 'C:\\x' }), null, 'no user name, no ACL change');
  assert.equal(aclCommand({ platform: 'linux', env: { USERNAME: 'owner' }, target: '/var/lib/mccluster-node' }), null);
});

test('shutdown signals include SIGBREAK on win32 only', () => {
  assert.deepEqual(shutdownSignals('win32'), ['SIGTERM', 'SIGINT', 'SIGBREAK']);
  assert.deepEqual(shutdownSignals('linux'), ['SIGTERM', 'SIGINT']);
  assert.deepEqual(shutdownSignals('darwin'), ['SIGTERM', 'SIGINT']);
});

test('the yield claim body is sent only by a non-verified node that was told a GPU node is live', () => {
  assert.deepEqual(yieldClaimBody({ yieldMs: 20_000, liveGpuNodes: 1, hardwareMode: 'cpu-only' }), { yield_seconds: 20 });
  assert.deepEqual(yieldClaimBody({ yieldMs: 1_500, liveGpuNodes: 2, hardwareMode: 'gpu-present-unverified' }), { yield_seconds: 2 });
  assert.deepEqual(yieldClaimBody({ yieldMs: 0, liveGpuNodes: 1, hardwareMode: 'cpu-only' }), {});
  assert.deepEqual(yieldClaimBody({ yieldMs: 20_000, liveGpuNodes: 0, hardwareMode: 'cpu-only' }), {});
  assert.deepEqual(yieldClaimBody({ yieldMs: 20_000, liveGpuNodes: null, hardwareMode: 'cpu-only' }), {});
  assert.deepEqual(yieldClaimBody({ yieldMs: 20_000, liveGpuNodes: 1, hardwareMode: 'gpu-verified' }), {});
  assert.equal(yieldToGpuMs({ MCCLUSTER_NODE_YIELD_TO_GPU_MS: '20000' }), 20_000);
  assert.equal(yieldToGpuMs({ MCCLUSTER_NODE_YIELD_TO_GPU_MS: '900000' }), 300_000, 'clamped to five minutes');
  assert.equal(yieldToGpuMs({ MCCLUSTER_NODE_YIELD_TO_GPU_MS: '-5' }), 0);
  assert.equal(yieldToGpuMs({}), 0);
  assert.equal(yieldToGpuMs({ MCCLUSTER_NODE_YIELD_TO_GPU_MS: 'soon' }), 0);
});

test('the GPU evidence TTL defaults to a day and never drops below a minute', () => {
  assert.equal(gpuEvidenceTtlMs({}), 86_400_000);
  assert.equal(gpuEvidenceTtlMs({ MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS: '3600000' }), 3_600_000);
  assert.equal(gpuEvidenceTtlMs({ MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS: '10' }), 60_000);
  assert.equal(gpuEvidenceTtlMs({ MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS: 'never' }), 86_400_000);
});

test('full hardware discovery is cached: every ten minutes by default, never more often than once a minute', () => {
  assert.equal(hardwareRefreshMs({}), 600_000);
  assert.equal(DEFAULT_HARDWARE_REFRESH_MS, 600_000);
  assert.equal(hardwareRefreshMs({ MCCLUSTER_NODE_HARDWARE_REFRESH_MS: '120000' }), 120_000);
  assert.equal(hardwareRefreshMs({ MCCLUSTER_NODE_HARDWARE_REFRESH_MS: '5000' }), 60_000, 'floor');
  assert.equal(hardwareRefreshMs({ MCCLUSTER_NODE_HARDWARE_REFRESH_MS: 'often' }), 600_000);
  // The agent's probe cycle takes the cached snapshot; discoverHardware (the
  // process spawns) has exactly one call site, inside the cache.
  assert.match(agentSource, /const HARDWARE_REFRESH_MS = hardwareRefreshMs\(process\.env\)/);
  assert.match(agentSource, /function hardwareSnapshot\(/);
  assert.match(agentSource, /hardwareCache = \{ at: now, value: discoverHardware\(\{ diskPath: STATE_DIR \}\) \}/);
  assert.match(agentSource, /async function probe\(\) \{[\s\S]*?const hardware = hardwareSnapshot\(\);/);
  assert.equal((agentSource.match(/discoverHardware\(/g) || []).length, 1, 'no other discoverHardware call');
});

test('the largest engine observation is the node observation; only VRAM-resident loads are positive', () => {
  const cpu = { source: 'ollama:/api/ps', model: 'qwen3:8b', size_vram_bytes: 0, size_bytes: 100, processor_gpu_percent: 0, running_models: 1, checked_at: '2026-11-17T20:00:00.000Z' };
  const gpu = { source: 'ollama:/api/ps', model: 'qwen3:14b', size_vram_bytes: 9_000, size_bytes: 9_000, processor_gpu_percent: 100, running_models: 1, checked_at: '2026-11-17T20:00:01.000Z' };
  assert.equal(selectGpuEvidence([null, cpu, gpu, undefined]), gpu);
  assert.equal(selectGpuEvidence([cpu]), cpu);
  assert.equal(selectGpuEvidence([]), null);
  assert.equal(selectGpuEvidence([{ size_vram_bytes: 'lots' }]), null, 'malformed observations are not evidence');
  assert.equal(isPositiveGpuEvidence(cpu), false);
  assert.equal(isPositiveGpuEvidence(gpu), true);
});

test('the measured-inference sidecar is parsed, sanitized and reduced to the best advertised model', () => {
  const text = JSON.stringify({
    schema: MEASURED_INFERENCE_SCHEMA,
    measurements: {
      'qwen3:8b': { generation_tokens_per_second: 22.4, prompt_tokens_per_second: 310.2, processor_gpu_percent: 100, measured_at: '2026-11-17T19:00:00.000Z', num_ctx: 16384, num_predict: 256, prompt_tokens: 120, generation_tokens: 256, ollama_version: '0.40.16', backend_note: 'x'.repeat(500) },
      'qwen3:14b': { generation_tokens_per_second: 11.9, prompt_tokens_per_second: 'fast', processor_gpu_percent: 150, measured_at: 'yesterday', num_ctx: null },
      'qwen3:0.6b': { generation_tokens_per_second: -4 },
      'other:1b': { generation_tokens_per_second: 99 }
    }
  });
  const parsed = readMeasuredInferenceSidecar(text);
  assert.equal(parsed.error, null);
  assert.equal(parsed.measurements['qwen3:8b'].generation_tokens_per_second, 22.4);
  assert.equal(parsed.measurements['qwen3:8b'].prompt_tokens_per_second, 310.2);
  assert.equal(parsed.measurements['qwen3:8b'].backend_note.length, 120);
  assert.equal(parsed.measurements['qwen3:14b'].prompt_tokens_per_second, null, 'non-numeric dropped');
  assert.equal(parsed.measurements['qwen3:14b'].processor_gpu_percent, null, 'out of range dropped');
  assert.equal(parsed.measurements['qwen3:14b'].measured_at, null, 'not an ISO time');
  assert.equal(parsed.measurements['qwen3:0.6b'].generation_tokens_per_second, null, 'negative dropped');

  const capabilities = [
    { capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b' },
    { capability: 'ai.chat', implementation: 'qwen3.14b.local', model: 'qwen3:14b' }
  ];
  const best = selectMeasuredInference(parsed.measurements, capabilities);
  assert.deepEqual(best, {
    model: 'qwen3:8b',
    generation_tokens_per_second: 22.4,
    prompt_tokens_per_second: 310.2,
    processor_gpu_percent: 100,
    measured_at: '2026-11-17T19:00:00.000Z',
    num_ctx: 16384
  });
  assert.equal(selectMeasuredInference(parsed.measurements, [{ capability: 'ai.chat', implementation: 'x', model: 'other:2b' }]), null, 'only advertised models qualify (other:1b is not advertised)');
  const tie = selectMeasuredInference({ 'b:1': { generation_tokens_per_second: 5 }, 'a:1': { generation_tokens_per_second: 5 } }, [{ model: 'a:1' }, { model: 'b:1' }]);
  assert.equal(tie.model, 'a:1', 'ties go to the first manifest entry');
  assert.equal(selectMeasuredInference({}, capabilities), null);
  assert.equal(selectMeasuredInference({ 'qwen3:8b': { generation_tokens_per_second: null } }, capabilities), null, 'a dropped generation rate cannot be the best');
});

test('an invalid or foreign sidecar is ignored with a reason', () => {
  assert.equal(readMeasuredInferenceSidecar('{not json').error, 'invalid_json');
  assert.deepEqual(readMeasuredInferenceSidecar('{not json').measurements, {});
  assert.equal(readMeasuredInferenceSidecar(JSON.stringify({ schema: 'other/9', measurements: {} })).error, 'schema_mismatch');
  assert.equal(readMeasuredInferenceSidecar(JSON.stringify({ schema: MEASURED_INFERENCE_SCHEMA, measurements: [] })).error, 'invalid_measurements');
  assert.equal(readMeasuredInferenceSidecar('[]').error, 'schema_mismatch');
  assert.equal(readMeasuredInferenceSidecar(JSON.stringify({ schema: MEASURED_INFERENCE_SCHEMA, measurements: {} })).error, null);
});

test('node-agent.mjs is wired to the 0.4.0 contract', () => {
  assert.match(agentSource, /const AGENT_VERSION = '0\.4\.0'/);
  assert.match(agentSource, /measured-inference\.json/);
  assert.match(agentSource, /MCCLUSTER_NODE_ENROLL_ONLY/);
  assert.match(agentSource, /compute_node_enroll_only_done/);
  assert.match(agentSource, /compute_node_enroll_token_missing/);
  assert.match(agentSource, /aclCommand\(/);
  assert.match(configSource, /icacls\.exe/);
  assert.match(configSource, /SIGBREAK/);
  assert.match(agentSource, /shutdownSignals\(/);
  assert.match(agentSource, /resolveNodePaths\(/);
  assert.match(agentSource, /compute_node_paths/);
  assert.match(agentSource, /gpu-evidence\.json/);
  assert.match(agentSource, /deriveHardwareMode\(/);
  assert.match(agentSource, /compute_node_label_overridden/);
  assert.match(agentSource, /compute_node_measurement_invalid/);
  assert.match(agentSource, /live_gpu_nodes/);
  assert.match(agentSource, /yieldClaimBody\(/);
  assert.match(agentSource, /diskPath: STATE_DIR/);
  // The compute-node-ci boundaries must survive.
  assert.match(agentSource, /MCCLUSTER_COMPUTE_URL must be an https:\/\/ URL/);
  assert.match(agentSource, /Node executors must be loopback services/);
  assert.doesNotMatch(agentSource, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('a stop file is noticed once, by polling, and an empty path watches nothing', () => {
  const timers = [];
  const cleared = [];
  const setIntervalImpl = (fn, ms) => { const timer = { fn, ms, unrefd: false, unref() { this.unrefd = true; } }; timers.push(timer); return timer; };
  const clearIntervalImpl = (timer) => cleared.push(timer);
  let present = false;
  let stops = 0;
  const cancel = watchStopFile('state/node-agent.stop', () => { stops += 1; }, { intervalMs: 250, exists: (file) => { assert.equal(file, 'state/node-agent.stop'); return present; }, setIntervalImpl, clearIntervalImpl });
  assert.equal(timers.length, 1);
  assert.deepEqual([timers[0].ms, timers[0].unrefd], [250, true], 'the watch never keeps the process alive');
  timers[0].fn(); timers[0].fn();
  assert.equal(stops, 0, 'no file, no stop');
  present = true;
  timers[0].fn(); timers[0].fn(); timers[0].fn();
  assert.equal(stops, 1, 'the stop is delivered exactly once');
  assert.deepEqual(cleared, [timers[0]]);
  cancel();

  // A probe that throws is "not there yet", never a stop and never a crash.
  let threw = 0;
  watchStopFile('x', () => { threw += 1; }, { exists: () => { throw new Error('EACCES'); }, setIntervalImpl, clearIntervalImpl });
  timers[1].fn();
  assert.equal(threw, 0);
  // Cancelled before the file appears: nothing fires afterwards.
  let late = 0;
  const cancelLate = watchStopFile('y', () => { late += 1; }, { exists: () => true, setIntervalImpl, clearIntervalImpl });
  cancelLate();
  timers[2].fn();
  assert.equal(late, 0);
  // No path configured: no timer at all.
  assert.equal(typeof watchStopFile('', () => { throw new Error('must not run'); }, { setIntervalImpl, clearIntervalImpl }), 'function');
  assert.equal(timers.length, 3);
  // The agent wires it to MCCLUSTER_NODE_STOP_FILE and drains: it does not abort a running lease on a stop file.
  assert.match(agentSource, /MCCLUSTER_NODE_STOP_FILE/);
  assert.match(agentSource, /watchStopFile\(STOP_FILE, \(\) => \{\s*gracefulShutdown\(active, 'stop-file'\)/);
});