import {
  MOSAIC_CODE_SHA256, MOSAIC_SPEC_SHA256, MOSAIC_MODEL_HASHES, MOSAIC_SOURCE, mosaicReference
} from '../../../core/src/equiquant-mosaic-contract.mjs';
import { mosaicCapabilityPayload, mosaicExecutionPayload } from '../../../core/src/equiquant-signatures.mjs';

const SUPPORTED = new Set(['prime', 'ovh_core']);
const HASH = /^[0-9a-f]{64}$/;
const CLAIM_WINDOW_MS = 120_000;

function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function verifies(record, payload) {
  if (!/^[A-Za-z0-9_-]{59}$/.test(record.signing_public_key) || !/^[A-Za-z0-9_-]{86}$/.test(record.signature)) return false;
  try {
    const key = await crypto.subtle.importKey('spki', decode(record.signing_public_key), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, decode(record.signature), new TextEncoder().encode(payload));
  } catch { return false; }
}

// The database authenticates the registering Core service, binds its key to the
// lease and returns that binding only to the Worker. A signature alone cannot
// establish that a client-supplied key belongs to a worker.
async function capabilityMatches(attestation, target, requireFresh) {
  if (!attestation || !SUPPORTED.has(target) || attestation.target !== target ||
      attestation.backend !== 'node_cpu' || attestation.precision !== 'binary64' ||
      !HASH.test(attestation.hardware_sha256) || !attestation.worker_id || !attestation.node_version ||
      attestation.code_sha256 !== MOSAIC_CODE_SHA256 || attestation.spec_sha256 !== MOSAIC_SPEC_SHA256 ||
      attestation.observations_sha256 !== MOSAIC_SOURCE.observations_sha256 ||
      !Object.entries(MOSAIC_MODEL_HASHES).every(([id, hash]) => attestation.model_hashes?.[id] === hash)) return false;
  const age = Date.now() - Date.parse(attestation.observed_at);
  if (!Number.isFinite(age) || age < -5000 || (requireFresh && age >= CLAIM_WINDOW_MS)) return false;
  return verifies(attestation, mosaicCapabilityPayload(attestation));
}

export async function targetAvailable(target) {
  return target?.available === true && capabilityMatches(target.attestation, target.id, true);
}

export async function verifiedRun(run, orgId, projectId) {
  if (run?.status !== 'done' || !Object.hasOwn(MOSAIC_MODEL_HASHES, run.scenario)) return false;
  const { attestation, execution } = run;
  const ref = mosaicReference(run.scenario);
  if (!execution || run.result_sha256 !== ref.resultSha256 || run.held_out_mse !== ref.heldOutMse || run.folds !== 13 ||
      !Object.entries(MOSAIC_SOURCE).every(([key, value]) => run[key] === value) ||
      execution.model_sha256 !== MOSAIC_MODEL_HASHES[run.scenario] ||
      !Number.isSafeInteger(execution.elapsed_ns) || execution.elapsed_ns <= 0 ||
      !await capabilityMatches(attestation, execution.target, false)) return false;
  if (!['target', 'backend', 'precision', 'hardware_sha256', 'code_sha256', 'spec_sha256',
    'node_version', 'worker_id', 'signing_public_key'].every(key => attestation[key] === execution[key])) return false;
  if (run.target !== execution.target || run.hardware_sha256 !== execution.hardware_sha256) return false;
  const job = { id: run.job_id, target_id: projectId, org_id: orgId, input: { scenario: run.scenario } };
  return verifies(execution, mosaicExecutionPayload(execution, job));
}

async function displayRun(run, orgId, projectId) {
  // Keep pre-attestation receipts readable without offering them as verified targets.
  const { attestation, execution, ...receipt } = run;
  if (!execution && run.status !== 'done') return receipt;
  if (!await verifiedRun(run, orgId, projectId)) return { ...receipt, status: 'unverified', execution_verified: false };
  const { worker_id, signature, signing_public_key, ...measurement } = execution;
  return { ...receipt, execution: measurement, execution_verified: true };
}

export async function displayProject(state, orgId) {
  const projectId = state.project.id;
  const [targets, runs, releaseRun] = await Promise.all([
    Promise.all((state.targets || []).map(async raw => {
      const ok = await targetAvailable(raw);
      const target = { id: raw.id, label: raw.label, available: ok,
        reason: raw.available && !ok ? 'No current verified capability for this experiment.' : raw.reason };
      if (ok) Object.assign(target, { backend: raw.attestation.backend, precision: raw.attestation.precision });
      return target;
    })),
    Promise.all(state.runs.map(run => displayRun(run, orgId, projectId))),
    state.release ? displayRun(state.release.run, orgId, projectId) : null
  ]);
  return { ...state, targets, runs, release: state.release ? { ...state.release, run: releaseRun } : null };
}
