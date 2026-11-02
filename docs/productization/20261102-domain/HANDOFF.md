# Domain purchase gate — local audit and corrective checkpoint

Base: `ed61dd59bc288058ee06a5a7ec560ff35b4518ba`, itself exact PR681 plus the editor/audit patches. Isolated branch `codex/domain-purchase-gate-20261102`. No parent/editor files changed; no production SQL, external payment, registrar operation, flags, push, merge or deployment.

## Outcome

The current product cannot yet deliver a verified real-domain purchase. The existing factory deliberately permits **Cloudflare sandbox only**, and verified funding rejects live mode. Do not remove those guards to make the checkout button work. NameSilo is an incomplete transport helper (`purchasable:false`, no configured contact/ownership implementation), not an alternate ready provider.

Implemented local corrections:

1. Match registrar quote hostname, action, years, explicit available/non-premium flags, USD and exact integer amount at quote issuance and again before submission. Previously an unchanged amount could pass even if availability or identity was wrong. A changed quote never crosses the submit marker.
2. Reconciliation requires exact ownership hostname and finite current registration timestamps. Invalid date comparisons can no longer accidentally pass.
3. Funding SQL requires the server-persisted checkout-session binding. A callback cannot claim an order whose session is still null. Owner, amount/currency/expiry and immutable consent remain checked by existing code.
4. The signed domain webhook returns retryable503 for a funding binding conflict or missing order instead of acknowledging an unrecorded outcome. This handles a webhook racing the checkout write without silently accepting a new session.

The durable claim, unique hostname, pre-submit marker and status-only recovery remain intact. No registration retry is introduced. `registered_pending_reconciliation` still means contact/actual-charge reconciliation is outstanding; `refund_required` does not mean a refund happened.

## Actual operational metadata (read-only)

On November2, completed before `2026-11-02 03:30:18 UTC`, connected Cloudflare account discovery succeeded. For deployed Worker `mccluster` in account `5f38fffbef3a9428dfb771b5008437f8`, GET `/accounts/{account_id}/workers/scripts/mccluster/settings` returned44 bindings. None of the18 exact candidate-required names in `evidence/deployed-binding-metadata.json` was present. A separate GET `/accounts/{account_id}/workers/scripts/mccluster/secrets` returned no matching candidate domain/registrar/creator-Stripe secret names. Only filtered names/types/presence were returned to the agent; no values were logged or saved.

This is evidence about that inspected deployment, not proof that credentials do not exist elsewhere. It does not establish the deployed source SHA or authorize configuring secrets. Candidate names checked include registrar account/token, encrypted-contact key ID/keyring, registration/checkout/execution/sales switches, terms URL/version, markup, Stripe key/webhook, and custom-hostname zone/token/CNAME switches.

## Full pipeline and remaining gates

| Step | Existing authority / concrete gate |
|---|---|
| Domain search and check | Existing domain-check adapter confirms standard price; search/cache is not reservation. New exact-target/term checks are tested. Current recheck is not a provider-enforced maximum-charge agreement. |
| Annual quote and renewal disclosure | years1–10 and exact amount exist; requested one-year product and immutable customer-facing future-renewal disclosure are not a completed contract. Do not invent markup, renewal price or auto-renew consent. |
| Customer identity/contact | Auth user scopes quote/contact/order; inline contact encrypted and consent-bound. Order/contacts/quotes currently require active site plan: incompatible with domain-first trial onboarding until reviewed entitlement contract. |
| Payment | Existing signed webhook retrieves canonical Checkout Session, validates order/user/session/amount/currency. New binding race fails retryably; no transaction executed. |
| Registrar submission | Sandbox only. Runtime bindings absent on inspected Worker. Provider billing authority, reviewed registrar terms and configuration remain unverified. |
| Fulfillment/ownership | Exact account registration alone does not establish customer registrant readback or actual charged amount; adapter reports both capabilities false. Never label payment as registration. |
| Hosting/DNS/TLS | Existing owned target/custom hostname engine reused; CNAME-only, apex unverified. Current provider snapshot expires after24h without demonstrated scheduled refresh. Registration→site-binding is not automatically proven. |
| Receipt/status | Private order/attempt list and status-only reconciliation exist. End-to-end customer delivery receipt needs verified registration, registrant, term/expiry and hosting status; status names remain honest. |
| Failure/refund | Unknown submission never retries. Refund-required/reconciliation states exist, but domain refund completion/receipt workflow is absent; store refund webhook is a separate feature. |
| Renewal/transfer | Adapter renew:false, auto_renew:false; no verified customer renewal/transfer controls. Registrar account control is not yet demonstrated customer ownership portability. |
| Trial/modules | No domain-purchase→one-month tenant trial grant exists. Existing `active` subscription gate does not grant the requested trial. Preserve site/data/control, disable only unentitled advanced modules, keep annual domain registration separate. No hosting-forever inference. |

The platform is the product; builder is the entry door. The requested domain is separately paid and remains registered for its paid year regardless of trial end. The trial's exact start/end, included modules, renewal consent, costs and hosting limits need reviewed contracts. This checkpoint does not invent them or delete customer data when access changes.

## Test evidence

- Entire combined Worker suite with PGlite enabled: **1,338 passed, zero skipped** (`evidence/worker.log`), including actual local SQL composition for the previously skipped suites.
- Three standalone actual-SQL/API replay scripts passed: domain orders, registration-attempt schema, encrypted inline contacts. Provider/Auth/Stripe transports are synthetic; no external operation.
- Native PostgreSQL16 network-isolated two-session tests passed: duplicate funding yields one recorded payment; same-host concurrent claims yield one durable attempt and rollback the loser; same-order concurrent claims yield one submission authority.
- New unit regressions cover unavailable/premium/mismatched domain/action/term quote, invalid identity/dates and retryable webhook binding states.

Run `npm ci --prefix workers/mccluster --ignore-scripts`, install the pinned editor tools from scripts/test/editor-tools, set PGLITE_DIR for the Worker suite and PGLITE_MODULE to the package's dist/index.js for standalone SQL scripts. `python3 scripts/test/domain-purchase-native.py` runs only a new network-isolated disposable Docker database. No production URL input.

SQL change is limited to the existing **unapplied pending** creator_domain_orders_v1.sql function, whose full bytes/hash are recorded in manifest.json. It was replayed from scratch against fixtures. Production application remains separately reviewed, including target/schema and payment callback rollout. This is not a new production migration version or a ledger entry.

## Primary reference verification

Cloudflare's current [Registrar API guide](https://developers.cloudflare.com/registrar/registrar-api/) and connected OpenAPI examples were read: availability check immediately precedes registration; asynchronous202 is not permission to resubmit; registration billing/ownership must remain separate. The documentation and OpenAPI differ in some illustrative workflow identity placement, so this work retains the current OpenAPI-shaped parser and does not claim a live-provider acceptance test. No registrar endpoint was invoked.
