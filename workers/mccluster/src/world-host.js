/* THE WORLD, SERVED ON A HOST OF ITS OWN: the mechanics the host router uses (./platform/router.js).

   One Worker, by host. GitHub Pages holds one custom domain per repository
   (the profile host), where the World (mnet.html) and every file it loads
   actually live: the table calls it the static origin
   (./platform/hosts.generated.js, from data/seo/domain-architecture.json).
   A host that serves the World (the platform; a World door such as
   humanuprise.com when the owner routes it) passes it through from the
   static origin with that host's own head. Everything the World opens rides
   the same way, so a member's session (per-origin localStorage) holds from
   the Earth to the mission dialog, the account and the governed support
   rail. Which paths ride and which answer 301 is the router's, by stage.

   NOT A MIRROR. Nothing is rewritten beyond the World's head: no base tag,
   no link rewriting. Relative links resolve on the host and its router
   decides where each one lands. An upstream redirect is never followed: a
   Location on the static origin is handed back on the requesting host
   (GitHub answers /engineering and /action with an absolute 301 to its own
   host; following it served a directory at a slashless address). */
import { SITE } from './platform/hosts.generated.js';

/* The World's own rooms, by exact path and by prefix: the table's world.rooms and world.room_prefixes */
export const WORLD_ROOMS = new Set(SITE.world.rooms);
export const WORLD_PREFIXES = SITE.world.room_prefixes;
/* the label the table gives a door that rides this Worker (the other kind is a Cloudflare zone redirect rule) */
export const WORKER = 'worker:mccluster';

const NOINDEX_META = /<meta name="robots" content="noindex">/;

const TITLE = /<title>[^<]*<\/title>/;
const DESCRIPTION_META = /<meta name="description" content="[^"]*">/;
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The World's head on a host of its own. On Matthew's site mnet.html is
   noindex (the member network is not a search landing there); on its own
   host it is the front door, so the noindex gives way to that host's
   canonical, og:url and site name, plus any node the host adds.

   A host that names its own share preview (`share`) also gets its own
   <title> and description in place of mnet.html's, which were written for
   a noindex page on Matthew's site, and the Open Graph and Twitter tags a
   link preview reads. The image is the owner's supplied artwork, named by
   URL and never altered. */
export function worldHeadFor(html, { origin, siteName, extra = '', share = null }) {
  const tags = [
    `<link rel="canonical" href="${origin}/">`,
    `<meta property="og:url" content="${origin}/">`,
    `<meta property="og:site_name" content="${attr(siteName)}">`
  ];
  let out = html;
  if (share) {
    out = out.replace(TITLE, `<title>${attr(share.title)}</title>`);
    const desc = `<meta name="description" content="${attr(share.description)}">`;
    if (DESCRIPTION_META.test(out)) out = out.replace(DESCRIPTION_META, desc);
    else tags.unshift(desc);
    tags.push(
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${attr(share.title)}">`,
      `<meta property="og:description" content="${attr(share.description)}">`,
      `<meta property="og:image" content="${attr(share.image)}">`
    );
    if (share.imageWidth) tags.push(`<meta property="og:image:width" content="${share.imageWidth}">`);
    if (share.imageHeight) tags.push(`<meta property="og:image:height" content="${share.imageHeight}">`);
    if (share.imageAlt) tags.push(`<meta property="og:image:alt" content="${attr(share.imageAlt)}">`);
    tags.push(
      `<meta name="twitter:card" content="summary">`,
      `<meta name="twitter:title" content="${attr(share.title)}">`,
      `<meta name="twitter:description" content="${attr(share.description)}">`,
      `<meta name="twitter:image" content="${attr(share.image)}">`
    );
  }
  const head = tags.concat(extra ? [extra] : []).join('\n  ');
  if (NOINDEX_META.test(out)) return out.replace(NOINDEX_META, head);
  return out.replace('</title>', '</title>\n  ' + head);
}

/* ---------- the site's hosts, read from the table ---------- */

/* a door named www.<host> for another host of the site (the platform, a tenant or a door): what it is the www of */
export function wwwAliasOf(site, host) {
  const h = String(host == null ? '' : host).toLowerCase();
  if (h.indexOf('www.') !== 0) return null;
  const base = h.slice(4);
  if (base === site.platform.host) return { role: 'platform', host: base, origin: site.platform.origin };
  const tenant = site.tenants.find((t) => t.host === base);
  if (tenant) return { role: 'tenant', host: base, origin: tenant.origin, tenant };
  const door = site.doors.find((d) => d.host === base);
  if (door) return { role: 'door', host: base, origin: door.origin, door };
  return null;
}

/* the doors that serve the World on a host of their own (humanuprise.com, once routed): riding this Worker, pointing at
   the platform, a World host, and not the www name of another host */
export function worldDoors(site) {
  return site.doors.filter((d) => d.served_by === WORKER && d.to === 'platform' && site.isWorldHost(d.host) && !wwwAliasOf(site, d.host));
}

/* THE HOST'S OWN HEADERS, on every answer.

   FRAMING. The World is framed on purpose: cross-origin by Matthew's
   property (js/world-audio-continuity.js keeps the playing music alive in
   the parent and opens the World in a frame), and by itself (mnet.html
   frames action-globe.html for the postMessage bridge). Those are the
   ancestors, the table's frame_ancestors ('self' and the site's origins),
   and nobody else. frame-ancestors carries the list; the legacy
   x-frame-options is SAMEORIGIN, which a browser with CSP2 ignores once
   frame-ancestors is present. CAMERA, MICROPHONE, GEOLOCATION are the
   World's own (live missions, audio rooms, identity capture, the globe's
   Near me): this origin may ask, a cross-origin frame the World opens (a
   member's front page, a sign-in widget) may not. */
export function securityHeaders(site = SITE) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=31536000',
    'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': `frame-ancestors ${site.frame_ancestors.join(' ')}`,
    'permissions-policy': 'camera=(self), microphone=(self), geolocation=(self)'
  };
}
export const FRAME_ANCESTORS = SITE.frame_ancestors;
export const SECURITY = securityHeaders(SITE);

/* THE WORLD'S CONTENT POLICY, REPORT-ONLY: what the World's documents
   actually load, seeded from the /internal/seek-first allowlist (index.js)
   and widened for the World. The browser logs what strays and enforces
   nothing; an enforced policy is a later, measured step. Cesium compiles
   WebAssembly and evaluates generated shader code, boots its workers from
   blob: and requests imagery (its own, NASA GIBS, OpenStreetMap) by XHR,
   so each tile host is in connect-src as well as img-src. Members' photos,
   post media and front pages come from anywhere over https. Sign-in is
   Google Identity on login.html; the bar's handoff and the feed talk to
   the API, to Supabase (REST, storage, realtime over wss) and to the site's
   own hosts: every tenant, the platform and every door that serves the World
   itself (never a www name, which only redirects). */
export function worldCspReportOnly(site = SITE) {
  const own = [...site.tenants.map((t) => t.origin), site.platform.origin, ...worldDoors(site).map((d) => d.origin)];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${site.frame_ancestors.join(' ')}`,
    "form-action 'self' https://api.mccluster.org https://zmnhbrjyhxzhkxmhkexs.supabase.co",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cesium.com https://accounts.google.com",
    "worker-src 'self' blob: https://cesium.com",
    "style-src 'self' 'unsafe-inline' https://cesium.com https://accounts.google.com",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "frame-src 'self' https:",
    `connect-src 'self' data: blob: https://api.mccluster.org ${own.join(' ')} https://zmnhbrjyhxzhkxmhkexs.supabase.co wss://zmnhbrjyhxzhkxmhkexs.supabase.co https://accounts.google.com https://cesium.com https://*.cesium.com https://gibs.earthdata.nasa.gov https://tile.openstreetmap.org https://script.google.com https://vauntapi.flyvaunt.com`,
    "manifest-src 'self'"
  ].join('; ');
}
export const WORLD_CSP_REPORT_ONLY = worldCspReportOnly(SITE);

/* headers the client may send upstream, and headers upstream may send back.
   content-encoding and content-length never pass: the runtime decodes the
   upstream body and sizes the one it sends. */
const UPSTREAM_REQUEST = ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range'];
const UPSTREAM_RESPONSE = ['content-type', 'cache-control', 'etag', 'last-modified', 'vary', 'accept-ranges', 'content-range'];
/* the statuses that move a browser (a 304 is a validator's answer, not a move) */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function moved(location) {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } });
}
export function own(body, type, site = SITE) {
  return new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', ...securityHeaders(site) } });
}
export function isWorldRoom(path) {
  return SITE.isWorldRoom(path);
}
export function isDocument(path) {
  return path.endsWith('.html') || path.endsWith('/');
}
export function methodNotAllowed() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
}
/* the static origin answered with something this Worker will not hand on (a redirect back to the very address asked
   for, or any redirect of the World's own document): an honest 502, never a loop in the visitor's browser */
function upstreamRefused() {
  return new Response('The static origin answered with a redirect this host will not follow.', {
    status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/* The World's files are fetched from PUBLIC_ORIGIN (wrangler.toml), the
   static origin the table names (platform.static_origin); a test points it
   at a local server. */
export function upstreamOrigin(env, fallback = SITE.platform.static_origin) {
  return String((env && env.PUBLIC_ORIGIN) || fallback).replace(/\/$/, '');
}

/* A Location the static origin answered with, as the requesting host hands it on: one on the static origin (absolute, or
   relative to the upstream address) is the same path on the requesting host; any other is handed on as it is. The
   requesting origin is joined as text, so a path that starts with // can never turn into another host. */
export function relocate(location, upstream, requestUrl, site = SITE) {
  if (!location) return null;
  let target;
  try { target = new URL(location, upstream); } catch { return null; }
  if (target.origin === new URL(upstream).origin || target.origin === site.platform.static_origin) {
    return new URL(requestUrl).origin + target.pathname + target.search + target.hash;
  }
  return target.href;
}

/* The framing a page answers with, by class (SPEC-PLATFORM 2.4): the site's own ancestors for documents and files
   ('site'), anyone for embed.html, which other people's sites frame ('anyone'), the platform alone for the carry page
   ('platform'). */
function frame(out, framing, site) {
  if (framing === 'anyone') {
    out.set('content-security-policy', 'frame-ancestors *');
    out.delete('x-frame-options');
  } else if (framing === 'platform') {
    out.set('content-security-policy', `frame-ancestors ${site.platform.origin}`);
    out.delete('x-frame-options');
  }
}

/* A pass-through from the static origin: the client's safe headers up, the upstream's safe headers back, the host's
   own security headers, and, on the World's root, the host's head. */
export async function passThrough(request, upstream, fetchImpl, { root = false, noindex = false, head = null, site = SITE, framing = 'site' } = {}) {
  const headers = new Headers();
  for (const h of UPSTREAM_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = await fetchImpl(new Request(upstream, { method: request.method, headers, redirect: 'manual' }));
  const out = new Headers(securityHeaders(site));
  for (const h of UPSTREAM_RESPONSE) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (REDIRECTS.has(res.status) && res.headers.get('location')) {
    /* the World's document never moves; any other redirect is handed back on this host, and never to itself */
    if (root) return upstreamRefused();
    const location = relocate(res.headers.get('location'), upstream, request.url, site);
    if (!location || new URL(location).href === new URL(request.url).href) return upstreamRefused();
    out.set('location', location);
    frame(out, framing, site);
    return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
  }
  /* the World's content policy, report-only, on the site's own documents alone */
  if (framing === 'site' && /^text\/html/i.test(out.get('content-type') || '')) out.set('content-security-policy-report-only', worldCspReportOnly(site));
  if (noindex) out.set('x-robots-tag', 'noindex');
  frame(out, framing, site);
  if (root && res.status === 200) {
    /* the body changes here, so the upstream validator does not describe it */
    out.delete('etag');
    out.set('cache-control', 'public, max-age=300');
    return new Response(request.method === 'HEAD' ? null : worldHeadFor(await res.text(), head), { status: 200, headers: out });
  }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
}

/* A host whose own origin is the static origin (Matthew's, once routed): the request goes to its origin as it came (a
   same-zone fetch skips Workers routes and reaches GitHub Pages), never following a redirect, and the answer comes back
   with GitHub's own headers. `classes` adds the framing of its class (documents the site's ancestors, embed.html anyone,
   the carry page the platform); without it the answer is untouched. */
export async function originPass(request, target, fetchImpl, { site = SITE, classes = false, framing = 'site' } = {}) {
  const read = request.method === 'GET' || request.method === 'HEAD';
  const res = await fetchImpl(new Request(target, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
    ...(read ? {} : { body: request.body, duplex: 'half' })
  }));
  if (!classes) return res;
  const out = new Headers(res.headers);
  if (framing !== 'site') frame(out, framing, site);
  else if (!REDIRECTS.has(res.status) && /^text\/html/i.test(out.get('content-type') || '')) {
    for (const [k, v] of Object.entries(securityHeaders(site))) out.set(k, v);
  }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
}
