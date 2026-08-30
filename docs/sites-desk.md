# MCCLUSTER SITES: the desk's runbook

Free build. Recurring monthly. The studio makes the changes. The client
never touches a dashboard.

## The offer (mirror of `data/sites.json`, the ledger that IS the admin panel)

Three tiers. Hosting is the floor they were paying anywhere anyway:

- **Hosting, $79.99/mo.** Hosting, security, uptime. ZERO included changes
  (that's the upsell); changes are $29 each.
- **Web Management, $149/mo.** Hosting + 4 change-requests/month,
  human-approved, about 48hr Monday to Friday. The featured tier.
- **Management + Social, $400/mo.** Everything + social media management:
  they send content, the desk posts and plans. The self-serve posting
  platform is specced in `docs/social-platform.md`. Sell the service,
  not the software, until it ships.

**The free build:** 3 seats ever. Seat 01 burned (Freedom's site + the
Shiloh app). After the three: **$2,500 to $15,000 per build** by scope.
Close a seat by bumping `build.taken` in the ledger; the sales page's
counter, the strike-through, and the closing headline all follow.

## Where things live

| Piece | Where |
|---|---|
| Offer page | `sites.html` (indexed; linked from hire + drawer) |
| Onboarding wizard | `onboard.html` (noindex; plan→profile→business→assets→social→review; autosaves to localStorage; files a `kind: onboarding` request) |
| Client console | `console.html` (noindex; Profile-tab auth via `js/backend.js`) |
| Requests + site records | Supabase `site_requests` / `site_accounts`, `supabase/migrations/0008_site_requests.sql` |
| The ledger | `data/sites.json` |
| Billing | Square **subscription** payment link → paste into the ledger's `square` slot. Until then both pages say "billing by email," which is fine for founding clients |

RLS law: clients insert/read **their own** rows only. Status changes and
replies are desk-side (service role: Supabase dashboard or admin tooling).
Clients can never edit or delete a request: the trail is the record.

## Fulfilling a request (the concierge loop)

1. Request lands in `site_requests` (status `new`). Read it in the Supabase
   dashboard, or the console shows it to the client with the same status.
2. **Feed it to Claude** in a session on that client's repo, exactly like the
   HERE sessions: paste the request, review the diff.
3. Set status `awaiting_approval` while you look. **You approve every change**
   That's the promise on the page.
4. Deploy, set status `live`, and write a one-line `reply` ("New photos are
   up, check the gallery"). The reply shows in their console.
5. If it's out of scope (redesign, new store, custom feature): status
   `declined` + a reply that quotes it as a project instead. Never silently.

**What counts as one request:** one focused change using content the client
supplies: text, photos, a section, a page. The market's carve-out (≈30
minutes of work) is the right instinct; ours is "one ask, plainly stated."

## The voice

It's **the McCluster studio desk**, never "Matthew personally typed this at
2am," never a nameless bot. AI does the labor, the studio signs the work,
a human approves everything. If a client asks how it's so fast: "the studio
runs on very good tools, and every change still gets human eyes before it
ships." True, and it's the pitch.

## Selling the first five

The pitch, one breath: *"You're paying for hosting anyway. Pay it here,
$79.99, and the build is free. Want to never touch a dashboard? $149 and
the desk makes your changes. Want your feeds run too? $400, all of it,
one desk."*

Seat rules: the free build comes with any tier while `build.taken < 3`.
When a client signs, bump `build.taken` and put their name in `taken_by`.

## When the machine gets built (after 3 to 5 paying)

`apps/api` (Fastify, scaffolded) on Railway + `packages/ai` (the
vendor-neutral gateway, built for exactly this) drive Claude on each
client's repo → PR → **you tap approve** → deploy. Stripe/Square webhooks
flip plan state; quota enforcement moves server-side. Until then, the desk
enforces quota by eye and the console just displays it.
