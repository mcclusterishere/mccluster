# Two properties, two entities

**Owner instruction, 2026-10-03.** Machine-readable authority:
[`data/seo/domain-architecture.json`](../../data/seo/domain-architecture.json).
Tests: `scripts/test/domain-architecture.test.mjs` and
`workers/mccluster/test/company-site.test.mjs`.

There are **two related but distinct canonical web properties**. Do not
collapse them.

| | `https://mccluster.org/` | `https://matthew.mccluster.org/` |
| --- | --- | --- |
| Whose house | **McCluster Corp** | **Matthew McCluster** |
| Answers | At its root, the Human Uprise World (the company's platform: where is the movement, what can I do today); at `/company`, what is McCluster Corp? | Who is Matthew McCluster, what has he made, what does he do? |
| Share preview | McCluster Corp, explained | Matthew McCluster, not "only the album" |
| Entity | Organization `https://matthew.mccluster.org/#mccluster-corp` | Person `https://matthew.mccluster.org/#matthew-mccluster` |
| WebSite node | `https://mccluster.org/#website`, published by the Organization | `https://matthew.mccluster.org/#website`, published by the Person |
| Source | `/`: the World, `mnet.html`, passed through from Matthew's property (`workers/mccluster/src/world-host.js`); `/company`: `data/seo/company-site.json` → `tools/build-company-site.mjs` → `workers/mccluster/src/company-site/pages.generated.js` | static HTML at the repository root |
| Served by | Worker `mccluster`, host-routed, once the owner routes the apex to it | GitHub Pages (`CNAME`) |

**The front-door model.** `mccluster.org` is the house for McCluster Corp;
inside it, each product or initiative is its own door.
`matthew.mccluster.org` is Matthew's house; inside it, the I AM HERE album is
a spectacular front door. **Do not confuse a door with the building.** The
album stays the entrance to Matthew's property; it is not the semantic identity
of the property, and it is never the company's homepage.

## Ownership hierarchy

```
Matthew McCluster  (Person, matthew.mccluster.org)
├── founder of ─► McCluster Corp  (Organization, url https://mccluster.org/)
│                 ├── Equity Uprise            public-interest project
│                 ├── Human Uprise             movement-creation social platform (formerly the Uprise Action Network); Equity Uprise runs on it as a program
│                 ├── PRIM3                    learning project / product
│                 ├── McCluster Platform       the technical platform operated for McCluster Corp
│                 ├── McCluster Sites          web services
│                 └── media, creative and music/catalogue services
├── founder and owner of ─► Whip Equipped LLC   a SEPARATE company. Never a McCluster Corp sub-brand.
└── artist of ─► I AM HERE                       his album; published through the ecosystem (publisher McCluster Corp, ISRC registrant QT6KV)
```

Rules that follow from it:

- **Stable `@id`s do not move.** The Organization's `@id` stays
  `https://matthew.mccluster.org/#mccluster-corp`: it is an identifier every
  page, generator and test joins on, not a link. Its **`url`** is
  `https://mccluster.org/`. The Person's `url` is
  `https://matthew.mccluster.org/matthew-mccluster.html`.
- Define each entity in full only where it lives: the Person on the profile
  page, the Organization on the profile graph and the company property (both
  generated from `data/seo/entity-graph.json`). Everywhere else, reference the
  `@id`.
- Never give the Organization Matthew's personal accounts as `sameAs`, never
  name the personal WebSite after the company, and never call the company
  "Matthew McCluster / McCluster Corp".
- PRIM3 is McCluster Corp's learning product, not Matthew's recording alias.
- Whip Equipped LLC appears under Matthew, never under McCluster Corp.

## What lives where (and why most URLs do not move)

`data/seo/domain-architecture.json` → `url_ownership` lists every page. In short:

- **Matthew's property:** the album front door, profile, résumés, engineering
  evidence, portfolio, gallery and walls, films, music, catalogue, licensing,
  policy writing, case studies, press kit, newsroom.
- **McCluster Corp products hosted on Matthew's property for compatibility:**
  the company's product map (`mccluster-corp.html`, with
  `data/product-context.json`; it explains how the products connect, the
  company property links to it, and it keeps its URL), the Docket 516R record (Equity Uprise's front page), Human Uprise,
  formerly the Action Network (`/action/`, `mnet.html`, `action-globe.html`, receipts), the campaign pages, PRIM3, McCluster
  Sites, services and booking, the music-creator platform, the privacy policy.
- **Whip Equipped LLC** (separate company) at `whip.html`.

**Ownership changes navigation, metadata and which entity a page is about. It
does not move a URL.** The company *apps* stay where they are, deliberately:

- Sessions are per-origin `localStorage` (`js/backend.js`).
- Checkout returns are hardcoded to `matthew.mccluster.org`
  (`supabase/functions/checkout/index.ts`).
- The Supabase Auth redirect allowlist names that host.
- Printed QR codes and live campaign links point at these paths.

Moving Human Uprise, accounts or checkout to `mccluster.org` would sign
members out and break payment returns. Serving the World *additionally* at
`https://mccluster.org/` (owner, 2026-10-15, below) moves nothing: every URL
on Matthew's property keeps working, the bar carries a member's sign-in
across the two origins, and checkout returns still land on
`matthew.mccluster.org`. The company page describes the products and links
into them.

A product page moves to `mccluster.org` only when there is a reason beyond
tidiness, one page at a time. Each move needs a 301 from the old URL, an updated
canonical and sitemap entry, and a check that no session, checkout or funnel
depends on the old origin.

## The edge, today and target

- **Today (checked 2026-10-03):** a Cloudflare zone redirect rule sends
  `mccluster.org/*`, `www.mccluster.org/*` and `here.mccluster.org/*` to
  `https://matthew.mccluster.org/$1` (301). Sharing `mccluster.org` therefore
  shows Matthew's album preview, and there is no company page.
  `matthew.mccluster.org` is a DNS-only CNAME to GitHub Pages.
- **Target:** `mccluster.org/*` and `www.mccluster.org/*` route to the one
  Worker, `mccluster`. Its company router
  (`workers/mccluster/src/company-site/router.js`) serves the World at `/`
  (owner, 2026-10-15: "we need mccluster.org to actually show the World"):
  `mnet.html` passed through from Matthew's property with this host's own
  head (canonical `https://mccluster.org/`, site name McCluster Corp, a
  WebPage node of the company WebSite), plus the World's rooms, the sign-in
  pages and the static files (noindex), so a member's session holds from
  the Earth to the mission dialog; `/mnet.html` is a 301 to `/`. It serves
  the company pages at `/company`, `/robots.txt`, `/sitemap.xml` and
  `/llms.txt`. Every other path gets the same 301 to
  `https://matthew.mccluster.org/$1` the redirect rule gives today, so every
  existing link, QR code and campaign funnel lands exactly where it does
  now. `www` sends what the host serves to the apex and the rest to
  Matthew's. `here.mccluster.org` keeps its redirect rule.
- Why the Worker, and not a second Pages site or a new Worker:
  - GitHub Pages holds one custom domain per repository.
  - The architecture allows one Worker, and serving a host is ingress and routing.
  - A redirect for every non-company path has to be a real 301, which a
    static host cannot give.

  The router code is inert until the route exists: it only answers requests
  whose host is `mccluster.org` or `www.mccluster.org`.

### Activation (owner)

1. Merge; confirm `https://api.mccluster.org/v1/health` reports the merged SHA.
2. Cloudflare → Workers Routes: `mccluster.org/*` and `www.mccluster.org/*` →
   Worker `mccluster`.
3. Cloudflare → Rules → Redirect Rules: narrow the apex rule to
   `here.mccluster.org` only. Redirect rules run before Workers, so nothing
   changes until this step; rollback is re-widening the rule.
4. Supabase → Authentication → URL Configuration → Redirect URLs: add
   `https://mccluster.org/**`, so ordinary sign-in on the host (login.html,
   magic links) may return to it. The bar's own handoff needs nothing: it
   verifies a one-time token, it never redirects.
5. Verify:
   - `curl -I https://mccluster.org/` returns 200, the World (its body is
     `mnet.html`; its head names `https://mccluster.org/` as canonical and
     McCluster Corp as the site; its title and share card "Human Uprise ·
     McCluster" with the M mark; no `noindex`).
   - `curl -I https://mccluster.org/company` returns 200, the company page;
     `https://mccluster.org/company/` is a 301 to it.
   - `curl -I http://mccluster.org/` returns a 301 to `https://mccluster.org/`
     (the Worker answers plain http on the apex; Cloudflare's "Always Use
     HTTPS" on the zone does the same at the edge).
   - `curl -I 'https://mccluster.org/mnet.html?view=feed'` returns a 301 to `https://mccluster.org/?view=feed`.
   - `curl -I https://mccluster.org/docket-516.html` returns a 301 to the same path on `matthew.mccluster.org`.
   - `curl -I https://www.mccluster.org/` returns a 301 to `https://mccluster.org/`.
   - On Matthew's site the Globe tab already points at
     `https://mccluster.org/?view=feed` (`js/tabbar.js`, `WORLD_ORIGIN`,
     flipped 2026-10-15). Until steps 2 and 3 land, the redirect rule
     bounces that link to Matthew's root, which forwards it to
     `mnet.html?view=feed` on his origin; once they land, it is direct.
6. Search Console: add the `https://mccluster.org/` property (the DNS
   verification TXT records exist) and submit `https://mccluster.org/sitemap.xml`.
7. Supply a 1200×630 McCluster Corp share card. Until then the company preview
   uses the supplied M mark (`assets/img/m-mark.png`), unaltered. Agents do
   not draw or composite one (AGENTS.md, logos).

Mail for `mccluster.org` is Google Workspace (MX). Routing HTTP to the Worker
does not touch MX; do not swap the apex DNS record for a Worker custom domain
without checking the MX and TXT records survive.

## The World's door today: `mccluster.org` (owner, 2026-10-15)

"We don't need humanuprise.com live right now. We need mccluster.org to
actually show the World." So the company host's root is the World, by the
same mechanics as Human Uprise's own door below (`workers/mccluster/src/
world-host.js`, shared by both routers), and the bar's Globe goes there from
Matthew's site. Human Uprise is McCluster Corp's platform, so the company's
root stays company-first: canonical `https://mccluster.org/`, `og:site_name`
McCluster Corp, a WebPage node that belongs to `https://mccluster.org/#website`
and is about the Organization (the same stable `@id`). The company page,
"What is McCluster Corp?", with the WebSite and Organization nodes, is
`https://mccluster.org/company`, and it opens the World from its header.
`humanuprise.com` stays built and inert until the owner routes it; nothing
below changes.

## The company's news: `mccluster.org/news/` (owner, 2026-10-20)

"Getting my admin's posts as their own news worth posts and getting them
published on GDELT." A post the house owner marks "Publish to the newsroom"
is also an article at `https://mccluster.org/news/<headline-slug>-<post id>`,
server-rendered by `workers/mccluster/src/company-site/news.js` (crawlers such
as GDELT read the HTML; they do not run scripts). It is company-first like the
rest of the host: `og:site_name` McCluster Corp, a `NewsArticle` whose
publisher is the Organization by its stable `@id` and whose author is Matthew
McCluster by his, belonging to `https://mccluster.org/#website`. The index is
`/news/`, the RSS feed `/news/feed.xml`, and `/news/sitemap.xml` carries
Google News' tags for the last two days (robots.txt lists it). The evidence
newsroom on Matthew's property (`/newsroom.html`, built from the evidence
ledger) is a different thing and stays where it is. How it gets into Google
News and GDELT: `docs/action-network/NEWSROOM.md`.

## Human Uprise's host: `humanuprise.com`

Three hosts, still two entities. Human Uprise is McCluster Corp's platform
(the Organization above), so `humanuprise.com` is a company host, not a third
entity and not Matthew's. Owner, 2026-10-14: the World (the globe, the context
strip, the feed) is Human Uprise's own solo experience at its own address,
interconnected with the rest.

| | `https://humanuprise.com/` |
| --- | --- |
| Whose | McCluster Corp's platform, Human Uprise |
| Answers | Where is the movement, and what can I do today? |
| Entity | Organization `https://matthew.mccluster.org/#mccluster-corp` (the same stable `@id`) |
| Source | the World, `mnet.html`, as published on Matthew's property; nothing is duplicated |
| Served by | Worker `mccluster`, host-routed (`workers/mccluster/src/human-uprise/router.js`); inert until the owner routes the host |

- `/` is the World, passed through from `matthew.mccluster.org/mnet.html` with
  this host's own canonical. The World's rooms, the sign-in pages and the
  static files ride the same way (noindex); every other path is a 301 to the
  same path on `matthew.mccluster.org`. So Music, the M, every creator page
  and every record land on Matthew's property; the World stays here.
- The bar (`js/tabbar.js`) reads the same on every host: Music | M | Globe.
  On a World host (`mccluster.org`, `humanuprise.com`), Music and the M link
  to Matthew's site outright and the Globe is the root; on Matthew's site
  the Globe goes to `WORLD_ORIGIN`, `https://mccluster.org/` since
  2026-10-15 (to point it at `humanuprise.com` later, flip that one line
  after routing it).
- Sessions are per origin, and one M Account works on every host anyway: the
  bar carries a member's sign-in across (`js/tabbar.js` → `/v1/auth/handoff`,
  `workers/mccluster/src/auth-handoff.js`), and the arriving host earns a
  session of its own. No refresh token crosses. The API's CORS allowlist
  carries the host; it is also the list of hosts a sign-in may be carried to.
- Why not a second Pages site or Worker: the same reasons as the company host
  (one custom domain per repository; one Worker; serving a host is ingress).
- Activation and verification: `docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md`
  → "Production domain". Tests: `workers/mccluster/test/human-uprise-site.test.mjs`,
  `scripts/test/human-uprise-door.test.mjs`.

## Changing either property

- Company copy: edit `data/seo/company-site.json` (facts only; the same
  evidence rules as the newsroom), run `node tools/build-company-site.mjs`,
  commit the generated module. CI fails if they drift.
- Entity facts: `data/seo/entity-graph.json`, then
  `node tools/build-profile-entity.mjs` and `node tools/build-company-site.mjs`.
- Personal root metadata (`index.html` `<head>`): Matthew-first. Change the
  metadata only; the album UI is not rewritten (AGENTS.md).
- Which file under `data/` is the record for a fact, which is generated from
  it (and by which `tools/build-*.mjs`, each with `--check`), and which is a
  display mirror of a Supabase table: `data/README.md`.
