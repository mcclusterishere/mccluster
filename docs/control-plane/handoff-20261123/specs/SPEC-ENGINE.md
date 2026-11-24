# SPEC-ENGINE: one engine, one player, everywhere

Design spec for the next music slice on `claude/new-session-83ken5` (control repo `mcclusterishere/mccluster`).
Written read-only on 2026-11-23 from a fresh fetch of the branch at `0ef1481cae8750cfd2c706ddf15393cabb93ad9d`.
Nothing in the repository or in production was changed; the live sites were read with GET and HEAD only, with
analytics and the listen ledger blocked and nobody signed in.

Labels used throughout: **Measured** (seen today in Chromium or with curl; evidence path in section 16), **Read** (in the
code or the records at `0ef1481c`, with file:line), **Inferred** (reasoned; the build proves it or drops it).

**Build base.** The branch head after the quick wins slice (QW) is verified and pushed. At `0ef1481c` QW is not on the
branch and has no record section yet; its working copy changes `album.html`, `js/music-engine.js`, `js/music-shell.js`,
`js/pip.js`, `js/world-audio-continuity.js`, `js/analytics.js`, `js/gated-audio.js`, `js/label.js` and 27 other files.
This spec builds on QW's rules and does not repeat them: one record at a time (an album stops after its last song;
Previous on the first song starts it again), the closing song held for everyone but the house owner with its pop-up
(`MCC_GATED.holdDecision` / `holdNotice`), "McCluster" as the one artist name, albums and artists only, and
`music_interrupted` / `music_error` approved. Line numbers below are at `0ef1481c`; QW moves some of them. The builder
re-reads QW's record section before starting.

---

## 1. The decision, on one page

1. **One engine.** `js/music-engine.js` is the only code that plays catalogue songs. It makes one `Audio` element per
   top document (`js/music-engine.js:30`). Everything else that plays a song today becomes a caller of it: album rows,
   Listen, artist pages, the music videos page, the pocket, the game hub capsule and the World.
2. **One player.** The player's controls are the bottom bar itself, wherever the engine holds a song: Previous at the
   bar's left edge with the song's title beside it, the Music tab as Play/Pause, Next and the sound button at the right
   edge, and a line above the bar when something needs saying ("Muted", "Reconnecting…"). The installed app's dock
   (`js/installed-app-dock.js`) is already this layout and is the code to generalise to every window; the drawing
   follows BAR-RESTORE.md (the parallel bar-history work from Matthew's 18:40 message). The engine's mini pill, the
   album's deck bar, the World's floating transport, the pocket tile and the World's corner Play stop being controls.
   The one full player is the engine's Now sheet, which takes over everything the album's own sheet does today.
3. **The album is a page, not a player.** `album.html` keeps every album feature and loses its `<audio id="deck">` and
   the code around it; it plays through the engine at the top and as a view (`ROUTES.album.view = true`). M5's
   stage 2 (the album's deck plus a guest engine taking turns behind one bar) is removed.
4. **The World's song is the engine's shuffle.** The Globe, with nothing held, calls `MCC_MUSIC.shuffle()` inside the
   tap: a random walk through the public catalogue (40 songs today) that never ends. It keeps playing into Music.
   Choosing an album, an artist's song or a music video in Music replaces the shuffle with that record, which stops
   after its last song.
5. **One mute** for every song (M3's decision D-7 reversed). **One Pause** in the installed app. The Music tab is
   Play/Pause everywhere a song is held.
6. **Sign-in comes back to the music** with the song still playing: the chip and the song test carry `next`;
   Google and Apple open in a pop-up window (new `auth/popup.html`), so the music page never leaves. `js/mcc-auth.js`
   is not changed.
7. **The Sign in chip stops covering the Now sheet's Album link**: the sheet becomes a modal layer above the chip.
8. **The analytics regression** (`MCC_PAGE_IDENTITY is not defined`) is fixed in its test harness with markers in
   `js/analytics.js` that change no behaviour, and the whole Worker suite runs green.
9. **Across hosts** (the World opened directly at `mccluster.org`, then Music at `matthew.mccluster.org`) the web
   cannot keep one element playing. The song is handed over in the address fragment and one tap picks it up at the same
   second. Making that step seamless needs Matthew's decision (question 1); within the law, everything else is seamless.

---

## 2. What Matthew asked, and how it is read

| His words (2026-11-23) | Reading | Section |
| --- | --- | --- |
| "I want a singular fucking music engine with 1 fucking player at all times." | One engine, one element, one set of controls. The album page keeps no deck; two players behind one bar (M5 stage 2) is rejected. | 4 |
| "it should be just like the Apple Music app... no matter where I go, the shit is still playing." | The retained document keeps the song through every music page and the World; page loads hand the song to the next page (pocket bank, pick-up fragment). | 4, 5 |
| "So the world's songs are the regular songs... same engine." | The World's theme player is retired; the World plays the engine's shuffle. | 5.1 |
| "If the world starts a song, the bottom tab should turn into... the bottom tab with the pause and left right button... but randomized." | The bar shows Previous / Pause / Next over the World, playing the shuffle. | 4.6, 5.1 |
| "When you go to music, then you can unrandomize it by selecting specifically what album you want, but if you don't, it'll just continue to play no matter where you go from world." | Any choice in Music replaces the shuffle; otherwise the shuffle keeps going. | 4.2, 5 |
| "I don't want you to separate the muting from the world songs and the regular songs." | One mute, stored once per site address, shown on every surface. | 6 |
| After signing in from a music page "we need to go back to the music you were playing, obviously". | `next` = the page shown; the song keeps playing through the sign-in. | 7 |
| Google/Apple sign-in ending the song: "No, that's not okay." | Provider sign-in in a pop-up window; the redirect only as a fallback with the song banked. | 7.2 |
| Chip over the Now sheet's Album link: "Yes." (fix it) | The sheet becomes a modal layer above the chip. | 8 |
| (quick wins) albums stop after their last song; the World's shuffle keeps going. | QW's one-record rule in the engine; the shuffle context never ends. | 4.2 |
| (18:40) "the bar at the bottom used to be smaller and have... back and forward buttons on either side of the bottom bar added on with the music details and more. i liked that design a lot." | The bar is the player's controls everywhere; its drawing comes from BAR-RESTORE.md. | 4.6 |

The plan's readings that this spec also carries: the bar's Music button pauses everywhere; the installed dock shows
one Pause, not two; World links keep the song playing.

---

## 3. What happens today

### 3.1 Hosts (Measured: curl GET/HEAD; `out/hosts-curl.txt`, `out/static-passthrough.txt`, `out/health.json`)

| Address | Answer |
| --- | --- |
| `https://mccluster.org/` | 200 from Worker `mccluster`; CSP `frame-ancestors 'self' https://matthew.mccluster.org https://mccluster.org https://www.mccluster.org https://humanuprise.com https://www.humanuprise.com`; `X-Frame-Options: SAMEORIGIN` (the CSP wins in current browsers) |
| `https://mccluster.org/?view=feed` | 200 (the World) |
| `https://www.mccluster.org/`, `http://mccluster.org/` | 301 to `https://mccluster.org/` |
| `https://mccluster.org/mnet.html` | 301 to `https://mccluster.org/` |
| `https://mccluster.org/company` | 200, `frame-ancestors 'none'` |
| `https://mccluster.org/listen.html`, `/album.html` | 301 to `https://matthew.mccluster.org/…` |
| `https://matthew.mccluster.org/`, `/listen.html`, `/album.html`, `/mnet.html`, `/?view=feed` | 200 from GitHub Pages |
| `humanuprise.com` | Cloudflare zone, no A/AAAA record; `www` does not resolve; nothing is served (inert, as the law says) |
| `https://api.mccluster.org/v1/health` | 200, `deployment_sha` `b51ede03` (main) |
| Static files on `mccluster.org` | 200 for `js/music-engine.js`, `js/world-audio-continuity.js`, `data/albums.json`, `assets/audio/heal-the-3rd-world.m4a`, `data/peaks/…`, `account.html`, `/auth/`, `sw.js`; `js/music-shell.js` is 404 on both hosts (M5 is not deployed) |

So the World's door (`mccluster.org`, McCluster Corp) and Music (`matthew.mccluster.org`, Matthew McCluster) are two
origins of one site. The company host already serves the engine and the audio files as static files.

### 3.2 Can Music and the World share one document? (Measured in Chromium, `out/live/live.json` → `frames`)

| Top page | Framed page | Result |
| --- | --- | --- |
| `matthew.mccluster.org/listen.html` | `mccluster.org/?view=feed` | Loads. Cross-origin: the parent cannot read it (SecurityError). This is today's Music-to-World path. |
| `matthew.mccluster.org/listen.html` | `matthew.mccluster.org/mnet.html?view=feed` | Loads, same origin, readable; the frame can reach the parent's `MCC_MUSIC`. |
| `mccluster.org/?view=feed` | `matthew.mccluster.org/listen.html` and `/album.html` | Loads. Cross-origin. |

Inferred from the platform: `document.domain` relaxation cannot join the two origins (Chromium makes agent clusters
origin-keyed by default from version 115, and GitHub Pages cannot send `Origin-Agent-Cluster: ?0`). Read: a
cross-origin frame cannot start the parent's sound inside the same tap, because `postMessage` does not carry the
gesture (docs/music/MUSIC-WORLD-CONTINUITY.md; `js/world-audio-continuity.js:30-36`, "Inside the Music shell the
parent keeps the transport (a frame message cannot carry Safari's media activation); the child only displays state").

### 3.3 Players per page

Live (main, `b51ede03`; Measured, `out/live/live.json`):

| Page | Media at load | Now Playing bindings |
| --- | --- | --- |
| `listen.html` | engine `Audio`, World theme `Audio` | listen, world |
| `album.html` | `audio#deck`, shelf-taste `Audio`, World theme `Audio`, `video#roomFilm`, `video#nowFilm` | album, world |
| `music-creator.html` (artist) | engine `Audio`, World theme `Audio` | listen, world |
| `music-videos.html` | `audio#deck`, World theme `Audio`, 17 muted card videos | world |
| `catalogue.html` | none at load | none |
| the World (both hosts) | World theme `Audio`, 3 member-media videos | world |
| `index.html` (front page) | 6 `<audio id="track-…">` (js/main.js) and a video | front page's own |

Branch head `0ef1481c` (Measured with route fixtures, `out/branch/branch-b0.json`): listen [engine, theme]; album
[shelf taste, theme, #deck]; artist [engine, theme]; music-videos [theme, #deck]; World on the house origin [theme];
catalogue and account none.

Heads (Measured): the World on the company host is titled "Equity Uprise · McCluster", canonical
`https://mccluster.org/`, `og:site_name` "McCluster Corp"; the house `mnet.html` has the same title and no canonical or
site name. During the live probe 29 POST requests were aborted by the probe's guard (play counts, checkout, the CDN's
own beacons); nothing was counted.

### 3.4 Journeys at the branch head (Measured, `out/branch-b*/branch.json`)

- **B2, two players behind one bar.** Album at the top, `#deck` playing "Who Did The Shoot". Bar's Music tab: Listen
  opens as a view over the retained album (address `/listen.html`). That one document now holds four audio objects:
  the album's shelf-taste `Audio`, the World theme `Audio`, a guest engine and `#deck`. A Listen row: the engine plays
  and the deck pauses (`data-music-owner="engine"`). Back, then album row 3: the deck plays "Write a Song" and the
  engine pauses (`data-music-owner="deck"`).
- **B2c, a card's play button in a view (M5 defect).** Listen as a view over the album; tap the play button of a
  shelf card that sits inside its link (`album.html?album=here&t=Runway%20Walk`): the view closes, the album shows and
  nothing new plays. Read: `js/music-shell.js:510` (view agent) and `:220` (top) test `a.closest("[data-music-play]")`,
  the anchor's ancestors, when the play button is the anchor's descendant.
- **B3, the World's song is not the engine.** Listen with nothing chosen, tap the Globe: the World theme `Audio`
  (`js/world-audio-continuity.js`) plays "Environmental Injustice" in Listen's document; the engine is empty and no
  mini player shows. The World's transport offers "Return to Music", "Pause music", "Mute music". Mute stores
  `mcc_world_audio_preference` = `{"muted":true}`. Back in Music the theme keeps playing, muted, and nothing in Music
  shows it. A Listen row then plays on the engine, unmuted, while the theme pauses.
- **B5, two Pauses.** Installed app on Listen with a song: two controls named "Pause music", the Music tab
  (`#appbarNP`, Listen's Play/Pause since the M3 follow-up) and the dock's own play button.
- **B6, provider sign-in ends the song.** The chip's href is `https://matthew.mccluster.org/account.html` (no `next`).
  Through the shell the account page opens as a view with `next=%2Falbum.html%3Falbum%3Dhere` (M5's default). With a
  provider switched on in a fixture (providers are off in production), Google sends the top window to the account
  service's `/auth/v1/authorize` (back to `/auth/?next=/account.html?next=/album.html?album=here`): the album document
  and its deck are gone.
- **B7, the chip over the Album link.** The Now sheet's Album link is 32×16 px. At 320 px it sits at (266,20) under
  the chip (229,12, 79×44); at 390 at (336,20) under (299,12); at 430 at (376,20) under (339,12). The link's centre
  hits the chip's text. Following the link is a page load (`beforeunload`/`pagehide` of `/listen.html`); the album
  seats the song at 0:00, paused.
- **B8, the World on the house origin.** `mnet.html` standalone: the first tap plays the theme ("Stand on Business
  (B-side)"); the bar's Music tab is a page load to Listen; nothing is held or playing there.

### 3.5 The analytics regression and the Worker suite (Measured)

`workers/mccluster/test/analytics-creator-attribution.test.mjs` runs two slices of `js/analytics.js` in a `vm`
context: the outbox factory (between `/* EVENT_OUTBOX_FACTORY_BEGIN */` at line 57 and its end marker) and the
`window.MCC_TRACK = (function () {` block (line 201). M5 (`2000c609`) added `var MCC_PAGE_IDENTITY = (function () {`
at line 42, outside both slices, and `queueEvent` reads it, so the test throws `ReferenceError: MCC_PAGE_IDENTITY is
not defined`. At `0ef1481c`: 1 pass, 1 fail. Whole Worker suite at `0ef1481c`: 2032 tests, 2022 pass, 1 fail
(`not ok 69 - real tracker retains only a validated public creator handle beside the path`), 9 skipped, about 34 s
(`out/worker-suite-0ef1481c.txt`). The fix in section 9 was proven in scratch: 2 of 2 pass
(`spec-ENGINE-probes/analytics-fix/proof.test.mjs`).

---

## 4. The one engine

### 4.1 Which code, and why

`js/music-engine.js` (v2) is the engine. It already has what every other player duplicates: the gate path for earned
and gated plays (`MCC_GATED` resolve/claim, `takeGrant`, the `grantMax` seek guard), M3's delivery recovery (trouble
states, retries at 0.5/1.5/3/5.5/8.5 s), the listen ledger, the pocket bank and restore (`MCC_POCKET`), one Now
Playing binding through `js/now-playing.js`, the view-mode facade for M5 views (`viewMode`, line 1371), and QW's
one-record rule and held song. `docs/music/DESIGN-SYSTEM-V2.md` already says "One transport: js/music-engine.js owns
the discovery transport" and "No ... second player engine"; this slice makes that true for the album, the World and
the remaining pages.

Rules:

- One engine instance per top document. In a music view the engine file installs the facade that forwards to the top
  engine (as M5 does for Listen and artist views). In the World framed inside a music document
  (`html.mn-music-frame`) the engine returns at once and makes no element. The World opened directly runs its own
  instance (its document is the top one).
- One `Audio` element per document, made by the engine. No other file creates `Audio`, `<audio>` or
  `createElement("audio")` for catalogue songs (a unit test scans for it, section 10).
- The engine is the only caller of `MCC_NOW_PLAYING.bind` in a document that has it.

### 4.2 What it holds: three contexts

| Context | Started by | Next / Previous | End |
| --- | --- | --- | --- |
| **record** (an album, or one creator release) | any song chosen in Music: Listen, an artist page, an album row, the Now sheet, the pocket | within the record (QW `recordList`) | stops paused at the end of its last song (QW `endRecord`); Previous on the first song restarts it |
| **shuffle** (the catalogue) | the Globe or the World's first tap with nothing held | a shuffled pass through the pool; Previous walks back through what played | never; a new pass is shuffled when one runs out, never starting with the song just played |
| **list** (an order a page chooses) | the music videos page | within the list | stops after the last item |

Any `play*` call replaces the current context. The shuffle pool is the same filter the World uses today
(`js/world-audio-continuity.js:255-287`): every catalogue track whose source is a public `assets/audio/*.mp3|m4a`
file, not gated, not held, not a preview. Measured at `0ef1481c`: 41 tracks in `data/albums.json`, 40 in the pool (the
one left out is the gated closing song).

The first shuffle song must be chosen without a network read, because `play()` has to run inside the tap: if the
catalogue is not loaded yet, the first song is the World's fallback song today (`FALLBACK_SONG`, "Heal the 3rd
World") and the pool loads for the songs after it (Read, `js/world-audio-continuity.js` FALLBACK_SONG).

The album's one ordering rule that the engine lacks moves into it: when a record advances by itself into a gated song,
the previous song's listen is finished in the ledger (`MCC_LISTENS.finish`) before the gated song is claimed
(`album.html` ended handler, lines 1904-1936). After QW the only gated song is the held closing song, so this rule
matters only for the house owner's own play; it is kept so a future gated song behaves as the album does today.

### 4.3 API (additions; names may change, the behaviour may not)

Kept: `play(albumSlug, title, force)`, `playCreator`, `registerCreatorTrack`, `pause`, `resume`, `toggle`, `next`,
`previous`, `openNow`, `closeNow`, `current`, `access`, `refreshAccess`, `delivery`, `playing`, `unmute`. `audio`
stays for top-document callers that need the element (the AirPlay picker) and is never exposed in a view.

New:

| Call | Does |
| --- | --- |
| `shuffle({ from })` | starts the shuffle context, `play()` called synchronously in the caller's gesture; if a shuffle is already current, resumes it |
| `playList(items, at, { from })` | list context; `items` are catalogue keys `{ album, title }` |
| `hold({ album, title, at, context })` | seats a song at a second without playing; the bar shows it with Play ("Pick up at 1:23" when `at` > 0) |
| `seek(seconds)` | seeks within the `grantMax` guard |
| `context()` | `{ kind: "record" \| "shuffle" \| "list", slug }` |
| `mute(on?)`, `muted()` | the one mute (section 6) |
| `sleep(minutes \| "end" \| 0)`, `sleepState()` | the sleep timer moved from `js/label.js` `napSet` (line 431): fades the last 10 s where the browser allows volume, then pauses |
| `stop()` | clears the song and the pocket bank; the bar returns to its tabs |
| `media()` | the element in the top document; a read-only lens in a view (4.4) |
| `on(type, fn)` | subscribes to engine events; in a view the subscription is removed when the view closes |

`tellBar` today runs only on `listen.html` (`js/music-engine.js:337`, `ON_SHELF`). It runs in every document that has
the engine, so `MCC_NP_PLAY`/`MCC_NP_PAUSE` and `mcc:nowplaying` exist wherever a song is held. The engine's
`mcc:nowplaying` detail gains `engine: true`, `held: true` and the context, so the bar can tell the engine apart from
the front page's own player (section 13).

### 4.4 Views: the facade and the lens

In a view, `MCC_MUSIC` is the facade (M5). It gains every call above and forwards it to the top engine synchronously,
so a tap in a view starts the top element inside the same gesture. That is how M5's Listen and artist views already
play (Read: `js/music-engine.js:1371` `viewMode`); WebKit's acceptance of it is on the device rows.

`media()` in a view returns a lens, not the element: getters for `currentTime`, `duration`, `paused`, `ended`,
`muted`, `currentSrc`, `readyState`, and `addEventListener`/`removeEventListener` registered through the shell's view
API (`on`, which records a cleanup; `js/music-shell.js` viewApi), so no listener from a closed view stays on the
element. No `play`, `pause` or property writes; those go through the engine calls. `js/chamber.js:33`,
`js/filament.js:24` and `js/intuition.js:95` read `document.getElementById("deck")` today; they read
`MCC_MUSIC.media()` instead and work the same at the top and in a view.

### 4.5 Engine events

`mcc:music-state` and `mcc:music-selected` stay, with `context`, `muted` and `sleep` added to the detail. New:
`mcc:music-context` (`{ kind, slug }`), `mcc:music-counted` (`{ key, counted }`, so the album's song test refreshes
as it does today), `mcc:music-grant` (`{ key, expiresAt }`) and `mcc:music-spent` (`{ key }`) for the album's gate
chips, `mcc:music-held` (the QW pop-up's case) and `mcc:music-end` (the record ended).

### 4.6 The one player's controls: the bar

While the engine holds a song, every top window that has the bar shows the player in it. Layout, phone first:

```
[Previous][Title / artist or status]  [Music = Play|Pause] [HERE] [Globe]  [Next][Sound]
          (a line above the bar while it applies: "Muted", "Reconnecting…", "Could not load · tap play")
```

- This is the design Matthew asked for on 2026-11-20 for the installed app ("make the bottom bar about one-third
  smaller, and put playing music in the same bar with navigation in the middle and song information and controls at
  its sides"; Read: `docs/control-plane/SHARED-NAVIGATION.md:31-64`, shipped in PR #820, installed app only, "Ordinary
  browser presentation stays unchanged"). Its code is `js/installed-app-dock.js` (previous and the title on the left,
  the tabs in the middle, play and next on the right; `css/installed-app-dock.css` grid `minmax(88px,1fr)
  minmax(44px,132px) minmax(88px,1fr)`, 46 px high, 44 px controls, scrollable tabs). It becomes the bar's player in
  browser windows too, not only in the installed app (the file may be renamed, for example `js/music-bar.js`; one
  implementation for both), and SHARED-NAVIGATION.md's "ordinary browser stays unchanged" line is updated with
  Matthew's 2026-11-23 words. Its own Play button goes, because the Music tab is Play/Pause; Sound takes its place, so
  the footprint at 320 px is the dock's today.
- The drawing (sizes, the song line, whether a small cover shows, where the status words go) follows BAR-RESTORE.md
  when it lands. Today the status has a row of its own above the dock, which makes the bar taller while it applies
  (branch commit 73349a06); BAR-RESTORE.md decides whether that stays, given "smaller". The behaviour in this section
  holds whatever the drawing. If, once Matthew sees BAR-RESTORE.md, Play/Pause goes back to the dock's side, the Music
  tab returns to being the way to Music, the one-Pause rule still holds and nothing in the engine changes.
- The song line: on music pages, in views, on other pages and in the World opened directly it opens the Now sheet; in
  the World framed over Music it returns to Music (closes the World, as "Return to Music" does today, with no break in
  the sound). In the World opened directly, going to Music is a choice made in the sheet (its Music and Album links),
  because it crosses hosts and hands the song over (5.5); a tap on the song line never interrupts the song.
- When nothing is held, the bar is exactly today's bar.
- In music views the bar is the retained document's (views have no bar, `js/tabbar.js:24`).
- The retired controls: the engine's `#musicMini` (its title, access note and Unmute move to the song line and the
  status line), the album's `#deckbar` and `#seekStatus`, the World's `#mccWorldAudioControls`, the pocket tile and,
  while the bar carries a song, the World's corner `#mnWorldPlay`. The installed dock's CSS already hides each of
  these as duplicates (`css/installed-app-dock.css:71-78`); that rule becomes the default and then the markup goes.
- How you reach Listen while a song is held: the music pages' own context bar ("Music", "Listen";
  `album.html:668-670`, `music-creator.html:24-25`), Back, or the song line from the World.

### 4.7 The one Now sheet

The engine's `#musicNow` is the one full player. It gains what only the album's `#now` has today, loaded the first
time the sheet opens (new `js/music-sheet.js` and `css/music-sheet.css`, so the World host does not pay for it up
front):

- timed lyrics (`MCC_LYRICS`), tap a line to seek, lyric commerce (`MCC_LYRIC_COMMERCE`), and the current lyric line
  on the bar's song line when the listener turns lyrics on (the album's `#npLyr`);
- the film and reel scenes with photo flips (album `reel`, `glide`, `setScene`, `syncFilm`);
- credits from `data/catalogue.json`;
- the doors License, On the record and Book the studio, on the house origin only (5.6);
- Share; the sleep timer (`MCC_MUSIC.sleep`, the album's nap button); AirPlay through
  `MCC_NOW_PLAYING.airplay(button, element)` with the Remote Playback prompt as fallback (`js/label.js:384`); Sound;
  Stop; the waveform on the seek bar (`js/filament.js`);
- the head: Close on the left, the Album (or Creator) link on the right, which opens the album as a view; in the
  World opened directly the sheet also offers Music, and both links hand the song over (5.5).

It is a modal layer above the chip (section 8).

### 4.8 `album.html` as a page of the engine

`album.html` loads `js/now-playing.js` and `js/music-engine.js` like `listen.html` does (`listen.html:225-226`),
marks itself a view route, and keeps everything that is not a player. Feature by feature:

| Album feature today | Where it lives after | Proof (section 10) |
| --- | --- | --- |
| Rows, hero, kicker, credits line, hearts, rails (as QW leaves them), comments, music-direct | `album.html`, unchanged | existing album suites |
| Tap a row to play; the album plays in order and stops after its last song | `MCC_MUSIC.play(slug, title)`, record context (QW rule in the engine) | E2, E3 |
| `?t=` on load | at the top: `hold()` that song at 0:00, or at the pocket's second when the bank holds the same song; in a view: highlight the row, leave the sound alone | E3 |
| The closing song's lock and pop-up (QW) | engine `heldSong`; the album row stays painted held | E8 |
| Earned plays and the gated pass: chips, `data-granted`, the grant's expiry, no seek past what was earned | the engine's gate path; the rows paint from `MCC_GATED` reads and the engine's grant/spent events | E8 |
| Listen counting (`countStart`, `spend`) | the engine's ledger calls | E8 |
| The song test and its refresh after a counted listen | `album.html`, refreshed on `mcc:music-counted`; its sign-in link carries `next` | S2 |
| Lyrics, film, reel scenes, credits, doors, share, AirPlay, sleep timer | the one Now sheet (4.7) | E5 |
| Room light from peaks (`js/chamber.js`), still while hidden or covered | `album.html`, reading `MCC_MUSIC.media()` | E6 |
| The room film (`video#roomFilm`) following the song | `album.html`, on engine events | E6 |
| Offline vault ("Keep", `js/label.js`, `mcc-vault-v1` keyed by audio URL incl. `SAME_AUDIO`) | unchanged; the engine requests the same URLs, so `sw.js` answers them from the vault | E7 |
| M3 delivery recovery (album copy: `deckFailed`, `MCC_DECK_DELIVERY`) | the engine's (`MCC_MUSIC.delivery`) | existing M3 suites |
| Now Playing on the lock screen | the engine's one binding | E1, E2 |
| `restoreSeat` (`t=` beats the pocket; `listener_state` pull) | the engine's `hold` with `MCC_POCKET.read`/`pull` | E3, E9 |
| Row lengths | `data/albums.json` `seconds` (40 of 41 tracks carry it); the per-row metadata probe `Audio` (`album.html:1157`) goes | E1 |
| Shelf tastes (`pv`, `album.html:1359`, its own Now Playing surface "shelf") | cards play through the engine | E1 |
| `MCC_NP_PLAY` / `MCC_NP_PAUSE` (`album.html:2660-2661`) | the engine's | E12 |
| `#deckbar`, `#now`, `#seekStatus` markup and CSS | removed | E1 |

Removed from `album.html`: the `<audio id="deck">` (line 724), the deck bar, its Now sheet, the inline player between
lines 843 and 2667 except the parts the table keeps, the shelf-taste `Audio` and the row probe `Audio`.

### 4.9 The other players become callers

| Today | After |
| --- | --- |
| `music-videos.html:91` `<audio id="deck">` with its own Now Playing binding | `MCC_MUSIC.playList(...)`; the muted card films follow `media()`; the page joins the view routes in stage 4 |
| `js/pip.js` pocket: its own `<audio>` (line 409), tile, surface "pocket" | keeps the `MCC_POCKET` store (save, read, pull, clear); on a page with a banked song and no engine it loads `js/now-playing.js` and `js/music-engine.js` and calls `hold(bank)`; the bar shows the song; the tile and its element go. The front page (`index.html`) stays excluded as today |
| `js/game-hub/shared-music.mjs` reads `engine.audio` | reads `engine.media()` |
| `js/world-audio-continuity.js` theme `Audio`, rotation, its Now Playing surface "world", its transport | section 5 |
| `js/label.js` (`if (!rail \|\| !deck) return;` line 31; beam line 384; `napSet` line 431) | reads `media()`; beam and sleep move to the Now sheet and the engine; the vault, toast and share stay |

### 4.10 M5 stage 2 is replaced

Removed: `guestEngine` (`js/music-shell.js:614`), `setOwner` (638), `ownerWatch` (643), `MCC_MUSIC_GUEST`
(`js/music-engine.js:24`), `html[data-music-owner]` and its CSS, the album's entries in the shell's `ALLOW` list
(`#deckbar`, `#now`, `#seekStatus`; the bar's player and the Now sheet stay allowed). `ROUTES.album` becomes
`{ top: true, view: true }` (`js/music-shell.js:42`), so any of Listen, an artist page or an album can be the retained
document and the others open as views over it, all through one engine.

If Release 2 has to ship before stage 1 is done, M5 ships with `ROUTES.album = { top: false, view: false }`: the album
is never retained, so no view ever opens over a deck and two players never share the bar (a one-line containment).

### 4.11 Measurement

No event name is added or renamed. Each start sends what its surface sends today: album rows `album_play` (and the
gated `music_full`/preview names as today), Listen and artist songs `music_play`, the World's shuffle the World's
`song_*` names with `page: "world"`, the bar `bar_transport`. QW's approved `music_interrupted` and `music_error` come
from the engine once per drop. The dictionary rows (`workers/mccluster/src/analytics/measurement-dictionary.js`) get
their file lists moved to the engine where the call moved. Two names stop because their surfaces go: `pocket_open`
(the tile) and `now_sheet_open` (the album's sheet; the one sheet sends the engine's `music_now_open`); their rows are
kept for history and marked as no longer sent. Read: `song_mute`, `song_unmute`, `song_volume`, `song_hidden` and
`song_skip` are sent by the World today without dictionary rows; the slice keeps exactly today's World names and lists
those five in the record for Matthew's measurement review instead of adding rows itself. The World's shuffle is not
sent to the listen ledger, as the World's songs are not today, until Matthew answers question 3.

---

## 5. The World

### 5.1 The World's song is the engine's shuffle

`js/world-audio-continuity.js` keeps its frame, bridge, history and leave rules, and loses its player: the theme
`Audio` (`ensureTheme`, line 366), the rotation (255-287), its Now Playing binding ("world"), its own mute (234-240,
413) and its transport (`ensureControls`, `#mccWorldAudioControls`). What it does instead:

- `playTheme` (line 389) becomes: if the engine holds nothing and the listener has not paused the World's song before
  (`mcc_world_audio_preference.paused`, kept), call `MCC_MUSIC.shuffle({ from: "world" })` synchronously in the Globe
  tap. If the engine holds a song, opening the World leaves the sound as it is.
- `selected()` and `player()` (line 95) are the engine.
- The corner stack (owner, 2026-10-19): the song title still scrolls in `#mnNowPlaying` and timed lyrics still take
  the headline, driven by the engine's element events. `#mnWorldPlay` stays as the way to start the World's song
  before anything is held and hides while the bar carries a song.
- Audible member media or a live room still pause the player, as today (the frame's `play` listener posts `pause`).
- The World's `song_*` events come from the engine's shuffle context with today's names.

### 5.2 Music to the World (framed inside the music document): seamless

Unchanged in mechanics: the Globe opens the company World in a frame over the retained document
(`https://mccluster.org/?…&mcc_audio=1`), the music document owns the sound, the frame shows state. What changes: the
sound is the engine; the bar stays above the frame (`body[data-world-audio-open]>.appbar{z-index:2200}`) and is the
player; the framed World hides its own bar (`css/style.css:1620`) and makes no element.

### 5.3 The World back to Music: links open as views

Today a link in the framed World to another page of the site leaves the frame with `root.top.location.href = …`
(`js/world-audio-continuity.js:686-692`), a page load that ends the song. New: for a link to a house music route the
frame posts `{ channel: "mcc-world-audio-v1", type: "music-open", href, id }` to the parent; the parent checks the
origin, the nonce and that `href` is its own origin and a view route (listen, artist, album; account for sign-in),
then closes the World and opens that page as a view (or reveals the retained page). Anything else keeps today's top
navigation. The song line ("Return to Music") and the Music tab with nothing held keep closing the World as today.

### 5.4 The World opened directly

`mnet.html` loads `js/now-playing.js` and `js/music-engine.js` (its CSS too). On the company host and on the house
origin's compatibility address the World document is the top document, so it runs its own engine instance and plays
the shuffle on the first trusted tap (today's `touch()` rule, `js/world-audio-continuity.js:801-808`, leaving taps on
the bar and the chip alone). Inside a music document's frame the engine returns at once (`html.mn-music-frame`), so
the framed World never has a second element. The bar on the World shows the player as everywhere else. The Worker's
World route must pass the new script tags through unchanged (check `workers/mccluster/src/world-host.js` and
`workers/mccluster/src/human-uprise/router.js`; same-origin scripts are already what the World loads).

### 5.5 Across hosts: what the web cannot do, and what would make it possible

When the World was opened directly at `mccluster.org` and the listener goes to Music at `matthew.mccluster.org`, the
top window changes document and origin. The web cannot:

1. keep a media element playing across a top-level navigation; a document's media ends with the document;
2. start sound in the new document without a tap on iPhone (WebKit needs a gesture in that document; desktop
   Chromium may allow it after earlier engagement: Inferred, measured in the build);
3. let a cross-origin frame start its parent's sound inside the same tap (`postMessage` carries no gesture);
4. join the two origins into one document (3.2) or share storage between them (`localStorage` is per origin).

So, within the law, the song is handed over: the Now sheet's Music and Album links and every other music link from
the company host carry `#mcc_pick=<album>/<track>@<seconds>&ctx=shuffle[&m=1]` in the fragment, which is never sent to
a server. The house
page reads it once, accepts only a catalogue key that is public and playable (never gated or held), clamps the second,
removes it from the address with `history.replaceState` before analytics reads anything, and calls `hold()`. The bar
shows "Pick up at 0:42"; one tap continues from there in the shuffle. `m=1` carries the mute.

What would make it seamless: Music and the World in one origin for that visit, which means the company host serving
Matthew's music pages as same-origin views instead of redirecting them to `matthew.mccluster.org` (Measured: today
`mccluster.org/listen.html` and `/album.html` answer 301 to `matthew.mccluster.org`). That puts Matthew's music pages
under the company's address, which the two-entity law leaves to Matthew (docs/control-plane/DOMAINS-AND-ENTITIES.md);
question 1. Framing `matthew.mccluster.org` pages inside the company page is not an answer: the frame is cross-origin,
so a song chosen in it could not start the World document's player in the same tap on iPhone, which brings back a
second player. Using the house-origin `mnet.html` as the World frame (same origin, Measured readable) was considered
and rejected: it would show the company's World under Matthew's address.

### 5.6 Two entities, kept apart

- The World document's head never changes: the engine does not write `document.title`, canonical or Open Graph tags
  on the World (the shell mirrors heads only for music views on the house origin). W11 checks it.
- Now Playing metadata names the song, the catalogue's artist ("McCluster" after QW) and the album; never McCluster
  Corp.
- The Now sheet on the company host shows the song, lyrics, controls, AirPlay, sleep, share and the Music and Album
  links (to Matthew's pages, with the hand-over); it hides the License, On the record and Book the studio doors.
- No music page is served on the company host by this slice (that is question 1), and no company metadata enters the
  music pages. The World framed over Music keeps today's "World · Equity Uprise" title while open.

---

## 6. One mute, one Pause, the Music tab

**One mute.** `MCC_MUSIC.mute(on)` sets `muted` on the one element and stores `mcc_music_mute` in `localStorage`
(one value per site address; the hand-over fragment carries it across hosts). It applies to every song, the World's
shuffle included. The status line above the bar says "Muted" with Unmute in one tap on every surface; the Sound
button in the bar and the Now sheet toggle it. M3's recovery case (a song that came back muted to keep iOS's audio
session) uses the same Unmute. The World's old key `mcc_world_audio_preference` keeps `paused` (the World does not
start a song for a listener who paused it) and its `muted` field is ignored; it is not migrated, because a theme muted
long ago must not silence every song. Volume is not a mute: on iPhone it is the hardware's.

**The Music tab.** While the engine holds a song in this document (or in the music document under the World's frame),
the Music tab is Play/Pause on every page: labelled "Pause music" while playing and "Play music" while paused, a tap
calling the engine's `MCC_NP_PAUSE`/`MCC_NP_PLAY`, `bar_transport` as today. This reverses two exceptions on purpose:
the World (`js/tabbar.js:1158-1160`, RF-3 "the way back to the music, never its Pause") and music views (M5). With
nothing held, the tab is today's link to Listen. The front page's own player (js/main.js) does not count as a held
song (`engine: true` in the detail), so the front page's bar is unchanged.

**One Pause in the installed app.** The dock loses its own Play; the Music tab is the only control named "Pause
music" (B5 shows two today).

---

## 7. Sign-in comes back to the music

### 7.1 Password sign-in

- The chip: `js/tabbar.js:629` sets `ROOT + "account.html"`. On music pages and views it becomes
  `account.html?next=<the page shown>` (the view's address, or the retained page's), computed at click time.
  Other pages keep today's link.
- The song test: `album.html:1000` mounts with `{ signin: "account.html" }`; it passes
  `"account.html?next=" + encodeURIComponent(location.pathname + location.search)` (in a view, the view's own address).
- The account page opens as a view (M5 stage 3), the song keeps playing, and after sign-in `goOn(next)` replaces the
  view's address with `next`; the shell routes it to that view or reveals the retained page (Read: `account.html:348`,
  `js/music-shell.js` `stray`/`decide`).
- Limit, kept as today: a new member whose profile is not finished goes on to the World's finish pages
  (`mnet.html?finish=1`), which the shell loads as a page from an account view (`decide`, World addresses from the
  account view are `load`). The song is banked first and picked up after (one tap).

### 7.2 Google and Apple without ending the song

Providers are off in production today (B6 needed a fixture); this is built and proven with the fixture and goes live
when Matthew switches a provider on.

1. The provider button in `account.html` (around line 600-620) opens `location.origin + "/auth/popup.html?provider=" +
   key + "&next=" + encodeURIComponent(back)` with `window.open(…, "mcc-signin", "popup,width=480,height=720")` inside
   the tap, and shows "Finish signing in in the other window" with Cancel.
2. New `auth/popup.html` (same origin, loads `js/mcc-auth.js`) sets a `sessionStorage` flag `mcc.auth.popup = "1"` and
   calls `MCC.signInWithProvider(provider, location.origin + "/auth/?next=" + encodeURIComponent(next))`. The redirect
   address is exactly today's, so the account service's allowed list is untouched; the PKCE verifier is written by the
   popup's own `beginSocial` into the popup's own `sessionStorage` (`js/mcc-auth.js:296-309`).
3. `auth/index.html`, after `MCC.complete()` (line 45 area), checks the flag: if set, it clears it, tries
   `window.close()`, and otherwise shows "You're signed in. Return to the music." with a link to the destination; if
   not set, it does exactly what it does today (`location.replace(destination)`).
4. The music page needs no message from the popup: the session lands in `localStorage`, `js/mcc-auth.js` already
   turns the `storage` event into an account change (`js/mcc-auth.js:416`, `onAccountChange` 476), and the account
   view goes on to `next` as for a password sign-in. This also works when the provider's pages cut the link to the
   opener.
5. Fallback, when `window.open` returns nothing, in the iOS Home Screen app (a pop-up there opens with separate
   storage) and in in-app browsers (the ones `js/now-playing.js:350` `inApp` already detects): one line, "Google sign-in
   leaves this page; your song picks up where it was", the song banked to the pocket, then today's redirect. Back on
   the music page the bar holds the song at its second.
6. `js/mcc-auth.js` stays byte-identical. Its own provider panel (`mountAccountSocial`, `js/mcc-auth.js:812`) mounts
   into `#acOauth`, which no page has (Read: no match in any `.html` at `0ef1481c`), and keeps its redirect.
   `scripts/test/signup-authority.test.mjs` gets its `account.html` pattern updated deliberately.

---

## 8. The chip over the Now sheet's Album link

The chip is `position:fixed; z-index:999` (`js/tabbar.js:569`); the sheet is `position:fixed; inset:0; z-index:140`
(`css/music-system-v2.css:374-375`). The sheet becomes a modal layer: `z-index` above the chip and below the World's
frame (2000), `role="dialog"` and `aria-modal="true"`, the chip and the bar made `inert` while it is open, Escape and
Close close it and focus returns to the song line. The Album link keeps its place at the head's right and nothing
covers it at 320, 390 or 430 px; it opens the album as a view, so the song keeps playing (B7 today: a page load and the
song back at 0:00, paused).

---

## 9. The analytics regression

1. `js/analytics.js`: put `/* PAGE_IDENTITY_BEGIN */` before `var MCC_PAGE_IDENTITY = (function () {` (line 42) and
   `/* PAGE_IDENTITY_END */` after its closing `})();`. Comments only: no behaviour change.
2. `workers/mccluster/test/analytics-creator-attribution.test.mjs`: before running the outbox factory and the
   `MCC_TRACK` slices, run the identity slice in the same `vm` context:
   ```js
   const idStart = source.indexOf('/* PAGE_IDENTITY_BEGIN */');
   const idEnd = source.indexOf('/* PAGE_IDENTITY_END */');
   assert.ok(idStart >= 0 && idEnd > idStart, 'page identity markers present');
   vm.runInNewContext(source.slice(idStart, idEnd), context);
   ```
   and add a case for a view: path and referrer from a music view are kept, and a creator handle only on
   `music-creator.html` with a valid handle.
3. Run the whole Worker suite (`cd workers/mccluster && npm test`) and record the counts; base is 2032 tests, 2022
   pass, 1 fail, 9 skipped.

QW also edits `js/analytics.js` (Q7 removes the hold); the markers go on top of QW's version.

---

## 10. Stages and acceptance

Every new e2e row lives in a new `scripts/e2e/music-one-engine.e2e.mjs` (plane fixtures as the M3/M5 suites use;
Chromium through `require('playwright')`, under the browser lock, niced) unless another file is named. Static checks
live in a new `scripts/test/music-one-engine.test.mjs`. Each row says how it fails at the base.

### Stage 0: repairs (may ship in Release 2 on their own)

What: the analytics fix (section 9); the card-play defect (`e.target.closest("[data-music-play]")` in the view agent
and the top click handler, `js/music-shell.js:220` and `:510`); the Release 2 containment in 4.10 if needed.

| Row | Check | At the base |
| --- | --- | --- |
| A0.1 | `node --test workers/mccluster/test/analytics-creator-attribution.test.mjs`: all pass, including the new view case | 1 pass, 1 fail: `ReferenceError: MCC_PAGE_IDENTITY is not defined` (Measured) |
| A0.2 | Whole Worker suite: 0 fail | 2032 tests, 2022 pass, 1 fail (#69), 9 skipped (Measured) |
| A0.3 | `scripts/e2e/music-shell.e2e.mjs`: Listen as a view over a retained album; tap the play button of a card inside its album link: that song plays, the view stays | B2c: the view closes, nothing new plays (Measured) |
| A0.4 | `scripts/test/music-shell.test.mjs`: the agent and the top handler ignore a click whose target is inside `[data-music-play]` within an anchor | fails: the check reads the anchor's ancestors (Read) |

Gates: root suite (`npm test`), whole Worker suite, music-shell unit and e2e.

### Stage 1: one engine on the music pages

Built in two steps that are each green: **1a** the engine API, contexts, events, the bar's player in music pages, the
Now sheet merge, `album.html` at the top through the engine with its deck removed, the chip fix; **1b** the album as a
view, M5 stage 2 removed, the lens, the pocket, music videos and the game hub capsule as callers.

| Row | Check | At the base |
| --- | --- | --- |
| E1 | Static: no `new Audio(`, `<audio`, `createElement("audio")` in `album.html`, `music-videos.html`, `listen.html`, `music-creator.html`, `js/label.js`, `js/pip.js`, `js/game-hub/shared-music.mjs`; only `js/music-engine.js` makes one. Chromium: on listen, artist, album at the top, album as a view over Listen and music videos, the top document holds one catalogue element and one Now Playing binding for the whole journey (the World's theme is counted in stage 2) | `album.html:724`, `:1157`, `:1359`, `music-videos.html:91`, `js/pip.js:409` (Read); album 3 audio objects and 2 bindings, music videos 2 (Measured) |
| E2 | Album at the top: row 1 plays on the engine (record context); the bar shows Previous, the title, Pause, Next; Next plays row 2; after the last row it stops at its end; one lock-screen owner | the deck plays; there is no engine on `album.html` (Measured B0) |
| E3 | Listen at the top, playing; tap an album: it opens as a view (`/album.html?album=…`), the song keeps playing (no `pause`, time advances); row 3 switches the same element; Back: Listen, still playing; `?t=` at a fresh top load holds that song at 0:00 | the album is a page load; the song comes back at 0:00, paused (Measured B7) |
| E4 | Album retained and playing; its context bar's Listen opens Listen as a view; the song continues; a Listen row plays on the same element; no `data-music-owner` | four audio objects, the owner flips between engine and deck (Measured B2) |
| E5 | Now sheet: timed lyrics follow a song that has `data/lyrics`, a line tap seeks; credits and the doors show (house origin); Sleep 1 minute (clock advanced) pauses; Share; Sound toggles the one mute; AirPlay shows only where offered | `#musicNow` has none of these; they are in `album.html`'s `#now` (Read) |
| E6 | Album as a view: the room light follows the peaks at the engine's time and goes dark when muted; the waveform draws on the sheet's seek; closing the view leaves no listener it added on the element | `js/chamber.js:33`, `js/filament.js:24`, `js/intuition.js:95` read `#deck`, which a view does not have (Read); the album cannot be a view (Read: `js/music-shell.js:42`) |
| E7 | Keep an album; go offline; play a kept song from the album and from Listen: it plays from the vault through the engine | album rows play through `#deck`, not the engine (Read) |
| E8 | Plane fixtures: an earned gated play from an album row makes one claim through the engine; the row paints granted with its expiry; no seek past what was earned; the held closing song shows the QW pop-up and requests nothing | the album's own `claimThenPlay` and `spend` run (Read) |
| E9 | From a playing album, a page load to `catalogue.html`: the bar holds the song at its second with Play; one tap continues; the only element is the engine's | `js/pip.js` makes its own `<audio>` and tile (Read) |
| E10 | Music videos: a card plays through the engine (list context), one element, the card's muted film follows | `music-videos.html` has its own `#deck` (Measured B0) |
| E11 | 320/390/430 px, sheet open: `elementFromPoint` at the Album link's centre is the link; the tap opens the album as a view and the song continues | the centre hits the chip's text; the tap is a page load (Measured B7) |
| E12 | Album and artist pages, at the top and as views, with a song held: the Music tab is named "Pause music" and pauses the engine, then "Play music" resumes it | the tab is a transport only on Listen (`js/tabbar.js:1167`) and never over a view (Read) |
| E13 | Guest and owner bars with a song held at 320, 390, 820 and 1280 px: `scrollWidth === clientWidth`, every control at least 44×44, nothing covers the bar's buttons; the bar without a song is today's | no player in the bar outside the installed app (Read) |

Gates: root suite; whole Worker suite; `music-platform-ci.yml` jobs `music-contract`, `music-edge`, `browser`; under
the lock one at a time: music-one-engine, music-shell, music-background, now-playing, music-accounts, installed-app,
control-music-review, music-direct-checkout, site-navigation, game-hub-capsule, tabbar-auth-refresh, music-quick-wins;
peaks, artwork, track-length and lyrics data checks; the source map validator; `domain-architecture.test.mjs`;
`music-offline-vault`, `music-label`, `listening-room`, `song-test`, `music-playback-races`, `music-measurement`,
`gated-audio`, `listen-ledger`, `now-playing-contract`, `installed-app-shell`, `no-screen-flashes` unit tests.

### Stage 2: the World on the engine

| Row | Check | At the base |
| --- | --- | --- |
| W1 | Listen with nothing held, tap the Globe: `MCC_MUSIC.shuffle` runs inside the tap, context shuffle, one element in the document, no World-owned `Audio`; over the World the bar shows Previous, the title, Pause, Next | the World theme `Audio` plays, the engine is empty, the World's own transport shows (Measured B3) |
| W2 | From W1 tap the song line: the World closes, Listen shows, the same song keeps playing (no `pause`, time advances) and the bar shows it | the theme keeps playing but Music shows nothing (Measured B3) |
| W3 | From W2 tap an album row: record context, that song; Next stays in the album; it stops after the last song | the theme pauses and the engine plays: two players (Measured B3) |
| W4 | Shuffle: 50 Nexts never repeat a song back to back, cover the 40-song pool before a repeat, never reach a gated, held or preview song; Previous walks back; lock-screen next/previous do the same | `MCC_MUSIC.shuffle` does not exist (Read) |
| W5 | Mute in the World: the engine is muted and `mcc_music_mute` stored; in Music the same song shows "Muted" with Unmute; an album song chosen next stays muted until Unmute; Unmute in Music unmutes the World's next song; the old key's `muted` is ignored | the World stores `{"muted":true}` for its theme only; Music songs play unmuted; the theme plays muted with nothing showing it (Measured B3) |
| W6 | In the framed World a link to a house album or artist page closes the World and opens the page as a view; the song continues | `leaveFrame` navigates the top window (Read: `js/world-audio-continuity.js:686-692`) |
| W7 | The World opened directly (house `mnet.html`; the company host through a route fixture): the first trusted tap starts the shuffle on the World document's engine; the bar is the player; the corner Play hides while the bar carries the song; inside a music document's frame no element is made | the World's theme `Audio`, no engine (Measured B8) |
| W8 | Company host fixture, song at 0:42; the song line opens the Now sheet (the song keeps playing); its Music link goes to house Listen with the hand-over: the bar holds the song at 0:42 ("Pick up at 0:42"); one tap continues from there in the shuffle; the fragment is gone from the address before any event is sent; unknown, gated or held keys and bad seconds are ignored | Listen holds nothing (Measured B8) |
| W9 | Framed World, World opened directly, and a page with a banked song: while a song plays the Music tab is "Pause music" and pauses it | in the framed World the tab is "the way back to the music" (Read: `js/tabbar.js:1158-1160`) |
| W10 | Installed app with a song: exactly one control named "Pause music" (the Music tab) | two (Measured B5) |
| W11 | Guard: the World at the company host with a song playing keeps its title, canonical `https://mccluster.org/` and `og:site_name` "McCluster Corp"; the sheet there shows no License, On the record or Book the studio; music pages keep their heads; `domain-architecture.test.mjs` passes | passes today (a guard for the change, not a fix) |

Gates: stage 1's, plus music-world-continuity, world-travel-guest, world-first-visit, human-uprise-door e2e and the
World unit tests that load `js/world-audio-continuity.js`.

### Stage 3: sign-in

| Row | Check | At the base |
| --- | --- | --- |
| S1 | On Listen, album and artist pages (top and views) the signed-out chip's href is `account.html?next=<page shown>`; a password sign-in in the account view lands back on that page; the song never pauses | the chip has no `next` (Measured B6; Read `js/tabbar.js:629`) |
| S2 | The album's song test sign-in link carries `next` | `album.html:1000` mounts with `signin: "account.html"` (Read) |
| S3 | Provider fixture on: Google in the account view opens `/auth/popup.html` in a new window in the same tap; the music document stays and plays; the fixture completes in the pop-up; the account view goes on to `next`; the pop-up closes or shows its return line | the top window goes to `/auth/v1/authorize`; the album and its deck are gone (Measured B6) |
| S4 | `window.open` stubbed to return nothing (and the Home Screen app flag set): the fallback line shows, the song is banked, the redirect runs; back on the music page the bar holds the song at its second; one tap continues | the song is gone; the album comes back at 0:00 (Measured B6, B7) |
| S5 | `git diff --exit-code <base> -- js/mcc-auth.js` is empty; `signup-authority.test.mjs`, `one-signup-flow.test.mjs`, `sign-in.e2e.mjs` and `tabbar-auth-refresh` pass | guard |

### Stage 4 (optional): more pages as views

`music-videos.html`, `catalogue.html` and the house's other music pages (licence, studio, PRIM3 artist pages) join
`ROUTES` as views. For each: it opens as a view and the song continues. At the base each is a page load. `index.html`
is not among them (section 13).

---

## 11. File plan

| Path | Change | Stage |
| --- | --- | --- |
| `js/analytics.js` | comment markers around `MCC_PAGE_IDENTITY`; no behaviour change | 0 |
| `workers/mccluster/test/analytics-creator-attribution.test.mjs` | run the identity slice first; a view case | 0 |
| `js/music-shell.js` | card play: `e.target.closest("[data-music-play]")` (lines 220, 510); then `ROUTES.album.view = true`; remove `guestEngine`, `setOwner`, `ownerWatch`, `MCC_MUSIC_GUEST` use; `ALLOW` without `#deckbar`, `#now`, `#seekStatus`, with the bar's player; lens cleanup through the view API; the World's `music-open` handler | 0, 1, 2 |
| `js/music-engine.js` | contexts (record, list; shuffle in stage 2), `hold`, `seek`, `context`, `mute`/`muted`, `sleep`, `stop`, `media`, `on`; events; the closer rule; `tellBar` everywhere; `engine`/`held` in `mcc:nowplaying`; one binding; facade gains the calls and the lens; `#musicMini` retired; early return in `html.mn-music-frame`; hand-over reader (house) and writer (company host links) | 1, 2 |
| `js/music-sheet.js`, `css/music-sheet.css` (new) | the one Now sheet's album features, loaded on first open; modal above the chip | 1 |
| `css/music-engine.css`, `css/music-system-v2.css` | retire the mini pill; the sheet's layer and modal rules | 1 |
| `js/installed-app-dock.js` (or its successor, e.g. `js/music-bar.js`), `css/installed-app-dock.css` | the bar's player in every top window with the bar; Sound in place of its Play; the song line per 4.6; drawing per BAR-RESTORE.md | 1, 2 |
| `js/tabbar.js` | Music tab = Play/Pause wherever the engine holds a song (World and view exceptions reversed; front page excluded); chip `next` on music pages; load the bar's player everywhere the bar is | 1, 2, 3 |
| `album.html` | remove `#deck`, `#deckbar`, `#now`, `#seekStatus`, the inline player, `pv`, the row probe; rows through the engine; `t=` as `hold`/highlight; gate chips from reads and events; song test `next`; load `js/music-engine.js`; keep everything in the 4.8 table | 1, 3 |
| `js/label.js` | `media()` instead of `#deck`; beam and sleep to the sheet and engine; vault, toast, share unchanged | 1 |
| `js/chamber.js`, `js/filament.js`, `js/intuition.js` | `MCC_MUSIC.media()` instead of `#deck` | 1 |
| `js/shell-boot.js` | the hide list in views follows the retired controls | 1 |
| `js/pip.js` and its CSS | keep `MCC_POCKET`; drop its `<audio>` and tile; load the engine and `hold` a banked song | 1 |
| `music-videos.html` | its `#deck` replaced by `MCC_MUSIC.playList`; films follow `media()` | 1 |
| `js/game-hub/shared-music.mjs` | `engine.media()` instead of `engine.audio` | 1 |
| `js/world-audio-continuity.js`, `css/world-audio-continuity.css` | no theme player, rotation, World binding, own mute or transport; `playTheme` calls `shuffle` in the gesture; `selected()`/`player()` = engine; the corner Play hides while the bar carries a song; `music-open` from the frame; frame clearance for the bar's status line | 2 |
| `mnet.html` | load `js/now-playing.js`, `js/music-engine.js` and its CSS for the World opened directly | 2 |
| `js/action-globe.js` | obstacle lists (lines 194, 259) drop `#mccWorldAudioControls`, add the bar's status line | 2 |
| `workers/mccluster/src/world-host.js`, `workers/mccluster/src/human-uprise/router.js` | check only: the new script tags pass through on the company host; expected no change | 2 |
| `account.html` | provider buttons: pop-up first, fallback line and redirect with the song banked; pending state with Cancel | 3 |
| `auth/popup.html` (new) | sets the pop-up flag and starts the provider in its own window | 3 |
| `auth/index.html` | pop-up branch after `MCC.complete()`; otherwise unchanged | 3 |
| `js/mcc-auth.js` | unchanged (byte-identical) | 3 |
| `workers/mccluster/src/analytics/measurement-dictionary.js` | file lists follow moved calls; `pocket_open`, `now_sheet_open` marked no longer sent | 1, 2 |
| `scripts/test/music-one-engine.test.mjs`, `scripts/e2e/music-one-engine.e2e.mjs` (new) | the rows in section 10 | 0-3 |
| Existing tests, deliberately changed | `music-shell` (stage 2 scenarios and the `ALLOW` list), `now-playing-contract` and `now-playing` e2e (one surface), `music-background` (D-7 inverted), `music-world-continuity` (theme → shuffle, no World transport, Music tab), `installed-app` (one Pause), `listening-room`, `music-offline-vault`, `music-label`, `song-test`, `game-hub-capsule`, `music-playback-races`, `music-measurement`, `no-screen-flashes`, `world-travel-guest`, `human-uprise-door`, `signup-authority` | 1-3 |
| `.github/workflows/music-platform-ci.yml` | the new unit file in `music-contract`, the new e2e in `browser` | 1 |
| Source map (the repository's source map data and its validator) | rows for the new files | 1-3 |
| `docs/music/DESIGN-SYSTEM-V2.md`, `docs/music/MUSIC-WORLD-CONTINUITY.md`, `docs/music/MUSIC-RELEASE-20261119.md` | the album has no player of its own; the bar is the player; the World plays the shuffle; D-7 reversed; the slice's record section with the device rows | 1-3 |
| `docs/control-plane/SHARED-NAVIGATION.md` | the compact music bar in every window, not only the installed app (Matthew, 2026-11-23); one Pause | 1 |
| `music-shell` ROUTES additions | stage 4 pages as views | 4 |

---

## 12. Risks and how each is contained

1. **The gesture from a view to the top element on iPhone.** A tap in a view calls the top engine synchronously; M5's
   Listen and artist views already rely on it, and it has no device proof yet. Contained: the facade never awaits
   before `play()`; if `play()` is refused the bar shows Play and one tap at the top plays; device row 1.
2. **`album.html` is 2,600 lines with many features.** Contained: the feature table in 4.8 with a test per row; stage
   1 split into 1a (top) and 1b (views); the album's DOM ids that tests use are kept where the page keeps the feature.
3. **The offline vault depends on identical audio URLs.** Contained: the engine requests the same URLs the album did
   (same `ROOT` resolution, the `SAME_AUDIO` table); E7 runs offline in Chromium; device row 12.
4. **Gated and earned plays move from the album's code to the engine's.** Contained: E8 on the plane fixtures; the
   closer rule moved explicitly; the gate SQL is untouched.
5. **The bar at 320 px with the owner's seven-tab bar.** Contained: the dock's grid and scrollable tabs already fit
   in the installed app; E13 renders guest and owner bars at 320/390/820/1280 and checks overflow and 44 px targets.
6. **Pop-up sign-in.** Provider pages can cut the link to the opener; the Home Screen app opens pop-ups with separate
   storage; blockers return nothing. Contained: completion rides the `storage` event (no opener needed); the pop-up
   shows a return line if it cannot close; the fallback banks the song and uses today's redirect; S3 and S4.
7. **The hand-over fragment is input from an address.** Contained: only catalogue keys that are public and playable,
   the second clamped, scrubbed before analytics, never sent to a server; W8 includes bad values.
8. **QW is moving.** Contained: build only from the head after QW is verified and pushed; re-read QW's record;
   rebase line references.
9. **Measurement drift.** Contained: no new names; the dictionary file lists move with the calls; two retired names
   recorded; the World's five unlisted names recorded for Matthew's review; `music-measurement` test.
10. **Two entities.** Contained: W11; the World's head untouched; commerce doors hidden on the company host; no music
    page served on the company host.
11. **The World's first tap rules and the privacy banner.** Contained: the shuffle starts only where the theme starts
    today (same `touch()` rule and exclusions); `world-first-visit` e2e in the gates.
12. **Release ordering.** Release 1 is cut from `dc0185aa` without M5. If Release 2 must ship before stage 1, it
    carries stage 0 and M5 with the album not retained (4.10).
13. **Stale scripts across a deploy.** Pages load scripts with `?v=__STAMP__` (Read: `listen.html:225-226`), so a page
    and its scripts change together; nothing extra needed.
14. **The Music tab stops being the way to Music while a song is held.** Contained: the music pages' context bar
    ("Music", "Listen") stays on every music page, the song line returns to Music from the World, Back works, and the
    tab is the way to Music again whenever nothing is held. If Matthew prefers Play/Pause at the bar's side after
    seeing BAR-RESTORE.md, the tab goes back to navigation with no engine change (4.6).

---

## 13. What stays out

- **The front page** (`index.html`/`front.html`, js/main.js with six `<audio>` and its scene): hard rule 3. The M tab
  still loads it and stops the song (it is banked and picked up after). Question 2.
- **`embed.html`**: embeds live on other sites and keep their own small player (QW already stops them at the end and
  skips gated and held songs).
- **Member media and live rooms in the World**: they pause the one player when they play with sound, as today.
- **Creator Studio's audio tools** (uploads, previews of unreleased work): not catalogue songs.
- **The finish pages after a first sign-in** (7.1): a page load, with the song banked.
- **Serving music pages on `mccluster.org`** (question 1) and counting the World's songs as plays (question 3).
- **Device proof on Matthew's phone**: the rows below become his short checklist once something is live.
- **Later slices**: the universe background, trimming silent tails, Creator Studio v2, the closing song's full gate,
  collaboration, the granular UX sweep.

---

## 14. Device rows for Matthew

Plain steps for an iPhone, in Safari unless the row says the Home Screen app. The first five are the short checklist.

1. Open Music, play a song, tap an album: the album opens and the song keeps playing. Tap a song on the album: it
   switches. Go back: still playing.
2. Lock the phone: one music card with back, pause and forward, and they work.
3. In Music with nothing playing, tap the Globe: a song starts. The bottom bar shows back, pause and forward with the
   song's name. Forward plays another random song.
4. Tap the song's name: you are back in Music and the same song is still playing. Tap a song on an album: that album
   plays and stops after its last song.
5. In the World tap the sound button to mute. Go to Music: still muted, and the bar says Muted. Tap Unmute: sound
   comes back everywhere.
6. Home Screen app: play a song; there is only one pause button at the bottom.
7. Open `mccluster.org` directly and let the World's song play. Tap the song's name, then Music: Music opens and says
   "Pick up at" the same time; one tap continues.
8. With a song playing on an album, tap Sign in and sign in with your email: you come back to the same album and the
   song never stopped.
9. When Google or Apple sign-in is switched on: a sign-in window opens; after signing in it closes and the song is
   still playing.
10. Open the full player and tap Album at the top right: the album opens (the Sign in button no longer sits on it).
11. In the full player set the sleep timer to 15 minutes: the music stops then.
12. Keep an album for offline, turn on Airplane Mode, play it from the album and from Music.

---

## 15. Questions only Matthew can answer

1. If someone opens the World straight at mccluster.org and a song starts, going to Music moves them to
   matthew.mccluster.org, which stops the song for a moment; one tap picks it up at the same second. The only way to
   avoid that tap is to also show your music pages at mccluster.org addresses. Keep the one tap, or show your music at
   mccluster.org too?
2. The M button opens your front page, which plays its own songs, so the song you were playing stops. Should the front
   page use the one player too? That means changing the front page itself.
3. Should songs the World plays at random count as plays on each song, like songs people pick in Music?

---

## 16. Evidence

All under (local evidence folder of the 2026-11-23 session; not in the repository):

- `live.mjs`: the live probe (GET/HEAD only, counting blocked, service workers blocked); output `out/live/live.json`.
- `branch.mjs` (with `debug.mjs`, `debug-run.mjs`): the branch-head journeys with route fixtures; outputs
  `out/branch/branch-b0.json` (inventory) and `out/branch-b2`, `-b2c`, `-b3`, `-b5`, `-b6`, `-b7`, `-b8`
  (`branch.json` each).
- `out/hosts-curl.txt`, `out/static-passthrough.txt`, `out/health.json`: the hosts.
- `analytics-fix/proof.test.mjs`: the analytics fix proven in scratch (2 of 2 pass at `0ef1481c`).
- `out/worker-suite-0ef1481c.txt`: the whole Worker suite at `0ef1481c`.
- Notes: (local evidence folder of the 2026-11-23 session; not in the repository).
