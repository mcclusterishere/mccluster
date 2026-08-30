# BIG LEAGUE — moving off GitHub Pages and loading the real keys

The site is static files in a git repo. That part is right and it stays.
What changes: who serves it, what answers the forms, and how much of the
operation runs itself. Work the phases in order; nothing here breaks the
live site until the cutover step, which is reversible for 48 hours.

---

## Phase 0 — the loadout (accounts and keys to collect first)

Collect these once, store them in a password manager, never in the repo.

| # | Key / account | Where | Costs | Feeds |
|---|---|---|---|---|
| 1 | Cloudflare account + API token (Pages:Edit, DNS:Edit) | dash.cloudflare.com | $0 | everything below |
| 2 | Supabase project URL + anon key + service-role key | supabase.com dashboard | $0 tier | the leads desk, analytics, the opportunity engine |
| 3 | Resend API key + verified domain | resend.com | $0 tier | transactional mail (lead confirmations, teardown delivery) |
| 4 | Cal.com — three event types, their URLs | cal.com | $0 tier | `js/gate.js` CAL slots: teardown ($500 product w/ Stripe), project/partnership call (free), role call (free) |
| 5 | Stripe account + a Payment Link for The Teardown ($500) | stripe.com | 2.9%+30¢ | the Teardown as a product; no code needed for a Payment Link |
| 6 | Square dashboard — update subscription amounts | squareup.com | — | $75 hosting · $265 management · $750 social (the ledger already displays these) |
| 7 | Turnstile site key + secret | Cloudflare dash → Turnstile | $0 | spam-proofing the gate form |
| 8 | Cloudflare Web Analytics token | Cloudflare dash | $0 | cookieless page analytics |
| 9 | api.data.gov key | api.data.gov/signup | $0 | GSA Auctions heat-seeker (5,000 calls/day) |
| 10 | Google Search Console + Bing Webmaster verification | search.google.com/search-console | $0 | index coverage for the panel/SearchAction work |
| 11 | Registrar login (wherever mccluster.org lives) | — | — | the nameserver switch |
| 12 | Duffel API token (Amadeus self-service died Jul 17 2026) | duffel.com | search free; \$3 only per confirmed booking, and we never book via API | THE ROADSHOW: live flights + Hilton-family stays in workers/travel-quote.js |

## Phase 1 — the migration (GitHub Pages → Cloudflare Pages)

1. **Add mccluster.org to Cloudflare** (free plan). It imports existing
   DNS records — verify every record made it, especially current MX.
2. **Switch nameservers at the registrar** to the two Cloudflare gives
   you. Propagation is minutes-to-hours; the site keeps serving from
   GitHub Pages the whole time. Turn on DNSSEC after.
3. **Create the Pages project**: connect the GitHub repo, framework
   preset "None", no build command, output directory `/`. Every push to
   main now deploys in seconds, with preview URLs per branch.
4. **Custom domains** on the Pages project: `matthew.mccluster.org` and
   `matthew.mccluster.org`. Cloudflare writes the CNAMEs itself.
5. **Routing rules**:
   - `matthew.mccluster.org/*` → serve `hire.html` (a `_redirects` file
     in the repo root: `/  /hire.html  200` scoped to that host, or a
     Bulk Redirect in the dash).
   - apex `mccluster.org` → 301 to `matthew.mccluster.org`.
6. **The redirect map**: if any old `*.github.io` URLs are in the wild,
   add 301s from the old host once cutover is confirmed. Keep the GitHub
   Pages deployment alive for a week as a fallback, then disable it so
   there is exactly one canonical origin.
7. **Email**: Cloudflare Email Routing (free) — `sales@matthew.mccluster.org`
   and anything@mccluster.org forwarding to the real inbox. Add the SPF,
   DKIM (from Resend), and a DMARC record starting at `p=none`, moving to
   `p=quarantine` after a clean week of reports.
8. **Repo hygiene for Pages**: commit a `_headers` file — long-cache the
   hashed assets, `X-Frame-Options: DENY`, `Referrer-Policy:
   strict-origin-when-cross-origin`, HSTS. Turn on Brotli, HTTP/3 and
   Early Hints in the dash. Leave auto-minify off; the files are already
   hand-tight.
9. **Verify**: run the Playwright suites against the pages.dev preview
   URL before flipping DNS, then again after. Watch Search Console for a
   week — the domain does not change, so rankings should not move.

## Phase 2 — the parts that make it a big-boy operation

1. **A Worker for the desk** (`/api/lead`): the gate posts here instead
   of straight to Supabase. The Worker verifies Turnstile, rate-limits
   by IP (KV), then writes to Supabase with the service key — secrets
   leave the client forever. ~60 lines.
2. **R2 for media** with `cdn.mccluster.org`: the catalogue's audio and
   any film delivery move off git. R2 serves Range requests, so the
   player and the pocket keep seeking. Free egress.
3. **Scheduled Workers (cron)**:
   - the GSA Auctions heat-seeker: pull vehicle/tool lots hourly with the
     api.data.gov key, cache to KV, a page reads the cache — visitors
     never hit the API.
   - a nightly Supabase → email digest of new leads, so the desk emails
     you instead of you checking it.
4. **The Roadshow Worker** (`workers/travel-quote.js`): deploy with a
   `TRAVEL` KV namespace and the DUFFEL_TOKEN + OWNER_KEY secrets.
   **The booking desk** rides in the same Worker — three one-time steps
   to make confirm actually ticket:
   1. Top up the Duffel balance in their dashboard (bookings pay from it).
   2. Set the traveler profile once (never committed anywhere):
      `curl -X POST .../api/travel/profile -d '{"key":"…","given_name":"Matthew","family_name":"McCluster","born_on":"YYYY-MM-DD","gender":"m","email":"matthew@mccluster.org","phone_number":"+1…"}'`
   3. Work the queue from your phone — three stages, money only at the last:
      `GET  /api/travel/requests?key=…` — who wants you where.
      `POST /api/travel/approve  {"key":…,"id":"req:…","max_usd":900}` —
      registers the live quote on the record; spends nothing; the cap
      is pinned here and enforced forever after.
      `POST /api/travel/purchase {"key":…,"id":"req:…"}` — executes as a
      HOLD where the airline allows: seat booked, zero paid, deadline
      returned. Airlines that demand instant payment refuse unless you
      add `"mode":"instant"` on purpose.
      `POST /api/travel/pay      {"key":…,"id":"req:…"}` — the only call
      that touches the balance: pays the held flight and books the
      Hilton-family room (rooms cannot be held). Stale prices past 5%
      of the approval stop cold and ask you to re-approve.
   Route `/api/travel/*` to it. Flip your active base from the phone
   (`POST /api/travel/base {"base":"ga","key":…}`) — and wire the desk
   login to POST it so the base follows you automatically. Until deployed,
   the hire page's Booked-Anywhere section still captures the destination
   into every lead.
5. **The ledger goes live-editable**: `data/sites.json` moves to KV with
   a tiny admin Worker (Cloudflare Access protects it, free for one
   user). Flip a price from your phone; no commit, no deploy.
6. **Cloudflare Web Analytics** beacon on every page — cookieless, so no
   consent banner needed — alongside the existing first-party events.
7. **Health checks**: a Cloudflare Health Check on `/` with email alert.
   You find out before a client does.
8. **Supabase hardening**: RLS on every table (leads insert-only for
   anon), scheduled backups on, and the SQL from the opportunity-engine
   plan applied once the connector is authorized.

## Phase 3 — the multipliers (not Cloudflare, still do them)

1. **Wire the Teardown end-to-end**: Stripe Payment Link on the product
   row + Cal.com paid event type — booked, charged, calendared with zero
   manual steps. The credit-back is a coupon code you hand out on the
   call.
2. **Search Console + sitemap.xml + IndexNow**: the portfolio panel and
   Person schema are already built for search; make sure the index
   actually sees them.
3. **Designed OG images** for hire/portfolio/album — the link preview is
   the first impression in every DM and group chat.
4. **A /now page** — updated monthly, dated. Nothing says "a real human
   runs this" like a timestamp that moves.
5. **Lighthouse CI** as a GitHub Action on PRs: performance and a11y
   scores gate the merge, so the site never quietly gets slow.
6. **Uptime + deliverability drills quarterly**: mail-tester.com for the
   email path, the Playwright suites for the site.
7. **Paper**: a one-page terms sheet for packages/discounts (what "from"
   means, deposit, kill fee), and a privacy line on the gate — the leads
   table is personal data.
8. **Tax check**: whether CT sales tax applies to the Teardown as a
   digital product — one question to the accountant before Stripe is
   live.
9. **BUY NOW PAY LATER — the client pays in pieces, you get it all
   upfront.** Two switches cover every price on the card:
   - **Square (Afterpay — Square owns it):** Dashboard → Settings →
     Payments → Afterpay. Turns on pay-in-4 for $1–$2,000 checkouts
     (Teardown, sessions, shoot days) on the EXISTING payment links and
     invoices, and 6/12-month installments on invoices $400–$4,000
     (brand film). Full payment lands upfront, Afterpay eats the risk;
     the fee (~6%) is the cost of closing people who'd otherwise walk.
   - **Stripe (Klarna + Affirm + Afterpay):** Dashboard → Settings →
     Payment methods → enable all three. Affirm finances up to ~$30k —
     that is how a $13,500 Full Campaign becomes a monthly payment.
     Attach to Stripe Payment Links for the big tickets.
   - **Reality checks:** BNPL never applies to recurring subscriptions
     (the monthly lanes are already installments by nature); and the
     account is registered as a charity (MCC 8398) — if Afterpay balks
     at the category, ask Square support to class the services location
     as creative services. Only after the toggles are LIVE do we print
     "Afterpay · Klarna · Affirm accepted" on the rate card — the site
     never claims a payment method it cannot take.

---

*Everything in Phase 0 is free-tier except Stripe's per-transaction cut.
The whole migration is a weekend; the Workers are another one.*

> **Financing line switch:** once BNPL is live, add `data-financing="on"` to the `<html>` tag of `hire.html` — the pay-in-full-or-installments line on the rate card is CSS-hidden until then, so the page never advertises a method that isn't on.
