import { fail, reply } from '../lib/http.js';

const MAX_BODY = 64 * 1024;
const OWNER_COMMAND = /^(STATUS|TAKEOVER|RELEASE)(?:\s+([0-9a-f-]{36}))?\s*$/i;
const STOP_COMMAND = /^\s*(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\s*$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_STALE_MS = 2 * 60_000;
const MAX_RELAY_ATTEMPTS = 3;

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deterministicUuid(seed) {
  const hex = (await sha256(seed)).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16] || '0', 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^0-9+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return digits;
  if (/^[2-9][0-9]{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9][0-9]{9}$/.test(digits)) return `+${digits}`;
  return '';
}

async function rest(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.error || `Supabase ${response.status}`), {
      status: 502,
      detail: body,
    });
  }
  return body;
}

async function houseOrgId(env) {
  const rows = await rest(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
  return rows?.[0]?.id || null;
}

async function requireOwner(env, user, orgId) {
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    profile_id: `eq.${user.id}`,
    role: 'eq.owner',
    select: 'org_id',
    limit: '1',
  });
  const rows = await rest(env, `org_members?${params.toString()}`);
  if (!rows?.length) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
}

async function authenticateRelay(request, env) {
  const deviceId = String(request.headers.get('x-mccluster-relay-id') || '').trim();
  const token = String(request.headers.get('x-mccluster-relay-token') || '');
  if (!UUID_RE.test(deviceId) || token.length < 24) {
    throw Object.assign(new Error('relay authentication required'), { status: 401 });
  }
  const tokenHash = await sha256(token);
  const params = new URLSearchParams({
    id: `eq.${deviceId}`,
    token_hash: `eq.${tokenHash}`,
    enabled: 'eq.true',
    select: 'id,org_id,label,phone_number,enabled,capabilities',
    limit: '1',
  });
  const rows = await rest(env, `comms_relay_devices?${params.toString()}`);
  const device = rows?.[0];
  if (!device) throw Object.assign(new Error('invalid relay credentials'), { status: 401 });
  await rest(env, `comms_relay_devices?id=eq.${device.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  return device;
}

async function audit(env, { orgId, threadId = null, actorType, actorId = null, action, detail = {} }) {
  await rest(env, 'comms_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ org_id: orgId, thread_id: threadId, actor_type: actorType, actor_id: actorId, action, detail }),
  });
}

async function upsertContact(env, { orgId, address }) {
  const rows = await rest(env, 'comms_contacts?on_conflict=org_id,channel,address', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ org_id: orgId, channel: 'sms', address, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  return rows?.[0];
}

async function upsertThread(env, { orgId, contactId, device }) {
  const relayAddress = normalizeAddress(device.phone_number);
  if (!relayAddress) throw Object.assign(new Error('relay device has no valid phone identity'), { status: 409 });
  const rows = await rest(env, 'comms_threads?on_conflict=org_id,contact_id,channel,relay_address', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      contact_id: contactId,
      relay_device_id: device.id,
      channel: 'sms',
      relay_address: relayAddress,
      updated_at: new Date().toISOString(),
    }),
  });
  return rows?.[0];
}

async function insertInboundMessage(env, { orgId, threadId, body, externalId, idempotencyKey, occurredAt, device }) {
  const rows = await rest(env, 'comms_messages?on_conflict=org_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      thread_id: threadId,
      direction: 'inbound',
      sender_type: 'contact',
      body,
      status: 'received',
      external_id: externalId || null,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt,
      metadata: { relay_device_id: device.id },
    }),
  });
  return rows?.[0] || null;
}

async function queueOutbox(env, { orgId, thread, destination, body, senderType, idempotencyKey, replyToMessageId = null }) {
  const messageId = await deterministicUuid(`comms-message:${idempotencyKey}`);
  const messageRows = await rest(env, 'comms_messages?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      id: messageId,
      org_id: orgId,
      thread_id: thread.id,
      direction: 'outbound',
      sender_type: senderType,
      body,
      status: 'queued',
      idempotency_key: idempotencyKey,
      reply_to_message_id: replyToMessageId,
    }),
  });
  const message = messageRows?.[0] || (await rest(env, `comms_messages?id=eq.${messageId}&select=*&limit=1`))?.[0];
  const outboxRows = await rest(env, 'comms_outbox?on_conflict=org_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      thread_id: thread.id,
      message_id: message.id,
      relay_device_id: thread.relay_device_id,
      destination,
      body,
      idempotency_key: idempotencyKey,
    }),
  });
  return { message, outbox: outboxRows?.[0] || null };
}

async function enqueueAssistantTurn(env, { orgId, threadId, messageId, relayDeviceId }) {
  const jobId = await deterministicUuid(`sms-assistant-turn:${messageId}`);
  const rows = await rest(env, 'ops_agent_jobs?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      id: jobId,
      org_id: orgId,
      job_type: 'sms_assistant_turn',
      target_type: 'comms_thread',
      target_id: threadId,
      status: 'queued',
      priority: 65,
      input: {
        thread_id: threadId,
        inbound_message_id: messageId,
        relay_device_id: relayDeviceId,
        channel: 'sms',
      },
      max_attempts: 3,
    }),
  });
  return rows?.[0] || null;
}

async function threadById(env, orgId, threadId) {
  const rows = await rest(env, `comms_threads?id=eq.${threadId}&org_id=eq.${orgId}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function handleOwnerCommand(env, { orgId, sourceThread, sourceAddress, body }) {
  const match = body.match(OWNER_COMMAND);
  if (!match) return null;
  const command = match[1].toUpperCase();
  const targetId = match[2] || null;

  if (command === 'STATUS') {
    const [queued, active] = await Promise.all([
      rest(env, `comms_outbox?org_id=eq.${orgId}&status=in.(queued,claimed)&select=id`),
      rest(env, `comms_threads?org_id=eq.${orgId}&assistant_enabled=eq.true&mode=eq.assistant&select=id`),
    ]);
    return queueOutbox(env, {
      orgId,
      thread: sourceThread,
      destination: sourceAddress,
      senderType: 'system',
      body: `McCluster Communications: ${active.length} assistant thread(s), ${queued.length} outbound item(s) pending.`,
      idempotencyKey: `owner-status:${sourceThread.id}:${Date.now()}`,
    });
  }

  if (!targetId) throw Object.assign(new Error(`${command} requires a thread UUID`), { status: 400 });
  const target = await threadById(env, orgId, targetId);
  if (!target) throw Object.assign(new Error('target thread not found'), { status: 404 });
  const now = new Date().toISOString();
  const patch = command === 'TAKEOVER'
    ? { mode: 'human', assistant_enabled: false, takeover_at: now, updated_at: now }
    : { mode: 'assistant', assistant_enabled: true, released_at: now, updated_at: now };
  await rest(env, `comms_threads?id=eq.${targetId}&org_id=eq.${orgId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  await audit(env, { orgId, threadId: targetId, actorType: 'owner', action: command.toLowerCase(), detail: { via: 'sms_command' } });
  return queueOutbox(env, {
    orgId,
    thread: sourceThread,
    destination: sourceAddress,
    senderType: 'system',
    body: `${command} confirmed for thread ${targetId}.`,
    idempotencyKey: `owner-command:${command}:${targetId}:${Date.now()}`,
  });
}

async function handleInbound(request, env) {
  const device = await authenticateRelay(request, env);
  const body = await readJson(request);
  const relayAddress = normalizeAddress(device.phone_number);
  const from = normalizeAddress(body.from);
  const to = normalizeAddress(body.to || relayAddress);
  const text = String(body.body || '').trim().slice(0, 12000);
  if (!relayAddress) throw Object.assign(new Error('relay device has no valid phone identity'), { status: 409 });
  if (!from || !to || !text) throw Object.assign(new Error('valid from, to and body are required'), { status: 400 });
  if (to !== relayAddress) throw Object.assign(new Error('relay destination does not match enrolled SIM number'), { status: 400 });
  if (from === relayAddress || from === to) {
    return { accepted: false, suppressed: true, reason: 'relay_self_loop' };
  }
  const occurredAt = body.occurred_at && !Number.isNaN(new Date(body.occurred_at).getTime())
    ? new Date(body.occurred_at).toISOString()
    : new Date().toISOString();
  const externalId = String(body.external_id || '').slice(0, 500) || null;
  const idempotencyKey = String(body.idempotency_key || '').slice(0, 500)
    || await sha256(`${device.id}\n${externalId || occurredAt}\n${from}\n${text}`);

  const contact = await upsertContact(env, { orgId: device.org_id, address: from });
  const thread = await upsertThread(env, { orgId: device.org_id, contactId: contact.id, device });
  const message = await insertInboundMessage(env, {
    orgId: device.org_id, threadId: thread.id, body: text, externalId, idempotencyKey, occurredAt, device,
  });
  if (!message) return { accepted: true, duplicate: true, thread_id: thread.id };

  await rest(env, `comms_threads?id=eq.${thread.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_inbound_at: occurredAt, updated_at: new Date().toISOString() }),
  });
  await audit(env, { orgId: device.org_id, threadId: thread.id, actorType: 'relay', actorId: device.id, action: 'sms_inbound', detail: { message_id: message.id } });

  if (STOP_COMMAND.test(text)) {
    await rest(env, `comms_contacts?id=eq.${contact.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ blocked: true, assistant_allowed: false, updated_at: new Date().toISOString() }),
    });
    await rest(env, `comms_threads?id=eq.${thread.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mode: 'blocked', assistant_enabled: false, updated_at: new Date().toISOString() }),
    });
    await audit(env, { orgId: device.org_id, threadId: thread.id, actorType: 'system', action: 'contact_stop', detail: { message_id: message.id } });
    return { accepted: true, blocked: true, thread_id: thread.id, message_id: message.id };
  }

  const ownerPhone = normalizeAddress(env.MCCLUSTER_OWNER_PHONE);
  if (ownerPhone && from === ownerPhone) {
    const commandResult = await handleOwnerCommand(env, { orgId: device.org_id, sourceThread: thread, sourceAddress: from, body: text });
    if (commandResult) return { accepted: true, owner_command: true, thread_id: thread.id, message_id: message.id };
  }

  if (contact.blocked || !contact.assistant_allowed || thread.mode !== 'assistant' || !thread.assistant_enabled) {
    return { accepted: true, assistant_queued: false, reason: 'assistant_disabled', thread_id: thread.id, message_id: message.id };
  }

  const job = await enqueueAssistantTurn(env, { orgId: device.org_id, threadId: thread.id, messageId: message.id, relayDeviceId: device.id });
  return { accepted: true, assistant_queued: true, thread_id: thread.id, message_id: message.id, job_id: job?.id || null };
}

async function releaseStaleClaims(env, device) {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  await rest(env, `comms_outbox?org_id=eq.${device.org_id}&relay_device_id=eq.${device.id}&status=eq.claimed&claimed_at=lt.${encodeURIComponent(staleBefore)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'queued', claimed_at: null, claimed_by: null, updated_at: new Date().toISOString() }),
  });
}

async function handleClaim(request, env) {
  const device = await authenticateRelay(request, env);
  await releaseStaleClaims(env, device);
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    org_id: `eq.${device.org_id}`,
    relay_device_id: `eq.${device.id}`,
    status: 'eq.queued',
    available_at: `lte.${now}`,
    select: '*',
    order: 'created_at.asc',
    limit: '10',
  });
  const rows = await rest(env, `comms_outbox?${params.toString()}`);
  for (const candidate of rows || []) {
    const claimed = await rest(env, `comms_outbox?id=eq.${candidate.id}&status=eq.queued`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'claimed',
        attempts: Number(candidate.attempts || 0) + 1,
        claimed_at: now,
        claimed_by: device.id,
        updated_at: now,
      }),
    });
    if (claimed?.length) {
      await rest(env, `comms_messages?id=eq.${candidate.message_id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'claimed', updated_at: now }),
      });
      return { item: claimed[0] };
    }
  }
  return { item: null };
}

async function handleDelivery(request, env) {
  const device = await authenticateRelay(request, env);
  const body = await readJson(request);
  const outboxId = String(body.outbox_id || '');
  const status = String(body.status || '').toLowerCase();
  if (!UUID_RE.test(outboxId) || !['sent', 'delivered', 'failed'].includes(status)) {
    throw Object.assign(new Error('valid outbox_id and status are required'), { status: 400 });
  }
  const rows = await rest(env, `comms_outbox?id=eq.${outboxId}&org_id=eq.${device.org_id}&relay_device_id=eq.${device.id}&select=*&limit=1`);
  const item = rows?.[0];
  if (!item) throw Object.assign(new Error('outbox item not found'), { status: 404 });
  const now = new Date();
  const nowIso = now.toISOString();
  let finalStatus = status;
  let retryQueued = false;
  let outboxPatch;
  if (status === 'failed' && Number(item.attempts || 0) < MAX_RELAY_ATTEMPTS) {
    retryQueued = true;
    finalStatus = 'queued';
    const delaySeconds = Math.min(120, 10 * 2 ** Math.max(0, Number(item.attempts || 1) - 1));
    outboxPatch = {
      status: 'queued',
      available_at: new Date(now.getTime() + delaySeconds * 1000).toISOString(),
      claimed_at: null,
      claimed_by: null,
      last_error: String(body.error || 'relay send failed').slice(0, 2000),
      updated_at: nowIso,
    };
  } else if (status === 'failed') {
    outboxPatch = { status: 'failed', last_error: String(body.error || 'relay send failed').slice(0, 2000), updated_at: nowIso };
  } else {
    outboxPatch = { status, last_error: null, updated_at: nowIso };
  }
  await rest(env, `comms_outbox?id=eq.${item.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(outboxPatch) });
  await rest(env, `comms_messages?id=eq.${item.message_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: finalStatus, updated_at: nowIso }) });
  await rest(env, 'comms_delivery_events', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      org_id: device.org_id,
      outbox_id: item.id,
      message_id: item.message_id,
      relay_device_id: device.id,
      event: `relay_${status}`,
      status,
      provider_message_id: String(body.provider_message_id || '').slice(0, 500) || null,
      metadata: { error: body.error ? String(body.error).slice(0, 2000) : null, retry_queued: retryQueued },
    }),
  });
  if (status === 'sent' || status === 'delivered') {
    await rest(env, `comms_threads?id=eq.${item.thread_id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_outbound_at: nowIso, updated_at: nowIso }),
    });
  }
  await audit(env, { orgId: device.org_id, threadId: item.thread_id, actorType: 'relay', actorId: device.id, action: `delivery_${status}`, detail: { outbox_id: item.id, retry_queued: retryQueued } });
  return { accepted: true, outbox_id: item.id, status: finalStatus, retry_queued: retryQueued };
}

async function ownerThreads(env, orgId, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
  return rest(env, `comms_threads?org_id=eq.${orgId}&select=*,comms_contacts(address,display_name,blocked)&order=updated_at.desc&limit=${limit}`);
}

async function ownerThreadAction(request, env, orgId, threadId, action) {
  const thread = await threadById(env, orgId, threadId);
  if (!thread) throw Object.assign(new Error('thread not found'), { status: 404 });
  const now = new Date().toISOString();
  if (action === 'takeover' || action === 'release') {
    const patch = action === 'takeover'
      ? { mode: 'human', assistant_enabled: false, takeover_at: now, updated_at: now }
      : { mode: 'assistant', assistant_enabled: true, released_at: now, updated_at: now };
    await rest(env, `comms_threads?id=eq.${threadId}&org_id=eq.${orgId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    await audit(env, { orgId, threadId, actorType: 'owner', action, detail: { via: 'owner_api' } });
    return { ok: true, action, thread_id: threadId };
  }
  if (action === 'send') {
    const payload = await readJson(request);
    const body = String(payload.body || '').trim().slice(0, 12000);
    if (!body) throw Object.assign(new Error('body required'), { status: 400 });
    const contacts = await rest(env, `comms_contacts?id=eq.${thread.contact_id}&select=address&limit=1`);
    const destination = contacts?.[0]?.address;
    if (!destination) throw Object.assign(new Error('thread contact address missing'), { status: 409 });
    return queueOutbox(env, {
      orgId,
      thread,
      destination,
      body,
      senderType: 'owner',
      idempotencyKey: String(payload.idempotency_key || '').slice(0, 500) || `owner:${threadId}:${await sha256(body)}:${Date.now()}`,
    });
  }
  throw Object.assign(new Error('unsupported owner thread action'), { status: 404 });
}

export async function handleCommsRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/comms' && !path.startsWith('/v1/comms/')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'McCluster is not configured', 503);

  try {
    if (path === '/v1/comms/relay/inbound' && request.method === 'POST') {
      return reply(request, env, await handleInbound(request, env), 202);
    }
    if (path === '/v1/comms/relay/outbox/claim' && request.method === 'POST') {
      return reply(request, env, await handleClaim(request, env));
    }
    if (path === '/v1/comms/relay/delivery' && request.method === 'POST') {
      return reply(request, env, await handleDelivery(request, env), 202);
    }

    const orgId = url.searchParams.get('org_id') || (await houseOrgId(env));
    if (!orgId) throw Object.assign(new Error('McCluster house organization is not configured'), { status: 503 });
    await requireOwner(env, user, orgId);

    if (path === '/v1/comms' && request.method === 'GET') {
      return reply(request, env, {
        ok: true,
        transport: 'android-sim-relay',
        beta: 1,
        routes: {
          threads: '/v1/comms/threads',
          relay_inbound: '/v1/comms/relay/inbound',
          relay_claim: '/v1/comms/relay/outbox/claim',
          relay_delivery: '/v1/comms/relay/delivery',
        },
      });
    }
    if (path === '/v1/comms/threads' && request.method === 'GET') {
      return reply(request, env, { threads: await ownerThreads(env, orgId, url) });
    }
    const match = path.match(/^\/v1\/comms\/threads\/([0-9a-f-]{36})\/(takeover|release|send)$/i);
    if (match && request.method === 'POST') {
      return reply(request, env, await ownerThreadAction(request, env, orgId, match[1], match[2].toLowerCase()), 202);
    }
    return fail(request, env, 'Not found', 404);
  } catch (error) {
    return fail(request, env, error.message || 'Communications request failed', error.status || 500, error.detail);
  }
}
