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
const REACH = 'supabase/migrations/20260919104500_track_reach_public_ranking.sql';

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
  const fetchBlock = js.slice(js.indexOf('/rest/v1/v_track_reach'));
  assert.match(fetchBlock.slice(0, 400), /catch\(function \(\) \{ return null; \}\)/,
    'a failed ranking must resolve to nothing, never reject the page');
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
  assert.match(js, /RANKED = \(reach \|\| \[\]\)\.length > 0;/,
    'the page must know whether anything actually ranked');
  assert.match(js, /RANKED \? "Most played" : "Start here"/,
    'the heading must follow the data, not the intention');
  const html = await read('listen.html');
  assert.match(html, /id="topK">Start here</,
    'the honest heading must be the one that ships in the markup');
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

test('the ranking view publishes an order and never the numbers', async () => {
  /* public.events is owner-only and carries an address, a network and a
     device. This view is the single thing about it an anonymous visitor can
     read, so what it selects IS the security argument. */
  const sql = sqlCode(await read(REACH));
  assert.match(sql, /grant select on public\.v_track_reach to anon, authenticated;/,
    'the shelf order is public because the shelf is public');
  for (const leak of [/\bip\b/, /device_id\s*(,|$)/m, /session_id/, /\buid\b/, /user_agent/, /\bat\b\s*(,|$)/m]) {
    assert.doesNotMatch(sql.replace(/count\(distinct e\.device_id\)/g, 'COUNTED'), leak,
      `${leak} must not appear in a view an anonymous visitor can read`);
  }
  /* The counts are computed and then left behind: only the position and the
     relative index survive into the select list. */
  assert.match(sql, /rank\(\) over \(order by weight desc, key\) as position/,
    'the order must be published');
  assert.match(sql, /round\(100\.0 \* weight \/ max\(weight\) over \(\)\)::int/,
    'the index must be relative, so a total cannot be read off it');
  assert.match(sql, /end as reach/, 'and it must be the column named reach');
  const selectList = sql.slice(sql.lastIndexOf('select\n  key as track_key'), sql.indexOf('where weight > 0'));
  assert.doesNotMatch(selectList, /\bplays\b|\blisteners\b|\badds\b|\bdrops\b/,
    'raw totals are the owner\'s to publish, not a side effect of sorting a shelf');
});

test('the ranking view is the deliberate exception, and says so', async () => {
  /* Every other telemetry view is security_invoker precisely so the
     owner-only policy governs it. This one cannot be, or it would return
     nothing to the visitors it exists for — which makes it the one place a
     careless column becomes a disclosure. */
  const sql = await read(REACH);
  assert.doesNotMatch(sqlCode(sql), /with \(security_invoker/,
    'this view must run as its owner, or the room has no order');
  assert.match(sql, /DELIBERATELY NOT security_invoker/,
    'the exception must be stated where the next person edits it');
  assert.match(sql, /comment on view public\.v_track_reach is/,
    'and recorded on the object itself, where a schema dump shows it');

  const views = await read('supabase/migrations/20260919094143_native_telemetry_views.sql');
  assert.match(views, /security_invoker = true/,
    'the owner-only views must stay owner-only');
});

test('crawlers do not get a vote in what the shelf shows first', async () => {
  const sql = sqlCode(await read(REACH));
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
  assert.match(js, /function card\(t\)/, 'tracks must be able to render as cards');
  assert.match(js, /function albumCard\(a\)/, 'so must albums');
  assert.match(js, /class="feat__bg"/, 'the art is the card, not a thumbnail on it');
  const html = await read('listen.html');
  assert.ok(html.indexOf('id="top"') < html.indexOf('id="all"'),
    'the rails must come before the index');
});

test('a search puts the browse aids away', async () => {
  const js = await read('js/listen.js');
  assert.match(js, /el\("topWrap"\)\.hidden = searching \|\| chip !== "all";/,
    'the start-here rail is for people who have not decided yet');
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
