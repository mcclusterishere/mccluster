import { MOSAIC_EXECUTOR, MOSAIC_SOURCE, replaySelection } from '../equiquant-mosaic-contract.mjs';
import { readMosaicInputs, measuredMosaicFit } from '../equiquant-refit.mjs';
import { signMosaicExecution } from '../equiquant-runtime.mjs';

export async function equiquantMosaicReplay(job, { signal } = {}) {
  const { scenario, target } = replaySelection(job);
  if (!target) throw new Error('A verified MOSAiC execution target is required');
  const observations = await readMosaicInputs(signal);
  const { elapsedNs, modelSha256, ...result } = measuredMosaicFit(observations, scenario);
  const output = { executor: MOSAIC_EXECUTOR, ...MOSAIC_SOURCE, scenario, ...result };
  output.execution = signMosaicExecution(job, elapsedNs, modelSha256);
  return output;
}
