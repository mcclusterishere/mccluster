import { createPairService } from '../compute/pairs.mjs';
const org = { type: 'string' };
export const PAIR_TOOLS = Object.freeze([
  { name: 'core.compute.pairs.list', title: 'Read Mac pairs', description: 'Read pair readiness and the exact shared-model benchmark. Unverified hardware stays unavailable.', inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: org }, additionalProperties: false } },
  { name: 'core.compute.pair.create', title: 'Create a two-Mac pair', description: 'Record two enrolled Macs as a proposed pair. This does not assert distributed inference works.', inputSchema: { type: 'object', required: ['org_id', 'name', 'node_ids'], properties: { org_id: org, name: { type: 'string', minLength: 1, maxLength: 80 }, node_ids: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'core.compute.pair.benchmark', title: 'Benchmark an installed pair runtime', description: 'Queue a two-Mac test only when both workers advertise the explicitly installed local pair controller. No model or runtime download.', inputSchema: { type: 'object', required: ['org_id', 'pair_id'], properties: { org_id: org, pair_id: { type: 'string' } }, additionalProperties: false } },
]);
export function callPairTool(name, args, options = {}) {
  const service = createPairService();
  if (name === 'core.compute.pairs.list') return service.list(args, options.actor);
  if (name === 'core.compute.pair.create') return service.create(args, options.actor);
  if (name === 'core.compute.pair.benchmark') return service.benchmark(args, options.actor);
  throw new Error('Unknown pair operation');
}
