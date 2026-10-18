# Whip Equipped LLC — in-app booking and owner-controlled drivers (pending release)

**Brand and legal entity:** Whip Equipped LLC. McCluster provides the shared M Account, profile platform and the canonical Worker runtime. This **does not** make McCluster Corp the carrier, the ride merchant, or the driver's employer.

## Universal center experience
PR #516 implements `member-front.html?handle=…` for every signed-in member, with their self-owned center profile, public member perspectives, optional verified Whip driver panel, and actual operator memberships. Login is the same M Account, not an additional Whip identity. The Whip driver app on this branch also resolves the canonical M session and uses the common Music / M / Globe bar. Do not merge both PRs blindly: review the shared identity contract and full phone screenshots first.

## Rider booking state machine
1. Pick two real address suggestions or explicitly consent to GPS for the pickup. No fake cars, fabricated ETAs or city-center-based fares.
2. Browser makes `POST /api/rides/quote` with coordinates, labels and mode. The **Whip** Worker checks Supabase authentication, operator identity and charges availability. It calls a contracted **commercial TomTom routing** account and computes cents from locked Worker-level tariff variables. A 120-second HMAC quote is bound to the rider, endpoints, tenant and fare.
3. Rider explicitly confirms the signed quote. `POST /api/rides` takes only the quote token and a unique `Idempotency-Key`, never a client fare. Pending `whip_submit_booked_request` atomically inserts one `REQUESTED/unpaid` ride or returns the same result for a retry.
4. Only the rider can create a Stripe Connect manual-authorization payment intent. Payment confirmation is in the browser using Stripe Payment Element. **REQUESTED is not confirmed or dispatched.**
5. After provider-verified authorization, only a still-approved, insured, screened driver with current presence can atomically accept. The pending acceptance RPC rejects duplicate assignments and stale matches. The rider may inspect the status inside the site. Only an accepted, provider-authorized ride can be described as driver-confirmed.
6. Cancellation is retained for existing rider requests even after live service has been disabled.

## Driver ownership vs operator authority
- Driver profile and vehicle identity are owned by the signed-in M Account.
- Application requires affirmative `whip-driver-application-v1` consent. New or existing driver records cannot self-approve, go online, or see offers merely by claiming a role in profile text.
- Approval requires independent operator owner/admin review, a documented evidence reference, valid driver/license/insurance/screening dates and audit record. An operator cannot approve their own driver identity.
- A verified driver owns presentation and personal workspace, but rides are offered under the actual licensed, insured Whip Equipped operator. White-label operator tenancy and economics remain subject to separate contracts, merchant accounts, regulation and rate policies.
- Booking gate wraps the existing historical Whip Worker; the satellite's old client-supplied fare creation route must **never** be re-enabled as a fallback.

## Release gates: all disabled until reviewed
Runtime must be explicitly configured with all:
`WHIP_RIDES_LIVE=true`, `WHIP_LLC_TNC_REGISTRATION_CONFIRMED=true`,
`WHIP_LLC_INSURANCE_CONFIRMED=true`, `WHIP_DRIVER_APPROVAL_GATE_ENABLED=true`,
`WHIP_COMMERCIAL_ROUTING_ACTIVE=true`, `WHIP_BOOKING_SCHEMA_READY=true`,
`WHIP_TOMTOM_API_KEY`, `WHIP_QUOTE_SIGNING_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
plus validated server policy `WHIP_BASE_FARE_CENTS`, `WHIP_PER_MILE_CENTS`,
`WHIP_PER_MINUTE_CENTS`, `WHIP_MINIMUM_FARE_CENTS`.
Driver applications additionally require `WHIP_DRIVER_APPLICATION_SCHEMA_READY=true`.

The exact pending migration is `supabase/pending/whip_owned_booking_v1.sql`; **not applied**. It requires review and replay against the current production ledger, SQL behavior tests for real PostgreSQL roles, migration duplicate detection, existing data constraints, and auth/payment reconciliation before any promotion. Never set a launch flag in an unreviewed repository PR or treat a flag as legal certification. Stripe production credentials are not present/verified here. The free FOSSGIS routing pilot used by World navigation is **not allowed** to power commercial bookings.

**Connecticut launch review:** CT General Statutes 2026 Chapter 244c (§§13b-117 through 13b-120) covers annual TNC registration, disclosure, background/driving checks, driver minimum qualifications, insurance and operating requirements. Relevant official reference: https://cga.ct.gov/2026/sup/chap_244c.htm . This document is an implementation checklist, not legal certification.

**Routing reference:** https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route . The API has commercial licensing and provider billing; no account or key was created by this PR.

## Verification required before claiming ride acceptance works
- Verified real Supabase auth and primary account mapping across rider and driver.
- Case-by-case security probes: guest, self-edited approval, cross-tenant operator, suspended/expired driver, duplicate rider retry, concurrent driver accept, canceled payment, webhook replay, captured-vs-authorized state.
- In-app phone/tablet browser proof for location denial, search failure, quote expiration, 3DS payment actions, background/foreground, stale route and driver status polling.
- Database RLS/SQL migration replay and multiple production role cases; actual provider and Stripe test-mode with a consenting, approved test driver.
- Operational review of dispatch hours, accessible cancellation/dispute/safety support, fare taxes/tolls/surge policy, digital decal, TNC insurance/registration and reconciliation.

Until every gate is independently verified, `GET /api/service-status` returns `rides_live:false`, dispatch and payment mutations are denied, and users see only driver applications and the clear service notice.
