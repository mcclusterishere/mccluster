# Ride fulfilment for the travel-first World

Reviewed October 17, 2026. The requirement is access to actual transport supply,
under our branding, at small initial volume, with a commission or permitted markup.
Dispatch software that requires our own drivers does not meet that requirement.

| Provider | Publicly documented fit | Small-volume evidence | Commercial limit still to resolve |
| --- | --- | --- | --- |
| [Talixo](https://talixo.com/travel-agencies/) | Transfers, commissionable rates, adjustable handling fee, branded website integration. [Developer page](https://talixo.com/developers/) offers API and embedded widget. | The agency application explicitly accepts “Under 20” bookings/month as an answer; the account is advertised as free. | This is not a published guarantee of zero minimums for a custom API contract. Confirm fees, margin schedule, service area and immediate vs scheduled pickup. |
| [Mozio](https://www.mozio.com/business-partners) | Ground transport inventory, API, white label and widget; partner commissions. API provides availability, prices and vehicle data. | [Homepage](https://www.mozio.com/) positions the widget for smaller travel brands. No numeric demand-side minimum verified. | Obtain partner terms and credentials; confirm revenue share and available transport classes in initial markets. |
| [Karhoo](https://developer.karhoo.com/) | Demand-partner taxi/ride-hailing API. [Integration documentation](https://developer.karhoo.com/docs/mobile-choosing-the-best-approach) supports own UI or white-label UI. | No low-volume or zero-minimum commercial commitment verified. | Stronger match for actual on-demand hailing; commercial approval, territory, payment and margin terms remain open. |
| [LocalsRide](https://localsride.com/en/partners) | Advertises branded widget, quote/book/cancel REST API and webhooks, transfers, up to 15% commission and optional own markup. | Explicitly advertises no setup fee, subscription or minimum volume. | These are the provider's claims, not a negotiated contract or independently verified coverage. Verify legal entity, operations, API sandbox and test fulfilment before integrating. |

**Recommended first partner evaluation: Talixo**, with Mozio as a parallel
commercial comparison. For an instant “hail now” promise, evaluate Karhoo against
actual Connecticut/New York coverage. Airport and prebooked transfers are a
different product from guaranteed instant local dispatch.

No provider application was submitted, no contract accepted, no customer data
sent to a provider, and no paid booking made during this implementation.

## Integration boundary

The World now owns discovery and a private draft journey. `journey-core.mjs`
normalizes its user-authored plan and builds the departure/main/arrival/stay legs.
`navigation-core.mjs` remains the ground-directions authority. `journey-store.mjs`
uses the existing McCluster session and canonical Supabase with owner-only RLS.
The separate owner Roadshow quote workflow is not a public booking backend.

Live fulfilment is not activated: there is no approved supplier account, partner
token or contracted markup in this checkout. Present directions and clearly
labelled external searches today; never invent supplier endpoints or fares.
Lowest-cost and free-option flags are planning preferences, not live inventory
filters. Actual booking must replace a leg's search action only after activation.

An API integration belongs in the canonical `workers/mccluster` service. It must
keep partner credentials server-side, normalize time-limited quotes, bind quote
and booking IDs to the authenticated owner, take an explicit final confirmation,
use idempotency for booking, verify webhook signatures and persist cancellation,
refund and reconciliation state separately from user-editable drafts. Customer
price, supplier cost and our margin must use the signed partner agreement. Do
not assume commission and markup can be stacked, or that our Stripe checkout is
the merchant of record. Those decisions depend on the chosen contract.

Activation needs: approved sandbox credentials, production terms and geographic
coverage, the booking/quote/cancel/webhook documentation, and the agreed payment
and support responsibilities. Once present, the trip UI does not need a rebuild.
