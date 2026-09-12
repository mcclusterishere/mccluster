const NODE = 'cloudflare';

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
    occurred_at: envelope.occurred_at,
    payload: envelope.payload ?? {}
  }));
}

async function persistEvent(env, envelope) {
  const existing = await sb(env, `/rest/v1/fabric_events?event_id=eq.${encodeURIComponent(envelope.event_id)}&select=event_id,content_hash&limit=1`);
  if (existing?.length) {
    if (existing[0].content_hash !== envelope.content_hash) throw Object.assign(new Error('fabric event_id collision'), { status: 409 });
    return { duplicate: true };
  }
  await sb(env, '/rest/v1/fabric_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(envelope)
  });
  return { duplicate: false };
}

export async function publishCloudflareEvent(env, { org_id, trace_id, kind, payload = {}, event_id, occurred_at } = {}) {
  if (!org_id || !kind) throw new Error('fabric event requires org_id and kind');
  const envelope = {
    schema_version: 1,
    event_id: event_id || crypto.randomUUID(),
    org_id,
    trace_id: trace_id || crypto.randomUUID(),
    kind,
    origin_node: NODE,
    occurred_at: occurred_at || new Date().toISOString(),
    payload
  };
  envelope.content_hash = await hashEnvelope(envelope);
  const persisted = await persistEvent(env, envelope);
  await markAck(env, envelope.event_id);
  return { envelope, ...persisted };
}

function internalAuth(request, env) {
  const expected = env.MCCLUSTER_FABRIC_TOKEN || '';
  const received = request.headers.get('x-mccluster-fabric-token') || '';
  return Boolean(expected && received && expected === received);
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
  if (!internalAuth(request, env)) return new Response(JSON.stringify({ error: 'fabric authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const sourceNode = request.headers.get('x-mccluster-fabric-node') || '';
  if (!['ovh', 'supabase', 'cloudflare'].includes(sourceNode)) return new Response(JSON.stringify({ error: 'invalid fabric source node' }), { status: 400, headers: { 'content-type': 'application/json' } });
  const envelope = await request.json();
  if (!envelope?.event_id || !envelope?.org_id || !envelope?.trace_id || !envelope?.kind || !envelope?.content_hash) {
    return new Response(JSON.stringify({ error: 'invalid fabric envelope' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const hash = await hashEnvelope(envelope);
  if (hash !== envelope.content_hash) return new Response(JSON.stringify({ error: 'fabric content_hash mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
  await persistEvent(env, envelope);
  await markAck(env, envelope.event_id);
  return new Response(JSON.stringify({ ok: true, event_id: envelope.event_id, trace_id: envelope.trace_id, node: NODE }), { status: 202, headers: { 'content-type': 'application/json' } });
}

export async function drainFabricOutbox(env, { limit = 100 } = {}) {
  const now = new Date().toISOString();
  const rows = await sb(env, `/rest/v1/fabric_outbox?target_node=eq.${NODE}&status=in.(pending,leased)&next_attempt_at=lte.${encodeURIComponent(now)}&order=created_at.asc&limit=${limit}&select=event_id`);
  let acked = 0;
  for (const row of rows || []) {
    const events = await sb(env, `/rest/v1/fabric_events?event_id=eq.${encodeURIComponent(row.event_id)}&select=*&limit=1`);
    const event = events?.[0];
    if (!event) continue;
    if ((await hashEnvelope(event)) !== event.content_hash) continue;
    await markAck(env, event.event_id);
    acked += 1;
  }
  return { acked };
}

export async function fabricStatus(env, eventId) {
  const [events, receipts, outbox] = await Promise.all([
    sb(env, `/rest/v1/fabric_events?event_id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`),
    sb(env, `/rest/v1/fabric_receipts?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=node.asc`),
    sb(env, `/rest/v1/fabric_outbox?event_id=eq.${encodeURIComponent(eventId)}&select=*&order=target_node.asc`)
  ]);
  return { event: events?.[0] || null, receipts: receipts || [], outbox: outbox || [] };
}
