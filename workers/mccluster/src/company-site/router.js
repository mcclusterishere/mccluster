/* McCluster Corp's property on the mccluster.org host.

   Two properties, two entities (docs/control-plane/DOMAINS-AND-ENTITIES.md):
   https://mccluster.org/ is McCluster Corp's house, https://matthew.mccluster.org/
   is Matthew McCluster's. GitHub Pages serves one custom domain per
   repository, so the company pages ride the one Worker, routed by host.

   INERT UNTIL ROUTED. This answers only requests whose host is mccluster.org
   or www.mccluster.org; every other host (api.mccluster.org first of all)
   gets null and falls through to the API untouched. Until the owner routes
   mccluster.org/* to this Worker and narrows the zone redirect rule, the
   rule keeps answering and this code never runs.

   NOTHING THAT WORKS TODAY BREAKS. The company property owns only the paths
   in PAGES. Every other path gets exactly what the redirect rule gives today:
   a 301 to the same path and query on https://matthew.mccluster.org, so
   shared links, printed QR codes and Action Network campaign links keep
   landing where they do now. */
import { PAGES, COMPANY_ORIGIN, PERSONAL_ORIGIN } from './pages.generated.js';

const APEX = 'mccluster.org';
const WWW = 'www.mccluster.org';

const PAGE_HEADERS = {
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'none'; img-src https://matthew.mccluster.org; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

function moved(location) {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } });
}

export function companySiteResponse(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host !== APEX && host !== WWW) return null;

  /* the old root document name is the company root now, not the album */
  const path = url.pathname === '/index.html' ? '/' : url.pathname;
  const page = Object.prototype.hasOwnProperty.call(PAGES, path) ? PAGES[path] : null;

  if (host === WWW) return moved(page ? `${COMPANY_ORIGIN}${path}${url.search}` : `${PERSONAL_ORIGIN}${url.pathname}${url.search}`);
  if (!page) return moved(`${PERSONAL_ORIGIN}${url.pathname}${url.search}`);
  if (path !== url.pathname) return moved(`${COMPANY_ORIGIN}${path}${url.search}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : page.body, {
    status: 200,
    headers: { 'content-type': page.type, ...PAGE_HEADERS }
  });
}
