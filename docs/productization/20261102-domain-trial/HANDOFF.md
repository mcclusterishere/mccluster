# Local domain-trial SQL contract — review only

Base: cded251cc3430ccc1c5f43baf349b774984e172a. Migration `supabase/pending/creator_domain_trial_v1.sql` is PREPARED, locally replayed twice, not applied to production. No policy/module rows are seeded; no payment callback grants access. This is a service-mediated projection and guard, not a new billing system or evidence that Customer Social accepts trials.

Dependencies: existing domain orders/quotes/contacts, active M identity, creator orgs/org_members owner authority, platform_apps, creator_billing_subscriptions. The fixture account authority is explicitly synthetic; catalog DDL is extracted verbatim from replay 0034. Exact input hashes are in `supabase/tests/editor-versioned/domain-trial-hashes.json`. All inputs and replay scripts are tracked. Existing billing/order fixture source has not been rewritten.

## Fixed RPC contracts

All four public RPCs are executable only by service_role and additionally require a service-role request claim. Browser roles cannot directly execute them or read/write the new private tables. New tables have FORCE RLS. Internal helpers, including the controllable-time evaluator, are not service-executable.

* `creator_domain_trial_record_v1(p_owner uuid,p_org uuid,p_order uuid,p_event text,p_evidence jsonb)` returns immutable receipt metadata, excluding evidence. Requires canonical org owner with active primary M identity; fulfilled owner-bound paid order/session/funded event; register action, one-year quote, exact amount/contact/hostname; trusted registration and actual-charge readback. Server verification timestamp starts the trial. No owner/admin equivalence is inferred.
* `creator_platform_access_v1(p_user uuid,p_org uuid,p_app text)` returns scope `{org_id,app_key}`, capabilities `{base_manage,advanced,white_label}` each `{allowed,reason}`, trial state/timestamps/policy, domain expiry/status, and explicitly unresolved hosting. Free account/site/draft control is preserved subject to existing limits. It does not authorize another user's site.
* `creator_platform_require_v1(p_user uuid,p_org uuid,p_app text,p_capability text)` returns the same projection or raises 42501. Use at actual capability execution, not just UI metadata.
* `creator_domain_trial_cancel_v1(p_owner uuid,p_org uuid,p_order uuid,p_event text)` returns cancelled receipt metadata, immediately revoking trial capabilities. It changes no annual ownership, account or site record. A missing receipt returns P0002, not a future cancellation tombstone. Existing canonical order status blocks failed/refund registrations.

Evidence shape (service-only trusted verifier, never browser submission):
```
{source:'verified_registrar_readback', mode:'live'|'sandbox', hostname,
 registration_id, registrant_contact_id, registrant_verified:true,
 charge_verified:true, registrar_cents, currency:'USD', term_years:1,
 registered_at, expires_at, observed_at}
```
Timestamps must be finite. Observed evidence must be fresh under policy and not in the future; registration cannot precede funding or follow observation. No unsupported evidence keys. Sandbox requires explicit policy approval. Registry evidence is a trusted service assertion; SQL cannot independently call a registrar or establish its authenticity. Do not weaken this into frontend assertions or payment-success evidence.

Event keys are bounded nonempty text (including `cancel:<order uuid>`). Retries MUST replay the original exact immutable evidence/event. Changed observation timestamp is changed evidence and returns PT409; subsequent status reads use access RPC. New event with identical receipt evidence cannot extend trial. Same event reused for a different operation/owner/order/payload is PT409. Receipt and event updates/deletes/truncation are guarded; cancellation is the sole one-way receipt update.

## Policy decisions and containment

An administrator-reviewed policy must explicitly choose calendar_month_utc or fixed_30_days, freshness window, catalog app/capability membership and sandbox permission. `once_per_org` is a PROPOSED draft eligibility rule, not an owner-approved commercial decision. There is no policy seed or activation. Calendar duration uses UTC calendar arithmetic (January 31 clamps to February end); fixed duration is exactly 720 hours. Start inclusive, end exclusive; trial expiry is capped at verified registrar expiry. Annual registration expiry remains separate and is not extended by trial/retry/cancel. Current order refund_required or other nonfulfilled status blocks trial capabilities while retaining receipt.

Paid access is optional and requires an explicit current-policy app→Stripe-price mapping and an existing same-owner/same-org active subscription with future period end. An arbitrary active subscription, trialing status, different module or different org grants nothing. A qualifying paid module can remain allowed after trial cancellation/expiry under its own entitlement; it does not extend domain ownership or trial. No price, renewal fee, automatic paid conversion, payment execution, hosting guarantee or live provider activation is introduced.

Before any production approval: reconcile actual schema and permissions; review existing rows and proposed policy/module mapping; back up relevant identity/order/quote/contact/catalog/billing metadata and receipt/policy tables without dumping customer payloads. Apply only exact reviewed dependency chain in a transaction. The new migration does not sanitize/delete existing data. For containment, disable policy and Worker feature flag, preserving receipts/history and all sites. Do not roll back by deleting receipts or dropping tables after real grants. Existing independent paid-only customer_social trigger is unchanged and remains a separate integration gate.

## Verification

Run `node scripts/test/domain-trial-db.mjs` with pinned PGlite 0.5.11, optionally setting PGLITE_DIR to the installed editor-tools node_modules directory. Run `python3 scripts/test/domain-trial-native.py --docker` for network-disabled pinned PostgreSQL two-connection races. Docker runner creates/removes its own scratch container/database; it never accepts a production URL.

Coverage: migration replay, exact fixture hashes, RPC and table privileges, actual browser denial, cross-org and suspended identity denial, default-off policy, funded-only rejection, evidence mismatch/staleness, exact replay/collision, cancellation and missing receipt, no extension, UTC leap/month-end/fixed duration, start/end boundaries, domain expiry cap, refund_required denial, mapped paid prices and same-org scope, retained drafts/registration metadata, append-only guards, transaction failure rollback. Native race: duplicate grant exactly once; concurrent record replay/cancel leaves cancelled state; mutated evidence conflict. Combined checkpoint also executes the actual Worker handlers through these SQL RPCs: 103 SQL/Worker assertions pass. Auth transport is synthetic; this is not a live Supabase/browser test.
