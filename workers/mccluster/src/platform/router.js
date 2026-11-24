/* THE HOST ROUTER: one table, every host (SPEC-PLATFORM 2.4).

   Worker mccluster answers the site's hosts before the API. Which host is the platform, which are tenants and which are
   doors, what the World's rooms are and which pages live where come from one table, generated from
   data/seo/domain-architecture.json (./hosts.generated.js; tools/build-site-hosts.mjs). Nothing here names a host. The
   table's stage (the record's edge.now) decides what each host answers. With P0's table every host and path answers
   exactly as measured on 2026-11-23 (test/platform-router.test.mjs replays the measurement); the table that ships is P1's
   (test/platform-p1.test.mjs):

   - the platform (mccluster.org): the World at /, with the company's head; the World's rooms and the static files passed
     through from the static origin (rooms noindex); the company's own pages (the company page, its news, its crawler
     files); /index.html and /mnet.html 301 to /; every other path 301 to the same path where it is served today, query
     intact; plain http 301 to https. From P1 the platform serves every page at its path (the HERE front door at
     /index.html; World queries there still 301 to /), and profile_only pages (Whip Equipped, Matthew's separate
     company) answer 301 to his host; its manifest.json starts the app added from the platform where the table says
     (platform.app_start_path: the World, the owner's default of 2026-11-23). From P1 an address is read the way the
     static origin reads it before it is classified (addressOf): another spelling of a page (no .html, a doubled
     slash, an escaped letter, a directory without its slash) answers 301 to the page's own address, in one hop to
     wherever that address itself answers 301 (Whip Equipped's spellings to his host, the World's to its root); and a
     path the table does not name is passed through only as long as the static origin answers it with no document.
   - its www door: the apex's own paths to the apex, every other path to where it is served; from P1 every path to the
     platform, in one hop: straight to the platform's own 301 where it answers one.
   - a World door (humanuprise.com, inert until the owner routes it): the World on its own host with its own head, its
     rooms, its own robots.txt and sitemap; every other path to Matthew's host; from P1 (the owner's default of
     2026-11-23) every path 301 to the platform, in one hop as its www does. Its www door goes to it.
   - Matthew's host (a tenant whose origin is the static origin): before P3 it is not routed to this Worker, and if a
     request ever reached it, GitHub's answer passes untouched; from P3 his pages, Whip and the files pass to GitHub, the
     pages that moved and World queries answer 301 to the platform (at any spelling of their address), and a 404 stays a
     404.
   - a tenant with no origin of its own (stage F: mccluster.org, McCluster Corp's): its own pages, the files on both
     hosts, every other path 301 to where it is served.
   - a door a Cloudflare zone rule answers (here.mccluster.org), and every host that is not the site's: not this
     router's (null); the API answers below.

   The answer itself (the World's head, the company's pages, a door's crawler files) belongs to the files that render
   it: ../company-site/router.js (COMPANY_PARTS) and ../human-uprise/router.js (WORLD_DOOR_PARTS). The pass-through
   mechanics are ../world-host.js. Inside Worker mccluster, not a new Worker, store or identity. */
import { SITE } from './hosts.generated.js';
import { WORKER, moved, methodNotAllowed, upstreamOrigin, passThrough, originPass, isDocument, wwwAliasOf, worldDoors } from '../world-host.js';

const READS = new Set(['GET', 'HEAD']);
/* how long the edge keeps a document fetched from the static origin (SPEC-PLATFORM 2.4: "Documents may be cached at the
   edge for 60 s ... to win back most of the measured hop"; risk 12); static files keep the static origin's own caching */
export const DOCUMENT_CACHE_TTL = 60;
/* the page other people's sites frame: no frame restriction (SPEC-PLATFORM 2.4) */
const EMBED = '/embed.html';
/* the installed app's manifest (SPEC-PLATFORM 2.8): the same file on both hosts, its start the host's own */
const MANIFEST = '/manifest.json';
const fileName = (p) => /\.[^/]*$/.test(p);
/* a 301 to another address (the Worker answers it with ../world-host.js moved()) */
const to = (location) => ({ kind: 'moved', location });

/* THE ADDRESS AS THE STATIC ORIGIN READS IT. GitHub Pages decodes percent-escapes, reads repeated slashes as one and
   resolves dot segments; a name with no extension answers name.html when that file exists, else the directory name/
   (Measured live 2026-11-24 for the P1 review: /whip, //whip.html, /whip%2Ehtml and /%77hip.html all answer Whip
   Equipped's page; /Whip.html and /whip.html/ answer 404). The router reads a path the same way against the table
   before it classifies it, so another spelling of a page is that page. The answer is the page's own address, escaped
   where a path must be (RFC 3986 pchar) so it reads back as itself, or null for a path that cannot be decoded. */
const NOT_PCHAR = /[^A-Za-z0-9\-._~!$&'()*+,;=:@]/gu;
export function addressOf(site, path) {
  let decoded;
  try { decoded = decodeURIComponent(String(path)); } catch { return null; }
  const parts = decoded.split('/');
  const segments = [];
  for (const s of parts) {
    if (s === '' || s === '.') continue;
    if (s === '..') segments.pop();
    else segments.push(s);
  }
  const tail = parts[parts.length - 1];
  const directory = segments.length > 0 && (tail === '' || tail === '.' || tail === '..');
  let p = '/' + segments.join('/') + (directory ? '/' : '');
  if (segments.length && !directory && !fileName(p) && site.pageSet(p) === null && !site.ownPathOrigin(p)) {
    if (site.pageSet(p + '.html') !== null) p += '.html';
    else if (site.pageSet(p + '/') !== null) p += '/';
  }
  return p.split('/').map((s) => s.replace(NOT_PCHAR, (c) => encodeURIComponent(c))).join('/');
}
/* Whip Equipped's directories (the url_ownership.profile_only entries that are directories: /whip/ and its rooms):
   everything under them is his host's alone, its apps' scripts, manifests and images with its pages */
function underProfileOnly(site, path) {
  const p = site.cleanPath(path);
  return site.pages.profile_only.some((d) => d.slice(-1) === '/' && p.indexOf(d) === 0);
}
/* a path the table names on the platform: a page of a set it serves, a file on both hosts, the World's rooms and its
   static prefixes */
function named(site, path) {
  return site.pageSet(path) !== null || site.isBothHosts(path) || site.isWorldRoom(path);
}

function everything(site) {
  return site.switches.platform_serves === 'everything';
}
function hasWorldQuery(site, url) {
  return site.world.query_keys.some((k) => url.searchParams.has(k));
}
/* the framing class of a path served from the static origin */
function framingOf(site, path) {
  const p = site.cleanPath(path);
  if (p === EMBED) return 'anyone';
  if (site.tenants.some((t) => t.carry_path && t.carry_path === p)) return 'platform';
  return 'site';
}
function readOnly(method, route) {
  return READS.has(method) ? route : { kind: 'refused' };
}
/* a page a host generates itself, asked for with a trailing slash, has one address: /company/ -> /company (a subtree's
   own slash, /news/, is its own; a file name never has one) */
function slashless(site, path) {
  if (path.length < 2 || path.slice(-1) !== '/') return null;
  const p = path.slice(0, -1);
  if (fileName(p) || site.ownPathOrigin(path)) return null;
  const origin = site.ownPathOrigin(p);
  if (!origin) return null;
  const owner = origin === site.platform.origin ? site.platform : site.tenants.find((t) => t.origin === origin);
  return owner && owner.own_paths.generated.indexOf(p) !== -1 ? origin + p : null;
}

function platformRoute(site, url, method, read = false) {
  const P = site.platform;
  const path = url.pathname, q = url.search;
  if (url.protocol === 'http:') return to(P.origin + path + q);
  if (everything(site) && !read) {
    /* from P1 another spelling of an address answers 301 to the address itself, or in the same hop to wherever that
       address answers 301 (Whip Equipped's spellings to his host, the World's spellings to its root) */
    const address = addressOf(site, path);
    if (address !== null && address !== path) {
      const own = platformRoute(site, new URL(P.origin + address + q), method, true);
      return own.kind === 'moved' ? own : to(P.origin + address + q);
    }
  }
  const fold = slashless(site, path);
  if (fold) return to(fold + q);
  /* the World's document name is the root here, query and all; so is the old root document name until P1, and after it
     whenever the address asks for the World (?view=, ?mission=) */
  if (path === site.world.document) return to(P.origin + site.world.root + q);
  if (path === P.front_door_path && (!everything(site) || hasWorldQuery(site, url))) return to(P.origin + site.world.root + q);
  const owner = site.ownPathOrigin(path);
  if (owner === P.origin) return { kind: 'own', origin: P.origin, host: 'platform' };
  if (owner) return to(owner + path + q);
  if (path === site.world.root) return readOnly(method, { kind: 'world', origin: P.origin, head: 'platform' });
  if (!everything(site)) {
    /* P0, as today: the World's rooms and files ride this host, every other path goes where it is served */
    if (!site.isWorldRoom(path)) return to(site.servingOrigin(path) + path + q);
    return readOnly(method, { kind: 'pass', path, noindex: isDocument(path), framing: framingOf(site, path) });
  }
  if (site.pageSet(path) === 'profile_only' || underProfileOnly(site, path)) return to(site.profile.origin + path + q);
  /* the app added to a Home Screen from the platform is the platform's own app: its manifest starts where the table says */
  if (path === MANIFEST) return readOnly(method, { kind: 'pass', path, noindex: false, framing: framingOf(site, path), appStart: site.platform.app_start_path });
  /* a path the table does not name (a page that does not exist, a root file, an address that cannot be decoded) passes
     through only while the static origin answers it with no document: the platform serves no page the record does not
     name, so a spelling of a page the router could not read goes to Matthew's host (../world-host.js passThrough) */
  if (!named(site, path)) return readOnly(method, { kind: 'pass', path, noindex: false, framing: framingOf(site, path), unnamed: true });
  return readOnly(method, { kind: 'pass', path, noindex: false, framing: framingOf(site, path) });
}

/* A door to the platform answers in one hop: where the platform itself answers the address with a 301 (Whip Equipped to
   Matthew's host, the World's other addresses to its root, another spelling to its page, /company/ to /company), the
   door sends the visitor straight there; every other address to the same path and query on the platform. */
function toPlatform(site, url, method) {
  const there = site.platform.origin + url.pathname + url.search;
  const answer = platformRoute(site, new URL(there), method);
  return answer.kind === 'moved' ? answer : to(there);
}

function wwwRoute(site, url, method, alias, door) {
  const path = url.pathname, q = url.search;
  if (!everything(site) && alias.role === 'platform') {
    /* P0, as today: what the apex answers itself goes to the apex, every other path straight to where it is served */
    const P = site.platform;
    const fold = slashless(site, path);
    if (fold) return to(fold + q);
    const p = path === P.front_door_path ? site.world.root : path;
    const apex = p === site.world.root || p === site.world.document || site.ownPathOrigin(p) === P.origin || site.isWorldRoom(p);
    return to((apex ? P.origin + p : site.servingOrigin(path) + path) + q);
  }
  /* P0: the www of a World door goes to that door, as today */
  if (!everything(site) && alias.role === 'door') return to(alias.origin + path + q);
  if (door.to === 'platform') return toPlatform(site, url, method);
  return to(door.to_origin + path + q);
}

function worldDoorRoute(site, url, method, door, doorFiles) {
  const path = url.pathname, q = url.search;
  if (everything(site)) return toPlatform(site, url, method);
  if (url.protocol === 'http:') return to(door.origin + path + q);
  if (doorFiles.indexOf(path) !== -1) return { kind: 'door-file', origin: door.origin, path };
  if (path === site.world.document) return to(door.origin + site.world.root + q);
  if (path === site.world.root) return readOnly(method, { kind: 'world', origin: door.origin, head: 'door' });
  if (!site.isWorldRoom(path)) return to(site.profile.origin + path + q);
  return readOnly(method, { kind: 'pass', path, noindex: isDocument(path), framing: framingOf(site, path) });
}

function tenantRoute(site, url, method, tenant, headers, read = false) {
  const P = site.platform;
  const path = url.pathname, q = url.search;
  if (tenant.origin === P.static_origin) {
    /* Matthew's host: GitHub answers it until the owner routes it (P3) */
    if (!site.switches.profile_host_routed) return { kind: 'origin', classes: false };
    /* the platform fetching its static files from another zone (stage F) names its zone in CF-Worker: never redirected,
       or a platform page would 301 back to the platform and loop (a forged header only fetches a public file) */
    const caller = headers && typeof headers.get === 'function' ? String(headers.get('cf-worker') || '').toLowerCase() : '';
    if (caller && site.site_hosts.indexOf(caller) !== -1) return { kind: 'origin', classes: false };
    if (site.ownPathOrigin(path) === tenant.origin) return { kind: 'own', origin: tenant.origin, host: 'tenant' };
    /* another spelling of a page that moved, or of the World's addresses, answers as its own address does; his own pages
       and Whip keep answering from GitHub at any spelling it reads, as before */
    const address = read ? path : addressOf(site, path);
    if (address !== null && address !== path) {
      const own = tenantRoute(site, new URL(tenant.origin + address + q), method, tenant, headers, true);
      if (own.kind === 'moved') return own;
    }
    if (path === site.world.document) return to(P.origin + site.world.root + q);
    if (site.cleanPath(path) === tenant.root_path && hasWorldQuery(site, url)) return to(P.origin + site.world.root + q);
    /* the files, embed.html, the carry page and certificate renewal answer on both hosts, never 301 */
    if (site.isBothHosts(path)) return { kind: 'origin', classes: true, framing: framingOf(site, path) };
    if (site.pageSet(path) === 'platform') return to(P.origin + path + q);
    return { kind: 'origin', classes: true, framing: framingOf(site, path) };
  }
  /* a tenant this Worker answers alone (stage F: mccluster.org) */
  if (url.protocol === 'http:') return to(tenant.origin + path + q);
  const fold = slashless(site, path);
  if (fold) return to(fold + q);
  const owner = site.ownPathOrigin(path);
  if (owner === tenant.origin) return { kind: 'own', origin: tenant.origin, host: 'tenant' };
  if (owner) return to(owner + path + q);
  if (path === site.world.document) return to(P.origin + site.world.root + q);
  if (site.isBothHosts(path)) return readOnly(method, { kind: 'pass', path, noindex: false, framing: framingOf(site, path) });
  return to(site.servingOrigin(path) + path + q);
}

/* What the Worker answers for a URL on one of the site's hosts, or null when the host is not the router's. */
export function routeFor(site, url, { method = 'GET', headers = null, doorFiles = [] } = {}) {
  const host = url.hostname.toLowerCase();
  const role = site.hostRole(host);
  if (!role) return null;
  if (role.role === 'platform') return platformRoute(site, url, method);
  if (role.role === 'tenant') return tenantRoute(site, url, method, site.tenants.find((t) => t.host === host), headers);
  const door = site.doors.find((d) => d.host === host);
  if (door.served_by !== WORKER) return null;
  const alias = wwwAliasOf(site, host);
  if (alias) return wwwRoute(site, url, method, alias, door);
  if (worldDoors(site).indexOf(door) !== -1) return worldDoorRoute(site, url, method, door, doorFiles);
  return to(door.to_origin + url.pathname + url.search);
}

/* The router as Worker mccluster runs it: `company` answers McCluster Corp's own pages and the platform's World head
   (../company-site/router.js), `worldDoor` a World door's head and crawler files (../human-uprise/router.js). A route
   whose answerer is missing is not this router's (null). */
export function createSiteRouter({ site = SITE, company = null, worldDoor = null } = {}) {
  return async function siteResponse(request, env = {}, fetchImpl = fetch) {
    const url = new URL(request.url);
    const r = routeFor(site, url, { method: request.method, headers: request.headers, doorFiles: worldDoor ? worldDoor.paths : [] });
    if (!r) return null;
    const statics = upstreamOrigin(env, site.platform.static_origin);
    switch (r.kind) {
      case 'moved':
        return moved(r.location);
      case 'refused':
        return methodNotAllowed();
      case 'own': {
        if (!company) return null;
        const page = await company.own(request, env, fetchImpl, site);
        return page || new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      }
      case 'door-file':
        return worldDoor ? worldDoor.file(r.path, r.origin, site) : null;
      case 'world': {
        const head = r.head === 'platform' ? (company && company.head(site)) : (worldDoor && worldDoor.head(r.origin, site));
        if (!head) return null;
        return passThrough(request, `${statics}${site.world.document}${url.search}`, fetchImpl, { root: true, head, site, cacheTtl: DOCUMENT_CACHE_TTL });
      }
      case 'pass':
        return passThrough(request, `${statics}${url.pathname}${url.search}`, fetchImpl, {
          noindex: r.noindex, site, framing: r.framing, appStart: r.appStart || null,
          /* a path the table does not name: never answered with a document here (Matthew's host answers it, as before P1) */
          elsewhere: r.unnamed ? site.profile.origin + url.pathname + url.search : null,
          /* the documents the table names, the carry page aside, are kept at the edge a minute (SPEC-PLATFORM 2.4, risk 12) */
          cacheTtl: !r.unnamed && r.framing !== 'platform' && isDocument(url.pathname) ? DOCUMENT_CACHE_TTL : 0
        });
      case 'origin':
        return originPass(request, `${statics}${url.pathname}${url.search}`, fetchImpl, { site, classes: r.classes, framing: r.framing });
      default:
        return null;
    }
  };
}
