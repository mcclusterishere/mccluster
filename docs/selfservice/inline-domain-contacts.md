# Inline registrant contacts and disabled sandbox checkout

This bounded change completes encrypted contact intake, schema validation and internal registration/status plumbing. It does not activate registrar service, create a key, enable checkout, submit a contact/domain, or implement renewals.

## Data and keys

Apply pending `creator_inline_domain_contacts_v1.sql` after `creator_domain_orders_v1.sql` and `creator_cf_registration_attempts_v1.sql`. Existing provider contacts remain unchanged. Inline contacts explicitly have `contact_kind=inline`, no provider contact ID and no `verified_at`: encryption and consent are not independent registrar verification.

Encryption uses Web Crypto AES-256-GCM, a random 96-bit nonce, and AAD binding contact UUID, authenticated owner, terms version and normalized-contact SHA-256. This follows the versioned AES-GCM/AAD pattern in `core/src/meeting/target-crypto.mjs`, adapted to Workers and stronger per-record binding. Configuration expects `CREATOR_DOMAIN_CONTACT_KEYS` (JSON key-id to base64-encoded 32-byte key) and `CREATOR_DOMAIN_CONTACT_KEY_ID` (active key ID). No values are generated or provisioned. Rotation retains previous keys for existing ciphertext until that data is erased; no new credential is derived from Supabase or VAPID secrets.

Contacts are immutable except ciphertext erasure. They expire after 30 days. Owners can DELETE `/v1/creator-domain-orders/contacts/:id`; it wipes ciphertext while retaining consent/digest metadata. The service-only `erase_expired_domain_contacts()` function wipes expired ciphertext, tested in disposable PostgreSQL. A reviewed periodic invocation remains an activation requirement; expiry blocks decryption even before cleanup. Removing a saved contact does not undo a registration already submitted. Normal list/status responses expose neither plaintext nor ciphertext, key identifiers or hashes.

## Validation and customer flow

Pinned Worker dependency `@cfworker/json-schema@4.1.1` validates the returned full extension schema without dynamic code generation. Supported declared dialects are draft4, draft7, 2019-09 and 2020-12 (undeclared schemas use draft7). Local references, nested requirements, enums, conditional schemas, formats and numeric constraints are enforced. Unknown dialects/formats, unresolved or remote references and over-limit schemas fail closed. The interpreter has documented optional-format limitations; this is not a claim that every JSON Schema test or registry-specific field is supported.

The provider factory injects that validator by default. Registration requirements are checked before creating an order, again before checkout and before submission. Extensions requiring fields the contact UI does not supply (for example registry-specific acknowledgements) remain unavailable; no invented default acknowledgement is submitted.

Existing contact, quote, order and checkout routes are reused. Cloudflare quotes are explicitly tagged `cloudflare_sandbox`, and SQL prevents mixing a provider contact/legacy quote with an inline contact/sandbox quote. Phone intake requires explicit `+countrycode.number`, without guessing a country calling code. The dashboard disables renewal, allows saved-contact deletion, displays registration/reconciliation states and offers a manual status refresh.

## Root integration contract

1. Install pinned Worker dependencies (`npm ci --ignore-scripts` in `workers/mccluster`) before tests/build.
2. Use `configuredCloudflareRegistration(env)` only under its existing default-off flag. It still rejects live mode. Pass the returned provider into `handleCreatorDomainOrders` alongside the existing trusted entitlement and domain-checkout bridges.
3. Inline checkout additionally requires `CREATOR_CF_REGISTRATION_CHECKOUT_ENABLED=true`, `CREATOR_DOMAIN_SALES_ENABLED=true`, configured contact keyring/terms/markup and a Stripe **test** secret. Defaults deny. It advertises sandbox testing only, not real registration delivery. No environment value was changed by this commit.
4. After signature verification and canonical Stripe Checkout Session retrieval, the billing webhook may call `handleVerifiedCloudflareDomainFunding(event,env,{provider,fetchImpl})`. The event must include `livemode: event.livemode === true` **only after validating the original field is boolean**; alternatively forward the original boolean directly. Missing/null/string/live values must not become false. Existing event payload fields are `orderId,ownerUserId,eventId,sessionId,amountTotal,currency,paymentStatus,paidAt`. The bridge rejects any value other than literal `livemode:false` and requires a test Stripe key plus sandbox provider.
5. `CREATOR_CF_REGISTRATION_EXECUTION_ENABLED=true` is a separate default-off execution gate. When off, verified funding is recorded but no provider operation starts. When on, the bridge resolves the order's exact owner-bound contact, uses the atomic claim, validates funding/contact digest, and submits once. Duplicate callbacks only inspect status; deleted/expired contact before submission becomes refund-required without initiating a refund. The integrated Worker mounts these callbacks lazily. The signed webhook rejects nonboolean mode and mismatched retrieved session ID/mode before forwarding the original boolean.
6. POST `/v1/creator-domain-orders/:id/status` requires the signed-in owner and configured sandbox provider. It performs a read-only provider status/ownership check and updates local evidence. It cannot submit or renew. A missing/other-owner attempt returns404.

## Remaining gates and truthful outcomes

Actual Cloudflare sandbox account access, scoped credentials, agreement/billing setup, approved terms/retention invocation, pending SQL deployment and real provider contract testing remain unverified. The documented API still lacks manual renewal, a server-enforced maximum-price request field, actual charged-amount readback and registrant contact readback. `registered_pending_reconciliation` remains distinct from fulfilled. No charge/contact verification or refund completion is invented.

## Executed tests

* `node --test workers/mccluster/test/registration-contact-vault.test.mjs workers/mccluster/test/cloudflare-registration.test.mjs workers/mccluster/test/world-ion*.test.mjs`: 37 tests passed, including owner/AAD/tampering/rotation/expiry, schema requirements and missing-livemode rejection; existing workerd redirect guard unchanged.
* `PGLITE_MODULE=/tmp/selfservice-tools/node_modules/@electric-sql/pglite/dist/index.js node scripts/test/creator-inline-domain-contacts.mjs`: actual pending SQL plus handlers, two owners, encrypted intake, unsupported schema before checkout, quote/contact isolation, duplicate funding, status, ciphertext wipe/expiry purge and uncertain submission.
* Existing `scripts/test/creator-domain-orders.mjs` passes against the legacy schema.
* `PLAYWRIGHT_MODULE=/tmp/selfservice-tools/node_modules/playwright/index.mjs node scripts/test/creator-domain-purchases-ui.mjs`: 390px, renewal disabled, status refresh, contact deletion, account-switch clearing and stale response suppression. Browser uses `/usr/bin/chromium`.

All provider/payment/contact data in these tests is synthetic. No network mutation or production database operation occurred.
