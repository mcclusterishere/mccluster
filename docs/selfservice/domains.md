# Customer domains: implementation and release gates

This branch implements connection of an existing domain. It does **not** enable domain sales, transfers or automatic renewal. Nothing has been deployed or applied to production.

## Integration

- Import `handleCreatorDomains` into the canonical Worker entry. Call before the generic platform API-key guard. Prefix `/v1/creator-domains` needs the existing authenticated browser CORS preflight.
- Import `handleCreatorDomainHost` and invoke before ordinary host/API routing. Pass `{authorizeEntitlement}` to both handlers: an async `(authUserId, env, fetchImpl) => boolean` which reads the authoritative paid-plan entitlement. The default denies access; never use a client flag. Existing canonical hosts return null.
- In `js/front-member.js`, prefer trusted `window.MCC_FRONT_HOST.handle` and `.api` injected by the host adapter over URL query values and the canonical API constant. The adapter serves only the bound public front, uses no incoming credentials, and checks existing published/private/takedown behavior.
- Dashboard URL: `customer-domains.html`. GET returns `{domains,capabilities:{connect,purchase:false,renew:false,reason},cname_target}`. POST `{hostname}` creates a claim. POST `/:id/verify` checks/provisions. DELETE `/:id` disconnects. All management is authenticated and owner-scoped.

## Database and configuration (pending approval)

Apply `supabase/pending/creator_domains_v1.sql` only after review and production schema authorization. It creates a service-only RLS table and an atomic claim lease RPC. No browser role can set ownership or verification. Two pending owners can request the same name, but the partial unique index admits only one verified owner. Old verified claims require explicit removal/support on ownership transfer; this protects against silent takeover.

Require `CREATOR_DOMAINS_ENABLED=true`, `CREATOR_DOMAINS_ZONE_ID`, secret `CREATOR_DOMAINS_API_TOKEN`, and `CREATOR_DOMAINS_CNAME`. A Cloudflare for SaaS zone, fallback origin/Worker route, hostname API permission, and custom metadata support must be configured and validated separately. No such resources or credentials were provisioned by this change. Token scope should be only this zone's custom hostnames. No guessed CNAME target is enabled.

The supported first release is a visible, DNS-only CNAME on a subdomain (such as `www`). Apex flattening and proxied/O2O CNAME records are not supported: the DNS check deliberately does not claim these configurations work. TXT must match the random per-claim value before provider creation. Host activation requires CNAME target, provider hostname `active`, and SSL `active`. Customer sees provider validation records and can retry. Failed disconnect disables local routing before remote deletion. Host routing rechecks entitlement and CNAME every request, failing closed during DNS/service failure. Provider certificate status is last verified; edge TLS terminates before application handling. Provider expiry/change monitoring is still an operational gate.

Remote creation uses claim metadata and recovers exact matches after uncertain calls. A pre-existing provider hostname without this claim's metadata requires support rather than being adopted. The local lease is two minutes; provider I/O times out after 20 seconds. Deletion also takes the lease. An expired lease is recoverable. Claims with stale verified ownership must be cleaned explicitly.

## Domain purchases and renewals: unfinished integration

`src/domains/namesilo.js` provides documented GET transport for base pricing, register and renew, plus a fixture-tested funding/consent guard. No public route invokes it. Supplying `allowLive:true` is **not** a release authorization. With no injected transport it defaults to rejecting calls. Fixtures are local simulated responses, not a live NameSilo sandbox.

Before exposing sales, implement and review:
1. Customer registrant-contact capture/validation, privacy/registration terms and explicit consent; confirm NameSilo reseller setting rejects invalid contact rather than purchasing against Matthew's default contact.
2. Immutable retail quote (domain, availability/premium restrictions, years, currency, total, expiry), persisted owner-scoped orders, and server-verified checkout webhook funding. The store must atomically move `funded` to `executing` and disallow duplicate event/order fulfillment. No browser funding flags.
3. Durable fulfillment/reconciliation, registrar result ownership/contact checks, failed purchase refund workflow, receipt and renewal date management. Renewals require a new funded order and consent; registrar auto-renew is explicitly disabled. Disable automatic restoration at NameSilo before enabling renewals because restoration may cost more.
4. Enable provider sandbox using credentials/endpoint confirmed by NameSilo. Official docs say sandbox access requires requesting credentials from them. No request was sent and no credentials were created. Complete real sandbox contract verification, then request scoped approval before production configuration or financial operations.

Ambiguous registrar timeouts and codes 301/302 are `reconciliation_required`, never automatically retried. NameSilo does not document a registration idempotency key. The scaffold therefore deliberately cannot promise fully automatic recovery for an uncertain financial result.

## Evidence

- `workers/mccluster/test/creator-domains.test.mjs`: offline two-tenant ownership, TXT-before-provision, DNS/TLS progression, provider errors/retry, entitlement denial, disconnect recovery, trusted hostname/private-profile routing, registrar duplicate prevention and fallback contact handling.
- `scripts/test/creator-domain-schema.mjs`: actual pending SQL executed in local PGlite; anon/auth table/RPC denial, wrong-owner claim denied, lease excludes concurrency. Set `PGLITE_MODULE` to an installed module. No remote database used.
- Chromium fixture render at 390 × 844: document scrollWidth and clientWidth both 390. Shared navigation/CSS and production auth were not exercised by that isolated render.
- No live DNS change, hostname provisioning, certificate issuance, checkout, registration or renewal verified.

## Official references checked 2026-10-26

- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/
- https://www.namesilo.com/api-reference
- https://www.namesilo.com/api-reference/pages?uid=domains%2Fregister-domain
- https://www.namesilo.com/api-reference/pages?uid=domains%2Frenew-domain
- https://www.namesilo.com/blog/en/automation/building-a-domain-search-tool-with-a-registrar-api
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Purchase milestone 2: implemented persistence and fixture flow

`creator-domain-orders.js` now implements authenticated, owner-scoped contact registration, quotes, immutable consent-bearing orders, checkout initiation, purchase history and renewal authorization. `customer-domain-purchases.html` provides these customer forms and history with auth-change clearing and stale-response protection. Its controls remain hidden when the complete provider/checkout/terms gate is missing.

Apply the separate pending `creator_domain_orders_v1.sql` only after approval. It denies browser database access, binds each order to that owner's quote/contact, prevents quote/consent identity edits, and provides atomic `fund_creator_domain_order` and `claim_creator_domain_order` RPCs. A mismatched or expired paid quote becomes `refund_required`; duplicate funding does not execute registration twice. A timeout during registration becomes `reconciliation_required` and cannot re-execute. A process crash after the durable `executing` transition similarly requires reconciliation, not automatic retry. Failure to persist a provider result leaves `executing`; support must inspect the registrar before deciding a result.

API prefix `/v1/creator-domain-orders` requires the same pre-key-gate entry and preflight integration. Routes:
- GET `/`: own orders/contact IDs and capabilities (no contact PII).
- POST `/contacts`: contact fields, `consent:true`, current `terms_version`. Provider creation must confirm a provider contact ID; raw contact fields are not retained in McCluster storage.
- POST `/quotes`: `{hostname,action:register|renew,years}`. Standard-price USD only; the provider returns availability, premium status and full-term registrar cost. Renewal checks the customer's previous completed order and current registrar ownership/contact before quoting.
- POST `/`: `{quote_id,contact_id,consent:true,terms_version}`; retry returns the same immutable order.
- POST `/:id/checkout`: obtains the existing/new idempotent checkout session for that immutable order. No second payment after funding.

`recordDomainFunding({orderId,ownerUserId,eventId,sessionId,amountTotal,currency,paymentStatus,paidAt},env,{fetchImpl})` is an **internal** verified-webhook bridge, not a public API. `fulfillStoredDomainOrder(orderId,env,{provider,fetchImpl})` claims a funded order atomically, rechecks registrar price/availability before mutation, then checks registrar ownership, matching registrant and expiry before marking fulfilled. It reconciles mismatching charged amounts. No refund is automatically performed by this module.

Billing integration must inject `createDomainCheckout(order)` with immutable `{id,auth_user_id,hostname,action,years,total_cents,currency,expires_at}` and return `{id,url}`. It must use an idempotency key based on the order ID, set metadata `creator_domain_order_id` and owner ID, verify the Stripe signature and successful paid status, then call the internal funding bridge. Never enable checkout if registrar fulfillment is incomplete.

Additional sales configuration: explicit `CREATOR_DOMAIN_SALES_ENABLED=true`, approved `CREATOR_DOMAIN_TERMS_URL` and `CREATOR_DOMAIN_TERMS_VERSION`, integer `CREATOR_DOMAIN_MARKUP_CENTS`, billing entitlement and checkout helpers, and a complete injected provider with `quote`, `createContact`, `register`, `renew`, `verifyOwnership`. Raw NameSilo adapter is intentionally **not** that complete provider: contact creation, availability/full-term pricing and ownership/contact/expiry response mapping need official contract/sandbox verification before a production factory can be supplied. The available official docs confirm registration/renewal/base-price transports but the contact and domain-info detail pages could not be retrieved (tool error/HTTP 403); their exact response mapping was not guessed. NameSilo sandbox credentials/endpoint remain a separate pending external gate.

`scripts/test/creator-domain-orders.mjs` runs the pending schema and real API handler against local PGlite plus injected provider/checkout fixtures. It covers two tenants, immutable amounts/consent, same-order retries, paid mismatch/refund state, duplicate funding and fulfillment, registrar timeout/no-repeat, post-purchase ownership failure, renewal ownership denial and anon/auth database restrictions. This is a functional **local fixture** purchase flow, not live provider or Stripe sandbox verification. Registration terms and contact data in tests are fictitious; no legal acceptance or customer creation occurred.

## Alternative provider resolution

The current Cloudflare Registrar API and connector spec were evaluated read-only after the implementation milestones. They now expose registration with inline contacts and explicit sandbox endpoints, but lack the documented manual funded-renewal and registrant-read contracts required by this provider interface. No speculative Cloudflare factory was wired. See [Cloudflare Registrar evaluation](cloudflare-registrar-evaluation.md) for exact paths, supported capabilities, missing contracts and authorization gates.
