# Direct music sales: pinned purchases and settled downloads — 2026-11-09

**Status: source and isolated-database proof only. NOT applied to `zmnhbrjyhxzhkxmhkexs`. No Edge Function deployed. No real purchase, Storage object or refund was touched.**

Repairs two findings of the 2026-11-09 deep audit (`06_DEFECT_LEDGER.json` COM-1, COM-2) in the direct-sale path introduced by `20261031180839_music_direct_sales_v1`.

| Finding | Was | Now |
| --- | --- | --- |
| COM-1 paid entitlement followed the mutable offer | `music_direct_claim_download()` returned the offer's *current* `asset_path`; an owner edit changed what an old purchase delivered | every offer write records an immutable `music_direct_asset_versions` row (bucket, path, download name, title); `music_direct_offers.current_version_id` points at it; an order snapshots `asset_version_id` at insert (immutable), the entitlement inherits it, and delivery reads the version row. Edits only affect future sales; reverting to an earlier file reuses its version row. |
| COM-2 Storage signing failures consumed download slots | the count went up in the same RPC that returned the path, before the handler signed; three failed signings spent three slots and the decrement guard blocked compensation | a download is an attempt: `music_direct_reserve_download(token, attempt_key)` holds one slot (live holds count against the limit; lapsed holds are released by the next reservation), the handler signs the *pinned* object, then `music_direct_settle_download(attempt,'issued'|'released')` counts it or returns the slot. The same `attempt_key` returns the same attempt (one slot across a lost response). Issued is final; released is final; `download_count` still only rises and only through settlement; the entitlement guard is unchanged. |

## Files

- `supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql`: **applied in production on 2026-11-09** as version `20261109175747` (SHA-256 `a76d1335…`) with Supabase Edge `music-direct-access` v42; receipt `docs/control-plane/evidence/releases-2026-11-09/COMMERCE-RELEASE-RECEIPT.md`. This is the independently corrected release, not the branch's first draft (`20261109120000_…`, now removed): it locks entitlement before attempt, re-checks refund/revocation/payment/expiry at settlement, releases expired holds, rejects null outcomes and bounds attempt replay to 300 s. Zero orders/entitlements existed at cutover; no real purchase, refund or download was tested.
- `supabase/pending/music_direct_asset_versions_v1.rollback.sql` (restores the v1 guards and one-step claim; the pin record is lost; run before the v1 rollback).
- `supabase/functions/music-direct-access/index.ts`: `download` is reserve → sign → settle; a signing failure settles `released` and answers 503 `sign_retry`; `operator-direct-list` returns `asset_review` (purchases needing the owner's resolution); never calls the one-step claim.
- `supabase/functions/_shared/music-direct.ts`: `ATTEMPT_KEY_RE`, `asset_unresolved` / `attempt_spent` / `sign_retry` refusals, `downloadRefusal()` refuses an unpinned legacy entitlement.
- `supabase/tests/music_direct_asset_versions.behaviour.sql` (new), `scripts/test-music-direct-sales-db.sh`, `scripts/test/music-direct-sales.test.mjs`, `.github/workflows/music-direct-sales-db.yml`.

## Backfill policy (owner decision recorded, not yet exercised in production)

An order placed before this migration is pinned to its offer's current file **only when the offer has not been written since the order was created** (`offers.updated_at <= orders.created_at`), the only evidence this schema holds. Every other paid order stays unpinned: its downloads refuse with `asset_unresolved` (409, nothing counted), it is listed in `public.music_direct_asset_review` and on the owner's Direct sales desk, and the owner resolves it once by writing `music_direct_orders.asset_version_id` to a version of that same offer; the entitlement follows. Nothing is silently assigned today's file. Production preflight at v1 (2026-10-31) recorded zero orders; the live count at apply time decides whether this list is empty.

Re-applying `20261031180839_music_direct_sales_v1.sql` after this file would restore its older guards and claim function; re-apply this file afterwards if that is ever done. A legacy inactive offer outside the private-path contract keeps a version row for its old orders but no current pointer (writing one through the row would trip the NOT VALID check), so no new order can be placed on it.

## Proof run (isolated PostgreSQL 16.15, synthetic data, 2026-11-09)

`PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` → `music direct sales: ok`, covering: v1 applied twice; the new behaviour file **fails** on v1 alone (regression bites); backfill of an unchanged-offer order and refusal of an edited-offer order; this migration applied twice; v1 behaviour (unchanged) and new behaviour pass; both rollbacks; legacy inactive offer preserved; re-apply of both; both behaviours again. `node --test scripts/test/music-direct-sales.test.mjs`: 23/23.

## Follow-up, 2026-11-10: the buyer's retry key (source only; not published)

Receipt item 6, first half. `js/music-purchase.js` now sends `attempt_key`. It is a static file: it takes effect when the site is published, and nothing in Supabase changes (v42 already accepts the key).

What the applied SQL does with a repeated key, which is what the page is built against:

| Attempt state when the key arrives again | Answer |
| --- | --- |
| never seen | a new attempt (counted once a URL is issued) |
| `reserved`, hold still live (120 s; the handler passes no hold) | 200, `replay: true`, the same attempt, then counted once |
| `issued`, inside 300 s of issue | 200, `replay: true`, a newly signed URL, nothing more counted |
| `issued`, past 300 s | 409 `attempt_spent` |
| `released` (signing failed, or settlement refused) | 409 `attempt_spent` |
| `reserved`, hold lapsed | 409 `attempt_spent` |
| purchase revoked, refunded, expired or unresolved | that refusal, decided before the key is looked at |

The page: a fresh random key for every deliberate download; the same key again while the outcome is unknown (no network, no answer in 20 s, a 5xx, an unreadable body, or a 4xx that does not carry one of the function's own refusal reasons, such as a gateway's 429, 404 or 401), with the buyer told the download may or may not have been counted and that trying again in the next few minutes will not use another; no key once a URL or one of the function's refusals came back. The unresolved key is kept per purchase token in `sessionStorage` (this tab's reloads) and `localStorage` (another tab on the same kept link finds it) for 20 s + 120 s + 300 s after its last send: the longest the server could still answer it. That bound is deliberately generous: a key kept too long costs nothing (the server answers `attempt_spent`, which takes no slot), a key dropped too early could cost a second download. The page's list of the function's refusal reasons is tested against `REFUSAL_HTTP`, so a reason added there without the page fails the suite.

After a first-send `sign_retry` the page remembers the failure for 20 s + 120 s. The handler answers `sign_retry` even when releasing the hold failed, and a live hold counts against the limit, so a 429 `download_limit` in that window may be the failed attempt's slot, which frees itself within its 120 s hold: the page says an earlier attempt may still be finishing and keeps the button. After the window the limit is taken at its word.

Two things in v42 the page works around rather than relies on:

- 503 `sign_retry` echoes `attempt_key`, but the attempt it names was just released, so sending that key again answers 409 `attempt_spent`. The page drops the key on a first-send `sign_retry` and starts a new attempt.
- The same 503, on the retry of an attempt that was already issued, says "Nothing was used" although that attempt stays issued and counted (an issued attempt is never released). The page keeps the key in that one case and says the outcome is not known.

Limits, stated rather than hidden: another browser or device has no kept key; a retry later than the window is a new download and the lost one stays counted; a replay signs a new URL (receipt item 7).

Coupling: the page needs `music-direct-access` v42 or later. An older function ignores `attempt_key` and counts every request, so a page that says a retry "will not use another download" would be wrong against it. Rolling the function back below v42 means publishing the earlier `js/music-purchase.js` too.

Proof (synthetic, local): `node --test scripts/test/music-purchase-retry.test.mjs` (18); `PGLITE_MODULE=… node scripts/test/music-direct-buyer-recovery.integration.mjs` (12 scenarios: the real page script, the real handler source and the applied SQL on PGlite, PostgreSQL 17.5); `node scripts/e2e/music-direct-checkout.e2e.mjs` in Chromium at 390px with fixture answers. No production request, purchase or download.

Receipt item 6, second half (claim and status still name a purchase after the live offer's title and format) is prepared as an Edge source candidate and is **not in this branch**: the committed `music-direct-access` sources stay byte-identical to deployed v42, and any change under `supabase/functions/` that reaches `main` is deployed by `.github/workflows/supabase-functions-deploy.yml`.

## Not verified

Real Storage bytes for a signed URL; production apply, receipt and schema snapshot; a live purchase, refund or buyer retry; Edge deployment; the live-ledger count of orders that will land in `music_direct_asset_review`.
