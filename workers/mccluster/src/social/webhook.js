function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error('Social webhook database request failed'), { status: res.status, detail: data });
  return data;
}

function secureEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function accountForEntry(env, entry) {
  const externalId = String(entry.id || entry.recipient?.id || '');
  if (!externalId) return null;
  const rows = await db(env, `social_accounts?platform=eq.instagram&external_account_id=eq.${encodeURIComponent(externalId)}&select=id,org_id&limit=1`);
  return rows?.[0] || null;
}

async function storeEvent(env, event) {
  await db(env, 'social_webhook_events?on_conflict=platform,event_id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(event)
  });
}

export async function handleMetaWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') || '';
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('Webhook verification failed', { status: 403 });
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.META_APP_SECRET) return new Response('META_APP_SECRET is not configured', { status: 503 });

  const raw = await request.text();
  const supplied = request.headers.get('x-hub-signature-256') || '';
  const expected = `sha256=${await hmacHex(env.META_APP_SECRET, raw)}`;
  if (!secureEqual(supplied, expected)) return new Response('Invalid webhook signature', { status: 401 });

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const digest = await sha256(raw);
  let accepted = 0;
  for (const entry of payload.entry || []) {
    const account = await accountForEntry(env, entry);
    const items = [
      ...(entry.messaging || []).map((value) => ({ type: 'message', value })),
      ...(entry.changes || []).map((value) => ({ type: value.field || 'change', value }))
    ];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      await storeEvent(env, {
        org_id: account?.org_id || null,
        account_id: account?.id || null,
        platform: 'instagram',
        event_id: `${digest}:${index}`,
        event_type: item.type,
        payload: item.value
      });
      accepted += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, accepted }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
