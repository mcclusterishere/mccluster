/* ============================================================
   core.workstream.* — DURABLE WORKSTREAM CHECKPOINTS.

   core.resume could tell a fresh session what the machine was doing
   (jobs, leases, approvals) and nothing about what the WORK was: which
   branch, which pull request, what was decided, what was verified, what
   comes next. That state lived in a model's context window and died
   with it. These two tools put it in the private context plane.

     core.workstream.checkpoint   write: the workstream's state and, in
                                  the same transaction, one append-only
                                  event. Validated, bounded, refuses
                                  credentials and transcripts, stamped
                                  with the actor the broker handed the
                                  call (never one from the arguments);
                                  the database verifies an owner actor
                                  against public.org_members. Idempotent
                                  on the operation key.
     core.workstream.list         read: the workstreams, active first,
                                  with the resume packet.

   Storage is ai_context (supabase/migrations/20261124164529_ai_context_workstreams_v1.sql),
   reached only through the service-role RPCs public.ops_ai_workstream_*.
   There is no second store: nothing is written to this host's disk.
   Until that SQL is applied both tools say so plainly (503,
   WORKSTREAMS_NOT_APPLIED) instead of pretending there is nothing here.

   Contract: docs/control-plane/WORKSTREAM-CHECKPOINTS.md
   ============================================================ */

import { rest } from '../supabase.mjs';
import {
  WORKSTREAM_SCHEMA, WORKSTREAM_STATUSES, WORKSTREAM_EVENT_KINDS, WORKSTREAM_SENSITIVITIES, DECISION_RISK_CLASSES,
  WORKSTREAM_BOUNDS, WORKSTREAM_ID, PACKET_DEFAULT_CHARS, PACKET_MAX_CHARS,
  WorkstreamContractError, normalizeWorkstream, normalizeEvent, normalizeProvenance,
  requireOperationKey, deriveOperationKey, buildResumePacket
} from '../workstream-contract.mjs';

export const WORKSTREAMS_PENDING_SQL = 'supabase/migrations/20261124164529_ai_context_workstreams_v1.sql';
export const WORKSTREAMS_NOT_APPLIED = 'WORKSTREAMS_NOT_APPLIED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOrg(value) {
  const orgId = String(value ?? '').trim().slice(0, 100);
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });
  if (!UUID.test(orgId)) throw Object.assign(new Error('org_id must be a UUID'), { status: 400 });
  return orgId;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* PostgREST answers a call to a function it cannot find with 404 and
   PGRST202. That is "this database does not have the workstream SQL
   yet", a known state, and must never be confused with an outage or
   with an empty result. */
export function isNotApplied(error) {
  const code = error?.detail?.code;
  if (code === 'PGRST202') return true;
  return error?.status === 404 && /ops_ai_workstream_/.test(String(error?.message || ''));
}

/* The SQL raises with standard SQLSTATEs; a caller should get the HTTP
   meaning, not a generic 400/500 from the transport. */
const SQLSTATE_STATUS = {
  22023: 400, 22001: 400, 22007: 400, 23503: 400, P0002: 404,
  23505: 409, 40001: 409, 42501: 403, 54000: 429
};
export const WORKSTREAM_ORG_OUTSIDE_AUTHORITY = 'WORKSTREAM_ORG_OUTSIDE_AUTHORITY';
/* 42501 is also "permission denied for function" (a broken grant). Only
   the house rule's own sentence means "this organization has no
   workstreams by design". */
const OUTSIDE_AUTHORITY = /organization outside Core authority/;

function refusalCode(sqlstate, message) {
  if (sqlstate === '23505') return 'WORKSTREAM_OPERATION_KEY_CONFLICT';
  if (sqlstate === '54000') return 'WORKSTREAM_QUOTA_EXCEEDED';
  if (sqlstate === '42501' && OUTSIDE_AUTHORITY.test(message)) return WORKSTREAM_ORG_OUTSIDE_AUTHORITY;
  return 'WORKSTREAM_REFUSED';
}

function translate(error) {
  if (isNotApplied(error)) {
    return Object.assign(new Error(`Workstream checkpoints are not applied on this database (${WORKSTREAMS_PENDING_SQL}); nothing was written`), {
      status: 503, code: WORKSTREAMS_NOT_APPLIED
    });
  }
  const sqlstate = error?.detail?.code;
  if (sqlstate && SQLSTATE_STATUS[sqlstate]) {
    const message = String(error.message || 'workstream checkpoint refused').slice(0, 500);
    return Object.assign(new Error(message), {
      status: SQLSTATE_STATUS[sqlstate],
      code: refusalCode(String(sqlstate), message)
    });
  }
  return error;
}

async function rpc(name, args) {
  try {
    const { body } = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
    return body;
  } catch (error) {
    throw translate(error);
  }
}

const WORKSTREAM_INPUT = {
  type: 'object',
  required: ['id'],
  description: `One ${WORKSTREAM_SCHEMA} record. title and goal are required the first time an id is checkpointed; after that, send only what changed. An optional text field sent as "" is cleared.`,
  properties: {
    schema: { type: 'string', enum: [WORKSTREAM_SCHEMA] },
    id: { type: 'string', pattern: WORKSTREAM_ID.source },
    title: { type: 'string', minLength: 1, maxLength: WORKSTREAM_BOUNDS.title },
    goal: { type: 'string', minLength: 1, maxLength: WORKSTREAM_BOUNDS.goal },
    status: { type: 'string', enum: [...WORKSTREAM_STATUSES] },
    branch: { type: 'string', maxLength: WORKSTREAM_BOUNDS.branch },
    head: { type: 'string', maxLength: WORKSTREAM_BOUNDS.head },
    pr: { type: 'string', maxLength: WORKSTREAM_BOUNDS.pr },
    worktree: { type: 'string', maxLength: WORKSTREAM_BOUNDS.worktree },
    next: { type: 'string', maxLength: WORKSTREAM_BOUNDS.next },
    created_at: { type: 'string', description: 'ISO 8601 with a zone' },
    updated_at: { type: 'string', description: 'ISO 8601 with a zone. When sent, an older value never overwrites a newer checkpoint.' },
    objective_id: { type: 'string', description: 'ops_objectives.id this work serves; verified to exist, never copied' },
    job_ids: { type: 'array', maxItems: WORKSTREAM_BOUNDS.job_ids, items: { type: 'string' }, description: 'ops_agent_jobs ids; verified to exist, never copied' },
    sensitivity: { type: 'string', enum: [...WORKSTREAM_SENSITIVITIES] }
  },
  additionalProperties: false
};

const EVENT_INPUT = {
  type: 'object',
  required: ['kind', 'text'],
  description: 'One append-only event. Facts, decisions, references and evidence paths only: never a credential, never a transcript.',
  properties: {
    at: { type: 'string', description: 'ISO 8601 with a zone; when omitted the plane records its own time and operation_key is required' },
    kind: { type: 'string', enum: [...WORKSTREAM_EVENT_KINDS] },
    text: { type: 'string', minLength: 1, maxLength: WORKSTREAM_BOUNDS.text },
    evidence: { type: 'string', maxLength: WORKSTREAM_BOUNDS.evidence, description: 'a path, commit, URL or check name that proves the text' },
    by: { type: 'string', maxLength: WORKSTREAM_BOUNDS.by },
    sensitivity: { type: 'string', enum: [...WORKSTREAM_SENSITIVITIES] },
    objective_id: { type: 'string' },
    job_id: { type: 'string' },
    decision_id: { type: 'string', description: 'decision events only: the ai_context.decisions row this records' },
    decision: {
      type: 'object',
      required: ['title'],
      description: 'decision events only: propose an ai_context.decisions row (status proposed; approval stays with the owner through context-decision)',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: WORKSTREAM_BOUNDS.decision_title },
        decision: { type: 'string', maxLength: WORKSTREAM_BOUNDS.decision_text },
        rationale_summary: { type: 'string', maxLength: WORKSTREAM_BOUNDS.rationale_summary },
        risk_class: { type: 'string', enum: [...DECISION_RISK_CLASSES] }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const WORKSTREAM_TOOLS = Object.freeze([
  {
    name: 'core.workstream.checkpoint',
    title: 'Checkpoint a workstream',
    description: 'Record where a line of work stands (branch, head, pull request, next step) and optionally one append-only event (decision, done, verified, blocker, unblocked, note, open) in the private context plane, in one transaction. Owner-attributed, idempotent on operation_key, refuses credentials and raw transcripts. Writes only ai_context; it queues no job, runs no code, deploys nothing and sends nothing.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'workstream'],
      properties: {
        org_id: { type: 'string' },
        workstream: WORKSTREAM_INPUT,
        event: EVENT_INPUT,
        operation_key: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$', description: 'Idempotency key for the event. Optional when event.at is set (it is then derived from the event content); required otherwise.' },
        provenance: {
          type: 'object',
          description: 'What the harness says about itself. The actor is never an argument: it is the one the broker handed this call (on the remote route, the authenticated house owner), and the database verifies an owner actor against the organization\'s owners.',
          properties: {
            harness: { type: 'string', maxLength: WORKSTREAM_BOUNDS.harness },
            model_id: { type: 'string', maxLength: WORKSTREAM_BOUNDS.model_id },
            session_id: { type: 'string', maxLength: WORKSTREAM_BOUNDS.session_id },
            device: { type: 'string', maxLength: WORKSTREAM_BOUNDS.device }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'core.workstream.list',
    title: 'Read workstream checkpoints',
    description: 'Read the checkpointed workstreams, active first, then blocked, parked and done, each with its recent decisions, verified results, open questions and uncleared blockers, plus the generated resume packet. Read-only; queues and changes nothing.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: {
        org_id: { type: 'string' },
        workstream_id: { type: 'string', pattern: WORKSTREAM_ID.source, description: 'one workstream by its id' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        max_sensitivity: { type: 'string', enum: [...WORKSTREAM_SENSITIVITIES], description: 'default internal; above internal needs the authenticated owner' },
        max_chars: { type: 'integer', minimum: 1000, maximum: PACKET_MAX_CHARS, description: `resume packet size, default ${PACKET_DEFAULT_CHARS}` }
      },
      additionalProperties: false
    }
  }
]);

function onlyArgs(args, allowed) {
  const unknown = Object.keys(args || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new WorkstreamContractError(`unknown argument: ${unknown.slice(0, 5).join(', ')}`, { code: 'WORKSTREAM_UNKNOWN_FIELD' });
  }
}

/* A row the resume RPC returns. A 200 whose rows are not this shape means
   the function no longer does what this code thinks it does. */
function validRow(row) {
  return isRecord(row) && typeof row.id === 'string' && WORKSTREAM_STATUSES.includes(row.status)
    && (row.withheld === true || (typeof row.title === 'string' && typeof row.goal === 'string' && Array.isArray(row.events)));
}

/* Shared by core.workstream.list and core.resume. Throws on any failure;
   `not applied` carries code WORKSTREAMS_NOT_APPLIED so a caller can
   report it as a known state rather than an outage. */
export async function readWorkstreams({ orgId, limit = 20, maxSensitivity = 'internal', workstreamId = null, actorId = null } = {}) {
  const body = await rpc('ops_ai_workstream_resume', {
    p_org: orgId,
    p_limit: Math.min(50, Math.max(1, Number(limit) || 20)),
    p_max_sensitivity: maxSensitivity,
    p_workstream_key: workstreamId,
    /* Only a read above internal names an actor, and the database (not
       this code) decides whether that actor is an owner of the org. */
    ...(actorId ? { p_actor_id: actorId } : {})
  });
  if (!Array.isArray(body) || body.some((row) => !validRow(row))) {
    throw Object.assign(new Error(`Expected an array of ${WORKSTREAM_SCHEMA} rows from ops_ai_workstream_resume`), {
      code: 'INVALID_SOURCE_SHAPE'
    });
  }
  const total = body.length ? Number(body[0].total) : 0;
  return {
    workstreams: body.map(({ total: _total, ...row }) => row),
    total: Number.isFinite(total) ? Math.max(total, body.length) : body.length
  };
}

export async function callWorkstreamTool(name, args = {}, options = {}) {
  if (!isRecord(args)) throw new WorkstreamContractError('arguments must be an object');

  if (name === 'core.workstream.checkpoint') {
    onlyArgs(args, ['org_id', 'workstream', 'event', 'operation_key', 'provenance']);
    /* The actor first: an unattributed write is refused before anything
       about its content is even looked at. */
    const provenance = normalizeProvenance(args.provenance, options?.actor);
    const orgId = requireOrg(args.org_id);
    const workstream = normalizeWorkstream(args.workstream);
    const event = args.event === undefined || args.event === null ? null : normalizeEvent(args.event);
    let operationKey = null;
    if (event) {
      operationKey = args.operation_key === undefined || args.operation_key === null
        ? deriveOperationKey(workstream.id, event)
        : requireOperationKey(args.operation_key);
    } else if (args.operation_key !== undefined && args.operation_key !== null) {
      requireOperationKey(args.operation_key);
    }
    const result = await rpc('ops_ai_workstream_checkpoint', {
      p_org: orgId,
      p_workstream: workstream,
      p_operation_key: operationKey,
      p_event: event,
      p_provenance: provenance
    });
    if (!isRecord(result) || !isRecord(result.workstream)) {
      throw Object.assign(new Error('ops_ai_workstream_checkpoint returned an unexpected shape; the checkpoint is not confirmed'), { status: 502 });
    }
    return {
      org_id: orgId,
      schema: result.schema || 'mccluster-workstream-checkpoint/1',
      actor: { user_id: provenance.actor_id, kind: provenance.actor_kind },
      operation_key: operationKey,
      workstream: result.workstream,
      event: result.event ?? null,
      canonical_store: 'ai_context.workstreams+ai_context.workstream_events',
      safety: { queues_jobs: false, code_changes: false, deploys: false, communications: false, spending: false, approves_decisions: false }
    };
  }

  if (name === 'core.workstream.list') {
    onlyArgs(args, ['org_id', 'workstream_id', 'limit', 'max_sensitivity', 'max_chars']);
    const orgId = requireOrg(args.org_id);
    const maxSensitivity = args.max_sensitivity === undefined || args.max_sensitivity === null ? 'internal' : args.max_sensitivity;
    if (!WORKSTREAM_SENSITIVITIES.includes(maxSensitivity)) {
      throw new WorkstreamContractError(`max_sensitivity must be one of ${WORKSTREAM_SENSITIVITIES.join(', ')}`);
    }
    /* internal is what any Core caller may read. Above it the call must
       carry an owner actor, and that is only the fast refusal: the actor
       id travels to the database, which reads public.org_members and
       refuses (42501) anyone who is not an owner of the organization,
       whatever this process was told. */
    let actorId = null;
    if (WORKSTREAM_SENSITIVITIES.indexOf(maxSensitivity) > WORKSTREAM_SENSITIVITIES.indexOf('internal')) {
      const actor = options?.actor;
      if (actor?.kind !== 'owner' || !UUID.test(String(actor?.user_id || ''))) {
        throw new WorkstreamContractError('reading above internal sensitivity needs the authenticated owner', { code: 'WORKSTREAM_OWNER_REQUIRED', status: 403 });
      }
      actorId = actor.user_id.toLowerCase();
    }
    let workstreamId = null;
    if (args.workstream_id !== undefined && args.workstream_id !== null) {
      if (typeof args.workstream_id !== 'string' || !WORKSTREAM_ID.test(args.workstream_id)) {
        throw new WorkstreamContractError('workstream_id must match ^[a-z0-9][a-z0-9-]{1,62}$');
      }
      workstreamId = args.workstream_id;
    }
    const limit = Math.min(50, Math.max(1, Number(args.limit || 20)));
    const read = await readWorkstreams({ orgId, limit, maxSensitivity, workstreamId, actorId });
    const generatedAt = new Date().toISOString();
    const packet = buildResumePacket(read.workstreams, { maxChars: args.max_chars, generatedAt, total: read.total });
    return {
      org_id: orgId,
      schema: 'mccluster-workstream-list/1',
      generated_at: generatedAt,
      max_sensitivity: maxSensitivity,
      total: read.total,
      returned: read.workstreams.length,
      truncated: read.total > read.workstreams.length,
      workstreams: read.workstreams,
      /* A generated view of the rows above, for a context window. The
         rows are the record; this is not. */
      packet: packet.text,
      packet_truncated: packet.truncated,
      canonical_store: 'ai_context.workstreams+ai_context.workstream_events'
    };
  }

  throw Object.assign(new Error(`Unknown workstream tool: ${name}`), { status: 404 });
}
