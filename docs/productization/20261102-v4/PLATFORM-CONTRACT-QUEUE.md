# Platform-first backend queue — source-qualified requirements

Scope: the platform is the product. Free website builder is the acquisition entry. A separately paid annual domain can include one month of platform access; individually purchased modules follow. Trial expiry retains customer site/data/control while advanced/white-label modules disable. No financial activation is authorized here.

## Canonical boundaries inspected on exact681

- `creator-entitlement.js`: owner_user_id filters creator_billing_subscriptions; isActiveSitePlan requires status=active, non-null org_id and future current_period_end. It does not model trialing or per-module grants. Its result must not be repurposed into annual domain ownership.
- `customer-site-modules.js` / `customer_site_modules_v1.sql`: own source_kind/source_key configuration for world/world_discovery. Not tenant paid entitlements, admin catalog, module dependencies or a trial ledger. Site required, advertising inert; global M Account membership is independent.
- `creator-billing-webhook.js`: current provider subscription readback and canonical event commit are existing authority to reuse. Do not create a second billing webhook/state source.
- Identity remains separate: Auth user UUID→active primary M link; projects require both UUIDs and immutable project ID; org membership is separate. Do not guess tenant_id from org_id/M ID or give ordinary owners Control admin access.

## Exact contract requests before coding business policy

1. Map the canonical tenant/site/project/org linkage and existing catalog, price and grant records. No new identity/table design until actual-schema/source reconciliation identifies the gap. Specify tenant-scoped admin catalog authorization separately from per-owner configuration.
2. Domain order authority must retain exact annual term, quoted hostname/action/years/currency/amount, registrant consent/contact version, provider request/result identity and current registration readback. Domain ownership must survive platform trial expiry; hosting funding and renewal are separate terms.
3. Bounded trial grant must be idempotently linked to a qualifying registrar-confirmed order and correct tenant. A charge or quote alone cannot grant ownership or count as registration. Trial eligibility/start, calendar semantics and included modules/resource limits are unresolved. No fabricated automatic conversion.
4. Module entitlement evaluation must enforce on every protected API/job as well as UI. Preserve configured choices and customer data while unavailable. Dependencies/version compatibility, disable/drain and in-flight job behavior need explicit semantics. Base site control is retained; no invented indefinite funded hosting.
5. Renewal/purchase/cancel/refund recovery must preserve the existing provider event/account/order/session/amount/currency checks and audit. Module purchase affects only its authorized tenant/module/period. Explicit consent and prices must exist before charging. Read-only/export/retention details remain decisions.

Acceptance: two tenants and admin; exact qualifying-order grant once; duplicate/reordered provider events; trial boundary with retained site/data; advanced API denial; no domain forfeiture on module expiry; no escalation to admin; cancel/refund recovery; public privacy and owner access retained; database transaction rollback; no unapproved charges. Unknown/pending entitlement must fail closed for paid operations without erasing data.

## Operational domain gates (parent independent681 audit, reconciled with local source)

Existing factory rejects live purchase mode. Cloudflare adapter reports charge_readback=false and registrant_readback=false; reconcile remains registered_pending_reconciliation. A fresh price is not a provider-enforced maximum charge. NameSilo helper is not a complete replacement. Renew/auto_renew are false. refund_required is a state, not completed refund; domain refund settlement remains missing. No purchase→trial grant currently exists.

Hosting remains CNAME-only/apex_verified=false, and routing expires24h after manual verify without authoritative scheduled refresh. Availability cache6h is not a reservation. Preserve encrypted contacts, owner consent expiry, idempotent checkout, verified webhook, durable registration claim/submission marker and status-only uncertain recovery. Never blindly resubmit an uncertain registration.

Configuration names exist (registrar account/token, contact keyring, terms/markup, Stripe webhook, custom-hostname zone/token/CNAME flags). Subsequent scoped read-only deployed mccluster inspection found all18 candidate bindings absent from44 returned bindings; see ../20261102-domain/evidence/deployed-binding-metadata.json. This is deployment-specific, not credentials absent globally. Do not alter bindings. Enabling a live flag cannot repair missing provider settlement/ownership evidence.
