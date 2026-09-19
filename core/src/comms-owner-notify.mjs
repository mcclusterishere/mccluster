import { createHash } from 'node:crypto';
import { houseOrgId, rest } from './supabase.mjs';

function normalizeAddress(value) {
  const raw = String(value || '').trim().replace(/[^0-9+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^[2-9][0-9]{9}$/.test(raw)) return `+1${raw}`;
  if (/^1[2-9][0-9]{9}$/.test(raw)) return `+${raw}`;
  return '';
}

async function upsert(path, body) {
  const { body: rows = [] } = await rest(path, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  return rows?.[0] || null;
}

export async function sendOwnerSmsViaRelay(message) {
  const ownerPhone = normalizeAddress(process.env.MCCLUSTER_OWNER_PHONE || process.env.MCCLUSTER_PHONE || '');
  if (!ownerPhone) return { sent: false, reason: 'owner_phone_not_configured' };

  const orgId = process.env.MCCLUSTER_ORG_ID || await houseOrgId();
  if (!orgId) return { sent: false, reason: 'house_org_not_found' };

  const { body: devices = [] } = await rest(
    `comms_relay_devices?org_id=eq.${orgId}&enabled=eq.true&select=id,phone_number,last_seen_at,created_at&order=last_seen_at.desc.nullslast,created_at.desc&limit=1`,
  );
  const device = devices?.[0];
  const relayAddress = normalizeAddress(device?.phone_number || '');
  if (!device || !relayAddress) return { sent: false, reason: 'relay_not_configured' };

  const now = new Date().toISOString();
  const contact = await upsert('comms_contacts?on_conflict=org_id,channel,address', {
    org_id: orgId,
    channel: 'sms',
    address: ownerPhone,
    display_name: 'Matthew McCluster',
    assistant_allowed: true,
    blocked: false,
    last_seen_at: now,
    updated_at: now,
  });
  if (!contact) throw new Error('owner relay contact could not be created');

  const thread = await upsert('comms_threads?on_conflict=org_id,contact_id,channel,relay_address', {
    org_id: orgId,
    contact_id: contact.id,
    relay_device_id: device.id,
    channel: 'sms',
    relay_address: relayAddress,
    mode: 'assistant',
    assistant_enabled: true,
    updated_at: now,
  });
  if (!thread) throw new Error('owner relay thread could not be created');

  const text = String(message || '').trim().slice(0, 1200);
  if (!text) return { sent: false, reason: 'empty_message' };
  const digest = createHash('sha256').update(`${now}\n${text}`).digest('hex').slice(0, 32);
  const idempotencyKey = `owner-notify:${digest}`;

  const { body: messages = [] } = await rest('comms_messages?on_conflict=org_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      thread_id: thread.id,
      direction: 'outbound',
      sender_type: 'system',
      body: text,
      status: 'queued',
      idempotency_key: idempotencyKey,
      metadata: { source: 'core_notifier', transport: 'android-sim-relay' },
    }),
  });
  let messageRow = messages?.[0];
  if (!messageRow) {
    const { body: existing = [] } = await rest(
      `comms_messages?org_id=eq.${orgId}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
    );
    messageRow = existing?.[0];
  }
  if (!messageRow) throw new Error('owner relay message could not be created');

  const { body: outboxRows = [] } = await rest('comms_outbox?on_conflict=org_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      thread_id: thread.id,
      message_id: messageRow.id,
      relay_device_id: device.id,
      destination: ownerPhone,
      body: text,
      idempotency_key: idempotencyKey,
    }),
  });
  let outbox = outboxRows?.[0];
  if (!outbox) {
    const { body: existing = [] } = await rest(
      `comms_outbox?org_id=eq.${orgId}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
    );
    outbox = existing?.[0];
  }
  if (!outbox) throw new Error('owner relay outbox item could not be created');

  await rest('comms_audit', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      org_id: orgId,
      thread_id: thread.id,
      actor_type: 'system',
      actor_id: 'mccluster-core',
      action: 'owner_notification_queued',
      detail: { outbox_id: outbox.id, transport: 'android-sim-relay' },
    }),
  }).catch(() => null);

  return {
    sent: true,
    status: 'queued',
    transport: 'android-sim-relay',
    outbox_id: outbox.id,
    relay_device_id: device.id,
  };
}
