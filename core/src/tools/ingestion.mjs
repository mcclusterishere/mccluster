import { rest } from '../supabase.mjs';

function text(value, max = 4000) {
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

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedLimit(value, fallback = 100) {
  return Math.min(500, Math.max(1, Number(value || fallback)));
}

async function rpc(name, args) {
  const { body } = await rest(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  return body;
}

export const INGESTION_TOOLS = Object.freeze([
  {
    name: 'core.ingest.connectors',
    title: 'Read ingestion connectors',
    description: 'Read the governed connector registry, sync cursors, retention/license policy, and health for one organization.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: { org_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ingest.records',
    title: 'Read ingested source records',
    description: 'Read content-addressed source records with provenance, trace ids, policy snapshots, and ingest state.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: {
        org_id: { type: 'string' },
        connector_key: { type: 'string' },
        status: { type: 'string', enum: ['accepted', 'rejected', 'superseded'] },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ingest.run.begin',
    title: 'Begin governed ingestion run',
    description: 'Begin an initial, incremental, replay, or manual run against a registered connector and snapshot its current cursor.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'connector_key'],
      properties: {
        org_id: { type: 'string' },
        connector_key: { type: 'string' },
        mode: { type: 'string', enum: ['initial', 'incremental', 'replay', 'manual'] },
        metadata: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ingest.record.write',
    title: 'Write governed ingest record',
    description: 'Write one source record into an active ingest run with deterministic content hashing and idempotency.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'run_id', 'external_id', 'record_kind', 'observed_at', 'payload'],
      properties: {
        org_id: { type: 'string' },
        run_id: { type: 'string' },
        external_id: { type: 'string' },
        record_kind: { type: 'string' },
        source_ref: { type: 'object' },
        observed_at: { type: 'string' },
        payload: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.ingest.run.finish',
    title: 'Finish governed ingestion run',
    description: 'Finalize a connector run, persist its next cursor, and record success/partial/failure state for replay and recovery.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'run_id', 'status'],
      properties: {
        org_id: { type: 'string' },
        run_id: { type: 'string' },
        status: { type: 'string', enum: ['succeeded', 'partial', 'failed'] },
        cursor_after: { type: 'object' },
        error: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.entity.aliases',
    title: 'Read entity aliases',
    description: 'Read candidate/resolved/rejected external aliases mapped to governed ontology objects.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: {
        org_id: { type: 'string' },
        namespace: { type: 'string' },
        alias_key: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.entity.resolve',
    title: 'Resolve external entity alias',
    description: 'Owner-attributed resolution of an external identity to an ontology object without deleting earlier provenance or resolution history.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'namespace', 'alias_key', 'object_id'],
      properties: {
        org_id: { type: 'string' },
        namespace: { type: 'string' },
        alias_key: { type: 'string' },
        object_id: { type: 'string' },
        source_record_id: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        method: { type: 'string', enum: ['deterministic', 'rule', 'model', 'manual'] },
        rationale: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.facts.query',
    title: 'Read provenance-backed fact claims',
    description: 'Read source-backed facts for ontology objects, including conflicts instead of silently overwriting competing values.',
    inputSchema: {
      type: 'object',
      required: ['org_id'],
      properties: {
        org_id: { type: 'string' },
        subject_object_id: { type: 'string' },
        predicate: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'core.facts.claim',
    title: 'Record provenance-backed fact claim',
    description: 'Attach one source record as a fact claim on an ontology object; conflicting values remain represented and traceable.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'subject_object_id', 'predicate', 'value', 'source_record_id'],
      properties: {
        org_id: { type: 'string' },
        subject_object_id: { type: 'string' },
        predicate: { type: 'string' },
        value: {},
        source_record_id: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        valid_from: { type: 'string' },
        valid_to: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
]);

export async function callIngestionTool(name, args = {}, options = {}) {
  const orgId = requireOrg(args.org_id);

  if (name === 'core.ingest.connectors') {
    const result = await rpc('ops_ingest_connectors_service', { p_org: orgId });
    return { org_id: orgId, ...result };
  }

  if (name === 'core.ingest.records') {
    const connectorKey = text(args.connector_key, 120) || null;
    const status = ['accepted', 'rejected', 'superseded'].includes(args.status) ? args.status : null;
    const result = await rpc('ops_ingest_records_service', {
      p_org: orgId,
      p_connector_key: connectorKey,
      p_status: status,
      p_limit: boundedLimit(args.limit),
    });
    return { org_id: orgId, connector_key: connectorKey, status, ...result };
  }

  if (name === 'core.ingest.run.begin') {
    const connectorKey = text(args.connector_key, 120);
    if (!connectorKey) throw Object.assign(new Error('connector_key is required'), { status: 400 });
    const mode = ['initial', 'incremental', 'replay', 'manual'].includes(args.mode) ? args.mode : 'incremental';
    const metadata = {
      ...asObject(args.metadata),
      actor: options?.actor?.user_id ? {
        user_id: options.actor.user_id,
        kind: options.actor.kind || 'owner',
      } : undefined,
    };
    const run = await rpc('ops_ingest_begin_run_service', {
      p_org: orgId,
      p_connector_key: connectorKey,
      p_mode: mode,
      p_metadata: metadata,
    });
    return { org_id: orgId, connector_key: connectorKey, run };
  }

  if (name === 'core.ingest.record.write') {
    const runId = requireUuid(args.run_id, 'run_id');
    const externalId = text(args.external_id, 1000);
    const recordKind = text(args.record_kind, 160);
    if (!externalId || !recordKind) throw Object.assign(new Error('external_id and record_kind are required'), { status: 400 });
    const observedAt = text(args.observed_at, 100);
    if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
      throw Object.assign(new Error('observed_at must be an ISO timestamp'), { status: 400 });
    }
    const result = await rpc('ops_ingest_write_record_service', {
      p_org: orgId,
      p_run_id: runId,
      p_external_id: externalId,
      p_record_kind: recordKind,
      p_source_ref: asObject(args.source_ref),
      p_observed_at: observedAt,
      p_payload: asObject(args.payload),
    });
    return { org_id: orgId, run_id: runId, ...result };
  }

  if (name === 'core.ingest.run.finish') {
    const runId = requireUuid(args.run_id, 'run_id');
    const status = ['succeeded', 'partial', 'failed'].includes(args.status) ? args.status : null;
    if (!status) throw Object.assign(new Error('status must be succeeded, partial, or failed'), { status: 400 });
    const run = await rpc('ops_ingest_finish_run_service', {
      p_org: orgId,
      p_run_id: runId,
      p_status: status,
      p_cursor_after: asObject(args.cursor_after),
      p_error: text(args.error, 4000) || null,
    });
    return { org_id: orgId, run };
  }

  if (name === 'core.entity.aliases') {
    const namespace = text(args.namespace, 120) || null;
    const aliasKey = text(args.alias_key, 1000) || null;
    const result = await rpc('ops_entity_aliases_service', {
      p_org: orgId,
      p_namespace: namespace,
      p_alias_key: aliasKey,
      p_limit: boundedLimit(args.limit),
    });
    return { org_id: orgId, namespace, alias_key: aliasKey, ...result };
  }

  if (name === 'core.entity.resolve') {
    const actorUserId = requireUuid(options?.actor?.user_id, 'authenticated actor user_id');
    const namespace = text(args.namespace, 120);
    const aliasKey = text(args.alias_key, 1000);
    if (!namespace || !aliasKey) throw Object.assign(new Error('namespace and alias_key are required'), { status: 400 });
    const objectId = requireUuid(args.object_id, 'object_id');
    const sourceRecordId = args.source_record_id ? requireUuid(args.source_record_id, 'source_record_id') : null;
    const method = ['deterministic', 'rule', 'model', 'manual'].includes(args.method) ? args.method : 'manual';
    const result = await rpc('ops_entity_resolve_service', {
      p_org: orgId,
      p_namespace: namespace,
      p_alias_key: aliasKey,
      p_object_id: objectId,
      p_source_record_id: sourceRecordId,
      p_confidence: args.confidence ?? null,
      p_method: method,
      p_rationale: text(args.rationale, 4000) || null,
      p_actor_user: actorUserId,
      p_actor_kind: options?.actor?.kind || 'owner',
    });
    return {
      org_id: orgId,
      namespace,
      alias_key: aliasKey,
      actor: { user_id: actorUserId, kind: options?.actor?.kind || 'owner' },
      resolution: result,
    };
  }

  if (name === 'core.facts.query') {
    const subjectId = args.subject_object_id ? requireUuid(args.subject_object_id, 'subject_object_id') : null;
    const predicate = text(args.predicate, 160) || null;
    const result = await rpc('ops_fact_claims_service', {
      p_org: orgId,
      p_subject_object_id: subjectId,
      p_predicate: predicate,
      p_limit: boundedLimit(args.limit),
    });
    return { org_id: orgId, subject_object_id: subjectId, predicate, ...result };
  }

  if (name === 'core.facts.claim') {
    const subjectId = requireUuid(args.subject_object_id, 'subject_object_id');
    const sourceRecordId = requireUuid(args.source_record_id, 'source_record_id');
    const predicate = text(args.predicate, 160);
    if (!predicate) throw Object.assign(new Error('predicate is required'), { status: 400 });
    const result = await rpc('ops_fact_claim_service', {
      p_org: orgId,
      p_subject_object_id: subjectId,
      p_predicate: predicate,
      p_value: args.value ?? null,
      p_source_record_id: sourceRecordId,
      p_confidence: args.confidence ?? null,
      p_valid_from: text(args.valid_from, 100) || null,
      p_valid_to: text(args.valid_to, 100) || null,
    });
    return { org_id: orgId, subject_object_id: subjectId, predicate, claim: result };
  }

  throw Object.assign(new Error(`Unknown ingestion tool: ${name}`), { status: 404 });
}
