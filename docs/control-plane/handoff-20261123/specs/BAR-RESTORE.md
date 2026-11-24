# BAR-RESTORE: the small music bar, brought back as the one player's controls

Read-only archaeology of 2026-11-23 for the one-engine build. Nothing in the repository was changed, pushed or
deployed. This spec feeds the one-engine build (`SPEC-ENGINE.md`, written in parallel); it does not build anything.

## 0. What Matthew asked for

Matthew, 2026-11-23: "Also i noticed the bar at the bottom used to be smaller and have the feature where the music
would all be on the bottom bar with back and forward buttons on either side of the bottom bar added on with the music
details and more. i liked that design a lot."

His earlier answers that bind the same bar (the plan file `music-v2-plan-20261123.md`, item 1): one engine and one
player everywhere ("no matter where I go, the shit is still playing"); in the World "the bottom tab becomes the music
bar (pause, previous, next)", shuffled; "the bar's Music button pauses everywhere (one player); the installed dock
shows one Pause, not two"; one mute for the World and the music.

## 1. The answer in plain words

The bar he means is the **compact music bar of PR #820**, merged on 2026-11-20 at 17:22 (New York time) as
`b51ede03`, built in commit `382301d3` ("Fix installed iPhone safe areas and integrate compact music dock"). He asked
for it himself that afternoon, from a screenshot of the installed iPhone app: "make the bottom bar about one-third
smaller, and put playing music in the same bar with navigation in the middle and song information and controls at
its sides" (`docs/control-plane/SHARED-NAVIGATION.md`, "Installed app: safe header and compact music bar"). It is a
46 px bar (the old capsule is 68.4 px in its CSS, 69.4 px measured) with Previous and the song's title and artist on
the left, the same navigation in the middle, and Play/Pause and Next on the right.

Nothing on `main` replaced it. It is still live, but **only in the installed app** (opened from the Home Screen
icon): PR #820 kept the ordinary browser as it was ("Ordinary browser presentation stays unchanged"; the PR body:
"Preserve ordinary browser presentation"). In a Safari or Chrome tab the bar is the older, bigger capsule (69.4 px,
measured) with the song in a separate floating strip above it (63.4 px on Listen, 74.7 px on the album), so the
music and the bar take about 128 to 140 px of the screen's foot instead of 46. That bigger bar is what he is seeing
now: it is what Safari shows, and it is what the 2026-11-23 M5 renders sent to him show (`shots/M5/*-390-*.png`,
all in a browser). The M3 and M3 follow-up renders that did use the installed app show the small bar grown to two rows
while it says "Reconnecting…" (`shots/M3F-final/installed-listen-390-dock-reconnecting.png`).

On the working branch (not live), the M3 follow-up commit `73349a06` (2026-11-23 10:32 UTC) changed the small bar:
"The installed app's dock says why the music is quiet on a line of its own", so the bar grows a second row while it
says Reconnecting…, Loading… or Muted, and on the Listen page the bar's red Music button became a second Play/Pause
beside the dock's own (`docs/music/MUSIC-RELEASE-20261119.md`: "the dock now holds two Pause buttons side by side").
Release 1 (`claude/release-20261123`, from `dc0185aa`) carries those changes; M5 (`2000c609`) does not change the
bar's look.

The restore: make that small bar the one bar for everyone, in the browser and in the installed app, on Music, the
album and the World, driven by the one engine through `js/now-playing.js`, with one Play/Pause.

## 2. Every bottom-bar design, with its commits and dates

| # | Design | Commits | Dates | What it looked like |
| --- | --- | --- | --- | --- |
| A | The capsule bar, music outside it | `747f345f` (repo import) onward; music strips `1058c1a3`/`aab91f1a` (listen mini player, "Music V2"), `5ad54a17` (#495, the World transport) | 2026-08-30 to today (the browser bar; the installed bar until 2026-11-20) | A floating pill of round 54 px tabs, 0.45 rem padding, 68.4 px tall (`css/style.css` `.appbar`), 0.85 rem above the bottom. The Music tab is drawn as a play triangle / pause bars in CSS and is the page's transport where the page gives it one (`MCC_NP_PLAY`/`MCC_NP_PAUSE`, the album); elsewhere it goes to Listen. The music sits in separate floating strips above the bar: the album's deck bar (`.deckbar`: seek line, cover, title, time, then Previous, Play and Next grouped on the right; an Unmute joins them on the branch, M3), the Listen mini player (`.music-mini`: seek line, cover, title, album/access, time, Play; no Previous or Next), the World's transport (`#mccWorldAudioControls`: title, Play/Pause, Mute) and the pocket (`.pocket`). |
| A1 | Tab sets inside A | five columns (`16da8e32`, `63832ff6`); three columns (`1ac15b51`, `9af7674e`); Music, M, Globe (`ef6d1434` #432: "the Globe ... replaced the Profile column (owner, 2026-10-14)"); the owner's bar (`4473a900`, `f0434619`, `489f220d`, `17091e93`, `9f3280c5`, `2be808b0`) | 2026-08-30 to 2026-09-02; from 2026-09-25; from 2026-10-14; from 2026-10-16, seven owner tabs by 2026-11-04 | Guests and members: Music, the M, Globe. The house owner: Play, Inbox, Home, the M, Analytics, Globe, Games, plus the Control sections, scrolling with direction hints. |
| B | A, with one Now Playing owner | PR #818 merge `95db8460` (M1 `ea43e3e8`, M2 `2c8d2a06`, M4 `12e67777`); PR #819 `d3d57dfe` touched no bar file | 2026-11-19 22:36 to 2026-11-20 17:22 (-05:00) | The same capsule and floating strips. `js/now-playing.js` becomes the one owner of the lock screen; Previous and Next on every player's lock screen and sheets. **This is the design live just before PR #820.** |
| C | **The compact music bar (the one Matthew liked)** | `382301d3` (16:30), `3573f918` (16:46), `911fc446` (16:50), merged `b51ede03` (17:22) | 2026-11-20 (-05:00) to today, live (deployment `b51ede03`) | Installed app only. 46 px capsule, 44 px targets, 8 px above the home indicator. With a song: Previous and title/artist on the left, the navigation in the middle (132 px, scrolling for the owner), Play/Pause and Next on the right; the floating strips hide while it controls the same player. With nothing playing: the same 46 px bar with the tabs only. |
| C1 | C, changed on the branch | `3761bf15` (status words in the artist line; Pause while a song is picked up again), `73349a06` (the status on its own row above the controls; the Music tab becomes Listen's Play/Pause), `37e0bd18` (the Music tab's name says what a tap does), `2000c609` (M5: views; the one bar stays in the retained document, no change of look) | 2026-11-23 07:27, 10:32, 12:33, 17:31 UTC; not live; Release 1 carries the first three | During Reconnecting…, Connection lost · tap play, Loading…, Could not load · tap play and Muted the bar is two rows (a status line over the controls); on Listen two Pause buttons sit side by side. |

The full history was read from a blobless clone of the whole repository (the working clone is shallow from
2026-10-21): "Previous track", `appbar__music` and the installed dock appear first and only in `382301d3`. No earlier
bar ever put Previous and Next in the bar itself.

## 3. What replaced it, when, and why

- **On `main` and in production: nothing.** The live files (`js/installed-app-dock.js`, `css/installed-app-dock.css`,
  `js/tabbar.js`, `js/shell-boot.js`, `js/now-playing.js`, `js/world-audio-continuity.js`, `sw.js`, `listen.html`,
  fetched with GET on 2026-11-23) equal `b51ede03` apart from the deploy stamp.
- **In the browser it never existed.** `382301d3`'s record: "Installed presentation is detected from
  `navigator.standalone` or the standalone display-mode query ... Ordinary browser presentation stays unchanged."
  The capsule bar (design A/B) and its floating strips are the browser bar today on `main` and on the branch.
- **On the branch** `73349a06` (2026-11-23 10:32 UTC), in its own words: "On listen.html the engine tells the bar what
  plays and gives it Play and Pause ... The installed app's dock says why the music is quiet on a line of its own."
  Why (the record's M3 follow-up): the dock's second line cut "Reconnecting…" ("74 px of 73 at 390 and of 41 at
  320"), and on Listen the red Music button "kept its play triangle while a song played" (verification V-3). The
  record itself flags the result: "the dock now holds two Pause buttons side by side ... whether the Music button
  should stay the way to the shelf there is a design call."

### Renders

Each design ran from its own detached worktree (`wt-bar-pre820` at `d3d57dfe`, `wt-bar-820` at `b51ede03`,
`wt-bar-head` at `0ef1481c`) in Chromium at 390 x 844, deviceScaleFactor 2: every request answered from the worktree
or a fixture (patterned on `scripts/e2e/installed-app.e2e.mjs`), a synthetic 220 Hz WAV for every song, the installed
app stood in with `navigator.standalone` and CDP safe-area insets (47 px top, 34 px bottom); each run under the
browser lock. 22 scenes per design: Listen, the album (`?album=here`) and the World (`mccluster.org/` direct, and over
Music from the Globe), with a song playing, paused and with nothing playing, in the browser and installed, signed out,
and the house owner on Listen. Files: `shots/bar-history/<design>-<mode>-<persona>-<page>-<state>-390.png`; numbers:
`results/bar-history.json`.

| Measured at 390 x 844 | Before PR #820 (`d3d57dfe`) | PR #820, live (`b51ede03`) | Branch head (`0ef1481c`) |
| --- | --- | --- | --- |
| Browser bar | the same 69.4 px capsule (owner 70.2) | 69.4 px capsule (owner 70.2, ten tabs); song outside it | same as live |
| Browser, song playing on Listen | the same mini player above the bar | mini player 63.4 px above the bar: 128 px of the screen's foot | same as live |
| Browser, song playing on the album | the same deck bar above the bar | deck bar 74.7 px above the bar: 140 px | same as live |
| Browser, World over Music | the same | the bar has no music; title in the World's header, a round Pause at the globe (52 px control at the top) | same as live |
| Installed, nothing playing | the browser capsule, lifted 34 px by the home-indicator inset (top at 727 px) | 46 px, tabs only, 134 px wide | same |
| Installed, song playing | capsule plus mini player from 668 px down: 176 px of an 844 px screen (album: 187 px) | 46 px, 374 px wide: Previous, "Who Did T… / Matthew Mc…", Music, M, Globe, Pause, Next | same, but on Listen two controls are named "Pause music" (the Music tab and the dock's) |
| Installed, World over Music | the World's header, Join and the Sign in chip under the iPhone status area; the round Pause sits on the chip | the same 46 px bar over the World; the World's own controls hidden | same |
| Seams seen | installed: the World under the status area and a large bar over the feed (PR #820's own reasons) | Listen: the red Music tab shows a play triangle while the song plays; album: the Music tab is a second pause glyph | Listen: two Pauses |
| `scrollWidth === clientWidth`, page errors | all 22 fit, 0 errors | all 22 fit, 0 errors | all 22 fit, 0 errors |

The comparison for Matthew, `shots/bar-history/bar-then-and-now-390.png`: "Before" is `b51ede03` installed, Listen,
a song playing (the small bar he liked, still the Home Screen app's); "Now" is `b51ede03` in the browser, the same page
and song (what Safari shows today, and what the M5 renders showed him). Labels sit in a band above the pictures;
nothing is drawn on them.


## 4. The restored bar, exactly

The restored bar is design C, drawn the same size, with five changes. Behaviour (what a tap does, which player, the
World, the sheet) is `SPEC-ENGINE.md` sections 4.6, 4.7 and 6; this section fixes the drawing, as that spec asks
("The drawing ... follows BAR-RESTORE.md"). The changes:

1. It is the bar in every top-level document, in the browser as well as in the installed app.
2. It has **one** Play/Pause: the red Music button (Matthew: the bar's Music button pauses everywhere; the dock shows
   one Pause, not two). The dock's own Play/Pause goes.
3. The place that Play/Pause held on the right becomes **Sound** (the one mute, `SPEC-ENGINE.md` 6), so the right side
   still holds two buttons and the footprint is exactly design C's. The order is Sound, then Next at the very edge,
   mirroring Previous at the left edge: back and forward on either side, as Matthew described it. (`SPEC-ENGINE.md`
   sketches Next before Sound; the order is the only change from that sketch.)
4. Muted is shown by the Sound button itself and the song line's second line, without a second row. The second row
   stays for the trouble states only, which need their whole words and pass in seconds.
5. Its song line opens the one engine's Now sheet (in the World framed over Music it returns to Music with no break in
   the sound, `SPEC-ENGINE.md` 4.6), never a page's own control.

### 4.1 Where it shows

Every top-level document that carries the bar (`js/tabbar.js`), on both hosts: Matthew's property
(`https://matthew.mccluster.org`: Listen, the album, the artist pages, the account page, the house pages) and McCluster
Corp's World (`https://mccluster.org/`, and the house's own `mnet.html`). A frame never builds one: the retained World
frame keeps hiding its own bar (`body[data-world-audio-child] > .appbar`), an M5 music view keeps none
(`html.mcc-music-view .appbar`), embeds and `data-no-appbar` pages stay without. The browser and the installed app get
the same bar; the installed app keeps PR #820's safe-area work (`html.mcc-app-top`, `--mcc-app-safe-*`).

### 4.2 Layout and sizes (phone first)

One capsule, a direct child of `<body>` (id `mccInstalledDock` today; rename to `mccMusicBar` only with every
selector and test).

- Height **46 px**: `box-sizing:border-box; padding:1px; border-radius:25px`. Every target **44 x 44 px**.
- Position: `bottom: calc(8px + env(safe-area-inset-bottom, 0px))`; with a song,
  `left/right: max(8px, var(--mcc-app-safe-left/right, env(safe-area-inset-left/right, 0px)))`, `max-width:960px`,
  centred. With nothing loaded the capsule keeps its tabs' width, centred (guests 134 px wide).
- `--appbar-h: 46px` everywhere, so every page's clearance (`body.has-appbar`, the pocket, the dock hints, the
  World's `--mn-bar-clear`) follows the smaller bar.
- With a song, design C's grid of three columns, unchanged:
  `grid-template-columns: minmax(88px,1fr) minmax(44px,132px) minmax(88px,1fr)` (equal sides, so the navigation
  stays in the middle of the screen; no bare `1fr`):
  - **Left**: Previous (44 px) at the left edge, then the song line (a button filling the rest of the column): the
    title on line one (`600 12px/15px system-ui`), the second line (`400 10px/13px`, 78 % opacity), each one line cut
    with an ellipsis. No cover in the bar (the sheet shows the whole cover): a thumbnail would take the title's room.
  - **Middle**: the navigation strip, up to three 44 px tabs (132 px) on a phone; it scrolls sideways when there are
    more (the owner), with scroll snap, never shrinking or dropping a destination. The red Music button is pinned at
    the strip's start (`position:sticky; left:0`) so the one Play/Pause never scrolls out of reach.
  - **Right**: Sound (44 px), then Next (44 px) at the right edge, right-aligned in the column.
  - The song line's width is design C's: 120 px columns at 390 leave **73 px** of text after Previous and the 3 px
    end padding (enough for "Who Did T…" and "Matthew Mc…"); at 320 the columns fall to their 88 px floor and the
    strip to 126 px, leaving **41 px**. The whole title and artist are always in the button's accessible name and in
    the sheet. (Measured in design C: section "Renders".)
- From **600 px** (`@media (min-width:600px)`, adding only): the strip may grow to 440 px (ten tabs), the title goes
  to 13 px and the second line to 11 px. Nothing the phone shows is hidden at any width.
- Icons: 18 px glyphs in the buttons, 20 px in the tabs, the supplied M mark at 25 px (`assets/img/m-mark.png`, whole,
  scaled proportionally, `object-fit:contain`).
- Focus: a 2 px `currentColor` outline inset 2 px on every button; the strip keeps its keyboard order.

### 4.3 What each control does

| Control | Shown | Accessible name | A tap |
| --- | --- | --- | --- |
| Previous | while a song is loaded | "Previous track" | `MCC_NOW_PLAYING.command("previous")`: the one engine's previous (the song before, or the top of this song after 4 s, as the engine decides). Disabled (opacity .35) when `snapshot.canPrevious` is false. |
| Song line | while a song is loaded | "Open player: <title> — <second line>" | Opens the one engine's Now sheet (`SPEC-ENGINE.md` 4.7) over the page or view: seek, time, the queue, the Album or Creator link, Sound, AirPlay, lyrics, Share, the sleep timer and "See this song's impact" live there; Escape or Close returns where you were. In the World framed over Music it returns to Music (the World closes, the sound does not break). In the World opened directly, going to Music is the sheet's Music link. |
| Sound | while a song is loaded | "Mute music" / "Unmute music", `aria-pressed` | `MCC_MUSIC.mute(on)`: the one mute for every song, the World's shuffle included. Muted shows a speaker with a stroke through it. |
| Music button (red circle; the owner's "Play") | always | with a song loaded: "Pause music" / "Play music"; with nothing loaded: "Music" | With a song loaded, on every page and in the World: `command("pause")` or `command("play")` of the one engine. With nothing loaded: goes to Listen (on Listen, back to the top). A hold opens its wing (The album, Music Videos) as today. |
| M, Globe and the owner's tabs | always | unchanged | Unchanged navigation; the Globe opens the World over the music (the song keeps playing). |
| Next | while a song is loaded | "Next track" | `command("next")`. Disabled when `snapshot.canNext` is false (an album's last song: the album stops there). In the World's shuffle there is always a next. |

There is no other Play/Pause in the bar and no second transport on screen while the bar controls the song.

### 4.4 What it shows, state by state

| State | Left | Music button | Right | Height |
| --- | --- | --- | --- | --- |
| Nothing held (first visit, after Stop) | none | ▶ glyph, the link to Listen | none | 46 px, tabs only, centred (guests 134 px wide) |
| Playing | Previous; title / artist | ❚❚ "Pause music" | Sound, Next | 46 px |
| Paused (resumable) | Previous; title / artist | ▶ "Play music" | Sound, Next | 46 px |
| Held at a second (a pocket bank, after a sign-in) | Previous; title / "Pick up at 1:23" | ▶ | Sound, Next | 46 px |
| Loading (a tap, before sound) | as playing | ❚❚: the listener asked for music (`spec.playing`) | Sound, Next | the status row "Loading…" over the controls (about 65 px) until sound starts |
| Picking up after a drop | as playing | ❚❚: Pause stops the tries | Sound, Next | status row "Reconnecting…" |
| Connection lost / could not load | as paused | ▶: a tap tries again | Sound, Next | status row "Connection lost · tap play" / "Could not load · tap play" |
| Muted (the one mute) | Previous; title / "Muted" | as playing or paused | Sound shows muted ("Unmute music", pressed), Next | 46 px, no extra row |
| A preview (signed out, or no full song yet) | Previous; title / "Preview · <artist>" | as playing | Sound, Next | 46 px |
| A preview reaching its boundary | the engine moves on, as it does today | | | |
| The closing song (held for the profile) | never loaded; its pop-up explains why (quick wins Q5) | | | |
| An album's last song ended | that song, paused | ▶ | Sound, Next disabled | 46 px |
| The World's shuffle | the drawn song / its artist | ❚❚ / ▶ | Sound, Next (always enabled) | 46 px |
| Lyrics turned on in the sheet | Previous; title / the current lyric line | as playing | Sound, Next | 46 px |

The status row is design C1's (`73349a06`), kept for the trouble states only: their whole words do not fit the song
line ("Reconnecting…" needed 74 px of 73 at 390 and of 41 at 320, "Connection lost · tap play" 120 px, the record's
measurements), and they pass in seconds. The row spans the bar (`padding:5px 14px 0 45px; font:600 11px/14px`), the
controls keep their row and their places below it, and the row goes the moment the status clears. "Muted" is not a
trouble state: it lasts, so it never grows the bar (the Sound button and the second line say it). Words come from the
engine (`spec.status()`), never invented by the bar.

### 4.5 Places

- **Listen and the artist pages**: the bar replaces the engine's floating mini player (`#musicMini`); its title,
  access note and Unmute move to the song line, the status row and Sound (`SPEC-ENGINE.md` 4.6), its time, seek and
  "See this song's impact" to the sheet.
- **The album**: a page of the engine (`SPEC-ENGINE.md` 4.8): no deck, no deck bar, the bar is its player. Until that
  lands, the bar follows whichever player owns the lock screen and hides the deck bar as design C does
  (`[data-app-player-surface="album"] .deckbar`).
- **The World, opened over the music (the Globe)**: the parent's bar stays on top (`z-index:2200`) and is the player;
  the song keeps playing; the framed World hides its own bar (`body[data-world-audio-child] > .appbar`), its corner
  Play and its header title (`html.mcc-app-dock-remote`); the World's floating transport (`#mccWorldAudioControls`)
  is retired. The song line returns to Music without a break in the sound.
- **The World opened directly** (`https://mccluster.org/`, or `mnet.html` as the top document): the engine's shuffle
  fills the same bar. Before anything is held, and after an explicit Pause, the World's corner ▶ (`#mnWorldPlay`)
  starts the shuffle inside the tap, as today, and hides while the bar carries a song (`SPEC-ENGINE.md` 5.1).
- **Other pages** (the house pages, Control): a banked song comes back through the engine's `hold()`, so the bar
  shows it with ▶ and the pocket tile goes (`SPEC-ENGINE.md` 4.9); the front page (`index.html`) stays excluded.

### 4.6 Signed out, signed in, the owner

The music sides are the same for everyone. The strip is the person's: guests and members see Music, the M (a member's
perspective or avatar) and Globe in 132 px; the house owner's strip holds Play, Inbox, Home, the M, Analytics, Globe,
Games and the Control sections, scrolling inside 132 px with the Play button pinned. Signing in (by the pop-up the plan
asks for) keeps the document, the song and the bar; the bar only repaints its strip.

### 4.7 The installed app

The same bar. The installed app keeps PR #820's header and side safe areas (`js/shell-boot.js` sets
`mcc-installed-app` and `mcc-app-top`; only the top document consumes the insets; the retained World frame receives an
already-safe viewport). The home-indicator clearance is the `env(safe-area-inset-bottom)` in `bottom`.

## 5. Files and commits that hold it

- `js/installed-app-dock.js` and `css/installed-app-dock.css`: created in `382301d3`; changed in `3761bf15`,
  `73349a06`. The restore starts from `b51ede03`'s copies plus `73349a06`'s status row.
- `js/tabbar.js`: `barMarkup()` (the stable `.appbar__tabs` container every rebuild writes into), `loadInstalledDock()`
  (`382301d3`); `musicTransportHere()`, `nameMusicTab()` (`73349a06`, `37e0bd18`); the view and shell hooks
  (`2000c609`).
- `js/shell-boot.js`: `appMode()` (`382301d3`: `mcc-installed-app`, `mcc-app-top`).
- `js/site-navigation.js`: `dockItems()` so the owner's hints scroll the strip (`382301d3`).
- `js/now-playing.js`: `snapshot()`, `subscribe()`, `command()` (`382301d3`), `status` (`3761bf15`).
- `js/world-audio-continuity.js`, `css/world-audio-continuity.css`, `css/world-travel.css`: the parent bridge
  (`mcc-app-dock-remote`) and the safe areas (`382301d3`, `3573f918`).
- `css/style.css` `.appbar` (design A's capsule: 54 px tabs, `--appbar-h: 4.6rem`).
- Records: `docs/control-plane/SHARED-NAVIGATION.md` ("Installed app: safe header and compact music bar"),
  `docs/music/MUSIC-RELEASE-20261119.md` (M3 follow-up items 8 and 10, the two-Pause note), PR #820's description.
- Proof: `scripts/e2e/installed-app.e2e.mjs` (246 assertions in PR #820), `scripts/test/installed-app-shell.test.mjs`,
  `scripts/test/now-playing-contract.test.mjs`.

## 6. What must change for it to drive the one engine

1. **One device-controls owner.** `js/now-playing.js` stays the only code that talks to the device (Media Session,
   audio session, AirPlay) and the only thing the bar reads and commands: `snapshot()`, `subscribe()`, `command()`. The
   bar creates no audio element, no Media Session handler and no second lifecycle, and keeps calling `command()`
   inside the trusted tap (iOS will not start sound from a later task).
2. **One player.** The one engine binds once (`MCC_NOW_PLAYING.bind(audio, …)` in `js/music-engine.js`) and owns every
   song: Listen, the albums, the artist pages, the World's shuffle. The album's deck (`album.html` `<audio id=deck>`,
   its shelf tastes `pv`) and the World's theme `new Audio()` (`js/world-audio-continuity.js` `ensureTheme`) stop
   being players (`SPEC-ENGINE.md`). Until then the bar keeps following whichever surface owns the lock screen.
3. **Mount everywhere.** Drop the installed-only gate: `loadInstalledDock()` loads the bar module in every top-level
   document; the CSS selectors lose `html.mcc-installed-app` (keep it only on the safe-area rules). Keep design C's
   fallback: the floating controls hide only while the bar can control the same player (`mcc-app-dock-active`), so a
   bar that failed to load leaves the old controls usable.
4. **One Play/Pause.** Remove the dock's own Play/Pause (`button("play", …)` in `mount()`) and put Sound in its
   place (`button("sound", "Mute music", …)` before Next, `aria-pressed`, calling `MCC_MUSIC.mute()`). The Music tab
   becomes the transport whenever `snapshot()` has a song, on every page and in the World (`musicTransportHere()` in
   `js/tabbar.js` refuses today with the World open and in an M5 view; `SPEC-ENGINE.md` 6 reverses both). Pin the tab
   (`.appbar__tabs [data-appnav="music"] { position:sticky; left:0; z-index:1 }`) so the owner's scrolling strip never
   hides it. `nameMusicTab()` names it "Pause music" / "Play music" then, its link name otherwise.
5. **Truthful Previous and Next.** `snapshot().canPrevious` / `canNext` say whether the queue has one (today they only
   say the function exists): an album's last song has no next; the World's shuffle always has one.
6. **One "open the player".** Replace `openPlayer()`'s per-page clicks (`#musicMiniOpen`, `.deckbar__meta`, the
   pocket's expansion) with one call to the engine's sheet (`MCC_MUSIC.openNow()`, or a `command("open")` the engine
   registers with `js/now-playing.js`). With the World framed over Music, keep design C's behaviour: close the World
   (`MCC_WORLD_AUDIO.navigate(house + "listen.html")`), the sound unbroken.
7. **One mute.** The World's Mute (`#mccWorldAudioControls`, `mcc_world_audio_preference.muted`) and the engine's mute
   become one (`MCC_MUSIC.mute`, `mcc_music_mute`; D-7 reversed, `SPEC-ENGINE.md` 6). The bar shows it on Sound and
   on the second line; it never adds the status row. (`SPEC-ENGINE.md` 6 puts "Muted" on the status line; this drawing
   moves it to the second line and the Sound button, for "smaller"; the behaviour is the same, Unmute is one tap.)
8. **Retire the floating strips** once the engine owns everything: the World's transport, `#mnWorldPlay` while a song
   is held, `#mnNowPlaying`, the deck bar, the pocket tile. The mini player's time, seek, access note, picked-up note
   and "See this song's impact" move into the sheet; its spoken live region stays (`#musicMiniLive`).
9. **M5 views and the World frame** keep one bar: the retained document's. A view or a World frame never mounts one.
10. **Fix design C's own seam**: on Listen at `b51ede03` the red Music button showed ▶ while the song played and
    scrolled to the top (V-3); the restored Music button always shows the one player's state.

## 7. The law it must keep

(The task names these as rules 10, 14 and 15; in `AGENTS.md`'s own list they are hard rules 11, 14 and 15, and in
`CLAUDE.md`'s stop list items 10, 12 and 13.)

- **No logo drawn or cropped** (AGENTS.md hard rule 11, "THE LOGOS ARE NOT YOURS TO DRAW"): the M is the supplied
  `assets/img/m-mark.png`, whole, scaled proportionally (25 px, `object-fit:contain`); no plate, no tile, no recolour,
  no crop. The bar draws only plain control glyphs (previous, play, pause, next, a speaker, a globe). The Music tab's
  SVG drawing (`eqSvg()` in `js/tabbar.js`) is hidden today and stays hidden: if a mark is ever wanted on the tab, it
  is an owner-supplied file, never that drawing. The World's own header and feed tab carry the supplied Equity Uprise
  PNG, which the bar never touches or repeats. No cover in the bar; the sheet's covers are whole and uniform (quick
  wins Q3).
- **Mobile first** (hard rule 14): the phone layout is the base; `@media (min-width:600px)` only adds; never a
  `max-width` query; `minmax()` floors, never a bare `1fr`; no `user-scalable=no`; every target at least 44 x 44 px;
  the bar fits at **320** and **390** (and 430, 820, 1280) with `scrollWidth === clientWidth` measured, not
  eyeballed; the owner's strip scrolls inside the bar, never the page; nothing the phone shows is hidden at a width.
- **Two properties, two entities** (hard rule 15): the bar on `mccluster.org` (McCluster Corp's World) and on
  `matthew.mccluster.org` (Matthew's house) is the same control, but it adds no metadata, share card or Organization
  data, and its links keep their hosts: Music, the M and every music page go to Matthew's property; the Globe goes to
  the World's door. The artist line shows the catalogue's billed artist exactly as the record states it
  (`data/albums.json`, "McCluster" for the house's records after the quick wins); the bar never invents, shortens or
  re-labels an artist. A note for the catalogue, not the bar: the World's shuffle surfaced "High Alert" billed to
  "PRIM3" (the album Cyber Security Specialist), and Docket 516R is billed to "Equity Uprise"; AGENTS.md calls PRIM3 a
  learning product, not a recording alias, so that billing is Matthew's call to confirm.
- Shared navigation (AGENTS.md "Shared website navigation"): the bar stays the one bottom bar; profile and account stay
  top right; no second floating menu.

## 8. Acceptance (tests to write before the build)

1. 390 x 844 and 320 x 640, browser and installed (`navigator.standalone` stood in, CDP safe-area insets 47/34): the
   bar is 46 px with a song playing, paused and with nothing held; every control at least 44 px; `scrollWidth ===
   clientWidth`; the song line starts with the title and its accessible name holds the whole title and artist; the
   strip's centre is the screen's centre within 1 px.
2. Exactly one control in the document named "Pause music" while a song plays, the Music tab (two on Listen at the
   branch head, two visible pause glyphs on the album at `b51ede03`); none of `.music-mini`, `.deckbar`,
   `#mccWorldAudioControls`, `#mnWorldPlay`, `#mnNowPlaying` visible while the bar carries the song.
3. Listen → Globe → World: the same `HTMLAudioElement` advances, the bar names the same song, its Music button pauses
   it in the World and plays it again; Previous and Next move the same queue; Sound mutes and unmutes the one element;
   the song line returns to Music with the time still advancing.
4. The album's last song: Next disabled, the album stops (QW Q6). The World's shuffle: Next always enabled.
5. Reconnecting…, Connection lost · tap play, Loading…, Could not load · tap play: the status row shows the whole words
   at 320 and 390 and leaves when the status clears; Muted shows on the Sound button (pressed) and the second line,
   and the bar stays 46 px.
6. The owner (fixture `/v1/status` ok): every owner destination reachable in the strip at 44 px, the Play button
   pinned while the strip scrolls, nothing outside the bar.
7. Fallback: block the bar's module; the old floating controls still play and pause.
8. Static: no `max-width` media query, no bare `1fr`, no new image file, no new `<svg>` that is a mark, in the bar's
   CSS/JS.

## 9. The one decision to show Matthew

The default above keeps **one** Play/Pause, the red Music button (his own answer: the bar's Music button pauses
everywhere, one Pause in the bar), with Previous at the far left, Sound and Next at the far right, and the bar exactly
as small as on 2026-11-20. On 2026-11-20 the right side held Pause and Next instead. If he wants that back exactly, the
alternative is: the dock's Pause returns to the right, Sound moves into the sheet, and the red Music button becomes a
plain way to the music while a song plays (`SPEC-ENGINE.md` 4.6 already allows this; nothing in the engine changes).
One plain question for him, with the Before picture (`shots/bar-history/bar-then-and-now-390.png`): "It comes back
like Before, in Safari too. One change: the red button is your one Pause, and a mute button takes the second Pause's
spot. OK?" Until he answers, build the default; the alternative is a small change in the bar alone.
