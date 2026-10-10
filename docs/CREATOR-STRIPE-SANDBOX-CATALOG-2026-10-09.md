# Stripe creator sandbox catalog — 2026-10-09

**Test-mode Stripe account only**: McCluster Corp, `acct_1TrMuQLHDCoUz9Q4`. No live-mode products or prices were created.

| Tier | Interval | Product ID | Price ID | USD cents |
|---|---|---|---|---:|
| Starter | month | prod_VPZreZ9sPvaeUL | price_1UOki2LHDCoUz9Q45NbPfa34 | 750 |
| Starter | year | prod_VPZreZ9sPvaeUL | price_1UOki4LHDCoUz9Q4mo7UQZZG | 6000 |
| Plus | month | prod_VPZrUNuRE5rY0d | price_1UOki6LHDCoUz9Q4Vru7mIsn | 1500 |
| Pro | month | prod_VPZrc9rZlRgBkO | price_1UOki7LHDCoUz9Q4cnr4JbBm | 4000 |
| Business | month | prod_VPZrrZx78XeYjM | price_1UOki9LHDCoUz9Q4QDeeJDOf | 9900 |

Sandbox Worker configuration (secrets must be provisioned through the deployment secret store, never committed):
- `CREATOR_STARTER_MONTHLY_PRICE_ID=price_1UOki2LHDCoUz9Q45NbPfa34`
- `CREATOR_STARTER_ANNUAL_PRICE_ID=price_1UOki4LHDCoUz9Q4mo7UQZZG`
- `CREATOR_PLUS_MONTHLY_PRICE_ID=price_1UOki6LHDCoUz9Q4Vru7mIsn`
- `CREATOR_PRO_MONTHLY_PRICE_ID=price_1UOki7LHDCoUz9Q4cnr4JbBm`
- `CREATOR_BUSINESS_MONTHLY_PRICE_ID=price_1UOki9LHDCoUz9Q4QDeeJDOf`

Plus/Pro/Business annual prices were not created because annual prices for those tiers have not been specified; leave their env vars unset and do not advertise annual checkout.

**Important:** The connected Stripe sandbox is separate from production. Confirm Worker uses sandbox credentials and a sandbox webhook signing secret. The production Worker must not use sandbox secrets or be switched to live billing as part of testing.

Remaining: sandbox webhook endpoint/signing secret, deployment secret configuration, authenticated checkout, test payment, signed event delivery, provisioned workspace, site publishing, cancellation, and CI. Stripe Tax/registration must be assessed before live recurring charges.
