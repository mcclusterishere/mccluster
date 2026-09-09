import { executeAdapter } from './adapters.js';
import { dataCommonsV2, epaEchoFacilities } from './verified-adapters.js';

export async function executeProvider(sourceKey, input = {}, env = {}) {
  if (sourceKey === 'data_commons') return dataCommonsV2(input, env);
  if (sourceKey === 'epa') return epaEchoFacilities(input, env);
  return executeAdapter(sourceKey, input, env);
}
