import { resolveDomainTarget, storedDomainTarget } from './creator-domain-targets.js';
import { reply } from './lib/http.js';
export const DOMAINS_PREFIX = '/v1/creator-domains';
const bad = (message, status = 409) => Object.assign(new Error(message), { status });
export const PROVIDER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function hostname(value) {
  const h = String(value || '').trim().toLowerCase();
  if (h.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) || /(^|\.)(mccluster\.org|humanuprise\.com|localhost|example\.com|invalid|test)$/.test(h)) throw bad('Enter a public domain you own, without https:// or a path', 400);
  return h;
}
export function domainCapabilities(env) {
  const connect = env.CREATOR_DOMAINS_ENABLED === 'true' && !!(env.CREATOR_DOMAINS_ZONE_ID && env.CREATOR_DOMAINS_API_TOKEN && env.CREATOR_DOMAINS_CNAME);
  return { connect, purchase: false, renew: false, dns_mode:'cname', apex_verified:false, reason: connect ? 'Connect an existing hostname using a public CNAME. Apex hosting needs separately verified provider and DNS support. Purchases and renewals are not enabled.' : 'Domain hosting is awaiting platform configuration. Purchases and renewals are not enabled.' };
}
export async function domainStore(env, path, init = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, signal:AbortSignal.timeout(15000),headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw bad(data?.code === '23505' ? 'This domain has already been claimed' : data?.code==='40001'?'Domain operation changed. Refresh its status before retrying.':'Domain storage is unavailable; please retry later', ['23505','40001'].includes(data?.code) ? 409 : 503);
  return data;
}
export async function cloudflare(env, path, init = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${env.CREATOR_DOMAINS_ZONE_ID}/custom_hostnames${path}`, { ...init, signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${env.CREATOR_DOMAINS_API_TOKEN}`, 'content-type': 'application/json' } });
  if (path.startsWith('/') && ['GET','DELETE'].includes(init.method||'GET') && r.status === 404) return null;
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) throw bad('Hosting provider could not complete this check. Retry verification.', 503);
  return b.result;
}
export async function dnsRecords(name, type, fetchImpl = fetch) {
  const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { signal:AbortSignal.timeout(10000),headers: { accept: 'application/dns-json' } });
  const b = await r.json();
  if (!r.ok || ![0,3].includes(b.Status)) throw bad('DNS could not be checked; retry shortly', 503);
  return (b.Answer || []).filter(a => a.type === (type === 'TXT' ? 16 : 5)).map(a => type === 'TXT' ? a.data.replace(/^"|"$/g, '').replace(/"\s+"/g, '') : a.data.toLowerCase().replace(/\.$/, ''));
}
export function presentDomain(row, env) {
  return { id: row.id, hostname: row.hostname, handle: row.handle, target: storedDomainTarget(row), status: ['started','reconciliation_required'].includes(row.provider_state)?'reconciliation_required':row.status, ssl_status: row.ssl_status, last_checked_at: row.last_checked_at, last_error: row.last_error,
    connection_mode:'cname',connection_note:'Use a hostname with a public CNAME. Apex/flattened DNS is not verified by this adapter. Provider verification expires after 24 hours; Verify again refreshes it.',
    records: [{ type: 'TXT', name: `_mccluster.${row.hostname}`, value: row.verification_token }],
    routing_candidate:{type:'CNAME',name:row.hostname,value:env.CREATOR_DOMAINS_CNAME||'',requires_public_cname:true},provider_records: row.provider_records || [] };
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
    if (p === DOMAINS_PREFIX && request.method === 'GET') {
      const fronts = await db(`member_fronts?${owner}&removed_at=is.null&select=auth_user_id,handle&limit=1`);
      const projects = await db(`managed_projects?owner_user_id=eq.${user.id}&removed_at=is.null&select=id,owner_user_id,slug,name&order=slug.asc`);
      const targets = [
        ...fronts.filter(r=>r.auth_user_id===user.id).map(r=>({type:'member_front',id:user.id,slug:r.handle,label:'Personal site: '+r.handle})),
        ...projects.filter(r=>r.owner_user_id===user.id).map(r=>({type:'managed_project',id:r.id,slug:r.slug,label:r.name || r.slug}))
      ];
      return send({ domains: (await db(`creator_domains?${owner}&order=created_at.desc`)).map(r => presentDomain(r, env)), targets, capabilities: caps, cname_target: env.CREATOR_DOMAINS_CNAME || null });
    }
    if (!caps.connect) throw bad(caps.reason, 503);
    const rest = p.slice(DOMAINS_PREFIX.length).split('/').filter(Boolean);
    if (!rest.length && request.method === 'POST') {
      if (!await authorizeEntitlement(user.id, env, fetchImpl)) throw bad('An active site plan with custom domains is required', 402);
      if (Number(request.headers.get('content-length') || 0) > 2048) throw bad('Request too large', 413);
      const input = await request.text(); if (input.length > 2048) throw bad('Request too large', 413);
      const body = JSON.parse(input);
      const h = hostname(body.hostname);
      const target = await resolveDomainTarget(user.id, body.target, db);
      const existing = await db(`creator_domains?${owner}&hostname=eq.${h}&limit=1`);
      if (existing[0]) {
        const old = storedDomainTarget(existing[0]);
        if (old.type !== target.type || old.id !== target.id || old.slug !== target.slug) throw bad('Disconnect this domain before changing its site target');
        return send({ domain: presentDomain(existing[0], env) });
      }
      const own = await db(`creator_domains?${owner}&select=id&limit=10`);
      if (own.length >= 10) throw bad('Remove an unused domain before adding another');
      const rows = await db('creator_domains', { method: 'POST', body: JSON.stringify({ auth_user_id: user.id, handle: target.slug, target_type: target.type, target_id: target.id, hostname: h, verification_token: `mccluster=${crypto.randomUUID()}` }) });
      return send({ domain: presentDomain(rows[0], env) }, 201);
    }
    if (!/^[a-f0-9-]{36}$/i.test(rest[0] || '')) throw bad('Domain not found', 404);
    const filter = `id=eq.${rest[0]}&${owner}`;
    const rows = await db(`creator_domains?${filter}&limit=1`); const row = rows[0];
    if (!row) throw bad('Domain not found', 404);
    let operation=null,current=row;
    const claim=async verified=>{
      operation=crypto.randomUUID();current=await db('rpc/claim_creator_domain_v2',{method:'POST',body:JSON.stringify({domain_id:row.id,owner_id:user.id,operation_id:operation,mark_verified:verified})});
      if(!current)throw bad('A domain operation is running. Refresh its status shortly.');
    };
    const update=async(changes,finish=false,forget=false)=>{
      const next=await db('rpc/update_creator_domain_v2',{method:'POST',body:JSON.stringify({domain_id:row.id,owner_id:user.id,operation_id:operation,changes,finish,forget,expected_provider_state:current.provider_state})});
      if(next)current=next;return next;
    };
    const reconcile=()=>Object.assign(bad('Provider ownership needs reviewed reconciliation. Do not reconnect or create another provider record.',409),{reconciliation:true});
    const providerBinding=()=>{
      if(current.provider_state!=='bound'||current.provider_zone_id!==env.CREATOR_DOMAINS_ZONE_ID||!PROVIDER_ID.test(current.provider_id||''))throw reconcile();
    };
    const readProvider=async()=>{providerBinding();const provider=await cloudflare(env,'/'+encodeURIComponent(current.provider_id),{},fetchImpl);if(provider&&(provider.id!==current.provider_id||provider.hostname!==row.hostname))throw reconcile();return provider;};
    if (rest.length === 1 && request.method === 'DELETE') {
      await claim(false); // Stops routing before remote work and retains uncertain claims.
      try {
        if(['started','reconciliation_required'].includes(current.provider_state))throw reconcile();
        if(current.provider_id){
          const provider=await readProvider();
          await update({}); // Fence/renew immediately before the remote mutation.
          if(provider)await cloudflare(env,'/'+encodeURIComponent(current.provider_id),{method:'DELETE'},fetchImpl);
        }else if(current.provider_state!=='none')throw reconcile();
        await update({},true,true);
      } catch (e) { await update({last_error:e.message,...(e.reconciliation?{provider_state:'reconciliation_required'}:{})},true).catch(()=>{});throw e; }
      return send({ ok: true });
    }
    if (rest.length !== 2 || rest[1] !== 'verify' || request.method !== 'POST') throw bad('Route not found', 404);
    if (row.status === 'detached') throw bad('Retry removing this domain before reconnecting it');
    if (!await authorizeEntitlement(user.id, env, fetchImpl)) throw bad('An active site plan with custom domains is required', 402);
    await resolveDomainTarget(user.id, storedDomainTarget(row), db);
    const txt = await dnsRecords(`_mccluster.${row.hostname}`, 'TXT', fetchImpl);
    if (!txt.includes(row.verification_token)) {
      // No unfenced write may race an existing verification or disconnect.
      await claim(null);
      const result=await update({status:'ownership_pending',last_checked_at:new Date().toISOString(),last_error:'Add the TXT ownership record, then retry.'},true);
      return send({ domain: presentDomain(result, env) });
    }
    // Atomic database lease and unique verified-host index prevent concurrent provider creates/claims.
    await claim(true);
    try {
      if(['started','reconciliation_required'].includes(current.provider_state))throw reconcile();
      let provider=current.provider_id?await readProvider():null;
      if(current.provider_id&&!provider){await update({provider_state:'reconciliation_required'});throw reconcile();}
      if(!provider){
        if(current.provider_state!=='none')throw reconcile();
        const found=await cloudflare(env,'?hostname.exact='+encodeURIComponent(row.hostname)+'&page=1&per_page=5',{},fetchImpl);
        if(!Array.isArray(found))throw bad('Hosting provider lookup is unavailable',503);
        if(found.length){await update({provider_state:'reconciliation_required'});throw reconcile();}
        // Commit intent BEFORE POST. No retries/adoption after ambiguous acceptance.
        await update({provider_state:'started',provider_zone_id:env.CREATOR_DOMAINS_ZONE_ID});
        provider=await cloudflare(env,'',{method:'POST',body:JSON.stringify({hostname:row.hostname,ssl:{method:'txt',type:'dv'}})},fetchImpl);
        if(!provider||!PROVIDER_ID.test(provider.id||'')||provider.hostname!==row.hostname)throw reconcile();
        // Save returned identity before DNS, target checks, or any other provider call.
        await update({provider_id:provider.id,provider_state:'bound'});
        provider=await readProvider();if(!provider)throw reconcile();
      }
      if (provider.hostname !== row.hostname) throw bad('Hosting provider returned an unexpected domain', 503);
      const cname = await dnsRecords(row.hostname, 'CNAME', fetchImpl);
      const status = !cname.includes(env.CREATOR_DOMAINS_CNAME.toLowerCase().replace(/\.$/, '')) ? 'dns_pending' : provider.status === 'active' && provider.ssl?.status === 'active' ? 'active' : 'tls_pending';
      // A delayed provider result cannot resurrect a deleted/reassigned site.
      await resolveDomainTarget(user.id, storedDomainTarget(row), db);
      const result = await update({ status, ssl_status: provider.ssl?.status || 'pending', provider_records: [provider.ownership_verification, ...(provider.ssl?.validation_records || [])].filter(Boolean), last_checked_at: new Date().toISOString(), last_error: null },true);
      return send({ domain: presentDomain(result, env) });
    } catch (e) {
      // Persistence can commit even when its response is lost. Read the durable
      // binding before classifying uncertainty; CAS prevents a blind downgrade.
      if(current.provider_state==='started'){
        const saved=await db(`creator_domains?${filter}&limit=1`).catch(()=>[]);
        if(saved[0]?.operation_id===operation&&saved[0].provider_state==='bound'&&saved[0].provider_id&&saved[0].provider_zone_id===env.CREATOR_DOMAINS_ZONE_ID)current=saved[0];
      }
      const ambiguous=current.provider_state==='started'||e.reconciliation;
      await update({status:'error',last_error:ambiguous?reconcile().message:e.message,...(ambiguous?{provider_state:'reconciliation_required'}:{})},true).catch(()=>{});
      throw ambiguous?reconcile():e;
    }
  } catch (e) { return send({ error: e instanceof SyntaxError ? 'Invalid request' : e.message }, e instanceof SyntaxError ? 400 : e.status || 503); }
}
