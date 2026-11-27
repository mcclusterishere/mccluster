import { MOSAIC_SOURCE, mosaicReference } from './equiquant-mosaic-contract.mjs';

// Shared by Core's signer and the Worker's independent WebCrypto verifier.
// Signed structures consist exclusively of plain JSON values.
export function mosaicCanonicalJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
}

export function mosaicCapabilityPayload(attestation) {
  const { signature, ...fields } = attestation;
  return mosaicCanonicalJson({ ...fields, domain: 'equiquant-capability/v1' });
}

export function mosaicExecutionPayload(execution, job) {
  const { signature, ...fields } = execution;
  return mosaicCanonicalJson({
    domain: 'equiquant-execution/v1', execution: fields, org_id: job.org_id, project_id: job.target_id,
    job_id: job.id, scenario: job.input.scenario, result_sha256: mosaicReference(job.input.scenario).resultSha256,
    observations_sha256: MOSAIC_SOURCE.observations_sha256,
  });
}
