# Whip Equipped LLC — in-app ride bookings (review build)

## Existing modules, not a second rideshare backend
- The existing three Whip satellite apps and `workers/mccluster/src/whip/identity-gateway.js → security → gateway → router → worker` remain authoritative for Stripe Connect, auth, trip progress and rentals.
- `booking-gate.js` now wraps those modules **inside Worker `mccluster`**, intercepting only route quoting, ride creation, payment gating, offer viewing, driver acceptance and online presence.
- `js/travel/whip-booking.mjs` adds a *Book inside Whip Equipped* door to the existing World Travel planner. It uses the visitor's selected real start/destination coordinates and the existing world globe; no second fabricated map is created.
- Whip Equipped LLC is separate from McCluster Corp. M Account is shared identity, not operator authorization.

## Behavior
1. An authenticated rider selects exact start/destination in World Travel (manual address or consented GPS).
2. The rider explicitly requests a `POST /api/rides/quote`. The Worker routes through a separately licensed *commercial* street provider, computes a fare using approved Whip operator terms, returns road geometry and a short-lived HMAC-backed quote. Browser-supplied fares, miles and driver roles are discarded.
3. The rider checks quote total, provider-disclosed pricing and availability. Prelaunch quotes are labeled *preview only*. A quote alone never creates a booking or charges a card.
4. If and only if launch clearance and current Stripe/operator settings are satisfied, `POST /api/rides` consumes `quote_token` and the rider's UUID `request_id`. A single service-role RPC transaction creates `REQUESTED/unpaid` or returns the exact idempotent previous ride. The quote cannot be replayed with a different key.
5. A secure Stripe Payment Element is shown **inside** the World. Authorization is requested on the connected account through the preexisting `/api/rides/:id/payment-intent`, which now refuses bookings without a verified quote-origin record. Existing signed webhooks set the authoritative authorized payment state.
6. Only paid/authorized offers enter the existing driver queue; an independently cleared driver may accept. Ride statuses and cancellations use existing protected endpoints. The user sees *request pending*, then *driver accepted*, not a false immediate confirmation.

## Launch gates (all required; absent means OFF)
- `WHIP_RIDES_LIVE=true`
- `WHIP_LAUNCH_APPROVED=true` — named operator's documentary decision after insurance, jurisdiction, privacy and fare review
- `WHIP_BOOKING_DATABASE_READY=true` — set only after migration and database verification
- `WHIP_FARES_APPROVED=true` and complete server-only fare settings:
  `WHIP_FARE_BASE_CENTS`, `WHIP_FARE_PER_MILE_CENTS`, `WHIP_FARE_PER_MINUTE_CENTS`,
  `WHIP_FARE_BOOKING_CENTS`, `WHIP_FARE_MIN_CENTS`, `WHIP_FARE_TAX_BPS`
- `WHIP_BOOKING_QUOTE_SECRET` (high-entropy secret, at least 32 characters); never in frontend
- `TRAVEL_ROUTING_PROVIDER=tomtom` and `TRAVEL_TOMTOM_API_KEY` under a separately licensed, authorized Whip account; **the noncommercial FOSSGIS/OSRM pilot cannot be used for paid dispatch**
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and a connected operator account with charges, payouts and details completed
- `ALLOW_DEMO_IDENTITIES` must not be true
- A real `public.whip_driver_clearances` record per driver, signed by an authorized Whip reviewer with identity, background, local rules, active license and insurance documents checked; user-editable profile fields can never grant clearance.

**No flag is set by this PR. No production migration, fare, booking, charge, approval or payout is made by the code contribution.**

## Database contract
Apply `supabase/pending/whip_booking_authority_v1.sql` only after review and staged tests.
- `whip_driver_clearances`: service-only operator approval, expiry and revocation.
- `whip_booking_idempotency`: UNIQUE request and quote consumption, tied to account and tenant. No direct anon/authenticated grants or RLS policies.
- `whip_reserve_booking_v1`: service-role-only **security invoker** RPC. It serializes reservation per rider, rechecks cleared online driver availability and existing active rides, and atomically inserts exactly one unpaid request. It does not charge a card or assign a driver.
- No new tenant, root-level worker or duplicated user identity.

## Validation
- `node --test workers/mccluster/test/whip-booking.test.mjs`: unit and route gate tests with in-memory fake provider, account service, RPC and manual clearance.
- `npm test` under `workers/mccluster/`, source contract checks, and mobile browser World Travel proof must pass before merge.
- Exercise Stripe test mode and a fake driver/operator on a staging tenant, then a production billing review and location authorization review. Never claim this makes real-world trips safe or available by itself.

## Pending parallel PRs
- #453 controls driver application consent/launch gate. Reconcile its identity/consent layer **before** switching on booking; never merge historical blanket driver signup without its consent migration.
- #514 adds map-based endpoint picking; #516 adds the shared center-tab member/driver workspace, while #512/#513 change the World view. All must be integrated and retested together.
- The older standalone Whip rider app uses mock route/vehicle data and a client-side fare; it must be switched to the canonical quoted API or disabled as live booking UI. The new World booking door is the test implementation.
