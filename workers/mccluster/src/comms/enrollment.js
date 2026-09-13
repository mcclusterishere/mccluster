import { fail, reply } from '../lib/http.js';

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function rest(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw Object.assign(new Error(body?.message || body?.error || `Supabase ${response.status}`), { status: 502, detail: body });
  return body;
}

async function houseOrgId(env) {
  const rows = await rest(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
  return rows?.[0]?.id || null;
}

async function requireOwner(env, user, orgId) {
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, profile_id: `eq.${user.id}`, role: 'eq.owner', select: 'org_id', limit: '1' });
  const rows = await rest(env, `org_members?${params.toString()}`);
  if (!rows?.length) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[^0-9+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return digits;
  if (/^[2-9][0-9]{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9][0-9]{9}$/.test(digits)) return `+${digits}`;
  return '';
}

export async function handleRelayEnrollment(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/comms/relay-devices') return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'McCluster is not configured', 503);

  try {
    const orgId = url.searchParams.get('org_id') || await houseOrgId(env);
    if (!orgId) throw Object.assign(new Error('McCluster house organization is not configured'), { status: 503 });
    await requireOwner(env, user, orgId);

    if (request.method === 'GET') {
      const rows = await rest(env, `comms_relay_devices?org_id=eq.${orgId}&select=id,label,phone_number,enabled,last_seen_at,capabilities,created_at,updated_at&order=created_at.desc`);
      return reply(request, env, { devices: rows });
    }

    if (request.method === 'POST') {
      const payload = await request.json().catch(() => ({}));
      const label = String(payload.label || 'McCluster Relay').trim().slice(0, 160);
      const phoneNumber = normalizeAddress(payload.phone_number);
      if (!label) throw Object.assign(new Error('label required'), { status: 400 });
      if (!phoneNumber) throw Object.assign(new Error('phone_number is required and must be E.164 or a valid US number'), { status: 400 });
      const token = randomToken();
      const tokenHash = await sha256(token);
      const rows = await rest(env, 'comms_relay_devices', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          org_id: orgId,
          label,
          phone_number: phoneNumber,
          token_hash: tokenHash,
          enabled: true,
          capabilities: { sms: true, inbound: true, outbound: true, delivery_receipts: true },
          metadata: { beta: 1, transport: 'android-sim-relay' },
        }),
      });
      const device = rows?.[0];
      if (!device) throw Object.assign(new Error('relay device enrollment failed'), { status: 502 });
      await rest(env, 'comms_audit', {
        method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
          org_id: orgId,
          actor_type: 'owner',
          actor_id: user.id,
          action: 'relay_device_enrolled',
          detail: { device_id: device.id, label, phone_number: phoneNumber },
        }),
      });
      return reply(request, env, {
        device: {
          id: device.id,
          label: device.label,
          phone_number: device.phone_number,
          enabled: device.enabled,
          capabilities: device.capabilities,
        },
        relay_token: token,
        warning: 'This token is returned once. Store it only in the relay app secure storage; the server stores only its SHA-256 hash.',
      }, 201);
    }

    return fail(request, env, 'Method not allowed', 405);
  } catch (error) {
    return fail(request, env, error.message || 'Relay enrollment failed', error.status || 500, error.detail);
  }
}
