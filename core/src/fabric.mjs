import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rest, workerId } from './supabase.mjs';

const NODE = 'ovh';
const SPOOL_DIR = process.env.MCCLUSTER_FABRIC_SPOOL_DIR || '/var/lib/mccluster-core/fabric-spool';
const EDGE_URL = String(process.env.MCCLUSTER_FABRIC_URL || 'https://api.mccluster.org').replace(/\/$/, '');
const EDGE_TOKEN = String(process.env.MCCLUSTER_FABRIC_TOKEN || '');
const MAX_EVENT_BYTES = Math.max(16 * 1024, Number(process.env.MCCLUSTER_FABRIC_MAX_EVENT_BYTES || 128 * 1024));

async function sb(resource, init = {}) {
  const result = await rest(resource, init);
  return result?.body ?? null;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function canonicalTimestamp(value) {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) throw new Error('fabric event occurred_at must be a valid instant');
  return parsed.toISOString();
}

function assertPayloadPolicy(envelope) {
  if (envelope?.kind === 'conversation.ingested' && Object.prototype.hasOwnProperty.call(envelope.payload || {}, 'messages')) {
    throw new Error('raw conversation messages are forbidden in fabric events');
  }
}

function normalizedEnvelope(envelope) {
  if (!envelope?.event_id || !envelope?.org_id || !envelope?.trace_id || !envelope?.kind || !envelope?.origin_node) {
    throw new Error('invalid fabric envelope');
  }
  if (!['supabase', 'cloudflare', 'ovh'].includes(envelope.origin_node)) throw new Error('invalid fabric origin_node');
  const normalized = {
    schema_version: envelope.schema_version ?? 1,
    event_id: envelope.event_id,
    org_id: envelope.org_id,
    trace_id: envelope.trace_id,
    kind: envelope.kind,
    origin_node: envelope.origin_node,
    occurred_at: canonicalTimestamp(envelope.occurred_at),
    payload: envelope.payload ?? {},
  };
  assertPayloadPolicy(normalized);
  return envelope.content_hash ? { ...normalized, content_hash: envelope.content_hash } : normalized;
}

export function hashEnvelope(envelope) {
  const normalized = normalizedEnvelope(envelope);
  const canonical = {
    schema_version: normalized.schema_version,
    event_id: normalized.event_id,
    org_id: normalized.org_id,
    trace_id: normalized.trace_id,
    kind: normalized.kind,
    origin_node: normalized.origin_node,
    occurred_at: normalized.occurred_at,
    payload: normalized.payload,
  };
  return crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function createEnvelope({ org_id, trace_id, kind, payload = {}, event_id, occurred_at } = {}) {
  if (!org_id || !kind) throw new Error('fabric event requires org_id and kind');
  const envelope = {
    schema_version: 1,
    event_id: event_id || crypto.randomUUID(),
    org_id,
    trace_id: trace_id || crypto.randomUUID(),
    kind,
    origin_node: NODE,
    occurred_at: canonicalTimestamp(occurred_at || new Date().toISOString()),
    payload,
  };
  assertPayloadPolicy(envelope);
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_EVENT_BYTES) throw new Error('fabric event too large');
  return { ...envelope, content_hash: hashEnvelope(envelope) };
}

async function existingEvent(eventId, orgId = null) {
  const params = new URLSearchParams({ event_id: `eq.${eventId}`, select: '*', limit: '1' });
  if (orgId) params.set('org_id', `eq.${orgId}`);
  const rows = await sb(`fabric_events?${params.toString()}`);
  return rows?.[0] || null;
}

export async function persistEvent(envelope) {
  const normalized = normalizedEnvelope(envelope);
  const expected = hashEnvelope(normalized);
  if (envelope.content_hash !== expected) throw new Error(`fabric content_hash mismatch for ${normalized.event_id}`);
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_EVENT_BYTES) throw new Error('fabric event too large');

  const inserted = await sb('fabric_events?on_conflict=event_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ ...normalized, content_hash: envelope.content_hash }),
  });
  if (inserted?.length) return { event: inserted[0], duplicate: false };

  const existing = await existingEvent(normalized.event_id);
  if (!existing) throw new Error(`fabric event ${normalized.event_id} was not persisted`);
  if (existing.content_hash !== envelope.content_hash || hashEnvelope(existing) !== existing.content_hash) {
    throw new Error(`fabric event_id collision for ${normalized.event_id}`);
  }
  return { event: existing, duplicate: true };
}

export async function markAck(eventId, node = NODE) {
  const now = new Date().toISOString();
  await sb('fabric_receipts?on_conflict=event_id,node', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ event_id: eventId, node, state: 'acked', first_seen_at: now, acked_at: now, attempts: 1, updated_at: now }),
  });
  await sb(`fabric_receipts?event_id=eq.${encodeURIComponent(eventId)}&node=eq.${encodeURIComponent(node)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ state: 'acked', acked_at: now, attempts: 1, last_error: null, updated_at: now }),
  });
}

export async function ackOutbox(eventId, targetNode = NODE) {
  const now = new Date().toISOString();
  await sb(`fabric_outbox?event_id=eq.${encodeURIComponent(eventId)}&target_node=eq.${encodeURIComponent(targetNode)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'acked', acked_at: now, locked_at: null, locked_by: null, last_error: null, updated_at: now }),
  });
}

export async function relayToEdge(envelope) {
  if (!EDGE_TOKEN) return false;
  const response = await fetch(`${EDGE_URL}/v1/fabric/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mccluster-fabric-token': EDGE_TOKEN,
      'x-mccluster-fabric-node': NODE,
    },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw new Error(`fabric edge relay failed ${response.status}: ${await response.text()}`);
  return true;
}

export async function spoolEvent(envelope) {
  const normalized = normalizedEnvelope(envelope);
  if (hashEnvelope(normalized) !== envelope.content_hash) throw new Error(`fabric content_hash mismatch for ${normalized.event_id}`);
  await mkdir(SPOOL_DIR, { recursive: true, mode: 0o700 });
  const finalPath = path.join(SPOOL_DIR, `${normalized.event_id}.json`);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify({ ...normalized, content_hash: envelope.content_hash }), { mode: 0o600 });
  await rename(tmpPath, finalPath);
  return finalPath;
}

export async function publishFabricEvent(input) {
  const envelope = input?.content_hash ? { ...normalizedEnvelope(input), content_hash: input.content_hash } : createEnvelope(input);
  let persistError;
  try {
    const persisted = await persistEvent(envelope);
    await markAck(envelope.event_id);
    try { await relayToEdge(envelope); } catch {}
    return { envelope: persisted.event, persisted, spooled: false };
  } catch (error) {
    persistError = error;
  }

  let relayedToEdge = false;
  try { relayedToEdge = await relayToEdge(envelope); } catch {}
  await spoolEvent(envelope);
  return {
    envelope,
    persisted: null,
    spooled: true,
    relayed_to_edge: relayedToEdge,
    warning: persistError instanceof Error ? persistError.message : String(persistError),
  };
}

export async function drainSpool({ limit = 50 } = {}) {
  await mkdir(SPOOL_DIR, { recursive: true, mode: 0o700 });
  const names = (await readdir(SPOOL_DIR)).filter((name) => name.endsWith('.json')).sort().slice(0, limit);
  let delivered = 0;
  for (const name of names) {
    const filePath = path.join(SPOOL_DIR, name);
    try {
      const envelope = JSON.parse(await readFile(filePath, 'utf8'));
      await persistEvent(envelope);
      await markAck(envelope.event_id);
      try { await relayToEdge(envelope); } catch {}
      await unlink(filePath);
      delivered += 1;
    } catch {}
  }
  return delivered;
}

async function markDead(row, error) {
  const now = new Date().toISOString();
  await sb(`fabric_outbox?event_id=eq.${encodeURIComponent(row.event_id)}&target_node=eq.${NODE}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'dead',
      attempts: Number(row.attempts || 0) + 1,
      locked_at: null,
      locked_by: null,
      last_error: String(error).slice(0, 2000),
      updated_at: now,
    }),
  });
}

export async function drainOutbox({ limit = 50 } = {}) {
  const now = new Date().toISOString();
  const rows = await sb(`fabric_outbox?target_node=eq.${NODE}&status=in.(pending,leased)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=${Math.max(1, Math.min(500, Number(limit) || 50))}&select=*`);
  let acked = 0;
  for (const row of rows || []) {
    const event = await existingEvent(row.event_id);
    if (!event) {
      await markDead(row, 'canonical event missing');
      continue;
    }
    if (hashEnvelope(event) !== event.content_hash) {
      await markDead(row, 'content_hash mismatch');
      continue;
    }
    await markAck(event.event_id);
    await ackOutbox(event.event_id);
    acked += 1;
  }
  return acked;
}

export async function reconcileFabric({ limit = 250 } = {}) {
  const events = await sb(`fabric_events?select=event_id,origin_node&order=created_at.desc&limit=${Math.max(1, Math.min(2000, Number(limit) || 250))}`);
  for (const event of events || []) {
    for (const target of ['cloudflare', 'ovh']) {
      if (event.origin_node === target) continue;
      await sb('fabric_outbox?on_conflict=event_id,target_node', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ event_id: event.event_id, target_node: target, status: 'pending' }),
      });
    }
  }
  return events?.length || 0;
}

export const fabricNodeId = workerId;
