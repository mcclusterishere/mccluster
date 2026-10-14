/* Human Uprise's own door: the World on the humanuprise.com host.

   Owner, 2026-10-14: "I want to have the globe experience as its own solo
   experience ... but it needs to be interconnected with all the systems."
   Human Uprise is the public parent platform, intended for humanuprise.com
   (docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md). It is
   McCluster Corp's platform: the same entity as mccluster.org, not a third
   one (docs/control-plane/DOMAINS-AND-ENTITIES.md).

   ONE WORKER, BY HOST. GitHub Pages holds one custom domain per repository
   (matthew.mccluster.org), so this host rides the one Worker the way the
   company property does: this answers only requests whose host is
   humanuprise.com or www.humanuprise.com and returns null for every other
   host, so the API is untouched. INERT UNTIL ROUTED: until the owner adds
   the Workers Route for humanuprise.com/* this code never runs.

   WHAT THE HOST SERVES. `/` is the World: mnet.html, fetched from the
   personal origin and passed through with this host's own canonical in
   its head. The rooms the World opens, the sign-in pages and the static
   files ride the same way, so a member's session (per-origin localStorage)
   holds from the Earth to the mission dialog, the account and the governed
   support rail. Everything else is Matthew's site or the company's and gets
   a 301 to the same path on matthew.mccluster.org: the Music tab, the M,
   every creator page and every record land on the property they belong to.

   NOT A MIRROR. Only `/` is indexable here, with a robots.txt and a
   one-line sitemap of its own; every other proxied page carries
   x-robots-tag: noindex. Nothing is rewritten beyond the World's head: no
   base tag, no link rewriting. Relative links resolve on this host and the
   rules above decide where each one lands. */
import { PERSONAL_ORIGIN } from '../company-site/pages.generated.js';

export const HUMAN_UPRISE_ORIGIN = 'https://humanuprise.com';
const APEX = 'humanuprise.com';
const WWW = 'www.humanuprise.com';

/* The World's own rooms, by exact path... */
const WORLD_ROOMS = new Set([
  '/action-globe.html', // the Earth in the World's frame: same origin, for the postMessage bridge
  '/action-policy.html', '/world-news.html', '/create.html', '/give.html', '/privacy.html',
  '/account.html', '/login.html', '/forgot-password.html', '/reset-password.html', '/onboard.html',
  '/sw.js'
]);
/* ...and by prefix: the action rooms, the campaign funnel, the sign-in
   callback, and the static files every page loads. */
const WORLD_PREFIXES = ['/action-network-', '/action/', '/auth/', '/js/', '/css/', '/assets/', '/data/'];

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${HUMAN_UPRISE_ORIGIN}/sitemap.xml\n`;
const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  `  <url><loc>${HUMAN_UPRISE_ORIGIN}/</loc></url>\n` +
  '</urlset>\n';

/* The World's head on this host. On Matthew's site mnet.html is noindex
   (the member network is not a search landing there); here it is Human
   Uprise's front door, so the noindex gives way to this host's canonical. */
const ROOT_HEAD = [
  `<link rel="canonical" href="${HUMAN_UPRISE_ORIGIN}/">`,
  `<meta property="og:url" content="${HUMAN_UPRISE_ORIGIN}/">`,
  '<meta property="og:site_name" content="Human Uprise">'
].join('\n  ');
const NOINDEX_META = /<meta name="robots" content="noindex">/;

export function worldHead(html) {
  if (NOINDEX_META.test(html)) return html.replace(NOINDEX_META, ROOT_HEAD);
  return html.replace('</title>', '</title>\n  ' + ROOT_HEAD);
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000'
};
/* headers the client may send upstream, and headers upstream may send back.
   content-encoding and content-length never pass: the runtime decodes the
   upstream body and sizes the one it sends. */
const UPSTREAM_REQUEST = ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range'];
const UPSTREAM_RESPONSE = ['content-type', 'cache-control', 'etag', 'last-modified', 'vary', 'accept-ranges', 'content-range'];

function moved(location) {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } });
}
function own(body, type) {
  return new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', ...SECURITY } });
}
function isWorldRoom(path) {
  return WORLD_ROOMS.has(path) || WORLD_PREFIXES.some((p) => path.startsWith(p));
}
function isDocument(path) {
  return path.endsWith('.html') || path.endsWith('/');
}

async function passThrough(request, upstream, fetchImpl, { root, noindex }) {
  const headers = new Headers();
  for (const h of UPSTREAM_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = await fetchImpl(new Request(upstream, { method: request.method, headers, redirect: 'follow' }));
  const out = new Headers(SECURITY);
  for (const h of UPSTREAM_RESPONSE) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (noindex) out.set('x-robots-tag', 'noindex');
  if (root && res.status === 200) {
    /* the body changes here, so the upstream validator does not describe it */
    out.delete('etag');
    out.set('cache-control', 'public, max-age=300');
    return new Response(request.method === 'HEAD' ? null : worldHead(await res.text()), { status: 200, headers: out });
  }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
}

/* The World's files are fetched from PUBLIC_ORIGIN, the personal origin the
   Worker already names (wrangler.toml); a test points that at a local
   server. The 301 for everything else always names Matthew's public
   property, where those pages live. In production the two are the same. */
export async function humanUpriseResponse(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host !== APEX && host !== WWW) return null;
  if (host === WWW) return moved(`${HUMAN_UPRISE_ORIGIN}${url.pathname}${url.search}`);

  const path = url.pathname;
  if (path === '/robots.txt') return own(ROBOTS, 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') return own(SITEMAP, 'application/xml; charset=utf-8');
  /* the World's document name is the root here, query and all */
  if (path === '/mnet.html') return moved(`${HUMAN_UPRISE_ORIGIN}/${url.search}`);

  const origin = String(env.PUBLIC_ORIGIN || PERSONAL_ORIGIN).replace(/\/$/, '');
  const root = path === '/';
  if (!root && !isWorldRoom(path)) return moved(`${PERSONAL_ORIGIN}${path}${url.search}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return passThrough(request, `${origin}${root ? '/mnet.html' : path}${url.search}`, fetchImpl, {
    root,
    noindex: !root && isDocument(path)
  });
}
