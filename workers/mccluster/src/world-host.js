/* THE WORLD, SERVED ON A HOST OF ITS OWN.

   One Worker, by host. GitHub Pages holds one custom domain per repository
   (matthew.mccluster.org), where the World (mnet.html) and every file it
   loads actually live. A host that is the World's door (mccluster.org
   today; humanuprise.com when the owner routes it) rides this Worker: its
   router answers only its own hostnames and passes the World through from
   the personal origin with that host's own head. Everything the World
   opens rides the same way, so a member's session (per-origin
   localStorage) holds from the Earth to the mission dialog, the account
   and the governed support rail. Everything else is Matthew's property
   and gets a 301 to the same path on matthew.mccluster.org.

   NOT A MIRROR. Only the host's own documents are indexable; every other
   proxied page carries x-robots-tag: noindex. Nothing is rewritten beyond
   the World's head: no base tag, no link rewriting. Relative links resolve
   on the host and its router decides where each one lands. */

/* The World's own rooms, by exact path... */
export const WORLD_ROOMS = new Set([
  '/action-globe.html', // the Earth in the World's frame: same origin, for the postMessage bridge
  '/action-policy.html', '/world-news.html', '/create.html', '/give.html', '/privacy.html',
  '/account.html', '/login.html', '/forgot-password.html', '/reset-password.html', '/onboard.html',
  '/sw.js'
]);
/* ...and by prefix: the action rooms, the campaign funnel, the sign-in
   callback, and the static files every page loads. */
export const WORLD_PREFIXES = ['/action-network-', '/action/', '/auth/', '/js/', '/css/', '/assets/', '/data/', '/vendor/'];

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

/* THE HOST'S OWN HEADERS, on every answer.

   FRAMING. The World is framed on purpose: cross-origin by Matthew's
   property (js/world-audio-continuity.js keeps the playing music alive in
   the parent and opens https://mccluster.org/ in a frame), and by itself
   (mnet.html frames action-globe.html for the postMessage bridge). Those
   are the ancestors, exactly the origins that script trusts, and nobody
   else. frame-ancestors carries the list; the legacy x-frame-options is
   SAMEORIGIN, which a browser with CSP2 ignores once frame-ancestors is
   present. CAMERA, MICROPHONE, GEOLOCATION are the World's own (live
   missions, audio rooms, identity capture, the globe's Near me): this
   origin may ask, a cross-origin frame the World opens (a member's front
   page, a sign-in widget) may not. */
export const FRAME_ANCESTORS = ["'self'", 'https://matthew.mccluster.org', 'https://mccluster.org', 'https://www.mccluster.org', 'https://humanuprise.com', 'https://www.humanuprise.com'];
export const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': `frame-ancestors ${FRAME_ANCESTORS.join(' ')}`,
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=(self)'
};
/* THE WORLD'S CONTENT POLICY, REPORT-ONLY: what the World's documents
   actually load, seeded from the /internal/seek-first allowlist (index.js)
   and widened for the World. The browser logs what strays and enforces
   nothing; an enforced policy is a later, measured step. Cesium compiles
   WebAssembly and evaluates generated shader code, boots its workers from
   blob: and requests imagery (its own, NASA GIBS, OpenStreetMap) by XHR,
   so each tile host is in connect-src as well as img-src. Members' photos,
   post media and front pages come from anywhere over https. Sign-in is
   Google Identity on login.html; the bar's handoff and the feed talk to
   the API and to Supabase (REST, storage, realtime over wss). */
export const WORLD_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `frame-ancestors ${FRAME_ANCESTORS.join(' ')}`,
  "form-action 'self' https://api.mccluster.org https://zmnhbrjyhxzhkxmhkexs.supabase.co",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cesium.com https://accounts.google.com",
  "worker-src 'self' blob: https://cesium.com",
  "style-src 'self' 'unsafe-inline' https://cesium.com https://accounts.google.com",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' https:",
  "connect-src 'self' data: blob: https://api.mccluster.org https://matthew.mccluster.org https://mccluster.org https://humanuprise.com https://zmnhbrjyhxzhkxmhkexs.supabase.co wss://zmnhbrjyhxzhkxmhkexs.supabase.co https://accounts.google.com https://cesium.com https://*.cesium.com https://gibs.earthdata.nasa.gov https://tile.openstreetmap.org https://script.google.com https://vauntapi.flyvaunt.com",
  "manifest-src 'self'"
].join('; ');
/* headers the client may send upstream, and headers upstream may send back.
   content-encoding and content-length never pass: the runtime decodes the
   upstream body and sizes the one it sends. */
const UPSTREAM_REQUEST = ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range'];
const UPSTREAM_RESPONSE = ['content-type', 'cache-control', 'etag', 'last-modified', 'vary', 'accept-ranges', 'content-range'];

export function moved(location) {
  return new Response(null, { status: 301, headers: { location, 'cache-control': 'public, max-age=3600' } });
}
export function own(body, type) {
  return new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', ...SECURITY } });
}
export function isWorldRoom(path) {
  return WORLD_ROOMS.has(path) || WORLD_PREFIXES.some((p) => path.startsWith(p));
}
export function isDocument(path) {
  return path.endsWith('.html') || path.endsWith('/');
}
export function methodNotAllowed() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
}

/* The World's files are fetched from PUBLIC_ORIGIN, the personal origin the
   Worker already names (wrangler.toml); a test points that at a local
   server. */
export function upstreamOrigin(env, fallback) {
  return String((env && env.PUBLIC_ORIGIN) || fallback).replace(/\/$/, '');
}

export async function passThrough(request, upstream, fetchImpl, { root, noindex, head }) {
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
  /* the World's content policy, report-only, on its documents alone */
  if (/^text\/html/i.test(out.get('content-type') || '')) out.set('content-security-policy-report-only', WORLD_CSP_REPORT_ONLY);
  if (noindex) out.set('x-robots-tag', 'noindex');
  if (root && res.status === 200) {
    /* the body changes here, so the upstream validator does not describe it */
    out.delete('etag');
    out.set('cache-control', 'public, max-age=300');
    return new Response(request.method === 'HEAD' ? null : worldHeadFor(await res.text(), head), { status: 200, headers: out });
  }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
}
