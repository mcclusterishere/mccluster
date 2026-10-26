# Customer Instagram connections (draft, not deployed)

`customer-social.html?org_id=<uuid>` uses `js/customer-social.js` and the existing M session and shared bar. World posts remain unchanged. This feature supports Instagram Professional accounts linked to Facebook Pages and Reels only. Other external platforms and personal Instagram accounts are not represented as supported.

## Integration

Mount `handleCustomerSocial(request, env)` from `workers/mccluster/src/social/customer.js` in the canonical platform entry before the generic API fallback; return its non-null Response. The wrapper validates the session through Supabase Auth; each operation checks organization owner membership. Do not call the internal `handleCustomerSocialRequest` with browser-supplied user identity. Existing preflight handling supplies CORS. The response is private/no-store. Static UI remains on Matthew's property, consistent with existing session handoff.

GET `/v1/customer-social/status?org_id=...` returns `{org_id,provider,configured,blockers,connection,supported}`; status is read-only. Connection exposes only account UUID, handle, state, connection time and expiry. GET `jobs` lists the tenant's latest 50 customer submissions without provider errors/tokens. POST routes: `connect`, `complete`, `select`, `disconnect`, `uploads`, `publish`, `jobs/:id/retry`, `jobs/:id/cancel`. All receive `org_id`; OAuth state binds authenticated user and organization and expires after ten minutes. Connect returns a fixed-provider authorization URL; complete returns safe Page choices; select verifies the Page against the authorized server-held token before installing it.

Connect, OAuth completion, upload, enqueue and retry require an active, unexpired organization subscription owned by the actor in `creator_billing_subscriptions`. Status, disconnect, cancellation and job history remain available after plan expiry. A database trigger also enforces the paid boundary on queued/processing writes through legacy social controls for customer-connected organizations. The canonical Vault token loader rechecks the private customer connection registry, organization match, subscription and feature flag before cron can read a customer credential. Operator-managed credentials retain their existing publish entitlement policy. Direct authenticated writes cannot set or replace credential pointers in org_channels; canonical service-role configuration remains supported. This also closes the existing ability for an org owner to name another operator’s allowlisted environment credential. No membership approval policy is changed.

## Required approval/configuration before activation

1. Review/apply `supabase/pending/customer_social_selfservice.sql` to the canonical Supabase project and record the actual ledger version. It requires existing org/member/social tables, the social publishing lease migration, private `social-outbox` bucket, Storage metadata and Supabase Vault. No migration was applied remotely.
2. Approve a Meta application for Facebook Login for Business/Instagram publishing with `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`; satisfy required app review/business verification and register the exact HTTPS callback `https://matthew.mccluster.org/customer-social.html`. No application, permissions or credentials were provisioned during implementation.
3. Supply `META_APP_ID`, secret `META_APP_SECRET`, `CUSTOMER_SOCIAL_REDIRECT_URI`, and compatible `META_GRAPH_API_VERSION` (default v26.0, matching existing publisher). Only set `CUSTOMER_SOCIAL_ENABLED=true` after staging verification. Absent settings show unavailable. Use a Meta test app/test users for provider validation, not real customers.
4. Existing canonical Instagram queue scheduler must be enabled and configured for its normal Vault/Storage access. New jobs reuse its leases, signed private media links, container polling, retry behavior and terminal states; no second publisher/scheduler exists.
5. Review static-host registration and app callback session continuity in a browser. Approve a separate production release only after migration, backend and UI have passed staging with permitted test accounts.

## Credential/recovery semantics

User token is held only in Vault for the short account-selection step. Installing the chosen account stores its Page token in Vault and atomically replaces that organization's `org_channels` binding; old staged and replaced secrets are deleted. Operator-managed bindings are never silently replaced. Tokens and provider error payloads never return to customers. Expired selection secrets are removed on subsequent tenant mutations and by the existing publishing cron when CUSTOMER_SOCIAL_ENABLED is configured (including false). Tenant deletion also removes credentials through cleanup triggers.

Reconnect rotates the token. Account switching or reconnect is refused while queued/processing jobs exist; cancel unclaimed jobs or wait for processing first. Disconnect cancels queued/draft/failed jobs, removes the org binding and Vault secret, and refuses while a leased/processing job could already hold a token. It **does not revoke the user's provider-wide app permissions**: that would also affect their other organizations. UI explicitly links Facebook Business Integrations for this broader user action. Local disconnect is not a claim of remote permission revocation or deletion of posts already published.

Publish requires an uploaded object in the tenant's private folder, allowed video MIME/size and a stable request key. The database atomically enforces idempotency; a changed payload with the same key conflicts. The browser retains that key across network retries within the page. Reloading the page loses the key; inspect delivery history before resubmitting. Provider timeout-after-publish ambiguity remains governed by the existing publisher's container reconciliation; this change does not claim exactly-once delivery from Meta.

## Evidence

- `node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/customer-social.test.mjs workers/mccluster/test/social-outbox.test.mjs`: 31 passing tests, including existing container retry behavior.
- `PGLITE_MODULE_PATH=<scratch>/@electric-sql/pglite/dist/index.js node scripts/test-customer-social-db.mjs`: PostgreSQL fixtures execute the pending migration and test two owners/tenants, role denial, consumed state, selection isolation, secret replacement/deletion, incomplete upload, idempotency conflict and active-job protection. Vault is a local fixture; encryption and real Meta behavior are not tested.
- The expanded social suite has 42 passing tests, including canonical credential gating after subscription expiry and operator compatibility.
- No real customer, credentials, provider post or production database change was created. Full provider OAuth/publish and production readiness remain unverified.

Official references consulted (2026-10-26):
- https://developers.facebook.com/documentation/instagram-platform
- https://developers.facebook.com/documentation/instagram-platform/content-publishing
- https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/graph-api/reference/user/permissions/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

Some Meta full-document fetches returned HTTP 429/inaccessible; official search extracts were available. Verify the registered app's supported login product, scopes and long-lived token behavior in Meta's test environment before activation.

Local browser check: Chromium at 390×844 confirmed document width and scrollWidth both 390, configured-unavailable state disabled Connect, and `mcc:auth-changed` refreshed readiness. External network was blocked during this check. This is not a completed provider OAuth browser test.
