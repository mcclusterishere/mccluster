import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { refitMosaic } from './equiquant-kernel.mjs';
import { mosaicCanonicalJson } from './equiquant-signatures.mjs';
import { MOSAIC_SOURCE, MOSAIC_SPEC, MOSAIC_CODE_SHA256, MOSAIC_SPEC_SHA256, MOSAIC_MODEL_HASHES, mosaicReference } from './equiquant-mosaic-contract.mjs';

export const mosaicDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readMosaicInputs(signal) {
  const [bytes, kernel] = await Promise.all([
    readFile(new URL('../data/equiquant/observations.json', import.meta.url), {signal}),
    readFile(new URL('./equiquant-kernel.mjs', import.meta.url), {signal}),
  ]);
  if (mosaicDigest(bytes) !== MOSAIC_SOURCE.observations_sha256 ||
      mosaicDigest(kernel) !== MOSAIC_CODE_SHA256 || mosaicDigest(mosaicCanonicalJson(MOSAIC_SPEC)) !== MOSAIC_SPEC_SHA256) {
    throw new Error('MOSAiC data, kernel or experiment specification changed');
  }
  return JSON.parse(bytes);
}

export function measuredMosaicFit(observations, scenario) {
  const reference = mosaicReference(scenario);
  const start = process.hrtime.bigint();
  const { configurations, coefficients } = refitMosaic(observations, scenario);
  const elapsedNs = Number(process.hrtime.bigint() - start);
  const resultJson = mosaicCanonicalJson({ scenario, configurations });
  const resultSha256 = mosaicDigest(resultJson);
  const modelSha256 = mosaicDigest(mosaicCanonicalJson({ scenario, coefficients }));
  if (resultSha256 !== reference.resultSha256 || modelSha256 !== MOSAIC_MODEL_HASHES[scenario]) {
    throw new Error('MOSAiC fitted coefficients or replay differ from the pinned reference');
  }
  if (!Number.isSafeInteger(elapsedNs) || elapsedNs <= 0) throw new Error('Invalid MOSAiC monotonic runtime measurement');
  return {
    elapsedNs, modelSha256, result_sha256: resultSha256, result_json: resultJson,
    held_out_mse: configurations.primary.held_out_mse, folds: configurations.primary.folds.length,
  };
}
