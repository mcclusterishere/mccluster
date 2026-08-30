# CURRENT STATE: what the Here platform is today

Audited 2026-07-28 on branch `claude/gallery-prints-selector-8qe16l`.
This is the Phase 0 report the master infrastructure brief requires:
no changes were made to reach these findings.

## The 16-point audit

1. **Frontend framework:** none. 55 hand-authored HTML pages + 22
   vanilla-JS modules (~5,300 lines in `js/`), CSS design tokens in
   `css/style.css`. Self-installing module pattern (masthead.js,
   tabbar.js, counter.js, closet.js resolve the site root from their
   own `script.src`, so pages in `walls/ tracks/ closet/` work
   unchanged). No React/Vue/Svelte anywhere.
2. **Build system:** none. Deploy = mirror the branch to `gh-pages`
   with `__STAMP__` cache-buster substitution. `package.json` exists
   only for Capacitor (`@capacitor/core+android 6.1`); no bundler, no
   lockfile, no node_modules in the repo.
3. **Routing:** file-based (`page.html`), hash routing inside pages
   (`gallery.html#shop`, `#/buy/<id>`, `inner-room.html#mt6v33`).
   `prints.html` is a hash-preserving redirect stub, the pattern for
   future route retirement.
4. **PWA configuration:** `manifest.json` + theme color + icons; the
   fourth-tab experience (Prayer Closet) is fully inside the shell.
5. **Service worker:** `sw.js` ("THE KEEPER"), conservative: same-
   origin only, media pass-through, cache-first fonts/images,
   network-first pages/data, version stamped per deploy. Registered
   root-resolved from `theme.js`/`analytics.js`.
6. **Supabase integration:** hardcoded project URL + *publishable*
   key in `js/backend.js`/`js/crm.js` (by design; RLS is the guard).
   PostgREST for leads/events/prints/offerings; GoTrue for auth;
   2 edge functions in-repo (`checkout`: offering-driven Stripe;
   `square-checkout`: legacy Square).
7. **Authentication:** GoTrue email magic-link + password
   (`js/backend.js`), sessions in localStorage. Cannot cross
   subdomains; the fix is specced in
   `docs/shared-accounts-architecture.md` (account.mccluster.org,
   HTTP-only cookies). Owner desks gate on `matthew@mccluster.org`
   via RLS.
8. **Database migrations:** `supabase/migrations/0001` to `0007` (CRM,
   legacy connect-SaaS, creator cuts, print shop, comments, rights
   flags, offerings). `.github/workflows/migrate-db.yml` applies them
   in order on push, tracked in a `_migrations` table. **Dormant
   until the `SUPABASE_DB_URL` repo secret is set.**
9. **Payment code:** offering-driven: `supabase/functions/checkout`
   reads price/currency/seller from the offerings table, never from
   the client. `js/payments.js` was stripped of all marketplace rails
   (Connect onboarding, destination charges, spreads; see
   docs/here-inventory.md). No Stripe key ships in the client. Square
   function is legacy, queued for retirement.
10. **Analytics:** `js/analytics.js` (gtag `G-38KDY01Z2V` + first-party
    events to Supabase `events`), `js/signals.js` behavioral signals,
    `js/crm.js` first-touch attribution → `leads`.
11. **Environment variables:** none client-side (static site). Server
    config lives in the Supabase function vault (`STRIPE_SK`).
    Actions secrets: `SUPABASE_DB_URL` (expected, not yet set).
12. **GitHub Pages deployment:** `deploy-pages.yml` (main/production →
    stamp → force-push `gh-pages`), CNAME `matthew.mccluster.org`.
    **Bug found in audit:** the stamper covers root + `walls/` only;
    ten pages in `tracks/` and `closet/` ship a literal `__STAMP__`
    query param (assets still load; cache-busting is defeated).
13. **Test coverage:** zero automated tests. Verification has been
    session-driven Playwright runs, not CI.
14. **Security issues:** (a) `leads`/`events` accept anonymous inserts
    by design, and spam/abuse throttling is client-side only; (b) no CSP
    or security headers (GitHub Pages cannot set headers; meta-CSP
    possible); (c) localStorage tokens are XSS-reachable, acceptable
    for today's scope, retired by the shared-accounts redesign;
    (d) admin desks are RLS-guarded but have no server-side audit log;
    (e) Supabase **Free tier has no point-in-time recovery**, so backup
    posture is a real gap (§23 of the brief); (f) the public repo
    mirrors `supabase/` SQL to gh-pages: schema disclosure, accepted.
15. **Reusable components:** the offerings ledger + checkout function
    (already the brief's "server owns price" rule), the migrations
    pipeline, the Capacitor Android shell + `build-android.yml`
    (builds a bundled-`www/` debug APK, *not* a remote-URL wrapper),
    the counter (buy sheet), auth module, CRM capture, the Prayer
    Closet data-driven pattern (`data/prayer-closet.json` as admin
    panel), the tab bar + masthead entrance system, the SW.
16. **Deprecation queue:** `square-checkout` function, `js/network.js`
    provider-directory remnants, `role.html`/`cut.html` (410 queued in
    the migration map), mothership marketplace edge functions
    (pay-now/connect-onboard/pay-deal/backend-sub; superseded by
    `checkout`).

## What this adds up to

The property is a **well-factored static frontend with a thin
serverless backend** (Supabase Postgres + RLS + 2 edge functions).
The client already never controls price. What's missing for the
master brief is the middle tier: a deployable API + worker, real
environments, CI with tests, observability, backups, and the
provider-neutral gateways (payment, fulfillment, AI). The Android
native shell exists; iOS does not.
