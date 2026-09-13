const NODE = 'cloudflare';
const MAX_EVENT_BYTES = 128 * 1024;

function headers(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase backend configuration missing');
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function sb(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...headers(env), ...(init.headers || {}) }
  });
  if (!response.ok) throw new Error(`fabric supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function canonicalTimestamp(value) {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) throw new Error('fabric event occurred_at must be a valid instant');
  return parsed.toISOString();
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashEnvelope(envelope) {
  return sha256(stableStringify({
    schema_version: envelope.schema_version ?? 1,
    event_id: envelope.event_id,
    org_id: envelope.org_id,
    trace_id: envelope.trace_id,
    kind: envelope.kind,
    origin_node: envelope.origin_node,
    occurred_at: canonicalTimestamp(envelope.occurred_at),
    payload: envelope.payload ?? {}
  }));
}

async function existingEvent(env, eventId, orgId = null) {
  const params = new URLSearchParams({
    event_id: `eq.${eventId}`,
    select: '*',
    limit: '1'
  });
  if (orgId) params.set('org_id', `eq.${orgId}`);
  const rows = await sb(env, `/rest/v1/fabric_events?${params.toString()}`);
  return rows?.[0] || null;
}

async function persistEvent(env, envelope) {
  const normalized = { ...envelope, occurred_at: canonicalTimestamp(envelope.occurred_at) };
  const expected = await hashEnvelope(normalized);
  if (normalized.content_hash !== expected) throw Object.assign(new Error('fabric content_hash mismatch'), { status: 409 });

  const inserted = await sb(env, '/rest/v1/fabric_events?on_conflict=event_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(normalized)
  });
  if (inserted?.length) return { event: inserted[0], duplicate: false };

  const existing = await existingEvent(env, normalized.event_id);
  if (!existing) throw new Error(`fabric event ${normalized.event_id} was not persisted`);
  if (existing.content_hash !== normalized.content_hash) throw Object.assign(new Error('fabric event_id collision'), { status: 409 });
  return { event: existing, duplicate: true };
}

export async function publishCloudflareEvent(env, { org_id, trace_id, kind, payload = {}, event_id, occurred_at } = {}) {
  if (!org_id || !kind) throw new Error('fabric event requires org_id and kind');

  // If an immutable event identity already exists, return that canonical row.
  // This makes retries safe even when the caller is replaying an accepted ingest.
  if (event_id) {
    const existing = await existingEvent(env, event_id, org_id);
    if (existing) {
      await markAck(env, existing.event_id);
      return { envelope: existing, event: existing, duplicate: true };
    }
  }

  const envelope = {
    schema_version: 1,
    event_id: event_id || crypto.randomUUID(),
    org_id,
    trace_id: trace_id || crypto.randomUUID(),
    kind,
    origin_node: NODE,
    occurred_at: canonicalTimestamp(occurred_at || new Date().toISOString()),
    payload
  };
  if (JSON.stringify(envelope).length > MAX_EVENT_BYTES) throw Object.assign(new Error('fabric event too large'), { status: 413 });
  envelope.content_hash = await hashEnvelope(envelope);
  const persisted = await persistEvent(env, envelope);
  await markAck(env, envelope.event_id);
  return { envelope: persisted.event, event: persisted.event, duplicate: persisted.duplicate };
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function internalAuth(request, env) {
  const expected = env.MCCLUSTER_FABRIC_TOKEN || '';
  const received = request.headers.get('x-mccluster-fabric-token') || '';
  if (!expected || !received) return false;
  const [a, b] = await Promise.all([digest(expected), digest(received)]);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function markAck(env, eventId) {
  const now = new Date().toISOString();
  await sb(env, '/rest/v1/fabric_receipts?on_conflict=event_id,node', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ event_id: eventId, node: NODE, state: 'acked', first_seen_at: now, acked_at: now, attempts: 1, updated_at: now })
  });
  await sb(env, `/rest/v1/fabric_outbox?event_id=eq.${encodeURIComponent(eventId)}&target_node=eq.${NODE}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'acked', acked_at: now, locked_at: null, locked_by: null, last_error: null, updated_at: now })
  });
}

export async function acceptFabricEvent(request, env) {
  if (!(await internalAuth(request, env))) {
    return new Response(JSON.stringify({ error: 'fabric authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const sourceNode = request.headers.get('x-mccluster-fabric-node') || '';
  if (!['ovh', 'supabase', 'cloudflare'].includes(sourceNode)) {
    return new Response(JSON.stringify({ error: 'invalid fabric source node' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const text = await request.text();
  if (text.length > MAX_EVENT_BYTES) return new Response(JSON.stringify({ error: 'fabric event too large' }), { status: 413, headers: { 'content-type': 'application/json' } });
  let envelope;
  try { envelope = text ? JSON.parse(text) : null; }
  catch { return new Response(JSON.stringify({ error: 'invalid fabric JSON' }), { status: 400, headers: { 'content-type': 'application/json' } }); }

  if (!envelope?.event_id || !envelope?.org_id || !envelope?.trace_id || !envelope?.kind || !envelope?.content_hash) {
    return new Response(JSON.stringify({ error: 'invalid fabric envelope' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (envelope.origin_node !== sourceNode) {
    return new Response(JSON.stringify({ error: 'fabric origin/source mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
  }
  if (envelope.kind === 'conversation.ingested' && Object.prototype.hasOwnProperty.call(envelope.payload || {}, 'messages')) {
    return new Response(JSON.stringify({ error: 'raw conversation messages are forbidden in fabric events' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  envelope.occurred_at = canonicalTimestamp(envelope.occurred_at);
  const hash = await hashEnvelope(envelope);
  if (hash !== envelope.content_hash) return new Response(JSON.stringify({ error: 'fabric content_hash mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
  const persisted = await persistEvent(env, envelope);
  await markAck(env, persisted.event.event_id);
  return new Response(JSON.stringify({ ok: true, event_id: persisted.event.event_id, trace_id: persisted.event.trace_id, node: NODE, duplicate: persisted.duplicate }), { status: 202, headers: { 'content-type': 'application/json' } });
}

export async function drainFabricOutbox(env, { limit = 100 } = {}) {
  const now = new Date().toISOString();
  const rows = await sb(env, `/rest/v1/fabric_outbox?target_node=eq.${NODE}&status=in.(pending,leased)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=${limit}&select=event_id`);
  let acked = 0;
  for (const row of rows || []) {
    const event = await existingEvent(env, row.event_id);
    if (!event) continue;
    if ((await hashEnvelope(event)) !== event.content_hash) continue;
    await markAck(env, event.event_id);
    acked += 1;
  }
  return { acked };
}

export async function fabricStatus(env, { eventId, orgId } = {}) {
  if (!eventId || !orgId) throw Object.assign(new Error('eventId and orgId are required'), { status: 400 });
  const event = await existingEvent(env, eventId, orgId);
  if (!event) return { event: null, receipts: [], outbox: [] };
  const [receipts, outbox] = await Promise.all([
    sb(env, `/rest/v1/fabric_receipts?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=node.asc`),
    sb(env, `/rest/v1/fabric_outbox?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=target_node.asc`)
  ]);
  return { event, receipts: receipts || [], outbox: outbox || [] };
}
