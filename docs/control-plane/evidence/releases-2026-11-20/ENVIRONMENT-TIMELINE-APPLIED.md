# Environment timeline: application in progress, 2026-11-20

**Two of five parts are confirmed applied.** The remaining three are pending. The runtime flag remains false and this
record claims no provider configuration, module enablement or public activation.

This continues [the 06:13 UTC preparation record](ENVIRONMENT-TIMELINE-PREPARED.md), after the migration connector
recovered. The owner authorized completion of the release. The website/API release is already live at
`95db84602d8edef4e4a0143833f37ab3e67d91f7`; database application and runtime activation are recorded separately.

## Confirmed application

At 06:25:26 UTC the ledger was independently read through the authenticated Supabase connection and held the two rows
below; Cloudflare's live Worker settings simultaneously reported the ingest flag `"false"`. Each confirmed row contains one stored
statement and its byte count, MD5 and SHA-256 match the exact reviewed file. The source files are moved only after that
confirmation. Their original staging headers remain unchanged.

| Part | State | Assigned version | Bytes | MD5 |
| --- | --- | --- | ---: | --- |
| 01 | applied | `20261120061725` | 30,895 | `37f0001127eac2b2bca5f5d0488aecc3` |
| 02 | applied | `20261120061759` | 20,775 | `6ea640c7537303965620829613e233fe` |
| 03 | pending | none | 31,085 | `266184de8d6d6e1e1556410192b4b7a9` |
| 04 | pending | none | 26,708 | `18eb00ad69066973fff41deaad91aa63` |
| 05 | pending | none | 12,178 | `3bc2d43c92e0bf08068b802ce4011027` |

Applied filenames are `<assigned-version>_eup_environment_events_v1_0N.sql` under `supabase/migrations/`.
Pending parts keep prefix `20261119100000_` under `supabase/pending/`. The recovery file remains pending.
All five reviewed SHA-256 hashes and the operational sequence are in the preparation record.

## Remaining completion

Continue serial application from part 03, with a ledger read between calls and before any retry after an unknown outcome.
After all five parts, verify RLS and grants, configure USGS through the canonical owner command, enable the existing
five-minute ingest in the runtime and source configuration, and verify durable source health and the owner preview.
Then install the Environment module disabled, reread its revision and enable it through the existing module policy RPC.

Public acceptance is HTTP 200 from `/v1/world/environment/events?limit=20`, with its documented schema and fresh source
health, plus one real event agreeing across the post, globe and `?feed=equity&event=<encoded-id>` deep link.
These outcomes have not yet been observed by this record.

The release operator owns the global ledger, drift contract, schema manifest, production snapshot and removal of the
now-applied `live-callers.json` exceptions. This change leaves those global records untouched for reconciliation together.
