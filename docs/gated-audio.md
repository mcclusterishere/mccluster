# Gated audio — a record behind an M Account

A gated track ships **two files that live in two different places**, and the
split is the whole security model.

| | where it lives | who can get it |
| --- | --- | --- |
| preview cut | `assets/audio/<slug>-preview.mp3`, committed | anyone |
| master, every format | private Supabase bucket `mcc-gated-audio`, never committed | signed-in listeners, via a signed URL |

The site is a static host. A file committed under `assets/` is world-readable
the moment it deploys, so a "locked" player pointed at a committed master is
decoration — the URL is in the page source. The master therefore is not in
this repository at all. `storage.objects` RLS is what enforces the gate, and
the browser trades the listener's own access token for a short-lived signed
URL. Nothing about the enforcement lives in JavaScript.

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

## The three states a row can be in

`js/gated-audio.js` resolves exactly one of these and never guesses:

- **locked** — no session. Plays the preview, offers a free account.
- **unlocked** — signed. Plays the master from a signed URL, offers the
  download. The row clock switches to the master's length.
- **unavailable** — storage said 404 or fell over. Says so. It never nags a
  listener for an account they already have, and never reads as empty.

Signing in in another tab takes over a playing preview at the same second;
the preview is the head of the same master, so the clock lines up.

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
