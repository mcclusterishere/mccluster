import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rest, workerId } from './supabase.mjs';

const NODE = 'ovh';
const SPOOL_DIR = process.env.MCCLUSTER_FABRIC_SPOOL_DIR || '/var/lib/mccluster-core/fabric-spool';
const EDGE_URL = (process.env.MCCLUSTER_FABRIC_URL || 'https://api.mccluster.org').replace(/\/$/, '');
const EDGE_TOKEN = process.env.MCCLUSTER_FABRIC_TOKEN || '';

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function hashEnvelope(envelope) {
  const canonical = {
    schema_version: envelope.schema_version ?? 1,
    event_id: envelope.event_id,
    org_id: envelope.org_id,
    trace_id: envelope.trace_id,
    kind: envelope.kind,
    origin_node: envelope.origin_node,
    occurred_at: envelope.occurred_at,
    payload: envelope.payload ?? {},
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
    occurred_at: occurred_at || new Date().toISOString(),
    payload,
  };
  return { ...envelope, content_hash: hashEnvelope(envelope) };
}

async function existingEvent(eventId) {
  const rows = await rest(`/rest/v1/fabric_events?event_id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

export async function persistEvent(envelope) {
  const expected = hashEnvelope(envelope);
  if (envelope.content_hash !== expected) throw new Error(`fabric content_hash mismatch for ${envelope.event_id}`);
  const existing = await existingEvent(envelope.event_id);
  if (existing) {
    if (existing.content_hash !== envelope.content_hash) throw new Error(`fabric event_id collision for ${envelope.event_id}`);
    return { event: existing, duplicate: true };
  }
  const rows = await rest('/rest/v1/fabric_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(envelope),
  });
  return { event: rows?.[0] || envelope, duplicate: false };
}

export async function markAck(eventId, node = NODE) {
  const now = new Date().toISOString();
  await rest('/rest/v1/fabric_receipts?on_conflict=event_id,node', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ event_id: eventId, node, state: 'acked', first_seen_at: now, acked_at: now, attempts: 1, updated_at: now }),
  });
}

export async function ackOutbox(eventId, targetNode = NODE) {
  const now = new Date().toISOString();
  await rest(`/rest/v1/fabric_outbox?event_id=eq.${encodeURIComponent(eventId)}&target_node=eq.${encodeURIComponent(targetNode)}`, {
    method: 'PATCH',
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
  await mkdir(SPOOL_DIR, { recursive: true, mode: 0o700 });
  const finalPath = path.join(SPOOL_DIR, `${envelope.event_id}.json`);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(envelope), { mode: 0o600 });
  await rename(tmpPath, finalPath);
  return finalPath;
}

export async function publishFabricEvent(input) {
  const envelope = input?.content_hash ? input : createEnvelope(input);
  let supabaseError;
  try {
    const persisted = await persistEvent(envelope);
    await markAck(envelope.event_id);
    try { await relayToEdge(envelope); } catch { /* durable DB outbox remains correctness path */ }
    return { envelope, persisted, spooled: false };
  } catch (error) {
    supabaseError = error;
  }

  try {
    if (await relayToEdge(envelope)) {
      await spoolEvent(envelope);
      return { envelope, persisted: null, spooled: true, relayed_to_edge: true, warning: String(supabaseError) };
    }
  } catch { /* disk spool is final fallback */ }

  await spoolEvent(envelope);
  return { envelope, persisted: null, spooled: true, relayed_to_edge: false, warning: String(supabaseError) };
}

export async function drainSpool({ limit = 50 } = {}) {
  await mkdir(SPOOL_DIR, { recursive: true, mode: 0o700 });
  const names = (await readdir(SPOOL_DIR)).filter((name) => name.endsWith('.json')).slice(0, limit);
  let delivered = 0;
  for (const name of names) {
    const filePath = path.join(SPOOL_DIR, name);
    const envelope = JSON.parse(await readFile(filePath, 'utf8'));
    try {
      await persistEvent(envelope);
      await markAck(envelope.event_id);
      try { await relayToEdge(envelope); } catch { /* outbox will reconcile */ }
      await unlink(filePath);
      delivered += 1;
    } catch { /* keep for retry */ }
  }
  return delivered;
}

export async function drainOutbox({ limit = 50 } = {}) {
  const now = new Date().toISOString();
  const rows = await rest(`/rest/v1/fabric_outbox?target_node=eq.${NODE}&status=in.(pending,leased)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=${limit}&select=*`);
  let acked = 0;
  for (const row of rows || []) {
    const eventRows = await rest(`/rest/v1/fabric_events?event_id=eq.${encodeURIComponent(row.event_id)}&select=*&limit=1`);
    const event = eventRows?.[0];
    if (!event) continue;
    const expected = hashEnvelope(event);
    if (expected !== event.content_hash) {
      await rest(`/rest/v1/fabric_outbox?event_id=eq.${encodeURIComponent(row.event_id)}&target_node=eq.${NODE}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dead', attempts: (row.attempts || 0) + 1, last_error: 'content_hash mismatch', updated_at: now }),
      });
      continue;
    }
    await markAck(event.event_id);
    await ackOutbox(event.event_id);
    acked += 1;
  }
  return acked;
}

export async function reconcileFabric({ limit = 250 } = {}) {
  const events = await rest(`/rest/v1/fabric_events?select=event_id,origin_node&order=created_at.desc&limit=${limit}`);
  for (const event of events || []) {
    for (const target of ['cloudflare', 'ovh']) {
      if (event.origin_node === target) continue;
      await rest('/rest/v1/fabric_outbox?on_conflict=event_id,target_node', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ event_id: event.event_id, target_node: target, status: 'pending' }),
      });
    }
  }
  return events?.length || 0;
}

export const fabricNodeId = workerId;
