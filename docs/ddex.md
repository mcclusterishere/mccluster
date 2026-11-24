# DDEX / QT6KV pipe

McCluster’s music identifiers live in this repo. The QT6KV desk is the
allocator, not a second catalog and not a second backend. The Cloudflare
Worker, Supabase plane, and `index.html` are untouched.

`docs/media-identifiers.md` is the photo/video stack. This file is the music
stack. Do not mix them.

| Number | Where it is minted | Where it is stored |
| --- | --- | --- |
| ISRC (`QT6KV` + year + 5 digits) | QT6KV desk | `data/ddex/identifiers.json` + `isrc` on each `data/catalogue.json` track |
| House number (`QT6KV·01`) | Display only | Not an ISRC. Do not send it to a DSP. |
| UPC / ICPN | After GS1 prefix is on file | `releases[].icpn` in the ledger |
| DPID | DDEX, pasted on the desk | `house.dpid` in the ledger, ERN MessageSender |
| ISNI | Already issued | `house.isni_org` / `house.isni_person` |
| ERN message id | Generated per delivery | Desk `ern_messages`; XML is the feed |

## Allocation order

ISRCs `QT6KV2600001`–`QT6KV2600017` follow `data/albums.json` release order,
including three recordings that `data/catalogue.json` did not list while it
was kept by hand (it is generated from the shelf and this ledger now, by
`tools/build-music-registry.mjs`, and lists every record on the shelf):

- `environmental-injustice-brave` → `QT6KV2600009`
- `deep-end` → `QT6KV2600012`
- `heal-the-3rd-world` → `QT6KV2600013`

Catalogue `no` (`QT6KV·NN`) is the public house index. Since the registry
is generated, it is the ISRC's designation wherever one is issued (Please Set
Me Free is `QT6KV·10` on the catalogue page and `QT6KV2600010` here); a
recording with no ISRC yet takes the next number after the ledger, in shelf
order, and that number is not an ISRC. Always deliver the 12-character ISRC.

## Rules

1. **Do not remint a slug that already has an ISRC.** The ledger is append-only
   for recordings. A code that has been delivered is burned.
2. **`data/albums.json` is the release list.** `data/catalogue.json` is the
   public track list, generated from it, this ledger and the measured lengths
   (`node tools/build-music-registry.mjs`; never edited by hand). Every
   recording on the shelf gets an ISRC here.
3. **Git MP3s are not delivery masters.** ERN still wants WAV/FLAC + duration.
4. **Merlin is a licensor.** This pipe is the catalog they inspect. It is not
   membership and it is not a DSP.

## How the desk uses this repo

Pull `data/catalogue.json`, `data/albums.json`, and this ledger from `main`
(or the review branch `ddex/qt6kv-pipe`). Adopt any ISRC already on a slug.
Allocate only empty slugs. Export a replacement `identifiers.json` and keep
it here.

## Creator releases (2026-11-23)

A creator's own release reaches the stores through the same pipe, without
minting anything on the way:

1. **Creator Studio → Distribution** (`creator.html`, `js/music-distribution.js`):
   the creator sees the store checklist and enters what the release does not
   already say: release date, explicit, ℗/© lines, master owner, credits,
   master and publishing splits, and an ISRC/UPC they already own. Stored on
   `creator_tracks.distribution` (`supabase/pending/20261123200000_music_creator_distribution_v1.sql`,
   PROMOTION-ORDER section 18), outside release content, so a live release stays live.
2. **Control → Create → Music → Distribution → Creator releases for the stores**:
   once McCluster has approved the release, "Check" (dry run) lists the gaps and
   "Stage for the stores" writes `eu_recordings`, `eu_releases` (at
   `metadata-review`), `eu_release_tracks` and the creator's `eu_rights_splits`
   in the McCluster org (`music-access` `operator-distribution-stage`,
   `supabase/functions/_shared/creator-distribution.ts`). The label is the
   creator's master owner, never McCluster Corp by default. A release already
   delivering, delivered or live is never restaged in place.
3. **Delivery** is unchanged: `eu-music` preflight, the `music.deliver`
   approval, then `eu-ddex-worker` (manual delivery until a distributor
   endpoint, DPIDs and a GS1 prefix exist).

Open for the owner: whether McCluster's `QT6KV` registrant code issues ISRCs to
creators' recordings (the staged ledger `20261013180000_qt6kv_creator_isrc_ledger.sql`
is "do not apply as-is" and defaults `rights_owner` to McCluster Corp). Until
that is decided, a creator release without its own ISRC stays a preflight gap.
