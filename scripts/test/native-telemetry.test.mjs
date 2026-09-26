/* THE HOUSE'S OWN EYES, AND A RECORD THAT COMES BACK WHERE IT LEFT.
   ============================================================
   Three complaints, one root cause in each, pinned here so the next
   change cannot quietly undo them.

   1. The record restarted from the top. Both players banked the
      position on `pagehide` alone, which a phone leaving for another
      app never fires. js/main.js already listened for the hidden
      state and js/pip.js and album.html did not, which is exactly why
      the behaviour was INCONSISTENT rather than simply broken.

   2. The analytics were notional. js/analytics.js posted to a table
      with no migration behind it and threw the failure away, while
      still loading Google's tag.

   3. The offer funnel had no last step. Looking was recorded. Deciding
      was not.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const MIGRATION = 'supabase/migrations/20260919093553_native_telemetry_columns.sql';
const LOCKDOWN  = 'supabase/pending_migrations/20260919999000_native_telemetry_lockdown.sql';
const ANALYTICS_PLATFORM = 'supabase/migrations/20260919133905_analytics_platform_multitenant_v1.sql';

/* An assertion that something is ABSENT has to read the code and not the
   prose. Everything here is commented on the scale this house writes at,
   and those comments necessarily name what was removed and why — so a
   plain grep for the old direct insert finds the paragraph explaining
   that it is gone and calls it a regression. Strip the commentary, test
   the program. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
const sqlCode = (src) => src.replace(/^\s*--.*$/gm, ' ');

/* ---------------------------------------------------------------
   1. THE POSITION SURVIVES LEAVING
   --------------------------------------------------------------- */

test('every player banks the position when the page is hidden, not only on pagehide', async () => {
  /* `pagehide` covers a navigation inside the browser. Switching apps
     only HIDES the page, and iOS and the in-app browsers then reclaim
     the tab whenever they want the memory — so a listener who left for
     Instagram came back to the top of the record. visibilitychange is
     the signal that actually arrives, while the page can still write. */
  for (const [file, src] of Object.entries({
    'js/pip.js': await read('js/pip.js'),
    'album.html': await read('album.html'),
    'js/main.js': await read('js/main.js'),
  })) {
    assert.match(src, /visibilitychange/,
      `${file} must bank the position when the page is hidden`);
    assert.match(src, /document\.visibilityState === ["']hidden["']/,
      `${file} must act on the hidden state specifically`);
    assert.match(src, /addEventListener\(["']pagehide["']/,
      `${file} must keep pagehide for the in-browser navigation it does cover`);
  }
});

test('the write on the way out is never dropped by the throttle', async () => {
  /* Ten seconds is right for a position written while a record plays and
     wrong for the one written as somebody walks away: that one carries
     the second they actually left on. The throttle was eating it. */
  const pip = await read('js/pip.js');
  assert.match(pip, /function pushRemote\(s, force\)/,
    'the remote push must be able to be forced');
  assert.match(pip, /if \(!force && now - lastPush < 10000\)/,
    'the throttle must yield to a forced push, not ignore it');
  assert.match(pip, /function stash\(playing, force\)/,
    'the local stash must be forceable too');
  assert.match(pip, /stash\(!audio\.paused, true\)/,
    'the teardown path must force');

  const album = await read('album.html');
  assert.match(album, /function bank\(\) \{ save\(true\); \}/,
    'the album must force its teardown save');
  const main = await read('js/main.js');
  assert.match(main, /bankToPocket\(true\)/,
    'the front page must force its teardown save');
});

test('the last write survives the page being torn down', async () => {
  /* An ordinary fetch is cancelled the moment teardown starts, which
     makes the most important write of a listen the least likely to land. */
  const pip = await read('js/pip.js');
  assert.match(pip, /if \(keepalive\) opts\.keepalive = true;/,
    'the remote position write must be able to outlive the page');
  assert.match(pip, /remote\("POST", s, force\)/,
    'a forced push must be the one that sets keepalive');
});

test('coming back from the cache re-reads where the music actually is', async () => {
  /* Back button and app-switch return can restore a page from the
     back/forward cache with no script re-run: the resume already
     happened, once, on the original load. */
  for (const [file, src] of Object.entries({
    'js/pip.js': await read('js/pip.js'),
    'album.html': await read('album.html'),
  })) {
    assert.match(src, /addEventListener\(["']pageshow["']/,
      `${file} must handle a restored page`);
    assert.match(src, /\.persisted/,
      `${file} must only re-read when the page actually came from the cache`);
  }
});

/* ---------------------------------------------------------------
   2. THE ANALYTICS ARE THE HOUSE'S OWN
   --------------------------------------------------------------- */

test('Google is gone from the analytics client, not merely switched off', async () => {
  const js = await read('js/analytics.js');
  for (const ghost of [/googletagmanager/i, /\bgtag\b/, /\bfbq\b/, /dataLayer/,
                       /ANALYTICS_ID/, /META_PIXEL/, /GADS_/]) {
    assert.doesNotMatch(js, ghost,
      `${ghost} must not survive: an empty constant is still a loader waiting for an id`);
  }
});

test('the collector is a server, because a page cannot see its own address', async () => {
  const js = await read('js/analytics.js');
  assert.match(js, /\/functions\/v1\/collect/,
    'events must go to the collector, not straight at the table');
  assert.doesNotMatch(code(js), /\/rest\/v1\/events/,
    'a direct insert from the browser cannot carry an observed address');
  /* The token travels; the uid does not. Decoding a token here and
     asserting its subject would let anyone file events as anyone. */
  assert.match(js, /"Bearer " \+ s\.access_token/,
    'the session token must be sent for the collector to verify');
});

test('the collector observes the address and never accepts one', async () => {
  const ts = await read('supabase/functions/collect/index.ts');
  assert.match(ts, /function callerIp/, 'the address must come from the request headers');
  assert.match(ts, /cf-connecting-ip/, 'the edge header is the source of truth');
  assert.doesNotMatch(ts, /body\.ip|ev\.ip|\bbody\.user_agent\b|\bbody\.country\b/,
    'nothing observed may be read out of the body a visitor controls');
  assert.match(ts, /await resolveUid\(/,
    'a signed-in visitor must be verified, not believed');
  assert.match(ts, /auth\/v1\/user/,
    'only the auth server can say whether a token is real');
  /* A batch is a page's worth of intent. Anything a browser can drive
     without limit gets a ceiling. */
  assert.match(ts, /MAX_EVENTS/, 'the batch must be bounded');
  assert.match(ts, /MAX_BODY_BYTES/, 'the body must be bounded');
});

test('the collector says when it could not write', async () => {
  /* The old path wrapped its insert in a catch that discarded the
     failure, against a table that had no migration. That is
     indistinguishable from working, which is the whole complaint. */
  const ts = await read('supabase/functions/collect/index.ts');
  assert.match(ts, /reason: `insert \$\{r\.status\}`/,
    'a failed insert must be reported, so a check of the endpoint tells the truth');
});

test('the telemetry table is under migration control and the browser cannot write to it', async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /create table if not exists public\.events/,
    'the table the site has been posting to for months must exist in a migration');
  /* create table if not exists is a no-op against an existing table, so
     the new columns have to be added separately or the installation that
     most needs them is the one that silently skips them. */
  for (const col of ['device_id', 'session_id', 'ip', 'user_agent', 'country']) {
    assert.match(sql, new RegExp(`add column if not exists\\s+${col}\\b`),
      `${col} must be added to a table that may already exist`);
  }
});

test('the live analytics migration closes browser writes and the pending file is remainder-only', async () => {
  const live = await read(ANALYTICS_PLATFORM);
  assert.match(live, /drop policy if exists "anyone writes the exhaust" on public\.events;/,
    'the production migration must withdraw the legacy open insert policy');
  assert.match(live, /revoke insert on public\.events from anon, authenticated;/,
    'the production migration must revoke direct browser writes');
  const pending = await read(LOCKDOWN);
  assert.match(pending, /REMAINDER ONLY/,
    'the old lockdown file must no longer pretend browser-write closure is pending');
  assert.match(pending, /alter table public\.events force row level security;/,
    'force RLS remains an explicit owner hardening decision');
  assert.doesNotMatch(sqlCode(pending), /drop policy if exists "anyone writes the exhaust"|revoke insert on (?:table )?public\.events/,
    'already-applied write closure must not be duplicated in the pending remainder');
  const cols = await read(MIGRATION);
  assert.doesNotMatch(sqlCode(cols), /revoke insert|force row level security/,
    'the original additive telemetry migration remains additive');
});

test('there is a retention lever, and nothing pulls it automatically', async () => {
  const sql = await read(LOCKDOWN);
  assert.match(sql, /create or replace function public\.events_purge/,
    'an address kept forever should be a decision somebody made');
  assert.doesNotMatch(sqlCode(sql), /cron\.schedule|ops_maintenance_tick/,
    'the retention period is an owner decision, not a side effect of adding a column');
});

/* ---------------------------------------------------------------
   3. THE OFFER FUNNEL HAS ITS LAST STEP
   --------------------------------------------------------------- */

test('the buy tap is recorded with the price that was on screen', async () => {
  /* This file exists to stop a card showing one number while checkout
     charges another. Recording what was shown is what makes that
     checkable afterwards instead of arguable. */
  const js = await read('js/offers.js');
  assert.match(js, /MCC_TRACK\("offer_buy_click"/,
    'the tap that starts a purchase must be recorded');
  assert.match(js, /var pr = priceOf\(L, o\.id, mode\) \|\| \{\};/,
    'the price banked must be read from the same source the card painted from');
  assert.match(js, /approved: pr\.approved === true/,
    'an unapproved price is a real state and must be recorded as one');
});

test('the buy handler is re-attached every time the card repaints', async () => {
  /* buyBody() rebuilds the panel whenever the mode toggle moves, so a
     listener attached once at load is a listener that stops existing the
     first time somebody flips to Equity. mountDomain already learned this. */
  const js = code(await read('js/offers.js'));
  /* the lookbehind drops the declaration, leaving the call sites */
  const calls = js.match(/(?<!function )mountBuy\(panel, L, o, /g) || [];
  assert.equal(calls.length, 2,
    'mountBuy must run on the first paint and on every repaint, like mountDomain');
  const domain = js.match(/(?<!function )mountDomain\(panel, L, o, /g) || [];
  assert.equal(calls.length, domain.length,
    'the buy handler must be wired wherever the address box is');
});

/* ---------------------------------------------------------------
   the scrub
   --------------------------------------------------------------- */

test('no page reintroduces a third-party tag', async () => {
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  const offenders = [];
  for (const f of files) {
    let src;
    try { src = await read(f); } catch { continue; }
    if (/googletagmanager\.com|connect\.facebook\.net|google-analytics\.com/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `these pages load a third-party tag: ${offenders.join(', ')}`);
});

/* ---------------------------------------------------------------
   4. THE INSTRUMENT PANEL — depth, and the two limits on it
   --------------------------------------------------------------- */

test('the sensor suite is present and wired to the collector', async () => {
  const js = await read('js/analytics.js');
  for (const sensor of ['page_view', 'click', 'rage_click', 'dead_click', 'scroll_depth',
                        'form_start', 'form_submit', 'exit_intent', 'copy',
                        'js_error', 'js_rejection', 'page_leave', 'device_power',
                        'network_change', 'location_permission', 'precise_location']) {
    assert.match(js, new RegExp(`T\\("${sensor}"`),
      `${sensor} must be instrumented — it is one of the things GA4 cannot give you`);
  }
});

test('nothing anybody types is ever read', async () => {
  /* The hard line. Field names, focus order and timing say which question
     cost you the lead; the characters say nothing extra and turn a funnel
     into a breach waiting for its disclosure letter. */
  const js = code(await read('js/analytics.js'));
  const sense = js.slice(js.indexOf('THE INSTRUMENT PANEL') >= 0 ? 0 : 0);
  assert.doesNotMatch(sense, /\bel\.value\b|\btarget\.value\b|\be\.target\.value\b/,
    'no sensor may read the value of an input');
  /* Every key the sensors compare against, listed. A keystroke sensor that
     grew a third case would show up here as a third name. */
  const keys = [...sense.matchAll(/e\.key\s*[!=]==\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['Backspace', 'Delete'],
    'key identity is read only to count corrections, never to capture characters');
  assert.match(js, /var SECRET = \/pass\|pwd\|card\|cvc/,
    'fields that could hold a secret must be recognised');
  assert.match(js, /if \(t === "password" \|\| t === "hidden"\) return true;/,
    'a password field must not be instrumented at all, not even for timing');
});

test('the device id is not a fingerprint built to survive a cleared browser', async () => {
  const js = code(await read('js/analytics.js'));
  /* A canvas/audio/font hash exists specifically to re-identify somebody who
     erased their data. The GPU renderer string is kept as an attribute of the
     machine, which is a different thing: it is never hashed or combined into
     an identifier. */
  assert.doesNotMatch(js, /toDataURL|getImageData|createAnalyser|OfflineAudioContext/,
    'no canvas or audio fingerprinting');
  assert.match(js, /localStorage\.setItem\(DEVICE_KEY, deviceId\)/,
    'the device id must be a stored random value, so clearing the store clears it');
  assert.doesNotMatch(js, /new\s+RTCPeerConnection|createDataChannel|onicecandidate|getStats\(/,
    'network telemetry must not probe local addresses through WebRTC');
  assert.doesNotMatch(js, /\bimei\b|serialNumber|macAddress/i,
    'the browser collector must not attempt hardware identifier collection');
});

test('the Worker route enriches and forwards, and is not a second writer', async () => {
  /* Measured, not assumed: a request reaching a Supabase edge function carries
     cf-ray and nothing else, so the geo has to be attached upstream. */
  const js = await read('workers/mccluster/src/entry.js');
  assert.match(js, /path === '\/v1\/collect'/, 'the first-party intake route must exist');
  assert.match(js, /request\.cf/, 'only the Worker can see where the visitor is');
  for (const f of ['asn', 'asOrganization', 'city', 'postalCode', 'latitude', 'timezone',
                    'colo', 'metroCode', 'httpProtocol', 'tlsVersion', 'tlsCipher',
                    'clientTcpRtt', 'clientQuicRtt', 'clientAcceptEncoding', 'requestPriority']) {
    assert.match(js, new RegExp(`cf\\.${f}\\b`), `${f} must be forwarded`);
  }
  assert.match(js, /cf\.edgeL4 && cf\.edgeL4\.deliveryRate/,
    'edge delivery rate must be forwarded when Cloudflare exposes it');
  assert.match(js, /cf\.botManagement && cf\.botManagement\.score/,
    'bot score may be forwarded as classification metadata');
  const route = code(js.slice(js.indexOf("path === '/v1/collect'")).slice(0, 6500));
  assert.doesNotMatch(route, /ja3Hash|\bja4\b|tlsClientCiphersSha1|tlsClientExtensionsSha1/,
    'transport telemetry must not become a TLS fingerprint');
  assert.match(js, /\$\{env\.SUPABASE_URL\}\/functions\/v1\/collect/,
    'the Worker must forward to the collector, not write its own rows');
  assert.doesNotMatch(js.slice(js.indexOf("path === '/v1/collect'")).slice(0, 4000),
    /rest\/v1\/events/,
    'there must be exactly one writer of public.events');
});

test('network telemetry records quality and transitions without inventing identity', async () => {
  const js = await read('js/analytics.js');
  for (const fact of ['effectiveType', 'downlink', 'rtt', 'saveData', 'navigator.onLine']) {
    assert.match(js, new RegExp(fact.replace('.', '\\.')),
      `${fact} must be part of the network snapshot`);
  }
  assert.match(js, /addEventListener\("change", function \(\) \{\s*T\("network_change"/,
    'connection changes must be recorded during a visit');
  assert.match(js, /nextHopProtocol/,
    'navigation transport protocol must be attached to real-user performance data');
});

test('location remains IP-derived and the browser is never asked for GPS', async () => {
  const js = await read('js/analytics.js');
  const html = await read('privacy.html');
  assert.match(js, /precise_location_not_collected/,
    'the old public MCC_LOCATION hook should fail closed instead of prompting for GPS');
  assert.doesNotMatch(js, /navigator\.geolocation|getCurrentPosition|enableHighAccuracy/,
    'analytics must not ask the browser or phone for precise location');
  assert.doesNotMatch(js, /navigator\.permissions\.query\(\{ name: "geolocation" \}\)/,
    'analytics must not probe geolocation permission state');
  assert.match(html, /No precise device location/i,
    'the code and public notice must agree that GPS-level location is not collected');
});

test('signup attribution records only first-party analytics provenance and honours privacy signals', async () => {
  const js = await read('js/analytics.js');
  const auth = await read('js/mcc-auth.js');
  assert.match(js, /window\.MCC_ANALYTICS_CONTEXT = \{/);
  assert.match(js, /signupAttribution: function \(\)/);
  assert.match(js, /if \(privacySignal\(\)\) return null/);
  assert.match(js, /device_id: deviceId/);
  assert.match(js, /session_id: s/);
  assert.match(auth, /profileData\.analytics_attribution = analyticsAttribution/);
  assert.match(auth, /Analytics attribution is deliberately metadata, never authority/);
});

test('the client prefers the first-party domain and can still fall back', async () => {
  const js = await read('js/analytics.js');
  assert.match(js, /var COLLECT = "https:\/\/api\.mccluster\.org\/v1\/collect"/,
    'first-party, because a blocklist carries google-analytics.com and not this');
  assert.match(js, /COLLECT_FALLBACK/,
    'a house that cannot reach its own Worker should still be able to count');
});

test('scroll depth is clamped, because the denominator moves', async () => {
  /* onboard.html was reporting an average scroll depth of 289% in production. */
  const js = await read('js/analytics.js');
  assert.match(js, /Math\.min\(100, Math\.max\(0, Math\.round\(scrollY \/ h \* 100\)\)\)/,
    'a page that shrinks after scrolling must not report more than 100%');
});

/* ---------------------------------------------------------------
   5. THE NOTICE, AND THE CODE THAT HAS TO MATCH IT
   --------------------------------------------------------------- */

test('the site tells visitors what it records', async () => {
  /* The collection shipped before the disclosure did. Everything above this
     line observes an address, a city, a network and a device; none of it was
     written down anywhere a visitor could read it, which is the part a
     regulator opens first. */
  const html = await read('privacy.html');
  for (const fact of [/IP address/i, /device/i, /network/i, /precise device location/i, /delete/i]) {
    assert.match(html, fact, `the notice must name what is actually collected: ${fact}`);
  }
  assert.match(html, /matthew@mccluster\.org/,
    'a right nobody can exercise is not a right: the notice must say where to write');
  assert.doesNotMatch(html, /Google Analytics[^.]*\bis\b(?![^.]*no\b)/i,
    'the notice must not claim a tag the site does not run');
});

test('the copy sensor does not take what belongs to the visitor', async () => {
  /* It banked 120 characters of any selection. On a signed-in surface the
     words painted on screen ARE the visitor's own record — their address,
     their order, their message — so the sensor was quietly collecting
     personal data from the one place it had no business reading. */
  const js = code(await read('js/analytics.js'));
  assert.match(js, /function signedIn\(\)/,
    'the sensor must be able to tell an account surface from a public page');
  assert.match(js, /function housesOwnWords\(node\)/,
    'the sensor must be able to tell its own writing from somebody else\'s');
  assert.match(js, /t === "INPUT" \|\| t === "TEXTAREA"/,
    'a selection inside a field is something they typed, which is never read');
  assert.match(js, /el\.isContentEditable/,
    'a contenteditable is a field wearing a different tag');
  assert.match(js, /data-private/,
    'a page must be able to mark itself unquotable');
  assert.match(js, /text: quotable \?/,
    'the text must be conditional; the length always survives');
});

test('the privacy signal is honoured, not merely written down', async () => {
  /* GEO_HEADERS already collected sec-gpc and dnt — into a column, as
     trivia, while every identifying field was written anyway. The notice
     now says the signal is honoured, and a claim in a privacy notice that
     the code does not implement is the violation by itself. */
  const ts = await read('supabase/functions/collect/index.ts');
  assert.match(ts, /function optedOut\(h: Headers_\)/,
    'the signal must be read');
  assert.match(ts, /h\.get\("sec-gpc"\) === "1" \|\| h\.get\("dnt"\) === "1"/,
    'both names must count');
  assert.match(ts, /const quiet = optedOut\(h\);/,
    'the decision must be made once, before any row is built');
  for (const field of ['ip', 'sessionId']) {
    assert.match(ts, new RegExp(`const ${field} = quiet \\?`),
      `${field} follows a person between sittings and must not survive the signal`);
  }
  assert.match(ts, /const persistentAllowed = !quiet && \(site\.legacy \|\| consentState === "granted"\);/,
    'persistent customer identity must require both no privacy opt-out and explicit consent');
  assert.match(ts, /const deviceId = persistentAllowed \?/,
    'deviceId must be downstream of the privacy-and-consent gate');
  assert.match(ts, /city: quiet \? null : g\.city/,
    'the city must go; the country may stay, because a count is not a person');
  assert.match(ts, /country: g\.country,/,
    'the visit must still be counted, or the signal becomes under-reporting');
  assert.match(ts, /if \(quiet && name === "precise_location"\) continue;/,
    'a privacy signal must also suppress consent-gated precise location rows');
});

test('the signal survives the Worker hop', async () => {
  /* The intake route builds a fresh header set, so anything not named there
     never reaches the only code that acts on it. */
  const js = await read('workers/mccluster/src/entry.js');
  assert.match(js, /put\('sec-gpc', request\.headers\.get\('sec-gpc'\)\)/,
    'GPC must be forwarded to the collector');
  assert.match(js, /put\('dnt', request\.headers\.get\('dnt'\)\)/,
    'Do Not Track must be forwarded too');
});

/* ---------------------------------------------------------------
   6. THE INTAKE CARD — where the disclosure is linked and the
      personal data is actually typed
   --------------------------------------------------------------- */

test('the consent boxes are boxes', async () => {
  /* `.ac input { width: 100% }` matched the consent checkboxes as well as
     the text fields, so each box stretched to the full width of the card
     and pushed its own label past the edge, where it wrapped one word per
     line. The guard that existed, `.fan__check input { width: auto }`, has
     the SAME specificity and lost on source order — which is why the fix
     is a type selector and not another class. */
  const html = await read('account.html');
  assert.match(html, /\.ac input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\) \{/,
    'the field treatment must exclude the controls it was never meant for');
  assert.match(html, /\.fan__check input\[type="checkbox"\] \{[^}]*width: 1\.1rem/,
    'a checkbox must be sized, not stretched');
  assert.match(html, /\.fan__check span \{ flex: 1; min-width: 0; \}/,
    'and its label must take the rest of the row and wrap inside it');
});

test('the link to the notice is visible as a link', async () => {
  /* The intake card is the one form on the site that collects a legal name
     and a street address, so it carries the link to privacy.html. It
     inherited the fine print's dim grey with no underline and read as one
     more sentence of boilerplate, which is the same failure as not linking
     it at all. */
  const html = await read('account.html');
  assert.match(html, /<a href="privacy\.html">/,
    'the form that collects the data must link the notice about it');
  assert.match(html, /\.fan__fine a \{[^}]*text-decoration: underline/,
    'and the link must look like one');
});
