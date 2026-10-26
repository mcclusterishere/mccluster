import { reply } from './lib/http.js';
export const DOMAINS_PREFIX = '/v1/creator-domains';
const bad = (message, status = 409) => Object.assign(new Error(message), { status });
export function hostname(value) {
  const h = String(value || '').trim().toLowerCase();
  if (h.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) || /(^|\.)(mccluster\.org|humanuprise\.com|localhost|example\.com|invalid|test)$/.test(h)) throw bad('Enter a public domain you own, without https:// or a path', 400);
  return h;
}
export function domainCapabilities(env) {
  const connect = env.CREATOR_DOMAINS_ENABLED === 'true' && !!(env.CREATOR_DOMAINS_ZONE_ID && env.CREATOR_DOMAINS_API_TOKEN && env.CREATOR_DOMAINS_CNAME);
  return { connect, purchase: false, renew: false, reason: connect ? 'Connect an existing domain. Purchases and renewals are not enabled.' : 'Domain hosting is awaiting platform configuration. Purchases and renewals are not enabled.' };
}
export async function domainStore(env, path, init = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw bad(data?.code === '23505' ? 'This domain has already been claimed' : 'Domain storage is unavailable; please retry later', data?.code === '23505' ? 409 : 503);
  return data;
}
export async function cloudflare(env, path, init = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${env.CREATOR_DOMAINS_ZONE_ID}/custom_hostnames${path}`, { ...init, signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${env.CREATOR_DOMAINS_API_TOKEN}`, 'content-type': 'application/json' } });
  if (init.method === 'DELETE' && r.status === 404) return null;
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) throw bad('Hosting provider could not complete this check. Retry verification.', 503);
  return b.result;
}
export async function dnsRecords(name, type, fetchImpl = fetch) {
  const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  const b = await r.json();
  if (!r.ok || ![0,3].includes(b.Status)) throw bad('DNS could not be checked; retry shortly', 503);
  return (b.Answer || []).filter(a => a.type === (type === 'TXT' ? 16 : 5)).map(a => type === 'TXT' ? a.data.replace(/^"|"$/g, '').replace(/"\s+"/g, '') : a.data.toLowerCase().replace(/\.$/, ''));
}
export function presentDomain(row, env) {
  return { id: row.id, hostname: row.hostname, handle: row.handle, status: row.status, ssl_status: row.ssl_status, last_checked_at: row.last_checked_at, last_error: row.last_error,
    records: [{ type: 'TXT', name: `_mccluster.${row.hostname}`, value: row.verification_token }, { type: 'CNAME', name: row.hostname, value: env.CREATOR_DOMAINS_CNAME || '' }], provider_records: row.provider_records || [] };
}
export async function handleCreatorDomains(request, env, { fetchImpl = fetch, authorizeEntitlement = async () => false } = {}) {
  const p = new URL(request.url).pathname.replace(/\/$/, '');
  if (p !== DOMAINS_PREFIX && !p.startsWith(DOMAINS_PREFIX + '/')) return null;
  const send = (data, status = 200) => { const r = reply(request, env, data, status); r.headers.set('cache-control', 'no-store'); return r; };
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw bad('Domain storage is not configured', 503);
    const authorization = request.headers.get('authorization');
    if (!/^Bearer \S+$/i.test(authorization || '')) throw bad('Sign in to manage domains', 401);
    const auth = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey: env.SUPABASE_SERVICE_ROLE_KEY } });
    const user = auth.ok ? await auth.json() : null;
    if (!user?.id || user.is_anonymous || !/^[a-f0-9-]{36}$/i.test(user.id)) throw bad('Sign in to manage domains', 401);
    const owner = `auth_user_id=eq.${user.id}`;
    const db = (path, init) => domainStore(env, path, init, fetchImpl);
    const caps = domainCapabilities(env);
    if (p === DOMAINS_PREFIX && request.method === 'GET') return send({ domains: (await db(`creator_domains?${owner}&order=created_at.desc`)).map(r => presentDomain(r, env)), capabilities: caps, cname_target: env.CREATOR_DOMAINS_CNAME || null });
    if (!caps.connect) throw bad(caps.reason, 503);
    const rest = p.slice(DOMAINS_PREFIX.length).split('/').filter(Boolean);
    if (!rest.length && request.method === 'POST') {
      if (!await authorizeEntitlement(user.id, env, fetchImpl)) throw bad('An active site plan with custom domains is required', 402);
      const fronts = await db(`member_fronts?${owner}&removed_at=is.null&select=handle&limit=1`);
      if (!fronts[0]?.handle) throw bad('Save your site before connecting a domain');
      if (Number(request.headers.get('content-length') || 0) > 2048) throw bad('Request too large', 413);
      const input = await request.text(); if (input.length > 2048) throw bad('Request too large', 413);
      const h = hostname(JSON.parse(input).hostname);
      const existing = await db(`creator_domains?${owner}&hostname=eq.${h}&limit=1`);
      if (existing[0]) return send({ domain: presentDomain(existing[0], env) });
      const own = await db(`creator_domains?${owner}&select=id&limit=10`);
      if (own.length >= 10) throw bad('Remove an unused domain before adding another');
      const rows = await db('creator_domains', { method: 'POST', body: JSON.stringify({ auth_user_id: user.id, handle: fronts[0].handle, hostname: h, verification_token: `mccluster=${crypto.randomUUID()}` }) });
      return send({ domain: presentDomain(rows[0], env) }, 201);
    }
    if (!/^[a-f0-9-]{36}$/i.test(rest[0] || '')) throw bad('Domain not found', 404);
    const filter = `id=eq.${rest[0]}&${owner}`;
    const rows = await db(`creator_domains?${filter}&limit=1`); const row = rows[0];
    if (!row) throw bad('Domain not found', 404);
    const patch = body => db(`creator_domains?${filter}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (rest.length === 1 && request.method === 'DELETE') {
      const lease = await db('rpc/claim_creator_domain', { method: 'POST', body: JSON.stringify({ domain_id: row.id, owner_id: user.id, mark_verified: false }) });
      if (!lease) throw bad('Verification is running; retry disconnect shortly');
      await patch({ status: 'detached' }); // Stop routing BEFORE any remote deletion; retries are safe.
      try {
        let providerId = row.provider_id;
        if (!providerId) {
          const found = await cloudflare(env, `?hostname=${encodeURIComponent(row.hostname)}`, {}, fetchImpl);
          providerId = found.find(v => v.hostname === row.hostname && v.custom_metadata?.creator_domain_id === row.id)?.id;
        }
        if (providerId) await cloudflare(env, `/${providerId}`, { method: 'DELETE' }, fetchImpl);
      } catch (e) { await patch({ lease_until: null }); throw e; }
      await db(`creator_domains?${filter}`, { method: 'DELETE' });
      return send({ ok: true });
    }
    if (rest.length !== 2 || rest[1] !== 'verify' || request.method !== 'POST') throw bad('Route not found', 404);
    if (row.status === 'detached') throw bad('Retry removing this domain before reconnecting it');
    if (!await authorizeEntitlement(user.id, env, fetchImpl)) { await patch({ status: 'plan_required' }); throw bad('An active site plan with custom domains is required', 402); }
    const txt = await dnsRecords(`_mccluster.${row.hostname}`, 'TXT', fetchImpl);
    if (!txt.includes(row.verification_token)) {
      const result = await patch({ status: 'ownership_pending', last_checked_at: new Date().toISOString(), last_error: 'Add the TXT ownership record, then retry.' });
      return send({ domain: presentDomain(result[0], env) });
    }
    // Atomic database lease and unique verified-host index prevent concurrent provider creates/claims.
    const locked = await db('rpc/claim_creator_domain', { method: 'POST', body: JSON.stringify({ domain_id: row.id, owner_id: user.id, mark_verified: true }) });
    if (!locked) throw bad('Verification is already running; retry shortly');
    try {
      let provider = row.provider_id ? await cloudflare(env, `/${row.provider_id}`, {}, fetchImpl) : null;
      if (!provider) {
        const found = await cloudflare(env, `?hostname=${encodeURIComponent(row.hostname)}`, {}, fetchImpl);
        provider = found.find(v => v.hostname === row.hostname);
        // An existing provider record is adoptable only if it was created for this claim.
        if (provider && provider.custom_metadata?.creator_domain_id !== row.id) throw bad('This hostname already exists at the hosting provider. Contact support to resolve its previous binding.');
        if (!provider) provider = await cloudflare(env, '', { method: 'POST', body: JSON.stringify({ hostname: row.hostname, ssl: { method: 'txt', type: 'dv' }, custom_metadata: { creator_domain_id: row.id } }) }, fetchImpl);
      }
      if (provider.hostname !== row.hostname) throw bad('Hosting provider returned an unexpected domain', 503);
      const cname = await dnsRecords(row.hostname, 'CNAME', fetchImpl);
      const status = !cname.includes(env.CREATOR_DOMAINS_CNAME.toLowerCase().replace(/\.$/, '')) ? 'dns_pending' : provider.status === 'active' && provider.ssl?.status === 'active' ? 'active' : 'tls_pending';
      const result = await patch({ status, provider_id: provider.id, ssl_status: provider.ssl?.status || 'pending', provider_records: [provider.ownership_verification, ...(provider.ssl?.validation_records || [])].filter(Boolean), last_checked_at: new Date().toISOString(), last_error: null, lease_until: null });
      return send({ domain: presentDomain(result[0], env) });
    } catch (e) { await patch({ status: 'error', last_error: e.message, lease_until: null }); throw e; }
  } catch (e) { return send({ error: e instanceof SyntaxError ? 'Invalid request' : e.message }, e instanceof SyntaxError ? 400 : e.status || 503); }
}
