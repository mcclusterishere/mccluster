/* Human Uprise's own door: the World on the humanuprise.com host.

   Owner, 2026-10-14: "I want to have the globe experience as its own solo
   experience ... but it needs to be interconnected with all the systems."
   Human Uprise is the public parent platform, intended for humanuprise.com
   (docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md). It is
   McCluster Corp's platform: the same entity as mccluster.org, not a third
   one (docs/control-plane/DOMAINS-AND-ENTITIES.md).

   ONE WORKER, BY HOST. GitHub Pages holds one custom domain per repository
   (matthew.mccluster.org), so this host rides the one Worker the way the
   company property does (the mechanics are shared: ../world-host.js): this
   answers only requests whose host is humanuprise.com or www.humanuprise.com
   and returns null for every other host, so the API is untouched. INERT
   UNTIL ROUTED: until the owner adds the Workers Route for humanuprise.com/*
   this code never runs. Until then the World's door is mccluster.org
   (owner, 2026-10-15; ../company-site/router.js).

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
import { worldHeadFor, moved, own, isWorldRoom, isDocument, methodNotAllowed, upstreamOrigin, passThrough } from '../world-host.js';

export const HUMAN_UPRISE_ORIGIN = 'https://humanuprise.com';
const APEX = 'humanuprise.com';
const WWW = 'www.humanuprise.com';

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${HUMAN_UPRISE_ORIGIN}/sitemap.xml\n`;
const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  `  <url><loc>${HUMAN_UPRISE_ORIGIN}/</loc></url>\n` +
  '</urlset>\n';

/* The World's head on this host: Human Uprise's front door, so the noindex
   gives way to this host's canonical (../world-host.js). */
const HEAD = { origin: HUMAN_UPRISE_ORIGIN, siteName: 'Human Uprise' };
export function worldHead(html) {
  return worldHeadFor(html, HEAD);
}

/* The World's files are fetched from PUBLIC_ORIGIN, the personal origin the
   Worker already names (wrangler.toml); a test points that at a local
   server. The 301 for everything else always names Matthew's public
   property, where those pages live. In production the two are the same. */
export async function humanUpriseResponse(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host !== APEX && host !== WWW) return null;
  /* never plain http on the apex: one hop to https (www already answers with https targets) */
  if (host === APEX && url.protocol === 'http:') return moved(`${HUMAN_UPRISE_ORIGIN}${url.pathname}${url.search}`);
  if (host === WWW) return moved(`${HUMAN_UPRISE_ORIGIN}${url.pathname}${url.search}`);

  const path = url.pathname;
  if (path === '/robots.txt') return own(ROBOTS, 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') return own(SITEMAP, 'application/xml; charset=utf-8');
  /* the World's document name is the root here, query and all */
  if (path === '/mnet.html') return moved(`${HUMAN_UPRISE_ORIGIN}/${url.search}`);

  const origin = upstreamOrigin(env, PERSONAL_ORIGIN);
  const root = path === '/';
  if (!root && !isWorldRoom(path)) return moved(`${PERSONAL_ORIGIN}${path}${url.search}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  return passThrough(request, `${origin}${root ? '/mnet.html' : path}${url.search}`, fetchImpl, {
    root,
    noindex: !root && isDocument(path),
    head: HEAD
  });
}
