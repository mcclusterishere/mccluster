/* The World on its legacy-named door (humanuprise.com today): the door's own head and crawler files. The host, this
   file and HUMAN_UPRISE_ORIGIN keep the old name for compatibility. Owner, 2026-10-28: "the public brand is Equity
   Uprise, not Human Uprise", so what the door serves names Equity Uprise (og:site_name).

   Owner, 2026-10-14: "I want to have the globe experience as its own solo
   experience ... but it needs to be interconnected with all the systems."
   The door is McCluster Corp's: the same entity as the platform, not a
   third one (docs/control-plane/DOMAINS-AND-ENTITIES.md).

   ONE WORKER, BY HOST. Which host is a door and what it answers at each stage is the host router's
   (../platform/router.js), read from the generated table (../platform/hosts.generated.js,
   data/seo/domain-architecture.json): a World door is a door that rides this Worker, points at the platform, is a
   World host and is not the www name of another host. INERT UNTIL ROUTED: until the owner adds the Workers Route for
   the door this code never runs. Until P1 the door serves the World by host: `/` is mnet.html with the door's own
   canonical, the World's rooms and files pass through (noindex on the documents), its robots.txt and one-line sitemap
   are its own, and every other path answers 301 to Matthew's host. From P1 (the owner's default of 2026-11-23) the door
   answers 301 to the platform, same path and query, in one hop: where the platform itself answers the address with a
   301, the door sends the visitor straight there. */
import { SITE } from '../platform/hosts.generated.js';
import { createSiteRouter } from '../platform/router.js';
import { worldHeadFor, own, wwwAliasOf, worldDoors } from '../world-host.js';

export const HUMAN_UPRISE_ORIGIN = (worldDoors(SITE)[0] || {}).origin;

const robotsFor = (origin) => `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
const sitemapFor = (origin) => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  `  <url><loc>${origin}/</loc></url>\n` +
  '</urlset>\n';

/* The World's head on a door: the World's front door there, so the noindex gives way to the door's canonical
   (../world-host.js). */
const headFor = (origin) => ({ origin, siteName: 'Equity Uprise' });
export function worldHead(html) {
  return worldHeadFor(html, headFor(HUMAN_UPRISE_ORIGIN));
}

/* What a World door answers itself: its head, and its robots.txt and sitemap, naming the door. */
export const WORLD_DOOR_PARTS = Object.freeze({
  paths: Object.freeze(['/robots.txt', '/sitemap.xml']),
  head(origin) {
    return headFor(origin);
  },
  file(path, origin, site = SITE) {
    if (path === '/robots.txt') return own(robotsFor(origin), 'text/plain; charset=utf-8', site);
    return own(sitemapFor(origin), 'application/xml; charset=utf-8', site);
  }
});

const doorRouter = createSiteRouter({ worldDoor: WORLD_DOOR_PARTS });

/* A World door and its www door alone, through the host router; null for every other host, so the API is untouched.
   Worker mccluster itself runs the whole router (../entry-platform.js). */
export async function humanUpriseResponse(request, env = {}, fetchImpl = fetch) {
  const host = new URL(request.url).hostname.toLowerCase();
  const alias = wwwAliasOf(SITE, host);
  const doors = worldDoors(SITE).map((d) => d.host);
  if (doors.indexOf(host) === -1 && !(alias && alias.role === 'door' && doors.indexOf(alias.host) !== -1)) return null;
  return doorRouter(request, env, fetchImpl);
}
