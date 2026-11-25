// Core tools for automated entity resolution (duplicate-record matching).
// Owner actor required for anything that writes; reads stay house-only in the
// database. Contract: docs/control-plane/ENTITY-RESOLUTION.md
import { enqueueJob } from '../supabase.mjs';
import { runEntityMatchScan, scanOptions, supabaseRpc } from '../entity-resolution/scan.mjs';
import { MATCHER_VERSION, THRESHOLDS } from '../entity-resolution/match.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ['linked', 'pending_review', 'rejected', 'unlinked', 'expired'];

function requireUuid(value, field) {
  const v = String(value ?? '').trim();
  if (!UUID.test(v)) throw Object.assign(new Error(`${field} must be a UUID`), { status: 400 });
  return v;
}

const scanProps = {
  org_id: { type: 'string' },
  type_keys: { type: 'array', items: { type: 'string' }, maxItems: 40 },
  max_objects: { type: 'integer', minimum: 1, maximum: 20000 },
  auto_threshold: { type: 'number', minimum: THRESHOLDS.auto, maximum: 1 },
  review_threshold: { type: 'number', minimum: THRESHOLDS.review, maximum: 1 },
  dry_run: { type: 'boolean' },
  queue: { type: 'boolean' },
};

export const ENTITY_MATCH_TOOLS = Object.freeze([
  {
    name: 'core.entity.match.scan', title: 'Find duplicate records',
    description: `Scan person and company ontology objects (leads, clients, contacts, venues, vendors...) for duplicates with deterministic keys (normalized email, phone, domain, name+organization) and fuzzy name scoring. Score >= ${THRESHOLDS.auto} with a strong exact key is linked automatically; ${THRESHOLDS.review} to ${THRESHOLDS.auto} files a pending owner approval in Control. Links only, never merges or deletes, every change reversible and audited. dry_run previews without writing; queue runs it as a Core job.`,
    inputSchema: { type: 'object', required: ['org_id'], properties: scanProps, additionalProperties: false },
  },
  {
    name: 'core.entity.match.list', title: 'List duplicate matches',
    description: 'List entity matches by status (linked, pending_review, rejected, unlinked, expired) with score and hashed evidence. Read-only.',
    inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: { type: 'string' }, status: { type: 'string', enum: STATUSES }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false },
  },
  {
    name: 'core.entity.match.cluster', title: 'Read a same-as cluster',
    description: 'Every object currently linked to one ontology object, transitively. Read-only.',
    inputSchema: { type: 'object', required: ['org_id', 'object_id'], properties: { org_id: { type: 'string' }, object_id: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'core.entity.match.settle', title: 'Apply duplicate review decisions',
    description: 'Apply owner decisions already taken in Control: an approved match with the same request hash is linked, a denied one rejected, an expired one closed. Owner only.',
    inputSchema: { type: 'object', required: ['org_id'], properties: { org_id: { type: 'string' }, match_id: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'core.entity.match.unlink', title: 'Undo a duplicate link',
    description: 'Owner reverse switch: remove a same-as link (or reject a pending match and deny its approval). Needs a reason; all history is kept and the pair is never proposed again. Owner only.',
    inputSchema: { type: 'object', required: ['org_id', 'match_id', 'reason'], properties: { org_id: { type: 'string' }, match_id: { type: 'string' }, reason: { type: 'string', minLength: 3, maxLength: 1000 } }, additionalProperties: false },
  },
]);

export async function callEntityMatchTool(name, args = {}, options = {}, { rpc = supabaseRpc, enqueue = enqueueJob } = {}) {
  const orgId = requireUuid(args.org_id, 'org_id');

  if (name === 'core.entity.match.list') {
    const status = STATUSES.includes(args.status) ? args.status : null;
    const limit = Math.min(500, Math.max(1, Number(args.limit || 100)));
    return { org_id: orgId, status, ...(await rpc('ops_entity_match_list', { p_org: orgId, p_status: status, p_limit: limit })) };
  }
  if (name === 'core.entity.match.cluster') {
    const objectId = requireUuid(args.object_id, 'object_id');
    return { org_id: orgId, ...(await rpc('ops_entity_match_cluster', { p_org: orgId, p_object: objectId })) };
  }

  const actor = requireUuid(options?.actor?.user_id, 'authenticated actor user_id');

  if (name === 'core.entity.match.scan') {
    if (args.queue === true) {
      const opts = scanOptions(args);
      const job = await enqueue({
        orgId, jobType: 'entity_match_scan', targetType: 'ontology', targetId: 'entity_resolution', priority: 30, maxAttempts: 2,
        input: { actor_user_id: actor, type_keys: opts.typeKeys, max_objects: opts.maxObjects, auto_threshold: opts.thresholds.auto, review_threshold: opts.thresholds.review, trigger: 'job' },
      });
      return { queued: true, job_id: job.id, job_type: job.job_type, matcher_version: MATCHER_VERSION };
    }
    return runEntityMatchScan({ orgId, actorUserId: actor, args, trigger: 'tool', rpc });
  }
  if (name === 'core.entity.match.settle') {
    const matchId = args.match_id ? requireUuid(args.match_id, 'match_id') : null;
    return { org_id: orgId, ...(await rpc('ops_entity_match_settle', { p_org: orgId, p_actor: actor, p_match: matchId })) };
  }
  if (name === 'core.entity.match.unlink') {
    const matchId = requireUuid(args.match_id, 'match_id');
    const reason = String(args.reason ?? '').trim().slice(0, 1000);
    if (reason.length < 3) throw Object.assign(new Error('reason is required'), { status: 400 });
    return { org_id: orgId, ...(await rpc('ops_entity_match_unlink', { p_org: orgId, p_actor: actor, p_match: matchId, p_reason: reason })) };
  }
  throw Object.assign(new Error(`Unknown entity match tool: ${name}`), { status: 404 });
}
