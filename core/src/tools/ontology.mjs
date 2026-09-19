import { createHash } from 'node:crypto';
import { rest } from '../supabase.mjs';

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function requireOrg(value) {
  const orgId = text(value, 100);
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });
  return orgId;
}

function requireUuid(value, field) {
  const normalized = text(value, 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw Object.assign(new Error(`${field} must be a UUID`), { status: 400 });
  }
  return normalized;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function actionHash({ orgId, actionKey, targetObjectId, parameters }) {
  return createHash('sha256')
    .update(stableJson({ org_id: orgId, action_key: actionKey, target_object_id: targetObjectId, parameters }))
    .digest('hex');
}

async function rpc(name, args) {
  const { body } = await rest(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  return body;
}

export const ONTOLOGY_TOOLS = Object.freeze([
  {
    name: 'core.ontology.schema',
    title: 'Read operational ontology schema',
    description: 'Read McCluster object types, link types, and governed action types for one organization.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: { org_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ontology.query',
    title: 'Query operational objects',
    description: 'Read materialized McCluster operational objects by type or canonical object key.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: {
        org_id: { type: 'string' },
        type_key: { type: 'string' },
        object_key: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ontology.neighbors',
    title: 'Traverse operational object links',
    description: 'Read typed incoming/outgoing neighbors for one ontology object.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'object_id'],
      properties: {
        org_id: { type: 'string' },
        object_id: { type: 'string' },
        direction: { type: 'string', enum: ['in', 'out', 'both'] },
        link_key: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ontology.action.apply',
    title: 'Apply governed ontology action',
    description: 'Apply a bounded owner-attributed ontology action. V1 mutations are limited to internal annotations, tags, and compatible typed links.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'action_key', 'target_object_id', 'parameters'],
      properties: {
        org_id: { type: 'string' },
        action_key: { type: 'string' },
        target_object_id: { type: 'string' },
        parameters: { type: 'object' },
        idempotency_key: { type: 'string' },
        approval_id: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
]);

export async function callOntologyTool(name, args = {}, options = {}) {
  const orgId = requireOrg(args.org_id);

  if (name === 'core.ontology.schema') {
    const schema = await rpc('ops_ontology_schema_service', { p_org: orgId });
    return { org_id: orgId, schema };
  }

  if (name === 'core.ontology.query') {
    const typeKey = text(args.type_key, 80) || null;
    const objectKey = text(args.object_key, 500) || null;
    const limit = Math.min(500, Math.max(1, Number(args.limit || 100)));
    const result = await rpc('ops_ontology_query_service', {
      p_org: orgId,
      p_type_key: typeKey,
      p_object_key: objectKey,
      p_limit: limit,
    });
    return { org_id: orgId, type_key: typeKey, object_key: objectKey, ...result };
  }

  if (name === 'core.ontology.neighbors') {
    const objectId = requireUuid(args.object_id, 'object_id');
    const direction = ['in', 'out', 'both'].includes(args.direction) ? args.direction : 'both';
    const linkKey = text(args.link_key, 80) || null;
    const limit = Math.min(500, Math.max(1, Number(args.limit || 100)));
    const result = await rpc('ops_ontology_neighbors_service', {
      p_org: orgId,
      p_object_id: objectId,
      p_direction: direction,
      p_link_key: linkKey,
      p_limit: limit,
    });
    return { org_id: orgId, object_id: objectId, direction, link_key: linkKey, ...result };
  }

  if (name === 'core.ontology.action.apply') {
    const actorUserId = requireUuid(options?.actor?.user_id, 'authenticated actor user_id');
    const actionKey = text(args.action_key, 80);
    if (!actionKey) throw Object.assign(new Error('action_key is required'), { status: 400 });
    const targetObjectId = requireUuid(args.target_object_id, 'target_object_id');
    const parameters = args.parameters && typeof args.parameters === 'object' && !Array.isArray(args.parameters)
      ? args.parameters
      : {};
    const requestHash = actionHash({ orgId, actionKey, targetObjectId, parameters });
    const approvalId = args.approval_id ? requireUuid(args.approval_id, 'approval_id') : null;
    const idempotencyKey = text(args.idempotency_key, 240) || null;

    const result = await rpc('ops_ontology_apply_action_service', {
      p_org: orgId,
      p_action_key: actionKey,
      p_target_object_id: targetObjectId,
      p_actor_user: actorUserId,
      p_actor_kind: options?.actor?.kind || 'owner',
      p_parameters: parameters,
      p_request_hash: requestHash,
      p_idempotency_key: idempotencyKey,
      p_approval_id: approvalId,
    });

    if (result?.ok === false) {
      throw Object.assign(new Error(result.error || 'ontology action failed'), {
        status: 409,
        detail: result,
      });
    }

    return {
      org_id: orgId,
      action_key: actionKey,
      target_object_id: targetObjectId,
      request_hash: requestHash,
      actor: { user_id: actorUserId, kind: options?.actor?.kind || 'owner' },
      ...result,
    };
  }

  throw Object.assign(new Error(`Unknown ontology tool: ${name}`), { status: 404 });
}
