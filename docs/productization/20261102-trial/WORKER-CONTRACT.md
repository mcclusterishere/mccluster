# Annual registration / included platform trial — local draft

This extends checkpoint cded251cc3430ccc1c5f43baf349b774984e172a. No production application or activation. The previous v4 source and master prompt remain available. This is a bounded backend contract, not a claim the whole platform or live domain checkout works.

## Existing authority

Reuse creator_domain_orders/quotes/contacts and the verified funded event; existing orgs/org_members and active primary M identity; platform_apps; creator_billing_subscriptions. The separate Whip tenants/operator_members IDs are not interchangeable with org IDs. No parallel checkout, ledger, subscription or app catalog is created.

The new private tables are policy, explicit app mapping, immutable registration/trial receipts and operation idempotency receipts. No policy or prices are seeded. Proposed policy requires an explicit registration_verified trigger, calendar_month_utc or fixed_30_days duration, once_per_org eligibility, freshness limit and sandbox permission. These are reviewable choices, not silently selected business policy. Calendar month uses UTC month arithmetic with month-end clamping; 30 days means 720 hours. Trial starts at successful server verification, not checkout payment or the browser clock, and ends no later than verified registration expiry.

## HTTP and trusted service boundary

All new HTTP routes require CREATOR_DOMAIN_TRIAL_ENABLED=true and database configuration; otherwise 503 without network activity. This flag remains unset. Every request validates Supabase Auth, rejects anonymous sessions and derives the owner from the session. Existing SQL checks active canonical identity and org ownership.

* GET /v2/platform/apps/{app_key}/access?org_id={uuid}: returns the database capability projection. base_manage retains existing owner control; advanced and white_label each include allowed/reason. Domain expiry and trial expiry are distinct. hosting.allowed is null with economics_policy_unresolved. No unlimited hosting promise.
* POST /v2/platform/domain-trials/{order_uuid}/cancel with exactly {"org_id":"uuid"}: disables the included trial without cancelling registration, deleting sites/data or cancelling a separate paid subscription. Stable server event key cancel:{order_uuid}. Repeated cancellation is idempotent.
* There is no public grant endpoint. recordVerifiedDomainTrial is a trusted reconciliation adapter boundary. It requires provider registrant_readback and charge_readback capabilities plus authenticated readVerifiedRegistration implementation. Existing registrar lacks these capabilities, so grant remains blocked. Payment-success or DNS-only evidence cannot substitute.
* requirePlatformModule invokes the service-only SQL authorization RPC and fails closed on denied/malformed/foreign-scope projections. Client-supplied capability booleans never authorize server work.

Successful metadata and errors use private, no-store responses. Service credentials and database/provider error details are not exposed. Cancellation bodies are byte bounded. No provider purchase, billing mutation or automatic conversion occurs.

## Consumer enforcement and limits

When the new flag is enabled, existing customer-social mutating actions additionally require advanced access for an explicit CREATOR_SOCIAL_PLATFORM_APP_KEY. Missing mapping or inaccessible contract fails closed. Disconnect and cancellation remain accessible. Status exposes module_access plus legacy_paid_gate_required; existing paid subscription and provider/database guards remain intact. This deliberately does not activate trial social publishing: its existing private.customer_social_paid guard needs a separately reviewed compatible integration. Other advanced module execution paths must adopt the authorization contract before being marked integrated; UI gray states alone are insufficient. No flag is added to deployment configuration.

Existing account access, owned site controls and draft data are not removed at expiry. The contract does not modify domain orders, site tables, billing events or subscription status. An explicit current price-to-app mapping can recognize an existing active subscription for that app only; no prices or new billing behavior are chosen.

## Review / deployment gates

Pending SQL is local only. Policy selection, app mapping, once-per-org eligibility, hosting limits, trial consumers, registrar authenticated readbacks/settlement, refund completion, DNS/TLS refresh and real annual purchase remain gates. Existing registrar sandbox/live restrictions stay intact. Do not interpret a fulfilled database fixture as observed live provider fulfillment.

Registration retries must replay the original event and immutable evidence; different evidence under the same event is a conflict. A fresh provider observed_at is not the original payload. Persist the original reconciliation evidence securely and use the access/readback contract for current status; never resubmit a paid registrar action to repair a trial conflict.

Promotion requires exact target/schema preflight, aggregate impact, backup/containment review and separate authorization. Containment is disable the Worker flag and policy; preserve receipts and data. Do not drop receipt history as rollback or undo an annual registration. No production SQL, flags, credentials, charges, push, merge or deployment were performed.

Authorization timing: the Worker social restriction checks access before dispatch, in a separate transaction from the existing job mutation. It does not supply an atomic entitlement check inside every module's SQL write, nor drain/cancel already queued work. Those are explicit consumer integration gates before enabling trial-funded execution. Existing recovery/receipt polling must remain possible after expiry; no automatic provider retry or deletion is introduced.
