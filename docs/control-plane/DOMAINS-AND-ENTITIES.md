# One platform, tenant properties, separate entities

**Owner instruction, 2026-10-03**: two related but distinct canonical web
properties for two entities; do not collapse them. **Amended by the owner,
2026-11-23**: "let's just have the whole site on mccluster.org instead, and
matthew.mccluster.org be my profile, my personal profile", and "the real shit
should be equityuprise.com. We haven't done that yet, but it shall be so soon
enough. We must prepare without breaking anything to do that."
Machine-readable authority:
[`data/seo/domain-architecture.json`](../../data/seo/domain-architecture.json)
(v2). The plan: `docs/control-plane/handoff-20261123/specs/SPEC-PLATFORM.md`.
Tests: `scripts/test/domain-architecture.test.mjs`,
`scripts/test/site-hosts.test.mjs` and
`workers/mccluster/test/company-site.test.mjs`.

There is **one platform**, there are **tenant properties** on it, and the
**entities stay separate**. The platform is one origin, set in one place
(`platform.origin` in the record): `https://mccluster.org` now,
`https://equityuprise.com` later (stage F). McCluster Corp operates it.
`https://matthew.mccluster.org` is Matthew McCluster's personal profile, a
tenant of the platform. **Hosting is not identity**: the host that serves a
page never decides which entity the page is about.

**Stage now: P1, the platform serves everything: every page answers at its
path on the platform, and Matthew's host keeps answering every page.** The
record lists what P1 changes once deployed (`edge.now.p1_changes`, below) and
what P0 changed before it (`edge.now.p0_changes`, below); `edge.now` says
what each host answers. P1 ships on the owner's word: Pages first, then the
Worker. Each later stage updates the record's `stage_now` and `edge.now` in
its own change. Until it does, this page names P2 and P3 as planned, never as
live: **P2** moves each page's canonical, sitemap entry, share card and
WebSite to its set's host (platform pages name the platform, profile pages
keep Matthew's host); **P3** makes Matthew's host answer 301 to the same path
on the platform for every page that moved.

| | The platform `https://mccluster.org/` | Matthew's profile `https://matthew.mccluster.org/` |
| --- | --- | --- |
| Whose house | **McCluster Corp**, the platform's operator; Equity Uprise is the public brand | **Matthew McCluster**; McCluster is his artist name, the same Person |
| Answers | At its root, the Equity Uprise World (where is the movement, what can I do today); at `/company`, what is McCluster Corp? Since P1, every page of the site at its path | Who is Matthew McCluster, what has he made, what does he do? |
| Share preview | McCluster Corp, explained; the World's root shares as "Equity Uprise · McCluster" | Matthew McCluster, not "only the album" |
| Entity | Organization `https://matthew.mccluster.org/#mccluster-corp` | Person `https://matthew.mccluster.org/#matthew-mccluster` |
| WebSite node | `https://mccluster.org/#website`, published by the Organization | `https://matthew.mccluster.org/#website`, published by the Person |
| Source | the static site this repo publishes, fetched from `platform.static_origin` (every page at its path and the static files, since P1, `workers/mccluster/src/world-host.js`; at P0 only `/`, the World, `mnet.html`, with its rooms), plus the generated company pages (`data/seo/company-site.json` → `tools/build-company-site.mjs` → `workers/mccluster/src/company-site/pages.generated.js`) | static HTML at the repository root: the `profile` and `profile_only` pages; today it serves every page of the static site |
| Served by | Worker `mccluster` by host (routed) | GitHub Pages (`CNAME`, DNS only) until P3; from P3 Worker `mccluster` by host, from the same static files |

**The front-door model.** The platform's door is the World: `mccluster.org/`
opens on it, and inside the platform each product or initiative is its own
door. Matthew's profile's door is the I AM HERE album:
`matthew.mccluster.org/` opens on it (`owner_decisions.profile_root`).
**Do not confuse a door with the building.** The album stays the entrance to
Matthew's profile; it is not the semantic identity of the profile, and it is
never the platform's homepage: since P1 the platform serves the HERE page at
`/index.html`, never at `/`.

## The public brand is Equity Uprise (owner, 2026-10-28)

Owner, 2026-10-28: **the public brand is Equity Uprise, not Human Uprise.**
Every public-facing name says Equity Uprise: the World root's title,
description, Open Graph and Twitter tags and JSON-LD `name` on
`mccluster.org` ("Equity Uprise · McCluster"), page titles and descriptions,
headings and product copy, `llms.txt`, the company page and the entity graph
(the platform's SoftwareApplication is "Equity Uprise World", keeping its
stable `@id` and listing its former names as `alternateName`). The company
stays the site: `og:site_name` on `mccluster.org` is McCluster Corp, and the
Organization's `@id` and `url` do not move.

"Human Uprise" survives only where compatibility needs it, as a legacy
technical identifier, never as a public name: the `humanuprise.com` host and
its routing (`workers/mccluster/src/human-uprise/router.js`,
`HUMAN_UPRISE_ORIGIN`), file names (`human-uprise-*`, `HUMAN-UPRISE-*`),
function and variable names, CSS classes, storage keys, event names, URL
paths, `@id`s, and the `domain-architecture.json` key `human_uprise`. Dated
records (audits, migration notes) keep the name they were written with.

## Ownership hierarchy

```
Matthew McCluster  (Person, matthew.mccluster.org)
├── founder of ─► McCluster Corp  (Organization, url https://mccluster.org/)
│                 ├── Equity Uprise            the public brand (owner, 2026-10-28): the public-interest project and its movement-creation social platform, the Equity Uprise World (formerly "Human Uprise", before that the Uprise Action Network)
│                 ├── PRIM3                    learning project / product
│                 │   └── PRIM3 (the artist)   its music act, its own entity (MusicGroup); artist of Cyber Security Specialist
│                 ├── McCluster Platform       the technical platform operated for McCluster Corp
│                 ├── McCluster Sites          web services
│                 └── media, creative and music/catalogue services
├── founder and owner of ─► Whip Equipped LLC   a SEPARATE company. Never a McCluster Corp sub-brand.
├── artist of ─► I AM HERE                       his album; published through the ecosystem (publisher McCluster Corp, ISRC registrant QT6KV)
└── account manager of ─► PRIM3 (the artist)     manages it from his M Account until it has its own login; NOT its artist, NOT its identity
```

Rules that follow from it:

- **Stable `@id`s do not move.** The Organization's `@id` stays
  `https://matthew.mccluster.org/#mccluster-corp`: it is an identifier every
  page, generator and test joins on, not a link. Its **`url`** is
  `https://mccluster.org/`. The Person's `url` is
  `https://matthew.mccluster.org/matthew-mccluster.html`.
  A page that changes host changes its URL, canonical and WebSite node,
  never an `@id`.
- Define each entity in full only where it lives: the Person on the profile
  page, the Organization on the profile graph and the company property (both
  generated from `data/seo/entity-graph.json`). Everywhere else, reference the
  `@id`.
- Never give the Organization Matthew's personal accounts as `sameAs`, never
  name the personal WebSite after the company, and never call the company
  "Matthew McCluster / McCluster Corp".
- PRIM3 is McCluster Corp's learning product, not Matthew's recording alias.
- **PRIM3 the artist is its own entity** (owner, 2026-11-02: "The album is
  actually called Cyber Security Specialist ... the artist is PRIM3. PRIM3
  needs their own artist page as that is its own artist. Separate entity
  from Matthew McCluster. But controlled by Matthew McCluster's account until
  it gets its own login."). It is the MusicGroup
  `https://matthew.mccluster.org/prim3-artist.html#prim3-artist`, the music
  act of PRIM3, defined in full on its page `prim3-artist.html` and in
  `data/seo/entity-graph.json` → `music_acts.prim3`; every Cyber Security
  Specialist recording is `byArtist` that node, never Matthew's `@id` (he
  appears only where a track's credits name him; none do yet). The album keeps
  its slug `prim3` and catalog keys `prim3:*`, so no URL moves.
  "Managed by Matthew McCluster" is account control, not authorship: PRIM3 is
  its own M identity with no login, and Matthew's account acts for it as its
  label admin (`supabase/pending/music_label_artists_v1.sql`, the label
  model). PRIM3 getting its own login is one `m_auth_user_links` row for its
  identity (and, if wanted, revoking the manager row); its profile, tracks and
  assets do not move. Matthew's pages keep their Matthew-first metadata; his
  profile graph does not list the act. Equity Uprise's music act
  (`catalogue.html#artist-equity-uprise`) is the same kind of entity.
- Whip Equipped LLC appears under Matthew, never under McCluster Corp.

## What lives where, and how a page moves

`data/seo/domain-architecture.json` → `url_ownership` puts every published
page (the static tree `deploy-pages.yml` publishes) in exactly one set, by its
URL path, and `scripts/test/domain-architecture.test.mjs` fails on a page in
none or in two:

- **`platform`** (132 pages): its home is the platform. The World
  (`mnet.html`) and its rooms, music (`listen.html`, `album.html`,
  `catalogue.html`, `license.html`, `music-videos.html`, `music-creator.html`,
  `/tracks/…`, `prim3-artist.html`), Creator Studio, the account and sign-in,
  checkout, and McCluster Corp's products: the product map
  (`mccluster-corp.html`), the Docket 516R record, the Action Network
  (`/action/`, `action-globe.html`), the campaign pages, PRIM3, McCluster
  Sites, services and booking, the privacy policy. PRIM3 Site 0 (`/site0/`)
  joins it at deploy (`promoted_at_deploy`).
- **`profile`** (35 pages): its home is Matthew's host. The HERE front
  door (`/`), his profile, résumés, `/engineering/…`, portfolio, card, press,
  gallery and walls, photography, films, policy writing, case studies, the
  evidence newsroom (`owner_decisions.person_pages_home`) and the carry page
  (`carry.html`, which answers the platform's carry).
- **`profile_only`** (13 pages): only Matthew's host serves it. Whip
  Equipped LLC, his separate company (`whip.html`, `/whip/…`,
  `we-manufacture.html`), and the four owner-decision pages
  (`prayer-closet.html`, `/closet/…`, `inner-room.html`, `fbi.html`, with
  the moved-page stub `merch.html` that points at one of them).
- **`both_hosts`**: `/js/`, `/css/`, `/assets/`, `/data/`, `/vendor/`,
  `sw.js`, `manifest.json`, `embed.html`, `carry.html`, `/.well-known/`.
  Never a 301 on Matthew's host: shared images, embeds, the installed app and
  certificate renewal depend on them.

**Ownership names whose page it is; it never moves an `@id`.** Before P1 every
page answered where it did on 2026-11-23. A page moves in stages that never
break a working address:

1. **P1** (live): the platform serves the page at its path (its canonical still
   names Matthew's host, so search does not move yet). A session moves
   through the carry page (`carry.html` on the profile host, `js/carry.js` on
   the platform), never with a token in a URL; where the carry finds nothing,
   one clear line asks once. A `profile` page is also served on the platform
   as an in-app copy whose canonical stays on Matthew's host, so the player
   keeps running; a `profile_only` page answers 301 from the platform to
   Matthew's host.
2. **P2** (planned): its canonical, sitemap entry, share card and WebSite move to its
   set's host. `@id`s never move.
3. **P3** (planned): only then does its old address on Matthew's host answer 301 to the
   same path on the platform, query intact.

The October 2026 reasons for keeping the company apps on Matthew's host, and
how each is answered:

- *Sessions are per-origin `localStorage` (`js/backend.js`).* The carry moves
  a member's session to the platform (since P1; measured same-site in
  Chromium, 2026-11-23): `js/carry.js` frames `carry.html` on Matthew's host
  and trades what it hands back at `POST /v1/auth/handoff`. Before P1 the bar's
  fragment hand-off carried a sign-in across (`js/tabbar.js`); its writer is
  off since P1, and its reader only scrubs an old link until P4 and trades
  nothing.
- *Checkout returns are hard-coded to `matthew.mccluster.org`
  (`supabase/functions/checkout/index.ts`).* Returns follow the request: a
  checkout or account return goes back to the origin it started from when
  that origin is on the generated site list (`returnOrigin` in
  `supabase/functions/_shared/site-hosts.ts` and
  `workers/mccluster/src/platform/hosts.generated.js`). Each function that
  still builds a return from a literal is listed in
  `scripts/test/site-hosts-pending/functions.json` until it moves to that rule.
- *The Supabase Auth redirect allowlist names that host.* It already names
  `https://mccluster.org/**` (owner, 2026-11-18).
- *Printed QR codes and live campaign links point at these paths.* They keep
  working: nothing answers 301 before P3, and from P3 every old address
  answers 301 to the same path, query intact.

Serving the World at `https://mccluster.org/` (owner, 2026-10-15, below)
moved nothing, and neither P0 nor P1 moves anything: every URL on Matthew's
host keeps working (P1 adds the platform's answers and takes none from his
host).

## The edge, today and target

**Today (P1, once deployed; `edge.now`; P0's answers were measured on
2026-11-23 with GET and HEAD only, and P1's are those of the local crawl over
this checkout, `scripts/e2e/platform-hosts.e2e.mjs`, until it is deployed and
crawled live; its browser half, `--browser`, opens every page the platform
serves in Chromium at 390 px and fails on a document asked for on Matthew's
host, his carry page aside, or an error the page's copy there does not log):**

| Host | Answers |
| --- | --- |
| `mccluster.org` | Worker mccluster by host (routed): the World at / with the platform's head (canonical https://mccluster.org/, og:site_name McCluster Corp); every platform and profile page at its path, passed through from the static origin, query intact (the HERE front door at /index.html; World queries there and /mnet.html 301 to /); Whip Equipped and the owner's own pages (profile_only) 301 to the same path on matthew.mccluster.org; the static files, embed.html (framed by any site), sw.js, manifest.json (the platform's app starts on the World) and carry.html; /company, /news/, robots.txt, sitemap.xml and llms.txt generated or server-rendered; plain http 301 to https. |
| `www.mccluster.org` | Worker mccluster: 301 to the same path and query on https://mccluster.org, every path, in one hop (straight to where the platform sends an address it answers with a 301). |
| `matthew.mccluster.org` | GitHub Pages through a DNS-only CNAME: every page of the static site, unchanged until P3, its own robots.txt (AI crawlers allowed) and its sitemaps; carry.html answers the platform's carry; manifest.json and sw.js serve the app installed from his host. |
| `here.mccluster.org` | Cloudflare zone redirect rule: 301 to the same path on matthew.mccluster.org. |
| `humanuprise.com` | Inert: no address records; once the owner routes it, Worker mccluster answers 301 to the same path and query on the platform, in one hop. |
| `equityuprise.com` | Not on Cloudflare: WordPress.com nameservers and a placeholder page. The platform's planned address (stage F). |
| `api.mccluster.org` | Worker mccluster, the API; no stage changes it. |

**What P1 changes once deployed** (`edge.now.p1_changes`;
`scripts/test/domain-architecture.test.mjs` holds each to the code):

- **The platform serves everything** (`workers/mccluster/src/platform/router.js`,
  `workers/mccluster/src/world-host.js`): every platform and profile page
  answers 200 on `https://mccluster.org` at its path, passed through from the
  static origin, query intact: music and the albums, Creator Studio, account
  and checkout, the company's products, member pages and Control, and the HERE
  front door at `/index.html`. World queries on it (`?view=`, `?mission=`)
  still answer 301 to `/`, and so does `/mnet.html`. The pages the platform
  serves are not noindex there (the World's rooms were at P0); their
  canonicals do not move until P2. An address is read the way the static
  origin (GitHub Pages) reads it: escapes decoded, repeated slashes as one, a
  name without `.html`, a directory without its slash. Another spelling of a
  page answers 301 to the page itself, wherever it lives (`/listen` to
  `/listen.html`, `/mnet` to `/`), and a path the record does not name is
  passed through only while the static origin answers it with no document,
  so the platform serves no page the record does not name. The documents it
  passes through are kept at the edge 60 s (the carry page aside).
- **Whip and the owner's own pages stay on his host**: `profile_only` pages
  answer 301 on the platform to the same path on
  `https://matthew.mccluster.org`, query intact, at every spelling of their
  address the static origin reads (`/whip`, `//whip.html`, `/whip%2Ehtml`
  and `/%77hip.html` all go to `/whip.html` there), and so does everything
  under Whip Equipped's directories (`/whip/`).
- **www goes to the apex**: `www.mccluster.org` answers 301 to the same path
  and query on `https://mccluster.org` for every path, in one hop: where the
  platform itself answers an address with a 301 (Whip Equipped to Matthew's
  host, the World's other addresses to its root, another spelling to its
  page, `/company/` to `/company`), www sends the visitor straight there.
- **humanuprise.com goes to the platform**: once the owner routes it, it and
  its www answer 301 to the same path and query on the platform, in one hop
  as www does (`owner_decisions.humanuprise_com`); until then they stay inert.
- **The platform's app starts on the World**: the platform's `manifest.json`
  carries `start_url` `/` (`platform.app_start_path`,
  `owner_decisions.platform_app_start`); every other member is the published
  file's. Matthew's host serves the file unchanged, so the app installed from
  his host keeps starting on its HERE page.
- **The bar is local on the platform**: Music `listen.html`, the M the HERE
  front door `index.html`, the Globe the World at `/`; on Matthew's host
  Music and the Globe point at the platform and the M at his own root. The
  World is `/` and `/mnet.html` only, never `/index.html`. Each answer is a
  small named function reading `window.MCC_SITE` (`js/tabbar.js`,
  `js/world-audio-continuity.js`, `js/music-shell.js`).
- **The carry is on**: a platform page with no usable session asks Matthew's
  host once, through a hidden same-site frame of `carry.html`, for the access
  token this browser holds there, and trades it at the existing
  `POST /v1/auth/handoff` for a session of the platform's own. No token is in
  any URL, no refresh token crosses, and his host stays signed in. Where
  nothing can be carried, the sign-in page and the account chip say one line
  for 30 days.
- **The fragment hand-off writer is off**: no link carries `#mcc_handoff` any
  more; its reader only scrubs an old link from the address until P4 and trades
  nothing (a token nobody writes any more is someone else's).
- **The installed app's move card**: the app installed from Matthew's host,
  launched from the Home Screen there, says once, in the bar's own peek card,
  that the app now lives at `mccluster.org`; `index.html` is not edited.
- **Returns fall back to the platform**: a return whose request names no
  origin that serves pages comes back to the platform; a return started on his
  host still comes back to his host.

**What P0 changed** (`edge.now.p0_changes`;
`scripts/test/domain-architecture.test.mjs` holds each to the code):

- **The pass-through's redirects** (`workers/mccluster/src/world-host.js`): a
  redirect of the static origin is never followed. A directory under the
  World's prefixes asked for without its slash (such as `/js/halo` or
  `/assets/img` on `mccluster.org`) answers GitHub's 301 on the requesting
  host, to the same directory with its slash, where production followed it
  and answered what the slashed address answers (for `/js/halo`, measured:
  404). A redirect to any other origin is refused with a 502.
- **Returns follow the request** (SPEC-PLATFORM 2.9): a checkout, Connect or
  account return started on `https://mccluster.org` (a World room such as
  `/account.html`) comes back there; at P0 a return from anywhere else came
  back to `https://matthew.mccluster.org`, as before (since P1, to the
  platform). shake-order keeps an operator's
  `SITE_URL` ahead of the request, as before.
- **The dead Here returns**: the three returns that named
  `mcclusterishere.github.io/Here` (backend-sub, and pay-now and
  connect-onboard, which still answer 410) land on today's live page.
- **The direct-sale CORS** (`supabase/functions/_shared/music-direct.ts`):
  Origin `https://mccluster.org` is answered with itself, so a buyer on the
  platform can read the answer; at P0 no page the platform served loaded the
  direct-sale scripts, and since P1 it serves the pages that do.
- **The carry page**: `carry.html` is new on Matthew's host; at P0 it was
  inert (the carry switch off, no page loading `js/carry.js`), and P1 turns
  the carry on.
- **Inert until P3**: Matthew's host is not routed to the Worker; a request for
  it that reached the Worker would go to GitHub Pages untouched (before P0 the
  API answered it).

The October activation of the company host is done: `mccluster.org/*` and
`www.mccluster.org/*` route to Worker `mccluster`, the zone's redirect rule
covers `here.mccluster.org` only, and `https://mccluster.org/**` is on
Supabase's redirect list. Its company router
(`workers/mccluster/src/company-site/router.js`) serves the World at `/`
(owner, 2026-10-15: "we need mccluster.org to actually show the World"):
`mnet.html` passed through from the static origin with this host's own head
(canonical `https://mccluster.org/`, site name McCluster Corp, a WebPage node
of the company WebSite), plus the World's rooms, the sign-in pages and the
static files (noindex), so a member's session holds from the Earth to the
mission dialog; `/mnet.html` is a 301 to `/`. It serves the company pages at
`/company`, `/robots.txt`, `/sitemap.xml` and `/llms.txt`, and the news at
`/news/`. Until P1 every other path got a 301 to
`https://matthew.mccluster.org/$1`, so every existing link, QR code and
campaign funnel landed exactly where it always did; since P1 the platform
serves every page itself, and only `profile_only` pages answer 301 to
Matthew's host.

**The hosts in code.** `tools/build-site-hosts.mjs` reads the record and
writes, each checked by `--check` in CI:
`workers/mccluster/src/platform/hosts.generated.js` (the Worker),
the generated block at the top of `js/shell-boot.js` that sets
`window.MCC_SITE` (the pages), and `supabase/functions/_shared/site-hosts.ts`
(the edge functions). With today's values they describe today exactly. No
other file in `js/`, `workers/mccluster/src/` or `supabase/functions/` names a
site host in code: `scripts/test/site-hosts.test.mjs` fails a new literal, and
the files that still carry one are listed, with their count and the stage that
converts each, in `scripts/test/site-hosts-pending/`. Those lists only shrink.
The same test rewrites the record so that `https://equityuprise.com` is the
platform and `mccluster.org` a company tenant, and checks that every path still
resolves: the "prepare without breaking anything" proof.

**The stages** (`edge.stages`; each is undone by reversing its one deploy or
setting):

| Stage | What | State | Switches |
| --- | --- | --- | --- |
| P0 | prepare, with no visible change | prepared | `platform_serves` "world", `profile_host_routed` false, `carry` false, `returns_fallback` "tenants.matthew", `metadata` "today" |
| P1 | the platform serves everything | shipping: built on its own branch, it ships on the owner's word | `platform_serves` "everything", `profile_host_routed` false, `carry` true, `returns_fallback` "platform", `metadata` "today" |
| P2 | canonicals, sitemaps and structured data move | planned | `platform_serves` "everything", `profile_host_routed` false, `carry` true, `returns_fallback` "platform", `metadata` "by_set" |
| P3 | the profile host answers 301s for the pages that moved | planned | `platform_serves` "everything", `profile_host_routed` true, `carry` true, `returns_fallback` "platform", `metadata` "by_set" |
| P4 | clean-up | planned | `platform_serves` "everything", `profile_host_routed` true, `carry` true, `returns_fallback` "platform", `metadata` "by_set" |
| F | equityuprise.com becomes the platform | planned | (its own table: section 2.10 of the plan) |

**The target router** (`edge.target`): one router inside Worker `mccluster`
(`workers/mccluster/src/platform/router.js`, behind the generated table),
not a new Worker. It answers as `edge.now` until a later stage's switches
turn on.

| Host | Path | Answer |
| --- | --- | --- |
| platform | / | the World, the platform's head |
| platform | /mnet.html | 301 to / with the query |
| platform | /index.html with a World query (view=, mission=) | 301 to / with the query; without one, from P1, the HERE front door |
| platform | /company, /robots.txt, /sitemap.xml, /llms.txt, /news/... | generated or server-rendered |
| platform | platform or profile page, static file | pass-through from the static origin, path and query (from P1; at P0 the World's rooms and the static files only, everything else 301 to the static origin) |
| platform | profile_only page | 301 to the profile host, same path, at every spelling of the address (from P1) |
| platform | another spelling of an address (no .html, doubled slash, escaped letter, directory without its slash) | 301 to the page it names, where it lives (from P1) |
| platform | a path the record does not name | pass-through while the static origin answers it with no document; a document there is a 301 to the profile host (from P1) |
| platform | http: | 301 to https: |
| www | anything | 301 to the platform, same path and query, in one hop to the platform's own 301 where it answers one (from P1; at P0 some to the apex, the rest to the profile host) |
| profile | profile or profile_only page, both_hosts path, /.well-known/acme-challenge/... | fetch(request) to its origin (from P3) |
| profile | / or /index.html with a World query | 301 to the platform root with the query (from P3) |
| profile | platform page (any other .html or directory path) | 301 to the platform, same path and query (from P3) |
| profile | any other path | pass-through; a 404 stays a 404 (from P3) |
| humanuprise.com, www | anything | 301 to the platform, same path and query, in one hop (from P1, once routed) |

Every pass-through keeps these rules: never follow an upstream redirect (fetch with redirect manual, rewrite a Location on the static origin to the requesting host); headers by class (documents, embed.html with no frame restriction, carry.html framed by the platform only, static files as today); no noindex on platform or profile pages served by the platform; the documents the record names are kept at the edge 60 s (the carry page aside; workers/mccluster/src/platform/router.js DOCUMENT_CACHE_TTL), static files keep the static origin's caching.

Why the one Worker, and not a second Pages site or a new Worker:

- GitHub Pages holds one custom domain per repository.
- The architecture allows one Worker, and serving a host is ingress and
  routing.
- A redirect for a moved page has to be a real 301, which a static host
  cannot give.

### The owner's steps

1. Read SPEC-PLATFORM, say go, and confirm or change the five owner_decisions.
2. After P2 ships: Google Search Console, add mccluster.org (its DNS verification is in place) and submit https://mccluster.org/sitemap.xml; Supabase, set the Site URL to https://mccluster.org.
3. When P3 is ready (about ten minutes, in Cloudflare): check the SSL/TLS mode and add a Configuration Rule with SSL Full for matthew.mccluster.org if the zone is Full (strict); switch the matthew CNAME to Proxied; add the Workers Route matthew.mccluster.org/* to Worker mccluster. To undo: delete the route.
4. In Cloudflare, check that the Workers plan covers every page and file going through the Worker.
5. On the iPhone: open mccluster.org in Safari, check the sign-in, add it to the Home Screen, open the new icon, keep the albums again if it offers, then delete the old icon.
6. Later, for equityuprise.com: move its DNS from WordPress.com to Cloudflare, then pick the day.

The owner's current decisions (`owner_decisions`; the defaults of
2026-11-23, each the owner's to change; P1 applies them):

- **profile_root**: It keeps opening on his HERE page (index.html, the I AM HERE front door). (default, the owner's to change)
- **person_pages_home**: Yes: they are url_ownership.profile; the platform serves in-app copies from P1 with their canonical on his host. (default, the owner's to change)
- **ai_crawlers**: Each host keeps today's: mccluster.org answers with Cloudflare's managed robots block (AI training disallowed, Content-Signal ai-train=no) ahead of its own robots.txt; matthew.mccluster.org keeps its own robots.txt, which allows AI crawlers. When his host is proxied (P3) the managed block must not be added to it. (default, the owner's to change)
- **humanuprise_com**: It sends people to the platform: 301, same path and query, once routed. Until the owner routes it, it stays inert. (default, the owner's to change)
- **platform_app_start**: On the World. The app installed from matthew.mccluster.org keeps opening on its HERE page. (default, the owner's to change)

Mail for `mccluster.org` is Google Workspace (MX). Routing HTTP to the Worker
does not touch MX; do not swap the apex DNS record for a Worker custom domain
without checking the MX and TXT records survive.

## The World's door today: `mccluster.org` (owner, 2026-10-15)

"We don't need humanuprise.com live right now. We need mccluster.org to
actually show the World." So the platform's root is the World, by the same
mechanics as the `humanuprise.com` door below (`workers/mccluster/src/
world-host.js`, shared by both routers), and the bar's Globe goes there from
Matthew's site. Equity Uprise is McCluster Corp's platform, so the platform's
root stays company-first: canonical `https://mccluster.org/`, `og:site_name`
McCluster Corp, a WebPage node that belongs to `https://mccluster.org/#website`
and is about the Organization (the same stable `@id`). The company page,
"What is McCluster Corp?", with the WebSite and Organization nodes, is
`https://mccluster.org/company`, and it opens the World from its header.
Since P1 the World stays the platform's root and every other page joins it at
its path.

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
newsroom on Matthew's profile (`/newsroom.html`, built from the evidence
ledger, in the `profile` set) is a different thing and keeps its home there. How it gets into Google
News and GDELT: `docs/action-network/NEWSROOM.md`.

## The legacy-named host: `humanuprise.com`

Three hosts, still two entities. The World is McCluster Corp's platform
(the Organization above), so `humanuprise.com` is a company host, not a third
entity and not Matthew's. Owner, 2026-10-14: the World (the globe, the context
strip, the feed) is its own solo experience at its own address,
interconnected with the rest. Since 2026-10-28 the public brand is Equity
Uprise (above): the host keeps its legacy name, and what it serves names
Equity Uprise (`og:site_name` "Equity Uprise"). **The owner's current
decision** (default of 2026-11-23, `owner_decisions.humanuprise_com`, the
owner's to change): once routed, `humanuprise.com` answers 301 to the
platform, same path and query; the router answers so since P1. Until the
owner routes it, the host stays built and inert.

| | `https://humanuprise.com/` |
| --- | --- |
| Whose | McCluster Corp's platform, the Equity Uprise World |
| Answers | Today (built, inert until routed): once routed, 301 to the platform for every path (since P1; before P1 it would have served the World) |
| Entity | Organization `https://matthew.mccluster.org/#mccluster-corp` (the same stable `@id`) |
| Source | the World, `mnet.html`, as published by this repo; nothing is duplicated |
| Served by | Worker `mccluster`, host-routed (`workers/mccluster/src/human-uprise/router.js`); inert until the owner routes the host |

- Before P1, as built, `/` was the World, passed through from the static
  origin with this host's own canonical; the World's rooms, the sign-in pages
  and the static files rode the same way (noindex), and every other path was a
  301 to the same path on `matthew.mccluster.org`. Since P1 the router answers
  every path on it with a 301 to the platform, once routed.
- The bar (`js/tabbar.js`) reads the same on every host: Music | M | Globe.
  Since P1 it is local on the platform: Music `listen.html`, the M the HERE
  front door `index.html`, the Globe the World at `/`. On Matthew's site Music
  and the Globe go to the platform (the World at `https://mccluster.org/`
  since 2026-10-15) and the M to his own root; each answer is a small named
  function reading `window.MCC_SITE` (`pageHref`, `worldAt`, `isWorldPath`).
  Before P1, on a World host, Music and the M linked to Matthew's site
  outright. Pointing the Globe at `humanuprise.com` is superseded by the
  owner's decision above.
- Sessions are per origin, and one M Account works on every host anyway:
  since P1 the carry brings a member's sign-in to the platform (`js/carry.js`
  → `/v1/auth/handoff`, `workers/mccluster/src/auth-handoff.js`; before P1 the
  bar's fragment hand-off did, `js/tabbar.js`), and the arriving host earns a
  session of its own. No refresh token crosses. The API's CORS allowlist
  carries the host; it is also the list of hosts a sign-in may be carried to.
- Why not a second Pages site or Worker: the same reasons as the platform
  (one custom domain per repository; one Worker; serving a host is ingress).
- Activation and verification: `docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md`
  → "Production domain". Tests: `workers/mccluster/test/human-uprise-site.test.mjs`,
  `scripts/test/human-uprise-door.test.mjs`.

## Changing the platform or a tenant

- A host appears only in the record. To change one (the platform's origin at
  stage F, a tenant, a door), edit `data/seo/domain-architecture.json`, run
  `node tools/build-site-hosts.mjs --write`, and commit the record with its
  three generated outputs; `node tools/build-site-hosts.mjs --check` (run by
  `scripts/test/site-hosts.test.mjs` in CI) fails if they drift. A file that
  stops naming a host leaves its list in `scripts/test/site-hosts-pending/`
  in the same change.
- A page's set: move its path between `url_ownership.platform`, `profile` and
  `profile_only` (exactly one), following the stages above.
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
