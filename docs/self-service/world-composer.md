# World + optional Instagram composer

The existing World composer now has a Destinations disclosure. World remains selected and uses its existing API, media handling, visibility, track selection, country opt-in and newsroom behavior. A member can opt into one of their connected Instagram accounts for each post. Accounts are discovered from the authenticated user's active site entitlements, then checked against the customer-social owner-scoped status endpoint; no default operator organization or credential is used.

Instagram is limited to the already implemented Professional-account Reels provider. Opt-in requires a public post with exactly one local MP4/MOV video, maximum 500 MB. The composer previews account, filename and caption, with an explicit note that attached track selections are World-only. Other platforms and scheduling are explicitly unsupported here. World posting does not depend on successful provider discovery or external delivery.

`js/mnet.js` captures an external delivery snapshot before World submission and notifies the isolated coordinator only after World returns a post identifier. External video upload/queue submission happens separately through the existing customer-social API. Delivery status sits outside the folding composer. A failed Instagram delivery has an Instagram-only retry; the coordinator never calls the World post endpoint. Ambiguous queue responses reuse the same stable idempotency key. Existing job retries reuse the canonical backend retry endpoint. Account changes clear retained deliveries, and reconnecting a different Instagram account never silently retargets an existing delivery.

The local File is retained only in memory until the external upload succeeds. Keep the page open until upload completes. In-page delivery/retry records are not persisted across reloads; submitted jobs remain visible in the linked connection/history page. This is immediate publishing with independent destination status, not a durable browser draft/scheduling product.

## Verification

- 59 focused tests passed across World publishing, media/storage safety, real-network contract, World/profile navigation and existing no-flash behavior.
- Seven new coordinator tests cover World default, validation, lost external response + same-key retry, disconnect/reconnect, two-account isolation, changed Instagram destination and confirmed World success ordering.
- `PLAYWRIGHT_MODULE_PATH=<scratch playwright>/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/test/world-social-composer.browser.mjs` passed. It uses the actual composer HTML and extracted unchanged-body `createPost` integration with fixture APIs: World succeeds once, Instagram fails then retries without a second World post, opt-in resets, provider-unavailable World posting still succeeds, sign-out clears deliveries, and document width equals scrollWidth at 390px.
- Browser outbound network is blocked; no real user content, provider publish, service configuration or production mutations occurred.

Activation still requires the customer-social reviewed migration, Meta credentials/scopes, enabled canonical publisher and separately approved deployment. This change does not remove those gates.

The Discover view also links to `world-discover.html` (directory implementation supplied by the parallel onboarding task); no map coordinates or inferred locality were added.
