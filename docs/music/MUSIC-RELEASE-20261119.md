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
   second, attempt, path; no account or place). (Corrected in the review round, "Review and fixes" below: the tries
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
   start only after the finish in flight has answered (5 s at most).
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
   --check` now also fails on a misnamed file or an index at the end.
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
  whether the edit list the remuxed files now carry plays gaplessly there (the decoded PCM is identical in ffmpeg).
* Chromium pauses an element in the page itself when a read fails (error, then pause) and leaves a detached
  `new Audio()` playing over silence; the players handle both, and WebKit may do either.
* Real networks: the fixtures cut reads short, hold them and refuse them for a few seconds; a phone moving between
  cells can fail differently.

### What waits for Matthew

* **D-7**, **D-11** and **D-20**: defaults built for his review, not merged. D-11 also asks him whether the closer
  stays preview-only or opens to signed-in members (the gate SQL chain was not touched).
* `music_interrupted` is a new client event; it is not in the reviewed measurement dictionary yet.
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
| RL-6 | In the installed app the dock hid the mini player and said nothing of the delivery (its second line kept the artist, its button said Play music) | The dock's second line and label say why the music is quiet (Reconnecting…, Connection lost · tap play, Loading…, Could not load · tap play, Muted; `spec.status` in `js/now-playing.js`), and it offers Pause while a song is picked up |

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
