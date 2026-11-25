# Direct music sales: pinned purchases and settled downloads — 2026-11-09

**Status (corrected 2026-11-10): applied to `zmnhbrjyhxzhkxmhkexs` on 2026-11-09 as `20261109175747`, with Edge `music-direct-access` v42, by the owner's release workers. The source for that is their receipt (`docs/control-plane/evidence/releases-2026-11-09/COMMERCE-RELEASE-RECEIPT.md`); the committed migration and Edge files equal the receipt's hashes, `supabase/production-ledger.json` lists the version, and the 2026-11-09 production schema snapshot records the migration's md5. Nothing else was checked against production from this branch. Per the receipt, no real purchase, refund or download was made. This note was first written for the branch draft, before that release; the sections below say where it has been corrected.**

Repairs two findings of the 2026-11-09 deep audit (`06_DEFECT_LEDGER.json` COM-1, COM-2) in the direct-sale path introduced by `20261031180839_music_direct_sales_v1`.

| Finding | Was | Now |
| --- | --- | --- |
| COM-1 paid entitlement followed the mutable offer | `music_direct_claim_download()` returned the offer's *current* `asset_path`; an owner edit changed what an old purchase delivered | every offer write records an immutable `music_direct_asset_versions` row (bucket, path, download name, title); `music_direct_offers.current_version_id` points at it; an order snapshots `asset_version_id` at insert (immutable), the entitlement inherits it, and delivery reads the version row. Edits only affect future sales; reverting to an earlier file reuses its version row. |
| COM-2 Storage signing failures consumed download slots | the count went up in the same RPC that returned the path, before the handler signed; three failed signings spent three slots and the decrement guard blocked compensation | a download is an attempt: `music_direct_reserve_download(token, attempt_key)` holds one slot (live holds count against the limit; lapsed holds are released by the next reservation), the handler signs the *pinned* object, then `music_direct_settle_download(attempt,'issued'|'released')` counts it or returns the slot. The same `attempt_key` returns the same attempt (one slot across a lost response). Issued is final; released is final; `download_count` still only rises and only through settlement; the entitlement guard is unchanged. |

## Files

- `supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql`: **applied in production on 2026-11-09** as version `20261109175747` (SHA-256 `a76d1335…`) with Supabase Edge `music-direct-access` v42; receipt `docs/control-plane/evidence/releases-2026-11-09/COMMERCE-RELEASE-RECEIPT.md`. This is the independently corrected release, not the branch's first draft (`20261109120000_…`, now removed): it locks entitlement before attempt, re-checks refund/revocation/payment/expiry at settlement, releases expired holds, rejects null outcomes and bounds attempt replay to 300 s. Per the receipt, zero orders/entitlements existed at cutover and no real purchase, refund or download was tested.
- `supabase/pending/music_direct_asset_versions_v1.rollback.sql` (restores the v1 guards and one-step claim; the pin record is lost; run before the v1 rollback).
- `supabase/functions/music-direct-access/index.ts`: `download` is reserve → sign → settle; a signing failure settles `released` and answers 503 `sign_retry`; `operator-direct-list` returns `asset_review` (purchases needing the owner's resolution); never calls the one-step claim.
- `supabase/functions/_shared/music-direct.ts`: `ATTEMPT_KEY_RE`, `asset_unresolved` / `attempt_spent` / `sign_retry` refusals, `downloadRefusal()` refuses an unpinned legacy entitlement.
- `supabase/tests/music_direct_asset_versions.behaviour.sql` (new), `scripts/test-music-direct-sales-db.sh`, `scripts/test/music-direct-sales.test.mjs`, `.github/workflows/music-direct-sales-db.yml`.

## Backfill policy (owner decision recorded, not yet exercised in production)

An order placed before this migration is pinned to its offer's current file **only when the offer has not been written since the order was created** (`offers.updated_at <= orders.created_at`), the only evidence this schema holds. Every other paid order stays unpinned: its downloads refuse with `asset_unresolved` (409, nothing counted), it is listed in `public.music_direct_asset_review` and on the owner's Direct sales desk, and the owner resolves it once by writing `music_direct_orders.asset_version_id` to a version of that same offer; the entitlement follows. Nothing is silently assigned today's file. The applied file's zero-order guard (migration lines 41-46) refuses a first application while any order exists, so this backfill runs only when the file is applied again over existing orders. Per the receipt there were zero orders at cutover, so the review list started empty.

Re-applying `20261031180839_music_direct_sales_v1.sql` after this file would restore its older guards and claim function; re-apply this file afterwards if that is ever done. A legacy inactive offer outside the private-path contract keeps a version row for its old orders but no current pointer (writing one through the row would trip the NOT VALID check), so no new order can be placed on it.

## Proof run (isolated PostgreSQL 16.15, synthetic data, 2026-11-09)

On the branch draft: `PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` → `music direct sales: ok`, covering: v1 applied twice; the new behaviour file **fails** on v1 alone (regression bites); backfill of an unchanged-offer order and refusal of an edited-offer order; this migration applied twice; v1 behaviour (unchanged) and new behaviour pass; both rollbacks; legacy inactive offer preserved; re-apply of both; both behaviours again. `node --test scripts/test/music-direct-sales.test.mjs`: 23/23.

Corrections from the close-out verification (2026-11-10):

- That run's backfill fixture applied the draft over existing orders. The applied file refuses a first application while an order exists, so `4989365a` replaced the fixture with a check that the guard does so, and from then on the script did not exercise the backfill: with both backfill conditions (migration lines 119 and 127) replaced by `true`, every suite still passed.
- The "fails on v1 alone" step fails at `music_direct_asset_versions.behaviour.sql:36` because the new table does not exist, so it shows only that the new schema is absent. Run directly on v1, a paid entitlement does deliver the replacement path and title after an offer edit.
- On branch `closeout-tests` (`2b096ebc`, to be integrated) the script tests the backfill on the path that reaches it: v1 re-applied after this file, two paid purchases, one offer's file replaced, this file applied again. The unchanged-offer order and entitlement are pinned and deliver their file; the edited-offer order and entitlement stay unpinned, are the only review row and answer `asset_unresolved`; the owner's one resolution reaches the entitlement and delivers the file that was sold, and cannot be re-pointed. The script exits 0 on PostgreSQL 16.15 and 17.7, and exits 3 when the pin condition (line 127) is replaced by `true` or the comparison in both conditions is reversed.

## Follow-up, 2026-11-10: the buyer's retry key (source only; not published)

Receipt item 6, first half. `js/music-purchase.js` now sends `attempt_key`. It is a static file: it takes effect when the site is published, and nothing in Supabase changes (v42 already accepts the key, per the receipt and the committed source).

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

Two things in v42 the page has to handle (corrected 2026-11-10: this said the page "works around rather than relies on" them, but on a resend it relies on the echo):

- 503 `sign_retry` echoes `attempt_key` on every signing failure (`supabase/functions/music-direct-access/index.ts:297`), including when the failure released the attempt, so sending that key again answers 409 `attempt_spent`. On a first send the page drops the key whatever the echo says and starts a new attempt.
- On a resend the page keeps the key only when the 503 echoes it (`js/music-purchase.js:160`). That is how it recognises the retry of an attempt that was already issued, which the 503 calls "Nothing was used" although that attempt stays issued and counted (an issued attempt is never released): the page keeps the key and says the outcome is not known. Without the echo the buyer's next click would take a second slot. A resent key whose live hold the failure released is echoed and kept the same way; the next click answers `attempt_spent`, the button stays and no slot is used. That case is covered by probes only, not by a repository test, and the page comment at `js/music-purchase.js:156-159` ("the server echoes the key it would still replay") does not hold for it.

Limits, stated rather than hidden: another browser or device has no kept key; a retry later than the window is a new download and the lost one stays counted; a replay signs a new URL (receipt item 7).

Coupling: the page needs `music-direct-access` v42 or later. An older function ignores `attempt_key` and counts every request, so a page that says a retry "will not use another download" would be wrong against it. Rolling the function back below v42 means publishing the earlier `js/music-purchase.js` too.

Proof (synthetic, local): `node --test scripts/test/music-purchase-retry.test.mjs` (18); `PGLITE_MODULE=… node scripts/test/music-direct-buyer-recovery.integration.mjs` (12 scenarios: the real page script, the real handler source and the applied SQL on PGlite, PostgreSQL 17.5); `node scripts/e2e/music-direct-checkout.e2e.mjs` in Chromium at 390px with fixture answers. No production request, purchase or download.

Receipt item 6, second half (claim and status still name a purchase after the live offer's title and format, `index.ts:59-64`, `:124-125`, `:277-278`) is prepared as an Edge source candidate outside this repository (not verifiable from here) and is **not in this branch**: the committed `music-direct-access` sources stay byte-identical to deployed v42 (their hashes equal the receipt's), and any change under `supabase/functions/` that reaches `main` is deployed by `.github/workflows/supabase-functions-deploy.yml`.

## Not verified

Real Storage bytes for a signed URL; a live purchase, refund or buyer retry. From the receipt only: Edge v42 active, and zero orders, entitlements and review rows at cutover. The apply itself is also supported by `supabase/production-ledger.json` and by the 2026-11-09 production schema snapshot (`docs/control-plane/evidence/production-schema-snapshot-2026-11-09.json`), whose ledger row for `20261109175747` has the committed file's md5 (`7d0ea76d…`).
