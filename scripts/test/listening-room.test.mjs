/* THE LISTENING ROOM.
   ============================================================
   The complaint: the Music tab opened one album and stopped. Eight
   records existed, seven of them reachable only through the catalogue
   page — which is a registry of ISRC codes, not somewhere to listen —
   and the magnifying glass in the album's top row was a link to that
   registry rather than a search field.

   Three things are pinned here so the next change cannot quietly undo
   them: the tab opens the whole shelf, the search searches, and the
   ordering is an enhancement the page can lose without breaking.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
const json = async (p) => JSON.parse(await read(p));
const SIGNALS = 'supabase/migrations/20260919150000_track_recommendation_signals.sql';

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
const sqlCode = (src) => src.replace(/^\s*--.*$/gm, ' ');

/* ---------------------------------------------------------------
   1. THE TAB OPENS THE HOUSE, NOT ONE ROOM
   --------------------------------------------------------------- */

test('no page sends the Music tab to a single album', async () => {
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  const offenders = [];
  for (const f of files) {
    const src = await read(f).catch(() => '');
    /* The destination is read off the tab itself rather than by searching
       for album.html, because plenty of pages link to the album on purpose
       and should keep doing it. */
    for (const [, href] of src.matchAll(/href="([^"]*)"\s+data-appnav="music"/g)) {
      if (!/listen\.html$/.test(href)) offenders.push(`${f} -> ${href}`);
    }
  }
  assert.deepEqual(offenders, [],
    `the Music tab must open the listening room: ${offenders.join(', ')}`);
});

test('the tab actually navigates to the room, href notwithstanding', async () => {
  /* THIS IS THE ONE THE FIRST PASS MISSED. Thirty-three pages had their
     href changed, every test agreed, and tapping the tab still opened the
     album — because a tab with a wing does not use its own href. The
     dispatcher reads WINGS[key].home and prefers it:

        var dest = w ? w.home : (slot || a.getAttribute("href"));

     So the href is the fallback for a tab that has no wing, and Music has
     one. Asserting markup proved nothing about where a tap goes. */
  const js = await read('js/tabbar.js');
  const wing = js.slice(js.indexOf('  var WINGS = {'));
  const music = wing.slice(wing.indexOf('music: {'), wing.indexOf('uprise: {'));
  assert.match(music, /home: "listen\.html"/,
    'the music wing must open the listening room, because home is what a tap uses');
  assert.match(js, /var dest = w \? w\.home : \(slot \|\| a\.getAttribute\("href"\)\);/,
    'if this dispatch changes, the assertion above stops covering the tap');
});

test('the listening room lights the Music tab', async () => {
  /* PAGE_WING is what fills the coin on the tab for the page you are on. A
     room missing from it is a room where the bar says you are nowhere. */
  const js = await read('js/tabbar.js');
  const map = js.slice(js.indexOf('var PAGE_WING = {'));
  assert.match(map.slice(0, 600), /"listen\.html": "music"/,
    'the room belongs to the Music wing and the bar should say so');
});

test('the music wing still carries exactly four rooms', async () => {
  /* The bar's own trim law, stated at WINGS: an open wing is the same
     five-cell bar, so a wing carries four rooms and no more. Adding the
     listening room without removing one would shrink the capsule on every
     long-press and shove the held tab out of its column. */
  const js = await read('js/tabbar.js');
  const wing = js.slice(js.indexOf('  var WINGS = {'));
  const music = wing.slice(wing.indexOf('music: {'), wing.indexOf('uprise: {'));
  const slots = music.match(/\["[a-z0-9-]+\.html",/g) || [];
  assert.equal(slots.length, 4,
    `the music wing must carry four rooms, found ${slots.length}: ${slots.join(' ')}`);
  assert.match(music, /\["listen\.html",/, 'and the listening room must be one of them');
});

test('the bar built for pages that lack one agrees with the bar they ship', async () => {
  /* js/tabbar.js builds the capsule for any page without its own copy. It
     had its own hardcoded destination, so fixing the markup alone would
     have left every generated bar pointing at the album. */
  const js = await read('js/tabbar.js');
  assert.match(js, /ROOT \+ 'listen\.html" data-appnav="music"/,
    'the generated bar must open the listening room too');
});

test('the room is reachable from the map, so it is not an orphan', async () => {
  const js = await read('js/masthead.js');
  assert.match(js, /href: "listen\.html"/,
    'the drawer is what keeps a page reachable in this house');
});

/* ---------------------------------------------------------------
   2. THE SEARCH SEARCHES
   --------------------------------------------------------------- */

test('the search is a field, not a link to the registry', async () => {
  const html = await read('listen.html');
  assert.match(html, /<input id="q" type="search"/,
    'the magnifying glass must be attached to an actual input');
  const js = await read('js/listen.js');
  assert.match(js, /box\.addEventListener\("input"/,
    'the field must filter as it is typed');
});

test('the search indexes more than the title', async () => {
  /* Somebody looking for a record by the album it is on, or by a credit,
     is searching — a title-only match is a filter pretending to be one. */
  const js = await read('js/listen.js');
  assert.match(js, /key\(t\.title \+ " " \+ t\.album \+ " " \+ t\.credit \+ " " \+ t\.sub\)/,
    'title, album, credit and subtitle must all be searchable');
  assert.match(js, /String\(t\.isrc \|\| ""\)\.toLowerCase\(\)/,
    'the registered code must be searchable, because that is how a licensee looks');
  assert.match(js, /needle\.split\(\/\\s\+\/\)\.every\(/,
    'every word must match somewhere, so word order does not decide the result');
});

test('the field does not file an event for every keystroke', async () => {
  /* What somebody was looking for is the signal. The half-typed prefixes on
     the way there are noise, and one row per character would be the single
     noisiest sensor in the house. */
  const js = await read('js/listen.js');
  assert.match(js, /clearTimeout\(typed\)/, 'the search event must be debounced');
  assert.match(js, /listen_search/, 'the completed search is worth recording');
});

/* ---------------------------------------------------------------
   3. THE ORDER IS AN ENHANCEMENT, NOT A DEPENDENCY
   --------------------------------------------------------------- */

test('every playable track reaches the index', async () => {
  /* data/albums.json is what can actually be played; data/catalogue.json is
     the registry and is three tracks short of it. Joining on the registry
     would have silently dropped those three from the room. */
  const albums = await json('data/albums.json');
  const cat = await json('data/catalogue.json');
  const playable = albums.albums.flatMap((a) => a.tracks.map((t) => t.title));
  assert.ok(playable.length >= 18, `expected the whole shelf, got ${playable.length}`);

  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const registered = new Set(cat.tracks.map((t) => key(t.title)));
  const unregistered = playable.filter((t) => !registered.has(key(t)));
  assert.ok(unregistered.length > 0,
    'this test is only meaningful while the two files disagree; if they now ' +
    'agree, the join below stops being load-bearing and this can relax');

  const js = await read('js/listen.js');
  assert.match(js, /ALBUMS\.forEach\(function \(a, ai\) \{/,
    'the index must be built by walking the albums, which is what plays');
  assert.doesNotMatch(code(js), /cat\.tracks\.forEach[\s\S]{0,200}out\.push/,
    'building from the registry would drop the tracks it has not registered yet');
});

test('the room opens when the ranking does not', async () => {
  const js = await read('js/listen.js');
  assert.match(js, /return j\(SB_URL \+ "\/rest\/v1\/" \+ path, \{[\s\S]{0,200}?catch\(function \(\) \{ return null; \}\)/,
    'a failed signal fetch must resolve to nothing, never reject the page');
  assert.match(js, /if \(a\.position && b\.position\) return a\.position - b\.position;/,
    'ranked tracks order by rank');
  assert.match(js, /return a\.seq - b\.seq;/,
    'and fall back to the catalogue numbering when nothing is ranked');
});

test('an unplayed track sorts below a played one, not through them', async () => {
  /* Treating a missing rank as zero would shuffle brand-new records into the
     middle of the shelf, which reads as a bug rather than as an ordering. */
  const js = await read('js/listen.js');
  assert.match(js, /if \(a\.position\) return -1;\s*\n\s*if \(b\.position\) return 1;/,
    'a ranked track must outrank an unranked one outright');
});

test('the rail is headed on what the data can actually support', async () => {
  /* With no ranking deployed the rail shows the catalogue order. Heading that
     "Most played" would be a claim about listeners that no play has been
     counted for — and the first person to disagree with the order would be
     right. */
  const js = await read('js/listen.js');
  assert.match(js, /RANKED = \(signals \|\| \[\]\)\.length > 0;/,
    'the page must know whether anything actually ranked');
  /* The honest-heading problem is now solved one level up: a rail whose
     method produced nothing is not headed differently, it is not on the
     page. rail() is what enforces that. */
  assert.match(js, /wrap\.hidden = !items\.length;/,
    'a rail with nothing to show must be absent, not relabelled');
});

/* ---------------------------------------------------------------
   4. THE TAP LANDS ON THE TRACK
   --------------------------------------------------------------- */

test('a track link carries the track, and the album opens on it', async () => {
  const js = await read('js/listen.js');
  assert.match(js, /"album\.html\?album=" \+ encodeURIComponent\(t\.albumSlug\) \+ "&t=" \+ encodeURIComponent\(t\.title\)/,
    'the row must link to its own track, not to the top of its album');

  const album = await read('album.html');
  assert.match(album, /var WANT = Q0\.get\("t"\) \|\| "";/,
    'the album must read the asked-for track');
  assert.match(album, /if \(want > -1\) \{\s*\n\s*load\(want, 0\);/,
    'and open on it from the start, not from a saved second');
});

test('an asked-for track beats both resumes', async () => {
  /* The album resumes from the pocket and from a saved position. Either one
     would have overwritten the track somebody just tapped. */
  const album = await read('album.html');
  assert.match(album, /var pk = want > -1 \? null : \(window\.MCC_POCKET && window\.MCC_POCKET\.read\(\)\);/,
    'the pocket resume must stand down for an explicit tap');
  assert.match(album, /load\(want, 0\);[\s\S]{0,220}r0 = null;/,
    'the saved position must stand down too');
});

/* ---------------------------------------------------------------
   5. THE ONE DOOR OUT OF THE OWNER-ONLY TABLE
   --------------------------------------------------------------- */

test('the public views leak nothing identifying', async () => {
  /* public.events is owner-only and carries an address, a network and a
     device. These two views are the only things about it an anonymous
     visitor can read, so what they select IS the security argument. */
  const sql = sqlCode(await read(SIGNALS));
  assert.match(sql, /grant select on public\.v_track_signals  to anon, authenticated;/,
    'the ordering is public because the shelf is public');
  assert.match(sql, /grant select on public\.v_track_affinity to anon, authenticated;/,
    'and so is the similarity matrix');
  /* device_id and session_id are read INSIDE the views — that is the whole
     computation — so the check is on what survives into a select list. */
  const published = [
    sql.slice(sql.indexOf('select\n  r.k as track_key'), sql.indexOf('from ranked r')),
    sql.slice(sql.indexOf('select\n  p.k as track_key'), sql.indexOf('from pairs p')),
  ].join('\n');
  for (const leak of [/\bip\b/, /device_id/, /session_id/, /\buid\b/, /user_agent/, /\be\.at\b/]) {
    assert.doesNotMatch(published, leak,
      `${leak} must not survive into a view an anonymous visitor can read`);
  }
});

test('the signal views are the deliberate exception, and say so', async () => {
  /* Every telemetry view added with the collector is security_invoker
     precisely so the owner-only policy governs it. These cannot be, or they
     would return nothing to the visitors they exist for — which makes them
     the one place a careless column becomes a disclosure. */
  const sql = await read(SIGNALS);
  assert.doesNotMatch(sqlCode(sql), /with \(security_invoker/,
    'these views must run as their owner, or the room has no order');
  assert.match(sql, /WHAT IS PUBLISHED, AND WHAT IS STILL NOT/,
    'the exception must be stated where the next person edits it');
  for (const v of ['v_track_signals', 'v_track_affinity']) {
    assert.match(sql, new RegExp(`comment on view public\\.${v} is`),
      `${v} must carry its warning on the object, where a schema dump shows it`);
  }
  const views = await read('supabase/migrations/20260919094143_native_telemetry_views.sql');
  assert.match(views, /security_invoker = true/,
    'the owner-only views must stay owner-only');
});

test('crawlers do not get a vote in what the shelf shows first', async () => {
  const sql = sqlCode(await read(SIGNALS));
  assert.match(sql, /and e\.is_bot is not true/,
    'a crawler pressing play is not an audience');
});

/* ---------------------------------------------------------------
   6. THE ART DIRECTION IS THE HOUSE'S, NOT A SECOND ONE
   --------------------------------------------------------------- */

test('the listening room is built from the album room\'s vocabulary', async () => {
  /* The first build of this page invented its own flat list styling and
     read as a spreadsheet about records rather than a place to play them.
     The card, chip and row classes are album.html's, and they live in a
     shared stylesheet so the two rooms cannot drift into two products. */
  const html = await read('listen.html');
  assert.match(html, /href="css\/music-room\.css/,
    'the shared vocabulary must be loaded, not re-invented');
  assert.match(html, /class="music-room music-room--listen"|music-room music-room--listen/,
    'the room must declare itself a music room so the per-room overrides apply');
  for (const cls of ['greet', 'chips', 'feat', 'lib__k', 'tr']) {
    assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`),
      `${cls} is the house's class for this element and must be the one used`);
  }
});

test('the shared vocabulary states the debt it owes album.html', async () => {
  /* These rules are duplicated: album.html still carries its own inline
     copy. That is a deliberate trade — cutting open a four-hundred-line
     style block with its own cascade was a bigger risk than this page was
     worth — but an undocumented duplicate is how two rooms drift apart. */
  const css = await read('css/music-room.css');
  assert.match(css, /album\.html/,
    'the file must name where the rules came from');
  assert.match(css, /BOTH places|both places/,
    'and warn that a change has to be made twice until the debt is paid');
});

test('the deck shows before it asks anyone to read', async () => {
  /* A discovery room opens on rails of art, not an index: somebody who has
     not decided what to play cannot be helped by a list. The index stays,
     underneath, for the people who already know. */
  const js = await read('js/listen.js');
  assert.match(js, /function card\(t, why\)/,
    'a card must be able to say why it is in front of you');
  assert.match(js, /function albumCard\(a\)/, 'so must albums');
  assert.match(js, /class="feat__bg"/, 'the art is the card, not a thumbnail on it');
  const html = await read('listen.html');
  assert.ok(html.indexOf('id="ff"') < html.indexOf('id="all"'),
    'the rails must come before the index');
});

test('a search puts the browse aids away', async () => {
  const js = await read('js/listen.js');
  assert.match(js, /\["ffWrap", "finWrap", "riseWrap", "keptWrap", "deepWrap"\]\.forEach/,
    'every algorithmic rail is for people who have not decided yet');
  assert.match(js, /el\("shelfWrap"\)\.hidden = searching/,
    'so is the shelf');
});

test('the flat list numbers itself, not each album', async () => {
  /* Eighteen tracks across eight records numbered by their place on their
     own album restarts at 1 seven times, which reads as a bug. */
  const js = await read('js/listen.js');
  assert.match(js, /function row\(t, i\)/, 'the row must know its place in the list');
  assert.match(js, /'<span class="n">' \+ \(i \+ 1\) \+ "<\/span>"/,
    'and print that, not the album position');
  assert.doesNotMatch(code(js), /class="n">' \+ t\.no/,
    'the per-album number belongs in the album room');
});

test('a heart tapped here is the same act as one tapped in the album room', async () => {
  /* Same storage key, same row shape, same event — otherwise the discovery
     room would collect saves the player could not see and the ranking
     would not count. */
  const js = await read('js/listen.js');
  const album = await read('album.html');
  assert.match(js, /var ROT_KEY = "mcc_rotation";/, 'the same store album.html writes');
  assert.match(album, /ROT_KEY = "mcc_rotation"/, 'which is still what the album room uses');
  assert.match(js, /kept\.push\(\{ album: alb, title: title \}\)/,
    'the same row shape, or the album room cannot read it back');
  assert.match(js, /MCC_TRACK\(added \? "rotation_add" : "rotation_drop"/,
    'and the same event, which is what the ranking counts');
});

/* ---------------------------------------------------------------
   7. THE RECOMMENDERS — each rail is a named method
   --------------------------------------------------------------- */

test('the keep rate is smoothed before the confidence bound, not after', async () => {
  /* MEASURED, NOT ASSUMED. Run against a fixture, a bare Wilson lower bound
     put a track with two plays and two saves SECOND — its 95% floor is 0.34,
     which beats a forty-listener track's honest 0.31. The interval is that
     wide at n = 2. Crediting every track with a prior of pseudo-listeners at
     the catalogue's own mean fixes it: the two-play track falls to 0.25 and
     lands below. Without the prior this view recommends flukes. */
  const sql = sqlCode(await read(SIGNALS));
  assert.match(sql, /\), prior as \(/, 'the prior must be its own step');
  assert.match(sql, /sum\(j\.kept\)::numeric \/ sum\(greatest\(j\.listeners, j\.kept\)\)/,
    "the prior's rate must come from the catalogue, not from a number somebody liked");
  assert.match(sql, /\(j\.kept::numeric \+ pr\.c \* pr\.m\)/,
    'the successes must be smoothed toward it');
  assert.match(sql, /greatest\(j\.listeners, j\.kept\)::numeric \+ pr\.m as n/,
    'and the trials with it, or the proportion is not a proportion');
  assert.match(sql, /3\.8416/, 'z² for the 95% Wilson bound must still be there');
});

test('a pair only one person ever played is never published', async () => {
  /* The affinity view is readable by anyone. A co-occurrence with support of
     one IS a single visitor's listening session, so the floor is a privacy
     control before it is a quality one. */
  const sql = sqlCode(await read(SIGNALS));
  assert.match(sql, /where p\.co_devices >= 3/,
    'a pair needs several distinct devices behind it before it leaves the building');
  assert.match(sql, /count\(distinct a\.device_id\)\s+as co_devices/,
    'and support must be counted in devices, not in sessions one device can repeat');
});

test('the affinity is cosine, so a popular track is not everyone\'s neighbour', async () => {
  const sql = sqlCode(await read(SIGNALS));
  assert.match(sql, /p\.co_sessions \/ sqrt\(ta\.sessions \* tb\.sessions\)/,
    'co-occurrence must be normalised by both tracks\' own totals');
});

test('the signal views publish scores and never counts', async () => {
  /* Same discipline as the view they replace: anonymous readers get an
     ordering, not a volume. */
  const sql = sqlCode(await read(SIGNALS));
  const select = sql.slice(sql.indexOf('select\n  r.k as track_key'), sql.indexOf('from ranked r'));
  assert.doesNotMatch(select, /\br\.plays\b|\br\.listeners\b|\br\.kept\b/,
    'raw totals are the owner\'s to publish, not a side effect of ordering a rail');
  assert.match(select, /100 \* r\.keep_lb \/ max\(r\.keep_lb\) over \(\)/,
    'the keep rate must be relative to the best track, so no absolute rate leaks');
  assert.match(sql, /drop view if exists public\.v_track_reach;/,
    'the view this replaces must go, or there are two rankings to drift apart');
});

test('a rail sorts by the signal it is named after', async () => {
  /* Ranking "Rising" by the keep rank put the fourth-fastest climber at the
     head of it and the actual leader three cards along — a rail quietly not
     doing the thing its heading claims. Caught in a browser, not by reading
     it. */
  const js = await read('js/listen.js');
  assert.match(js, /function pick\(fn, why, rankOf\)/,
    'a rail must be able to state its own ordering');
  assert.match(js, /function \(t\) \{ return t\.momentumRank \|\| 99; \}\)\);/,
    'Rising must order by momentum');
});

test('every recommended card carries its own reason', async () => {
  /* A section heading explains a whole rail. The label on the card explains
     that card, which is what lets one rail mix sources honestly. */
  const js = await read('js/listen.js');
  assert.match(js, /why \? '<span class="feat__why">' \+ esc\(why\) \+ "<\/span>" : ""/,
    'the card must render a reason when it has one');
  for (const reason of [/"Plays with " \+ e\.seed/, /done \+ " of " \+ tracks\.length \+ " played"/,
                        /"Climbing" : "Up this week"/, /"Kept more than it is found"/]) {
    assert.match(js, reason, `${reason} must be one of the reasons a card can give`);
  }
  const css = await read('css/music-room.css');
  assert.match(css, /\.feat__why \{[\s\S]*?background: rgba\(9,7,5,0\.68\)/,
    'the label must carry its own contrast, because it lands on artwork nobody art-directed for it');
});

test('personalisation never asks the server who you are', async () => {
  /* The server publishes what is true of everybody and holds no per-device
     profile; the browser joins its own history against that. The alternative
     — asking "what did device X listen to" — means assembling and shipping a
     named listening profile, which is a much heavier thing to hold. */
  const js = await read('js/analytics.js');
  assert.match(js, /root\.MCC_HEARD = \{ read: read \};/,
    'the device must keep its own history');
  assert.match(js, /name === "album_play" && params && params\.track/,
    'written from the play itself, so both players feed it');

  const listen = await read('js/listen.js');
  assert.doesNotMatch(code(listen), /device_id=eq\.|device_id=in\.|\bmcc_device\b/,
    'the room must never query the server by device id');
  assert.match(listen, /function becausePlayed\(\)/, 'the recommender must be local');
  assert.match(listen, /if \(seen\[n\.k\] \|\| !BY_KEY\[n\.k\]\) return;/,
    'something already heard is not a recommendation');
});

test('the local history is capped and deduplicated', async () => {
  /* Unbounded, it grows forever in somebody's browser; undeduplicated, four
     plays of one record fill four of the slots. */
  const js = await read('js/analytics.js');
  assert.match(js, /var CAP = 40;/, 'the history must be bounded');
  assert.match(js, /list\.slice\(0, CAP\)/, 'and actually truncated');
  assert.match(js, /read\(\)\.filter\(function \(r\) \{ return r && r\.t !== t; \}\)/,
    'one entry per track, most recent first');
});
