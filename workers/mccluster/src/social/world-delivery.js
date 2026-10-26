// Durable identity on the existing World + Instagram queue, never another scheduler.
export async function worldDelivery(env, user, action, data = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/world_social_delivery`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_action: action, p_user: user, p_data: data }), signal: AbortSignal.timeout(15000)
  });
  const out = await response.json().catch(() => null);
  if (!response.ok) {
    const status = { MN409:409, MN413:413, MN429:429, '42501':403 }[out?.code] || 503;
    throw Object.assign(new Error(status === 503 ? 'Combined publishing is unavailable. Check saved delivery history before posting again.' : out.message), { status });
  }
  return out;
}
export function deliveryRequest(body, appKey) {
  if (JSON.stringify(body).length > 16000) throw Object.assign(new Error('Combined post request is too large.'), { status:413 });
  const d = body.delivery;
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  if (!d || !uuid(d.operation_key) || !uuid(d.org_id) || !uuid(d.account_id)) throw Object.assign(new Error('Choose your Instagram account and a valid operation key.'), { status:400 });
  if (body.publish_at || body.newsroom || body.metadata?.newsroom) throw Object.assign(new Error('Combined publishing supports ordinary posts now. Turn off Instagram for newsroom or scheduled posts.'), { status:400 });
  return { key:d.operation_key, request:{ ...body, app_key:appKey } };
}
