import { createDeviceService } from '../compute/devices.mjs';

const org = { org_id: { type: 'string', format: 'uuid' } };
const node = { ...org, node_id: { type: 'string', pattern: '^node_[a-f0-9]{24,64}$' } };
const schema = (required, properties) => ({ type: 'object', required, properties, additionalProperties: false });

export const DEVICE_TOOLS = Object.freeze([
  { name: 'core.compute.devices.list', title: 'List owner devices', description: 'House owner only. Read enrolled workers, pending enrollment, local-model readiness, device tests and recovery steps. Never returns credentials or device keys.', inputSchema: schema(['org_id'], org) },
  { name: 'core.compute.enrollment.create', title: 'Add an owner device', description: 'House owner only. Issue a short-lived, single-use enrollment credential for one device. The response is secret; show it once and never store it in a URL, command or transcript. Supplying a pending enrollment_id replaces its previous credential.', inputSchema: schema(['org_id', 'display_name'], { ...org, display_name: { type: 'string', minLength: 1, maxLength: 80 }, platform: { type: 'string', enum: ['darwin', 'win32', 'linux'] }, enrollment_id: { type: 'string', format: 'uuid' } }) },
  { name: 'core.compute.device.update', title: 'Manage an owner device', description: 'House owner only. Rename, pause new leases, resume or revoke a worker. Revocation is permanent for this key; existing lease authority rules reject renewals and late results.', inputSchema: schema(['org_id', 'node_id', 'action'], { ...node, action: { type: 'string', enum: ['rename', 'pause', 'resume', 'revoke'] }, display_name: { type: 'string', minLength: 1, maxLength: 80 } }) },
  { name: 'core.compute.device.test', title: 'Test an owner device', description: 'House owner only. Queue a short qwen3:8b test pinned to this device with a 4K context. Successful completion is verified from the actual lease, never a client claim.', inputSchema: schema(['org_id', 'node_id'], node) },
]);

const service = createDeviceService();
export async function callDeviceTool(name, args = {}, options = {}) {
  if (name === 'core.compute.devices.list') return service.list(args, options);
  if (name === 'core.compute.enrollment.create') return service.createEnrollment(args, options);
  if (name === 'core.compute.device.update') return service.update(args, options);
  if (name === 'core.compute.device.test') return service.test(args, options);
  throw Object.assign(new Error('Unknown device operation.'), { code: 'DEVICE_TOOL_UNKNOWN', status: 404 });
}
