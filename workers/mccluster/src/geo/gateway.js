import { executeAdapter } from './adapters.js';
import { dataCommonsV2, epaEchoFacilities } from './verified-adapters.js';
import { sourceByKey } from './source-registry.js';
import { GeoAdapterError } from './errors.js';
import { assertLane } from './lanes.js';

export async function executeProvider(sourceKey, input = {}, env = {}, identity = null) {
  const source = sourceByKey(sourceKey);
  if (!source) throw new GeoAdapterError('Unknown spatial source', 404, 'unknown_source');
  assertLane(source, identity);
  if (sourceKey === 'data_commons') return dataCommonsV2(input, env);
  if (sourceKey === 'epa') return epaEchoFacilities(input, env);
  return executeAdapter(sourceKey, input, env);
}
