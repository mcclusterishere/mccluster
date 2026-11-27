/* McCluster Corp's own pages and the World's head on the platform host.

   One platform, tenant properties, separate entities (docs/control-plane/DOMAINS-AND-ENTITIES.md): the platform
   (mccluster.org today) is McCluster Corp's, Matthew McCluster's profile (matthew.mccluster.org) is his. Which host
   answers which path is the host router's (../platform/router.js), read from the generated table
   (../platform/hosts.generated.js, data/seo/domain-architecture.json); this file keeps what McCluster Corp's pages say.

   WHAT THE HOST SERVES (owner, 2026-10-15: "we need mccluster.org to
   actually show the World"). `/` is the World: mnet.html, Equity Uprise's
   globe, mission context and feed, passed through from the static origin
   with this host's own head (../world-host.js). Equity Uprise is the
   public brand (owner, 2026-10-28: "the public brand is Equity Uprise, not
   Human Uprise") and the company's platform, so the root's title and share
   card name Equity Uprise while the root stays company-first: canonical
   https://mccluster.org/, site name McCluster Corp, and a WebPage node
   that belongs to the company WebSite and is about the Organization. The
   company page itself, "What is McCluster Corp?", is /company, with
   robots.txt, sitemap.xml and llms.txt (PAGES, generated), and the
   company's news under /news/ (./news.js). Until P1 every other page
   answers exactly what it did before: a 301 to the same path and query
   where it is served, so shared links, printed QR codes and campaign links
   keep landing where they do now. */
import { PAGES, COMPANY_ORIGIN, PERSONAL_ORIGIN } from './pages.generated.js';
import { SITE, IDS, PROFILE_ORIGIN } from '../platform/hosts.generated.js';
import { createSiteRouter } from '../platform/router.js';
import { methodNotAllowed, SECURITY, wwwAliasOf } from '../world-host.js';
import { isNewsPath, newsroomResponse } from './news.js';

export const COMPANY_PAGE_PATH = '/company';

/* the company's pages load nothing but their own styles and the images the company generator names
   (PERSONAL_ORIGIN, the same module that writes them) */
const PAGE_HEADERS = {
  'cache-control': 'public, max-age=300',
  ...SECURITY,
  'content-security-policy': `default-src 'none'; img-src ${PERSONAL_ORIGIN}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
};

/* The World's head on the company host: company-first, stable @ids
   (data/seo/domain-architecture.json). The WebSite node itself is declared
   on /company with the Organization; the root only belongs to it. */
const WORLD_NAME = 'Equity Quantized · McCluster';
const WORLD_DESCRIPTION = 'Equity Quantized is McCluster Corp\'s movement platform: the World\'s globe, live context and member feed, where people find the movement and turn what they care about into verified action.';
const WORLD_NODE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${COMPANY_ORIGIN}/`,
  url: `${COMPANY_ORIGIN}/`,
  name: WORLD_NAME,
  description: WORLD_DESCRIPTION,
  isPartOf: { '@id': `${COMPANY_ORIGIN}/#website` },
  about: { '@id': IDS.organization },
  publisher: { '@id': IDS.organization }
});
/* properties.company.share_preview: "The root shares as Equity Uprise ·
   McCluster, site name McCluster Corp." The image is the supplied M mark,
   unaltered, until the owner supplies a 1200x630 company card
   (edge.activation_owner_steps). */
export const WORLD_SHARE = {
  title: WORLD_NAME,
  description: WORLD_DESCRIPTION,
  image: `${PROFILE_ORIGIN}/assets/img/m-mark.png`,
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

/* The same head written from a table alone: what WORLD_HEAD is for today's table (the router test holds them equal),
   and the platform's own head for a table whose platform is another origin (stage F) until P2 points the company
   generator at the record. */
export function worldHeadOf(site) {
  const node = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${site.platform.origin}/`,
    url: `${site.platform.origin}/`,
    name: WORLD_NAME,
    description: WORLD_DESCRIPTION,
    isPartOf: { '@id': site.platform.website_id },
    about: { '@id': site.ids.organization },
    publisher: { '@id': site.ids.organization }
  });
  return { origin: site.platform.origin, siteName: site.platform.site_name, share: WORLD_SHARE, extra: `<script type="application/ld+json">${node}</script>` };
}

/* What McCluster Corp answers itself, wherever the table puts its own paths (the platform today; its own tenant at
   stage F): the company page and the crawler files (GET and HEAD), and the company's news (./news.js). */
export const COMPANY_PARTS = Object.freeze({
  head(site = SITE) {
    return site.platform.origin === COMPANY_ORIGIN ? WORLD_HEAD : worldHeadOf(site);
  },
  async own(request, env = {}, fetchImpl = fetch) {
    const path = new URL(request.url).pathname;
    if (isNewsPath(path)) return newsroomResponse(request, env, fetchImpl);
    const page = Object.prototype.hasOwnProperty.call(PAGES, path) ? PAGES[path] : null;
    if (!page) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
    return new Response(request.method === 'HEAD' ? null : page.body, {
      status: 200,
      headers: { 'content-type': page.type, ...PAGE_HEADERS }
    });
  }
});

const companyRouter = createSiteRouter({ company: COMPANY_PARTS });

/* The platform host and its www door alone, through the host router; null for every other host (api.mccluster.org
   first of all), so the API is untouched. Worker mccluster itself runs the whole router (../entry-platform.js). */
export async function companySiteResponse(request, env = {}, fetchImpl = fetch) {
  const host = new URL(request.url).hostname.toLowerCase();
  const role = SITE.hostRole(host);
  const alias = wwwAliasOf(SITE, host);
  if (!(role && role.role === 'platform') && !(alias && alias.role === 'platform')) return null;
  return companyRouter(request, env, fetchImpl);
}
