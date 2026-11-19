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

### Complete-song evidence and remaining work

The measured public file lengths still match `data/albums.json` and the server's track registry. The engine lets a
full track continue past the preview boundary and advances on the media element's `ended` event; a protected preview
still stops at its declared limit. The existing Worker stream forwards Range and preserves 206, Content-Range and
Accept-Ranges. The private creator stream still checks entitlement and the pinned, reviewed master before signing
its URL. This continuation changes no duration cap, purchase authorization, review requirement or gate policy.

- **M3 remains partial.** The reproduced interruptions above are repaired. This is not proof of complete playback
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
endurance, lock-screen controls, AirPlay, the new header's browser result, and authenticated production
upload/publication still need their own receipts.
