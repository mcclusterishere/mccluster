import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { createPublicKey, sign } from 'node:crypto';
import { generateNodeIdentity } from './compute/signature.mjs';
import { rest, workerId } from './supabase.mjs';
import { readMosaicInputs, measuredMosaicFit, mosaicDigest } from './equiquant-refit.mjs';
import { MOSAIC_CODE_SHA256, MOSAIC_MODEL_HASHES, MOSAIC_SOURCE, MOSAIC_SPEC_SHA256 } from './equiquant-mosaic-contract.mjs';
import { mosaicCanonicalJson, mosaicCapabilityPayload, mosaicExecutionPayload } from './equiquant-signatures.mjs';
import { validMosaicSignature, verifyMosaicExecution } from './equiquant-verify.mjs';

let identity;
let registered;
let registration;
const refreshIntervalMs = 30_000;
let machineHash;
export function mosaicMachineSha256() {
  if (machineHash) return machineHash;
  // Installation identity distinguishes same-model machines with cloned hostnames.
  // The raw installation ID and hostname stay in the process.
  let installation;
  if (process.platform === 'win32') {
    const value = execFileSync(join(process.env.SystemRoot, 'System32', 'reg.exe'),
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    installation = /MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i.exec(value)?.[1];
  } else if (process.platform === 'linux') {
    installation = readFileSync('/etc/machine-id', 'utf8').trim();
  }
  const cpus = os.cpus();
  if (!/^[0-9a-f]{32}$/i.test(installation?.replaceAll('-', '') || '') ||
      !cpus.length || !os.hostname() || !cpus.every(cpu => cpu.model?.trim())) throw new Error('CPU/installation identity unavailable');
  machineHash = mosaicDigest(mosaicCanonicalJson({
    installation: installation.toLowerCase(), host: os.hostname(), platform: process.platform,
    arch: process.arch, cpus: cpus.map(cpu => cpu.model.trim()),
  }));
  return machineHash;
}

function targetOnThisRunner() {
  const target = process.env.MCCLUSTER_EQUIQUANT_TARGET;
  if (!target) return null;
  const fingerprint = mosaicMachineSha256();
  if (fingerprint !== process.env.MCCLUSTER_EQUIQUANT_MACHINE_SHA256) throw new Error('EquiQuant runner identity is unverified');
  if (target === 'ovh_core') {
    const path = '/opt/mccluster/core/.mccluster-deploy.json';
    const deployed = process.platform === 'linux' && new URL('./runner.mjs', import.meta.url).pathname === '/opt/mccluster/core/src/runner.mjs'
      && JSON.parse(readFileSync(path, 'utf8'));
    if (!/^[0-9a-f]{40}$/.test(deployed?.commit_sha || '')) throw new Error('OVH Core deployment identity unavailable');
  } else if (target !== 'prime') throw new Error('Unsupported EquiQuant execution target');
  return { target, fingerprint };
}

async function register(target, fingerprint) {
  // Exercise the entire pinned executable on this machine before announcing it.
  if (Math.fround(2 ** 24 + 1) === 2 ** 24 + 1 || 2 ** 53 + 1 !== 2 ** 53) throw new Error('Binary64 probe failed');
  const observations = await readMosaicInputs();
  for (const scenario of Object.keys(MOSAIC_MODEL_HASHES)) measuredMosaicFit(observations, scenario);

  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(workerId)) throw new Error('Core worker identity cannot sign a lease');
  identity ||= generateNodeIdentity();
  const publicDer = createPublicKey(identity.publicKeyPem).export({ format: 'der', type: 'spki' });
  const attestation = {
    target, backend: 'node_cpu', precision: 'binary64', hardware_sha256: fingerprint,
    code_sha256: MOSAIC_CODE_SHA256, spec_sha256: MOSAIC_SPEC_SHA256, observations_sha256: MOSAIC_SOURCE.observations_sha256,
    model_hashes: MOSAIC_MODEL_HASHES, node_version: process.versions.node, worker_id: workerId,
    signing_public_key: publicDer.toString('base64url'), observed_at: new Date().toISOString(),
  };
  const message = mosaicCapabilityPayload(attestation);
  attestation.signature = sign(null, Buffer.from(message), identity.privateKeyPem).toString('base64url');
  if (!validMosaicSignature(attestation.signing_public_key, attestation.signature, message)) throw new Error('Invalid capability signature');
  const response = await rest('rpc/equiquant_attest_target', { method: 'POST', body: JSON.stringify({ p_attestation: attestation }) });
  if (response.body?.ok !== true) throw new Error('EquiQuant capability registration was refused');
  registered = Object.freeze(attestation);
  return registered;
}

export async function refreshMosaicCapability() {
  const selection = targetOnThisRunner();
  if (!selection) return null;
  const { target, fingerprint } = selection;
  if (registered?.target === target && registered.hardware_sha256 === fingerprint &&
      Date.now() - Date.parse(registered.observed_at) < refreshIntervalMs) return registered;
  registration ||= register(target, fingerprint).finally(() => { registration = null; });
  return registration;
}

export function signMosaicExecution(job, elapsedNs, modelSha256) {
  const cap = registered;
  if (!cap || cap.target !== job.input.target || cap.hardware_sha256 !== job.input.hardware_sha256 || cap.node_version !== job.input.node_version ||
      Date.now() - Date.parse(cap.observed_at) > 120_000) throw new Error('No current capability for this MOSAiC run');
  const execution = {
    target: cap.target, hardware_sha256: cap.hardware_sha256, backend: cap.backend, precision: cap.precision,
    code_sha256: cap.code_sha256, spec_sha256: cap.spec_sha256, model_sha256: modelSha256,
    elapsed_ns: elapsedNs, node_version: cap.node_version, worker_id: cap.worker_id, signing_public_key: cap.signing_public_key,
  };
  execution.signature = sign(null, Buffer.from(mosaicExecutionPayload(execution, job)), identity.privateKeyPem).toString('base64url');
  if (!verifyMosaicExecution(job, execution)) throw new Error('Invalid MOSAiC execution receipt');
  return execution;
}
