# Domain request: one contact screen

Checkpoint: 2026-11-01. Source change only; no payment, registrar, database or deployment activation.

The existing address search in `sites.html` / `js/offers.js` routes available domains without an approved price to `onboard.html?offer=runway&domain=…`. Previously this entered the general website brief, asking for an organization, business type, website goals, pages and content. Those questions are not registrar requirements.

`js/onboard.js` now uses its existing renderer and account widget for a single domain request screen. The selected address and unconfirmed registration/renewal prices come first, followed by name, email and optional phone. Signed-in identity fills those fields; the same screen provides account entry when needed. Website planning is deferred. Valid legacy domain links enter the same screen.

Submission uses `js/offer-crm.js` and the existing authenticated `site_requests` insert with `kind: onboarding` and an explicit `INTENT: domain_quote` body. It does not create an order, authorize registrar contact sharing, reserve a domain, send a payment request or call Stripe. No retired domain/hosting price is revived. Checkout stays paused; a reviewed registration and renewal quote is still required before purchase.

Account drafts are separate by user and selected domain; guest drafts stay in session storage. A changed account clears visible contact details before rehydrating that account's own draft. Owner identity is checked again after token lookup and before insertion. Successful responses leave a local receipt so reload does not resubmit. A failed or interrupted response is uncertain: the UI retains the draft and asks the user to check their console before retrying. The existing intake API has no request-id deduplication contract, so this is not a claim of exactly-once delivery after an uncertain network failure.

## Existing purchase engine inspected

PR 681 was inspected read-only at `5e020833534b68b31e191b137e9a30da8b58314f`, branch `codex/onboarding-integration-20261031`. `customer-domain-purchases.html` and `js/customer-domain-purchases.js` use `/v1/creator-domain-orders`: saved contact, quote, order, then checkout. They require first/last name, street, city, state/province, postal code, country, email, international phone and explicit consent. They do not require a brand or organization questionnaire. Its provider, checkout and pending-schema gates are not imported or enabled by this change. No required registrar contact or consent was removed.

## Verification

Run `PW_MODULE=/path/to/playwright PW_CHROME=/usr/bin/chromium node scripts/e2e/domain-quote.e2e.mjs`.

The test serves this checkout locally, blocks off-origin network and mocks authentication and CRM. It covers 390/768/1280px layouts and overflow, one-screen contact entry, validation, reload and Back, account isolation, changed-token refusal, repeated clicks, receipt recovery, sign-in without automatic submission, and preservation of the general service brief. This proves browser behavior against mocks, not live backend persistence or registrar availability.
