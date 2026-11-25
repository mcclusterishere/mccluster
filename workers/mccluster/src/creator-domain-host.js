import { domainCapabilities, domainStore, dnsRecords } from './creator-domains.js';
import { resolveDomainTarget, storedDomainTarget } from './creator-domain-targets.js';
import { handleMemberFronts } from './member-fronts.js';
const CANONICAL = new Set(['api.mccluster.org','mccluster.org','www.mccluster.org','matthew.mccluster.org','humanuprise.com','www.humanuprise.com','localhost','127.0.0.1']);
export async function handleCreatorDomainHost(request, env, { fetchImpl = fetch, authorizeEntitlement = async () => false, projectPublic = null, projectTilesPublic = null } = {}) {
  const url = new URL(request.url);
  // workers.dev is the explicit deployment-preview surface, never a tenant-domain binding.
  if (CANONICAL.has(url.hostname) || url.hostname.endsWith('.workers.dev')) return null;
  const closed = () => new Response('This domain is not ready. Manage its connection from your site dashboard.', { status: 404, headers: { 'cache-control': 'no-store' } });
  // Disabling custom hosting must not expose the general API on a still-routed customer hostname.
  if (!domainCapabilities(env).connect) return closed();
  try {
    const rows = await domainStore(env, `creator_domains?hostname=eq.${encodeURIComponent(url.hostname)}&status=eq.active&select=auth_user_id,handle,target_type,target_id,hostname,ssl_status,last_checked_at&limit=1`, {}, fetchImpl);
    const row = rows[0];
    if (!row || row.ssl_status !== 'active' || !await authorizeEntitlement(row.auth_user_id, env, fetchImpl)) return closed();
    // CNAME check on every request avoids serving a detached/reassigned hostname from stale local state.
    if (!(await dnsRecords(row.hostname, 'CNAME', fetchImpl)).includes(env.CREATOR_DOMAINS_CNAME.toLowerCase().replace(/\.$/, ''))) return closed();
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const target = await resolveDomainTarget(row.auth_user_id, storedDomainTarget(row), (path) => domainStore(env,path,{},fetchImpl));
    const project = target.type === 'managed_project';
    // Integration must supply the canonical handler with atomic expected-owner/id
    // guards. Absence is configuration failure, never a generic URL proxy.
    if (project && !projectPublic) return closed();
    const expected = project ? `/v1/projects/${target.slug}` : `/v1/fronts/${target.slug}`;
    const tilesPath = expected + '/tiles/public';
    if (!['/','/front.html',expected,...(project ? ['/website-studio-view.html',tilesPath] : [])].includes(url.pathname)) return closed();
    const cleanRequest = new Request(`https://api.mccluster.org${expected}`);
    const front = project
      ? await projectPublic(cleanRequest, env, {fetchImpl, expectedAuthUserId:row.auth_user_id, expectedProjectId:target.id})
      : await handleMemberFronts(cleanRequest, env, {fetchImpl, expectedAuthUserId:row.auth_user_id});
    if (!front.ok) return closed();
    const presentation = project ? (await front.clone().json()).presentation || 'front' : 'front';
    if (!['front','tiles'].includes(presentation)) return closed();
    if (presentation === 'tiles') {
      if (!projectTilesPublic) return closed();
      const data = await projectTilesPublic(new Request(`https://api.mccluster.org${tilesPath}`),env,{fetchImpl,expectedAuthUserId:row.auth_user_id,expectedProjectId:target.id});
      if (!data?.ok) return closed();
      if (url.pathname === tilesPath) { data.headers.set('cache-control','no-store'); return data; }
    } else if (url.pathname === tilesPath || url.pathname === '/website-studio-view.html') return closed();
    if (url.pathname === expected) { front.headers.set('cache-control','no-store'); return front; }
    const page = await fetchImpl('https://matthew.mccluster.org/' + (presentation === 'tiles' ? 'website-studio-view.html' : 'front.html'));
    if (!page.ok) return new Response('Site temporarily unavailable', { status: 503 });
    const binding = JSON.stringify({ handle: target.slug, project: project ? target.slug : null, api: url.origin }).replace(/</g,'\\u003c');
    const bindingName = presentation === 'tiles' ? 'MCC_STUDIO_HOST' : 'MCC_FRONT_HOST';
    const html = (await page.text()).replace(/<head([^>]*)>/i, `<head$1><base href="https://matthew.mccluster.org/"><script>window.${bindingName}=${binding};</script>`);
    return new Response(request.method === 'HEAD' ? null : html, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'strict-origin-when-cross-origin' } });
  } catch (e) { if (e.status === 409) return closed(); return new Response('Site temporarily unavailable', { status: 503, headers:{'cache-control':'no-store'} }); }
}
