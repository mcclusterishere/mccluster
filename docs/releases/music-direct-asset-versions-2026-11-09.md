# Direct music sales: pinned purchases and settled downloads — 2026-11-09

**Status: source and isolated-database proof only. NOT applied to `zmnhbrjyhxzhkxmhkexs`. No Edge Function deployed. No real purchase, Storage object or refund was touched.**

Repairs two findings of the 2026-11-09 deep audit (`06_DEFECT_LEDGER.json` COM-1, COM-2) in the direct-sale path introduced by `20261031180839_music_direct_sales_v1`.

| Finding | Was | Now |
| --- | --- | --- |
| COM-1 paid entitlement followed the mutable offer | `music_direct_claim_download()` returned the offer's *current* `asset_path`; an owner edit changed what an old purchase delivered | every offer write records an immutable `music_direct_asset_versions` row (bucket, path, download name, title); `music_direct_offers.current_version_id` points at it; an order snapshots `asset_version_id` at insert (immutable), the entitlement inherits it, and delivery reads the version row. Edits only affect future sales; reverting to an earlier file reuses its version row. |
| COM-2 Storage signing failures consumed download slots | the count went up in the same RPC that returned the path, before the handler signed; three failed signings spent three slots and the decrement guard blocked compensation | a download is an attempt: `music_direct_reserve_download(token, attempt_key)` holds one slot (live holds count against the limit; lapsed holds are released by the next reservation), the handler signs the *pinned* object, then `music_direct_settle_download(attempt,'issued'|'released')` counts it or returns the slot. The same `attempt_key` returns the same attempt (one slot across a lost response). Issued is final; released is final; `download_count` still only rises and only through settlement; the entitlement guard is unchanged. |

## Files

- `supabase/pending/20261109120000_music_direct_asset_versions_v1.sql` (new; under `supabase/pending/` because it is unapplied: promote it into `supabase/migrations/` with its ledger entry only as part of the authorised rollout).
- `supabase/pending/music_direct_asset_versions_v1.rollback.sql` (restores the v1 guards and one-step claim; the pin record is lost; run before the v1 rollback).
- `supabase/functions/music-direct-access/index.ts`: `download` is reserve → sign → settle; a signing failure settles `released` and answers 503 `sign_retry`; `operator-direct-list` returns `asset_review` (purchases needing the owner's resolution); never calls the one-step claim.
- `supabase/functions/_shared/music-direct.ts`: `ATTEMPT_KEY_RE`, `asset_unresolved` / `attempt_spent` / `sign_retry` refusals, `downloadRefusal()` refuses an unpinned legacy entitlement.
- `supabase/tests/music_direct_asset_versions.behaviour.sql` (new), `scripts/test-music-direct-sales-db.sh`, `scripts/test/music-direct-sales.test.mjs`, `.github/workflows/music-direct-sales-db.yml`.

## Backfill policy (owner decision recorded, not yet exercised in production)

An order placed before this migration is pinned to its offer's current file **only when the offer has not been written since the order was created** (`offers.updated_at <= orders.created_at`), the only evidence this schema holds. Every other paid order stays unpinned: its downloads refuse with `asset_unresolved` (409, nothing counted), it is listed in `public.music_direct_asset_review` and on the owner's Direct sales desk, and the owner resolves it once by writing `music_direct_orders.asset_version_id` to a version of that same offer; the entitlement follows. Nothing is silently assigned today's file. Production preflight at v1 (2026-10-31) recorded zero orders; the live count at apply time decides whether this list is empty.

Re-applying `20261031180839_music_direct_sales_v1.sql` after this file would restore its older guards and claim function; re-apply this file afterwards if that is ever done. A legacy inactive offer outside the private-path contract keeps a version row for its old orders but no current pointer (writing one through the row would trip the NOT VALID check), so no new order can be placed on it.

## Proof run (isolated PostgreSQL 16.15, synthetic data, 2026-11-09)

`PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` → `music direct sales: ok`, covering: v1 applied twice; the new behaviour file **fails** on v1 alone (regression bites); backfill of an unchanged-offer order and refusal of an edited-offer order; this migration applied twice; v1 behaviour (unchanged) and new behaviour pass; both rollbacks; legacy inactive offer preserved; re-apply of both; both behaviours again. `node --test scripts/test/music-direct-sales.test.mjs`: 23/23.

The purchase page (`js/music-purchase.js`) does not yet send `attempt_key`; without it each click is a new attempt (still correct, just no retry coalescing). Wiring the key is UI follow-up.

## Not verified

Real Storage bytes for a signed URL; production apply, receipt and schema snapshot; a live purchase, refund or buyer retry; Edge deployment; the live-ledger count of orders that will land in `music_direct_asset_review`.
