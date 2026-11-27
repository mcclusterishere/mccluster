import { createPublicKey, verify } from 'node:crypto';
import { MOSAIC_MODEL_HASHES, MOSAIC_CODE_SHA256, MOSAIC_SPEC_SHA256 } from './equiquant-mosaic-contract.mjs';
import { mosaicExecutionPayload } from './equiquant-signatures.mjs';

export function validMosaicSignature(publicKey, signature, message) {
  if (typeof publicKey !== 'string' || !/^[\w-]{59}$/.test(publicKey) ||
      typeof signature !== 'string' || !/^[\w-]{86}$/.test(signature)) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}

export function verifyMosaicExecution(job, execution) {
  return execution?.target === job.input.target && execution?.hardware_sha256 === job.input.hardware_sha256 &&
    execution.backend === 'node_cpu' && execution.precision === 'binary64' &&
    execution.code_sha256 === MOSAIC_CODE_SHA256 && execution.spec_sha256 === MOSAIC_SPEC_SHA256 &&
    execution.model_sha256 === MOSAIC_MODEL_HASHES[job.input.scenario] &&
    Number.isSafeInteger(execution.elapsed_ns) && execution.elapsed_ns > 0 &&
    execution.node_version === job.input.node_version &&
    typeof job.locked_by === 'string' && job.locked_by.includes('#') &&
    execution.worker_id === job.locked_by.slice(0, job.locked_by.lastIndexOf('#')) &&
    validMosaicSignature(execution.signing_public_key, execution.signature, mosaicExecutionPayload(execution, job));
}
