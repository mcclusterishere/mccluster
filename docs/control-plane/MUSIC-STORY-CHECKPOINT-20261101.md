# Music, lyrics and episode connections — 2026-11-01

This extends the existing Control music view and `front.html` landing engine. No separate music editor or show backend is added. Source changes remain local; live persistence, audio listening and publishing are not claimed.

**Corrective checkpoint:** the initial embedded lyric-history design below was
replaced before release after independent review. See
[Lyric history correction](LYRIC-HISTORY-CORRECTION-20261101.md). The branch is
published for source review; it is not deployed. Private history SQL remains
unapplied and is a prerequisite for the corrected lyric endpoints.

## Lyrics

`control.html#create:music` → Lyrics mounts `CR.lyricsReview` and `js/lyrics-sync.js` from the inspected PR 684, with narrow integration and correction safety. PRs 684–687 were not merged wholesale. The review section now uses the existing `operator-review-prepare` flow, and sends the backend-required timestamp and pinned master hash with Publish. A lyric save clears any prior prepared approval in Control.

Uploaded release edits use existing `music-access` actions and a protected
append-only `private.music_lyric_revisions` store. `creator_tracks.lyrics`
contains only the current public playback projection, with no review authority
or history. Read returns revision, content hash and release timestamp. Save
checks all three under the track row lock; approval metadata is bound to the
authorized actor outside the lyric payload. No master/audio column is updated.
Word or timing changes clear the reviewed mark. Retimed words after a changed
word count are explicitly estimated until the owner listens and reviews.

Approved exports are fetched through an authorized server endpoint that checks
the selected immutable revision, its approval and expected hash. Browser-held
history and reviewed flags are never authority. Working changes are excluded.
Draft download and download-before-reload preserve unsaved corrections. Shelf
tracks remain repository files: their corrected JSON is downloaded for a
reviewed repo edit, not silently published or falsely reported as a backend
save. Automatic alignment/stem generation is not enabled by this slice.

Coverage on inspected main catalog: **20 tracks; 8 timed lyric files, 2 plain-only files, 10 unwired**. This counts file wiring only. Neither existing timing nor word correctness was audited by listening to every recording. PR 687's additional tracks remain unmerged here.

## Episode connections

`data/story-index.json` snapshots only public-safe identity metadata from the canonical Prim3 course feed. Its source path, snapshot date and exact source-content hash are recorded. The 21 existing episode IDs and course units are preserved; this is not a released-show inventory. No manuscript text or private reveal notes enter this file.

The existing catalog's `assets/audio/got-wifi.mp3` and the feed's explicit `source_slug: got-wifi` establish **PRIM3 / S02E03 / Dead Air**. No title-only inference is used. The album track row, Now Playing link and music-video feed open `front.html?project=prim3-s02e03`; the episode plan links back to the recording. `front.html?project=prim3` lists the episode plans. Tracks unavailable in this catalog remain unassigned; video release status is explicitly unverified. The episode pages have no inherited Vaunt imagery/audio. Existing Vaunt, member pages and the homepage are preserved.

Control production plans can select an indexed episode association, saved as a **draft**, and export that ID with the saved timeline. The source map does not confer release approval. Ghost In The Wires is the source's S07E03 association, not proof of a separate released show's identity. Its latest fictional direction lives in the private story workspace.

## Evidence and limits

- `node --test scripts/test/lyrics-revisions.test.mjs`: save/reload, historical hash, stale/racing writes, timing validation and unchanged master fields.
- `node scripts/e2e/control-lyrics-revisions.e2e.mjs`: actual Control/editor + actual revision helper against a synthetic database, at 390/768/1280px. Includes selected historical approved export, stale/denied saves, review preparation and required publish fields. No real publication or audio listen occurred.
- `node scripts/e2e/story-links.e2e.mjs`: actual album/feed/front pages with local catalog data, at 390/768/1280px; external network is mocked. Known round trip, unknown slot, no inherited film/soundtrack, no overflow.
- `node --test scripts/test/story-index.test.mjs scripts/test/vaunt-project.test.mjs scripts/test/member-front-pages.test.mjs scripts/test/front-cabin-first.test.mjs`: 23 checks passed.
- Full Worker `npm test`: **1,258 passed**, with the existing locked fal client installed locally. All provider requests in tests remain mocked.
- Root `npm test`: 1,328 Node tests and 7 Python tests passed at this checkpoint.

Evidence folders: `/tmp/lyrics-revision-proof/` and `/tmp/story-links-proof/`. These are local test artifacts with fixture lyric text. No production SQL, paid jobs, credentials, checkout, merge, push, or deployment was performed.
