/* HUMAN UPRISE'S OWN DOOR, AND THE BAR ACROSS HOSTS.

   Owner, 2026-10-14: "I want to have the globe experience as its own solo
   experience ... but it needs to be interconnected with all the systems so
   that if someone goes into the music tab and clicks for example McCluster,
   it'll go to my website ... if they go into music and they select one
   individual, they should be able to go to their front page and experience
   the site from their perspective just like they experience the site from
   my perspective."

   Three things, pinned here:
   - the World is served on humanuprise.com by the one Worker, by host,
     inert until the owner routes it (the Worker's own tests cover the
     routing; this file pins the pieces on this side of the edge);
   - the bar is the same Music | M | Globe on either host: Music and the M
     are Matthew's site, the Globe is the World's own door;
   - a creator's front page puts that creator in the middle of the bar for
     the session, with their own picture or initial, never a drawn mark,
     and McCluster in Music opens the house.
   Browser evidence: scripts/e2e/human-uprise-door.e2e.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('the bar knows the World\'s own host and keeps today\'s behaviour until the owner flips it', async () => {
  const bar = await read('js/tabbar.js');
  assert.match(bar, /var HU_HOSTS = \["humanuprise\.com", "www\.humanuprise\.com"\];/);
  assert.match(bar, /var ON_HU = HU_HOSTS\.indexOf\(String\(location\.hostname\)\.toLowerCase\(\)\) !== -1;/);
  assert.match(bar, /var HOUSE_ORIGIN = "https:\/\/matthew\.mccluster\.org\/";/);
  assert.match(bar, /var WORLD_ORIGIN = "";/, 'empty keeps the World on this origin: the live site today');
  assert.match(bar, /var HOUSE = ON_HU \? HOUSE_ORIGIN : ROOT;/, 'standing on the World\'s host, Matthew\'s rooms are his site');
  assert.match(bar, /var WORLD = ON_HU \? ROOT : \(WORLD_ORIGIN \|\| ROOT\);/);
  assert.match(bar, /function worldAt\(query\) \{ return \(ON_HU \|\| WORLD_ORIGIN \? WORLD : WORLD \+ "mnet\.html"\) \+ \(query \|\| ""\); \}/,
    'the World is the root of its own host, mnet.html elsewhere');
  /* the three cells: Music and the M against the house, the Globe against the World */
  assert.match(bar, /href="' \+ HOUSE \+ 'listen\.html" data-appnav="music"/);
  assert.match(bar, /href="' \+ HOUSE \+ 'index\.html" data-appnav="home"/);
  assert.match(bar, /href="' \+ WORLD \+ 'mnet\.html\?view=feed" data-appnav="world"/);
  assert.match(bar, /src="' \+ ROOT \+ 'assets\/img\/m-mark\.png"/, 'static files come from the page\'s own host');
  assert.match(bar, /worldTab\.href = worldAt\("\?view=feed"\);/);
  /* the wings resolve the same way; the account stays on the page's own host */
  assert.match(bar, /function resolveRoom\(wing, path\) \{\n    if \(path === MAP\) return MAP;\n    if \(path\.indexOf\("mnet\.html"\) === 0\) return worldAt\(path\.slice\("mnet\.html"\.length\)\);\n    return \(wing === "world" \? ROOT : HOUSE\) \+ path;\n  \}/);
  assert.doesNotMatch(bar, /ROOT \+ "mnet\.html/, 'no World door bypasses worldAt');
  /* on the World's host, the root lights the Globe, not the M */
  assert.match(bar, /if \(ON_HU && \(PAGE_KEY === "" \|\| PAGE_KEY === "index\.html"\)\) PAGE_KEY = "mnet\.html";/);
});

test('a creator\'s front page puts the creator in the middle of the bar, with their own picture or initial', async () => {
  const bar = await read('js/tabbar.js');
  assert.match(bar, /var PERSPECTIVE_KEY = "mcc_perspective";/);
  assert.match(bar, /window\.addEventListener\("mcc:perspective", function \(e\) \{ setPerspective\(e\.detail\); \}\);/);
  assert.match(bar, /var HANDLE_RE = \/\^\[a-z0-9\]\[a-z0-9\._-\]\{2,39\}\$\/;/, 'a handle is validated before it becomes a link');
  assert.match(bar, /if \(u\.protocol === "https:"\) avatar = u\.href;/, 'only an https picture is painted');
  assert.match(bar, /var door = HOUSE \+ "music-creator\.html\?handle=" \+ encodeURIComponent\(p\.handle\);/);
  assert.match(bar, /<img class="appbar__m appbar__m--creator" src="' \+ attrOf\(p\.avatar\) \+ '" alt="">/);
  assert.match(bar, /<span class="appbar__m appbar__m--initial" aria-hidden="true">' \+ textOf\(initialOf\(p\.name\)\) \+ "<\/span>/);
  assert.match(bar, /homeTab\.setAttribute\("data-perspective", p\.handle\);/);
  /* the house is one hold away: the M as supplied, beside Everything */
  assert.match(bar, /mmark: \["assets\/img\/m-mark\.png", "appbar__m"\],/);
  assert.match(bar, /WINGS\.home\.slots\[0\] = \[HOUSE \+ "index\.html", "mmark", "McCluster",/);
  /* Matthew's front door lets the perspective go */
  assert.match(bar, /var PERSPECTIVE = AT_HOUSE \? null : readPerspective\(\);\n  if \(AT_HOUSE\) storePerspective\(null\);/);
  assert.match(bar, /perspective: function \(p\) \{ return arguments\.length \? setPerspective\(p\) : PERSPECTIVE; \},/);
  /* the painted bar is what a held wing comes back to */
  assert.match(bar, /paintPerspective\(\);\n    HOME_BAR = dock\.innerHTML;/);
  assert.match(bar, /paintPerspective\(\);\n    \/\* Exactly three columns/, 'sign-in state repaints the middle cell through the perspective');

  const page = await read('js/music-creator-profile.js');
  assert.match(page, /var perspective = \{ handle: p\.handle, name: p\.artist_name, avatar: avatar \|\| "" \};/);
  assert.match(page, /root\.sessionStorage\.setItem\("mcc_perspective", JSON\.stringify\(perspective\)\)/);
  assert.match(page, /root\.dispatchEvent\(new CustomEvent\("mcc:perspective", \{ detail: perspective \}\)\)/);
  const i = page.indexOf('var avatar = PAGE.safeArtwork(p.avatar_url);'), j = page.indexOf('var perspective = {');
  assert.ok(i > 0 && j > i, 'the picture the bar gets is the one the page already vetted');

  const css = await read('css/style.css');
  assert.match(css, /\.appbar__m--creator\{border-radius:50%;object-fit:cover;/);
  assert.match(css, /\.appbar__m--initial\{display:grid;place-items:center;border-radius:50%;/);
  assert.match(css, /html\[data-theme="light"\] \.appbar__tab\[data-appnav="home"\] \.appbar__m--creator,html\[data-theme="light"\] \.appbar__tab\[data-appnav="home"\] \.appbar__m--initial\{content:normal\}/,
    'the light coat swaps the M for its dark file, never a creator\'s picture');
});

test('in Music, McCluster opens the house and every artist opens their own front page', async () => {
  const music = await read('js/music-community.js');
  assert.match(music, /function paintArtists\(profiles\)/);
  assert.match(music, /paintArtists\(\[\]\);\n\n  Promise\.all\(/, 'the house is painted before the directory answers');
  assert.match(music, /paintArtists\(all\[1\] \|\| \[\]\);/);
  assert.match(music, /<a class="artist artist--house" href="index\.html" aria-label="McCluster: the house">/);
  assert.match(music, /<img class="artist__pic artist__pic--house" src="assets\/img\/m-mark\.png" alt="" width="56" height="56">/, 'the M as supplied');
  assert.match(music, /href="music-creator\.html\?handle=' \+ encodeURIComponent\(p\.handle\) \+ '"/);
  assert.match(music, /var ARTWORK = SB \+ "\/storage\/v1\/object\/public\/creator-artwork\/";/, 'a creator\'s picture is the one Creator Studio stored, the creator page\'s own rule');
  assert.match(music, /var avatar = safeArtwork\(p\.avatar_url\);/);
  assert.match(music, /<span class="artist__pic artist__pic--initial" aria-hidden="true">' \+ esc\(initialOf\(name\)\) \+ '<\/span>/);
  const house = music.indexOf('artist--house'), creators = music.indexOf('(profiles || []).forEach');
  assert.ok(house > 0 && creators > house, 'the house is first');
  const css = await read('css/music-room.css');
  assert.match(css, /\.artists__row \{ display: flex; gap: 0\.9rem; overflow-x: auto;/);
  assert.match(css, /\.artist__pic--house \{ border-radius: 0; background: none; box-shadow: none; object-fit: contain; \}/, 'no plate under the M');
  assert.match(css, /\.artist \{ flex: none; width: 4\.6rem; min-width: 0;/);
});

test('the Worker answers the World\'s host: the router is wired by host and its origins may call the API', async () => {
  const entry = await read('workers/mccluster/src/entry-platform.js');
  assert.match(entry, /import \{ humanUpriseResponse \} from '\.\/human-uprise\/router\.js';/);
  const http = await read('workers/mccluster/src/lib/http.js');
  assert.match(http, /'https:\/\/humanuprise\.com',\n  'https:\/\/www\.humanuprise\.com',/);
  const wrangler = await read('workers/mccluster/wrangler.toml');
  assert.match(wrangler, /ALLOWED_ORIGINS = "https:\/\/matthew\.mccluster\.org,https:\/\/mccluster\.org,https:\/\/humanuprise\.com,https:\/\/www\.humanuprise\.com,/);
  const router = await read('workers/mccluster/src/human-uprise/router.js');
  assert.match(router, /export const HUMAN_UPRISE_ORIGIN = 'https:\/\/humanuprise\.com';/);
  assert.match(router, /if \(host !== APEX && host !== WWW\) return null;/, 'inert for every other host');
  assert.doesNotMatch(router, /mccluster-core/, 'no second Worker');
});

test('the authorities name the host: three hosts, still two entities, one Worker, inert until routed', async () => {
  const entry = await read('docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md');
  assert.match(entry, /## Production domain: `humanuprise\.com` \(built; inert until the owner routes it\)/);
  assert.match(entry, /workers\/mccluster\/src\/human-uprise\/router\.js/);
  assert.match(entry, /Supabase Auth → URL configuration: add `https:\/\/humanuprise\.com\/auth\/`/, 'the owner\'s sign-in step is written down');
  assert.match(entry, /set `WORLD_ORIGIN = "https:\/\/humanuprise\.com\/"` in `js\/tabbar\.js`/, 'the flip is the last step, after routing');
  assert.match(entry, /\*\*One M Account, every host\.\*\* A session is per origin/);
  const domains = await read('docs/control-plane/DOMAINS-AND-ENTITIES.md');
  assert.match(domains, /## Human Uprise's host: `humanuprise\.com`/);
  assert.match(domains, /Three hosts, still two entities\./);
  const arch = JSON.parse(await read('data/seo/domain-architecture.json'));
  assert.equal(arch.properties.human_uprise.origin, 'https://humanuprise.com');
  assert.equal(arch.properties.human_uprise.entity, 'https://matthew.mccluster.org/#mccluster-corp', 'the host is McCluster Corp\'s, never a third entity');
  assert.equal(arch.properties.human_uprise.owner, 'mccluster_corp');
  assert.match(arch.properties.human_uprise.served_by, /^Worker mccluster, host-routed/);
  assert.equal(arch.properties.company.origin, 'https://mccluster.org', 'the two properties are untouched');
  assert.equal(arch.properties.personal.origin, 'https://matthew.mccluster.org');
  const canon = JSON.parse(await read('docs/control-plane/canonical-architecture.json'));
  assert.equal(canon.public_properties.human_uprise.served_by, 'worker:mccluster', 'no second Worker');
  assert.equal(canon.public_properties.human_uprise.entity, canon.public_properties.company.entity);
  assert.match(await read('AGENTS.md'), /Three hosts, still two entities:/);
  assert.match(await read('CLAUDE.md'), /`https:\/\/humanuprise\.com` is Human Uprise's own door to the World, a \*\*McCluster Corp\*\* host/);
  assert.match(await read('docs/action-network/HUMAN-UPRISE-WORLD-FEED.md'), /### The World's own door: `humanuprise\.com`[\s\S]*### A creator's perspective/);
});

test('one M Account, every host: the bar carries the sign-in across and the arriving page earns its own session', async () => {
  const bar = await read('js/tabbar.js');
  assert.match(bar, /var ECOSYSTEM = \[HOUSE_ORIGIN\.replace\(\/\\\/\$\/, ""\), "https:\/\/humanuprise\.com", "https:\/\/www\.humanuprise\.com"\];/, 'only the ecosystem\'s own origins are carried to');
  assert.match(bar, /var HANDOFF = "mcc_handoff";/);
  assert.match(bar, /return url && \/\^https\?:\$\/\.test\(url\.protocol\) && url\.origin !== location\.origin && ECOSYSTEM\.indexOf\(url\.origin\) !== -1;/);
  /* leaving: the token rides in the fragment, never a query */
  assert.match(bar, /url\.hash = \(url\.hash && url\.hash !== "#" \? url\.hash \+ "&" : "#"\) \+ HANDOFF \+ "=" \+ encodeURIComponent\(token\);/);
  assert.doesNotMatch(bar, /searchParams\.set\("mcc_handoff"/);
  assert.match(bar, /handoffHref\(dest\)\.then\(function \(h\) \{ location\.href = h; \}, function \(\) \{ location\.href = dest; \}\);/, 'the bar\'s own tabs carry it');
  assert.match(bar, /if \(!a \|\| a\.target === "_blank" \|\| a\.hasAttribute\("download"\) \|\| a\.closest\("\.appbar"\)\) return;/, 'any page link carries it; the bar sails itself');
  /* arriving: scrub first, exchange from this origin, verify, store, reload */
  const scrub = bar.indexOf('history.replaceState(null, "", location.pathname + location.search + rest)');
  const exchange = bar.indexOf('fetch(API_ORIGIN + "/v1/auth/handoff"');
  assert.ok(scrub > 0 && exchange > scrub, 'the fragment is scrubbed before anything is sent');
  assert.match(bar, /if \(!token \|\| readAuthSession\(\)\) return Promise\.resolve\(false\);/, 'a page that already holds a session keeps it');
  assert.match(bar, /headers: \{ authorization: "Bearer " \+ token, "content-type": "application\/json" \}, body: "\{\}"/);
  assert.match(bar, /body: JSON\.stringify\(\{ type: "magiclink", token_hash: j\.token_hash \}\)/);
  assert.match(bar, /expires_at: Number\(s\.expires_at\) \|\| Math\.floor\(Date\.now\(\) \/ 1000\) \+ \(Number\(s\.expires_in\) \|\| 3600\)/, 'the stored session carries its expiry, as the auth client writes it');
  assert.match(bar, /localStorage\.setItem\("mccdb_session", session\);/);
  assert.match(bar, /location\.reload\(\);/);
  assert.match(bar, /arriveWithHandoff\(\)\.then\(function \(carried\) \{ if \(!carried\) refreshAuthState\(\); \}\);/);
  /* the Worker side */
  const route = await read('workers/mccluster/src/auth-handoff.js');
  assert.match(route, /export const HANDOFF_PATH = '\/v1\/auth\/handoff';/);
  assert.match(route, /if \(!origin \|\| !allowedOrigins\(env\)\.includes\(origin\)\) return fail\(request, env, 'only the ecosystem\\'s own hosts can carry a sign-in across', 403\);/);
  assert.match(route, /body: JSON\.stringify\(\{ type: 'magiclink', email: user\.email \}\)/);
  assert.doesNotMatch(route, /refresh_token/, 'no refresh token ever leaves the route: one session per origin');
  const entry = await read('workers/mccluster/src/entry-platform.js');
  assert.match(entry, /const handoff = await handleAuthHandoff\(request, env\);/);
});
