import { fail, reply } from './lib/http.js';
const encoder = new TextEncoder();
async function service(env, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json', ...init.headers
  } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error('Database request failed'), { status: r.status, detail: data });
  return data;
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function readPublicDeveloperProfile(env, id) {
  if (typeof id !== 'string' || !id || id.length > 80 || /[\s*%\\]/.test(id)) return null;
  const literal = id.replace(/_/g, '\\_');
  const identities = await service(env, `platform_profiles?mccluster_id=ilike.${encodeURIComponent(literal)}&select=user_id,display_name,avatar_url,mccluster_id&limit=1`);
  if (!identities?.length) return null;
  const identity = identities[0];
  const links = await service(env, `m_auth_user_links?auth_user_id=eq.${encodeURIComponent(identity.user_id)}&is_primary=eq.true&select=m_uid&limit=1`);
  const muid = links?.[0]?.m_uid;
  if (!muid) return null;
  const rows = await service(env, `network_profiles?m_uid=eq.${encodeURIComponent(muid)}&visibility=eq.public&select=m_uid,display_name,headline,bio,avatar_url,banner_url,website_url,visibility,verification_state&limit=1`);
  const p = rows?.[0];
  if (!p || p.visibility !== 'public') return null;
  return { identity: { display_name: identity.display_name, avatar_url: identity.avatar_url, mccluster_id: identity.mccluster_id },
    profile: Object.fromEntries(['m_uid','display_name','headline','bio','avatar_url','banner_url','website_url','visibility','verification_state'].filter(k => p[k] !== undefined).map(k => [k,p[k]])) };
}
export async function handleDeveloperSecurity(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const keyPath = path.match(/^\/v1\/developer\/consumers\/([0-9a-f-]{36})\/keys$/i);
  if (request.method !== 'POST' || !(path === '/v1/developer/consumers' || keyPath)) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'Developer API unavailable', 503);
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer /i.test(auth) || /^Bearer mcc_/i.test(auth)) return fail(request, env, 'McCluster authentication required', 401);
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  const user = who.ok ? await who.json() : null;
  if (!user?.id) return fail(request, env, 'McCluster authentication required', 401);
  const links = await service(env, `m_auth_user_links?auth_user_id=eq.${encodeURIComponent(user.id)}&is_primary=eq.true&select=m_uid&limit=1`);
  const muid = links?.[0]?.m_uid;
  if (!muid) return fail(request, env, 'McCluster identity not provisioned', 409);
  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'Invalid JSON', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(request, env, 'JSON object required', 400);
  if (!keyPath) {
    const name = String(body.name || 'My integration').slice(0,80);
    const slug = String(body.slug || name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || `integration-${crypto.randomUUID()}`;
    const rows = await service(env, 'api_consumers', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ owner_m_uid: muid, name, slug }) });
    // Creating another integration is not authorization to issue more credits.
    return reply(request, env, { consumer: rows?.[0], developer_grant_credits: 0 }, 201);
  }
  const cid = keyPath[1];
  const owned = await service(env, `api_consumers?id=eq.${cid}&owner_m_uid=eq.${encodeURIComponent(muid)}&status=eq.active&select=id,plan_code&limit=1`);
  if (!owned?.length) return fail(request, env, 'Consumer not found', 404);
  if (body.scopes !== undefined && (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > 32)) return fail(request, env, 'Invalid API scopes', 400);
  const scopes = body.scopes === undefined ? ['mnet:read'] : [...new Set(body.scopes)];
  if (scopes.some(s => typeof s !== 'string' || !s || s.length > 80 || s.includes('*') || s.trim() !== s)) return fail(request, env, 'Invalid API scopes', 400);
  if (!owned[0].plan_code) return fail(request, env, 'API consumer plan unavailable', 409);
  const plan = await service(env, `api_plan_scopes?plan_code=eq.${encodeURIComponent(owned[0].plan_code)}&select=scope_key`);
  const enabled = await service(env, 'api_scopes?enabled=eq.true&developer_mintable=eq.true&select=scope_key');
  const allowed = new Set((plan || []).map(x => x.scope_key).filter(s => (enabled || []).some(x => x.scope_key === s)));
  if (scopes.some(s => !allowed.has(s))) return fail(request, env, 'API key scope is not permitted for this plan', 403);
  // The existing database trigger remains the atomic entitlement backstop.
  const secret = `mcc_live_${[...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2,'0')).join('')}`;
  const rows = await service(env, 'api_keys', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ consumer_id: cid, key_prefix: secret.slice(0,16), secret_hash: await digest(secret), name: String(body.name || 'default').slice(0,80), scopes }) });
  const response = reply(request, env, { key: { ...rows?.[0], secret_hash: undefined }, secret, warning: 'This secret is shown once. Store it securely.' }, 201);
  response.headers.set('cache-control','private, no-store');
  return response;
}
