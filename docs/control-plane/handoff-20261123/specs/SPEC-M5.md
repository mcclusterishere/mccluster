# SPEC M5: one player across music pages

Slice M5 of the music release (record: `docs/music/MUSIC-RELEASE-20261119.md`, "Bounded finish order after this
recovery", item 2). Base: branch `claude/new-session-83ken5` at `dc0185aad8f3781a683bc721ac740c0a98f9099e` (main
`b51ede03` plus M3 and the M3 follow-up, verified, not merged, not deployed). This document is the design and the
build plan; it changes no repository file. Every `path:line` below is at `dc0185aa`.

D-5 ("one long-lived player across music pages") is Matthew's decision and is still unanswered. This slice builds the
music map's recommended default on the branch only, behind one switch, so he can review it or stop it. The record
section must say so in its first lines.

Labels: **Measured** = seen in Chromium in this step (route fixtures, nothing reaching production) or read from
production aggregates; **Read** = read in code at `dc0185aa`; **Inferred** = reasoned, not observed. Nothing here was
observed on an iPhone, an iPad or in WebKit. Every device statement is Inferred until Matthew's devices run the rows in
section 12.

---

## 1. The decision

**Keep the first music page the listener opens as the one document that plays, and open the other music pages over
it, each in a fresh same-origin frame: a frame per view, not a document swap.** This is the Music-to-World pattern
(`js/world-audio-continuity.js`, `docs/music/MUSIC-WORLD-CONTINUITY.md`) generalised from one cross-origin World frame
to same-origin music views.

- The **retained document** is the top-level page: the first supported music page loaded in the tab (Listen, an
  artist page, or the album). It owns every element that can sound (the engine's `Audio`; on the album also its deck)
  and the one `js/now-playing.js` realm that speaks to the device. It never navigates during supported navigation.
- A **view** is another supported music page shown over it in one fresh `<iframe>` (one at a time). A view keeps its
  own document, scripts, head and URL; it owns no music element and binds no Now Playing. Its play controls call the
  retained document's player in the same tap.
- The address bar shows the view's real URL (`history.pushState`), so sharing, bookmarking, deep links and a refresh
  land on the exact page. Back and Forward move between views without reloading the retained document.

Why this and not the alternatives:

| Option | Verdict |
| --- | --- |
| Document swap (fetch the next page, replace `<main>` and `<head>`, re-run its scripts) | Rejected. About fifteen page scripts (`js/listen.js`, `js/music-creator-profile.js`, `js/music-community.js`, `js/creator-onboarding.js`, `js/masthead.js`, `js/live-content.js`, `js/analytics.js`, album.html's 1,800-line inline player, ...) assume one page per document and are not re-entrant; every head would need swapping. A rewrite of the music pages, which hard rule 8 and the record's "no new backend, reuse what exists" both argue against. |
| Frame per view over a retained document | **Chosen.** Pages and heads stay as they are (crawlers see the same pages), the mechanics already ship for the World, memory is bounded (one view frame), and every failure can fall back to today's page load. |
| A new shell page (`music.html`) that frames every music page | Rejected. A new entry URL; direct loads of each page would need redirects or would keep today's behaviour anyway. |
| Better pocket recovery only | Not continuity. `js/pip.js` and `listener_state` stay position recovery (record, item 2). |

The smallest version that reuses what exists: one new file for the retained document and its views
(`js/music-shell.js`, loaded by `js/tabbar.js` the way `js/world-audio-continuity.js` is), one small stylesheet, an
early view check in `js/shell-boot.js` (already the first script in every music page's head), a view mode in
`js/music-engine.js`, and a few lines elsewhere (section 6). No Worker, SQL, `supabase/` file, auth code, session store,
database or player engine is added or changed.

---

## 2. What happens today (Measured at `dc0185aa`)

Probe `spec-M5-probes/measure.mjs` (in this step's scratch folder, not the repository): Chromium with
`--autoplay-policy=document-user-activation-required`, the house origin served from the worktree, Supabase and the API
answered by fixtures, synthetic WAV for every song, real taps on real links. Results `spec-M5-probes/out/*/measure.json`.

| # | Route | What happens to the playing element |
| --- | --- | --- |
| A | Listen, song playing (2.0 s) -> an artist card (`a.artist`, `music-creator.html?handle=`) | A new document. Nothing plays. The artist page holds nothing either: it loads no `js/pip.js`, so the engine there has no record to offer. **Back**: Listen loads afresh (not from the back-forward cache), nothing plays, its mini player offers "Pick up at 0:02". **Forward**: the artist page, nothing. |
| B | Artist page, its creator release playing -> the header's Music link to Listen | A new document. Nothing plays and nothing is held: the engine never banks a creator release (`js/music-engine.js:1245-1253`). At 390 px the context bar's Listen and Library links are not shown (`css/music-system-v2.css:67-68`, shown from 700 px); the brand link and the bar's Music tab are the way there. |
| C | Listen, song playing -> the Now sheet's Album link (`album.html?album=here&t=...`) | A new document. The album seats the asked-for song at **0:00, paused** (the `t=` link beats the pocket by design, `album.html:2266-2284`). **Seen at 390 px**: the fixed account chip (299,12, 79x44) lies over the whole Album link (336,20, 32x16); a tap there opens Sign in, not the album. |
| D | Album, song 2 playing -> Library (`catalogue.html`, at 1280 px) and Back | On the catalogue the pocket started the song again after the page load (Chromium let it play after a real tap on a same-origin link). **Back** to the album: the deck is seated **paused** at the pocket's second (5.91 s). The music stops at the return. |
| E | Album, playing -> `account.html?next=/album.html?album=here` (the browser's own navigation) -> password sign-in | On the account page the pocket says "Tap to pick it back up" (paused at 2.13). After sign-in `account.html` replaces itself with the album, which seats the deck **paused** at 2.13. |
| E2 | The same by a real tap on the album's own "Sign in" link (the comment box) | Chromium let the pocket play on the account page; after sign-in the album seats the deck **paused** (5.46). Away 6.4 s; the music stops at the return. |
| F | Album, playing -> the bar's Sign in chip (`account.html`, no `next`) -> password sign-in | After sign-in the listener lands on **`/mnet.html`** (the World on the house origin, `account.html:348-375`). Nothing plays; the album and its song are gone. |
| G | Listen, playing -> Globe (today's retained document) | The same `Audio` object, advancing 2.02 -> 5.10 -> 6.62 s; address `/listen.html?world=1`; Back closes the World with the same element. This is the behaviour M5 generalises. |

Platform facts the design rests on (probe `spec-M5-probes/feasibility.mjs`, Chromium only):

- **F1** A tap inside a same-origin frame lets the parent's audio element play, whether the frame calls the parent in
  the tap, by a message, or 1.5 s later; with no tap anywhere the parent's `play()` is refused (`NotAllowedError`).
  Chromium passes a tap's activation to ancestor frames. WebKit's model is a gesture in progress, so the design always
  calls the retained player **synchronously inside the tap** (Inferred safe in WebKit; device row 3).
- **F2** History: a fresh `<iframe>` element per view adds **no** session-history entry; changing an existing frame's
  `src` adds one; `location.replace()` inside the frame adds none; the top's `pushState` adds one. So every view gets
  a fresh frame element, and only the retained document writes history.
- **F3** A sign-in written to `localStorage` by a same-origin frame reaches the parent as a `storage` event. The
  account-change listeners slice M4 put on every music page (`MCC.onAccountChange`) therefore hear a sign-in made in
  a view.
- **F4** This Playwright Chromium never restored even a plain page from the back-forward cache (`persisted` false), so
  nothing about the back-forward cache is measured here; it stays Inferred.
- In Chromium, after a **real tap** on a same-origin link, the next page's pocket started its audio without another
  tap (D, E2, F); after a navigation the browser started on its own (E, lane 01 probe S8) it did not. WebKit decides
  autoplay per document (WebKit blog 6784; lane 03 section 1.3), so on an iPhone the pocket asks for a tap (Inferred).

Production, read-only aggregates (Supabase `SELECT`, counts only, no ids or rows; 35 days to 2026-11-23):

- `pocket_open` (the pocket mounting on a page with a banked record, playing or paused; `js/pip.js:717`): on
  `account.html` **59 events from 27 devices** in 40 sessions over 21 days; of these, 30 events from 16 devices came
  from `album.html`, 5 from Listen. The map's "50 of the last 80" is broad, not one person. It counts page loads with a
  banked record, not proof of a song playing at the tap.
- Page views between music pages (same-site referrer): **Listen -> album 88 views / 37 devices**, **album -> account
  31 / 17**, **album -> Listen 26 / 13**, Listen -> account 8 / 7, album -> catalogue 4 / 3, **Listen -> artist page 3 / 3**.
- Of those, how many followed a song started on the page left earlier in the same session: Listen -> album 30 of 88;
  **album -> account 29 of 31**; album -> Listen 18 of 26; Listen -> account 3 of 8; Listen -> artist 0 of 3.
- Sign-in methods switched on in Supabase (public settings, read without signing in): **email and password only**;
  no Google, Apple, Facebook or X today.

So the recorded first pair (Listen and the artist pages) is the least travelled; it is first because both pages
already share the one engine (`MCC_MUSIC`), which makes it the right place to prove the mechanism. The value is in the
album: album -> account, album <-> Listen. Section 5 orders the routes accordingly.

---

## 3. The design

### 3.1 Roles

| Document | Who | Owns |
| --- | --- | --- |
| Retained document | The top-level page: the first supported music page loaded in this tab (Listen, an artist page, the album) | Every sounding music element, the one Now Playing binding realm, the bar, the account chip, the installed-app dock, history |
| View | One supported music page shown over it in a fresh `iframe#mccMusicViewFrame` | Its own content, head, scripts, analytics page view. No music element, no Now Playing, no bar of its own (hidden before first paint) |
| World frame | Unchanged (`js/world-audio-continuity.js`) | The World on `mccluster.org` in its own cross-origin frame, opened over whatever the retained document shows |

The retained document is never `index.html` (hard rule 3): the front page has its own scene engine, is never a
retained document and is never shown in a frame. A link to it is an ordinary page load.

### 3.2 Routes and stages

The shell reads one table (`ROUTES` in `js/music-shell.js`). Turning a stage off restores today's page load for its
routes; turning all off restores `dc0185aa` behaviour (the switch for Matthew's "stop it").

| Stage | Retained document can be | Opens as a view | Everything else |
| --- | --- | --- | --- |
| 1 (first pair) | `listen.html`, `music-creator.html?handle=<valid handle>` | the other of the two (and Listen over Listen is a reveal) | page load |
| 2 (album, through its deck controls) | also `album.html` (any `album`, `playlist`, `track`, `t`) | Listen and artist pages over the album | a link to another album, or to `album.html` from an engine-owned document, stays a page load |
| 3 (sign-in) | (same as above) | `account.html` (and `account.html?next=...`), over any retained document | the paths that must leave the site (section 4) |

A supported view is identified by path plus an early marker: each supported page gets
`<html ... data-music-view="listen|artist|album|account">` (one attribute, no head change). The marker is what
`js/shell-boot.js` checks before any body script runs.

### 3.3 Who owns sound and Now Playing

- **Engine documents (Listen, an artist page).** The engine (`js/music-engine.js`) in the retained document is the
  only player. A view loads `js/music-engine.js` as today but in **view mode** (`window.MCC_MUSIC_VIEW` set by
  `js/shell-boot.js` before the engine runs): it creates no `Audio` (`js/music-engine.js:19`), no mini player or Now
  sheet, binds no Now Playing (`:1320`), banks and restores nothing (`:1252-1319`). Its `window.MCC_MUSIC` is a facade
  that calls the retained engine (`play`, `playCreator`, `registerCreatorTrack`, `pause`, `resume`, `next`,
  `previous`, `openNow`, `current`, `access`, `delivery`, `playing`, `toggle`, `unmute`), so the artist page's
  `registerCreatorTrack` calls (`js/music-creator-profile.js:303-319`) and Listen's (`js/music-community.js:104`)
  register with the one queue. The facade's own capture handlers for `[data-music-play]` (the view's document; the
  retained engine's handler `:1228-1243` only sees its own document) call the retained engine **synchronously in the
  tap** (F1), and repaint the view's buttons from the retained window's `mcc:music-state` (`:437`). Choosing a track
  therefore runs the existing resolver (`sourceFor`, `creatorSourceFor`: catalogue file, the gate's `resolve`/`claim`,
  `music-access`) and the existing queue (`playAdjacent`). Creator releases registered by several artist views
  accumulate in that one queue, as the engine already does on a page.
  - An artist-page retained document lacks `js/listen-ledger.js` and `js/pip.js`; before the first catalogue song
    chosen in a Listen view plays, the shell loads both into it (`MCC_LISTENS` for counted listens, `MCC_POCKET` for
    banking; `js/pip.js` returns before mounting because the engine exists, `:226`). The engine's `restore()` already
    ran, so nothing is held by surprise and the artist page's direct-load behaviour does not change.
- **The album as the retained document (stage 2), through its existing deck controls.** The deck stays the album's
  player with its own resolver and queue (`play(i)`, `primeDeck`, the earned claim, the wrap). Over a view the
  album's own transport stays on top: the deck bar (`#deckbar`, `album.html` CSS z-index 60) and the sheet (`#now`,
  z-index 210) remain visible and live; the World's compact transport, the bar and the installed dock keep reaching the
  deck through `MCC_NP_PLAY`, `MCC_NP_PAUSE`, `MCC_DECK_DELIVERY` and `mcc:nowplaying` exactly as the World does today
  (`js/world-audio-continuity.js:102-111`). A play chosen **inside a view** over the album needs the engine: the shell
  loads `js/music-engine.js` (and `css/music-engine.css`) into the album document when the first view opens, in a
  guest configuration (`restore` off, so it never offers the album's own banked record). One owner at a time, through
  the existing controls: when the engine selects a song the shell calls the album's `MCC_NP_PAUSE()` first (the
  deck's own Pause, the path slice M3 requires for any outside pause); when the deck plays the shell calls
  `MCC_MUSIC.pause()`. One visible transport: `html[data-music-owner="engine"|"deck"]` shows the owner's bar and hides
  the other's (both sit in the same slot above the tab bar). `js/now-playing.js` already gives the lock screen to the
  player that played last (slice M2), and both bindings live in the album's one realm.
- **Pause and mute stay deliberate.** Opening, switching or closing a view never calls `play()`, `pause()` or changes
  `muted` on any music element. The shell has no autoplay path. The World's mute stays the World's (D-7).
- **Media inside a view.** If a view's own audible media starts (none of the stage pages has any today), the view
  agent tells the shell, which pauses the retained player through its own Pause (the World's rule,
  `js/world-audio-continuity.js:799-802`). One owner of sound.
- **One Now Playing realm.** Only the retained document's `js/now-playing.js` writes `navigator.mediaSession`. Views
  load the file (Listen and the artist page carry it) but never bind; its in-app note already shows only in a top
  document (`js/now-playing.js:391-395`).

### 3.4 Views: lifecycle, the view agent and routing

- **Opening.** The shell creates a fresh `iframe#mccMusicViewFrame` (src set before insertion: no history entry, F2),
  hidden, inside `section#mccMusicView` (fixed, inset 0, z-index 50: under the engine mini player (72,
  `css/music-engine.css:5`), its sheet (140, `css/music-system-v2.css:375`), the album deck bar (60) and sheet (210),
  the bar (200) and the chip (999); over the retained page's content).
  The previous view or the retained page stays on screen until the new view has painted (the World's `whenPainted`
  idea; owner 2026-10-20: no screen flashes). Then the old frame is removed. At most one view frame exists after each
  switch.
- **Concealing the retained page.** While a view shows, the retained page's own content is `inert` and hidden (the
  World's `concealMusic` approach over the body's children, `js/world-audio-continuity.js:520-526`), except an
  explicit allow-list of chrome and transport kept in `js/music-shell.js`: the shell itself, `.appbar`, the chip's
  `nav.mcc-auth-nav`, the engine's `#musicMini` and `#musicNow`, the album's `#deckbar` and `#now` sheet,
  `#mccDestinations`, the World's shell and controls, and `#mccPrivacyNotice`. A unit test reads each stage page and
  fails when a fixed transport or status element outside the list would be hidden. On the album the room stops drawing
  and its film pauses while concealed: `js/chamber.js` already stills a hidden page (`:220-221`) and gains the same
  branch for the shell's `mcc:music-view` event. Nothing in the retained page is torn down; its scroll position stays.
- **The view agent** (part of `js/music-shell.js`, activated in the frame by `js/shell-boot.js`):
  - `js/shell-boot.js`, first in every music page head, checks (in its frame branch, before the existing
    `if (!topLevel) return;`): not top-level, parent same origin (read inside `try`), parent has `MCC_MUSIC_SHELL`,
    and `window.frameElement` is the shell's own view frame. Only that frame is ever checked: every other frame (the
    World's, which is another origin; Control's front-page preview; any embed) is left exactly as today. With
    `<html data-music-view>` present it calls `parent.MCC_MUSIC_SHELL.adopt(window)`, which accepts only its pending
    frame and the expected URL and returns the view API. On acceptance it sets `html.mcc-music-view` (the view's bar
    and chip are hidden by CSS before first paint, as `html.mn-music-frame` does for the World,
    `css/style.css:1619-1620`).
  - In a view, `js/tabbar.js` builds no bar, chip or dock, adds no handoff listener and loads no World module;
    `js/world-audio-continuity.js`, if loaded, returns before its theme, watchers, `leaveFrame` and its child greeting
    (`js/world-audio-continuity.js:676-683`, `:803-805`), which would otherwise treat a same-origin view as the World
    frame and greet the retained document.
  - **Unexpected documents are stopped.** Any document that starts loading in the frame without being expected
    (`location.replace(next)` after a sign-in, Listen's search Enter `js/listen.js:448`, the creator door
    `js/creator-onboarding.js:249-251`, the service worker's offline fallback to `index.html`, `sw.js:126-133`) is not
    adopted: `js/shell-boot.js` calls `window.stop()` before its body runs and hands the URL to the shell, which routes
    it like a link (reveal, view, or a page load of the top document). `index.html` therefore never renders in a
    frame. A document without `js/shell-boot.js` that loads in the frame is caught at the frame's `load` and routed
    the same way; one the shell cannot read (another origin) shows the failure card below.
  - **Links.** The agent listens for clicks on the view's `window` in the capture phase (it runs before every
    document listener, so before `js/tabbar.js`'s and the World's) and asks the shell where each link goes. Modifier
    keys, non-left buttons, `target="_blank"`, `download`, `mailto:` and `tel:` are left alone, as `js/tabbar.js` does.
    In the retained document the shell listens on the document in the capture phase too, after the World's listener
    (World links keep their existing path), and `sail()` in `js/tabbar.js` asks the shell for the bar's own taps.
  - **Script navigations to other origins** cannot be caught after the fact; the audited one in the stage pages goes
    through the view API: the artist page's licence checkout (`js/music-creator-profile.js:403`, Stripe) and, in
    stage 3, the account page's provider start (section 4). A unit guard lists every `location.href=` /
    `location.assign` / `location.replace` / `window.open` in the stage pages' scripts and fails on a new
    cross-origin one that skips the view API.
  - **URL changes inside a view** (the artist page's `#album=` hash, `js/music-creator-profile.js:374`) are forwarded
    and mirrored into the top address with `replaceState`.
  - **Events the retained document needs**: the artist page's `mcc:perspective` (`js/music-creator-profile.js:295`)
    is forwarded to the retained window so the bar takes the artist's perspective as it does today (`js/tabbar.js:499`).
- **Routing table** (one function, `route(url, from)`; unit-tested):

| Destination | From a music view or the retained page | From the account view |
| --- | --- | --- |
| The retained document's own URL | Reveal it (push an entry) | Reveal it |
| The album the retained album document shows, with other `t=` (stage 2) | Reveal it and bring the named row into view, highlighted; what plays does not change (the person taps the row) | Reveal it |
| Another supported view URL | Open it as a view | Open it as a view |
| The World (`mnet.html` on the house, the World hosts) | The existing Music-to-World path (`MCC_WORLD_AUDIO.navigate`), unchanged | A page load of the top, as from `account.html` today |
| `album.html` not hosted by this document, `index.html`, any other house page | Page load of the top (with the bar's handoff where it applies) | Page load of the top |
| Another origin | Page load of the top (handoff for ecosystem hosts, `js/tabbar.js:900-912`) | Page load of the top |

- **Failure.** If a view has not painted in 8 s, or its frame errors, the shell shows a small card over the view area:
  "This page is taking long to open. Your music is still playing." with **Open the page** (a page load of the top,
  today's behaviour) and **Back** (44 px targets, phone first). The music never stops for a failed view.

### 3.5 History, URLs, deep links, Back/Forward, scroll and focus

- First view from the retained page: `replaceState` adds `{mccMusicShell:{top:true, scroll}}` to the current entry;
  then `pushState({mccMusicView:{href, scroll:0}}, "", href)`. View to view: the current entry's scroll is saved
  with `replaceState`, then a new entry is pushed. Only the retained document writes history (F2).
- `popstate` in the retained document: an entry with `mccMusicView` shows that view (a fresh frame) and restores its
  scroll after paint; an entry without it reveals the retained page and restores its scroll. The World's entries keep
  working: `js/world-audio-continuity.js` copies the current state into its own entry (`:580`), so Back from the World
  lands on the view that was under it. While the shell has written an entry, the retained document sets
  `history.scrollRestoration = "manual"`, so the browser never restores the retained page's scroll over a view.
- A script navigation inside a view that the shell catches and routes (3.4) can leave one entry for that frame; the
  frame is removed right after, and browsers drop a removed frame's entries, so Back never lands on a stopped
  document (checked in test 11).
- `js/world-audio-continuity.js` read the address and title once at load (`baseHref`, `baseTitle`, `:23`); with views
  the World opens from the current address (`?world=1` added to the view's URL) and restores the current title on
  close.
- Deep links are untouched: every supported URL still loads its own page directly (`music-creator.html?handle=x#album=
  alb_y`, `album.html?album=x&t=y`, `listen.html`). A loaded page becomes the retained document of that tab.
- Focus: on a view, focus moves into the frame and onto its `h1` (`tabindex=-1` while focused); a polite live region in
  the retained document says the page's name. On reveal, focus returns to the control that opened the view, or the
  page's `h1`. Concealed content is `inert`, so neither Tab nor a screen reader reaches it.
- The bar's Music tab: on the Listen retained document with no view shown it stays the transport (M3 follow-up,
  `js/tabbar.js:1136-1145`); with a view shown it is the way back to Listen (reveal or view). `onPage()` reads the
  current view, not the retained document's first path.

### 3.6 Metadata for people and for crawlers

- **Crawlers** load each URL directly and never see a view: every page keeps its own static head (title, description,
  canonical, Open Graph, JSON-LD, `@id`s). The only page edit is the `data-music-view` attribute on `<html>`. A static
  guard checks the supported pages' heads are unchanged otherwise, and `scripts/test/domain-architecture.test.mjs`
  stays green.
- **People** (the live tab): while a view shows, the retained document's `document.title`, `meta[name=description]`
  and `link[rel=canonical]` mirror the view's (removed when the view has none: the artist page has no canonical and
  its title and description are set by its own script, `js/music-creator-profile.js:282-284`, so the mirror follows
  later changes). The retained page's own JSON-LD and `og:*` are held aside (not readable as the page's identity)
  until it is revealed, then restored byte for byte. Chrome on Android shares a page's canonical; without this an
  artist page (McCluster Music, the artist's identity) would share as Listen or the album (Matthew's). Hard rule 15:
  each page keeps its own entity; the shell never shows one page's identity under another's URL.

### 3.7 Analytics under the existing consent rule

- Each view records its own `page_view` (its path and title) from its own `js/analytics.js`, under the same consent
  check, exactly as a page load does (`js/analytics.js:1109-1115`, `:418-423`; the Control preview rule `:32-35` does
  not apply, the parent is a music page). No consent, no events, in either document. Revealing the retained page
  records nothing new (as a back-forward restore records nothing).
- The retained document's events must keep its own page: after `pushState` its `location` is the view's, and
  `queueEvent` reads `location` at event time (`js/analytics.js:522-536`), so every later event of the retained page
  (a song ending, a share, its dwell) would be filed under the view's path, and on an artist view would also gain that
  artist's `creator_handle`, the key the Worker's creator page report selects on
  (`workers/mccluster/src/analytics/router.js:1023-1029`). Change: analytics fixes its page identity (path and query)
  when it loads. The engine passes the page a song was **chosen on** with its music events (path, and an artist's
  `creator_handle`), so a release chosen in an artist view is filed as it is today when chosen on the artist page;
  per-track creator counts already key on `creator_track_id` and do not move.
- Referrer: the shell inserts the frame before it changes the address, so a view's `document.referrer` is the page it
  was opened from, as with a page load, and the page-to-page counts in section 2 keep their meaning. A view rebuilt by
  Back or Forward would see the address it is rebuilt at; for those the view's analytics takes the referrer from the
  shell (the page shown before), one more small change in `js/analytics.js`.
- Dwell (`js/analytics.js:767-785`) is per page: the retained page reports its dwell when a view opens and starts a
  new count when it is revealed; each view reports its own.

### 3.8 The bar, the chip, the installed dock and the World

- One bar: the retained document's. Views hide theirs before first paint (`html.mcc-music-view`). The coin stays on
  Music. The chip is the retained document's; the view's is hidden (its header already reserves the chip's space,
  `css/music-system-v2.css:42-51`).
- The installed-app dock exists only in a top-level document (`js/installed-app-dock.js:6`, `js/tabbar.js:1513-1521`)
  and reads the one Now Playing owner; across views it keeps showing and controlling the same song. Its "open player"
  opens the retained document's sheet over the view.
- The World opens over a view with the same element (the existing path); its compact transport chooses the player
  that owns sound (stage 2 makes `selected()` ask the shell for the owner instead of preferring the engine whenever it
  has a current song).
- The middle tab's artist perspective follows the artist view (forwarded event, 3.4).

### 3.9 Links that leave, refresh, eviction, the back-forward cache, memory

- **A non-music link** (the M, the house card on Listen, the profile, hire, sites, privacy) is a page load of the top
  document. The song ends there; the next page's pocket is the documented recovery (Chromium may resume after a tap;
  WebKit asks for a tap, Inferred).
- **An external link** opening a new tab leaves the retained tab playing. A same-tab external link is a page load.
- **The privacy notice's Agree** reloads the top document (`js/live-content.js:481`; the notice never shows inside a
  frame, `:211-213`). Unchanged: it ends the song as it does today, and the reload lands on the address shown.
- **A link out of the World** to an album, an artist page or Control still replaces the top document
  (`js/world-audio-continuity.js:676-683`, the World's own rule); unchanged in this slice (section 5, later).
- **A refresh** loads the address, which is the view's URL, as a new retained document. The browser has destroyed the
  old element. Each page keeps its documented recovery, never presented as continuity: Listen holds the banked record
  ("Pick up at m:ss"), the album seats it paused, an artist page holds nothing (no pocket there; unchanged).
- **A tab the system evicted** comes back as a refresh.
- **The back-forward cache**: after a page load away from the shell and Back, the browser may restore the whole
  retained document with its view; browsers pause media there. On `pageshow` with `persisted` the shell re-syncs the
  view with `history.state` and never starts sound. Not measurable in this harness (F4): Inferred.
- **Memory**: the retained document plus at most one view frame (plus the World frame if opened, as today). Each view
  frame is new; the previous one is removed after the new one paints. Nothing piles up after any number of switches.

### 3.10 Layout (phone first, hard rule 14)

`css/music-shell.css` is written for 320 and 390 px first, `min-width` queries only, `minmax(0,1fr)` where a grid is
used, the failure card's buttons at 44 px and its text never smaller than the page's. The view's bottom padding is at
least the measured height of the retained document's bottom stack (bar plus mini player or deck bar, or the installed
dock), passed as `--mcc-view-clear`, so the last thing on a view is never under the transport. Only the top document
takes the device's safe-area insets (`js/shell-boot.js` already gives `mcc-app-top` to the top only), so the frame sits
inside the top's safe area and a view's header never lies under the status bar or the notch in the installed app.
`scrollWidth === clientWidth` in the retained document and in the view at 320, 390, 820 and 1280 px.

### 3.11 What the web cannot do

- Keep sound through a refresh, a tab the system evicted, closing the tab, or any page load of the top document (a
  non-music link, an external link, a provider sign-in, a checkout).
- Start sound in a new document without a tap in WebKit (iPhone, iPad, every iOS browser): the pocket's "Tap to pick
  it back up" stays (Inferred from WebKit's per-document policy).
- Promise iOS keeps a long-lived page alive in the background; a page lives while audible plus about 10 s
  (WebKit source, lane 03) and can be evicted under memory pressure (Inferred).
- Run a provider sign-in (Google, Apple, Facebook, X) inside a frame: providers refuse framing and the PKCE return is a
  top-level redirect by design.
- Keep audio playing in the browser's back-forward cache.
- Share one player across tabs or devices (`listener_state` is a position, not a session).
- Bring the cross-origin World into the music document (it stays its own frame).

---

## 4. Sign-in continuity

Every sign-in path `account.html` offers at `dc0185aa` (Read, and Measured where marked):

| Path | How it works | Can it keep the song? |
| --- | --- | --- |
| Email and password (`#acGo`, `account.html:395-406`) | Same-origin call to Supabase (`MCC.signInWithPassword`, `js/mcc-auth.js:517-529`), writes the two session keys, then `paint()` -> `goOn(next)` (`account.html:348-375`): `/v1/mnet/bootstrap`, then `location.replace(next)` (or the World's `?finish=1` pages when the profile is unfinished, or the World when there is no `next`) | **Yes, inside the shell.** It is the only sign-in switched on in production. |
| Google, Apple, Facebook, X (`account.html:593-623`) | Painted only when switched on in Supabase (none are today, Measured); `MCC.signInWithProvider` stores the PKCE verifier in `sessionStorage` and `location.assign`s Supabase's authorize URL (`js/mcc-auth.js:296-310`); the return is `/auth/` (top level) then `/account.html?next=...` | No: the provider page refuses a frame. In a view the provider start runs in the top window (the retained document's own `MCC`, same `sessionStorage`), so the redirect, the verifier and the return are exactly today's; the song ends there and the next page's pocket is the documented recovery. |
| Magic link | Disabled in the product: `MCC.signInWithEmail` always rejects (`js/mcc-auth.js:735-737`) | Not a path. |
| Passkeys | None in this codebase (no WebAuthn call in any page or script) | Not a path. |
| Create account (`account.html:172`, `:342`) | A link to the house's `mnet.html?join=1&next=...` (the World's one sign-up form, owner 2026-10-20) | No change: a page load of the top, as from `account.html` today (not the World frame on `mccluster.org`, which would sign the person up on the other host). |
| Forgot password (`account.html:413-416`) | `forgot-password.html`, then an e-mailed link to `reset-password.html` | Page load of the top, as today. |
| The house owner after sign-in (`account.html:307-311`) | `location.replace("control.html#home")` | Caught as an unexpected document, routed as a page load of the top, as today. |
| The World's door | Signing in inside the World (on `mccluster.org`) makes a session for that host (D-10 keeps hosts separate); the music already keeps playing there (Music-to-World) | Unchanged. |
| Arriving with the bar's handoff (`js/tabbar.js:917-964`) | A top-level arrival from another host; it reloads to start signed in | Unchanged (a new document by nature). |

**Decision: in scope (stage 3), on the password path only.** `account.html` opens as a view over the retained
document; the person signs in exactly as today (same function, same storage keys, same events, same `?next` rules,
`MCC.safeNext` untouched); the retained document hears the sign-in through `storage` (F3), so the album's gated rows,
Listen's offers and the bar repaint (slice M4); `goOn(next)`'s `location.replace(next)` starts loading inside the frame,
is stopped by the view check and routed: back to the retained page when `next` is that page, a view when it is
another supported page, a page load otherwise. The song never stops for a password sign-in. Everything else leaves by a
page load of the top exactly as today. If the account view cannot open or adopt within 8 s, the shell does today's page
load. Auth behaviour does not change: `js/mcc-auth.js` is untouched; `account.html` changes in one place (the provider
start uses the top window when it is a view) plus its `data-music-view` attribute.

Why it is safe: no token, credential or session code changes; the sign-in runs in a same-origin document with the same
storage; every path that must leave the site leaves the way it does today; production has only the password path
switched on; the fallback is today's page load. What stays Inferred: iOS AutoFill, the keyboard and password managers
inside a same-origin frame (device rows 6 and 7).

**One default for Matthew to confirm**: a sign-in link without `next` (the bar's chip `js/tabbar.js:608`, the song
test `album.html:1000`) opened from a music page carries `next` = the music page the person is on, so they come back to
their music (today: the World after a chip sign-in, Measured F). One line to revert.

---

## 5. Route order

1. **Stage 1, the first pair:** `listen.html` and `music-creator.html?handle=<handle>`, each as the retained document
   and as a view. Proves the shell, the view agent, the engine facade, history, metadata, analytics, the bar and dock,
   refresh honesty and memory. Gate before stage 2.
2. **Stage 2, the album through its existing deck controls:** `album.html` as a retained document with Listen and
   artist views over it (album -> Listen: 26 views, 18 after a song). Gate before stage 3.
3. **Stage 3, sign-in:** `account.html` as a view over any retained document (album -> account: 31 views, 29 after a
   song; Listen -> account 8). Gate.

**Not in this slice (later), and why:**

| Route | Why later |
| --- | --- |
| `album.html` as a **view** over Listen or an artist page | The album's player (deck, gate claim, room, lyrics, sheet; about 1,800 lines inline in `album.html`) is tied to its own document; a view's deck would be a second player in a second realm, and driving the engine from the album's rows would change its resolver and queue. Needs the album player moved into the retained document (a refactor of its own). **The largest remaining gap**: Listen -> album, 88 views, 30 after a song. |
| `catalogue.html` | No player; a safe view once stage 1 holds (album -> catalogue 4 views). |
| `license.html` | No player; checkout and a lead form leave the site; a safe view later. |
| `music-videos.html` | Has its own `<audio id="deck">` and video; the same problem as the album. |
| `prim3-artist.html` | A static artist page; a safe view later. |
| `creator.html` (Creator Studio) | Uploads and long writes; never interrupt them; later and on Matthew's word. |
| The house's other pages (profile, hire, sites) | Not music pages; `pocket_open` shows listeners go there (profile 16, sites 9, hire 7 events in 35 days). Matthew's call. |
| Links out of the World to an album or an artist page | They replace the retained document by the World's own rule (`js/world-audio-continuity.js:676-683`); opening them as views changes the Music-to-World contract. Matthew's call. |
| `index.html` | Never (hard rule 3). |

---

## 6. File plan

Stage tags: [1], [2], [3]. Every changed file keeps its existing behaviour when the shell is off.

| File | Change |
| --- | --- |
| `js/music-shell.js` (new) [1-3] | The retained document and the view agent: `ROUTES` switch; `route(url, from)`; fresh frame per view, paint-before-swap, one frame; conceal/reveal with the allow-list; `--mcc-view-clear`; history state, `popstate`, scroll and focus; metadata mirror and restore (title, description, canonical; JSON-LD and `og:*` held aside); `adopt(window)` by frame identity and expected URL; window-capture link routing in views; forwarding of view URL changes and `mcc:perspective`; the failure card; capability loading for artist-page documents (`js/listen-ledger.js`, `js/pip.js`); [2] the album: guest engine on first view, owner switching through `MCC_NP_PAUSE`/`MCC_MUSIC.pause`, `data-music-owner`, `owner()`, the bar's glyph for the owner; [3] account view rules and the default `next`. Exposes `window.MCC_MUSIC_SHELL`. |
| `css/music-shell.css` (new) [1] | `#mccMusicView` layer and frame, concealment, `html.mcc-music-view` (view's bar and chip hidden), the failure card, `--mcc-view-clear`; [2] `data-music-owner` bar visibility. Phone first, `min-width` only. |
| `js/shell-boot.js` [1] | The early view check (about 15 lines): `<html data-music-view>`, same-origin parent shell, `adopt(window)`, `html.mcc-music-view`; otherwise `window.stop()` and hand the URL to the shell. Inert at top level (index.html's behaviour unchanged). |
| `js/tabbar.js` [1] | Load `js/music-shell.js` on supported retained pages (like `loadWorldAudio`, `:23-50`); `sail()` (`:1280-1300`) asks the shell after the World; `onPage()`/`musicTabTransport()` read the shell's current view; in a view it builds no bar, chip or dock, adds no handoff listener (`:1011-1023`) and loads no World module (the retained document's bar already follows a sign-in made in a view through `storage`, `:1026-1028`). |
| `js/music-engine.js` [1][2] | View mode: no `Audio`, no UI, no Now Playing, no bank/restore; the facade over the retained engine; synchronous tap path; button painting from `mcc:music-state`. Retained mode: a `from` page context on `play`/`playCreator` for event props (`creator_handle`). [2] Guest configuration (`restore` off) for the album document. |
| `js/world-audio-continuity.js` [1][2] | Return early in a view (no theme, no watchers, no `leaveFrame`, no child greeting `:803-805`); open the World from the current address and restore the current title (`:23`, `:578-581`, `:614`); [2] `selected()` asks the shell for the owner. |
| `js/pip.js` [1] | Return before mounting in a view (the account view loads it, `account.html:684`; a pocket there would be a second player). |
| `js/analytics.js` [1] | Page identity fixed at load for `path` and `creator_handle`; the chosen-on page from the engine on music events; a view's referrer from the shell on Back/Forward; dwell flushed on `mcc:music-view` open, restarted on reveal. About 20 lines. |
| `js/music-creator-profile.js` [1] | The licence checkout's cross-origin navigation through the view API in a view (`:403`). |
| `listen.html`, `music-creator.html` [1] | `data-music-view` on `<html>` only. |
| `album.html` [2] | `data-music-view="album"` on `<html>`; the room film pauses on `mcc:music-view` (and resumes on reveal). |
| `js/chamber.js` [2] | Still while a view covers the album (the same branch as a hidden page). |
| `account.html` [3] | `data-music-view="account"` on `<html>`; in a view the provider start calls the top window's `MCC.signInWithProvider` (one line in `:607-617`). |
| `scripts/test/music-shell.test.mjs` (new) [1-3] | Unit tests (section 7). |
| `scripts/e2e/music-shell.e2e.mjs` (new) [1-3] | Chromium suite (section 7), the harness pattern of `scripts/e2e/music-world-continuity.e2e.mjs`. |
| `scripts/test/music-background.test.mjs` [1] | The lifecycle guard ("leaving the page pauses nothing") also covers `js/music-shell.js`: no pause, no mute, no play on open, switch, reveal or close. |
| `.github/workflows/music-platform-ci.yml` | Both path lists gain the new and changed files; `music-contract` runs `node --test scripts/test/music-shell.test.mjs`; the `browser` job runs `node scripts/e2e/music-shell.e2e.mjs /tmp/music-proof/shell`. No new workflow, no new trigger. |
| `docs/music/MUSIC-RELEASE-20261119.md` | The "M5: one player across music pages" section after the M3 follow-up; item 2 of the bounded finish order marked (what is done, what is not). |
| `docs/music/MUSIC-WORLD-CONTINUITY.md` | The World over a music view; the address and title the World now uses; the "older pocket widget" paragraph (`:63-69`) and the table rows that change. |
| `docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json` (+ its generated coverage report) | Only if `verify_equity_uprise_repo_sources.py` reports the new files unmapped (classify as shared frontend support). |

Untouched on purpose: `js/mcc-auth.js`, `js/backend.js`, `js/now-playing.js`, `js/installed-app-dock.js`, `sw.js`,
`index.html`, `js/main.js`, every Worker file, every SQL and `supabase/` file, M3's delivery and recovery code and the M3
follow-up's fixes.

---

## 7. Acceptance tests

All browser checks: `scripts/e2e/music-shell.e2e.mjs`, Chromium only, `--autoplay-policy=document-user-activation-required`,
every request a route fixture, synthetic WAV, real taps on real links, `beforeunload` and the `Audio` constructor
instrumented in every document (top and frames). "Fails at `dc0185aa`" is how the test fails when the new tests are
run against the base's sources (the builder runs them there in a copy that records instead of stopping, as M3 did).

**Stage 1**
1. Listen, song playing -> artist card: the same `Audio` object (`__originalAudio === MCC_MUSIC.audio`), no
   `beforeunload` in the top, `currentTime` advances by more than 1 s across the switch, the same `currentSrc`, no
   `pause`/`emptied`/`seeking` on it, exactly one playing media element across the top and every frame, the address is
   `/music-creator.html?handle=probe-artist`. **Fails at base:** a page load; nothing plays on the artist page
   (Measured A).
2. Back to Listen, then Forward to the artist view: the same element still advancing at each step; the view frame is
   removed on Back and a new one made on Forward; `history.length` grows only by the retained document's pushes.
   **Fails at base:** Back reloads Listen with nothing playing ("Pick up at 0:02"); Forward plays nothing (Measured A).
3. Artist page as the retained document, its creator release playing -> Music brand link: Listen opens as a view, the
   release keeps playing. **Fails at base:** page load, nothing playing or held (Measured B).
4. Choosing another track inside a view: a catalogue song in a Listen view and a creator release in an artist view go
   through the retained engine's resolver (the fixture logs the same requests as on the page itself) and queue (Next
   moves along the engine's queue); still one element. The restrictions hold: a catalogue song plays to its end, a
   guest's protected creator preview stops at its declared boundary (30 s) and the record moves on as on the page, the
   gated closer stays preview-only, and no extra claim request is ever sent (the one-play allowance is untouched).
   **Fails at base:** no view exists.
5. One Now Playing: after each switch `navigator.mediaSession.metadata` names the playing song; no frame ever calls
   `setActionHandler` or sets metadata (instrumented in every frame). **Fails at base:** after the navigation the
   metadata is empty.
6. Pause and mute stay deliberate: paused, then three switches: still paused, `currentTime` unchanged, no `play`
   event; muted, three switches: still muted. **Fails at base:** the element does not survive the first switch.
7. Metadata for people: in an artist view the top's `document.title` is the artist page's (after its profile loads),
   no canonical (the page has none), description the artist page's, zero JSON-LD scripts and no `og:*` readable in the
   top; on reveal the retained page's title, canonical, description, JSON-LD and `og:*` are back byte for byte.
   **Fails at base:** no view. Guard (passes at base too): every supported page's static head is unchanged apart from
   the `<html>` attribute, and `scripts/test/domain-architecture.test.mjs` passes.
8. Analytics: with consent, entering a view sends exactly one `page_view` with the view's path and title; without
   consent nothing is sent from either document; a song chosen on Listen that completes while an artist view shows is
   sent with Listen's path and no `creator_handle`; a creator release chosen in an artist view carries that artist's
   `creator_handle`; a view's `page_view` names the page it was opened from as its referrer, also when Back or Forward
   rebuilt it. **Fails at base:** the song cannot complete across the navigation (no `music_complete` on the wire).
9. The bar and the dock: one visible `.appbar` across the top and the frame; the bar's Music tab in an artist view
   reveals Listen; in installed mode the dock names the same song and its Pause pauses it across switches.
   **Fails at base:** after the navigation the dock names nothing.
10. The World over a view: Globe in an artist view opens the World with the same element (address
    `/music-creator.html?handle=probe-artist&world=1`); Back closes it onto the artist view; Back again to Listen; the
    title follows each step. The existing `scripts/e2e/music-world-continuity.e2e.mjs` stays 140 of 140.
    **Fails at base:** the World opens over the artist page's own document with no song from Listen.
11. Unexpected documents: `location.replace("/index.html")` inside a view and the search Enter in a Listen view never
    render in the frame (`index.html`'s scene audio never constructed in a frame); the first becomes a page load of the
    top, the second is routed by the table; after each, one Back lands where the person was before the stopped
    navigation (no stray entry). An offline view request answered with `index.html` by the real `sw.js` shows the
    failure card while the music plays on. **Fails at base:** no view (the offline case fails at "a view").
12. Links that leave: the M tab, the house card and a same-tab external link are page loads (`beforeunload` 1);
    a `target="_blank"` link opens a new page and the retained element keeps advancing. Guard for the page loads;
    **the new-tab check fails at base** only in that it starts from a view.
13. Refresh is honest: on an artist-view URL a reload makes the artist page the retained document with nothing
    playing and no text claiming continuity; on Listen the mini player says "Pick up at m:ss". Guard (passes at base).
14. Memory: twenty switches between Listen and two artist views leave at most one view frame, no `Audio` constructed in
    any frame, and the retained element the same. **Fails at base:** the element changes at the first switch.
15. Phone first: at 320, 390, 820 and 1280 px, with a view showing, `scrollWidth === clientWidth` in the top and in the
    view, the view's last element is above the bar and the mini player, and the failure card's buttons are at least
    44 px. **Fails at base:** no view.
16. Focus: after a view opens the focus is inside the frame on its `h1`; Tab never reaches concealed content; after
    Back the focus is on the control that opened the view. **Fails at base:** no view.
17. Account change from another tab while an artist view shows (sign in, then sign out): the retained engine
    re-checks access once per change (one `music-access` or gate request, not one per document), the view repaints its
    offers, the bar's chip follows, and a catalogue song keeps playing. **Fails at base:** the song from Listen is not
    playing on the artist page to begin with.

**Stage 2 (the album)**
18. Album, deck playing -> the bar's Music tab: Listen opens as a view, the deck is the same element and advances, the
    deck bar is on top (the hit test at its centre finds the deck bar), Back reveals the album with the same element.
    **Fails at base:** a page load; the deck is gone (Measured D for the same mechanism).
19. In a Listen view over the album, tap a song: the deck pauses through `MCC_NP_PAUSE` before the engine's song starts,
    exactly one element plays, `data-music-owner="engine"`, only the engine's bar shows; tap an album row after Back:
    the engine pauses, the deck plays, only the deck bar shows; the pocket holds the owner's song after each switch.
    **Fails at base:** no view.
20. The album's own controls over a view: the deck bar's Pause, the sheet's Next, the World's compact transport and the
    installed dock all act on the deck while a view shows; `MCC_DECK_DELIVERY` words (Reconnecting...) still show on
    the deck bar over a view during a dropped read (M3 behaviour unchanged). **Fails at base:** no view.
21. A link to the album the retained album shows, with another `t=` (a Listen row in a view over it), reveals the
    album with that row in view and highlighted while the same song plays on; a link to another album, and to
    `album.html` from a Listen retained document, are page loads (the named gap, recorded). **The reveal fails at
    base** (no view); the page loads are a guard.

**Stage 3 (sign-in)**
22. Album, deck playing -> the comment box's Sign in: the account page opens as a view (address
    `account.html?next=...`); no pocket mounts in it; the deck advances; password sign-in -> the album is revealed with
    the same element still advancing; the album's gated row repaints for the member and the chip says Profile.
    **Fails at base:** the album is seated paused after sign-in, nothing plays (Measured E2).
23. Album -> the chip (no `next`) -> password sign-in -> back on the album, same element playing.
    **Fails at base:** lands on `/mnet.html`, nothing plays (Measured F).
24. Auth unchanged: the requests and storage writes of a password sign-in in the view equal those of `account.html`
    loaded directly (the same token call, user lookup, bootstrap; the same two keys written; no other key). Guard
    (compares view with top-level; the view half fails at base).
25. A provider (a fixture's settings switch Google on) started in the account view navigates the **top** to the
    authorize URL with the verifier in `sessionStorage`; the frame never navigates cross-origin. Create account and
    Forgot password are page loads of the top to today's URLs. **Fails at base:** no account view.
26. Sign-out in the account view: the chip says Sign in and the gated rows repaint as a guest's; the deck keeps
    playing a catalogue song. **Fails at base:** no account view.

**Unit tests** (`scripts/test/music-shell.test.mjs`): the route table for every stage and the switch off (all page
loads); the history state machine (open, view to view, Back, Forward, the World on top); metadata mirror and restore
from fixture heads; `adopt()` accepts only its own frame and expected URL; `js/shell-boot.js` stops an unexpected
document; `js/music-engine.js` in view mode constructs no `Audio`, creates no UI, binds no Now Playing and forwards a
tap synchronously; `js/pip.js` and `js/world-audio-continuity.js` do nothing in a view; analytics keeps the retained
page's identity after `pushState`; the guard for cross-origin script navigations in the stage pages; the conceal
allow-list against each stage page's fixed transport and status elements; the lifecycle guard extended to the shell. Each fails at `dc0185aa` because the shell and view mode do not exist there (the lifecycle
guard passes there, as it should).

**Revert and fail** (for the record): take each change out on its own and show its tests fail: the shell not loaded;
`adopt()` accepting any frame; `window.stop()` removed; view mode off in the engine (two `Audio` objects); the pocket
mounting in the account view; analytics reading `location` at event time; a rebuilt view's referrer read from the
address; metadata not restored; JSON-LD not held aside; a frame `src` change instead of a new frame (history grows); the owner switch skipping `MCC_NP_PAUSE`; the
provider start in the frame; the `next` default removed (test 23 lands on the World). Restore the tree byte for byte
after each.

**Suites that must stay green, one at a time** (nice 15, under the browser lock): root `node --test
scripts/test/*.test.mjs`; the `music-contract` job step by step; background 293 of 293; continuity 140 of 140; Now
Playing 125 of 125; accounts 128 of 128; installed app 246 of 246; native publication 49 of 49; direct checkout 40 of
40; site navigation 429 of 429; the game hub capsule; the peaks, artwork and track-length checks; the source map
validator; `scripts/test/domain-architecture.test.mjs`.

---

## 8. Order of work and gates

1. Write the unit and browser tests first; run them against `dc0185aa`'s sources (copies of the tests only) and keep
   the failing counts.
2. Stage 1. Gate: tests 1-17 and the unit tests pass; the suites above pass; revert proofs for stage 1; 320/390/820/1280
   checks; renders for Matthew at device scale 2 (Listen with an artist view and the mini player; Back; the failure
   card).
3. Stage 2. Gate: tests 18-21; continuity, background and installed-app suites again; renders (album deck bar over a
   Listen view; owner switch).
4. Stage 3. Gate: tests 22-26; accounts suite again; renders (the account view over the playing album at 390 and 1280).
5. Records, CI, source map, device rows. If a gate cannot be met, stop at the last green stage with its route switches
   on and the later ones off, and record why.

---

## 9. Risks and how each is contained

| Risk | Containment |
| --- | --- |
| A second player or a second Now Playing (a view making its own `Audio`, the pocket in the account view, the World theme in a view) | View mode in the engine, early returns in `js/pip.js` and `js/world-audio-continuity.js`; unit tests construct nothing in view mode; every e2e check counts playing elements and `mediaSession` writes across all frames. |
| `index.html` or an arbitrary page rendering in a frame (script navigations, the service worker's offline fallback) | `data-music-view` marker plus `adopt()` by frame identity; `window.stop()` before the body; a `load` check for pages without `js/shell-boot.js`; tests 11 and 12. |
| Two entities collapsed in the live head (an artist page sharing as Listen or the album) | Title, description and canonical mirrored; JSON-LD and `og:*` held aside and restored byte for byte; test 7; static heads untouched; domain-architecture test. |
| Analytics misattribution (the retained page's events taking a view's path and an artist's `creator_handle`; double dwell) | Page identity fixed at load; the chosen-on page on music events; dwell per page; test 8. |
| History pollution or broken Back/Forward | A fresh frame per view (F2), only the retained document pushes, view URL changes mirrored with `replaceState`; tests 2 and 10. |
| Auth behaviour changing | `js/mcc-auth.js` untouched; the password path is the same code in a same-origin document; every other path leaves as today; test 24 compares requests and storage writes; fallback to today's page load. |
| WebKit: a tap in a frame not counting as a gesture for the parent's element | Always call the retained player synchronously in the tap; once an element has played from a gesture WebKit lets it play again (lane 03, 1.3); device rows 2 and 3. |
| iOS memory pressure with a frame, AutoFill and the keyboard inside a frame | One view frame; the album room still while concealed; Inferred, device rows 5 to 7. |
| The World continuity regressing | Its suite (140) must stay green; the only changes are the early return in views, the current address and title, and the owner question; test 10. |
| Layering at 320/390 (transport over the last content, the chip over controls) | `--mcc-view-clear` from measured heights; geometry checks in test 15; renders at device scale 2. |
| A cross-origin script navigation in a view (Stripe, a provider) breaking in a frame | Routed through the view API; the unit guard fails on a new unrouted one. |
| The album document running two players (stage 2) | One owner through the album's own Pause; one visible bar; `now-playing.js`'s last-player rule; test 19; stage 2 has its own switch. |
| A view's page scrolls inside its frame: on iOS, Safari's toolbars may not shrink and a tap on the status bar may not scroll it to the top (Inferred; the World frame lives with the same today) | Measured on Matthew's devices (row 13) before any later route is added; if it reads worse than a page, the frame takes the page's height and the retained document scrolls instead, a change inside `js/music-shell.js` only. |
| The privacy notice's Agree, a refresh or a page load ending the song inside the shell, where continuity now looks like the rule | Named in 3.9 and the record; no copy claims continuity there; each keeps its documented recovery. |
| D-5 not yet answered | Built on the branch only; one switch turns every route off (today's page loads); the record says so first. |

---

## 10. Out of scope

- The album as a view over Listen or an artist page (needs its player moved into the retained document; the largest
  remaining gap).
- Catalogue, licence, music videos, PRIM3's artist page and Creator Studio as views; the house's other pages.
- Any change to the pocket's recovery (it stays position recovery: resuming the entitled source instead of a gated
  preview, PB-8's second half, is not done here) or to `listener_state`.
- The album's `?t=` seat starting at 0:00 instead of the banked second when it is the same song (C); a recovery change.
- The fixed account chip over links at phone width: the Now sheet's Album link at 390 px (Measured C), like the
  Creator Studio link the M4 section records; the album's door (RL-11) was moved clear in the M3 follow-up. A layout
  fix of its own.
- PB-14, which the music map files under M5: `js/world-owner-modes.js:45` reloads `mnet.html` once per tab when it
  first recognises the owner. Opened from Music, that reload restarts only the World frame and the song in the
  retained document plays on (Inferred from code); on a World opened directly it still ends the World's own song, and
  fixing that means applying owner modes without a reload in the World's code.
- Links out of the World to an album, an artist page or Control (`js/world-audio-continuity.js:676-683`): they still
  replace the retained document, by the World's own rule. Opening them as music views changes the Music-to-World
  contract this slice keeps.
- Any Worker, SQL, `supabase/` or auth change, D-10 (one session across hosts), the native app, anything on
  `index.html`.
- Physical-device proof (section 12).

---

## 11. Questions for Matthew

1. **D-5:** keep the retained music document (this slice's default, on the branch) or stop it? One switch turns it off.
2. Signing in from the chip or the song test on a music page: come back to the music you were playing (this slice's
   default), or keep landing on the World as today?
3. The largest gap: Listen -> album (88 views in 35 days, 30 after a song). Move the album's player into the retained
   document in a later slice so the album can open over Listen without stopping the song?
4. A song chosen on Listen while the album is the retained document plays in the same page (the engine loaded beside
   the deck, one playing at a time, one bar showing). Is that how the album and Listen should share the bar?
5. Which routes next: catalogue, licence, music videos, PRIM3's artist page, Creator Studio; and the house's other
   pages (profile, hire, sites) so music keeps playing across the whole house (never the front page)?
6. Provider sign-ins (none switched on today): if you switch one on, it leaves the site and the song ends, by the
   providers' design. Acceptable?
7. The account chip lies over the Now sheet's Album link on a phone (a tap there opens Sign in). Fix it next?
8. From the World, a link to an artist page or the album still leaves the music (the World's own rule today). Should
   those open over the music instead, in a later slice?

---

## 12. Rows for Matthew's devices (Inferred until run)

For each, note the page, Safari tab or Home Screen icon, signed in or not, and the iOS version.

1. iPhone, Safari: Listen, play a song, open an artist page, go Back, go Forward. The song never stops; the lock
   screen keeps its title.
2. The same with the phone locked between steps (unlock, switch page, lock again): the song continues.
3. In an artist page opened from Listen, tap another song: it starts on the first tap.
4. Album (I AM HERE) playing: tap Music in the bar; browse Listen; Back to the album. The song never stops; the deck bar
   stays at the bottom over Listen.
5. Album playing: scroll a long Listen view and an artist view for a minute; nothing reloads by itself (memory).
6. Album playing: Sign in from the comment box with your password (Keychain AutoFill if you use it): the song keeps
   playing while you sign in and after.
7. The same from the chip at the top right; then the keyboard and AutoFill behave as on the account page itself.
8. Lock screen and Control Center during each of the above: one song, previous and next work, no second card.
9. From the Home Screen icon: rows 1, 4 and 6; the dock keeps the song.
10. iPad, Safari: rows 1, 4 and 6.
11. VoiceOver: open an artist page from Listen: it reads the page's name and lands on its heading; Back returns to where
    you were.
12. Refresh on an artist page reached from Listen: the song stops (expected); Listen afterwards offers "Pick up at".
13. On an artist page opened from Listen, scroll a long page: does Safari's bar shrink as on the page itself, and does a
    tap on the status bar bring you back to the top? (The page scrolls inside the shell; tell us if it feels different.)
