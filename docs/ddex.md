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
including three recordings that `data/catalogue.json` does not yet list:

- `environmental-injustice-brave` → `QT6KV2600009`
- `deep-end` → `QT6KV2600012`
- `heal-the-3rd-world` → `QT6KV2600013`

Catalogue `no` (`QT6KV·01`–`14`) is the public house index on the 14 listed
tracks. After the albums-only recordings, house `no` and ISRC designation
diverge — Please Set Me Free is `QT6KV·09` on the catalogue page and
`QT6KV2600010` on the ledger. Always deliver the 12-character ISRC.

## Rules

1. **Do not remint a slug that already has an ISRC.** The ledger is append-only
   for recordings. A code that has been delivered is burned.
2. **`data/albums.json` is the release list.** Catalogue is the public track
   list. The three albums-only recordings still get ISRCs.
3. **Git MP3s are not delivery masters.** ERN still wants WAV/FLAC + duration.
4. **Merlin is a licensor.** This pipe is the catalog they inspect. It is not
   membership and it is not a DSP.

## How the desk uses this repo

Pull `data/catalogue.json`, `data/albums.json`, and this ledger from `main`
(or the review branch `ddex/qt6kv-pipe`). Adopt any ISRC already on a slug.
Allocate only empty slugs. Export a replacement `identifiers.json` and keep
it here.
