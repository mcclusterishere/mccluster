# THE HERE INVENTORY: what this repository actually is

Audited 2026-07-28, in `mcclusterishere/Here` (the implementation source
for matthew.mccluster.org; CNAME, manifest, Pages workflow, robots, and
sitemap are all present and correct in this repo; nothing there was
missing). The Portfolio repo is an ancestor only; nothing below assumes
it.

## The property

- **CNAME:** matthew.mccluster.org · **Deploy:** .github/workflows/deploy-pages.yml
  (main → stamp → gh-pages) · **Canonical host:** matthew.mccluster.org throughout.
- **40 HTML pages**, 20 JS modules, 6 wall pages, 6 new track pages,
  data/ JSON catalog, supabase/ migrations 0001 to 0007 + 2 edge functions
  in-repo (square-checkout, checkout), 6 GitHub workflows.

## Entity decision (directive item 5)

The permanent **Matthew** entity is `https://matthew.mccluster.org/#matthew-mccluster`
and the permanent **McCluster Corp** entity is
`https://matthew.mccluster.org/#mccluster-corp`. Every JSON-LD block in
this repo now references those @ids; asset URLs point at
matthew.mccluster.org where the assets actually serve. matthew.mccluster.org
itself is the authoritative **WebSite + MusicAlbum** property for HERE,
with per-track canonical URLs at `/tracks/<slug>.html`.

## Stale metadata: RESOLVED

`streetcreditbureau.com` appeared in 8 files (index, album,
equity-uprise, hire, matthew-mccluster, press, ecosystem, README) as
OG URLs, JSON-LD @ids, asset URLs, and body copy. All replaced:
zero references remain.

## Marketplace inheritance: what was found, what was done

| System | Where it lived | Status |
|---|---|---|
| Stripe Connect provider onboarding (`connectOnboard`) | js/payments.js + album.html creator desk | **Removed** from both |
| Provider ID verification (`verifyId`) | js/payments.js | **Removed** |
| Destination charges to provider accounts (`payDeal`) | js/payments.js | **Removed** |
| Seller-vs-buyer spread (RATE/quote/net, 10%) | js/payments.js | **Removed** |
| Payee rail resolution (`rail`) | js/payments.js + pay.html | **Removed**; pay.html rewritten offering-first |
| Pay-anyone page (?to=&amt=) | pay.html | **Replaced** with /pay.html?offer=<slug>; legacy mccluster invoice links map to the approved-invoice offering; all other legacy links show a retirement notice |
| Test-mode publishable key (pk_test…) | js/payments.js | **Removed**; hosted checkout needs no client key |
| Creator desk (payout tiles, personal pay links, creator premium) | album.html "Backend" mode | **Removed** from public; owner desk is admin.html |
| Network tithe + member residual links | js/payments.js PAYMENTS | **Removed** |
| Provider directory + talent app (`listProviders`, listing management) | js/network.js, role.html, cut.html | **Flagged**: role.html and cut.html are queued 410/internal in the migration map; network.js booking-request reads remain for the owner's own funnel. Full excision rides the next pass. |
| Marketplace edge functions (pay-now v4 splits, connect-onboard, pay-deal, backend-sub) | mothership Supabase (docs only in repo) | **Superseded** by the checkout function; retire the server functions when checkout deploys |

**One seller remains: McCluster.** The offerings ledger
(supabase/migrations/0007_offerings.sql) names the legal entity on
every offering; the checkout function reads price, currency, seller,
and provider from the database, never from a query parameter. Custom
amounts exist only on configured offerings (donation, approved
invoice, booking deposit) inside server-side bounds.

## Commerce vs charity: separated

The buy sheet and checkout speak commerce ("Total today", "Sold by
McCluster"). Charitable support lives only at give.html (the Mission
Fund, with the Sept-30 license clock in js/cause.js). Sponsorship
(sponsor.html) is explicitly a business placement. A purchase is never
described as a donation.

## The HERE economic pathways, as built

- **Stream**: album.html player + 6 track pages with start/25/50/75/complete
  and view tracking (`track_start`, `track_progress`, `track_complete`).
- **Buy**: offerings live today: 5 print sizes, 3 file tiers (prints.html
  + the counter). `here-digital-album` exists as a **draft** offering.
  The infrastructure is built, unpublished until the product is real.
- **License**: license.html captures requester, organization, track,
  use, media type, territory, term, audience, budget, deadline,
  instrumental/clean flags → the desk (campaign `here-licensing`).
- **Subscribe**: the index subscribe flow files consent under its own
  campaign; a dedicated consent store (separate from account creation)
  is specced for the shared backend.
- **Sponsor**: sponsor.html, four structured packages, `here-sponsorship`.
- **Support**: give.html only, honestly labeled.

## Authentication

localStorage GoTrue sessions (js/backend.js) work on this host and
cannot cross subdomains. The redesign (central callback at
account.mccluster.org, HTTP-only cookies, deliberate cookie boundary,
CSRF, rotation, RLS, no service keys in the browser) is specced in
docs/shared-accounts-architecture.md with a no-big-bang migration path.

## Environments & payments configuration

Stripe secret lives in the edge-function vault only. The pk_test key
that shipped in the client is gone. Remaining work: split
local/preview/production function environments and retire the
marketplace-era functions (pay-now, connect-onboard, pay-deal,
backend-sub) once `checkout` is deployed with STRIPE_SK.

## Campaign attribution

crm.js already captures first-touch utm_*/gclid on any landing.
The campaigns ledger (0007 migration) requires campaign_id, site_id,
audience, objective, landing_page, primary_action, offering_id,
sender_identity, and the four utm fields. HERE receives music
campaigns only; service outreach lands on matthew.mccluster.org
per the migration map.

## The registries

- **Domains:** data/domains.json. Live/planned/proposed, no hardcoded finals.
- **URL migration:** docs/here-url-migration-map.csv. All 40+ routes,
  each with destination property, redirect type, canonical target,
  owner, and status. Redirects are staged ("301 planned") because
  GitHub Pages cannot issue cross-host 301s; the receiving properties
  implement them at launch, and nothing redirects to the wrong home in
  the meantime.

## The segregation map (resolved 2026-07-28)

The app had **seven** rival entrance systems and forty-two pages with
none. Every one is now retired into a single masthead (js/masthead.js).

| # | System | Lived on | Carried | Fate |
|---|---|---|---|---|
| 1 | `.site-head` | index, hire, ecosystem, equity-uprise, fellowship, docket-516, verify, brand | fixed bar, brand lockup, links, page CTA | retired; CTA moved into the masthead (`data-mh-cta`) |
| 2 | `.gx__nav` | gallery | in-flow bar, centered wordmark, 4 links, theme toggle, profile CTA | retired |
| 3 | `.tb__nav` | portfolio | left wordmark (different weight/tracking/size), theme toggle, "Let's talk" | retired |
| 4 | `.sr__top` | management | back-link, tagline, hire link | retired |
| 5 | `.dw__mark` + `.dw__skip` | door | mark + a second row of primary links | retired; masthead defers through the intro, reveals on settle |
| 6 | `.pv__nav` | production | logo + wordmark, theme toggle, "Lock in" | retired; CTA into the masthead |
| 7 | `.ar__head` | archive | wordmark, theme toggle, "Lock in" | retired; CTA into the masthead |

Three of them (`.site-head`, and the masthead itself) were `position:
fixed; top: 0` simultaneously. On eight pages two brand bars were
stacking in the same strip.

### Orphan rooms rescued

Reachability was measured by real anchors, not JSON-LD `"url"` values.
That distinction is what hid this: album.html and index.html each *mention*
all six track pages, but only inside structured data, so no visitor
could click through to any of them.

- **tracks/*.html (all six)**: five had zero inbound anchors sitewide.
  Now: every album row carries a link into its own track room, and all
  six sit in the drawer.
- **sponsor.html**: zero inbound links. Now in the drawer.
- **license.html**: one inbound link. Now in the masthead and the drawer.
- **archive.html, production.html**: reachable only from owner desks.
  Now in the drawer.

### The bar

Five primary rooms (The Album · The Gallery · The Rack · License ·
Hire), the room you're in marked in ruby, a page-action slot, and a
Rooms drawer holding all **31** public rooms in five groups (the
Prayer Closet group joined 2026-07-28: the Closet, four drop rooms,
and the Inner Room). Three modes: `off` (owner desks), `minimal`
(checkout), `deferred` (the door). The bottom `.appbar` now rides
every public page too. Fifteen gained it, including all six track
and all six wall pages, and it carries **four** tabs: Music · HERE ·
Prayer Closet · Profile (see docs/prayer-closet.md for that wing).
