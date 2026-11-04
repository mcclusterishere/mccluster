# Product widget access: consumer contract and billing boundaries

Status: bounded server-side composition for review; no HTTP route, plan catalog,
product, price, subscription change, migration or UI is activated. The existing
#741 SQL-first owner-editor branch is independent and unchanged. Active #745
navigation and Chemistry/island/music UI files are untouched.

## Existing canonical authority (source inspection)

- `workers/mccluster/src/creator-entitlement.js`: authenticated
  `GET /v1/creator-billing/entitlement` reads the caller's subscriptions and returns
  `{paid,workspaces:[{org_id,price_id,current_period_end,cancel_at_period_end}]}`.
  Active and unexpired only. This is not resource permission or a widget catalog.
- `supabase/migrations/20261009204152_creator_billing_subscriptions_v1.sql`:
  `creator_billing_subscriptions` has subscription/customer/owner/price/status/
  expiry/cancel/org fields. `org_id` is UNIQUE. Browser table grants are revoked.
  `creator_billing_events` and `creator_billing_apply_stripe_event` provide the
  service-only webhook ledger. Do not write subscription truth from a plan picker.
- `creator-billing.js`: existing Checkout accepts starter/plus/pro/business and
  monthly/annual price environment bindings. These existing names are not a
  decision to sell any new tab at those tiers or any dollar amount.
- `creator-billing-webhook.js`: verifies signature, retrieves current subscription,
  validates configured price, persists first subscription item through the existing
  RPC. Lifecycle/invoice events are present. Refund/dispute/fraud entitlement policy
  and webhook completeness require review before any new paid rollout.
- `workspaces.js` `requireMembership`: verified user's membership in enabled org.
  `lib/capabilities.js` `requireCapability`: existing control_role_capabilities grant
  matrix. Resource ownership remains the owning route's check, never UI hiding.
- Creator publication/cohort grants are specific publishing entitlements, not a
  universal subscription. Music entitlements are purchases/rights, not tab access.
  `seek-first/entitlements.js` enforces source licensing: buying a module does not
  override its source-use or redistribution restrictions.
- `/v1/platform/plans` reads API-credit plans, not a product/widget tier registry.
  Do not repurpose credits or inferred navigation tabs as commercial entitlements.

**Model constraint:** one subscription per org plus first-item-only webhook storage
cannot represent independently purchased module subscriptions or a multi-item
subscription. This adapter supports approved feature mappings within that existing
single-plan model only. Independent modules require a reviewed extension of the
canonical billing ledger and webhook reconciliation, not a parallel billing system.
No such migration or product decision is included here.

## Contract for the navigation/island coordinators

`workers/mccluster/src/lib/product-widget-access.js` exports
`createProductWidgetAccess({catalog,authenticate,authorizeResource,authorizeInternal,authorizePreview})`.
All adapters/catalog are trusted server composition, never browser-provided claims.
Authentication must use the owning route's existing verified bearer/session path.
Resource adapter must query/check the actual tenant-owned resource and requested
operation, returning true only if authorized. Internal and preview adapters must
use existing house-owner verification, not a submitted role or email.

`inspect(request,env,{orgId,productId,widgetId,resourceId,previewPlan?})` returns:

```json
{
  "contract": "mccluster-product-widget/v1",
  "product_id": "<approved product id>",
  "widget_id": "<approved widget id>",
  "org_id": "<authorized workspace>",
  "resource_id": "<requested resource or null>",
  "state": "available | locked | unconfigured | forbidden | unavailable",
  "allowed": false
}
```

- `available`: all required server checks passed at this instant.
- `locked`: configured subscription rule is not satisfied; do not invent a price.
- `unconfigured`: catalog, feature readiness or required price mapping is missing.
- `forbidden`: tenant/resource/capability/internal authority denied. An upgrade must
  never imply it will grant access to somebody else's resource.
- `unavailable`: authorization/billing evidence could not be obtained or was malformed.
  This is not a locked upsell. Authentication failures are 401 exceptions.

The future HTTP adapter must use private/no-store responses and bound request fields.
No endpoint is claimed to exist. Treat this response as presentation, not a reusable
access token. Every underlying data/action route must call `requireAccess` with its
own resource/action policy immediately before the operation and retain SQL/RLS gates.
`requireAccess` rejects presentation-preview input and throws 403/503 when denied.
Long-running jobs need an additional permission/entitlement check at execution.

Catalog shape, provided only from reviewed server configuration:
`catalog[productId][widgetId] = {kind,configured,capability,plans?}`.
Kinds: included, subscription, internal. All require tenant/resource/capability checks.
Subscription plans map approved plan codes to existing creator price environment
binding names; no raw request price or role is accepted. Missing mappings fail closed.
The subscription is scoped to verified workspace, allowing explicitly authorized
staff to use the workspace's plan without pretending they own its billing account.
There is no owner subscription bypass. System rejects subscription/included mappings
and requires internal house-owner authority; it is not a sellable product by default.
Analytics/globe variants remain unregistered until their product policies are approved.

## Owner plan presentation without changing access

Only the house-owner presentation adapter can request a registered `previewPlan`.
The ordinary resource/capability checks still run first. A successful presentation
request adds `{presentation:{plan_code,state:'available',simulation:true,grants_access:false}}`
while retaining the actual `state` and `allowed`. It only represents a plan listed as
eligible in that widget's server policy. Unknown plans are rejected. It never
changes subscription records or grants, and cannot authorize the underlying action.
The UI must label the simulation; do not replace `allowed` with presentation state.
This is a server primitive for the existing owner-controls workstream, not a new
owner panel or live plan editor. Policy editing/versioning/publish controls remain
required before consumer rollout; use existing configuration controls once selected.

## Missing product decisions and release gates

Need approved stable product/widget IDs; included vs paid features; existing bundle
vs independent-module billing; billing account and tenant scope; tier/price mapping;
trial/past-due/cancellation/refund/grace behavior; provider readiness and licensing;
and the owner-controlled catalog/version/preview/publish workflow. No prices or tiers
are invented here. Tax registration/tax handling is a separate billing rollout gate;
this slice does not enable automatic tax or charge anyone.

Before activation: wire owning endpoints to authenticated adapters, test real
resource-denial paths and current billing ledger/grants, retain existing licensing
checks, review webhook freshness/risk events, and obtain separate release approval.
The current capability helper caches grants for 60 seconds; this slice does not
claim instantaneous grant revocation or alter that existing policy. No entitlement
response is cached here. Multi-product billing needs its own schema/migration review.

Tests use isolated HTTP fixtures and actual membership/capability helpers; all
network requests are asserted to be GETs to the synthetic database origin. They
cover foreign/disabled tenants, roles/resources, absent/configured/broken billing,
expiry/status/price checks, owner presentation, and internal System isolation.
They are not production Stripe, SQL/RLS or end-to-end UI acceptance.
