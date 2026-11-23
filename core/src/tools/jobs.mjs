// Owner-facing control tools for the device job contract. The Worker's owner
// gate (/v1/core/mcp, house-owner membership) overwrites org_id with the house
// org and signs the actor envelope; the same service layer answers the
// gateway's admin HTTP routes, so both doors see one contract.
import { getJob, getJobReceipt, getJobResult, listJobs, receiptKey, submitJob } from '../compute/jobs-service.mjs';
import { RUNNING_DEPLOYMENT_SHA } from '../runtime-revision.mjs';
import { resolveScopedOrg } from '../compute/http-security.mjs';

const ORG = { type: 'string', description: 'Organization id (the owner gate pins this to the house org).' };
const JOB_ID = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' };

export const JOB_TOOLS = Object.freeze([
  {
    name: 'core.compute.job.submit', title: 'Send an AI job to our own devices',
    description: 'Queue one capability job (for example ai.chat) on the McCluster compute fabric. Returns the durable job (mccluster-job/1). Refuses when no live enrolled node advertises the capability unless allow_offline is true. Idempotent per idempotency_key.',
    inputSchema: {
      type: 'object', required: ['org_id', 'capability'],
      properties: {
        org_id: ORG,
        capability: { type: 'string', pattern: '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' },
        implementation: { type: 'string', description: 'Pin one advertised implementation (for example qwen3.8b.local); omit to let any live implementation of the capability take it.' },
        input: { type: 'object', description: 'The typed capability input; for ai.chat the same shape every adapter accepts (prompt or messages, num_predict, json, think, ...).' },
        requirements: { type: 'object', description: 'Feature requirements the node must advertise (for example { vision: true }).' },
        priority: { type: 'integer', minimum: -100, maximum: 100 },
        max_attempts: { type: 'integer', minimum: 1, maximum: 100 },
        run_after: { type: 'string' },
        metadata: { type: 'object' },
        client: { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, version: { type: 'string', maxLength: 40 } } },
        idempotency_key: { type: 'string', pattern: '^[!-~]{1,128}$' },
        allow_offline: { type: 'boolean' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'core.compute.job.get', title: 'Read a device job',
    description: 'Durable status of one job: state, attempts, the lease holding it, the node and whether a result or receipt exists. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'job_id'], properties: { org_id: ORG, job_id: JOB_ID }, additionalProperties: false }
  },
  {
    name: 'core.compute.job.result', title: 'Read a device job result',
    description: 'The committed output of a done job with its canonical SHA-256 and the node that produced it. 409 JOB_NOT_DONE until then. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'job_id'], properties: { org_id: ORG, job_id: JOB_ID }, additionalProperties: false }
  },
  {
    name: 'core.compute.job.receipt', title: 'Read a signed device job receipt',
    description: 'The versioned receipt (mccluster-job-receipt/1) for a done or failed job: input and output hashes, the executing lease and node, the node\'s own completion signature when recorded, and the Core signature. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'job_id'], properties: { org_id: ORG, job_id: JOB_ID }, additionalProperties: false }
  },
  {
    name: 'core.compute.job.list', title: 'List device jobs',
    description: 'Recent jobs of the organization, newest first, optionally by status (comma-separated) and capability. Read-only.',
    inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: ORG, status: { type: 'string' }, capability: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false }
  },
  {
    name: 'core.compute.receipt.key', title: 'Read the Core receipt public key',
    description: 'The Ed25519 public key that signs job receipts, so a client can verify them offline. Read-only.',
    inputSchema: { type: 'object', properties: { org_id: ORG }, additionalProperties: false }
  }
]);

export const JOB_TOOL_NAMES = new Set(JOB_TOOLS.map((tool) => tool.name));

function requireOrg(value) {
  const orgId = String(value ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw Object.assign(new Error('org_id must be a UUID'), { status: 400 });
  // The Worker pins org_id to the house org; the Core fences it again against
  // its own MCCLUSTER_ORG_ID when it has one (403 CROSS_ORG_DENIED).
  return resolveScopedOrg(orgId.toLowerCase(), String(process.env.MCCLUSTER_ORG_ID || '').trim().toLowerCase() || null);
}

export async function callJobTool(name, args = {}, options = {}, deps = undefined) {
  if (name === 'core.compute.receipt.key') return receiptKey(deps);
  const orgId = requireOrg(args.org_id);
  if (name === 'core.compute.job.submit') {
    const { idempotency_key: idempotencyKey = null, org_id, ...body } = args;
    return submitJob({ ...body, org_id: orgId }, { canonicalOrg: orgId, idempotencyKey, actor: options?.actor || null, via: 'core-tool' }, deps);
  }
  if (name === 'core.compute.job.get') return getJob({ orgId, jobId: args.job_id }, deps);
  if (name === 'core.compute.job.result') return getJobResult({ orgId, jobId: args.job_id }, deps);
  if (name === 'core.compute.job.receipt') return getJobReceipt({ orgId, jobId: args.job_id, issuer: { instance: process.env.MCCLUSTER_CORE_ID || null, deployment_sha: RUNNING_DEPLOYMENT_SHA || null } }, deps);
  if (name === 'core.compute.job.list') return listJobs({ orgId, status: args.status || null, capability: args.capability || null, limit: args.limit || 50 }, deps);
  throw Object.assign(new Error(`Unknown job tool: ${name}`), { status: 404 });
}
