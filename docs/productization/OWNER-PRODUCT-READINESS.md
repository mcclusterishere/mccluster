# Owner product/widget readiness

Control → System → Apps (`control.html#system:apps`) consumes
`GET/POST /v1/owner/product-widgets`. This is a read-only registry inspection
workflow, not an authorization endpoint for product data or a settings publisher.
The owner can list registered apps, inspect each widget, simulate an approved plan
presentation and download the evidence. Missing policy is unconfigured, never free
access. Missing enablement evidence is unavailable. System remains internal.

The endpoint verifies the real house owner and enabled membership in the selected
workspace before reading registry metadata. Widget decisions then use the canonical
product-widget access helper, including role capabilities and subscription evidence.
The resource adapter authorizes only the selected registry record; downstream
product actions MUST independently use `requireAccess` with their own resource and
licensing checks. Presentation simulation never authorizes an action. Responses are
private/no-store, and the UI clears evidence on account changes. No registry settings,
price identifiers, credentials, or subscription records are returned.

## Configuration boundary

The proposed reviewed metadata namespace is
`platform_apps.settings.widget_access_v1 = { version: 1, widgets: { widgetId: policy } }`.
Each policy follows `PRODUCT-WIDGET-ENTITLEMENTS.md`: capability, configured boolean,
kind (`internal`, `included`, `subscription`) and, for subscriptions, approved plan
codes mapped to existing CREATOR_* price binding names. Maximum 16 widgets per app.
Only already valid available/locked subscription decisions expose preview choices.
No catalog entries, mappings, prices, SQL or environment bindings are installed by
this change. No metadata editing API is exposed. Existing arbitrary registry metadata
must not become authorization authority for product actions without a separate review
of its writer permissions, validation, versions and publication controls.

## Remaining product and release decisions

The existing billing schema has one subscription per organization and its webhook
records the first item. Decide whether products share a bundle entitlement or need
independent module purchases; the latter requires a reviewed multi-item/schema and
webhook migration. Approve product/widget/capability/plan mappings and which features
are included. No tier or price is inferred here. A future owner editor needs validated
draft, private preview, explicit publish, history and restore for those approved
mappings, with canonical writer authorization. This inspector does not substitute
for that workflow or claim the entire platform is ready.

Ship the Worker endpoint and static assets together (Worker first is safe). An older
Worker yields a visible retryable failure, never an access grant. Rollback the assets
and endpoint together; there is no schema or billing rollback. Coordinate the two
small Control hooks with Admin and use the release coordinator for deployment.
#741 and its schema rollout are unrelated and untouched.

## Verification

`npm test` in workers/mccluster includes handler and canonical authorization tests.
`scripts/e2e/control-product-readiness.e2e.mjs` runs the real Control page/scripts
with intercepted synthetic network responses at 390px and 1280px: locked decisions,
non-granting preview, export, unconfigured state, failure/retry, account invalidation,
layout and script errors. These browser fixtures do not prove live database policy,
owner login or production deployment. No production writes are needed for the tests.
