# Gated audio — a record you earn

A gated track ships **two files that live in two different places**, and the
split is the whole security model.

| | where it lives | who can get it |
| --- | --- | --- |
| preview cut | `assets/audio/<slug>-preview.mp3`, committed | anyone |
| master | private Supabase bucket `mcc-gated-audio`, never committed | one play at a time, as a URL the API Worker signs |

The site is a static host. A file committed under `assets/` is world-readable
the moment it deploys, so the master is not in this repository at all. The
bucket is **not** readable by signed-in accounts: a browser that could sign its
own URL could pick its own lifetime and replay forever, so no count would hold.
Only the API Worker (`workers/mccluster/src/music/router.js`) signs, with the
service role, one short-lived URL per play it has granted.

## The rule

The owner's rule, enforced by the Worker and the database, never by the page:

1. An account. Signed out, the row plays the preview and offers one.
2. **Five different other songs heard all the way through** before the first
   play. The row shows progress: `2/5 SONGS · finish 3 more to unlock`.
3. **One play.** Pressing play spends it; the Worker signs a URL good for ten
   minutes. The player refuses to rewind it, and ending it or moving to
   another track is the end of that play. There is no download or ringtone:
   a file to keep is not one play.
4. After that, **one more full song for every play.**

The numbers live in `GATES` in the Worker and are repeated in the track's
`listen_gate` block in `data/albums.json`; `scripts/test/music-platform.test.mjs`
fails if they disagree. House operators (`ops.use`) play it without spending.

## The listen ledger

`js/listen-ledger.js` tells the API when a song starts from the top and when
it ends. It never says how long the song is. The Worker knows every song's
length from `workers/mccluster/src/music/tracks.js`, generated from the audio
files by `node scripts/music-track-lengths.mjs` (re-run it after adding a
song; a test fails while it is stale). A listen counts only when the server
saw at least 95% of the song's length pass between the start and the end, so
skipping to the end or playing at double speed does not count, and starting a
song closes the listener's previous unfinished one, so songs cannot be heard
in parallel. The album page, the discovery player and the pocket player all
report; the gated record never counts toward itself.

Tables: `music_listens` and `music_gated_plays`, written only by the service
role; listeners can read their own rows. Functions: `music_listen_start`,
`music_listen_finish`, `music_gate_state`, `music_gate_claim` (service role
only; the claim takes an advisory lock so two taps cannot spend one play
twice).

## Adding one

1. Cut a preview and commit it as `assets/audio/<slug>-preview.mp3`.
2. Add the track to `data/albums.json` with a `gated` block:

   ```json
   {
     "title": "Niggy Nigg Niggr",
     "src": "assets/audio/niggy-nigg-preview.mp3",
     "gated": {
       "bucket": "mcc-gated-audio",
       "object": "niggy-nigg/niggy-nigg.mp3",
       "preview_seconds": 12,
       "download_as": "Niggy Nigg Niggr.mp3"
     }
   }
   ```

3. Add the registry row to `data/catalogue.json` with `"gated": true`.
4. Upload the master (see below). Until that happens the row reads
   **Unavailable**, which is correct — it is not locked, it is missing, and
   those are different sentences.

## Uploading a master

Needs the service key, for one command, from the owner's machine. It is never
committed, never printed, and never sent to a browser.

```
SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-gated-track.mjs ~/Music/niggy-nigg.wav niggy-nigg
SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-gated-track.mjs --check niggy-nigg
```

Hand it the best master you have. It reads the track's `formats` out of
`data/albums.json` and makes every one of them from that single file, so
adding a format to the registry is all it takes to start offering it. Needs
`ffmpeg` on PATH. `--check` lists what is up there and uploads nothing.

## Formats

Formats are still produced and uploaded, but no page offers them to listeners
while the record is on the one-play rule: a downloaded file is not one play.

`formats` is a list on the gated block. Each entry needs `ext`, `label` and
`object`; `note` is the small grey line under the label in the picker.

```json
"formats": [
  { "ext": "mp3", "label": "MP3",      "note": "plays anywhere", "object": "niggy-nigg/niggy-nigg.mp3" },
  { "ext": "m4r", "label": "Ringtone", "note": "iPhone",         "object": "niggy-nigg/niggy-nigg.m4r" },
  { "ext": "wav", "label": "WAV",      "note": "lossless",       "object": "niggy-nigg/niggy-nigg.wav" }
]
```

Recipes live in `scripts/publish-gated-track.mjs`. `mp3`, `wav`, `flac`,
`m4a` and `m4r` exist; a format in the registry with no recipe fails loudly
rather than uploading nothing. **The ringtone is capped at 30 seconds** —
iOS silently refuses to install an `.m4r` longer than 40, which would
download fine and then do nothing.

One format missing from the bucket marks only its own button in the picker.
The record does not become unavailable because the ringtone has not been
uploaded yet.

`supabase/migrations/20260918230000_gated_audio.sql` must be applied first or
the bucket does not exist. **No workflow applies migrations in this repo** —
that is a `supabase db push` by hand.

## The states a row can be in

`js/gated-audio.js` resolves exactly one of these and never guesses:

- **preview** — no session. Plays the preview, offers a free account.
- **locked** — signed in, not earned yet. Plays the preview and says how many
  songs are left.
- **earned** — the next press of play spends one play.
- **full** — the one play, happening now.
- **unavailable** — the API or storage said no for a reason that is ours.
  Says so, and never nags a listener for an account they already have.

## Three things that break this quietly

Each of these shipped broken during the build and none of them are visible in
a screenshot of the happy path. `scripts/test/gated-audio.test.mjs` guards
all three.

1. **A tainted deck plays silence.** `js/chamber.js` runs the deck through
   `createMediaElementSource`. A cross-origin source on an element without
   `crossorigin="anonymous"` is tainted, and Chrome pushes silence through
   that graph — the record looks like it is playing and makes no sound.
2. **A stripped query is a stripped token.** `js/filament.js` drops the query
   string to build its waveform cache key. Fetching that stripped URL asks
   storage for the object with no authorization; the JSON error that comes
   back then goes into `decodeAudioData`. Cache on the key, fetch the src.
3. **`.gate` was already taken.** `css/style.css` uses it for the booking
   modal (`position: fixed; inset: 0`). A row slot wearing that class is in
   the DOM, passes a presence assertion, and paints across the viewport. The
   row slot is `.reclock`.

## Billing an album to another name

`data/albums.json` takes an optional `artist` on an album. Without it a record
bills to Matthew McCluster, which is what every other album wants. With it the
album header, the now-playing sheet, the phone lock screen and the default
credit line all follow that name instead. The copyright footer does not: that
is a rights notice, not a credit, and the owner is still the owner.

## Known gaps

- The pocket player (`js/pip.js`) reads `data/albums.json` and plays `src`, so
  it plays the **preview** for everyone, signed in or not. That is safe — it
  never exposes a master — but a signed-in listener gets the short cut there
  while `album.html` gives them the full one. It does now bank the durable
  preview URL rather than an expiring signed one, so resume is not broken.
- `data/catalogue.json` carries a real `QT6KV` ISRC per track. Nothing in this
  repo exports it — the DDEX worker reads `eu_releases`/`eu_recordings` in the
  database, not these files — so a display credit here reaches no distributor
  today. If that ever changes, the `credit` field is rights metadata and needs
  to say what the rights actually are.
