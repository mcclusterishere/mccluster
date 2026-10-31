# Storefront to canonical commerce adapter — staged

The storefront product/order records are the fulfillment detail, while the existing #396 `work_orders` / `work_payments` ledger remains the canonical sale/payment/receipt authority. This change does not create a second accounting ledger or a new receipt endpoint.

## Contract

- Store reservations now persist test/live mode. Verified paid/refund callbacks carry Stripe's signed event mode; SQL rejects account, intent, session, amount, currency or mode substitution.
- Pending `20261026009500_creator_store_commerce_adapter.sql` installs a transactional trigger on the existing storefront order. A payment update calls the existing `commerce_record_stripe_checkout` using the immutable seller org, Checkout session and PaymentIntent. Store and canonical mutations commit or fail together. Same provider keys reuse the canonical records; conflicting historic amounts/modes fail closed.
- The canonical sale uses `source_table='stripe_checkout'`, so existing receipts and commerce summaries see it. Seller org stays explicit: connected seller proceeds never become house revenue. It does not create platform transfers, wallet balances or creator-earning payouts.
- Cumulative refunds use existing reconciler v3 `commerce_record_stripe_refund`; smaller/older events cannot lower refunded money or restore a sale. A refund before the storefront's paid intent is persisted fails without marking its event processed; provider retry after payment commits succeeds.
- Live storefront sales create one canonical fulfillment task. Store owner fulfillment updates that task and the same work order. Sandbox payments create no real lead, task, booking or outbound message. Services get a follow-up task, not an invented appointment or automatic scheduling.
- Storefront tagged events are skipped by the legacy Edge mapper. Guard wrappers also reject known storefront session/intent keys through generic reconciliation when metadata is changed/removed. Only the validated storefront trigger sets the transaction-local authorization context. Generic non-storefront reconciliation is preserved. Missing/edited metadata can require reconciliation rather than bypass identity checks.

## Deployment requirements — none executed

Review/apply the existing #396 pending `supabase/pending/commerce_stripe_reconciler_v3.sql`, then storefront09300, then adapter09500. Adapter installation explicitly rejects a missing v3 helper. **Do not reapply v3 after09500:** it would replace the guarded entrypoints; future reconciler revisions must preserve/rebase these guards. Both files remain pending and no ledger was promoted.

Deploy the corresponding creator Worker callback changes and legacy Edge mapper guard together. Existing root route registration is unchanged. Keep store/live flags disabled until this schema and provider event routing are verified. Historical storefront data, if any, needs a separately reviewed reconciliation run; this migration performs no automatic backfill. Duplicate historical canonical provider identities are rejected for investigation.

## Evidence

`scripts/test/creator-store-commerce-db.mjs` executes the actual canonical v1/v2/v3 reconciler SQL plus storefront and adapter migrations against minimal fixture tables in PGlite. Covers two seller orgs and house separation, test/live isolation, duplicate deliveries, early-refund retry, decreasing/out-of-order refunds, full refund followed by late paid event, exact canonical receipt, fulfillment tasks, generic-routing bypass refusal, ordinary commerce preservation and transactional rollback on conflicting canonical data. Existing store SQL/Worker/signed-event tests and canonical mapping tests also pass. This is local database/handler evidence, not real Stripe activity, production schema verification or multi-connection load testing.
