# Platform offers and release boundary

Prepared against main `16bf23358b742b47f6c77138701f59465dfed34f`. This is an independent product landing page for review, not a deployed homepage or an assertion that the whole product is ready. No payment, account, DNS or production action was taken.

The latest direction organizes the landing around three **audiences**: Builders, Contributors, and Backers. One account can take every role; no separate signup, permission grant, or account classification is created. Sites, Campaigns, and Apps remain underlying product layers. World supplies shared discovery/distribution. This supersedes the earlier three-offer headline organization while preserving the existing platform implementation and identifiers.

## Implemented presentation

`platform-home.html` presents three main CTAs: Build my brand, Find opportunities, and Back a project. They scroll to compact audience sections. Back a project has a visible, accessible planned-status explanation and leads to information, not a transaction.

Builders follow Build / Run / Grow: free profile to website, storefront/customer/community operations as supported, then publishing and campaign distribution. Artist, business, and project selections change guidance and a companion destination only. They do not create exclusive signup types or buy anything. Contributors follow Discover / Contribute / Earn and reputation; the existing clipping screen is the actionable destination. Backers follow Discover / Back / Follow progress; backing and dedicated fulfillment tracking remain planned. Public World updates remain usable independently.

Free profiles and participation are distinguished from paid site/hosting/domain/module upgrades. Availability is reported by each destination; this landing page neither invents prices nor promises that unconfigured services are active. Website first, optional app later. Streaming/RTMP is future roadmap work only. Inbound backing remains distinct from sponsor reward budgets and outgoing contributor earnings; no wallet, custody, investment or return claim is made.

Only owner-supplied `assets/img/equity-uprise-mark-white.png` is used for the emblem, scaled proportionally. Matthew's existing canonical creator profile is a separate destination. Vaunt and the personal site are unchanged. Legacy section anchors `#sites`, `#fund-act`, and `#apps` still resolve, alongside the new audience anchors.

## Evidence and remaining work

| Offer / action | Existing source evidence | Minimum remaining work |
| --- | --- | --- |
| Sites / account to page | `front-studio.html`; `js/front-studio.js`; `workers/mccluster/src/member-fronts.js`; pending `supabase/pending/member_fronts_v1.sql` | Sibling foundation activates only after reviewed production schema/storage and deployment approvals. Dashboard, commerce, domains and social retain their own capability checks. |
| Sites / artist and business variants | `js/platform-home.js` selects guide and existing destinations; `creator.html` is music studio | Persisted template/onboarding variants are not implemented by this landing page. Connect any future variant to actual schema and editor settings, not a cosmetic claim. |
| Fund & Act / Raise | No transactional backing flow is invoked by this page | Use the selected rewards-based all-or-nothing model. Review terms, inbound collection, refunds, reporting and fulfillment separately before release. No investment returns, custody, escrow or shared wallet is implied. |
| Fund & Act / Launch | `action-network-hire.html:2` ends in a mailto inquiry; `js/control-room/clipping.js:235` creates campaigns, `:248` records funding, `:256` records manual payout references | Customer-scoped sponsor setup and budget collection/reconciliation must replace operator handling before claiming self-service launch. Preserve brief, rules, funding and review requirements. |
| Fund & Act / Earn | `js/mnet.js:110` supports `?view=clips`; `js/mnet-clips.js:34` loads campaigns/work, `:49` renders held/payable/paid, `:145` claims, `:148` fetches source assets | Existing runtime may show empty or unavailable campaigns. Verify provider access and availability before promising earnings. YouTube/TikTok are explicitly unavailable in `js/mnet-clips.js:68`. |
| Actual payment vs ledger | `supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql:832` defines `clip_record_payout`; `:845` checks org owner; `:855` totals payable amounts and records a provider reference | A recorded reference is not evidence of automated bank disbursement. Reconcile signed provider events and actual transfer outcomes, with idempotency/failure handling, before advertising automated payouts. |
| Real-world missions | `mnet.html:2` retains `hu-social-only`; `js/mnet.js:6` describes mission withdrawal; proof media routing is at `workers/mccluster/src/platform-api.js:1305` | Do not remove the public mission switch implicitly. Review sponsor creation, assignment, proof review, reward funding and participant recovery before a separately approved release. |
| Apps & Experiences | `workers/mccluster/src/platform-api.js:1582` reads enabled `platform_apps`/API products; this is a catalog, not tenant installation | Define an install manifest, tenant ownership, permissions, activation/removal, billing/entitlements, data cleanup, and upgrade/support contracts. No install button is exposed. |
| World | `mnet.html`; `js/mnet.js`; existing feed and sharing routes | Keep World as shared discovery, preserve social feed/access policy and existing links. External publishing follows the separate provider authorization flow. |

### Selected backing model — implementation and release still gated

The user selected rewards-based, all-or-nothing backing for projects with a minimum budget. This authorizes the non-live model described below; it does not authorize collection of funds or establish processor approval. Recurring memberships and paid missions remain separate transaction types and accounting flows.

Before payment implementation or release, complete processor, legal, and operational review and delivery, cancellation, refund, and dispute terms. [Stripe’s restricted-business policy](https://stripe.com/legal/restricted-businesses) lists crowdfunding platforms under restricted businesses requiring additional due diligence (checked 2026-10-26); an existing Stripe account or integration is not approval for this activity. Confirm the applicable processor terms through current official documentation during that review.

Any future design must distinguish a **pledge**, **collected funds**, and an **available campaign budget**. A pledge must never authorize rewards or spending as though funds were collected and available. Backing, refunds, fulfillment, sponsor budgets, and contributor payments need separate auditable states. No ownership interest, profit participation, investment return, escrow, custody, or shared wallet is proposed or implemented here.

Ordered delivery: finish the first account-to-site lifecycle; complete commerce/domain/provider gates; provide sponsor campaign workflows around the existing proof and ledger model; complete participant payment reconciliation; implement tenant module lifecycle. Backing remains separately gated on processor approval, reviewed terms and operational handling, and explicit release authority.

## Parent integration hooks

This commit deliberately changes neither `index.html` nor shared navigation. Vaunt PR #621 owns overlapping front-page presentation; integrate against its final head before altering those files.

1. Serve this reviewed page as the platform's public landing after selecting and approving the host route. Keep `matthew-mccluster.html`, personal media routes and `front.html?project=vaunt` independent. Do not delete the personal experience merely to change the platform entry.
2. `js/tabbar.js:130` builds the default middle tab, `:224` declares its home wing, `:301` maps page destinations, and `:414` onward replaces it for owner/member perspectives. Updating only the markup will be overridden. The new direction requires the middle control to consistently use the supplied E=Up emblem and open platform home; account/profile remain the existing top-right destination. Tests must cover signed-out, member, artist perspective and owner/admin modes. Preserve contextual creator links elsewhere.
3. `platform-home.html` currently retains `noindex`, has no speculative canonical EquityUprise.com URL, and uses relative legacy routes. Do not publish a canonical new host before read-only ownership/routing verification and explicit DNS/deployment approval. This task did not verify ownership of EquityUprise.com, register it, or mutate its configuration.
4. Existing cross-host sign-in handoff is limited to recognized hosts in shared navigation/auth code. A future EquityUprise.com host must be reviewed there, in CORS/auth return allowlists and Worker host routing together; changing a domain string alone is not sufficient.

## Verification

`PLAYWRIGHT_DIR=/tmp/selfservice-tools/node_modules node scripts/e2e/platform-home.e2e.mjs`

Passed actual Chromium checks at 390px and 1440px: three audiences, artist/business/project guidance and deep link, correct destinations, supplied image loading, no transactional placeholder controls, horizontal overflow equality and no JavaScript errors. Screenshots: `/tmp/platform-audiences-proof/home-390.png`, `/tmp/platform-audiences-proof/home-1440.png`; visually inspected both screenshots. The fixture intercepts network and isolates the offer page; it stubs the shared navigation script. It is not a live signup, payment, campaign, installation or new-host test. Shared navigation integration requires its own existing suites and browser checks.

## Non-live backing model

`packages/backing-model/index.mjs` is a pure fixture evaluator with no imports, I/O, provider calls, database, customer creation, or payment capability. It accepts only `rewards_backing` / `all_or_nothing`, explicit nonfinancial reward categories, a target and ordered funding/collection deadlines. Memberships, missions and financial-return categories are rejected. This is a typed category boundary, not a legal review of reward descriptions.

It distinguishes pledged, confirmed-collected (caller-supplied fixture evidence), refunded and net-collected cents. Pledges freeze at the deadline; collection is ineligible before it or when the pledge target is missed. Undercollection at the collection deadline requires refunds when any collected funds remain. Cancellation stops new pledges/collections and signals refund requirements. Replayed event IDs are idempotent; conflicting IDs, reused evidence, currency/project mismatches, overcollection and overrefunds are rejected.

Even `collection_target_met` leaves `campaignBudget = { authorized: false, cents: 0 }`. There is no spendable balance, wallet, budget allocation or disbursement method. Provider authenticity, fees, disputes, funds availability, ownership/authorization, concurrency and persistence remain outside this model and require separate integration. A supplied evidence reference is not provider verification. No payment endpoint invokes this package.

Validation: `node --test packages/backing-model/index.test.mjs` — five behavior suites covering reward boundaries, target/deadline outcomes, cancellation/refunds, replay and scope guards, and pledge/collection/budget separation. Landing browser tests remain fixture-only; no backing is enabled.
