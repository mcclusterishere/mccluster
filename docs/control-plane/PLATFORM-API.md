# McCluster Platform API

`https://api.mccluster.org` is the canonical public API boundary for the McCluster ecosystem.

## What this means

Do not create a different API host for Mnet, Whip, Level 3, client sites, media, or AI. Product-specific implementations may live in modules, but external integrations converge on the McCluster API gateway.

The API has two classes of callers:

1. **McCluster users** authenticate with their normal McCluster bearer session. These calls represent a human using an authorized McCluster product.
2. **Developers/integrations** authenticate with a generated `mcc_live_*` API key tied to an `api_consumer`. These calls are scoped, metered, auditable, and can later be billed.

## Metering model

McCluster uses **API credits**, not the word `tokens`, as the universal commercial unit.

A token is useful when measuring language-model input/output. It is a confusing unit for profile reads, map requests, webhook deliveries, social graph calls, file processing, payments, or media generation.

The platform therefore meters a normalized credit ledger:

- cheap read: usually 1 credit;
- ordinary write: usually 2+ credits;
- event ingestion: metered per event;
- expensive AI/media/geospatial operations: endpoint-specific credits plus, where appropriate, provider/model cost passthrough.

Each developer consumer gets a balance in `api_credit_ledger`. Each API call creates an `api_usage_events` row and deducts the endpoint's configured credit cost. When the balance reaches zero, active keys are marked `exhausted`. Adding credits can reactivate exhausted keys. Explicitly revoked keys remain revoked.

The initial developer grant is 10,000 credits so an integration can be built and tested before paid billing is attached.

## Commercial objects

- `api_consumers` — developer/application billing identity.
- `api_keys` — hashed credentials, scopes, expiry, status and last use.
- `api_products` — metered API capabilities and unit costs.
- `api_usage_events` — request-level usage ledger.
- `api_credit_ledger` — grants, purchases, refunds and usage deductions.

Raw API secrets are never stored. Only a prefix and SHA-256 hash are persisted. The secret is shown once at creation.

## Developer self-service API

Authenticated McCluster users can create and administer their own integration identities:

- `GET /v1/developer/consumers`
- `POST /v1/developer/consumers`
- `GET /v1/developer/consumers/:consumerId/keys`
- `POST /v1/developer/consumers/:consumerId/keys`
- `GET /v1/developer/consumers/:consumerId/usage`

Future developer-console UI should consume these endpoints rather than directly exposing database tables.

## Public catalog

`GET /v1/platform/catalog`

Returns the platform capability catalog, application registry, API product/meter definitions, version and authentication model.

## Mnet API

Mnet uses the same API host.

Current endpoints:

- `GET /v1/mnet/bootstrap?app_key=...` — user-session surface bootstrap (`profile` versus `feed`).
- `GET /v1/mnet/feed?app_key=...&limit=...&before=...` — user-scoped feed; API keys with `mnet:read` receive public feed data.
- `GET /v1/mnet/people/:mcclusterId` — canonical McCluster/Mnet public identity.
- `PATCH /v1/mnet/profile?app_key=...` — universal profile update, McCluster-user session only.
- `POST /v1/mnet/posts?app_key=...` — native post creation, McCluster-user session only.
- `POST /v1/mnet/posts/:postId/reactions` — reaction mutation.
- `POST /v1/mnet/people/:mcclusterId/follow` — follow.
- `DELETE /v1/mnet/people/:mcclusterId/follow` — unfollow.
- `GET /v1/mnet/notifications` — current person's notifications.

External API keys start read-oriented. Write access should be deliberately granted with scopes rather than letting an integration impersonate a human by default.

## Existing McCluster platform domains

The gateway already contains additional first-party domains that remain valid and should increasingly be represented in the public developer catalog:

- `/v1/apps`
- `/v1/fees/quote`
- `/v1/media/*`
- `/v1/ai/*`
- `/v1/social/*` for external social publishing/operations (different from Mnet)
- `/v1/prim3/*`
- `/v1/seek-first/*`
- `/api/*` legacy/compatibility Whip application routes
- McCluster Client/Connect routes handled by the Worker entry layer.

Mnet's social graph is under `/v1/mnet/*`; the pre-existing `/v1/social/*` namespace is for publishing to external social platforms and must not be conflated with Mnet.

## Pricing strategy

Do not price every endpoint in dollars independently. The recommended commercial model is:

1. free developer credits for testing;
2. monthly plans that grant a credit pool;
3. paid credit overage/top-ups;
4. separate cost multipliers for unusually expensive provider-backed operations such as AI/media/geospatial workloads;
5. enterprise contracts with higher limits, custom scopes, SLA, webhooks and service accounts.

This keeps pricing understandable while still allowing McCluster to recover provider costs and margin.

Actual dollar prices belong in a billing-plan table/Stripe product configuration and should be chosen deliberately. The API data plane is prepared for that attachment but does not invent prices.

## Security rules

- API key secrets are one-time-display and hashed at rest.
- Scopes must be checked server-side.
- Service-role credentials never reach browsers or developer clients.
- Human mutations require a McCluster session unless an explicit service scope is designed for them.
- External reads only expose data permitted for that API product; private Mnet state is not made public by possession of a generic API key.
- Usage is recorded server-side.
- Exhausted, revoked, expired or suspended credentials stop authorizing requests.
- Client A does not gain unrestricted access to Client B's private membership/customer data.

## Versioning

Public integrations target `/v1/...`. Breaking contracts require a new API version or an explicit compatibility layer. Database table names are not public API contracts.
