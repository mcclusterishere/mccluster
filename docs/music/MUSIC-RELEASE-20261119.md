# Music release, 2026-11-19

Matthew, 2026-11-19: the music stops when he leaves the browser ("Apple continues to play music"), there is no
proper Now Playing control, songs do not play through, the module does not know who is listening, and Creator
Studio, collaboration and album upload fall short ("better than Apple"). The work is planned as music slices M1 to
M10 from the 2026-11-19 music maps (gaps, playback, delivery, external, accounts, studio, collaboration, law).

Each slice appends its own section below: what changed and why, the tests (failing at the base, passing after),
what is Inferred, and what waits for Matthew. Nothing here is merged, deployed or applied. Every iPhone, iPad,
AirPods and lock-screen statement stays Inferred until Matthew's own devices run the checklist rows a section names.

## M1: the album keeps playing with the screen locked

Base `1cb28842`. The code side of C1 causes 1 and 5 and of the background share of C3 (PB-1, EXT-1, G-8,
PB-11, PB-13), with the in-app note for G-1 and the device rows for EXT-4. Decisions D-3 (the deck leaves Web Audio,
the light comes from measured peaks) and D-6 (the in-app note) are the recommended defaults, built for Matthew to
see before anything merges.

### Why

The album room sent its deck through Web Audio for its light: on the first play `js/chamber.js` called
`createMediaElementSource(deck)`, and from then on the song reached the speaker only through an `AudioContext`.
WebKit restricts Web Audio in a background process unless the page says it plays music
(`navigator.audioSession.type = "playback"`), and no page said so. In Chromium, with the page's contexts suspended
the way iOS suspends them, the deck said "playing" while its clock stood still (3.01 s, then 3.01 s again 1.5 s
later, at the base). The waveform (`js/filament.js`) downloaded every song a second time and decoded all of it, tens
of megabytes of samples, in a second `AudioContext`, in the background too. On an earned play of the gated closer
the deck, a second `Audio` probing the length and the waveform's download made three requests against a play that
counts every request. CI ran the World continuity suite only under reduced motion, where the room never wires Web
Audio, so nothing automated could see any of it.

### What changed

1. **The deck is a plain `<audio>` element.** No music element on any music page is routed through Web Audio. The
   deck's `crossorigin` went with the graph: only the analyser and the waveform's second download needed CORS on
   the master.
2. **The light is measured, not heard.** `scripts/music-peaks.mjs` decodes each public catalogue file in
   `assets/audio` once (ffmpeg) and writes `data/peaks/<file>.json`: the file's sha256 and length, 168 waveform bars
   (the loudest sample of each slice, as the waveform computed them) and the room's three bands at 20 a second,
   measured the way the analyser measured them (512-point FFT, Blackman window, 0.82 smoothing at 60 frames a
   second, -100 to -30 dB, bass bins 1-8, mid 9-47, high 48-139). 41 files, 504 KB together, the largest 21.6 KB,
   the same bytes on every run. `node scripts/music-peaks.mjs` writes what is missing or stale; `--check` needs no
   ffmpeg and fails on a missing, stale or orphaned file, in the root suite and in CI.
3. `js/peaks.js` fetches one peaks file per song, only for a same-origin `assets/audio/` file; `js/chamber.js`
   reads the bands at `deck.currentTime`; `js/filament.js` draws the bars and never fetches or decodes the song. A
   signed or streamed master (the gated closer's full song) has no peaks file and nothing asks for one: the room
   shows a quiet, even light and the waveform a quiet, even line. The closer's public preview has its own peaks.
   A peaks file that cannot be read leaves the plain seek line; playback never waits for it.
4. **A hidden page is still.** While the page is hidden the room draws nothing and fetches nothing. The music is
   untouched.
5. **One helper tells the device this is music.** `js/now-playing.js` (`claim()`) sets
   `navigator.audioSession.type = "playback"` where Safari has the API (iOS and iPadOS 16.4 and later), leaves a
   `play-and-record` session alone, and does nothing in browsers without it. Every player calls it right before each
   `play()`: the album deck and the shelf previews (`album.html`), the listen engine (`js/music-engine.js`), the
   pocket (`js/pip.js`) and the World soundtrack (`js/world-audio-continuity.js`). It is in place before the first
   play everywhere: a plain tag before the players on `album.html`, `listen.html` and `music-creator.html`;
   `js/tabbar.js` adds it ahead of the World soundtrack on every page with the bar (both in order, neither async);
   the pocket waits for it (two and a half seconds at most); the game hub imports it first. About 8 KB with its
   comments. **Why this file**: slice M2 grows it into the one Now Playing owner (title, artwork, the lock screen's
   buttons). On iOS the playback session and the Now Playing information belong to the same player, and the loading
   guarantees above are then built once.
6. **One play, one request.** The earned play no longer probes the master's length with a second `Audio`; the row's
   clock reads the deck's own `durationchange`. With the waveform no longer downloading songs, an earned play makes
   one request (three at the base).
7. **Leaving the page pauses nothing.** At the base no page paused music on `visibilitychange`, `pagehide`, `blur` or
   `freeze` (every handler on every music page and player read, two calls deep). A unit guard keeps it that way.
8. **Inside an in-app browser (D-6).** On a music page (a listening room or an artist page) inside Instagram,
   Facebook, Messenger, TikTok, Snapchat, LinkedIn, Line or X, one line under the music bar: "To keep the music
   playing with your screen locked, open this page in Safari or Chrome." A 44 px × puts it away for the session.
   No redirect; never in a frame; never on a page that is not a music page, nor on the lyric video feed (it plays
   video, which no browser promises to keep playing with the screen locked, so the line would not be true there). It
   wears the coat of the room it sits in, by day and by night: dark in the music rooms, light only on a light page.
   Views and dismissals are counted as `music_inapp_note` with the host app's name only, under the site's consent rule.
9. **CI.** `music-platform-ci.yml` now watches the player files, the peaks, the new tests and both music e2e
   suites; `music-contract` runs the new unit tests and the peaks check; a `browser` job runs both e2e suites. No
   new workflow and no new trigger.

### Tests: failing at the base, passing after

| Test | At `1cb28842` | After |
| --- | --- | --- |
| `scripts/e2e/music-background.e2e.mjs` (lane 01 probe S1 at default motion, S3 as a request log, the audio session on every player, the in-app note) | 13 of 25 checks; the deck clock frozen with its contexts suspended; the earned play read 3 times | 47 of 47 checks |
| `scripts/e2e/music-world-continuity.e2e.mjs`, now also with default motion | 65 checks pass, then "default motion album: across Globe, with every AudioContext suspended, the same music keeps advancing" fails (0.739 s, then 0.752 s) | 125 checks pass, the default-motion listen and album checks among them |
| `scripts/test/music-background.test.mjs` (9 tests) | 1 of 9: only the lifecycle guard passes (nothing paused at the base either) | 9 of 9 |
| `scripts/test/music-peaks.test.mjs` (6 tests) | cannot load: no `scripts/music-peaks.mjs` | 6 of 6 |
| `scripts/test/gated-audio.test.mjs`, `journey-errors.test.mjs` (assertions moved from the old waveform and the deck's CORS) | 3 of the changed tests fail | pass |
| Root suite `node --test scripts/test/*.test.mjs` | 2840 tests, 1 failure (an OVH promotion timing test under load; passes alone) | 2855 tests, 0 failures; 2866 and 0 on the branch head `7991ce57` with this slice |

Every fix was also taken away one at a time and its test failed: the old `js/chamber.js`, the old `js/filament.js`,
the length probe put back, a player playing before `audioSession()`, a player setting the session itself, `claim()`
overriding `play-and-record`, the bar loading the soundtrack without the helper or out of order, the pocket starting
before the helper, a deck paused on `visibilitychange` or silenced on `pagehide`, `js/peaks.js` asking for a private
master's shape, a stale or missing peaks file (`--check` exits 1), the note not recognising Instagram, promising more
or redirecting, the note on the lyric video feed, `crossorigin` back on the deck, the album without `js/peaks.js`,
and the light ignoring a muted deck (21 mutants, each failing its test; both controls pass). The loading test
first missed one mutant (a dead `if (false && ...)` in the bar); it now runs the bar's loader against a stand-in
document and checks the order and `async`.

390 px (`scrollWidth === clientWidth`): album, listen, the artist page by day and by night, catalogue with the
pocket, and, with the note showing, album, listen, catalogue, the license page and the PRIM3 artist page; the music
videos feed, which carries no note, fits too.

### Where the light behaves differently

Measured in Chromium on the album's first song (Who Did The Shoot), seconds 31 to 39, the room's light sampled about
every 0.12 s: before is the analyser on the deck at `1cb28842`, after is the measured light (two runs).

* **The same level, the same rise and fall.** The room's overall light (`--amp`, 0 to 1) averaged 0.80 before and
  0.78 to 0.79 after; bass 0.95 against 0.94, mid 0.67 against 0.64, high 0.53 against 0.52. Sample for sample the
  two move together (correlation 0.44 to 0.63 on the overall light) and differ by 0.02 on average.
* **A little livelier between frames.** The measured light changes more from one sample to the next (0.017 against
  0.007 on average). It is the file's own analysis at 20 values a second, eased in between; the analyser in this
  headless run moved more slowly. On a phone the analyser's pace followed the frame rate; the measured light does not.
* **The first moment.** The light comes up when the song's peaks file arrives: 0.46 to 0.70 s after the tap here,
  against 0.41 s for the analyser, on a local fixture (a slow network adds its own wait). Until then the room shows
  its quiet, even light.
* **Muted.** Muting goes dark at once; the analyser faded out over about a second because it heard the muted
  element. A volume between silent and full no longer changes the light.
* **A record nobody measured.** The gated closer's full song (a signed or streamed master) shows the quiet, even
  light and an even waveform line; the analyser lit whatever played. Its public preview has its own light.
* **Hidden.** Nothing is drawn or fetched while the page is hidden, and the light picks up at the deck's second on
  return. Before, drawing also stopped while hidden (browsers pause animation frames), but the waveform's download
  and decode ran in the background.
* **The waveform** is the same measure of the same file (the loudest sample of each of 168 slices), so the same
  shape (compare the open player sheets before and after). It appears as soon as its peaks file arrives (1.5 to
  21.6 KB) instead of after the whole song is downloaded and decoded.

The album room is locked to its dark coat (`data-theme-lock="dark"`), so it renders the same by day and by night;
on the artist page, whose room is dark in both, the note stays dark by day as well. Renders for Matthew, before
and after, at 390 and 1280, by night and by day, with a record playing: `album-room-before|after-390|1280-night|day.png`
and the open player sheet with its waveform, `album-now-before|after-390|1280-night.png` (kept with the workflow's
evidence, not in the repository).

### What is Inferred

* What an iPhone or iPad does with the screen locked. Chromium only stands in: it shows the deck no longer depends on
  any `AudioContext` and that every player sets the session where the API exists. Whether iOS now keeps the album
  playing in a Safari tab is for rows 1 and 2 below.
* The audio session itself: Chromium has no `navigator.audioSession`; the tests use a stand-in object. Inferred from
  WebKit's documentation and source: with `playback` the page's sound also ignores the silent switch, as Apple
  Music does.
* Instagram and the other in-app browsers: the host app decides about background audio; the note's advice (Safari
  or Chrome keeps the music playing with the screen locked) is Inferred until rows 1 and 13 pass. If row 1 fails,
  the note's words must change or the note goes.
* Home Screen mode (EXT-4): open WebKit bugs; row 12.

### What waits for Matthew

* **D-3** (the deck out of Web Audio, the light from measured peaks) and **D-6** (the in-app note, its words and
  where it shows): defaults built for his review, not merged.
* **His devices, before anyone says C1 is fixed** (rows of the device checklist, music map 00 section 7):
  1. iPhone, Safari tab, the album (I AM HERE), Reduce Motion **off**: play song 2, lock, wait 60 s, unlock. It
     should still be playing (at the base the prediction was silence).
  2. The same with Reduce Motion **on**: it should behave exactly like row 1 now (at the base this was the one
     switch that made the difference).
  12. From a Home Screen icon, album and listen page: rows 1, 3 and 4 again.
  13. From the album link inside Instagram: the note shows once, says where the music keeps playing, goes away with
      ×, and nothing redirects; then play and lock.
* Not in this slice: navigation still ends the song (C1 cause 2, slice M5), the lock screen's title and buttons
  (C2, slice M2), next songs that wait on the network (EXT-5, slice M3).

## M4: the module knows who is listening

Base `1cb28842`. C5 and the member side of C3 (accounts lane ACC-1 to ACC-6, ACC-8, ACC-9, ACC-12; delivery lane
DEL-3). Browser code only: no SQL, no Worker change, no new store of sessions and no second sign-in. D-10 keeps its
default: the two hosts keep separate sessions in this release.

### Why

The music scripts sent the access token as it sat in storage, and the shared auth renews it only when a call asks
it to. A member back after the token's hour was a guest to every music call while the bar said signed in: the house
owner's gated record said "0/3 MISSIONS+ identity verification" (it should say PLAY · owner), a listen was refused
and never counted, an account-only creator track played its preview, the artist lost "Edit my artist page", and
Creator Studio answered "JWT expired" on a save. The pages decided who was looking once, at load: a sign-in or
sign-out in another tab changed nothing until a reload, and Creator Studio kept saving as the account it opened with.
Listen offered "Become a creator" to everyone, guests and creators included. A sign-out removed the session's two
copies one at a time, and another open music tab that read in between wrote the keep copy back: both tabs ended
signed in. `js/backend.js` read the token's payload with plain `atob`, so any member whose token carried `-` or `_`
had no uid or e-mail there and accented names came out garbled. The Creator Website Studio ran a second supabase-js
session seeded from the site's: it asked signed-in members to sign in, acted as a previous account after a switch,
and when it renewed its copy it spent the shared refresh token, so the site's own renewal was refused and the member
was signed out of every page. The album's comment box still promised a sign-in "with one tap, no password" that no
longer exists.

### What changed

1. **One token per call, and one more try.** The shared auth (`js/mcc-auth.js`, the one session store, the same two
   storage keys) gains `MCC.freshToken()` (the token for the call about to be made, renewed first when it has under
   a minute left), `MCC.authFetch(url, init, { account })` (that token, and after a 401 one renewal and one more
   try, never a third; a call made for one account is refused, never sent, when the session stored now is someone
   else's or nobody's), `MCC.account()` (the JWT's subject, read as base64url and UTF-8) and
   `MCC.onAccountChange(fn)` (a sign-in or sign-out here, in another tab or while the page was away; a renewed token
   for the same account is not a change). Its `safeNext` is untouched.
2. Every music call goes through it: the gate and the one play (`js/gated-audio.js`), listens (`js/listen-ledger.js`),
   an account-only creator track (`js/music-engine.js`), the artist's own tools and licence checkout
   (`js/music-creator-profile.js`), every Creator Studio call and upload clean-up (`js/music-creator-studio.js`, which
   no longer keeps the token it opened with), and the one tap (`js/creator-onboarding.js`).
3. **Pages follow the account.** The gated rows repaint, the artist's tools appear or go, Listen's offer changes,
   and Creator Studio closes and opens again for whoever is signed in now, without a reload. A save that is running
   when the account changes is let fail (its next call is refused) and an answer that arrives for the closed
   account is never painted.
4. **Offers by state** (Listen and the artist page's footer, `js/creator-onboarding.js`): a guest is asked to sign
   in (and offered Create an account); a member who is not a creator gets "Become a creator"; a creator gets "Open
   Creator Studio"; the house owner also gets "Your tools: Music review & catalog" (the Control Room's music review),
   shown only after the bar's own server check. "Creator or not" is the server's answer (`music_creator_state`); until
   it comes the offer keeps its space unseen, and if none comes (no script, a server that never answers) the neutral
   Open Creator Studio shows after 6 s.
5. **A sign-out stays signed out.** It leaves a mark naming the session it ended (`mcc_sess_out`, a hash of its
   refresh token, never the token), removes the keep copy before the main one, and neither `js/mcc-auth.js` nor
   `js/backend.js` restores a copy of that session. A new sign-in is a new session and clears the mark.
6. `js/backend.js` reads JWT payloads as base64url and UTF-8 ("José", not "JosÃ©"; uid and e-mail for every member).
7. **The Creator Website Studio uses the site's one session** (`js/mccluster-creator-account.js`,
   `mccluster-creator-studio.html`): supabase-js keeps no session (`accessToken` and `fetch` come from the shared
   auth); nothing is renewed or stored here; a signed-in member is not asked to sign in and the account line names
   them; each thing the page does is done as the account that began it; the editor, the service form and the listed
   workspaces leave the screen with their account. The `sb-…-auth-token` key an earlier version left behind is not
   deleted: the OAuth consent page on the same origin still uses its own supabase-js session.
8. The album's comment box: "Sign in to speak, with your M Account.", and the sign-in comes back to the album.
9. **CI.** `music-platform-ci.yml`: the unit test in `music-contract`, the Chromium suite in the `browser` job, the
   new files and the shared auth in its paths. No new workflow and no new trigger.

### Tests: failing at the base, passing after

| Test | At `1cb28842` | After |
| --- | --- | --- |
| `scripts/test/music-accounts.test.mjs` (15 tests; the real page scripts in Node, one storage area with storage events between tabs) | 13 of 15 fail; the 2 that pass are guards (a keep copy still restores a live session; the token is read per call) | 15 of 15 |
| `scripts/e2e/music-accounts.e2e.mjs` (Chromium; personas on Listen, the album, an artist page and Creator Studio, each also back after the token's hour; the refresh answered after 0, 300 and 1500 ms; a save after the token expired; sign-in and sign-out in another tab X1 to X5; the Creator Website Studio D1a to D1c; an account-only creator track) | 50 of 104 checks fail: the owner's row "0/3 MISSIONS+ identity verification", creators offered Become a creator, "JWT expired", the sign-out written back in both tabs, the Website Studio acting as the previous account, the member signed out on Music after the Website Studio spent the refresh token | 110 of 110 (six checks added since: the album's comment box as a guest, the Website Studio's editor) |
| Four existing tests that asserted the defects: `creator-profile-publishing` (a second session via `auth.setSession`), `creator-studio-paid-publish` and `music-creator-page` (the token kept from boot), `creator-onboarding` (the same, in the one tap) | each fails against the base code | pass |
| Root suite `node --test scripts/test/*.test.mjs` | | 2855 tests, 0 failures; 2885 and 0 merged with the branch head `fea2edb0` |

Every fix was also taken away on its own and its test failed: each changed file put back one at a time
(`js/mcc-auth.js` 7 tests, `js/backend.js` 2, `js/gated-audio.js` 3, `js/listen-ledger.js` 3, `js/music-engine.js`
and `js/music-creator-profile.js` 1 each, whose behaviour is also proven in Chromium, `js/music-creator-studio.js` 3,
`js/creator-onboarding.js` 1, `js/comments.js` 1, `js/mccluster-creator-account.js` 3,
`mccluster-creator-studio.html` 2), and inside the shared auth: no retry after a 401 (2), no renewal before the call
(2), no sign-out mark in either client (1 each), base64url without UTF-8 (1). The removal order alone fails nothing:
the mark and the order each keep a sign-out signed out, and the two removed together fail X5.

The suites these files touch, run on the change: creator onboarding, music and World continuity, direct checkout,
the World sign-in door (174 of 174), the Control Room account lifecycle (34 of 34) and the three account suites
(network recovery, clock skew, the bar's refresh). 390 px (`scrollWidth === clientWidth`): Listen for every persona,
the album, an artist page, Creator Studio and the Creator Website Studio. Renders for Matthew at device scale 2:
Listen's offer for a guest, a member, a creator and the owner, the Creator Website Studio for a member, an artist's
own tools and the album's comment box (kept with the workflow's evidence, not in the repository).

### What is Inferred

* Safari on iPhone and iPad delivering the same storage, `pageshow` and visibility events: the pages follow another
  tab's sign-in by them. Chromium only stands in.
* How long Supabase Auth's real refresh-token reuse window is (the stand-in uses 3 s) and what the production gate
  answers a real member back after an hour: the tests use stand-ins built from the lane's probes.

### What waits for Matthew

* **The Worker's answer to a token it refuses.** Today a bad token on a `GET` is answered as a guest (200), so only a
  `POST` comes back 401 and is asked again. Renewing the token before every call makes a refused one rare; a 401 on
  the Worker's `GET`s is a Worker change for his decision.
* **D-10**: one session across his site and the company's World, or two. This release keeps two: a sign-in or
  sign-out on one does not change the other.
* Not in this slice: purchases on the account (SQL), the viewer answer (`GET /v1/me`).
* **His devices**: on an iPhone, open the album in two Safari tabs, sign out in one, return to the other (it should
  read signed out, with the gated row as a guest's); and come back to the album after an hour away (the owner's row
  should read PLAY · owner).
* Seen, not changed here: at 390 px the bar's account chip covers the "Creator Studio" link in the music context bar
  on Listen and the artist page.

## M2: one Now Playing on every player

Base `fc001103`. C2 (PB-7, PB-9, PB-10, EXT-3, EXT-6) and the player share of L-4. Decisions D-4 (previous and next
on every music surface, no 15-second skips) and D-8 (the AirPlay picker where WebKit offers it, and resume where
you left off across devices through the existing `listener_state` row; no remote control) are the recommended
defaults, built for Matthew to see before anything merges.

### Why

Nine players can reach the lock screen, and each spoke to it on its own terms or not at all (lane 03 probe E1,
reproduced at the base by the new Chromium suite):

* The album (`js/label.js`) put 15-second skips on the lock screen and handed one cover over as 96, 192 and 512 px,
  always as a JPEG: a 1024 x 682 photograph was declared a 512 px square, a PNG was declared a JPEG.
* The listen engine named the album's tagline as its artist ("Have no fear.") and never set `playbackState` or the
  position, so the scrubber stood still.
* The pocket had no previous, and handed over the film's poster as its art.
* The World soundtrack, the gateway, the docket release, the music video feed, the embed and the album shelf's
  previews handed nothing over: WebKit then shows its own default commands (15-second skips) and the page's title.
  The gateway and the docket also never asked for the playback audio session (slice M1 covered four players).
* The embed credited Matthew McCluster for every album, PRIM3's songs among them.
* The record left on another device was asked for only when this device had nothing of its own, and the listen
  page, which does not load `js/backend.js`, could not ask at all.

### What changed

1. **One owner.** `js/now-playing.js` (slice M1's audio-session helper) is now the only file that speaks to
   `navigator.mediaSession`. A player calls `MCC_NOW_PLAYING.bind(media, spec)` with what is playing (title,
   artist, album, cover) and what play, pause, previous, next and seek mean on that surface. The owner writes the
   metadata, the handlers (play, pause, previoustrack, nexttrack, seekto, stop; `seekbackward` and `seekforward`
   are set to nothing), `playbackState`, and `setPositionState` on play, pause, seek and rate changes and at most
   once a second while playing, never with an unknown, endless or zero length, and always clamped to it. Whichever player
   played last owns the lock screen, and only the owner can clear it. A browser without Media Session plays as
   before.
2. **Covers whole, at their true size and type.** `scripts/music-artwork.mjs` reads each cover's header (PNG,
   JPEG, WebP, GIF; nothing decoded, cropped or re-encoded) and writes the registry inside `js/now-playing.js`;
   `--check` fails on a stale or missing entry. Every cover is handed over as supplied, once, with its own size and
   type. Three are not square (below).
3. **Every player bound to it**: the listen engine, the album deck, the album shelf's previews, the pocket, the World
   soundtrack (`js/world-audio-continuity.js`: each rotation song's title, artist and cover; next moves along the
   shelf, previous goes back to the song before or to the top after 4 s), the gateway, the docket release, the music
   video feed and the embed. Previous and next move each surface's own queue (D-4). The pocket (on its × and when
   its list runs out), the docket at the end of its release, the embed at the end of its song and the shelf's
   previews when they stop hand the lock screen back. The engine names the album's billed artist
   (`data/albums.json` `artist`, Matthew McCluster where there is none); the album and its playlists name each
   row's own record and artist, on the lock screen and in the open sheet; the embed's card and lock screen credit
   the album's billed artist. The gateway, the docket, the music video feed and the embed ask for the playback audio
   session before every play.
4. **AirPlay where WebKit offers it (D-8).** `MCC_NOW_PLAYING.airplay(button, media)` shows a button only where
   `webkitShowPlaybackTargetPicker` exists, and only while WebKit reports a device in range: in the listen page's
   Now sheet, the album's sheet (its beam; the Remote Playback picker stays where WebKit is absent), the pocket's
   tile (a 44 px target) and every card of the music video feed. Hidden everywhere else. The album sheet's transport
   style (`display: grid`) overrode `hidden`, so a held-back button showed anyway: `.now__tp button[hidden]` now
   stays out of sight.
5. **Resume where you left off, across devices (D-8).** The pocket store (`js/pip.js`) reaches the existing
   `listener_state` row through `MCC_SUPA` where `js/backend.js` loads, and through the shared sign-in
   (`MCC.authFetch`, slice M4) on the listen and artist pages, as the member with the member's own token. The newer
   record wins. The listen engine banks what it plays and offers the held record in its mini player ("Pick up at
   m:ss"); the album opens on the record left on another device, paused at its second, when nothing on the page has
   been chosen. The album's own seat restore ran inside `init()` before the Now sheet's elements were bound:
   `load()` threw on the unbound film (a `TypeError`, swallowed) and stopped short of the rows, the deck, the
   sheet's artist and the lock screen. It now runs at the end of `init()`. Because the listen page now banks its
   record where the album banks its own, the pocket carries a listen-page record onto the next page exactly as it
   carries the album's (navigation itself is slice M5). No remote control, and no new table, Worker route or store.
6. **Not wired, and why**: the home page's scene engine (`js/main.js`, on `index.html` and `front.html`: hard rule 3,
   and it plays a scene soundtrack, not a queue); `js/game-hub/player.mjs` (no page loads it); the owner's tools
   (the Control Room's lyric review, the unlinked `js/music-admin.js`, Creator Studio's length probe), which are not
   listening surfaces; the World's member audio posts (`js/mnet.js`) and Live voice rooms (`js/mnet-audio.js`),
   which carry members' media and voices, not the catalogue, in files other builds are changing in this release.
   The World soundtrack, the gateway, the docket and the embed get no AirPlay button: none has a player sheet or a
   transport row to hold one (the World's sound is one corner control, the gateway and the docket one play button
   each, the embed a frame in someone else's page). Adding one there is a design call for Matthew.

### Tests: failing at the base, passing after

| Test | At `fc001103` | After |
| --- | --- | --- |
| `scripts/test/now-playing-contract.test.mjs` (13 tests: probe E1's bar matrix, one owner, covers, metadata, position, controls, two players, clearing, no Media Session, the audio session, names, AirPlay, resume) | 0 of 13 (0 of 13 at `fea2edb0` too) | 13 of 13 |
| `scripts/e2e/now-playing.e2e.mjs` (Chromium: after play on listen, the album, a playlist, the shelf, the World soundtrack, the pocket, the gateway, the docket, the video feed and the embed, the title, artist, album, cover, `playbackState` and position; previous and next move each queue; AirPlay; resume across devices; 390 px) | 24 of the 97 checks it reached (a scenario stops at the first handler that is missing) | 125 of 125 |
| `scripts/test/music-platform.test.mjs`, `gated-audio.test.mjs` (two assertions moved from the engine's and the album's own Media Session calls to the owner) | the moved assertions fail | pass |
| Root suite `node --test scripts/test/*.test.mjs` | 2907 tests, 13 failures: the new contract test's 13 | 2907 tests, 0 failures; 2947 and 0 (7 skipped) on the branch head `1d379869` with this slice |

Every fix was also taken away one at a time, its base version put back, and the contract test failed each time:
`js/now-playing.js` (8 of its tests fail), `js/music-engine.js` (5), `album.html` (7), `js/label.js` (4),
`js/pip.js` (5), `js/world-audio-continuity.js` (2), `js/gateway.js` (4), `docket-516.html` (5),
`music-videos.html` (4) and `embed.html` (5); with all of them in place, 65 of 65. Sixteen mutants were killed too:
the position throttle off, no clamp at the end, an unknown or endless length reported, a length of 0 reported, the
15-second skips left as they were, any player clearing the owner, stop leaving the card up, seek past the end,
AirPlay shown before a device is in range, no `playbackState`, the engine crediting the tagline, the album's seat
restored before its sheet, the embed crediting the house, the World losing previous, the pocket's × leaving the
lock screen, and a cover relabelled 512 x 512 (`--check` exits 1 as well). The first round let one through (an
unknown length: the test's stand-in session threw where a browser does, which hid the call); the stand-in now sees
every call, and that mutant fails.

The browser suites caught four more before they were fixed: the album sheet's AirPlay button showing with no device
in range (the `hidden` rule), the playlist's sheet crediting the house for a PRIM3 song (the seat restore), the
docket's next track read before its length was known (a timing in the new suite), and, in the World continuity
suite, the listen page reading the whole catalogue as it opened, to look for a held record before there was one: it
changed what played after a one-use master ended. The engine now reads the catalogue for that only when a record is
banked here or on another device.

The other music suites, on the branch head `1d379869` with this slice: `music-background` 47 of 47,
`music-world-continuity` 125 checks (after the fix above), `music-accounts` and `music-direct-checkout` every check
passing; the new suite 125 of 125 there too, at device scale 1 and again at 2. 390 px (`scrollWidth === clientWidth`): listen with
the Now sheet and AirPlay, listen with a held record, the album with its sheet open, the World, the catalogue with
the pocket and AirPlay, the gateway, the docket, the music video feed and the embed. Renders for Matthew at device
scale 2 (kept with the workflow's evidence, not in the repository): the listen page's Now sheet and the album's
sheet with AirPlay, the pocket on the catalogue with AirPlay, the video feed's rail with AirPlay, the embed
crediting PRIM3, and the listen page holding a record from another device.

### What is Inferred

* What iOS and iPadOS draw: which cover the lock screen picks, that previous and next replace the 15-second skips,
  that `stop` and an empty `playbackState` take the card away. Chromium only stands in: a wrapper records the
  handlers and positions a page sets, and Chromium draws nothing.
* AirPlay: Chromium has no picker, and the suite stands in `webkitShowPlaybackTargetPicker` and WebKit's
  availability event. Whether the button shows with an Apple TV or a HomePod in range is row 17.
* AirPods and Control Center reach the same handlers (row 5).
* Resume across devices for a real member on two devices: the suites stand in the shared row and the sign-in.

### What waits for Matthew

* **Square covers.** Three covers are not square and are handed over whole, as supplied, never cropped (hard
  rule 10): `assets/img/cia-mind-control-cover.jpg` (544 x 246), `assets/img/here-cover.jpg` (1024 x 682) and
  `assets/img/wing-whip-poster.jpg` (1280 x 890). Lock screens and Control Center show the cover in a square
  (Inferred), so each needs a square variant only he can supply; `node scripts/music-artwork.mjs` then registers
  it.
* **D-4** (previous and next everywhere, no 15-second skips) and **D-8** (AirPlay where WebKit offers it; resume
  across devices through `listener_state`; no remote control): defaults built for his review, not merged.
* **His devices** (music map 00, section 7):
  4. The lock screen on the album, the listen page and the World: the buttons, then next. It should now show
     previous and next on all three, with each song's title, artist and cover.
  5. Control Center and an AirPods double-press: skip a song on each surface.
  17. iPad, Safari, the album and the listen page: rows 1 to 5 again, then AirPlay from the album's sheet, the
      listen page's sheet and the pocket.
* Not in this slice: songs that end at navigation (slice M5), next songs that wait on the network (slice M3).

## Recovery continuation: release submission, playback and the phone header

Recovered base `69058f8997b36a5d1dad586481ef1febf1448373`, which already contains M1, M4 and M2. This continuation
repairs observable problems in the current submission flow; it does not mark the remaining music slices complete.

### Changes

- Creator Studio locks the release form before reading the selected audio's duration. A second submit during that
  asynchronous read cannot start another upload. The form restores each control's previous disabled state on
  success or failure.
- The chosen album, lyric sheet, metadata, rights declarations and optional license are captured before any
  asynchronous work. A later repaint of the album selector or another form cannot change what the release submits.
- A local audio probe that produces neither metadata nor an error ends after 15 seconds and releases its file
  handle. Missing rights confirmations, release terms, or terms for a priced license are refused before upload.
- If the selected album was deleted or filled while the track uploaded, the release remains submitted and the
  receipt says why it was not attached. Reapplying an attachment does not duplicate the track ID.
- If only the releases-list refresh fails after submission, the receipt still says the release was submitted and
  asks the creator to reload before uploading again. It does not present the accepted submission as a failed upload.
- The local music header reserves space for the fixed account chip, including the right safe-area inset. Its
  Creator Studio link has a 44px target and the header can wrap at narrow widths.
- Listen's access refresh, delayed metadata and first catalogue read cannot replace or restart a newer selection.
  A superseded eligibility reply cannot spend an earned play. Pause cancels a pending open, and a later Resume
  can open it again; repeated taps on the same pending song retain its one request.
- The album's earned-play claim and automatic-next wait belong to the selection that asked for them. A newer
  song, Pause, Previous or an explicit seek cancels their transport effect. Repeated taps while the same claim
  opens do not spend a second claim. Priming the audio cannot later pause the newly selected song.

The existing review and publication rules, private master storage, license activation controls, account fencing,
and cautious cleanup after an uncertain write remain in force. These are submission repairs, not a new
self-publication policy, batch album uploader or cross-page playback implementation.

### Verification

Node **22.23.5**, local synthetic records only:

```
node --test scripts/test/creator-release-submission.test.mjs \
  scripts/test/music-creator-page.test.mjs scripts/test/music-accounts.test.mjs \
  scripts/test/music-platform.test.mjs scripts/test/creator-onboarding.test.mjs \
  scripts/test/music-playback-races.test.mjs scripts/test/here-album-commerce.test.mjs \
  scripts/test/music-background.test.mjs scripts/test/now-playing-contract.test.mjs \
  scripts/test/gated-audio.test.mjs scripts/test/music-track-lengths.test.mjs
```

**123 passed, 0 failed, 0 skipped.** The seven new submission cases all fail against the recovered base's Studio
source and all pass with this continuation. They execute the real submission handler with isolated storage/database
doubles, including a pending metadata read, changes during upload, a removed/full album, and a failed refresh after
acceptance. The 16 playback cases execute the real engine and the album's transport functions: 12 fail at the
recovered base, all 16 pass after the repairs. The four unchanged cases preserve full-song completion/queue advance,
the intentional preview boundary, and duplicate-tap handling for a pending engine open, including a failed source
request. JavaScript syntax, both
album inline scripts and the scoped whitespace check also pass.

The existing `music-accounts.e2e.mjs` now has a `music_contextbar` scenario: both Listen and the artist page at
320, 390 and 1280px, checking actual chip/link intersection, a reachable 44px target, and horizontal overflow.
The existing Music Platform CI runs it alongside the account scenarios and now runs the submission and playback tests.
Local Chromium execution is blocked because the executor refused socket creation. On recovered head
`62277515c349900a206a1f9f3c982b2617cc056e`, Music Platform CI run `44548378615` passed **128/128 account checks**,
including all **18 new header geometry and hit-target checks**. The same run passed 47/47 background-playback,
125 Music-to-World/privacy and 125/125 Now Playing checks. Direct Sales run `44548378961` passed all 40 browser
checks and its database checks; Label Artists run `44548378897` passed. These are Chromium results, not physical
iPhone lock-screen or AirPlay receipts. The optional dedicated header screenshot capture was not enabled.

### Native Control publication review

The active desk at `control.html#sell:music:catalog` loaded `js/control-room/music-ops.js`, whose Publish button
sent only the track, decision and note. The existing `music-access` backend requires the reviewed release version
and verified master SHA-256 before publication. The older `js/music-admin.js` supplied them, but its HTML page
now redirects into Control, leaving that verification flow unreachable from the active desk.

The native release row now uses the same existing `operator-review-prepare` and `operator-review` actions:

- **Verify + listen** prepares the pinned master, shows its player and short hash, and enables Publish only for a
  valid response naming that track, its version, a complete SHA-256 and the canonical signed master URL.
- Preparation must name the version the row displays. `music_prepare_review` reads the release timestamp before
  pinning its master; pinning is not a reason to accept unseen metadata. A dashboard V1 / backend V2 mismatch
  requires a queue refresh and verification of V2. Publish carries that matching backend timestamp and hash.
- Refresh, failed verification, an audio-load failure or a publication attempt removes the prior preparation.
  An account change also removes and stops the private player. Calls and late replies are fenced to the account
  that started them; a same-account token renewal preserves the review.
- Repeated taps retain one pending verification or decision. A failed ancillary queue read cannot release an
  in-flight decision's lock. A lost or incomplete response is not retried; Refresh queue must read the outcome
  before another decision is available. Stale decisions also require refresh and verification.
- The success receipt says **Published.** only after a matching response confirms `published` and `cleared`.
  That acknowledgement survives a failed subsequent queue read. Existing operator authority, rights requirements,
  pinned-asset checks and license activation rules remain on the server.

Node **22.23.5**, synthetic records only:

```
node --test scripts/test/control-music-review.test.mjs \
  scripts/test/music-platform.test.mjs scripts/test/music-payment-integrity.test.mjs \
  scripts/test/control-surface.test.mjs scripts/test/control-room-lifecycle.test.mjs \
  scripts/test/control-room-authority.test.mjs
```

**112 passed, 0 failed, 0 skipped**, including **17 native-review cases** executing the real module and its
rendered actions. The same 17 cases fail against the prior native module. Independent review reran all 17 and
the two reproduced boundary failures: unseen backend metadata and an in-flight write surviving a failed queue
read. JavaScript syntax, scoped whitespace and workflow parsing/path checks passed.

`scripts/e2e/control-music-review.e2e.mjs` is wired into the existing Music Platform browser job. It defines
**49 checks across eight scenarios** on the real `control.html`, with all requests intercepted and synthetic
audio: verification and playback, the exact publication payload and readback/reload at 390 and 1280px,
verification failure, metadata changing before and after verification, an uncertain publication, sign-out during
verification and a refused operator. It measures horizontal overflow and 44px targets and captures the verified
player at both widths. **Its browser proof is pending CI.** Local Chromium execution remains blocked by socket
creation restrictions. **No authenticated production upload or publication was performed.**

### Complete-song evidence and remaining work

The measured public file lengths still match `data/albums.json` and the server's track registry. The engine lets a
full track continue past the preview boundary and advances on the media element's `ended` event; a protected preview
still stops at its declared limit. The existing Worker stream forwards Range and preserves 206, Content-Range and
Accept-Ranges. The private creator stream still checks entitlement and the pinned, reviewed master before signing
its URL. This continuation changes no duration cap, purchase authorization, review requirement or gate policy.

- **M3 remains partial** (see "M3: songs play to the end" below for what that slice settled in code). The reproduced interruptions above are repaired. This is not proof of complete playback
  over a slow/interrupted connection, next-song startup while a real iPhone is locked, or recovery after an expiring
  stream. The gated one-play stream still has the existing five-minute/16-request allowance; the private master's
  real duration and a physical-device complete play were not available to this local check.
- **M5 remains open.** Listen and the artist/album pages are separate documents. The existing saved position and
  Music-to-World continuity are present; this continuation does not keep one audio element alive across all music
  navigation.
- **Studio/album upload remains partial.** The current form uploads one track at a time and can attach it to an
  existing album. Album grouping/order and the operator review desk exist. No batch album upload, resumable transfer,
  or end-to-end authenticated production publication was completed here. Creators still submit to `pending_review`;
  the existing operator verification and rights rules decide publication.

The separate November 19 music maps referenced above were not present in the recovered repository, so their full
remaining M3/M5/M6 acceptance criteria cannot be reconstructed from this record alone. Physical iPhone/iPad background
endurance, lock-screen controls, AirPlay, the native publication desk's new browser flow, and authenticated
production upload/publication still need their own receipts. The header geometry already has the Chromium
receipt recorded above.

### Bounded finish order after this recovery

These are next slices grounded in the current code, not a reconstruction of the missing November 19 maps.
Finish the native review browser run above first; an authenticated upload/review/publication receipt remains
separate from synthetic CI and must use the existing operator flow.

#### 1. M3: interrupted streams, then real next-song transitions

**Status (M3, 2026-11-23; section "M3: songs play to the end" below).** Done in code and in Chromium: slow reads,
mid-track interruption, the resumed Range read and expiry on the public, entitled-creator and gated paths, through
the same resolvers, with the interrupted second kept; full audio ends at its media end once and a cut-off read is
never counted as finished; previews still stop at their boundary and no longer stop the record; Pause and a newer
song win over a retry; an expired or unconfirmed earned play is said and never claimed again by itself; the next
creator release is signed ahead. After the review round (section "Review and fixes" in M3 below): every try starts
inside ten seconds of the silence and a read that hangs is noticed within four; while a song is picked up again
every transport, the lock screen and the installed app's dock offer Pause, which stops the tries, and a pause from
the World or the sleep timer stops them too; a second chosen on the way is kept; a song that never started is not
called a dropped connection. Not done: the physical iPhone runs below (two consecutive full songs locked, the
gap, the closer's real master and an authorized complete play, and the drop rows of the review round), which still
decide whether M3 is complete. An independent check of the branch head `8c279b01` ("Verification of M3", under M3)
ran every probe, suite and revert proof again and found the code side as described; the rows for Matthew's devices
are collected there in one list.

Use `js/music-engine.js`, the deck in `album.html`, `js/gated-audio.js` and `js/listen-ledger.js`; retain
`js/now-playing.js` as the one device-controls owner. The delivery authorities are the existing
`workers/mccluster/src/music/router.js` and `supabase/functions/music-access/index.ts` / `delivery.ts`.
The Worker accepts Range requests while its play token remains valid (300 seconds / 16 requests); an expired
or spent token refuses a later request. Creator streams are signed for 3600 seconds after their existing
entitlement and asset checks. Neither client resolver currently retains the returned `expires_in` value.

Start with controlled slow reads, a mid-track interruption, a resumed Range request and an expired URL on the
public, entitled-creator and gated paths. Repair demonstrated recovery failures through those same resolvers;
for sources whose authorization permits resuming, retain the interrupted position instead of starting from zero.
An expired earned play must remain subject to its existing server decision. Do not increase its allowance or
spend another claim silently to make a test pass.

Acceptance: full audio reaches its media end once, previews still stop at their declared boundary, failed
delivery is not recorded as completion, retries cannot override a newer selection or Pause, and an uncertain
or expired earned play does not trigger an automatic second claim. Extend `music-playback-races.test.mjs` and
the existing background/continuity browser fixtures; keep the Worker Range/410 tests and delivery integrity
tests passing.

Then record physical iPhone Safari playback through at least two consecutive full songs while locked, on
both Listen and the album, with reduced motion on and off. Include the album's wait for the previous listen
receipt before claiming its gated closer, a slow next-source response, lock-screen Next/Pause and return to the
page. Record the actual gap and each next song's title/position. This needs the real private master's duration
and an authorized complete play; Chromium fixtures do not establish it. Do not label the result gapless without
that evidence.

#### 2. M5: retain one player across music navigation

**Status (M5, 2026-11-23; section "M5: one player across music pages" below; on the branch only, because D-5 is
Matthew's decision and is unanswered).** Done in code and in Chromium for the first pair and for two more stages:
Listen and the artist pages each stay the one document that plays while the other opens over it as a view (the same
element, source and buffer, its clock advancing, one owner of sound and of Now Playing, pause and mute deliberate,
Back and Forward, exact deep links, account changes, the preview and gate rules, the World as before); the album as
the retained document, through its own deck, with Listen and the artist pages over it; and the account page as a
sign-in view on the password path that comes back to the music. A refresh still ends the document, as documented.
Not done: the album as a view (Listen -> the album, the most travelled link, is still a page load), the other music
routes, and every device row. Until Matthew's devices run them, everything about an iPhone or iPad is Inferred, and
D-5 itself waits for him.

First scope the retained-document work to `listen.html` and `music-creator.html`, which already use
`MCC_MUSIC`; then connect `album.html` through its existing deck controls. Reuse the ownership, history and
handoff pattern documented in `MUSIC-WORLD-CONTINUITY.md` and implemented by `js/world-audio-continuity.js`
and `js/tabbar.js`. `js/pip.js` / `listener_state` remain position recovery, not proof of uninterrupted audio.
This is a browser navigation slice using the current players, auth and gates; it needs no new backend.

Acceptance: during supported music links and Back/Forward, the same audio element, source and buffer survive,
its clock advances, only one player owns sound and Now Playing, and pause/mute remain deliberate. Choosing a
different track still follows the existing resolver and queue. Preserve exact artist/album deep links, account
changes, purchase/preview restrictions and the current Music-to-World behavior. A refresh or tab eviction still
has the documented recovery behavior; do not mistake a timestamp restore for continuity. Establish this for the
first pair before expanding the route set.

#### 3. Album batch intake through the existing submission path

The current input in `creator.html` selects one master. Reuse the validated submission sequence in
`js/music-creator-studio.js` for each selected track: its captured metadata and rights, `creator-upload-url`,
immutable upload paths, `creator_tracks`, attestations, `pending_review`, cautious rollback and accepted-release
receipt. Reuse `saveSettings()` and `js/music-creator-page.js` album normalization for grouping/order; respect
their existing file, album and track limits. Extract that one-track operation before adding a small sequential
batch controller, so a batch cannot become a second submission or publication implementation.

Acceptance: the creator can review each track's metadata, preview, lyrics and rights before transfer; completed
tracks keep their receipts and album order; a failed middle track does not undo accepted submissions or upload
them again; a retry targets only the failed item; account changes stop later work under the old account; an
album removed or filled during intake is reported without losing the accepted release. Reload shows the saved
group and statuses. Every track still goes through the native operator's existing verification and publication
checks. Batch selection and resumable byte transfer are separate capabilities; the current signed-upload call
does not yet provide a resumable transfer implementation.

## M3: songs play to the end

Base `b51ede03` (the branch head with PR #820's installed-app dock). The scope is item 1 of "Bounded finish order
after this recovery" above: interrupted, slow and expiring delivery on the public, entitled-creator and gated paths,
then the next song. Decisions D-7 (the World's mute is the World's), D-11 (the gated closer stays preview-only, says
so, and never stops the record) and D-20 (the B-side published as the M4A it is) are the recommended defaults,
built for Matthew to see before anything merges. The Worker change is one line of behaviour (a read past the end).

### What still reproduced at the base

Re-run at `b51ede03` with the November 19 lane probes (copies of them, never the live site):

| Map row | Probe | At `b51ede03` |
| --- | --- | --- |
| PB-2 | 01 S3, the first earned tap | **Fixed by the recovery**: play, waiting, playing, no pause; 2.8 s heard after 3 s |
| PB-11 | 01 S3, requests per play | **Fixed by M1**: one stream request per play |
| PB-4 | 01 S2 (album), S2b (listen engine), guest | Reproduces: the closer's preview ends and the album or the queue stops on it |
| PB-5, DEL-6 | 01 T6 (public file), S3 drop (earned play) | Reproduces: one failed read (network error 2) stops the song for good with 11 s still buffered. The listen engine kept showing Pause and the lock screen said "playing" while nothing played (`new Audio()` stays `paused=false` after the error); the album deck stopped with nothing said; neither ever asked again |
| PB-6 | 01 S6 | Reproduces: a stored World mute silenced the listen engine and the album deck ("Full track", "Pause" on screen) and no Music page had an unmute; PR #820's dock has play, pause, previous and next only |
| DEL-2 | 02 `gate_paint.mjs` | Reproduces: a member whose gate answers `gate_not_ready` was shown "0/3 MISSIONS + identity verification" from the page's own defaults. `gate_paint_ready.mjs` (the control) was right |
| DEL-4 | 02 `listen_race.sh` | Reproduces in the page's real order: run against disposable PostgreSQL 16 with the real migrations and the real `js/listen-ledger.js` (the finish 400 ms slow on the wire), the database saw start A, start B, finish A, and song A (95 of the 92 s needed heard) was recorded `completed = false` |
| DEL-5 | 02 `stream_budget.mjs` | The allowance holds (16 reads answered 206, the 17th 410; 410 after the lifetime). A read past the end came back 502 from Storage's 416: reproduces |
| DEL-8, PB-12 | atom survey, 01 S10 | Reproduces: `dealer-plates-b.mp3` is an MP4 (AAC) served as `audio/mp3`; it and `deep-end.m4a`, `heal-the-3rd-world.m4a` and `you-the-feds.m4a` keep their index (moov) after the audio (mdat); every music page read the World theme's file before any tap, twice (`bytes=0-`, then the end for the index) |
| EXT-5 | code read | Reproduces: the engine asked `music-access` for the next creator release only after `ended` |

### Why

Matthew, 2026-11-19: "The music never plays fully through." Apart from the lock screen (M1), the causes were in
delivery: a read that failed once ended the song, and the players either said nothing or kept saying "playing"; a
locked preview stopped the record it sat in; a stored World mute silenced Music with no way back on the page; the
listen ledger could start the next song before the last one's finish reached the database, so a song heard to the
end was recorded as unfinished; and four files made a phone fetch the end of the file before the first sound.

### What changed

1. **A song that stops on the way says so and picks up where it stopped** (`js/music-engine.js`, the deck in
   `album.html`). On a failed read, 4 s of silence with no progress once the song has been heard (12 s before its
   first sound), or an `ended` more than 2 s short of the file's own length, the player quiets its element (never
   "playing" over silence) and shows **Reconnecting…** (the mini player, the Now Playing sheet, the album's deck
   bar, the World's transport, the installed app's dock, the game hub's capsule) with one short line ("The
   connection dropped at 0:42. Picking up there…": under the title in the mini player and the sheet, and spoken from
   a live region beside the mini player; on the album it is the page's status line, which screen readers announce).
   The one button is **Pause** (on the album Play all and the bar's own transport too), and the lock screen is told
   the listener asked for music (through `js/now-playing.js`, which stays the one owner of device controls): Pause
   stops the tries. It asks for the song again at that second (a Range read from the middle of the file) 0.5, 1.5,
   3, 5.5 and 8.5 s after the sound stopped, every try inside the ten seconds WebKit's source keeps an audible page
   awake after its sound stops and lets a hidden page start it again without a tap (what an iPhone does is
   Inferred); a try whose read never answers gives way to the next on time, and a try the browser refuses to start
   (a hidden page that needs a tap) stops the tries. Then it shows **Connection lost** and says "The connection
   dropped. Tap play to pick up at 0:42."; Play picks it up there at once. A song that never started (a missing or
   unreadable file, or no network at all: the page cannot tell which) says **Loading…** and "This song would not
   load. Trying again…", then **Could not load** and "This song could not load. Tap play to try again.", never a
   dropped connection. A first read that takes more than 1.5 s says **Loading…**. Pause, or another song, cancels a
   pending try; a pause from outside the page (the World's transport and its pause message, the sleep timer) goes
   through the page's own Pause and counts as the listener's, and the deck's own pause on a failed read does not. A
   second chosen on the way (a seek bar, Previous, a lyric line, the lock screen's scrubber) is where it picks up. A
   failed or cut-off read is never counted as a finished song and is recorded as `music_interrupted` (reason,
   second, attempt, path; no account or place; since the M3 follow-up below that name waits for Matthew's approval
   and is not sent). (Corrected in the review round, "Review and fixes" below: the tries
   were 0.5, 1.5, 3.5 and 7.5 s apart, so the fourth started 13 s after the sound stopped, and a read that hung was
   noticed only after 12 s.)
2. **Each path asks again through the resolver that opened it.** A public file: the same file. An earned play: the
   same one-play URL while its time holds; the claim's `expires_in` is kept, and within its last 10 s or after it
   the play is over: it stops, says "The connection dropped and this play's time ran out. Playing it again starts
   a new play." (on the listen page, run out while it was paused: "This play's time ran out while it was paused.
   Playing it again starts a new play.", and the label says **Play ended**), the row goes back to its preview and
   asks the gate afresh (a read), and nothing claims again by itself. A claim whose answer was
   lost is said ("We could not confirm the play. If it went through, it may already be used. Tap the song to try
   again.") and never retried. A creator's release: its `expires_in` (3600 s from `music-access`) is kept and the
   URL is signed again a minute before it lapses; a URL refused or expired mid-song picks up on the URL signed
   ahead, or asks `music-access` again; if the entitlement now says preview, the preview plays and says why. The
   server's checks decide every time; no lifetime, allowance or entitlement changed.
3. **A locked preview never stops the record (D-11).** It still ends at its declared boundary; then one short line
   says what it was ("That was the preview of Niggy Nigg Niggr. The full song opens later.") and the album or the
   queue moves on.
4. **The gate says what is true (DEL-2).** When the gate answers `gate_not_ready` the row says **FULL SONG · opens
   later** and the sheet "The full song opens later."; mission and identity numbers are shown only when the
   server's rule sent them.
5. **A finished song is counted before the next one starts (DEL-4).** `js/listen-ledger.js` sends the next song's
   start only after the finish in flight has answered (5 s at most; since the M3 follow-up below, half the
   catalogue's smallest margin, 1.85 s, written from the songs' own lengths; since that follow-up's review round,
   half the next song's own margin, 5 s at most).
6. **The World's mute is the World's (D-7).** A mute stored by the World governs its own soundtrack only. A muted
   Music song says **Muted** and shows its own 44 px Unmute in the mini player, the Now Playing sheet, the album's
   deck bar and the album's sheet (there a chip under the transport); the installed app's dock says Muted. Unmute
   from the keyboard leaves the focus on the same player's Play/Pause.
7. **Every file is what its name says and starts fast (D-20).** The B-side is published as
   `assets/audio/dealer-plates-b.m4a` (`ffmpeg -c copy -movflags +faststart`) and `data/albums.json` plays it; the
   old `.mp3` stays for links that still point at it. `deep-end.m4a`, `heal-the-3rd-world.m4a` and
   `you-the-feds.m4a` were remuxed in place the same way. In ffmpeg the decoded audio is identical before and after
   (md5 of the decoded PCM and of the packets, all four files); the peaks changed only in their source hash, and the
   B-side's in its file name. The containers now carry the encoder delay as an edit list instead of an iTunes
   note, so their stated length is 0.048 s shorter; ffmpeg already skipped those samples. The iTunes note also
   marked the encoder's padding at the end, and the edit list does not: Chromium decodes 119 to 713 more silent
   samples at the end of each remuxed file (3 to 16 ms; every sample before them is the same), and what Safari does
   is not known (corrected in the verification round, review PB-R9 and RL-13). Deep End's stated
   length rounds to 165.7 s instead of 165.6 s in `data/albums.json` and the generated
   `workers/mccluster/src/music/tracks.js` (the counted minimum stays 157 s). `scripts/music-track-lengths.mjs
   --check` now also fails on a misnamed file or an index at the end. (Superseded in the M3 follow-up below: the
   four files are now the files from before M3 with only their index moved in front of the audio, the iTunes note
   kept and no edit list, so Chromium decodes exactly the samples it did before M3 and Deep End is 165.6 s again.)
8. **Nothing is read before it is needed (PB-12).** On a music page the World theme reads nothing until the Globe
   tap; the standalone World reads only the song it drew.
9. **The next song does not wait on the network where policy allows (EXT-5).** Within 20 s of the end the next
   creator release is signed ahead (dropped on an account change or once its time is short); for the gated closer
   only the gate's answer is asked ahead: a play is claimed only when it starts.
10. **The Worker answers a read past the end as 416** with Storage's `Content-Range`, not 502
    (`workers/mccluster/src/music/router.js`). Nothing else in the Worker changed apart from the regenerated length.
11. The World's transport says Reconnecting…, "Connection lost · tap play", Loading… or "Could not load · tap play"
    for the song it carries, and offers Pause while the song is picked up again.
12. **CI.** `music-platform-ci.yml` now watches the track-length script and test, the gate and ledger tests, the
    Worker's music routes and their test; `music-contract` runs them (the Worker test with its offline network
    guard). No new workflow and no new trigger.

### Tests: failing at the base, passing after

| Test | At `b51ede03` | After |
| --- | --- | --- |
| `scripts/test/music-playback-races.test.mjs` (34: engine and album delivery, preview, prefetch, expiry, Pause) | 16 of 34 | 34 of 34 |
| `scripts/test/gated-audio.test.mjs` (17) | 14 of 17 | 17 of 17 |
| `scripts/test/listen-ledger.test.mjs` (5) | 3 of 5 | 5 of 5 |
| `scripts/test/music-track-lengths.test.mjs` (4) | 2 of 4; the new check over the base audio names the five problems | 4 of 4 |
| `workers/mccluster/test/music-gate.test.mjs` (24) | 23 of 24 (416 came back 502) | 24 of 24 |
| `scripts/e2e/music-background.e2e.mjs`, now with slow reads, mid-track drops, Range resumption, an expiring creator URL, an expired earned play, the locked preview, the World's mute and the theme's reads | 63 of 88 checks; all 25 failures are new checks (the new 390 px, script-error and first-tap checks pass at the base too) | 97 of 97 |
| `scripts/e2e/music-world-continuity.e2e.mjs`, now with a drop under the World, the preview moving the queue on and the World's first reads | 125 pass, 8 fail, all of them new checks (recorded without stopping, in a copy used only for that run) | 133 of 133 |
| 02 `listen_race.sh`, client order on PostgreSQL 16 | song A `completed = false` | `completed = true` (start A, finish A, start B) |
| 02 `stream_budget.mjs` | past the end: 502 | 416; 16 × 206, the 17th 410, 410 after the lifetime, as before |
| 02 `gate_paint.mjs`; `gate_paint_ready.mjs` (control) | "0/3 MISSIONS"; right | "FULL SONG · opens later"; right |
| Root suite `node --test scripts/test/*.test.mjs` | | 3046 tests: 3039 pass, 0 fail, 7 skipped. One existing guard (`journey-errors.test.mjs`) kept the old preview stop; it now asserts the move-on and fails at the base |
| Worker suite | | 2032 tests: 2023 pass, 0 fail, 9 skipped |
| Now Playing, accounts, installed app (PR #820) and native publication browser suites | | Now Playing 125 of 125; accounts 128 of 128; installed app 246 of 246; native publication 49 of 49 |

Every fix was also taken away on its own and its test failed: the Worker's 416, the gate's "opens later", the
ledger's wait, the container check and the remuxed index (whole files at the base), and fifteen single mutations
(the pause on a failed read, Pause cancelling a retry, the resume second, both lapse checks on each player, the
short-end check, the preview advance on each player, the creator refresh, the prefetch, the unconfirmed claim's
line, the outside-pause rule and its error-pause guard, the ledger's wait). The World's mute and theme fix put back
at the base failed 4 browser checks. The tree was restored byte for byte after each.

390 px (`scrollWidth === clientWidth`): the listen page with Reconnecting… and its line, and with Muted and Unmute;
the album with Reconnecting…, with an expired play's line and with Muted and Unmute; the artist page with a muted
song; the listen page with the preview's line; the album with the closer's "opens later" row. Renders for Matthew
at 390 px (device scale 2): `listen-390-reconnecting`, `listen-390-muted`, `listen-390-preview-moved-on`,
`album-390-reconnecting`, `album-390-muted`, `album-390-preview-moved-on`, `album-390-play-ended`,
`album-390-closer-opens-later` (kept with the workflow's evidence, not in the repository).

### The one-play allowance (300 s, 16 reads): evidence, and a proposal for Matthew

The allowance is unchanged and no test spends a second claim. A recovery inside the play's time reuses its URL, so
each try costs a read or two of the 16. What the repository cannot show is whether an entitled full play of the
closer can finish inside 300 s at all: its master is private and its length is recorded nowhere here
(`data/ddex/identifiers.json` has `duration_ms: 0`). If the master runs longer than about 4:50, a full play cannot
finish inside the allowance even on a perfect connection. **Proposal, not built:** size the play token's lifetime
from the master's measured length (for example its length plus a minute) and keep the 16-read cap; or, if the
master is shorter than about four and a half minutes, keep 300 s. Either needs the master's real length and an
authorized complete play on his phone.

The page cannot see a stream's 410: a play whose 16 reads are spent looks like a dropped connection until its time
runs out, then it says the play's time ran out. Tapping play in between asks the same URL once more; it never claims.

### What is Inferred

* Everything about an iPhone or iPad: whether Safari resumes with a Range read the way Chromium does, what the lock
  screen shows during Reconnecting…, how many reads AVFoundation makes for one earned play against the 16, and
  whether the edit list the remuxed files now carry plays gaplessly there (the decoded PCM is identical in ffmpeg;
  since the M3 follow-up the four files carry their own iTunes note again and no edit list, as before M3).
* Chromium pauses an element in the page itself when a read fails (error, then pause) and leaves a detached
  `new Audio()` playing over silence; the players handle both, and WebKit may do either.
* Real networks: the fixtures cut reads short, hold them and refuse them for a few seconds; a phone moving between
  cells can fail differently.

### What waits for Matthew

* **D-7**, **D-11** and **D-20**: defaults built for his review, not merged. D-11 also asks him whether the closer
  stays preview-only or opens to signed-in members (the gate SQL chain was not touched).
* `music_interrupted` is a new client event; it is not in the reviewed measurement dictionary yet (since the M3
  follow-up it waits in `js/analytics.js` and is not sent until he approves it).
* **His devices** (rows of the device checklist, music map 00 section 7):
  3. Listen page: play a song near its end, lock, wait past the end: the next song starts.
  7. Album, gated closer, signed in as the owner: the first tap plays.
  8. Album, gated closer, signed out: the 4-second preview, one line, and the album moves on (it no longer stops).
  9. A long song on cellular with the screen locked, then a whole album: note where each stops; a drop now picks up
     at its second.
  10. A stored World mute no longer silences Music; a muted Music page shows Muted and its own Unmute.
  11. Dealer Plates (B-Side) on the album: plays (now the `.m4a`).
  15. The closer's row says "FULL SONG · opens later" while its rule is not live.
  Then, from item 1: two consecutive full songs played through with the phone locked, on the listen page and on the
  album, Reduce Motion on and off, including the album's wait for the previous finish before the closer's claim, a
  slow next source and lock-screen Next and Pause; record the gap and each next song's title and position. A drop
  test: airplane mode for five seconds mid-song, then off. The closer's full play needs the real master's length
  and an authorized play (above). Nothing here is labelled gapless.
* Not in this slice: songs that end at navigation (M5), album intake.

### Review and fixes

Two independent reviews of the M3 head `0e687e51` (one for playback, one for regressions and the law) reported 24
findings. Fourteen were major or minor findings about M3, and this round took them; one defect was reported by both
(PB-R8 and RL-1: a missing file called a dropped connection), so there were 13: 2 major and 11 minor. Each was
reproduced at `0e687e51` first (the reviewers' Chromium probes with route fixtures, run again here, and the engine in
Node for the signing-ahead), given a test that fails there, and fixed. All 13 are fixed; none was set aside. The
other ten, eight nits about M3 and two findings that were there before M3, did not come to this round; each is
answered under "Verification of M3" below.

| Finding | At `0e687e51` (reproduced) | Now |
| --- | --- | --- |
| PB-R1 (major) | The tries were waits one after another (0.5, 1.5, 3.5, 7.5 s): reads went out 0.5, 2.0, 5.5 and 13.0 s after the first failure, and a read that hung was noticed after 12 s (Reconnecting… 12.06 s after the wait). The comment claimed all four inside the ten seconds | Tries 0.5, 1.5, 3, 5.5 and 8.5 s after the sound stopped (a time already past is skipped, never made up in a burst); a try still waiting gives way to the next on time, the last has 3 s before Connection lost; 4 s of silence once the song has been heard is a dropped read (12 s before its first sound) |
| PB-R2 (major) | Album: a pause from outside the page while a try was waiting did nothing (the deck was already quiet, so `deck.pause()` fired no event) and the try started the music again: the World's transport, its pause message, the sleep timer (the deck played on at 19.4 s, 12 s later) | The World's transport and its pause message (`js/world-audio-continuity.js`) and the sleep timer (`js/label.js`) pause through the page's own Pause (`MCC_NP_PAUSE`), which ends the tries |
| PB-R3 | During Reconnecting… every transport offered only Play, and Play tried again at once (a read 53, 79 and 10 ms after the mini player, the deck bar and the lock screen) | While a song is picked up again the one button is Pause on the mini player, the Now sheet, the deck bar, the album's sheet and its Play all, the bar's own transport, the World's transport, the installed app's dock and the game hub's capsule, and the lock screen is told the listener asked for music (`spec.playing` in `js/now-playing.js`); Pause stops the tries and says how to pick the song up |
| PB-R4 | A second chosen during the trouble was overridden (the album's Previous, then Play: picked up at 9.15 s, the drop was at 8.0; the lock screen's seek to 1:30: picked up at 9.09 s) | The seek bars, Previous, a lyric line and the lock screen's scrubber move the second the song picks up at; the tries keep going from there |
| PB-R5 | Album: Pause and Play within 5 s of a recovery, or of a slow first read, read the song again and went back to the old second (a read from byte 0, then 9.01 s after a pause at 9.63) | Only a song in trouble (Reconnecting… or Connection lost) is picked up at its second; otherwise Play plays on |
| PB-R6 | A try whose `play()` was refused stayed "Reconnecting… Picking up there…" for good (still so after 25 s) | A refusal that needs a tap (`NotAllowedError`: WebKit's source refuses a hidden page's sound more than 10 s after it stopped) ends the tries with "Tap play to pick up at m:ss."; any other refusal reports itself as an error, and the try's deadline covers one that does not |
| PB-R7 | A signing-ahead that failed was reused: after a blip near the end of a song the next creator release opened as its preview for an entitled member, and `music-access` was not asked again (the engine in Node) | Only a full answer with its address is kept; anything else is asked again when the song starts (latent: production has no creator releases) |
| PB-R8 = RL-1 | A song that never started (a 404, an unreadable file) was "Reconnecting…" and "The connection dropped at 0:00…", then "Connection lost", five reads; on the album beside the toast "This track could not load here…" | "Loading…" and "This song would not load. Trying again…", then **Could not load** and "This song could not load. Tap play to try again."; the album's toast, deck bar and status line agree. "The connection dropped" is kept for a song that was heard (it moved on after it started, or it has metadata and a position past the start) |
| RL-2 | Play on an earned play that ran out while paused said "The connection dropped and this play's time ran out" (no read was made), and the spent play had no label | "This play's time ran out while it was paused. Playing it again starts a new play." and **Play ended**; still no read and no claim |
| RL-3 | The album sheet's Unmute sat in the transport row: with the AirPlay beam showing (Chromium shows its Remote Playback beam, as WebKit does with a device in range) every chip was 33 px wide at 320 before muting and 23 muted, 34 muted at 390 | Unmute is its own 44 px chip under the transport, in words; the transport's chips keep at least 44 px (the play 56) and stay round at 320 and 390, the space between them taken from the row |
| RL-4 | Unmute hid itself and the keyboard focus fell to the page | Unmute from the keyboard leaves the focus on the same player's Play/Pause (listen and album) |
| RL-5 | The listen page's only live region sat inside a button, whose children a screen reader is not given (WebKit builds none) | The same line is spoken from a visually hidden live region beside the mini player's row, once per change; the visible line stays where it was |
| RL-6 | In the installed app the dock hid the mini player and said nothing of the delivery (its second line kept the artist, its button said Play music) | The dock's second line and label say why the music is quiet (Reconnecting…, Connection lost · tap play, Loading…, Could not load · tap play, Muted; `spec.status` in `js/now-playing.js`), and it offers Pause while a song is picked up (since the M3 follow-up the words take a line of their own across the top of the dock, and the second line keeps the artist) |

Four more defects came up in this round's own runs and renders and were fixed before anything was committed, each
with a test:
* A slow first read's Loading… note was kept as if it were a trouble of its own, so a drop right after it was neither
  named nor tried again (this round's first browser run). The unit test for that order passes at `0e687e51`, whose
  copy and tries did not depend on it.
* The game hub's music capsule (`js/game-hub/shared-music.mjs`), one more transport over the engine, read the element
  alone: during Reconnecting… it offered Play, which tried again at once, and its line kept the album's name. It now
  follows what the listener asked for and says why it is quiet (found while fixing PB-R3).
* On the album the browser pauses the deck itself when a read fails (error first, then pause), and the deck's own
  pause listener then told the bar's transport and Play all that nothing was wanted, after the trouble had said Pause:
  both offered Play during Reconnecting…, and the bar's Play tried again at once (seen in this round's first renders;
  the unit harness had never run that listener, and its stand-in failed without the browser's pause). The listener
  now follows the same intent, and a pause from outside the page while a try is playing ends the tries and says how
  to pick the song up.
* `js/intuition.js` counts the deck's play events to tell a listener two records deep to keep the masters. Since each
  try plays the same record again, one record and one try were "two records deep", and the tip covered the deck bar
  2.5 s later (seen in the second renders). It now counts a record once. `js/intuition.js` joins the music
  workflow's watched paths, as `js/label.js` is.

**Tests, failing at `0e687e51` and passing after.** The new and changed tests were copied into a worktree at
`0e687e51` and run against its code (the continuity suite in a copy that records instead of stopping):

| Test | At `0e687e51` | After |
| --- | --- | --- |
| `scripts/test/music-playback-races.test.mjs` (54: 20 new, 4 changed) | 31 of 54; the 23 that fail are every new or changed test but one, the slow-read-then-drop order found in this round's own run, which passes there | 54 of 54 |
| `scripts/test/now-playing-contract.test.mjs` (19: 1 new, 2 changed) | 16 of 19 | 19 of 19 |
| `scripts/e2e/music-background.e2e.mjs` (138 checks) | 112 of 138; all 26 failures are new or changed checks (the new 390 px and script-error checks pass there too) | 138 of 138 |
| `scripts/e2e/music-world-continuity.e2e.mjs` (137 checks) | 133 pass, 4 fail: the changed drop check and the three checks of the new album-under-the-World pause | 137 of 137 |
| The reviewers' probes (their Chromium route fixtures, run again) | as in the findings table above | see below |

Assertions changed because they held the reviewed behaviour: in `music-playback-races.test.mjs` the button during
Reconnecting… (Play, now Pause), the schedule (waits of 0.5, 1.5, 3.5 and 7.5 s) and both slow-read cases (a stall
after sound picked up after 12 s, now 4); in the background suite the drop checks on the listen page, the
creator's release and the album (Play and a lock screen not "playing", now Pause and "playing"); in the
continuity suite the drop under the World (Play, now Pause); in `now-playing-contract.test.mjs` the dock's
snapshot gained `status`. The album harness in `music-playback-races.test.mjs` now also runs the deck's own play and
pause listeners.

**The reviewers' probes, run again on the fix:** the one button is Pause and pressing it reads nothing more, on both
players (B); tries read 0.5, 1.5, 3.0, 5.5 and 8.5 s after the first failure, then Connection lost at 8.5 s with the
network down (C); a read that hangs is named after 4.1 s (C); a refused try ends at Connection lost (D); Previous
picks up at 0:00 and the lock screen's seek to 1:30 picks up there (1:31 a second later) (L); a missing file is
Loading…, then Could not load at 8.5 s, with the album's toast, deck bar and status line agreeing (E); Pause and
Play after a recovery play on with no read (R); the sheet's chips are 49 px at 320 and 52 at 390, with Unmute, 114
by 44 px, outside the row (RL3); the focus stays on Play/Pause (RL4); the live region sits beside the button (RL5);
the dock says Reconnecting… and Pause music (RL6). Two probes behave as before, by design: A calls `deck.pause()`
itself on a deck that is already quiet, which fires no event the page could see (every caller in the repository now
goes through the page's own Pause, as the continuity suite and the unit test show), and B2 sends the lock screen's
play action during Reconnecting…, which tries at once, as a play request should (the lock screen now offers Pause).

**Revert and fail.** Each fix was taken away on its own, put back as it was at `0e687e51`, and its test failed: 27
single mutations at the unit level (on each player the schedule, the deadline for a try that hangs, the 4 s stall,
the one button, a refused `play()` and a song never heard; on the engine a failed signing-ahead, a play that ran out
while paused, a chosen second and the slow read's Loading stub; on the album the resume branch, a chosen second, the
deck's own pause listener and an outside pause during a playing try; the World's and the sleep timer's pause; the
lock screen's `playing` and the dock's `status`; the capsule's button and its line; the tip's count), and 7 in
Chromium (the sheet's row as it was: 4 checks at 320 and 390; the focus after Unmute, on each page; the live region
back inside the button; the dock's line: 2 checks; the World's pause on the album: the continuity suite stops at that
check; the deck's own pause listener: the bar's check). The tree was restored byte for byte after each.

**Suites.** Root suite `node --test scripts/test/*.test.mjs`: 3,067 tests, 3,060 pass, 0 fail, 7 skipped. The music
workflow's test job, step by step: all pass (platform 21, creator release submission 7, native publication 17, races
54, background contracts 9, gate and ledger 22, track lengths `--check` and 4, the Worker's music gate 24 under its
offline guard, peaks `--check` and 6, accounts 15, artwork `--check`, Now Playing contract 19). In Chromium, one
suite at a time: background 138 of 138, continuity 137 of 137, Now Playing 125 of 125, accounts 128 of 128, native
publication 49 of 49, installed app 246 of 246, direct checkout 40 of 40, and the game hub's capsule passes (with
axe-core 4.10.3). No Worker file changed, so the Worker suite was not run again; the music gate's own test ran in the
job above. The source map validator exits 0 (2,966 of 2,966 checks; no file was added). At 390 px
(`scrollWidth === clientWidth`) every state this round added fits: the listen page and the album during a drop,
after Pause during the tries and with a song that could not load; the album's sheet muted with the beam showing, at
320 and 390; the installed app during a drop.

**Renders for Matthew** at 390 px, device scale 2, kept with the workflow's evidence (not in the repository):
`listen-390-reconnecting` and `album-390-reconnecting` (again: the one button is Pause on the mini player, the deck
bar, Play all and the bar's transport), and new: `listen-390-paused-during-the-tries`,
`album-390-paused-during-the-tries`, `listen-390-could-not-load`, `album-390-could-not-load`,
`album-390-sheet-muted` (Unmute in its own chip under the transport, with the beam showing) and
`installed-listen-390-reconnecting` (the dock says Reconnecting… and offers Pause; at 390 px the dock's width cuts
its second line to "Reconnectin…", and its label carries the whole words).

**What is Inferred (review round).**
* The ten seconds are read in WebKit's source (`WebPageProxy.cpp`: `audibleActivityClearDelay = 10_s`;
  `MediaElementSession`: a 10 s grace before a hidden page needs a tap to start sound, with
  `RequiresUserGestureToStartAudiblePlaybackWhenHidden` on by default). Whether a locked iPhone keeps the tries
  alive, and how long a real drop takes to fail, is for the device rows below.
* The lock screen while a song is picked up again: told "playing" while the element is quiet, it should offer
  Pause; its scrubber may move on while nothing plays.
* Whether WebKit reports a failed try as a network error or as `NotSupportedError` (code 4); a song that was heard
  keeps the connection's words either way.
* Whether VoiceOver reads the new live region on the listen page.

**What waits for Matthew (review round).** Rows to add to the device checklist, each noted as run in a Safari tab
or from the Home Screen icon (the installed app, PR #820's dock):
* A drop: airplane mode for 5 s mid-song with the screen locked, then off: the song picks up at its second (all
  tries fall within about 9 s of the silence); for 15 s: Connection lost, and Play picks it up there.
* During Reconnecting… press Pause on the lock screen, then on the World's transport and on the album's bar: the
  music stays paused when the network comes back.
* From the Home Screen icon, a drop: the dock says Reconnecting… and offers Pause.
* VoiceOver on the listen page during a drop: the line is spoken.

### Verification of M3 (2026-11-23)

An independent check of the branch head `8c279b01` against the slice's base `b51ede03` and the reviewed head
`0e687e51`, each in its own worktree. It took nothing from the rounds above on trust and ran everything again.
Nothing was merged, deployed or applied.

* **The reviewers' probes, and nine of this check's own** (Chromium, every request a route fixture): at
  `0e687e51` every review defect shows again; at `8c279b01` none does. On the listen page and on the album the tries
  read 0.5, 1.5, 3.0, 5.5 and 8.5 s after the first failure and the song says Connection lost at 8.5 s (13.1 s at
  `0e687e51`); a read that hangs is named after about 4 s (12 s). During Reconnecting… the one button is Pause, and
  after it nothing reads or plays for 12 s once the network is back (at `0e687e51` the button was Play and the music
  came back). The real sleep timer, run during a try, leaves the album paused (at `0e687e51` the try played on). A
  refused try ends at Connection lost on both players. Previous during Reconnecting… picks the song up at 0:00 once
  the network returns (at `0e687e51` it stayed at Connection lost, 0:08). A missing or unreadable file is Loading…,
  then Could not load, never a dropped connection. An earned play that ran out while paused says Play ended and
  "This play's time ran out while it was paused", with no read and no second claim (at `0e687e51`: "The connection
  dropped…"). Two full songs in a row play to their ends and the next one starts, on the listen page and on the
  album. The signing-ahead repro (the engine in Node) asks `music-access` again and opens the next creator release
  in full (at `0e687e51` it opened the preview). The delivery probes: `gate_paint.mjs` says "0/3 MISSIONS" at the
  base and "FULL SONG · opens later" now, its control right at both; `stream_budget.mjs` answers 16 reads 206, the
  17th 410 and 410 after the lifetime at both, and a read past the end 502 at the base, 416 now; `listen_race.sh`
  on PostgreSQL 16 records start A, start B, finish A and song A `completed = false` at the base, and start A,
  finish A, start B and `completed = true` now. The head's container check over the base audio names the five
  problems and exits 1; over the head's audio it passes, and ffmpeg decodes the four remuxed files to the same PCM
  and packets as before.
* **Revert and fail**, this check's own changes: 26 at the unit level, each putting one fix back as it was (9 from
  the slice, 17 from the review round), and 25 make their tests fail. The one that does not takes out the engine's
  immediate end of an earned play whose time ran out when a read fails: the engine makes the same check before its
  first try, half a second later, so only the timing changes and no test holds it (a gap in the tests, not in what
  the listener hears). In Chromium, 4 changes fail their checks: the World's mute put back on every Music song (3
  checks), the theme read before a tap (1), the dock's line taken from the artist (2) and the album sheet's chips as
  they were at `0e687e51` (2); putting back only the row's old spacing fails nothing, because the chips' own sizes
  keep them at 44 px. The tree was clean after each.
* **Suites**, one at a time: root suite 3,067 tests, 3,060 pass, 0 fail, 7 skipped; Worker suite 2,032 tests, 2,023
  pass, 0 fail, 9 skipped; the music workflow's test job, step by step, all pass; the peaks, artwork and container
  checks pass; the source map validator passes 2,966 of 2,966. In Chromium: background 138 of 138, and 136 of 138
  with Reduce Motion on (the two that do not pass are the album room's light, which Reduce Motion turns off by
  design; every M3 check passes); continuity 137 of 137; Now Playing 125 of 125; accounts 128 of 128; installed app
  246 of 246; native publication 49 of 49; direct checkout 40 of 40; the game hub's capsule passes.
* **Renders for Matthew** at device scale 2, kept with the workflow's evidence (not in the repository), each page
  checked to fit its width (37 of 37 checks): `album-390-past-locked-preview` (the closer's preview has ended, the
  line says the full song opens later, and the album plays on), `album-390-gate-row-guest` and
  `album-390-gate-row-member` (the closer's row says FULL SONG · opens later), `listen-390-reconnecting`,
  `listen-1280-reconnecting`, `album-390-reconnecting` and `album-1280-reconnecting` (the connection drops 5 s into
  the song and stays down: Reconnecting…, "The connection dropped at 0:05. Picking up there…", and Pause),
  `listen-390-picked-up` (the network is back and the song plays on), `listen-390-world-mute-stored-music-plays`
  (with the World's mute stored, the song plays with sound and no Unmute is needed), and
  `listen-390-music-muted-unmute`, `album-390-deck-muted-unmute` and `album-390-sheet-muted-unmute` (a muted Music
  song says Muted and shows its own Unmute).
* **What this check changed:** words only: in this record (the B-side's type on the wire, "identical" only in
  ffmpeg, the count of review findings, this section) and in `docs/music/MUSIC-WORLD-CONTINUITY.md` (the theme
  reads nothing before the Globe tap). No code changed.

**The ten findings that did not come to the review round**, in plain words. None stops the slice, and none was
changed here except in words:
* PB-R9 and RL-13 (nits): the remux's end padding; see item 7 above.
* PB-R10 (nit): because a finished song is counted before the next one starts (item 5), the next song's start can
  reach the server up to 5 s later. The shortest catalogue song lasts 65.7 s and counts after 62 s, so a finish
  slower than about 3.7 s on the wire would leave that next listen uncounted. Not seen in any run.
* PB-R11 (nit): after the closer's locked preview, CIA Mind Control goes on to its first song and keeps playing, as
  every album already does after its last song. Whether an album should stop at its end is Matthew's call.
* RL-7 (nit): details in this record: the B-side's type is corrected above. Of the 8 continuity checks that failed
  at the base, one existed before M3 and was turned round ("theme never replaces a completed preview": nothing
  played after the preview then, the queue's next song plays now) and one was rewritten (where the preview stops is
  now read at the engine's own pause), so not all eight are new checks.
* RL-8 (nit): `docs/music/MUSIC-WORLD-CONTINUITY.md`: corrected.
* RL-9 (nit): the listen engine's `music_error` and both players' `music_interrupted` are sent once per failed
  read, so one dropped connection can send up to six of each (the drop and five tries), with the error's code and
  the try's number. Neither is in the reviewed measurement dictionary yet.
* RL-10 (nit): a listener who kept Whip Equipped offline has the old `dealer-plates-b.mp3` in the vault; the album
  now plays the `.m4a`, so the B-side needs the network until the album is kept again.
* RL-11 (nit) and RL-12 (minor), both there before M3: "Enter Heal the 3rd World →" shows on every album, though
  the page means it only for Heal the 3rd World (its `display` overrides `hidden`), and at 390 px the fixed account
  chip covers its arrow while the link scrolls under the chip.

**Seen in this check's renders, there before M3:**
* The Music pages draw every cover in a square with `object-fit: cover` (the listen page's shelf, rows and mini
  player, the album's own cover and its deck bar), so a cover that is not square loses its sides: I AM HERE
  (1024 × 682), CIA Mind Control (544 × 246) and Whip Equipped (1280 × 890). M2 hands each cover to the lock screen
  whole; what iOS draws there is Inferred. Hard rule 10 says a cover is never cropped: the square versions only
  Matthew can supply (M2) would end it, or the pages can show each cover whole inside its square. His call.
* On the album at 390 px the line that says what a preview was (the page's toast, unchanged since the base) sits
  over the deck bar for its 3.4 s and hides the next song's title and time.
* On the listen page the middle button of the bar at the bottom keeps its play triangle while a song plays: only
  the album and the home page tell the bar what is playing. Tapping it there scrolls to the top; it does not stop
  or start anything.

**Device rows for Matthew**, in one place. None has been run; until they are, everything above about an iPhone or
an iPad stays Inferred. For each, note the page, a Safari tab or the Home Screen icon, signed in or not, and the iOS
version.
1. Listen page, phone locked: play a song near its end and wait: the next song starts by itself. Then two whole
   songs in a row with the phone locked: note the gap between them and the second song's title.
2. Album (I AM HERE), phone locked, Reduce Motion off: two whole songs in a row, noting the gap and the next title.
   Then the same with Reduce Motion on.
3. On both, from the lock screen: Next, then Pause, then Play. Each does what it says, the title changes with Next,
   and back on the page the same song shows.
4. CIA Mind Control signed in as the owner, phone locked: let Pull Up play to its end. The closer starts by itself
   once Pull Up is counted; note the gap. Its row says PLAY · owner. Signed out, or signed in as anyone else: the
   row says FULL SONG · opens later, the closer plays its 4-second preview, one line says the full song opens later,
   and the album goes on.
5. A drop: mid-song, phone locked, airplane mode on for 5 s, then off: the song plays on, or picks up at the second
   it stopped. Then 15 s: it says Connection lost, and Play picks it up there.
6. During Reconnecting…, press Pause on the lock screen, then on the album's bar and in the World: the music stays
   paused when the network comes back.
7. From the Home Screen icon, a drop: the dock says Reconnecting… and offers Pause.
8. On a Music page, tap the Globe and, while the World's own song plays there, press Mute on the bar. Back on
   Music, play a song: it plays with sound. Mute a Music song (on its page, or with the bar's Mute while it plays
   in the World): the Music page says Muted and shows its own Unmute.
9. Dealer Plates (B-Side) on Whip Equipped plays.
10. VoiceOver on the listen page during a drop: the line is read out.
11. A long song on cellular with the phone locked, then a whole album: note where anything stops.
The closer's full play inside its 300 s and 16-read allowance needs the master's real length and an authorized play
(above). Nothing here is labelled gapless.

## M3 follow-up (2026-11-23)

The findings from the review and the verification of M3 that did not come to the review round (PB-R9, PB-R10, RL-9,
RL-10, RL-11, RL-12, RL-13, V-2, V-3 and V-4) and the installed app's cut dock line, built on `5b549475`. Each was
reproduced at that base first (Chromium, every request a route fixture; the ledger on a disposable PostgreSQL 16
with the real migrations), its test was shown failing there, and then it was fixed. Nothing was merged, deployed,
enabled or applied, and no SQL or `supabase/` file changed. The decisions listed at the end are Matthew's; nothing
was built for them.

### What reproduced at the base

* **RL-12:** "Enter Heal the 3rd World →" showed on all seven other albums at 390 and 1280 px: the page marks it
  `hidden`, and `.alb__gate { display: inline-flex }` overrode that (242 × 50 px, under Play).
* **RL-11:** at 320 and 390 px the fixed Sign in / Profile chip covers the right end of that link while it scrolls
  through the chip's band (56 × 44 px at 320, 21 × 44 at 390; a tap there reaches the chip). The cover and the first
  row's heart pass under the same column.
* **PB-R9 and RL-13:** the four files M3 remuxed carry an edit list and no iTunes note; Chromium decodes 705, 119,
  679 and 713 more samples than from the files before M3 (the encoder's padding at the end).
* **PB-R10:** with the next song's start waiting up to 5 s for the previous finish, a finish 5 s slow on the wire
  left both songs uncounted on PostgreSQL 16: song A not completed (its finish came after B's start), and the
  shortest song as B (Towyard Killer, 65.7 s, counted after 62 s) credited 60.69 s.
* **RL-9:** one dropped connection on the listen page put three `music_error` and three `music_interrupted` on the
  wire (the drop and each failed try), and the album three `music_interrupted`; neither name is in the reviewed
  measurement dictionary.
* **RL-10:** with Whip Equipped kept before M3 (the B-side under its old name, `dealer-plates-b.mp3`), the album
  said "Finish the download (22/23)", and offline the B-side failed: the vault is keyed by address.
* **V-2:** the preview line (the album's toast) sat over the deck bar at 320, 390, 820 and 1280 px (at 390: the line
  674 to 748 px down the screen, the deck bar 691 to 765).
* **V-3:** on the listen page the bar's Music button (the red play and pause circle left of the M) kept its play
  triangle while a song played, and a tap scrolled to the top while the song played on; during Reconnecting… it
  showed Play and its tap did not stop the tries.
* **V-4:** taking out the engine's immediate end of an earned play whose time ran out left every test passing.
* **The installed app's dock** cut its second line: "Reconnecting…" needed 74 px of 73 at 390 and of 41 at 320;
  "Connection lost · tap play" 120.

### What changed

1. **The door shows only on its own record** (`album.html`): `.alb__gate[hidden] { display: none; }`; the page's
   own rule (a record with a gateway: Heal the 3) is unchanged.
2. **The account chip over the door (RL-11) is not changed**, and why: the chip is the site-wide account control,
   fixed top right on every page, and it covers whatever scrolls through its column (the cover and the first row's
   heart too). A fix in the album's markup alone would mean other words, or a link under 130 px wide at 320 (it is
   242) and under 200 at 390; left-aligned it still ends at 266 px, past the chip's left edge at 229. It goes to
   Matthew with the decisions below. (Corrected in the review round, "Review and fixes" below: that reason held only
   for a centred door or one held to one line; the door now keeps clear of the chip in the album's own CSS.)
3. **The four files are the files from before M3, with only their index moved in front of the audio**
   (`assets/audio/dealer-plates-b.m4a`, `deep-end.m4a`, `heal-the-3rd-world.m4a`, `you-the-feds.m4a`; the B-side
   from the bytes of `dealer-plates-b.mp3`, which stays for old links). Moved the way qt-faststart moves it: the
   same boxes byte for byte, the index the same size, only its chunk offsets moved on by the index's size, the
   iTunes gapless note kept and no edit list. ffmpeg decodes each to the same PCM and packets as before M3 and as
   M3; Chromium decodes exactly the samples it decoded before M3 (4,293,885, 7,305,033, 6,437,145 and 10,268,983,
   every one the same). The peaks changed only in their source hash; Deep End's length is 165.6 s again in
   `data/albums.json` and `workers/mccluster/src/music/tracks.js` (counted after 157 s, as before).
   `scripts/music-track-lengths.mjs` advises qt-faststart, not a remux, for a file whose index is at the end.
4. **The wait for the previous finish leaves the shortest song its margin** (`js/listen-ledger.js`). It is half the
   smallest margin in the catalogue, 1.85 s (Towyard Killer: 65.7 s, counted after 62 s, a margin of 3.7 s), and
   `scripts/music-track-lengths.mjs` writes it from the songs' own lengths (`--check` fails when it is stale).
   On PostgreSQL 16 with the real migrations and the real ledger: the DEL-4 order holds (start A, finish A, start B;
   A counted); with A's finish 400 ms slow both songs count; 2.5 s or 5 s slow, B's start goes after 1.85 s, B
   counts (63.86 s of 62) and A does not (its finish arrives after B's start). At 5 s the base lost both; at 2.5 s the
   base kept both. That is the balance this wait strikes: a finish may take 1.85 s, and the next song keeps 1.85 s of
   its margin for its own start's way to the server. The fixtures answer at once unless a test delays them; how long
   a finish takes on a real network is Inferred. (Changed in the review round below: one wait for every song cost the
   song just heard on every pair once its finish took more than 1.85 s; each song now waits half its own margin, 5 s
   at most.)
5. **No new event name leaves the browser until Matthew approves it, and an error is counted once.**
   `music_interrupted` waits in one place, `js/analytics.js` (`AWAITING_APPROVAL`, "waiting for Matthew's
   approval"); both players still name it, so approving it is deleting that one line (and reviewing it into the
   dictionary). `music_error` (sent before M3) goes out once per failed song or dropped connection, with the first
   failed read's code, however many reads fail after it and however often Play picks the song up; a later drop in
   the same song is a new one. On the wire: one `music_error` and no `music_interrupted` for a drop on the listen
   page; neither for a drop on the album, which never sent `music_error`.
6. **A copy kept under either name of the B-side counts, offline too** (`sw.js`, `js/label.js`, one table
   `SAME_AUDIO` in each): the worker answers `dealer-plates-b.m4a` from a copy kept as `.mp3` (and the other way
   round), labelled as the MP4 it is, ranges sliced as before; the album counts that copy as kept and downloads
   nothing again. A song not kept goes to the network as before.
7. **The preview line rises clear of the foot of the screen** (`js/label.js`): 8 px above the higher of the deck bar
   (where it rests, while it shows) and the tab bar (the installed app's dock), placed again when either moves or
   changes size while the line shows; with neither there it keeps its place.
8. **The bar's Music button on the listen page** (`js/music-engine.js`, `js/tabbar.js`). On `listen.html` only, the
   engine says what plays in the album's words (`mcc:nowplaying`, `{ title, href: "#np", playing }`) when that
   changes (play, pause, the end, another song; a song being picked up again is Pause, as on the mini player), and
   gives the bar the mini player's Play and Pause (`MCC_NP_PLAY`, `MCC_NP_PAUSE`) once a song is chosen or held. The
   bar's tab-on-its-own-page scroll now lets the Music tab through when the page gives it that transport, and with
   the World open or opening over the player the tab stays the way back to the music, never its Pause. With nothing
   chosen or held, and on the other pages that load the engine, nothing changes. (Since the review round below the
   tab's name says so too: "Pause music" or "Play music" where it is the player's transport.)
9. **A test holds the immediate end of a lapsed earned play** (verification V-4): a read that fails inside the play's
   last ten seconds ends it at once: Play ended, the right line, Play (never Pause), the lock screen not told music
   is wanted, no read and no second claim.
10. **The installed app's dock says why the music is quiet on a line of its own** (`js/installed-app-dock.js`,
    `css/installed-app-dock.css`): while there is something to say (Reconnecting…, Connection lost · tap play,
    Loading…, Could not load · tap play, Muted) the words run across the top of the dock, whole, and the controls
    keep their row at the bottom; the second line keeps the artist; the open button's label still carries the words.
11. **CI.** `music-platform-ci.yml` watches `sw.js`, `js/analytics.js`, the measurement dictionary and the two new
    tests; `music-contract` runs them. No new workflow and no new trigger.

### Tests: failing at the base, passing after

Every new test was run on `5b549475` with only the tests added (its sources untouched) and failed there, then passed
on the slice:

| Test | At `5b549475` | After |
| --- | --- | --- |
| `scripts/test/music-playback-races.test.mjs` (5 new) | 3 fail: six `music_error` for one drop; the listen page tells the bar nothing and gives it no Play or Pause. The earned-play test (V-4) passes there, as it should, and fails once the engine's immediate end is taken out | 59 of 59 |
| `scripts/test/listen-ledger.test.mjs` (1 new) | fails: the wait is 5,000 ms, not 1,850 | 6 of 6 |
| `scripts/test/music-track-lengths.test.mjs` (2 new) | both fail: no iTunes note, and no wait written from the catalogue | 6 of 6 |
| `scripts/test/music-measurement.test.mjs` (new) | both fail: `music_interrupted` goes out, and nothing holds it | 2 of 2 |
| `scripts/test/music-offline-vault.test.mjs` (new) | all three fail: offline the `.m4a` with a kept `.mp3` is "Failed to fetch" | 3 of 3 |
| `scripts/e2e/music-background.e2e.mjs`, the new and changed scenarios | 60 of 99 checks pass; the 39 that fail are this slice's (the wire's event names 3, the dock's line 12, the doors 14, the preview line 4, the bar's Music button 5, the kept B-side 1) | 212 of 212 for the whole suite |

**Revert and fail**, each on a scratch copy of the slice, one fix taken out at a time and the file put back by its
hash: all 10 unit-level mutations fail their tests (the wait back to 5 s, the wait not derived, the hold taken out,
`music_error` once per read again, the worker's and the album's same-audio tables emptied, the engine silent on the
listen page and talking on every page, the earned play's immediate end taken out, the four M3 remuxes put back: the
container test, `--check`, the peaks check and the vault's same-audio test all fail). In Chromium 9 changes: 8 fail
their checks (the door's `[hidden]` rule, the preview line's placing, the engine silent, the dock's own line, the
album's table, the hold, the bar's scroll taking the tap again, the World's tap reaching the Pause), and one fails
nothing: taking out the bar's own check for a World that is open or opening, because the World's own handler takes a
Music tap while it is open and the opening case is caught by the tap the bar marks; that check stays as a second
guard.

**Suites**, one at a time, on the final code: root suite 3,080 tests, 3,073 pass, 0 fail, 7 skipped; Worker suite
2,032 tests, 2,023 pass, 0 fail, 9 skipped (its music lengths were regenerated); the music workflow's test job step by
step, all pass; the peaks, artwork and track-length checks (with the ledger's wait) pass; the source map validator
passes 2,966 of 2,966. In Chromium: background 212 of 212; continuity 137 of 137; Now Playing 125 of 125; accounts
128 of 128; installed app 246 of 246; native publication 49 of 49; direct checkout 40 of 40; the game hub's capsule
passes. Every changed page fits 320 and 390 px (`scrollWidth === clientWidth`): the albums with and without the door,
the album with the preview line, the listen page, the installed app's dock with each of its lines. The ledger's order
on PostgreSQL 16 is item 4.

### What is Inferred

* Everything on an iPhone or iPad: that Safari honours the iTunes note again in the four files as it did before M3
  (gapless where it was); that WebKit's service worker answers the B-side from the old copy with its Range reads;
  where the dock's line and the preview line sit with the real safe areas and fonts.
* The finish wait on real networks: the fixtures delay one request at a time; how long a finish takes on a phone,
  and whether its slow moments come one request at a time, is not measured here.

### What waits for Matthew

Decisions, his alone; nothing was built for them:
* **PB-R11:** whether an album stops after its last song. Today every album goes on to its first song, CIA Mind
  Control after the closer's preview too.
* **V-1:** the three covers that are not square (I AM HERE 1024 × 682, CIA Mind Control 544 × 246, Whip Equipped
  1280 × 890) are cropped to squares on the music pages, and hard rule 10 says a cover is never cropped. Square
  artwork from him, or each cover whole inside its square: renders of today's crop beside the whole cover, nothing
  behind it, at 390 px, are kept with the workflow's evidence, not in the repository.
* **D-11:** whether the closer opens to signed-in members; it stays preview-only, and the gate's SQL is untouched.
* **D-7:** whether the World's mute stays the World's own (the default built in M3) or silences all music.
* **The earned play's allowance** (300 s, 16 reads): its length.
* **Approving `music_interrupted`** (reason, second, try, path): one line in `js/analytics.js`, and its row in the
  dictionary.
* **RL-11:** the account chip over the end of "Enter Heal the 3rd World →" at 320 and 390 px (item 2): a top band on
  the album the chip owns, the link set where the chip's column is clear, or as it is. (No longer open: the review
  round below sets the door clear of the chip's column; how it looks is his to judge, renders below.)
* **The ledger's wait** (item 4): 1.85 s keeps the next song's margin and lets a finish take 1.85 s; a slower finish
  costs the song just heard. The other balance is one generated number. (Changed in the review round below: each
  song's own half margin, with the figures and what a lost listen costs.)
* **M5 and later** (songs that end when a page is left, album intake): not in this slice.

Rows for his devices; until they are run everything here about an iPhone or iPad stays Inferred. For each, note the
page, a Safari tab or the Home Screen icon, signed in or not, and the iOS version.
1. Heal the 3 (Deep End, Heal the 3rd World), Whip Equipped (Dealer Plates (B-Side)) and CIA Mind Control (You the
   Feds), phone locked: each plays to its end and the next song follows; note any gap or click at the joins.
2. A phone that kept Whip Equipped before M3, in airplane mode: Dealer Plates (B-Side) plays, and the album says In
   your pocket.
3. From the Home Screen icon, a drop: the dock's top line says Reconnecting…, then Connection lost · tap play, in
   full; the dock's buttons stay where they were.
4. The listen page in a Safari tab: while a song plays the bar's Music button (the red play and pause circle left of
   the M; the M in the middle goes home) shows Pause; a tap pauses the song and another plays it; the page does not
   move.
5. The album: when a locked preview ends, its line sits above the deck bar, not over the song's title.

**Renders for Matthew** at device scale 2, kept with the workflow's evidence (not in the repository):
`album-390-no-door-cia-mind-control`, `album-390-door-heal-the-3` and the same two at 1280 (the door only on its own
record); `album-390-door-under-account-chip-unchanged` (RL-11, for the decision; superseded by the review round's
renders below);
`album-390-preview-line-above-the-deck` and `album-1280-preview-line-above-the-deck`;
`listen-390-bar-middle-button-pause` and `listen-390-bar-middle-button-after-tap`;
`installed-listen-390-dock-reconnecting`, `installed-listen-320-dock-reconnecting`,
`installed-listen-320-dock-connection-lost` and `installed-listen-390-dock-connection-lost`;
`album-390-whip-equipped-kept-in-your-pocket`; and for V-1, `covers-390-all-three` with one picture per cover. Seen in
them, there before this slice and not changed: at 390 px the album's deck bar and the tab bar under it overlap by
4 px (the deck bar ends 765 px down the screen, the bar starts at 761).

### Review and fixes

An independent review of the follow-up's head `2d162960` against `5b549475` found no blocker or major, three minor
findings (RF-1 to RF-3) and two nits. This round took the three minors. Each was reproduced at `2d162960` first (the
review's own PostgreSQL 16 driver and Chromium probe, run again here), given tests that fail at `5b549475` and at
`2d162960`, and fixed; none was set aside. The two nits did not come to this round: RF-4, "the bar's middle button" in
item 8 and in device row 4 is the bar's first button, Music, the red play and pause circle left of the M (the M in the
middle goes home); RF-5, on the album that same button still opens the shelf (`listen.html`), as it did before this
slice, while on the listen page it pauses.

| Finding | At `2d162960` (reproduced) | Now |
| --- | --- | --- |
| RF-1 | One wait for every song, 1.85 s. On PostgreSQL 16 with the real migrations and the real ledger, the song just heard was closed as unfinished whenever its finish took 1.9 s or more, whatever came next: the database saw start A, start B, then a finish that matched nothing. `5b549475` (5 s) kept both songs to a 4.0 s finish with Pull Up next. A completed listen is what answers the song test (`song_test_heard`) and earns the gated closer's play (the any-album-track gate; the sequence rule reads completions too), so a lost one costs those, not only a count | Each song's start waits for the last finish at most half its own margin (its length less the floor(length × 0.95) seconds the Worker needs to count it), 5 s at most. `scripts/music-track-lengths.mjs` writes the table into `js/listen-ledger.js` from the songs' own lengths, and `--check` fails when it is stale. Towyard Killer keeps 1.85 s, IOT (Draft) 2.05 s, Who Did The Shoot 3.4 s, Pull Up 4.2 s; nine songs with margins of 10 s or more wait the full 5 s; a song the table does not hold (the server counts no listen of it) waits 5 s. On PostgreSQL 16, with the song just heard's finish slowed from 0 to 5.3 s: Pull Up next, both songs counted to a 4.0 s finish and the song just heard lost from 4.3 s; IOT next, both to 1.9 s, lost from 2.5 s; Data Breach next (5 s, the wait every song had at `5b549475`), both to 4.3 s, lost from 5 s; Towyard Killer next, as at `2d162960`, lost from 1.9 s. The next song was counted in every run (Towyard Killer 63.9 of the 62 s it needs, Pull Up 146.28 of 142) |
| RF-2 | The fixed account chip covered the end of "Enter Heal the 3rd World →" while the door scrolled through the chip's band, at every width from 320 to about 590 px, not only the 320 and 390 the review measured (320: 56 by 44 px; 390: 21 by 44; 430, where the door sat beside Play: 79 by 44, the whole chip), and a tap there reached the chip. The reason item 2 gave held only for a centred door or one held to one line | On a phone the door has a line of its own at the hero's left edge, the edge the label rail under it keeps, and ends 104 px (the chip's widest) short of the hero's right edge. Below about 370 px its words take two balanced lines ("Enter Heal the" / "3rd World →"), so the arrow never sits alone. From 700 px it sits beside Play, as before. The same words and link, the album's own CSS only, the chip untouched. Scrolled through the chip's band 2 px at a time the two never meet: 25 px apart at 320 and 360, 45 at 390 |
| RF-3 | On `listen.html` the bar's Music tab played and paused the song, and a keyboard or a screen reader was told link "Music" (to `listen.html`) whatever it did; the play triangle and the pause glyph are drawn in CSS, which assistive technology does not read | Where the tab is the player's transport (on the page it points at, that page giving the bar its Play and Pause, no World open or opening over it) its name says what a tap does: "Pause music" while a song plays, "Play music" while it does not, the words of the installed app's dock and the World's transport. Everywhere else it keeps its own name ("Music"; on the owner's bar "Play: the player"). The tap and the name ask one test (`musicTabTransport`, `js/tabbar.js`). The World tells the bar when it opens or closes (`mcc:world-audio-open`, `js/world-audio-continuity.js`), before the focus lands back on the tab, and a World still opening renames it too. Enter on the focused tab pauses and plays; the focus stays and the page does not move |

**Tests, failing at `5b549475` and at `2d162960`, passing after.** The new and changed tests were run against both with
their sources untouched:

| Test | At `5b549475` | At `2d162960` | After |
| --- | --- | --- | --- |
| `scripts/test/listen-ledger.test.mjs` (3 new) | 1 fails: each song's own wait (Who Did The Shoot waited 5,000 ms, not 3,400). The 2.5 s case before Pull Up and the 5 s wait for a song the server does not count pass there, as the base waited 5 s for every song | all 3 fail (1,850 ms for every song) | 9 of 9 |
| `scripts/test/music-track-lengths.test.mjs` (the follow-up's wait test now holds the table) | fails (no `finishWaits`) | fails (no `finishWaits`) | 6 of 6 |
| `scripts/e2e/music-background.e2e.mjs`: the door and the chip (a new scenario, 11 widths and accounts, 6 checks each), the tab's name (6 checks added to the listen page's bar scenario; a new keyboard and World scenario, 7 checks; a new album scenario, 2 checks) | 54 of 82 checks pass. 28 fail: the door 17 (under the chip from 320 to 540 px; not on the rail's line under Play up to 640), the tab's name 5 of 6 and that scenario's 5 older checks (the base gave the bar no Play or Pause), and the keyboard scenario, which stops (the tab never becomes the song's Pause). The album's 2 pass, as they should | 62 of 88 pass. 26 fail: the door 17, the tab's name 5 in the bar scenario, and 4 of the keyboard scenario's 7 (Enter paused and played the song while the tab stayed link "Music"). The album's 2 pass | 88 of 88; the whole suite 293 of 293 |
| `scripts/e2e/music-world-continuity.e2e.mjs` (3 checks in its World-opening block) | stops at "after Stay in Music the Music tab is the player's Pause again" (link "Music") | the same | 140 of 140 |

Assertions changed because they held the reviewed behaviour: the follow-up's own wait test in
`music-track-lengths.test.mjs` asked for `finishWait()` and `var FINISH_WAIT_MS = 1850;`, and now asks for the table.

**Revert and fail.** Each fix was taken out on its own and its tests failed, the file put back by its hash after each:
6 changes at the unit level (the ledger as it was at `2d162960`; the table ignored, 5 s for every song; 1,850 ms for a
song the table does not hold; one hand-edited entry, which `--check` also refuses; the generator writing one wait for
every song; the generator without the 5 s cap) and 9 in Chromium (the door's rule as it was: 17 checks; without the
104 px reserve: 320 px signed in and out; without the 700 px rule: 700 and 1280; without the balanced lines: at 360 px
the arrow sat alone; the tab never named: 9 checks; the transport test without its page: the album's tab said Pause
music; closing the World telling the bar nothing; a World still opening, and one called off, not renaming the tab:
the continuity suite stops at each).

**Suites**, one at a time, on the final code: root suite 3,083 tests, 3,076 pass, 0 fail, 7 skipped; the music
workflow's `music-contract` job command by command, every one passes (races 59, gate and ledger 26, track lengths
`--check` and 6, the Worker's music gate 24 under its offline guard, peaks, accounts 15, Now Playing contract 19,
measurement 2, vault 3); python 7; the source map validator 2,966 of 2,966 (no file added). No file under `workers/`
changed, so the Worker suite was not run again. In Chromium: background 293 of 293 (the follow-up's 212 and this
round's 81); continuity 140 of 140; Now Playing 125 of 125; accounts 128 of 128; installed app 246 of 246; native
publication 49 of 49; direct checkout 40 of 40; site navigation 429 of 429; the game hub's capsule passes. Every changed
page fits the screen (`scrollWidth === clientWidth`): Heal the 3 at 320, 360, 390, 430, 480, 540, 640, 700 and 1280 px,
signed in and out at 320 and 390; the listen page with the tab named at 390, and at 320 in the installed app's checks.

**What is Inferred (review round).**
* What VoiceOver reads for the tab ("Pause music, link" is what Chromium's tree says) and whether it speaks the new
  name after a double tap.
* The door's two lines need `text-wrap: balance` (Safari 17.5 and later). Older Safari wraps them the plain way, as
  Chromium does with the balance taken off: "Enter Heal the 3rd" and "World →" at 320 and 340 px, and at 360 px the
  arrow alone on the second line. The door stays clear of the chip either way.
* How long a finish takes on a phone, so how often a song just heard still loses to the next song's start.

**What waits for Matthew (review round).**
* **The ledger's wait per song.** Each song keeps half its own margin for its start's trip, and the song before it may
  take that long to finish; a slower finish costs the song just heard its completed listen (its answer to the song
  test, and toward the closer's earned play); a longer wait would put the next song's own count at risk instead. The
  figures are in RF-1 above. The share (half) is his to move.
* **The door's place on a phone**: at the hero's left edge under Play, two lines below about 370 px. Renders below.
* Rows to add for his devices: 6. VoiceOver on the listen page with a song playing: the bar's Music button reads
  "Pause music"; a double tap pauses the song and it reads "Play music". 7. Heal the 3 on the narrowest phone he has
  (an iPhone SE is 320 px): scroll the door up under the Sign in chip; they never overlap, and the arrow stays with
  "World".

**Renders for Matthew** at device scale 2, kept with the workflow's evidence (not in the repository):
`album-320-door-heal-the-3`, `album-390-door-heal-the-3` and `album-1280-door-heal-the-3` (the page at its top; at 1280
beside Play, as before), and `album-320-door-clear-of-the-account-chip`, `album-360-door-clear-of-the-account-chip` and
`album-390-door-clear-of-the-account-chip` (the door scrolled up to the chip's band: side by side, never over each
other). Nothing else this round changed is visible: the ledger's waits and the tab's name are not drawn.

### Verification of the M3 follow-up (2026-11-23)

An independent check of the head `a34936ec` against `5b549475` and the reviewed `2d162960`, each in its own worktree,
with this check's own probes; nothing above was taken on trust. Nothing was merged, deployed or applied.

* **Each item, at the base and now** (Chromium, every request a route fixture, unless said):
  * The door: on all eight albums at 390 and 1280 px at the base; only on Heal the 3 now.
  * The door and the account chip, scrolled 1 px at a time through the chip's band at 17 widths and accounts from 320
    to 1280 px: under the chip from 320 to 540 px at the base (21 px of it at 390); never now (25 px apart at 320 to
    360, 45 at 390), with the same words and link, on two lines below 375 px and the arrow never alone.
  * The four files: `qt-faststart` run on the `b51ede03` files gives the head's four byte for byte; only the chunk
    offsets moved, each by the index's size; the iTunes note is the encoder's own and there is no edit list. ffmpeg
    decodes the same PCM and packets before M3, at M3 and now; Chromium decodes exactly the samples it did before M3
    (M3 had 119 to 713 more). Deep End is 165.6 s again (counted after 157 s).
  * The ledger on a disposable PostgreSQL 16 with the real migrations and each tree's own `js/listen-ledger.js` (the
    review's driver): with Pull Up next the song just heard counts to a 4.0 s finish (at `2d162960` it was lost from
    1.9 s); with Towyard Killer next it is lost from 1.9 s, the trade-off recorded above; the next song counted in
    every run, where `5b549475` lost Towyard Killer from a 4.0 s finish.
  * On the wire, one drop with every try failing: the base sent 6 `music_error` and 6 `music_interrupted` (11 and 11
    after Play) and the album 6 `music_interrupted`; now 1 and 0 (still 1 after Play), a missing file 1 and 0, the
    album 0 and 0.
  * The kept B-side, with the real `sw.js` on a local server: the base said "Finish the download (22/23)" and offline
    the B-side failed; now the album says In your pocket and the B-side plays offline from the kept `.mp3`, labelled
    `audio/mp4`, with no request reaching the server.
  * The preview line: over the deck bar at 320, 390, 820 and 1280 px at the base; now clear of the deck bar and the
    tab bar at each, in the installed app, after turning a 390 px screen to landscape, and at the real end of the
    closer's preview.
  * The bar's Music button on the listen page: at the base it never showed Pause, kept the name Music, and a tap
    scrolled to the top while the song played on; now it shows Pause and is named "Pause music" while a song plays, a
    tap or Enter pauses and plays without moving the page, a record held from another visit plays at its second, and
    with the World open it is named Music and goes back to the music. On the album it keeps its name and opens the
    shelf, as before.
  * The installed app's dock: at the base its second line cut "Reconnecting…" (74 px of 73 at 390, of 41 at 320) and
    "Connection lost · tap play" (120 px); now the words have a line of their own, whole at 320 and 390, above the
    controls, and the page's last words stay above the taller dock.
* **Revert and fail.** Ten fixes taken out one at a time at the unit level and six in Chromium: every one fails its
  tests, and the tree was clean after each.
* **Suites**, one at a time: root suite 3,083 tests, 3,076 pass, 0 fail, 7 skipped; Worker suite 2,032, 2,023 pass, 0
  fail, 9 skipped (this slice regenerated `workers/mccluster/src/music/tracks.js`); the `music-contract` job step by
  step, all 19 pass; the peaks, artwork and track-length checks pass; the source map validator passes 2,966 of 2,966.
  In Chromium, one at a time: background 293 of 293, and 291 of 293 with Reduce Motion on (the two that do not pass
  are the album room's light, which Reduce Motion turns off by design); continuity 140 of 140; Now Playing 125 of 125;
  accounts 128 of 128; installed app 246 of 246; native publication 49 of 49; direct checkout 40 of 40; site
  navigation 429 of 429; the game hub's capsule passes. The head's new unit tests fail where this record says: at
  `5b549475` twelve of them (races 3, ledger 2, track lengths 2, measurement 2, vault 3), at `2d162960` the review
  round's four (ledger 3, track lengths 1). The World guard in `js/tabbar.js` that the follow-up called a second guard
  no test held is held now: taken out, the tab's name is wrong with the World open or opening, and one background
  check fails and the continuity suite stops.
* **Words corrected here:** item 8, the base's V-3 line, the test table and device row 4 called the bar's Music button
  "the middle button" (review RF-4). It is the red play and pause circle left of the M; the M in the middle goes home.
* **Renders for Matthew** at device scale 2, kept with the workflow's evidence (not in the repository):
  `album-390-no-door-cia-mind-control`, `album-390-door-heal-the-3`, `album-390-door-in-the-chip-band`,
  `album-390-preview-line-above-the-deck` (the real end of the closer's preview), `listen-390-bar-music-tab-playing`,
  and `installed-listen-390-dock-reconnecting`, `installed-listen-390-dock-connection-lost`,
  `installed-listen-320-dock-reconnecting` and `installed-listen-320-dock-connection-lost`. Seen in them and there
  before this slice: the covers that are not square drawn square (V-1), the 4 px where the deck bar and the tab bar
  meet, and the dock's title and artist cut short.
* **Also his call:** on the album the same bar button opens the shelf and the album's song ends, as before this slice
  (review RF-5); whether it should pause the album's song there may belong with M5. In the installed app on the listen
  page the dock now holds two Pause buttons side by side, the bar's Music button and the dock's own (both named "Pause
  music", both pause the song); whether the Music button should stay the way to the shelf there is a design call.

## M5: one player across music pages (2026-11-23)

**D-5 (one long-lived player across music pages) is Matthew's decision, and he has not answered it.** This slice
builds the music map's recommended default on its working branch only, behind one switch (`ROUTES` in
`js/music-shell.js`); with every route off the site behaves as it did at `dc0185aa`, every music link a page load.
Nothing was merged, deployed, enabled or applied; no Worker, SQL, `supabase/`, auth or session code changed, and no
second backend, database, session store or player engine was added. Base `dc0185aa` (main `b51ede03` with M3 and the
M3 follow-up). This is item 2 of "Bounded finish order after this recovery" above.

### Why

Matthew, 2026-11-19: "when I'm playing music and I leave the browser, it stops playing music" and "The music never
plays fully through." Part of that was the site itself (the music maps' C1 cause 2, left to this slice by M1). At
`dc0185aa` every music link loaded a new document, and a new document cannot keep the old one's `<audio>` element; on
an iPhone it cannot start sound again without a tap either. Measured at the base (Chromium, every request a route
fixture): Listen playing -> an artist card stopped the song (Back: Listen loaded again, "Pick up at 0:02", nothing
playing); an artist page's release -> Listen stopped it and kept nothing; the album playing -> its comment box's Sign
in -> password sign-in brought the album back **paused**; the album -> the chip's Sign in landed on the World with the
song gone. Production aggregates (read-only, counts only, 35 days): album -> account 31 page views of which 29
followed a song started on the album; Listen -> album 88; album -> Listen 26; Listen -> artist page 3.

### Design and limits

The first music page a tab opens (Listen, an artist page, the album) stays the one document that plays: the
**retained document**. It owns every element that can sound, the one `js/now-playing.js` realm that speaks to the
device, the bar, the account chip, the installed app's dock and the history. The other music pages open over it as
**views**, each in a fresh same-origin `<iframe>`, one at a time: their own document, head, scripts and address, but
no music element, no Now Playing and no bar of their own. A play button in a view calls the retained player in the
same tap. The address bar shows the view's own address (`history.pushState`), so a share, a bookmark or a refresh
lands on that exact page, and Back and Forward move between views without reloading the retained document. It is the
Music-to-World pattern (`docs/music/MUSIC-WORLD-CONTINUITY.md`) taken from one cross-origin World frame to
same-origin music views.

| Stage | The retained document | Opens over it as a view | Everything else |
| --- | --- | --- | --- |
| 1 | Listen, an artist page (`music-creator.html?handle=` with a valid handle) | the other of the two; another artist | a page load |
| 2 | also the album (any `album`, `playlist`, `track`, `t`), playing through its own deck | Listen and the artist pages | another album, or the album from Listen or an artist page: a page load |
| 3 | (any of them) | `account.html`, signing in by password | Create account, Forgot password, a provider: a page load of the top |

What it never does, each held by a test: start, pause or mute anything when a view opens, switches, is revealed or
closes; render a page it did not expect inside its frame (`js/shell-boot.js` stops it before its body and the shell
routes it); show one page's identity under another's address (the live head follows the page shown, and the retained
page's own title, description, canonical, JSON-LD, `og:` and `twitter:` come back byte for byte on reveal; crawlers
load every address directly and never see a view); make the front page a view (hard rule 3).

Limits, as built:
* **The album as a view waits** (its player is the page's own deck, 1,800 lines inline). So Listen -> the album, the
  most travelled music link (88 page views in 35 days), is still a page load: from Listen or an artist page the
  album opens as itself, and the song stops there as before. The album as the retained document (stage 2) is built.
* **The other music pages are page loads**: catalogue, licence, music videos, PRIM3's artist page, Creator Studio, and
  every page outside music. So is a link from the World to an artist page or the album (the World's own rule).
* **What the web cannot keep** stays honest: a refresh, a link out of music, closing the tab or the system reclaiming
  it ends the document and the song, as before; Listen afterwards offers "Pick up at m:ss" from the banked record, and
  nothing claims the music carried on. The pocket (`js/pip.js`, `listener_state`) is still position recovery, not
  continuity, and is unchanged.
* **A provider sign-in** (none is switched on today) starts in the top window: it leaves the site and the song ends,
  by the providers' design. Create account and Forgot password are page loads of the top, as today.
* **A view scrolls inside its frame.** Whether Safari's toolbar shrinks and a tap on the status bar goes to the top as
  on the page itself is Inferred (device row 13).
* **While a view shows, a link the retained page builds from its own address** (the album's comment box `next=`,
  repainted on an account change) is built from the view's address shown in the bar. The person lands on the page
  they were looking at; the record says so because it is not the album's own address.
* **The back-forward cache** is not measured: this Chromium never restored a page from it. A restored retained
  document is handled as a Back (`pageshow` with `persisted`); that is Inferred.

### What changed

1. **`js/music-shell.js` (new): the retained document and its views.** The routes and their one switch (`ROUTES`);
   where a link goes, seen from the page shown (`decide`: the page's own, a scroll to the top, a reveal of the
   retained page, a view, the World, or a page load); the history it writes (only the retained document writes
   entries: a view's own `pushState` and `replaceState` become the top's; `scrollRestoration` is manual while a view
   shows); a fresh frame per view, its address set before it is inserted, the frame shown kept until the new one has
   painted (the one opening carries its own id until then: one element per id), never more than one view frame when
   a switch is done; the retained page under a view hidden and inert except an allow-list (the bar, the chip, menus,
   the engine's mini player and Now sheet, the album's deck bar, sheet, status line and toast, the World's frame and
   transport, the privacy notice), its scroll kept; the live head (title, description and canonical follow the view
   and are gone when it has none; the retained page's JSON-LD, `og:` and `twitter:` are held aside; a title the
   retained page writes while covered is kept for its reveal, one the World writes is not); focus on the view's heading
   (without the ring and glow of a control: it is not one) and back on the link that opened it, and the page's name said
   once in a polite live region; a view that does not
   open in 8 s, or a document it did not expect (the service worker's offline `index.html`), shows a card with Open
   the page and Back, and says "Your music is still playing." only when it is. The view agent routes the view's own
   links through the same table, follows its in-page history, mirrors the bar's owner flag (`data-appbar-admin`, the
   creator review offer reads it) and gives the view the retained bar (`MCC_BAR`). The view's API
   (`MCC_MUSIC_VIEW`): the retained engine, `navigate`, its referrer, the page it is, and events from the top.
2. **Stage 2, one owner of sound in the album document.** Over the album the engine is loaded beside the deck as a
   guest (`MCC_MUSIC_GUEST`: no restore of its own banked song, and it banks only while it owns the sound). A song
   chosen in a view pauses the deck through the album's own Pause (`MCC_NP_PAUSE`) before the engine plays; a row
   played on the album pauses the engine. `html[data-music-owner]` shows only the owner's bar (the deck bar or the
   mini player); the pocket holds the owner's song; the World's transport acts on the owner.
3. **`js/shell-boot.js`**, the first script in every music page's head: in the shell's own frame only (its frame
   element, checked by identity), a page with `<html data-music-view>` is adopted before any other script runs and its
   own bar, chip, pocket and privacy bar are hidden before first paint; any other document there is stopped
   (`window.stop()`) and handed back to the shell. The World's frame (another origin), Control's front-page preview and
   every embed are left exactly as before.
4. **`js/music-engine.js`**: in a view, a view mode: no `Audio`, no player, no Now Playing binding, no bank; a frozen
   `MCC_MUSIC` that calls the retained engine, and a capture handler that calls it inside the tap (WebKit's gesture
   rule; Chromium passes a tap to its parent frames anyway). A song carries the page it was chosen on (`mcc_chosen_on`)
   into its music events; outside a view nothing changed.
5. **`js/tabbar.js`**: a view builds no bar and loads no World module; the retained document loads the shell. The
   bar's tabs stay the bar's (a hold opens a wing, a held slot shows its card, the Music tab goes to the shelf); when
   the bar goes somewhere it asks the shell first (an artist view's Music tab reveals Listen, the album's opens Listen
   over it); over a view the Music tab is never the player's Pause. On the album the bar's Music button used to open
   the shelf and end the album's song (the M3 follow-up left that to M5, review RF-5); it now opens Listen over the
   album and the song plays on.
6. **`js/analytics.js`**: the page a document is, fixed when it loads, so the retained page's events (a song ending,
   its dwell) are never filed under the view's address or creator_handle; a view's referrer is the page it was opened
   from, after Back and Forward too; a song's events are filed on the page it was chosen on; the retained page's dwell
   stops when a view covers it and starts again when it is revealed. Consent works as before: nothing is sent from
   either document without it. Outside music the pages that rewrite their own address keep its path (the World's
   mission addresses stay on `/mnet.html`, Control's routes are hashes, the World over a music page keeps that page's
   path), so their events read as before. The one difference: a World document served at a host's root (the design
   for `mccluster.org`) that later writes `/mnet.html` into the address now files its later events under the path it
   loaded at, as its first events already were.
7. **`js/pip.js`** mounts no pocket in a view, and **`js/world-audio-continuity.js`** does nothing in one; over a view
   the World opens from the retained document at the view's address with `world=1`, and closes back onto the view
   with the view's title.
8. **Signing in over the music** (stage 3): `account.html` opens as a view on the password path, its own page and
   calls (the same token, user and bootstrap calls and the same storage keys as on the page itself). A provider starts
   from the top window (`account.html`: the same redirect, verifier and return; a provider page is never framed). The
   shell gives a sign-in link without `next`, opened from a music page, that page as `next`, so the person comes back
   to the music (a default for Matthew to confirm; today the chip's sign-in lands on the World).
9. **`album.html`, `js/chamber.js`**: the album's room light and chamber stop drawing while a view covers them and
   start again on reveal; the deck plays on.
10. **`js/music-creator-profile.js`**: checkout (another origin) from a view is a page load of the top.
11. **Markers**: `listen.html`, `music-creator.html`, `album.html`, `account.html` say which page they are on `<html>`
    (`data-music-view`), one attribute each. Their heads are otherwise unchanged (metadata, `@id`s and canonical
    untouched); the other changes in those pages are in body scripts: `account.html`'s provider line and `album.html`'s
    room light.
12. **`css/music-shell.css` (new)**, phone first, `min-width` only: the view layer inside the top's safe area under
    the bar, the mini player, the deck bar and the chip; the failure card's buttons at least 44 px with
    `max(16px, 1rem)` text.
13. **CI.** `music-platform-ci.yml` watches `js/shell-boot.js`, `account.html` and the two new tests; `music-contract`
    parses the shell and runs `scripts/test/music-shell.test.mjs`; `browser` runs `scripts/e2e/music-shell.e2e.mjs`.
    No new workflow and no new trigger.

Where the code departed from the spec (the code wins, as the slice asked):
* The bar's Music tab and its tab-on-its-own-page logic read `location`, which after `pushState` is the view's
  address; they follow the view without new code. Over a view the Music tab is the way back to Listen, never the
  player's transport (the spec left it a transport).
* The creator review offer reads the bar's owner flag on `<body>`; a view has no bar, so the agent mirrors the flag
  into the view (the spec had no such step).
* Signing out on the account page reloads that page; the shell accepts a reload of the view it shows at the same
  address (the spec adopted only the frame it was opening).
* The account page's onward step after a sign-in replaces its own address; the shell gives it replace semantics, so
  Back after a sign-in does not return to the sign-in form.
* The album's rows carry no `data-music-play`, and Listen's cards wrap their play buttons in links; the agent leaves
  clicks inside `[data-music-play]` to the engine's view mode.
* The spec named the frame `#mccMusicViewFrame`; the frame still opening carries `#mccMusicViewNext` until it has
  painted, so two elements never share an id.
* The failure card says "Your music is still playing." only when something plays.
* Links on the retained page itself that point at the page shown, or at the retained page, act as today unless a view
  shows (scroll, or reveal).

### Tests: failing at the base, passing after

Every new test was run on `dc0185aa` with only the tests added (its sources untouched), in a worktree made for it
and removed after:

| Test | At `dc0185aa` | After |
| --- | --- | --- |
| `scripts/test/music-shell.test.mjs` (new, 17) | 16 fail: no shell, no route table, no live-head handling, `js/shell-boot.js` adopts nothing, the engine makes its own `Audio` in a view and names no chosen-on page, the pocket mounts in a view, the World module greets a view, analytics files the retained page under the view's address, no markers. The one that passes is the control: the engine outside a view still makes its one `Audio` and binds Now Playing | 17 of 17 |
| `scripts/test/music-background.test.mjs` (1 new: the lifecycle guard) | passes, by design: with no shell there is nothing to guard. It fails once a pause is put into the reveal (revert proof R18) | 10 of 10 |
| `scripts/e2e/music-shell.e2e.mjs` (new: the 26 acceptance tests of the spec in 26 scenarios, Chromium) | 9 of 44 checks pass: the guards that hold today too (links that leave are page loads, a refresh is honest, the address after a tap, a held Music tab opens no view); 35 fail, 22 of them whole scenarios that wait for a view that never opens | 141 of 141 |

One existing test changed, deliberately and as little as it could: `scripts/test/signup-authority.test.mjs` pins
the text of `account.html`'s provider call, and now also accepts the same call made on the top window's client in a
music view, with the same redirect (`/auth/?next=` back to the account page). The new pattern matches the call at
`dc0185aa` and the slice's, and refuses a wrong redirect; 9 of 9 at the base and at the head.

**Revert and fail.** 28 behaviours taken out one at a time on the slice, each file put back by its hash after (the
tree's hash checked equal after every pass), each run against the tests that hold it: every one fails a test. They
are: the shell never loaded; any frame adopted; no `window.stop()`; no engine view mode; a tap reaching the engine a
turn late; a pocket in a view; the World module in a view; analytics reading the live address; a view's referrer its
own; no chosen-on page from the engine; the held head not put back; JSON-LD not held aside; the head never mirrored; a
new view reusing the old frame; the Listen song taking the sound without the album's own Pause; a provider starting in
the frame; a sign-in without `next` not coming back; a reveal that pauses (the lifecycle guard); the deck bar
concealed; the artist page's checkout navigating the frame; the album without its marker; the covered page not inert;
Back and Forward not followed; the bar's Music tab a transport over a view; the bar's tabs not asking the shell; the
shell taking the bar's own tabs; and the view heading drawn with a control's focus ring, and with its glow. The first
pass caught 20 of 25: five behaviours were held only in the browser or only in Node, or not at all (the engine's
chosen-on page, JSON-LD on Listen which has none, `inert` behind `visibility: hidden`, the Music tab over a Listen
view, the bar's hook behind the shell's own click handling). Each got a test that holds it, and the last showed a
defect, fixed in this slice: the shell's click handling took the bar's own tabs before `js/tabbar.js` (a held wing
slot's click became a navigation, and the bar's rule that its Music tab goes to the shelf was bypassed). The bar's
tabs are now the bar's, and the bar asks the shell when it goes somewhere. The last two came from the renders: the
Listen heading over the album showed the house focus ring and its glow (`js/masthead.js`'s `:focus-visible` rule). The
heading now takes the focus without either, and the check that holds it is in the album scenario, where
`:focus-visible` applies; after a pointer tap on a card it does not, so the same check after an artist card passes
either way.

### Suites at the final code

One at a time and at low priority, Chromium only, every browser run holding the one browser lock:
* **The music job's commands** (`music-platform-ci.yml`, `music-contract`): every parse passes; music platform 21 of
  21, release submission 7 of 7, Control music review 17 of 17, playback races 59 of 59, background contracts 10 of
  10, gated audio and the listen ledger 26 of 26, track lengths (`--check`, and 6 of 6), the Worker's music gate 24 of
  24, peaks (`--check`, and 6 of 6), accounts 15 of 15, artwork `--check`, the Now Playing contract 19 of 19,
  measurement 2 of 2, the offline vault 3 of 3, the music shell 17 of 17. No file under `workers/` changed, so the
  Worker's own suite was not run beyond that gate test.
* `scripts/test/domain-architecture.test.mjs` 7 of 7; `scripts/test/signup-authority.test.mjs` 9 of 9.
* **Root suite** (`node --test scripts/test/*.test.mjs`): 3,101 tests, 3,094 pass, 0 fail, 7 skipped.
* **Source map validator** (the building source map's repository check): 2,966 of 2,966 checks pass (767
  candidates); its generated coverage report is unchanged.
* **Browser suites**: the music shell 141 of 141; background 293 of 293 in three of four full runs at the final code,
  291 of 293 in the other (below); Music to World 140 of 140; Now Playing 125 of 125; accounts 128 of 128; installed
  app 246 of 246; native publication (Control's music review) 49 of 49; direct checkout 40 of 40; site navigation 429
  of 429; the game hub's capsule passes; and, because the World loads `js/tabbar.js`, `js/analytics.js` and its music
  code too, the bar's sign-in refresh passes, the World's guest travel 151 of 151 and its first visit (analytics off
  until the visitor agrees) 83 of 83.
* **320 and 390 px**: every view (Listen over the album, the account page over the album, Listen over an artist page)
  and every top page fits with no sideways scroll (`scrollWidth` equals `clientWidth` in the top and in the view), and
  the failure card's buttons are at least 44 px (shell scenarios s12 and s24, with 820 and 1280 px too).

**Two background checks that did not always hold.** In one full run at the final code the bar's Music tab on Listen
was still named "Play music" while the song played, after Enter started it again and after the World closed over it
(one run before the last change missed the second of these only). They are two checks of the M3 follow-up's RF-3
scenario (`js/tabbar.js` names the tab from `mcc:nowplaying`). The scenario opens no view; on its path the lines this
slice added only ask whether a view is open (`js/tabbar.js`) and which page a song was chosen on
(`js/music-engine.js`), and change nothing there. It happens at `dc0185aa` too: run alone, alternately, it failed 1 of
11 runs at the base and 1 of 10 at the head. In the full suite the head failed it in 2 of 5 runs and the base in none
of 5 (four here, one in its own verification), so these counts do not settle whether the shell's extra script on
Listen makes it likelier. It is left as found.

### What is Inferred

* Everything on an iPhone or iPad. That WebKit lets a play started inside a view's tap reach the retained document's
  element (the design calls it in the same tap, WebKit's gesture rule); that the audio session, the lock screen and
  Control Center keep one card across views; that Keychain AutoFill and the keyboard behave in the account view as on
  the page; how VoiceOver reads a view opening and Back; how a page scrolling inside a frame feels in Safari; memory
  with one view frame on an older phone; the back-forward cache.
* Real networks: the fixtures answer at once unless a test delays them; the 8 s before the failure card is a
  judgement, not a measurement.

### What waits for Matthew

Decisions, his alone; the defaults built are marked:
* **D-5:** keep the retained music document (built on the branch, the map's recommendation) or stop it. One switch
  turns it off.
* **Sign-in from a music page:** come back to the music (built) or keep landing on the World as today.
* **The album as a view** (Listen -> album, the most travelled link): move the album's player into the retained
  document in a later slice.
* **Listen songs over the album:** a song chosen on Listen while the album is the retained document plays in the same
  page, the engine beside the deck, one playing at a time and one bar showing (built). Is that how they should share?
* **Which routes next:** catalogue, licence, music videos, PRIM3's artist page, Creator Studio; the house's other pages
  (never the front page).
* **Provider sign-ins** (none on today): one switched on leaves the site and the song ends.
* **The account chip over the Now sheet's Album link** on a phone (a tap there opens Sign in), seen while measuring.
* **Links from the World** to an artist page or the album still leave the music.
* **The bar's Music button on the album** (the M3 follow-up's RF-5, his call): it now opens Listen over the album with
  the song playing on (built); whether it should be the album's own Pause there instead is still his to say.
* **Creator cards with no artwork** (seen in the renders; there before this slice and untouched by it): Listen's "From
  creators" card crops the house mark under the release's title. What such a card should show is his to say.
* **The bar's Music tab name on Listen** (the M3 follow-up's RF-3) is now and then still "Play music" while a song
  plays; intermittent, and seen at the base too (below). A fix belongs with that code, in a slice of its own.

Rows for his devices; until they are run everything here about an iPhone or iPad stays Inferred. For each, note the
page, a Safari tab or the Home Screen icon, signed in or not, and the iOS version.
1. iPhone, Safari: Listen, play a song, open an artist page, go Back, go Forward. The song never stops; the lock screen
   keeps its title.
2. The same with the phone locked between steps (unlock, switch page, lock again): the song continues.
3. In an artist page opened from Listen, tap another song: it starts on the first tap.
4. Album (I AM HERE) playing: tap Music in the bar; browse Listen; Back to the album. The song never stops; the deck
   bar stays at the bottom over Listen.
5. Album playing: scroll a long Listen view and an artist view for a minute; nothing reloads by itself (memory).
6. Album playing: Sign in from the comment box with your password (Keychain AutoFill if you use it): the song keeps
   playing while you sign in and after.
7. The same from the chip at the top right; then the keyboard and AutoFill behave as on the account page itself.
8. Lock screen and Control Center during each of the above: one song, previous and next work, no second card.
9. From the Home Screen icon: rows 1, 4 and 6; the dock keeps the song.
10. iPad, Safari: rows 1, 4 and 6.
11. VoiceOver: open an artist page from Listen: it reads the page's name and lands on its heading; Back returns to
    where you were.
12. Refresh on an artist page reached from Listen: the song stops (expected); Listen afterwards offers "Pick up at".
13. On an artist page opened from Listen, scroll a long page: does Safari's bar shrink as on the page itself, and does
    a tap on the status bar bring you back to the top? (The page scrolls inside its frame; say if it feels different.)

### Screenshots for Matthew

Rendered in Chromium at device scale 2 by the e2e's render mode (`MUSIC_SHELL_RENDER=<folder> node
scripts/e2e/music-shell.e2e.mjs`), every request answered by a route fixture ("Probe Artist" and "Second Artist" are
fixtures); kept with the slice's results, not in the repository. Each at 390 px and at 1280 px:
* `listen-*-playing`: Listen, "Who Did The Shoot" playing.
* `artist-view-over-listen-*-song-plays-on`: an artist page opened from Listen; the mini player still shows the song and
  its clock moves.
* `listen-*-back-song-plays-on`: Back on Listen, the same song still playing.
* `album-*-playing`, `listen-view-over-album-*-deck-plays-on`, `listen-view-over-album-*-listen-song-owns-the-bar`,
  `album-*-back`: the album playing "Runway Walk"; Listen over it with the deck bar on top and the song moving; a Listen
  song taking the sound (the deck paused, one bar showing); Back on the album.
* `account-view-over-album-*-deck-plays-on`: the sign-in page over the album, the deck playing.
* `failure-card-390`: a view that did not open: "Open the page", "Back", and "Your music is still playing."

Art direction: the Listen heading over the album first showed the house focus ring and glow (fixed, above). Seen and
not changed, because it was there at `dc0185aa` and lies outside this slice: a creator release with no cover and no
avatar takes the house mark (`assets/img/m-mark.png`) as its card art (`js/music-engine.js`), and Listen's "From
creators" card crops the mark and sets the release's title over it, at 390 px and at 1280 px. The logo law says the
mark is shown whole, scaled, or not at all; what such a card should show instead is Matthew's call.

## Quick wins (2026-11-23)

Seven small things Matthew asked for on 2026-11-23, built on the working branch only, at base `5d8c533e` (the
branch after M5). Nothing was merged, deployed, enabled or applied; no SQL, `supabase/`, auth or session code
changed, and no second backend, database, Worker, auth or player engine was added. The one file under `workers/`
that changed is the measurement dictionary (two rows, below). The gate's SQL is untouched, and no production data
changed or needed to: the one McCluster artist row the pages point at is already there (read-only check below).

### Matthew's words

* **Q1** "McCluster has two profiles. One says the house, one says the artist. It needs to be one profile. McCluster
  is the artist."
* **Q2** "the albums need to be just fucking albums, and the playlist... We don't have enough music to necessarily
  even have playlists right now. So just list albums and artists right now."
* **Q3** "The full covers aren't shown, and I agree. We should fix that." "as long as everything's uniform" (V-1 in
  the M3 follow-up's list).
* **Q4** "The shit should know whether you have a creator's account or not already."
* **Q5** the closing song of CIA Mind Control: "We keep the song up, but it won't play... it'll tell you why it won't
  play when you try to click play." (D-11 in the M3 follow-up's list.) This record calls it the closing song and
  never writes its title.
* **Q6** "end of the album, and just leave" (PB-R11 in the M3 follow-up's list).
* **Q7** "For 6, I approved them": item 6 of the M3 follow-up's list, `music_interrupted`, and with it the song that
  would not load, `music_error`.

### What reproduced at the base

Measured at `5d8c533e` in Chromium over the music accounts plane (`scripts/e2e/support/music-accounts-plane.mjs`,
every request a route fixture, every song a short synthetic WAV), and in Node:
* **Q1** Listen's Artists rail showed McCluster twice: "McCluster · The house" (the M mark, a link to the house's
  root, `index.html`) and the directory's "McCluster @mccluster", whose artist page said "No published releases yet".
  The album's byline and the Now sheet credited "Matthew McCluster" and linked to `matthew-mccluster.html`; the lock
  screen said "Matthew McCluster" on every player that falls back to the house's artist.
* **Q2** Listen showed Artists, Albums and "Everything" (every song as a list) under a filter row; the album page had
  its own filter row, a playlists shelf and "Curated by the house" over the albums, and its kicker read "The album ·
  6 tracks · good evening". An old `album.html?playlist=` link stayed on a playlist page.
* **Q3** No cover was whole: every music surface drew its cover with `object-fit: cover` or a `cover` background, cut
  its corners (2 to 20 px), set it on a plate (three dark browns) and, on the album's hero, under a shadow; the Now
  Playing sheets showed a blurred copy behind it and a poster box; the album's living sleeve drew a cropped copy of
  the cover with a glow and fog over it; the embedded player cropped it at 12 px corners; an artist page with no
  banner set a cropped cover as its hero backdrop. CIA Mind Control's cover (544 × 246) lost most of its width.
* **Q4** The offers by state already held on Listen, an artist page's foot and Creator Studio for every persona,
  fresh and after the token's hour. Two things did not: Listen kept the join pitch ("For artists & creators / Put
  your music in the same ecosystem people are listening in.") beside a creator's and the owner's "Open Creator
  Studio" (fresh, after the token's hour, and right after a sign-in in another tab); and the World's member desk
  treated any failed or early answer about creator state as "not a creator", so it offered "Become a creator" to a
  creator and to the owner whenever that answer failed or came before the token's refresh.
* **Q5** The closing song's row carried its preview address. A guest's tap played the preview (8 reads of it); Next
  and the album's own advance reached it; the lock screen named it. A signed-in member's play asked the gate 5 times
  and posted the listen ledger 12 times. The listen engine played it too (5 reads). The house owner's own play
  worked.
* **Q6** The album went on from its last song to its first (Heal the 3: Deep End read again), and Next on the last
  song did the same. The listen engine ran on into the next album on the shelf.
* **Q7** `music_interrupted` was held in `js/analytics.js` (`AWAITING_APPROVAL`) and never sent; neither name was in
  the measurement dictionary. The players named a drop on every failed read (the album up to six times a drop).

Read-only in production (counts and catalogue rows only, no person): one active artist profile with the handle
`mccluster` and the artist name McCluster (no releases, no albums, no avatar); no published creator tracks; the
closing song has one direct-sale offer, inactive (matched by hash, so its title is not written here); the reviewed
event taxonomy lists neither `music_interrupted` nor `music_error`.

### Readings made here (Inferred, his to correct)

* "The house" in Q1 is Matthew's house, the personal property's root that the rail's card opened, standing in as a
  second McCluster beside the artist. It is not McCluster Corp, and nothing about the company changed: the two
  entities stay two, and the property's own titles, descriptions and structured data, which are Matthew-first by the
  domain rules, are untouched.
* "McCluster is the artist": the one card is McCluster, Artist, and opens McCluster's artist page
  (`music-creator.html?handle=mccluster`), which now carries his albums from the catalogue and keeps the house's M
  in the bar's middle (he is the house's own artist, so his page is not a guest perspective).
* Q2's "right now": the song rails and the Everything list are switched off in one place (`SONG_RAILS` in
  `js/listen.js`), not deleted, so they can come back when there is more music; a search still lists songs.
* Q5's account states: a guest is asked to sign in; a signed-in member is told the song plays only for members who
  complete their full profile and answer a short questionnaire, and that the questionnaire opens soon. Nothing is
  collected: there is no questionnaire yet, and the pop-up only links to sign-in or the profile.

### What changed

* **Q1, one McCluster.** Listen's Artists rail has one McCluster card (the M as supplied, "McCluster", "Artist") that
  opens his artist page; the directory's own row for him is not drawn a second time (`js/music-community.js`). His
  artist page shows his albums from `data/albums.json` (each a link to the album), keeps the house in the bar, and
  falls back to a built-in profile when the row is missing (`js/music-creator-profile.js`, `music-creator.html`,
  `css/music-artist.css`); opened as a view over Listen, it passes the house up to the bar, as an artist page passes
  up any other artist (`js/music-shell.js`; found by the door suite). The album's byline and Now sheet credit
  McCluster and link to that page (`album.html`); every player that falls back to the house's artist says McCluster
  on the lock screen: the listen engine, the World's soundtrack, the pocket, the embedded player, the music video
  feed and a shared album link (`js/music-engine.js`, `js/world-audio-continuity.js`, `js/pip.js`, `embed.html`,
  `music-videos.html`, `js/label.js`; the music video feed was found by the Now Playing suite). The credit lines on
  Listen and the album read "Written & performed by McCluster".
* **Q2, albums and artists.** Listen: Artists and Albums, no filter row, no song rails, a song list only for a search
  (`listen.html`, `js/listen.js`). The album page: no filter row, no playlists, "Albums" over the shelf, and the
  kicker "Album · 6 songs" (`album.html`); it no longer reads `data/playlists.json`. An old playlist link lands on
  the Listen page, or on the music videos page for the two film playlists. Every album stays one tap away.
* **Q3, whole covers.** One rule in `css/music-system-v2.css` ("WHOLE COVERS") for every music cover: the whole
  artwork scaled inside its square (`object-fit: contain`, centred), nothing behind it, no corner cut, no shadow, no
  filter. It covers Listen's shelf, the album's hero, rows and deck bar, the mini player, both Now Playing sheets,
  the artist page (album, cards, rows), the catalogue's shelf and creator releases. The album's Now sheet shows the
  cover itself when a song has no film; the blurred copy behind the Now Playing cover is gone; the living sleeve is
  no longer mounted on the album, and `js/env.js` is loaded by no page now (the file stays); the embedded player
  shows its cover whole; an artist page's hero is a banner or an avatar, never a cropped cover. No artwork file
  changed and nothing was drawn: the supplied covers are only scaled. The review round below brought in the album
  page's own shelf of albums (QW-R1) and the pocket, the corner player of the other pages (QW-R2).
* **Q4, a creator is never asked to join.** Listen's Creator Studio box answers by account: the join pitch for a
  guest (Sign in) or a member (Become a creator), "Creator Studio" with "Open Creator Studio" for a creator or the
  owner, and nothing at all until the account is known (at most 6 s); it follows a sign-in elsewhere and the token's
  refresh through the shared account (`listen.html`, `js/creator-onboarding.js`). The World's desk asks the server
  and believes only its answer: creator, not a creator, or not known, and "not known" offers nothing
  (`js/member-desk-core.js`, `js/member-desk.js`). No second auth.
* **Q5, the closing song is held.** `data/albums.json` marks it `"hold": "profile"`; it stays listed, last on the
  album. Its row carries no source and no preview address, so nothing reads either; its chip says "NOT YET, tap to see
  why". A tap, Next, or the album or the listen engine reaching it opens one pop-up by account state
  (`js/gated-audio.js`: `holdDecision`, `holdCopy`, `holdNotice`; `css/music-system-v2.css`): "Why this song won't
  play", with Sign in (back to the album) for a guest, "Complete your profile" for a member, and Close; Escape and a
  tap outside close it. A guest is not asked over the network at all. A tap on it never stops what is playing;
  Next or the album's own advance moves on past it, or stops when it is the last song (it is). The house owner's own
  play is his unchanged path: the gate answers operator, one claim, the master. The pocket, the embedded player and
  keeping an album offline never take it (`js/pip.js`, `embed.html`, `js/label.js`), the direct checkout never puts
  a buy button on its row (`js/music-direct.js`), and the M5 shell keeps the pop-up when a view covers the page
  (`js/music-shell.js`). For the pocket that held only for its stepping from song to song: the review round below
  found a record of the song, banked before the hold, still mounting there, and a link to the song seating it in the
  album's deck. Neither does now (QW-R3, QW-R6).
* **Q6, an album stops after its last song.** The album: after the last song it stops there, paused at its end, the
  lock screen paused; Next on the last song stops it at the end; Previous on the first starts it again; Play at the
  end starts the last song again (`album.html`). The listen engine's queue is the record (an album, or a creator's
  release) and it stops at the record's end the same way (`js/music-engine.js`). Two things the M5 shell suite caught
  in the first build, both fixed with a test that failed before the fix: the end of a record is where the listener's
  song ends, so a guest's 30-second preview of a creator release's last song stops the record at the preview's end,
  never past it, and Play there starts the preview again (the first build sought to the end of the whole file, past
  the preview, and the preview ended twice); and a creator's songs that Listen's "From creators" row listed before
  their artist page listed them again with their release stay one record (the first build read the record from the
  older listing for the queue and the newer one for the song that played, and Next stopped at once). The pocket and
  the embedded player stop at a record's end too. The World's soundtrack keeps its own rotation, unchanged.
* **Q7, the approved events.** The hold in `js/analytics.js` is gone. `music_interrupted` and `music_error` are rows
  in the measurement dictionary, with what they mean and who sends them
  (`workers/mccluster/src/analytics/measurement-dictionary.js`; its version and the reviewed taxonomy's 30 rows are
  unchanged). The listen engine and the album send one `music_interrupted` when a drop begins, never one per failed
  read; `music_error` goes once per failed song or drop, as before.
* **Tests and CI.** New: `scripts/test/music-quick-wins.test.mjs` (33) and `scripts/e2e/music-quick-wins.e2e.mjs`
  (148 checks), both in the music job (`.github/workflows/music-platform-ci.yml`: its paths, the contract step and the
  browser step; no new workflow or trigger). Existing tests changed to the new behaviour, each only where it pinned
  the old one: `music-measurement`, `music-playback-races` (two signing-ahead tests now cross a creator's two-song
  release, since an album no longer runs into the next), `listening-room`, `human-uprise-door` (unit and e2e: the
  rail's card opens his page), `journey-errors`, `song-test`, `music-shell` (the pop-up is kept over a view),
  `now-playing-contract`. The browser suites that started a song from a Listen row now find it by Listen's search,
  since Listen lists no songs until a search (`music-background`, `music-world-continuity`, `now-playing`,
  `installed-app`, `music-shell`). Their scenarios that test a locked preview and an earned play (the gate's
  mechanics, which stay for any gated song) run on a copy of the catalogue served by the test with the hold lifted and
  the gated song first on its record, so they still reach it (`music-background`, `music-world-continuity`); the
  real catalogue's held song is the quick wins suite's to test. Other changes there: one `music_interrupted` per drop
  leaves the page (`music-background`); McCluster on the lock screen and no playlist scenario (`now-playing`); his
  card opens his page, the closing song tapped from a Listen view stays held with the view's own pop-up and no
  claim, a guest's preview of an artist's last song stops the record, and the steps that waited for Listen's song
  list wait for its albums, or search first (`music-shell`).

### Tests: failing at the base, passing after

Every new test was run on `5d8c533e` with only the tests added (its sources untouched), in a worktree made for it
and removed after:

| Test | At `5d8c533e` | After |
| --- | --- | --- |
| `scripts/test/music-quick-wins.test.mjs` (new, 33) | 30 fail. The 3 that pass are controls: the lock screen's artwork registry already handed each cover whole, and the house owner's own play of the closing song already worked on the listen engine and on the album | 33 of 33 |
| `scripts/e2e/music-quick-wins.e2e.mjs` (new, Chromium; 390 px, 320 px and 1280 px) | 51 of 142 checks pass: the guards that hold today too (every page fits at 320 and 390 px, every album is reachable, a search finds songs, a guest's and a member's offers, the house owner's own play). Six more never ran, their scenarios stopping at an earlier failure | 148 of 148 (Q1 11, Q2 20, Q3 56, Q4 23, Q5 25, Q6 5, 320 px 8) |

**Revert and fail.** 21 behaviours taken out one at a time, in a separate worktree holding the slice, each file put
back by its hash after (the slice's files checked equal after every pass): every one fails a test that holds it. They
are: the Artists rail as it was (the house card and his directory row); Matthew McCluster on the listen engine's lock
screen; his artist page without his albums; an old playlist link staying on a playlist page; the song rails switched
back on; the whole-covers rule; the living sleeve mounted on the album; the desk taking a failed answer as "not a
creator"; the offer box ignoring the account; the closing song not marked held; no hold decision and no pop-up; the
album playing the held row on a tap; the listen engine opening a held song; a buy button on the held row; the pocket
wrapping round and playing a held or gated song; the listen engine running on through the whole shelf; the album
wrapping to its first song; `music_interrupted` held again; the dictionary without the two rows; one
`music_interrupted` per failed read on the engine, and on the album. The first pass caught 19 of 21. One revert only
loaded the sleeve's script, which mounts nothing; put back as it was (the mount itself), it fails. The other, the
engine running on through the shelf, passed because the test's album was the last on its shelf; the test's shelf now
puts that album first, and it fails. Four more were found after that pass, by the browser suites below, and each
test ran on the slice before its fix and failed there: the record's end sought past a guest's 30-second preview (the
record's end at 179.95 s of a 180 s file); Next stopped at once on a creator's song listed twice (the song stayed
where it was); the music video feed's credit (`music-videos.html`, the person's name); and a view of his page that
did not tell the bar it is the house. At the base the first two fail too, the record running on to its first song.

### Suites at the final code

At the final code, each once; the browser suites one at a time, in Chromium, under the shared browser lock:

| Suite | Result |
| --- | --- |
| Root, `node --test scripts/test/*.test.mjs` | 3134 tests: 3127 pass, 7 skipped, none fail |
| The music job's contract step (its parse checks and 16 test files) | 241 of 241 |
| `scripts/test/domain-architecture.test.mjs` | 7 of 7 |
| Worker, `workers/mccluster` (network off) | 2032 tests: 2022 pass, 9 skipped, 1 fails, the same one at `5d8c533e` and outside these files: `analytics-creator-attribution`, "real tracker retains only a validated public creator handle beside the path" (`MCC_PAGE_IDENTITY is not defined`) |
| Peaks, artwork and track-length checks | current (41 peaks files, 8 covers) |
| Source map validator | 2966 checks, none failed |
| Quick wins, `scripts/e2e/music-quick-wins.e2e.mjs` | 148 of 148 (and 148 of 148 again in its screenshot mode, at device scale 2) |
| M5 shell, background playback, World continuity | 141 of 141; 293 of 293; 140 of 140 |
| Now Playing, accounts, installed app | 120 of 120; 128 of 128; 246 of 246 |
| Native Control review, direct checkout | 49 of 49; 40 of 40 |
| The house door, member desk, creator onboarding | 122 of 122; 60 of 60; 85 of 85 |
| World first visit, site navigation | 83 of 83; 429 of 429 |

The suites caught four faults in the first build, each fixed with a test that failed before its fix: the music video
feed still credited the person; McCluster's page, opened as a view, did not tell the bar it is the house; and the two
record faults under Q6 above.

### What is Inferred

* Everything on an iPhone or iPad: that the pop-up reads well with VoiceOver and the keyboard, that the lock screen
  shows the album paused at its end, and that a whole cover inside its square looks right on every screen. Chromium
  only here.
* The readings above (who "the house" is, "right now" for the song rails, the pop-up's words).
* A pocket saved before this change keeps the artist name it was saved with ("Matthew McCluster") until a new song
  is chosen; it is a stored string, not a credit drawn by the pages.

### What waits for Matthew

* **The pop-up's words** (Q5): the guest and member lines above, and whether the album's own advance should open it
  (built: it does, once) or only a tap.
* **The questionnaire and the full-profile check** behind the closing song: not built; the pop-up says it opens soon.
  The gate's SQL is untouched, so today the closing song plays for the house owner alone.
* **The closing song's direct-sale offer** is inactive in production and its row has no buy button; keep it inactive
  while the song is held.
* **The catalogue's credit line** (`catalogue.html`) still reads "Written & performed by Matthew McCluster" beside the
  registered ISRCs: the registered writer's name. Change it to McCluster or keep it.
* **The song rails** (Trending, Most saved, Hidden gems and the rest) and the playlists: off until he says there is
  enough music; `data/playlists.json` and the rail code stay.
* **"From creators" on Listen**: when the first creator release is published (none is today), Listen shows a row of
  creators' releases under that heading, beside Artists and Albums (`js/music-community.js`, unchanged). A release
  is a creator's record, so it was kept; whether releases show there or only on each creator's artist page is his
  call.
* **The living sleeve** on the album (the animated surround that cropped the cover): unmounted; whether it comes back
  around a whole cover, or `js/env.js` is deleted.
* **The reviewed event taxonomy** in production lists neither `music_interrupted` nor `music_error`, so the funnel
  reports file them as unclassified; the owner's measurement dictionary names them. Adding them there is a production
  change, his to approve, and was not prepared here.

Rows for his devices; until they are run, everything here about an iPhone or iPad stays Inferred. For each, note
the page, a Safari tab or the Home Screen icon, signed in or not, and the iOS version.
1. Listen: one McCluster under Artists; tap it: his page, with his albums.
2. Listen and an album: Artists and Albums only; covers whole, nothing cut, nothing behind them.
3. Signed out, CIA Mind Control: tap the last song: the pop-up, Sign in; Close.
4. Signed in as a member, the same: the pop-up, "Complete your profile".
5. Play CIA Mind Control's second song and let it end: the album stops; the lock screen shows it paused.
6. Heal the 3: play the last song to its end: the album stops there, paused, and does not start Deep End again.
7. As a creator: Listen's Creator Studio box never says "For artists & creators" or "Become a creator", right after
   signing in and an hour later.
8. VoiceOver on the pop-up: the title is read, then the line, then the button.

### Screenshots for Matthew

Rendered in Chromium at device scale 2 by the browser suite's screenshot mode (`QW_SHOTS=<folder> node
scripts/e2e/music-quick-wins.e2e.mjs`), every request answered by a route fixture ("Fixture Artist" is a fixture);
kept with the slice's results, not in the repository:
* `listen-390-albums-and-artists`, `listen-1280-albums-and-artists` (whole page): Artists, then Albums, nothing else.
* `listen-390-artists-one-mccluster`: one McCluster, Artist, first.
* `artist-390-mccluster-one-profile`, `artist-1280-mccluster-one-profile`: his page, with his albums.
* `listen-390-shelf-whole-covers`, `album-390-hero-whole-cover`, `album-1280-hero-whole-cover`,
  `listen-390-mini-player-whole-cover`, `album-390-mini-player-whole-cover`, `listen-390-now-playing-whole-cover`:
  whole covers on the shelf, the album's hero, both mini players and the Now Playing sheet.
* `album-390-closing-song-signed-out`, `album-1280-closing-song-signed-out`, `album-390-closing-song-signed-in`: the
  pop-up for a guest and for a member.
* `listen-390-creator-no-join-offer`: a creator's Creator Studio box, with no join pitch.
* `album-390-stopped-after-last-song`: Heal the 3 stopped after its last song, paused at 0:02 of 0:02.

The World desk's change is held by its four checks over the real desk code, rendered on its own rather than in the
World, so no picture of it is offered.

Art direction: the first renders caught four things in the suite, not in the pages: a phone screenshot of Listen
taken before its sections had faded in (the house's scroll reveal), the 1280 album hero taken under the album's
once-a-session premiere curtain, the deck bar before the song's length was known, and two Listen shots that never
left the top (the house scrolls smoothly, and the shot's own second scroll cancelled the first). Each shot now
scrolls straight to what it shows and waits. Seen and not changed, because they were there at `5d8c533e` and lie
outside these seven: before a song's length is known the album's deck bar reads "0:00 · I AM HERE" on every album
(`album.html`, a placeholder from the first album); a search on Listen lists its songs below the Creator Studio box
and the Artists row; and the album page's own shelf of albums sets each whole cover on its card's grey ground. The
review round below took that ground away (QW-R1).

### Review and fixes

An independent review of the quick wins at `3b71aa7b`, against `5d8c533e`, found four blockers (QW-R1 to QW-R4), four
minor findings (QW-R5 to QW-R8) and four nits. This round took the blockers and the minors. Each was reproduced first
at the branch head `1580bde5` (the quick wins with the platform's P0 merges on top, which touch none of these files):
the review's own Chromium probes, run again, and for the pop-up a probe of this round's own, because the review's
stops early (its page script reads a constant defined only outside the page). Each then got tests that fail at
`1580bde5`, then its fix; none was set aside. Nothing went to `main`, and nothing was deployed, enabled or applied; no
SQL, `supabase/`, Worker, auth or session file changed, and no production data was read or written in this round.

| Finding | At `1580bde5` (reproduced) | Now |
| --- | --- | --- |
| QW-R1 (blocker) | The album page's shelf of albums: `css/music-director.css` gives it the rule colour as its ground and a 1 px frame, and the v2 cards over it are clear, so a grey plate (rgb 53, 52, 50 on the page's 5, 5, 6) filled the empty part of the three covers that are not square (I AM HERE, Whip Equipped, CIA Mind Control) and the clear pixels of the M, PRIM3 and VAUNT marks, at 390 and 1280 px. The marks' plate was there before the quick wins; the covers' showed once they were whole. The slice's browser check read only each image's own background, so it passed | The shelf gives no ground and no frame and keeps the rail's 12 px spacing, as Listen's shelf does: one rule in the whole-covers block of `css/music-system-v2.css`. The empty part of every square, and every mark's clear pixels, show the page |
| QW-R2 (blocker) | The pocket, the corner player of every page outside music, cut a song's album cover into a 74 by 56 px tile (64 by 50 on a phone), set it on black with 11 px corners and laid a dark gradient over it. 12 of the 41 songs have their album's cover as their picture: nine on Whip Equipped, three on CIA Mind Control | When a song's picture is its album's cover (it has no film, and its still is that cover or it has none of its own), the pocket shows the whole cover in a square, 50 px on a phone and 56 px wider, on the player's own panel with nothing over it: no gradient, no lyric line, no corner cut (`js/pip.js`, `css/style.css`). A film keeps its tile. The film also follows the song the pocket rolls into; before, the first song's film went on playing |
| QW-R3 (blocker) | A pocket record of the closing song, banked before the hold with its public preview, mounted on every page outside music with the song's name, and its Play read the preview to its end; a member's shared row (`listener_state`, which exists in production) carried it to the member's other devices | Before it mounts, the pocket asks the catalogue whether the record is its to carry: a held or gated song, found by its album and title or by its file, is not (today only the closing song is either), so nothing mounts and nothing is read (`js/pip.js`). This device's record of it is put away; a shared row naming it is left as it is and not copied here. The catalogue (`data/albums.json`, from the browser's cache when it has it) is waited for at most 2.5 s, beside the lock screen's helper the pocket already waited for; unanswered, a preview file is never the pocket's to play and any other record mounts as before |
| QW-R4 (blocker) | A member's song test card for the closing song said "Unlocks after you spend your earned play on it in the album player", beside the pop-up saying it plays only for members with a full profile and a short questionnaire; since the hold no member can spend a play on it. Production's song test for the album has that card (the review's read-only count) | For everyone it is held for, its card says what the member's pop-up says, word for word (`js/song-test.js`). The house owner's card keeps the earned-play line: his own play is how it opens for him. The album decides in one place whom the song is held for and tells the cards; it draws them again only when that changes (the gate's first answer, signing in or out), so a card someone is writing is not drawn again under them each time the gate is asked (`album.html`) |
| QW-R5 (minor) | A tap on the pop-up's own padding closed it (6 px in from a corner, or beside the line): a click on a dialog's padding has the dialog as its target, as a click on the backdrop does | Only a tap outside the pop-up's box closes it; Escape and Close work as before (`js/gated-audio.js`) |
| QW-R6 (minor) | A link to the closing song (the catalogue's registry and a Listen search row both open `album.html?album=cia-mind-control&t=` with it), or this device's stale seat on it, seated it in the deck with no source. Chromium reports an empty source as error 4, and the album sent `music_interrupted` (reason error, at 0 s, path public) for a song nobody could play, for a guest and for a member | A held song is never seated by a link, this device's seat, the pocket or the shared row: a link to it opens the album with nothing chosen, a stale seat is passed over, and a tap on the row still says why. An empty held source is not counted as a dropped connection either (`album.html`). The house owner's own play seats it through its claim, as before |
| QW-R7 (minor) | The house owner's own play of the closing song banked its signed one-play URL in the pocket, and the pocket's save sent it to his shared row | Nothing of the held song is banked: while it plays the pocket holds nothing, and nothing of it is sent to his shared row (`album.html`). His play is unchanged: one claim, the master |
| QW-R8 (minor) | The heart on every album row said "Save to My Rotation", a list no music page shows since the song rails were switched off; the saves were kept and shown nowhere | The heart says "Save" and the song's name, the words Listen's heart uses, and, as Listen's does, whether the song is saved (pressed or not) (`album.html`). Where saves are listed is Matthew's to say (below) |

**Tests, failing at `1580bde5` and passing after.** The new tests were run on `1580bde5` with its sources untouched:

| Test | At `1580bde5` | After |
| --- | --- | --- |
| `scripts/test/music-quick-wins.test.mjs` (10 new: one or two per finding) | all 10 fail, each on its finding | 43 of 43 (the slice's 33 and these 10) |
| `scripts/e2e/music-quick-wins.e2e.mjs` (6 new scenarios) | 37 of 79 checks pass (run with the final browser file). Every failure is a finding: the album shelf's plate behind the three wide covers and the M, PRIM3 and VAUNT marks, and its ground and frame, at 390 and 1280 (14); the pocket's crop at 320, 390 and 1280 (6); the pocket mounting and reading the closing song, from this device and from a shared row (5); the member's card at 390 and 320 (2); three taps on the pop-up's padding (3); the link and the stale seat, seated with error 4 and `music_interrupted` on the wire, for a guest and for a member (8); the house owner's signed URL kept in the pocket and posted to his shared row (2); the heart's words and its pressed state (2). The 37 that pass are controls: Listen's and the catalogue's shelves, a film's tile, the owner's card, the backdrop closing the pop-up, nothing of the closing song read after a link or a seat and a tap still saying why, the owner's play of the master, and the pages fitting at 320 and 390 | 227 of 227 (the slice's 148 and these 79); in its screenshot mode at device scale 2, the scenarios rendered, 71 of 71 |

The browser check now reads what shows in the empty part of a cover's square from a real screenshot (the middle of
each empty band and the artwork's own clear corners, against the ground 3 px outside the square, or beside it in the
pocket, whose panel is a gradient), not only the image's own background, so a plate drawn by anything behind a clear
card fails it; and it reads the measurement wire (with the visitor's consent) to see what is sent. Existing tests
changed, each only where it pinned the old code: `scripts/test/music-shell.test.mjs` (its pocket stand-in now answers
the catalogue, which the pocket asks before it mounts; the stand-in never answered) and one assertion in
`scripts/test/listening-room.test.mjs` (the pocket line now reads `asked`, the link's song as found, before a held
song is set aside). The album harness in `music-quick-wins.test.mjs` gives the deck its icons and reports its events.
CI: `js/song-test.js` joins the music job's paths; no new workflow or trigger.

**Revert and fail.** Each fix was taken out on its own in a separate worktree, its old form put back, the tests that
hold it run, and the file restored by its hash. At the unit level 16 changes, on the final code: the shelf rule; the
pocket's picture rule, and its CSS; the pocket carrying any record, and a preview file when the catalogue does not
answer; the card ignoring the hold, the album mounting it without saying what is held, no way to draw it again, and
drawing it again at every answer of the gate; the pop-up closing on any tap; an empty held source counted as a drop;
every row seatable, and a link seating the held song; the held row banked; the old label, and a heart that never says
it is saved. All 16 fail their tests (a control run of the same file in that worktree, nothing taken out: 43 of 43).
(A first pass, before the last two fixes, had 13 changes and 12 failed: one was built wrong and left the album's
option in place; rebuilt, it fails.) In Chromium 11 changes: the shelf's ground and frame; the pocket's cover CSS
taken out, and the tile never told it shows a cover; the pocket mounting whatever it holds; the album mounting the
cards without the hold, and never drawing them again; any click closing the pop-up; every row seatable; the held row
banked; the old label, and a heart that never says it is saved. All 11 fail their checks: 7 on the code before the
last two fixes (the cards' redraw only on a change, and the heart's pressed state, which they do not touch), and the 4
for R4 and R8 again on the final code.

**Suites**, one at a time, on the final code: root suite 3,204 tests, 3,197 pass, 0 fail, 7 skipped; the music job's
contract commands (its parse checks and 15 test files) 251 of 251; `scripts/test/domain-architecture.test.mjs` 11 of
11; the peaks, artwork and track-length checks current (41 peaks files, 8 covers); the source map validator 3,018
checks, none failed (no file added). No file under `workers/` or `supabase/` changed, so the Worker suite was not run
again. In Chromium, under the shared lock: quick wins 227 of 227; the M5 shell 141 of 141; background 293 of 293;
Music to World 140 of 140; Now Playing 120 of 120; accounts 128 of 128; installed app 246 of 246; direct checkout 40
of 40; the house door 122 of 122; Control's music review 49 of 49; site navigation 429 of 429; member desk 60 of 60;
creator onboarding 85 of 85; World first visit 83 of 83. Every changed page fits the screen at 320 and 390 px
(`scrollWidth === clientWidth`): the album with its shelf and with the song test, the catalogue with the pocket, and
the slice's 320 px pages.

**What is Inferred.**
* On an iPhone or iPad: that Safari scales the pocket's picture (its film's poster) the way Chromium does, and how the
  square sits with the real fonts and safe areas.
* That a pocket record of the closing song always names its album and title or its file: every record the pages write
  does, and the review's case did.

**What waits for Matthew.**
* **The closing song's test card**: built, it stays and says why the song will not play, in the pop-up's words; or it
  waits, hidden, with the song until the questionnaire exists.
* **Saved songs**: a heart keeps the song on this device and counts toward what is most saved, but no page lists the
  saves while the song rails and playlists are off. A plain saved list on Listen, or no hearts until the rails come
  back. Built: the honest label and, as on Listen, whether the song is saved.
* **The pocket's lyric line**: it rode over the film; over a whole cover it is not drawn. Whether it should show as a
  line under the song's name instead.
* **The review's four nits** did not come to this round: the desk's unknown-creator guard is held only by the browser
  suite (QW-R9); Listen says "tracks" where the album and the artist page say "songs" (QW-R10); the shelves print
  each album's billed artist, CIA Mind Control's among them (QW-R11, his call); the catalogue's rows are not marked
  held, so its buy button would appear if the closing song's inactive direct-sale offer were switched on (QW-R12: keep
  the offer inactive).

Rows to add for his devices:
9. Play a Whip Equipped song, then open the catalogue: the corner player shows the whole cover in a small square,
   nothing over it and no rounded corners.
10. From the catalogue's list, open the closing song: the album opens with nothing playing; tap the song: the pop-up.
11. Signed in as a member, CIA Mind Control, scroll to the song test: the closing song's card says what the pop-up
    says.

**Renders for Matthew** at device scale 2 (`QW_SHOTS=<folder> node scripts/e2e/music-quick-wins.e2e.mjs`), kept with
the results, not in the repository: `album-390-shelf-whole-covers` and `album-1280-shelf-whole-covers` (the album
page's shelf: every cover and mark on the page itself, the rail as Listen's), `pocket-390-whole-cover` (the catalogue
with a Whip Equipped song in the pocket: the whole cover in a small square; the black above and below the car is the
artwork's own) and `album-390-song-test-held-card` (a member's song test on CIA Mind Control: the closing song's card
in the pop-up's words; the cards' names are the suite's stand-ins). Art direction: the first render of the card showed
only the album's once-a-session opening curtain; every render now waits for it to lift, and the card was rendered
again.