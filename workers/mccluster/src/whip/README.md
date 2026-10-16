# Whip product routes

These modules run on Worker `mccluster` under `/api/*`.
Do not deploy `backend/` from a satellite repo as its own Worker.

## What is here

The three Whip Equipped frontends — Rider (`mcclusterishere/Whip-Equipped`),
Driver (`…-Driver`) and Rentals (`…-Rentals`) — were finished and shipping
calls to `/api/*` while this folder held nothing but the note telling
somebody to put the handlers here. Every call the apps made came back:

    503 {"error":"Whip product routes belong on Worker mccluster.
                  Put handlers in workers/mccluster/src/whip/."}

These are those handlers, lifted from `Whip-Equipped/backend/` without a
rewrite. Keeping them byte-identical to the satellite is deliberate: the
satellite is where they are authored, and a divergence here would be a
second implementation nobody maintains.

## The chain

`identity-gateway.js` is the door. Each layer answers what it owns and
hands the rest down:

    identity-gateway  identity verification gates (Stripe Identity)
        ↓
    security          ownership: can this user read this ride/rental
        ↓
    gateway           driver profile, shift state, ride transitions
        ↓
    router            auth proxy (Supabase), operators, sales leads
        ↓
    worker            rides, rentals, payments, Stripe Connect, partners

## What it needs

Bindings already on this Worker: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN`, `PUBLIC_APP_URL`,
`ALLOW_DEMO_IDENTITIES`.

Secrets to set in the Cloudflare dashboard before payments work:

| secret | note |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` while the flow is being proved out |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…`, handed to the browser by the API |
| `STRIPE_WEBHOOK_SECRET` | for `/api/stripe/webhook` |

Without `STRIPE_SECRET_KEY` the money routes report that Stripe is not
configured and the rest of the API still answers.

Tables: `supabase/migrations/0037_whip_mobility.sql`.

## Open sign-up, rides not live yet (owner, 2026-10-15)

"People should be able to sign up to Whip Equipped real quick. When they try
to use it, it'll just tell them the service is not done, but if you know a
driver, or you are a driver, have them sign up today."

`launch-gate.js` is a McCluster-side wrapper that runs in front of this chain
(`src/index.js`), so the lifted files above stay byte-identical:

| Route | Answer |
| --- | --- |
| `GET /api/service-status` | `{rides_live, operator: "Whip Equipped LLC", message, driver_signup_url, driver_consent_version, driver_consent_text}` |
| `POST /api/rides`, `POST /api/rides/:id/payment-intent`, `POST /api/rides/:id/accept` | `503 {code: "service_not_live", error, message, operator, driver_signup_url}`; nothing is dispatched or written |
| `POST /api/drivers/me` | the driver application: signed in; validated (name, plate, optional phone, vehicle make/model/colour, seats); `application_consent: true` with the current `consent_version`; saved offline and unverified with `application_consent_at` / `application_consent_version`; `201 {application: "received", approved: false}`. Fields that imply approval (`online`, `identity_verified`, `approved`, `status`, ...) are refused. |

Rides go live when the owner sets the Worker variable `WHIP_RIDES_LIVE=true`.
Signing up is an application, never approval: Whip Equipped's own checks
(Stripe Identity, driver licence, insurance, background check, local
rideshare/TNC rules) decide who drives. Quick sign-up for riders is the
existing account flow (`/api/auth/signup`, the M Account); there is no
separate rider waitlist table.

The consent columns are a pending migration,
`supabase/pending/whip_driver_application_consent_v1.sql` (rollback beside
it; tested by `scripts/test-whip-driver-consent-db.sh`). Until it is applied
the sign-up answers `503 driver_signup_not_ready` rather than save an
application without its consent. Tests: `test/whip-launch-gate.test.mjs`.
