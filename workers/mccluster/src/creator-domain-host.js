import { domainCapabilities, domainStore, dnsRecords } from './creator-domains.js';
import { handleMemberFronts } from './member-fronts.js';
const CANONICAL = new Set(['api.mccluster.org','mccluster.org','www.mccluster.org','matthew.mccluster.org','humanuprise.com','www.humanuprise.com','localhost','127.0.0.1']);
export async function handleCreatorDomainHost(request, env, { fetchImpl = fetch, authorizeEntitlement = async () => false } = {}) {
  const url = new URL(request.url);
  // workers.dev is the explicit deployment-preview surface, never a tenant-domain binding.
  if (CANONICAL.has(url.hostname) || url.hostname.endsWith('.workers.dev')) return null;
  const closed = () => new Response('This domain is not ready. Manage its connection from your site dashboard.', { status: 404, headers: { 'cache-control': 'no-store' } });
  // Disabling custom hosting must not expose the general API on a still-routed customer hostname.
  if (!domainCapabilities(env).connect) return closed();
  try {
    const rows = await domainStore(env, `creator_domains?hostname=eq.${encodeURIComponent(url.hostname)}&status=eq.active&select=auth_user_id,handle,hostname,ssl_status,last_checked_at&limit=1`, {}, fetchImpl);
    const row = rows[0];
    if (!row || row.ssl_status !== 'active' || !await authorizeEntitlement(row.auth_user_id, env, fetchImpl)) return closed();
    // CNAME check on every request avoids serving a detached/reassigned hostname from stale local state.
    if (!(await dnsRecords(row.hostname, 'CNAME', fetchImpl)).includes(env.CREATOR_DOMAINS_CNAME.toLowerCase().replace(/\.$/, ''))) return closed();
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    // A handle can change/recycle; domain ownership must still match the actual front row.
    const bound = await domainStore(env, `member_fronts?auth_user_id=eq.${row.auth_user_id}&handle=eq.${encodeURIComponent(row.handle)}&removed_at=is.null&published=not.is.null&select=auth_user_id,handle&limit=1`, {}, fetchImpl);
    if (!bound[0] || bound[0].auth_user_id !== row.auth_user_id || bound[0].handle !== row.handle) return closed();
    const expected = `/v1/fronts/${row.handle}`;
    if (url.pathname !== '/' && url.pathname !== '/front.html' && url.pathname !== expected) return closed();
    // No incoming authorization, cookies, forwarded-host or arbitrary API path is proxied.
    const front = await handleMemberFronts(new Request(`https://api.mccluster.org${expected}`), env, { fetchImpl, expectedAuthUserId: row.auth_user_id });
    if (!front.ok) return closed();
    if (url.pathname === expected) { front.headers.set('cache-control','no-store'); return front; }
    const page = await fetchImpl('https://matthew.mccluster.org/front.html');
    if (!page.ok) return new Response('Site temporarily unavailable', { status: 503 });
    const binding = JSON.stringify({ handle: row.handle, api: url.origin }).replace(/</g,'\\u003c');
    const html = (await page.text()).replace(/<head([^>]*)>/i, `<head$1><base href="https://matthew.mccluster.org/"><script>window.MCC_FRONT_HOST=${binding};</script>`);
    return new Response(request.method === 'HEAD' ? null : html, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'strict-origin-when-cross-origin' } });
  } catch { return new Response('Site temporarily unavailable', { status: 503, headers:{'cache-control':'no-store'} }); }
}
