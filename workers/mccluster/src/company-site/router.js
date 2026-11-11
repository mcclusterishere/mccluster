/* McCluster Corp's property on the mccluster.org host.

   Two properties, two entities (docs/control-plane/DOMAINS-AND-ENTITIES.md):
   https://mccluster.org/ is McCluster Corp's house, https://matthew.mccluster.org/
   is Matthew McCluster's. GitHub Pages serves one custom domain per
   repository, so the company host rides the one Worker, routed by host.

   WHAT THE HOST SERVES (owner, 2026-10-15: "we need mccluster.org to
   actually show the World"). `/` is the World: mnet.html, Equity Uprise's
   globe, mission context and feed, passed through from the personal
   origin with this host's own head (../world-host.js). Equity Uprise is the
   public brand (owner, 2026-10-28: "the public brand is Equity Uprise, not
   Human Uprise") and the company's platform, so the root's title and share
   card name Equity Uprise while the root stays company-first: canonical
   https://mccluster.org/, site name McCluster Corp, and a WebPage node
   that belongs to the company WebSite and is about the Organization. The
   rooms the World opens, the sign-in pages and the static files ride the
   same way (noindex), so a member's session holds from the Earth to the
   mission dialog, the account and the governed support rail. The company
   page itself, "What is McCluster Corp?", is /company, with robots.txt,
   sitemap.xml and llms.txt (PAGES, generated). humanuprise.com stays the
   World's own door for later (../human-uprise/router.js; the file keeps
   its legacy name).

   INERT UNTIL ROUTED. This answers only requests whose host is mccluster.org
   or www.mccluster.org; every other host (api.mccluster.org first of all)
   gets null and falls through to the API untouched. Until the owner routes
   mccluster.org/* to this Worker and narrows the zone redirect rule, the
   rule keeps answering and this code never runs.

   NOTHING THAT WORKS TODAY BREAKS. Every path that is neither the World,
   one of its rooms nor a company page gets exactly what the redirect rule
   gives today: a 301 to the same path and query on
   https://matthew.mccluster.org, so shared links, printed QR codes and
   campaign links keep landing where they do now. */
import { PAGES, COMPANY_ORIGIN, PERSONAL_ORIGIN } from './pages.generated.js';
import { moved, isWorldRoom, isDocument, methodNotAllowed, upstreamOrigin, passThrough, SECURITY } from '../world-host.js';
import { isNewsPath, newsroomResponse } from './news.js';
import {customerSiteAddressResponse} from '../customer-site-addresses.js';

const APEX = 'mccluster.org';
const WWW = 'www.mccluster.org';
export const COMPANY_PAGE_PATH = '/company';

const PAGE_HEADERS = {
  'cache-control': 'public, max-age=300',
  ...SECURITY,
  'content-security-policy': "default-src 'none'; img-src https://matthew.mccluster.org; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

/* The World's head on the company host: company-first, stable @ids
   (data/seo/domain-architecture.json). The WebSite node itself is declared
   on /company with the Organization; the root only belongs to it. */
const WORLD_NAME = 'Equity Uprise · McCluster';
const WORLD_DESCRIPTION = 'Equity Uprise is McCluster Corp\'s movement platform: the World\'s globe, live context and member feed, where people find the movement and turn what they care about into verified action.';
const WORLD_NODE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${COMPANY_ORIGIN}/`,
  url: `${COMPANY_ORIGIN}/`,
  name: WORLD_NAME,
  description: WORLD_DESCRIPTION,
  isPartOf: { '@id': `${COMPANY_ORIGIN}/#website` },
  about: { '@id': 'https://matthew.mccluster.org/#mccluster-corp' },
  publisher: { '@id': 'https://matthew.mccluster.org/#mccluster-corp' }
});
/* properties.company.share_preview: "The root shares as Equity Uprise ·
   McCluster, site name McCluster Corp." The image is the supplied M mark,
   unaltered, until the owner supplies a 1200x630 company card
   (edge.activation_owner_steps). */
export const WORLD_SHARE = {
  title: WORLD_NAME,
  description: WORLD_DESCRIPTION,
  image: 'https://matthew.mccluster.org/assets/img/m-mark.png',
  imageWidth: 256,
  imageHeight: 256,
  imageAlt: 'The McCluster M mark'
};
export const WORLD_HEAD = {
  origin: COMPANY_ORIGIN,
  siteName: 'McCluster Corp',
  share: WORLD_SHARE,
  extra: `<script type="application/ld+json">${WORLD_NODE}</script>`
};

function ownsPath(path) {
  return path === '/' || path === '/mnet.html' || Object.prototype.hasOwnProperty.call(PAGES, path) || isWorldRoom(path) || isNewsPath(path);
}

export async function companySiteResponse(request, env = {}, fetchImpl = fetch) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host !== APEX && host !== WWW) return null;
  /* never plain http on the apex: one hop to https (www already answers with https targets) */
  if (host === APEX && url.protocol === 'http:') return moved(`${COMPANY_ORIGIN}${url.pathname}${url.search}`);
  /* the company page has one address; with a trailing slash it is the same page, not a path on Matthew's site */
  if (url.pathname === `${COMPANY_PAGE_PATH}/`) return moved(`${COMPANY_ORIGIN}${COMPANY_PAGE_PATH}${url.search}`);

  /* the old root document name is the root here, not the album */
  const path = url.pathname === '/index.html' ? '/' : url.pathname;
  if(!ownsPath(path)) {const site=await customerSiteAddressResponse(request,env,fetchImpl);if(site)return site;}
  if (host === WWW) return moved(ownsPath(path) ? `${COMPANY_ORIGIN}${path}${url.search}` : `${PERSONAL_ORIGIN}${url.pathname}${url.search}`);
  if (path !== url.pathname) return moved(`${COMPANY_ORIGIN}${path}${url.search}`);
  /* the World's document name is the root here, query and all */
  if (path === '/mnet.html') return moved(`${COMPANY_ORIGIN}/${url.search}`);

  /* the company's news: the house owner's posts marked for the newsroom, as articles (./news.js) */
  if (isNewsPath(path)) return newsroomResponse(request, env, fetchImpl);
  const page = Object.prototype.hasOwnProperty.call(PAGES, path) ? PAGES[path] : null;
  if (page) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
    return new Response(request.method === 'HEAD' ? null : page.body, {
      status: 200,
      headers: { 'content-type': page.type, ...PAGE_HEADERS }
    });
  }

  const root = path === '/';
  if (!root && !isWorldRoom(path)) return moved(`${PERSONAL_ORIGIN}${path}${url.search}`);
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  const origin = upstreamOrigin(env, PERSONAL_ORIGIN);
  return passThrough(request, `${origin}${root ? '/mnet.html' : path}${url.search}`, fetchImpl, {
    root,
    noindex: !root && isDocument(path),
    head: WORLD_HEAD
  });
}
