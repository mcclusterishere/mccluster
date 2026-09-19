import http from 'node:http';

const EDGE = String(process.env.MCCLUSTER_EDGE_URL || 'https://api.mccluster.org').replace(/\/$/, '');
const RELAY_ID = String(process.env.MCCLUSTER_RELAY_ID || '').trim();
const RELAY_TOKEN = String(process.env.MCCLUSTER_RELAY_TOKEN || '');
const RELAY_PHONE = normalizePhone(process.env.MCCLUSTER_RELAY_PHONE || '');
const SMSGATE = String(process.env.MCCLUSTER_SMSGATE_ENDPOINT || 'http://10.77.0.2:8080').replace(/\/$/, '');
const SMSGATE_USER = String(process.env.MCCLUSTER_SMSGATE_USERNAME || '');
const SMSGATE_PASS = String(process.env.MCCLUSTER_SMSGATE_PASSWORD || '');
const WEBHOOK_TOKEN = String(process.env.MCCLUSTER_SMSGATE_WEBHOOK_TOKEN || '');
const WEBHOOK_URL = String(process.env.MCCLUSTER_SMSGATE_WEBHOOK_URL || '');
const LISTEN_HOST = String(process.env.MCCLUSTER_SMSGATE_LISTEN_HOST || '0.0.0.0');
const LISTEN_PORT = Math.max(1, Number(process.env.MCCLUSTER_SMSGATE_LISTEN_PORT || 4789));
const POLL_MS = Math.max(1000, Number(process.env.MCCLUSTER_SMSGATE_POLL_MS || 2000));
const MAX_BODY = 128 * 1024;

function normalizePhone(value) {
  const raw = String(value || '').trim().replace(/[^0-9+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^[2-9][0-9]{9}$/.test(raw)) return `+1${raw}`;
  if (/^1[2-9][0-9]{9}$/.test(raw)) return `+${raw}`;
  return '';
}

function log(event, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }));
}

function required() {
  const missing = [];
  for (const [name, value] of [
    ['MCCLUSTER_RELAY_ID', RELAY_ID],
    ['MCCLUSTER_RELAY_TOKEN', RELAY_TOKEN],
    ['MCCLUSTER_RELAY_PHONE', RELAY_PHONE],
    ['MCCLUSTER_SMSGATE_USERNAME', SMSGATE_USER],
    ['MCCLUSTER_SMSGATE_PASSWORD', SMSGATE_PASS],
    ['MCCLUSTER_SMSGATE_WEBHOOK_TOKEN', WEBHOOK_TOKEN],
  ]) if (!value) missing.push(name);
  if (missing.length) throw new Error(`missing required relay configuration: ${missing.join(', ')}`);
}

async function edge(path, init = {}) {
  const response = await fetch(`${EDGE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-mccluster-relay-id': RELAY_ID,
      'x-mccluster-relay-token': RELAY_TOKEN,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.error || body?.message || `edge returned ${response.status}`);
  return body;
}

async function smsgate(path, init = {}) {
  const auth = Buffer.from(`${SMSGATE_USER}:${SMSGATE_PASS}`).toString('base64');
  const response = await fetch(`${SMSGATE}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.error || body?.message || `SMSGate returned ${response.status}`);
  return body;
}

export function normalizeIncoming(event) {
  if (!event || event.event !== 'sms:received') return null;
  const payload = event.payload || {};
  const from = normalizePhone(payload.phoneNumber);
  const body = String(payload.message || '').trim();
  if (!from || !body) return null;
  return {
    from,
    to: RELAY_PHONE,
    body: body.slice(0, 12000),
    external_id: String(payload.messageId || '').slice(0, 500) || null,
    occurred_at: payload.receivedAt || new Date().toISOString(),
  };
}

async function postInbound(event) {
  const incoming = normalizeIncoming(event);
  if (!incoming) return { accepted: false, ignored: true };
  return edge('/v1/comms/relay/inbound', {
    method: 'POST',
    body: JSON.stringify(incoming),
  });
}

async function reportDelivery(outboxId, status, detail = {}) {
  return edge('/v1/comms/relay/delivery', {
    method: 'POST',
    body: JSON.stringify({
      outbox_id: outboxId,
      status,
      provider_message_id: detail.provider_message_id || null,
      error: detail.error || null,
    }),
  });
}

function providerMessageId(body) {
  if (!body || typeof body !== 'object') return null;
  return body.messageId || body.id || body.message_id || body.messages?.[0]?.id || body.messages?.[0]?.messageId || null;
}

async function sendOutbox(item) {
  try {
    const result = await smsgate('/message', {
      method: 'POST',
      body: JSON.stringify({
        textMessage: { text: String(item.body || '').slice(0, 12000) },
        phoneNumbers: [item.destination],
      }),
    });
    await reportDelivery(item.id, 'sent', { provider_message_id: providerMessageId(result) });
    log('relay_sms_sent', { outbox_id: item.id, destination: item.destination, provider_message_id: providerMessageId(result) });
  } catch (error) {
    await reportDelivery(item.id, 'failed', { error: error.message }).catch((reportError) => {
      log('relay_delivery_report_failed', { outbox_id: item.id, message: reportError.message });
    });
    log('relay_sms_failed', { outbox_id: item.id, destination: item.destination, message: error.message });
  }
}

async function pollOnce() {
  const claimed = await edge('/v1/comms/relay/outbox/claim', { method: 'POST', body: '{}' });
  if (!claimed?.item) return false;
  await sendOutbox(claimed.item);
  return true;
}

async function pollLoop() {
  for (;;) {
    try {
      const didWork = await pollOnce();
      if (!didWork) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    } catch (error) {
      log('relay_poll_failed', { message: error.message });
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, POLL_MS * 3)));
    }
  }
}

async function registerWebhook() {
  if (!WEBHOOK_URL) {
    log('relay_webhook_registration_skipped', { reason: 'MCCLUSTER_SMSGATE_WEBHOOK_URL_not_set' });
    return;
  }
  try {
    await smsgate('/webhooks/mccluster-inbound', { method: 'DELETE' }).catch(() => null);
    await smsgate('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ id: 'mccluster-inbound', url: WEBHOOK_URL, event: 'sms:received' }),
    });
    log('relay_webhook_registered', { url: WEBHOOK_URL });
  } catch (error) {
    log('relay_webhook_registration_failed', { message: error.message });
  }
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function startWebhookServer() {
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, relay_id: RELAY_ID, relay_phone: RELAY_PHONE }));
      return;
    }
    if (req.method !== 'POST' || path !== `/hook/${WEBHOOK_TOKEN}`) {
      res.writeHead(404).end();
      return;
    }
    try {
      const raw = await readRequest(req);
      const event = JSON.parse(raw || '{}');
      const result = await postInbound(event);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      log('relay_sms_inbound', {
        accepted: result?.accepted === true,
        thread_id: result?.thread_id || null,
        job_id: result?.job_id || null,
      });
    } catch (error) {
      log('relay_inbound_failed', { message: error.message });
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    log('relay_webhook_listening', { host: LISTEN_HOST, port: LISTEN_PORT });
  });
  return server;
}

async function main() {
  required();
  startWebhookServer();
  await registerWebhook();
  await pollLoop();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log('relay_crashed', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  });
}
