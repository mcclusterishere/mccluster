# Gated audio — a record behind an M Account

A gated track ships **two files that live in two different places**, and the
split is the whole security model.

| | where it lives | who can get it |
| --- | --- | --- |
| preview cut | `assets/audio/<slug>-preview.mp3`, committed | anyone |
| master | private Supabase bucket `mcc-gated-audio`, never committed | signed-in listeners, via a signed URL |

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
     "title": "niggy nigg",
     "src": "assets/audio/niggy-nigg-preview.mp3",
     "gated": {
       "bucket": "mcc-gated-audio",
       "object": "niggy-nigg/niggy-nigg.mp3",
       "preview_seconds": 12,
       "download_as": "niggy nigg.mp3"
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
SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-gated-track.mjs ~/Music/niggy-nigg.mp3 niggy-nigg
SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-gated-track.mjs --check x niggy-nigg
```

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

## Known gap

The pocket player (`js/pip.js`) reads `data/albums.json` and plays `src`, so
it plays the **preview** for everyone, signed in or not. That is safe — it
never exposes a master — but a signed-in listener gets the short cut there
while `album.html` gives them the full one. Wiring `MCC_GATED` into `pip.js`
is the fix; it has not been done.
