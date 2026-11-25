# Connect street routing for private use

The existing World Travel experience and `POST /v1/travel/route` already use the
canonical Worker and its shared routing Durable Object. Missing TomTom credentials
do not remove the UI or require a new backend. A disconnected configuration returns
an explicit unavailable response; it never returns made-up directions.

## Keyless mode

The existing `fossgis-pilot` selector requires `TRAVEL_ROUTING_PILOT=noncommercial`.
This is a modest noncommercial pilot under the [FOSSGIS service policy](https://routing.openstreetmap.de/).
Keep attribution and the existing 1,000-attempt UTC-day budget, single upstream
connection and 1.1-second spacing. Nonprofit status alone does not establish
permission for commercial routing. No account or credential is needed for this lane.

## Dedicated TomTom connection

1. Review the [TomTom Routing API](https://docs.tomtom.com/routing-api/documentation/routing/calculate-route)
   and [current pricing](https://docs.tomtom.com/pricing/). On November 7, 2026 the
   pricing page lists 20,000 free Routing API requests monthly. Verify the actual
   selected plan, account usage, renewal boundary and spending controls; this guide
   does not authorize signup, billing or purchase.
2. Use a dedicated application credential. Bind it as **`TRAVEL_TOMTOM_API_KEY`**
   through the approved Worker secret flow (`wrangler secret put` from
   `workers/mccluster`, using the locked CLI). Do not paste it into chat, browser
   settings, source, a command argument, a committed env file or a report. Halo's
   `TOMTOM_API_KEY` is a different binding and is not read by Travel.
3. In the reviewed server configuration set `TRAVEL_ROUTING_PROVIDER=tomtom`.
   Keep the existing `HereTenantAgent` binding. Code review, deployment and
   configuration approval remain separate; do not merely change the dashboard
   and assume the next repository deploy will retain that change.
4. Rehearse with the existing provider fixtures and `node scripts/integration-readiness.mjs`.
   This CLI prints binding names/presence and local budgets, never credentials.
   It is not a live provider test. On the approved runtime request one public-place
   route through the existing Travel UI; verify geometry, maneuver order, provider
   attribution, traffic disclosure, disconnected behavior and quota refusals.
   Do not use a private home/work address for validation or log coordinate bodies.
5. The application now refuses TomTom calls after 20,000 attempts per UTC month,
   in addition to the existing daily/spacing policy. Failed attempts count. State
   survives eviction and credential/provider changes; no route coordinates are
   stored in the quota ledger. A refusal returns 429 and `Retry-After` until the
   next applicable boundary. It does not fall back to another provider silently.

The monthly ledger starts tracking with this repair and carries the known current
day's legacy count. Earlier historical calls and other applications' usage are
unknown, not zero. Confirm those outside this tool before activation. The local
calendar-month budget is not a billing-meter reconciliation or a zero-charge
guarantee, especially when the provider's billing boundary differs. Key rotation
must not reset usage. Revoke a retired key at the provider after the replacement
is bound and verified; disable the selector first if an immediate stop is needed.

## Release and rollback

No new namespace, binding, table, timer or production SQL is needed for the quota
repair. Merge may trigger canonical Worker publication. Review exact-head CI and
the deployed fingerprint before claiming it is active. A code rollback preserves
stored state but restores the old lack of monthly enforcement; do not roll back
while relying on the monthly cap for TomTom use. Stop that provider first.
