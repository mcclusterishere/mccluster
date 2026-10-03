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
| Answers | What is McCluster Corp? | Who is Matthew McCluster, what has he made, what does he do? |
| Share preview | McCluster Corp, explained | Matthew McCluster, not "only the album" |
| Entity | Organization `https://matthew.mccluster.org/#mccluster-corp` | Person `https://matthew.mccluster.org/#matthew-mccluster` |
| WebSite node | `https://mccluster.org/#website`, published by the Organization | `https://matthew.mccluster.org/#website`, published by the Person |
| Source | `data/seo/company-site.json` → `tools/build-company-site.mjs` → `workers/mccluster/src/company-site/pages.generated.js` | static HTML at the repository root |
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
│                 ├── Uprise Action Network    software product, connected to Equity Uprise's action model
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
  the Docket 516R record (Equity Uprise's front page), the Action Network
  (`/action/`, `mnet.html`, receipts), the campaign pages, PRIM3, McCluster
  Sites, services and booking, the music-creator platform, the privacy policy.
- **Whip Equipped LLC** (separate company) at `whip.html`.

**Ownership changes navigation, metadata and which entity a page is about. It
does not move a URL.** The company *apps* stay where they are, deliberately:

- Sessions are per-origin `localStorage` (`js/backend.js`).
- Checkout returns are hardcoded to `matthew.mccluster.org`
  (`supabase/functions/checkout/index.ts`).
- The Supabase Auth redirect allowlist names that host.
- Printed QR codes and live campaign links point at these paths.

Moving the Action Network, accounts or checkout to `mccluster.org` would sign
members out and break payment returns. The company property describes these
products and links into them.

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
  (`workers/mccluster/src/company-site/router.js`) serves the company pages
  (`/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`). Every other path gets
  the same 301 to `https://matthew.mccluster.org/$1` the redirect rule
  gives today, so every existing link, QR code and campaign funnel lands
  exactly where it does now. `www` sends company paths to the apex.
  `here.mccluster.org` keeps its redirect rule.
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
4. Verify:
   - `curl -I https://mccluster.org/` returns 200, the company page.
   - `curl -I 'https://mccluster.org/action/?c=end-racism'` returns a 301 to the same path on `matthew.mccluster.org`.
   - `curl -I https://www.mccluster.org/` returns a 301 to `https://mccluster.org/`.
5. Search Console: add the `https://mccluster.org/` property (the DNS
   verification TXT records exist) and submit `https://mccluster.org/sitemap.xml`.
6. Supply a 1200×630 McCluster Corp share card. Until then the company preview
   uses the supplied M mark (`assets/img/m-mark.png`), unaltered. Agents do
   not draw or composite one (AGENTS.md, logos).

Mail for `mccluster.org` is Google Workspace (MX). Routing HTTP to the Worker
does not touch MX; do not swap the apex DNS record for a Worker custom domain
without checking the MX and TXT records survive.

## Changing either property

- Company copy: edit `data/seo/company-site.json` (facts only; the same
  evidence rules as the newsroom), run `node tools/build-company-site.mjs`,
  commit the generated module. CI fails if they drift.
- Entity facts: `data/seo/entity-graph.json`, then
  `node tools/build-profile-entity.mjs` and `node tools/build-company-site.mjs`.
- Personal root metadata (`index.html` `<head>`): Matthew-first. Change the
  metadata only; the album UI is not rewritten (AGENTS.md).
