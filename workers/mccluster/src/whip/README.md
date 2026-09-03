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
