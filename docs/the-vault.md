# THE VAULT: the backend for every capture

    https://matthew.mccluster.org/vault.html   (owner login, same as the Back Office)

Mass upload in, catalog of record out. One row per capture: fingerprint,
camera data, machine analysis, confirmed people, rights, and a ledger of
everywhere the frame has gone.

## The architecture (what lives where, and why)

| Layer | Where | Why |
|---|---|---|
| **Camera originals** (RAW, full video) | Google Drive, untouched | Never overwrite a negative; GitHub hard-caps files at 100 MB anyway |
| **Catalog** (the truth) | Supabase Postgres, RLS owner-only | Query, filter, join people ↔ releases ↔ pushes |
| **Web derivatives** (1800px + thumbs, IPTC-stamped) | Supabase Storage `vault` bucket | What the site, clients and socials actually use |
| **The pipeline** | GitHub Actions runner | The only place with open internet to Drive AND the muscle (exiftool, libraw, ffmpeg) |

The repo stays a website. The vault writes **nothing** into it.

## One-time setup (owner, ~15 minutes)

1. **Supabase → SQL Editor** → run `docs/the-vault.sql` (tables, RLS, the
   `vault` bucket), then `docs/the-vault-ids.sql` (identifier columns, the
   filings ledger, the house identifier block, and the distribution target
   map), then `docs/the-vault-targets.sql` (all 47 distribution lanes with
   commissions, rails and onboarding requirements). Self-checks print
   `vault ready`, `vault ids ready` and `targets loaded`.

   Once loaded, `select * from vault_next_lanes;` is your ranked to-do
   list: every lane you have not onboarded yet, best first.
2. **GitHub → Settings → Secrets and variables → Actions** → add:
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Settings → API → service_role.
     This key bypasses RLS; it lives ONLY here, never in a page.
   - `GEMINI_API_KEY`: aistudio.google.com → Get API key. Without it the
     pipeline still runs; you just get no machine analysis.
   - `PLUS_ID`: optional, add it after PLUS Supporting Membership; every
     capture from then on carries the licensor ID in its XMP.
3. That's it. The desk uses your existing owner login.

## Filing a batch (every shoot, 2 minutes)

1. Shoot lands in Drive. Share the folder: **Anyone with the link: Viewer**.
2. Add a batch to `data/vault-intake.json`:

   ```json
   { "id": "candler-0611", "event": "candler-crossing",
     "folder": "https://drive.google.com/drive/folders/…", "files": [], "done": false }
   ```

3. Push. The runner pulls everything: **RAW welcome here** (developed via
   libraw with the camera's own white balance, EXIF copied across), HEIC,
   video, all of it, and for each file:
   - sha256 fingerprint (a file the vault has seen bounces as a dupe, so
     re-running a rate-limited batch is always safe)
   - reads the full EXIF: shot time, body, lens, ISO, aperture, GPS
   - issues the catalog id: `MCC-YYYYMMDD-EVENT-NNNN`
   - builds the 1800px preview + thumb, **stamps IPTC/XMP** (creator ©
     credit, catalog id, event) so every copy that leaves carries papers
   - **Gemini** captions it, reads visible text, counts people, and guesses
     names against the roster in `vault_people`
   - uploads derivatives to Storage, writes the row
4. Flip `done: true` after it runs (dupes bounce anyway; this just skips).

## The desk (vault.html)

Grid of everything, newest first, each tile flagged **clear / rights?**.
Open a capture: full camera data, the machine's read, and the people row.

**The law of the vault: a guess is not a fact until you sign it.** Gemini's
name guesses show with a Confirm button; confirming writes a `vault_faces`
row (and creates the person if new). Identity in this system is always
human-confirmed. That's the accuracy posture and the privacy posture, and
it's why the machine's output is stored as `ai` (suggestion) separate from
`vault_faces` (record).

## Rights management: how a face becomes sellable

1. Confirm who's in the frame (above).
2. Get paper: model release (guardian-signed for minors), photograph it,
   drop it in the vault bucket, add a `vault_releases` row with `doc_url`
   and `covers_commercial`.
3. Flip **Release is clear** on the capture. Until then the desk shows
   `rights?` and nothing should go on commercial sale. Editorial/portfolio
   use is a different, safer lane (see docs/media-identifiers.md).

## Distribution: the pushes ledger, and the honest part

`vault_pushes` records every place a frame goes: target, URL, license
terms, and the fee when it earns. That's the longevity you asked for: in
two years you can answer "where has this frame been and what has it made."

The full honest capability map (what each platform accepts, what rail it
offers, what you have to set up first) is in **docs/distribution.md**, and
it is also a table in the database (`vault_targets`) so the desk can never
offer a one-tap push to a place with no door.

The short version: **Instagram, Facebook, TikTok, YouTube, Flickr and
SmugMug have real upload APIs. Adobe Stock, Alamy and Shutterstock take
bulk SFTP/FTP drops, which is easier, not harder, and the metadata rides
inside the file we already stamp. Getty has no public contributor API at
all.** And YouTube is **video only**: a still can only go there as a
rendered Short, which is a different product.

Same platform, second lane: client delivery. The stamped previews in
Storage are already shareable per-event, and a paid tier of that is the print
shop you already run.

## Cost reality

Supabase free tier includes 1 GB storage, roughly 2,500 stamped previews.
Past that it's the $25/mo Pro plan (100 GB). Gemini analysis on a
400px thumb costs a fraction of a cent per frame. Drive stays your archive
either way.
