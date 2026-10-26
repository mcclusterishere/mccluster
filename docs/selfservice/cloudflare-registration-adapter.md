# Cloudflare registration-only adapter milestone

The optional adapter implements the current documented Cloudflare registration API without pretending it supports the older NameSilo-shaped contact/renewal contract. It is not mounted into customer checkout. Existing purchases remain disabled. The factory returns null by default and permits only explicit sandbox mode; no provider requests were executed during development.

Implemented:

* Authoritative domain check, exact USD decimal conversion and multi-year total: first-year registration cost plus renewal cost for each additional year. Reject missing/duplicate domain results, premium/unregistrable names, non-USD and malformed prices.
* Inline registrant contact, explicit `auto_renew:false`, redaction and term. Extension schema must pass an injected full JSON Schema validator; absent/unsupported validation fails before purchase. Prepared request integrity prevents mutation or repeated submission.
* Asynchronous registration submission and canonical status/owned-resource reads. Provider links are never followed. `action_required` stops automatic polling; blocked work reports a longer retry interval. Unknown/failed submissions cannot automatically submit again.
* Durable service-only attempt table and store. Reservation atomically claims an existing funded order, reserves the hostname, binds owner/contact digest, and persists submission before I/O. Terminal outcomes cannot be overwritten by late callbacks. No raw contact PII is written to this table.
* Explicit `registered_pending_reconciliation` outcome when a matching, fresh account-owned registration is confirmed. This does **not** mark the old order fulfilled or claim independent registrant/charge verification.

Files: `workers/mccluster/src/domains/cloudflare-registration.js`, `cloudflare-registration-flow.js`, `cloudflare-registration-store.js`; pending `supabase/pending/creator_cf_registration_attempts_v1.sql` after `creator_domain_orders_v1.sql`.

## Exact remaining contracts

1. **Contact intake/storage:** existing `creator_domain_contacts.provider_contact_id` means a provider-verified reusable contact. Cloudflare offers no contact-create/read endpoint; it accepts `contacts.registrant` inline. Do not invent a provider ID to fit that table. A reviewed encrypted, owner-bound contact reference and canonical normalized-contact digest must be attached to customer consent; implement intake/retention/deletion and map order creation before mounting this bridge. `loadRegistrant` is currently an unconfigured dependency, exercised only with synthetic contact fixtures.
2. **Extension validation:** GET `/registrar[-sandbox]/extensions/{extension}` returns `registration_schema`. A complete validator and supported extension/acknowledgement policy must be wired. Tests inject validation of synthetic schemas; they do not establish acceptance of actual registry schemas. Missing validator fails closed.
3. **Verified funding bridge:** `verifyFunding` defaults false. Wire existing server-verified checkout/event truth, entitlement and customer-scoped consent to the execution bridge; never accept a browser's paid flag. Pending storage reserves the existing funded order, but its customer contact creation path still needs item1. Customer order UI does not yet display the new attempt outcomes.
4. **Charge ceiling/readback:** POST registration has no documented `expected_price`/maximum-total field, and status/registration resources do not return charged amount. Fresh domain-check revalidation narrows the race but cannot guarantee the exact billed amount across submission. Do not report a reconciled provider charge from a quote.
5. **Registrant readback:** GET registration returns name/status/dates/renewal/privacy/lock, not contact fields or a contact ID. Submitted-contact digest records what was sent; it is not independent verification of registry contact. Account registration success is separate from registrant email action and billing reconciliation.
6. **Renewal:** no documented manual funded renewal endpoint; PATCH `auto_renew` only changes future charging behavior. Capabilities therefore advertise `renew:false`; no renewal stub exists.
7. **Activation:** sandbox account access, scoped credentials, agreement/billing setup, actual sandbox contract tests, pending migration review and integration approval remain pending. No credentials, contacts, resources, purchases or legal acceptances were created. Live factory mode is rejected by this milestone.

## Evidence and verification

Current official connector OpenAPI and documentation inspected 2026-10-26: [API guide](https://developers.cloudflare.com/registrar/registrar-api/), [registration create](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/create/), [sandbox](https://developers.cloudflare.com/api/resources/registrar_sandbox/). Fixtures use documented envelope/field/state shapes with synthetic domains, contacts and dates. They are not captured live provider responses.

Executed offline: adapter/lifecycle Node tests (default gate, full-price quote, explicit contact, no auto-renew, altered/replayed request, price/contact/funding mismatch, asynchronous success, timeout, user-action pause and old/wrong identity); PGlite applied pending SQL and checked two owners, one-shot claim, hostname uniqueness, immutable submission, terminal monotonicity and anon/auth role denial. No live or provider sandbox delivery verified.
