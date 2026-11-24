# SPEC-PLATFORM: the whole site on the platform domain

Design spec for serving the whole site from one platform origin, written read-only on 2026-11-23 for the control repo
`mcclusterishere/mccluster`. Base: a fresh fetch of `origin/main` at `b51ede03a4faefe000749ec71630b1a584146fed` (the
merge of PR #820, 2026-11-20; production runs it: `https://api.mccluster.org/v1/health` reports `deployment_sha`
`b51ede03…`), with `origin/claude/new-session-83ken5` read at `0ef1481cae8750cfd2c706ddf15393cabb93ad9d` (25 commits
ahead of main: music M3, its follow-up, M5 and records; none of them changes host routing). Nothing in the repository,
DNS, Cloudflare, GitHub Pages, Supabase or production was changed. The live hosts were read with GET and HEAD only,
analytics blocked, nobody signed in.

Labels: **Measured** (seen today with curl or Chromium; evidence in section 9), **Read** (in the code or records,
file:line at `b51ede03` unless a branch is named), **Inferred** (reasoned; the build proves it or drops it).

Companions: `SPEC-ENGINE.md` (the one engine and its player) and `BAR-RESTORE.md` (the bar's drawing). This spec
decides where pages are served and how addresses, search, sessions, offline copies and metadata follow. It does not
design the player.

---

## 0. Matthew's direction, and the decision on one page

Matthew, 2026-11-23 (as dictated; the address he named for himself is read as the host `matthew.mccluster.org`):

> "let's just have the whole site on mccluster.org instead, and matthew.mccluster.org be my profile, my personal
> profile. Do you feel me? On the site, just like we have tenancy, like the mccluster.org is the site for right now,
> and then the tenant to the site would be [matthew.mccluster.org] for McCluster, who is the artist and shit like
> that. You feel me? The M button. Everything should be running on the player, every page, the front page, back page,
> and technically it's not the front page. Like, this is a platform in which the mccluster.org is even that is
> technically the tenant, because the real shit should be equityuprise.com. We haven't done that yet, but it shall be
> so soon enough. We must prepare without breaking anything to do that."

The same message answers the three questions in SPEC-ENGINE section 15 (carried to the engine in section 5 here):
the music shows at mccluster.org (question 1); the front page runs on the one player (question 2); "Shuffle plays
when the world plays a song. Should those count as plays for each song? Yes, they should count as plays." (question
3); and "If you go to the world, though, and you click on the globe and you're already playing a song, it shouldn't
change the song you have or the order of the songs you have".

The decision:

1. **One platform origin, set in one place.** `data/seo/domain-architecture.json` gains `platform.origin`, today
   `https://mccluster.org`. A generator (`tools/build-site-hosts.mjs`, `--check` in CI) writes it into the Worker, the
   static site's first script, the Supabase functions' shared module and the tests. No other file names a host.
   Making `https://equityuprise.com` the platform later is that one value plus Matthew's DNS and provider steps.
2. **The platform serves every page at its current path.** `https://mccluster.org/` stays the Equity Uprise World;
   every page that lives on `matthew.mccluster.org` today is also served at the same path on the platform: music,
   albums, artists, Creator Studio, account and sign-in, checkout and receipts, the company's products, member front
   pages, Control. Matthew's HERE front door (`index.html`, the page the M button opens) is served at
   `https://mccluster.org/index.html`, so every relative link in the site keeps its meaning and the M button never
   leaves the platform's origin.
3. **`matthew.mccluster.org` becomes Matthew's personal profile, a tenant of the platform.** Its root stays his front
   door, unchanged (hard rule 3), and his person pages keep their addresses there (profile, résumés, engineering,
   portfolio, card, press, photography, films, policy writing, case studies, the evidence newsroom), as does Whip
   Equipped (his separate company). Every other page answers **301 to the same path on the platform**, query intact.
   Static files, `embed.html`, `sw.js`, `manifest.json` and a new carry page keep answering on both hosts, so images
   already shared, embeds on other sites and the installed app never break.
4. **McCluster the artist is that same tenant.** "McCluster" is Matthew's artist name and already the Person's
   `alternateName` (Read: `data/seo/entity-graph.json`); his artist page on the platform is
   `music-creator.html?handle=…`. No new entity.
5. **Hosting is not identity.** No `@id` moves. Platform pages belong to the platform's WebSite
   (`https://mccluster.org/#website`, published by McCluster Corp); profile pages stay Matthew-first wherever they are
   shown, with their canonical on his host. McCluster Corp's Organization keeps `url` `https://mccluster.org/`.
6. **Sign-in carries over without a token in any URL.** A hidden same-site frame of the profile host hands its session
   to the platform by `postMessage`, and the platform earns its own session through the existing
   `POST /v1/auth/handoff`. Measured in Chromium with Chrome's storage partitioning on: a `matthew.mccluster.org`
   frame inside a `mccluster.org` page reads the same storage as `matthew.mccluster.org` itself. When it cannot
   (another browser profile, private mode, the Home Screen app's separate storage), one clear line asks once. The
   fragment hand-off that puts the access token in a link (`#mcc_handoff=`, `js/tabbar.js:897-909`) is retired.
7. **The move happens in stages that never break a working address**: P0 prepare (no visible change), P1 the platform
   serves everything, P2 canonicals and sitemaps move, P3 the profile host answers 301s (Matthew's Cloudflare steps),
   P4 clean-up; stage F (equityuprise.com) later. Each stage is one deploy or one Cloudflare setting and is undone the
   same way.
8. **The engine gains one origin for the World and Music** (section 5): the World's frame over Music becomes
   same-origin, the World opened directly can host Music as views, and SPEC-ENGINE's cross-host hand-over (5.5) is
   no longer needed between them. P1 lands before the engine's stage 2 (the World on the engine), so that stage is
   built once, for one origin.
9. **The law changes with it** (section 3): hard rule 15 becomes "One platform, tenant properties, separate entities.
   Never collapse them.", quoting Matthew; the seven agent adapters, DOMAINS-AND-ENTITIES.md, the domain
   architecture record, the canonical architecture pair and ECOSYSTEM.md follow in the same change.

---

## 1. Today, in plain words

### 1.1 Who answers what (Measured, 46 paths per host; `out/hosts.txt`, `out/headers-key.txt`, `out/dns.txt`)

| Host | DNS (public resolvers, identical answers) | What it answers |
| --- | --- | --- |
| `mccluster.org` | Cloudflare zone (nameservers `malcolm`/`sarah.ns.cloudflare.com`); apex proxied; MX: Google Workspace, 5 records, intact; 3 TXT | Worker `mccluster`, by host. 18 of 46 paths 200: the World at `/` and `/?view=feed` (head rewritten: canonical `https://mccluster.org/`, site name McCluster Corp), the World's rooms (`/account.html`, `/login.html`, `/auth/`, `/action/`, `/action-globe.html`, `/privacy.html`, noindex), `/company`, `/news/`, `robots.txt`, `sitemap.xml`, `llms.txt`, `sw.js` and the static files. `/index.html` and `/mnet.html` 301 to `/`. **The other 26 paths 301 to the same path on `matthew.mccluster.org`**: Listen, the album, the catalogue, artist pages, music videos, Creator Studio, purchase and pay, `manifest.json`, the profile and résumés, engineering, portfolio, gallery, films, press, Whip, Docket 516, PRIM3, front pages, Control. |
| `www.mccluster.org` | proxied | 301: the apex's own paths to the apex, everything else to `matthew.mccluster.org`; `robots.txt` answers 200 with Cloudflare's managed robots body (and a stray `location` header) |
| `matthew.mccluster.org` | **DNS-only** CNAME to `mcclusterishere.github.io` (GitHub Pages, 185.199.108-111.153) | GitHub Pages: 42 of 46 paths 200 (every page, the World's `mnet.html` included); `/company`, `/news/`, `/walls/`, `/.well-known/security.txt` 404; no CSP or frame headers; its own `robots.txt` ("READ IT": AI crawlers allowed) and two sitemaps; `http` 301 to `https` |
| `here.mccluster.org` | proxied | Cloudflare zone redirect rule: 301 to the same path on `matthew.mccluster.org` |
| `humanuprise.com`, `www` | Cloudflare zone (`langston`/`vivienne`), no address records; `www` does not resolve | nothing (inert, as the law says) |
| `equityuprise.com`, `www` | **not on Cloudflare**: WordPress.com nameservers (`ns1-3.wordpress.com`), A WordPress.com addresses, `www` CNAME to the apex, no MX | page paths 301 (nginx) to the same path on `https://equityuprisedotcom.wordpress.com/`, a WordPress.com "Coming Soon" placeholder titled "Site Title"; file paths 404 |
| `api.mccluster.org` | proxied | Worker `mccluster`, health 200 at `b51ede03` |
| `mccluster-web.pages.dev` | | 522: the staged Cloudflare Pages export (`docs/control-plane/CLOUDFLARE-PAGES-DIRECT-UPLOAD.md`) is not serving |

Security headers on the platform today (Measured): World documents carry `content-security-policy: frame-ancestors
'self' https://matthew.mccluster.org https://mccluster.org https://www.mccluster.org https://humanuprise.com
https://www.humanuprise.com`, a report-only World policy, `x-frame-options: SAMEORIGIN`, a permissions policy and
HSTS (Read: `workers/mccluster/src/world-host.js:92-126`). `/company` and `/news/` carry `default-src 'none';
img-src https://matthew.mccluster.org; … frame-ancestors 'none'` (Read: `company-site/router.js:44-48`,
`company-site/news.js:302`).

Time to first byte through the probe's proxy (Measured, 5 samples, medians): the World at `mccluster.org/` 0.33 s
against `matthew.mccluster.org/mnet.html` 0.16 s; `mccluster.org/account.html` 0.20 s against 0.09 s on Matthew's
host. The pass-through costs one hop.

### 1.2 How it is wired (Read)

- **Worker `mccluster`** answers hosts before the API: `companySiteResponse` then `humanUpriseResponse`
  (`workers/mccluster/src/entry-platform.js:55-66`). The company router answers only `mccluster.org` and `www`; `/`
  is `mnet.html` passed through from `PUBLIC_ORIGIN` (`https://matthew.mccluster.org`, `wrangler.toml:26`) with the
  company head; the World's rooms (noindex) and the static prefixes pass through (`world-host.js:20-28`); every other path
  is `moved(PERSONAL_ORIGIN + path + query)` (`company-site/router.js:117`). The pass-through follows upstream
  redirects (`world-host.js:162`, `redirect: 'follow'`). `wrangler.toml` declares no routes; they live in the
  Cloudflare dashboard. The Worker deploys from `main` through Cloudflare's Git integration and
  `.github/workflows/deploy-mccluster-worker.yml` verifies the deployed SHA (a gated manual path with rollback exists,
  inert until `WORKER_DEPLOY_MODE` is set).
- **GitHub Pages** publishes the static site from `.github/workflows/deploy-pages.yml` (force-push of a stamped,
  stripped tree to `gh-pages`; `CNAME` = `matthew.mccluster.org`; its `verify-live` job checks
  `https://matthew.mccluster.org` only, lines 275-388).
- **The bar** (`js/tabbar.js:70-81`) knows four "World hosts"; on them Music and the M link to
  `https://matthew.mccluster.org/` and the Globe is the root; on Matthew's host the Globe goes to
  `https://mccluster.org/`. The M tab is `HOUSE + "index.html"` (`:141`). Cross-host links carry the member's
  **access token in the URL fragment** (`#mcc_handoff=`, `:873-909`), exchanged at `POST /v1/auth/handoff`
  (`workers/mccluster/src/auth-handoff.js`) for a session of the arriving origin.
- **The World over Music** is a cross-origin frame of `https://mccluster.org/` inside Matthew's music page
  (`js/world-audio-continuity.js:12-17, 77`); the branch's M5 shell treats `/` and `/index.html` on World hosts as
  the World (`js/music-shell.js:53`, `world()`, at `0ef1481c`).
- **Sessions and device state are per origin**: `mccdb_session`, `mcc_sess_keep`, `mcc_sess_out`, `mcc.device_id`
  (`js/mcc-auth.js:24-29`), the analytics device `mcc_device` (`js/analytics.js:230`), the song pocket `mcc-pocket`
  (`js/pip.js:30`), the offline vault `mcc-vault-v1` keyed by absolute audio URL (`sw.js:21, 40-44`). Only the
  privacy answer is shared, as a cookie for `Domain=mccluster.org` (`js/live-content.js:49`). Sign-in redirects are
  origin-relative (`js/mcc-auth.js:305, 588`); Supabase's redirect list already includes `https://mccluster.org/**`
  (owner confirmed 2026-11-18: `docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md:153`); the Site URL was never
  confirmed (`docs/design/WORLD-SIGN-IN-DOOR.md`, item 12).
- **The installed app** is `manifest.json` with `id` `./`, `start_url` `./index.html`, `scope` `./`: an app of
  `matthew.mccluster.org`.
- **Checkout and account returns name a host in code**: `supabase/functions/checkout/index.ts:19`,
  `music-checkout/index.ts:10`, `music-direct-checkout/index.ts:27`, `_shared/music-direct.ts:59`,
  `connect-org/index.ts:102`, `org-connect-onboard/index.ts:10`, `shake-order/index.ts:43` (fallback) return to
  `matthew.mccluster.org`; `backend-sub/index.ts:32`, `pay-now/index.ts:42`, `connect-onboard/index.ts:33` return to
  `https://mcclusterishere.github.io/Here`, the dead repository's address (a defect today, whatever this spec
  decides). In the Worker: `creator-billing.js:10`, `action-connect.js:4`, `action-archive.js:6`, `connect.js:419`,
  `social/router.js:46`.
- **Embeds**: the share sheet's embed code is built from `location.origin` (`js/label.js:264-268`), so every embed in
  the wild frames `https://matthew.mccluster.org/embed.html`, which GitHub serves with no frame restriction.
- **The published tree**: 179 HTML pages; 109 carry a canonical on `matthew.mccluster.org`, 70 none, 110 are noindex;
  the sitemap allowlist has 64 pages, all on Matthew's host (`data/seo/sitemap-pages.json`). `url_ownership`
  classifies 60 of the 179 (personal 31, company-hosted-for-compatibility 18, Whip 6, owner-decision 5); 119 are
  unclassified app, admin and demo pages. 1,522 literal `matthew.mccluster.org` strings sit in the published tree
  (102 root files, 11 scripts), most of them `@id`s and canonicals.

### 1.3 The law as written (Read)

- AGENTS.md hard rule 15 (line 51): "**Two properties, two entities. Never collapse them.** `https://mccluster.org/`
  is **McCluster Corp's** house … `https://matthew.mccluster.org/` is **Matthew McCluster's** house: person, résumé,
  engineering, portfolio, photography, music. … Company *apps* (the Equity Uprise World, accounts, checkout,
  campaigns) stay on their working URLs because sessions and returns are origin-bound; ownership changes navigation
  and metadata, not URLs. … on either World host, Music, the M and every creator page send to Matthew's property.
  Sessions are per origin, and one M Account works on every host because the bar carries a member's sign-in across
  (`js/tabbar.js` → `POST /v1/auth/handoff` …)."
- AGENTS.md hard rule 4 (line 34): "The public site is static and ships to `matthew.mccluster.org` from this repo".
- DOMAINS-AND-ENTITIES.md: "Moving the World, accounts or checkout to `mccluster.org` would sign members out and break
  payment returns." (lines 124-125) and "A product page moves to `mccluster.org` only when there is a reason beyond
  tidiness, one page at a time. Each move needs a 301 from the old URL, an updated canonical and sitemap entry, and a
  check that no session, checkout or funnel depends on the old origin." (lines 132-135). This spec is that check, for
  every page at once, with a reason: Matthew's direction and one player.
- `data/seo/domain-architecture.json`: `rule` (line 6) "do not move a working URL merely for tidiness";
  `url_ownership.why_company_apps_stay_put` (line 218); the stable `@id` rule (`entities.mccluster_corp.id_note`).
- CLAUDE.md lines 15-18 (the two-properties block), 27 (stop item 13), 37-38 (plane rows); the six other adapters
  name hard rule 15 by its heading, and `scripts/test/domain-architecture.test.mjs:138, 162, 176` holds all seven to
  it.

---

## 2. The target

### 2.1 Roles

| Role | Host | Serves | Entity first in metadata |
| --- | --- | --- | --- |
| **Platform** (`platform.origin`, the one setting) | `mccluster.org` now; `equityuprise.com` at stage F | every page, path for path; the World at `/`; the HERE front door at `/index.html`; `/company`, `/news/` | McCluster Corp (the platform's operator), Equity Uprise as the public brand; each page about its own entity |
| **Tenant profile** | `matthew.mccluster.org` | Matthew's profile pages (2.2), Whip; static files; everything else 301 to the platform | Matthew McCluster (Person; artist name McCluster) |
| **Doors** | `www.mccluster.org` | 301 to the platform, path for path | none (redirects) |
| | `here.mccluster.org` | the zone rule, unchanged (301 to the profile host, then on) | none |
| | `humanuprise.com` | inert today; when Matthew routes it, 301 to the platform, path for path (question 4) | none |
| **API** | `api.mccluster.org` | unchanged | none |
| **Future platform** | `equityuprise.com` | WordPress.com placeholder until stage F | Equity Uprise (McCluster Corp's) |

At stage F, `mccluster.org` becomes McCluster Corp's own tenant (its company page and news) and the World moves to
`equityuprise.com/` (2.10). Nothing in this design assumes which host is the platform.

### 2.2 Which pages live where

The record (`url_ownership`, rewritten in section 3) puts **every** published page in exactly one set; CI fails on a
page in none:

| Set | Pages | Platform | Profile host |
| --- | --- | --- | --- |
| **platform** | the World and its rooms; music: `listen.html`, `album.html`, `catalogue.html`, `license.html`, `music-videos.html`, `music-creator.html`, `prim3-artist.html`; Creator Studio: `creator.html`, `mccluster-creator-studio.html`, `front-studio.html`, `music-creator-terms.html`; account and sign-in: `account.html`, `login.html`, `onboard.html`, `forgot-password.html`, `reset-password.html`, `/auth/`; checkout: `pay.html`, `purchase.html`, `receipt.html`; company products: `mccluster-corp.html`, `docket-516*.html`, `/action/`, `equity-uprise.html`, `action-network-*.html`, `heal-the-3rd-world.html`, `prim3*.html`, `/site0/`, `sites*.html`, `services.html`, `hire.html`, `help.html`, `privacy.html`, `world-news.html`; member pages: `front.html`, `member-front.html`; owner pages: `control.html` and the other desks; every page not listed elsewhere | 200, canonical here | 301 to the platform, same path and query |
| **profile** | `/` and `index.html` (the HERE front door); `matthew-mccluster.html`, `resume-it-support.html`, `resume-digital-inclusion.html`, `/engineering/…`, `portfolio.html`, `card.html`, `press.html`, `gallery.html`, `/walls/…`, `shots.html`, `films.html`, `policy.html`, `policy-memo-dna.html`, `case-designer-kicks.html`, `newsroom.html` | 200, canonical on the profile host (in-app copy, so the player keeps running; the M button opens `/index.html`) | 200, canonical here |
| **profile only** | Whip Equipped (`whip.html`, `/whip/…`; Matthew's separate company, never McCluster Corp's) and the four owner-decision pages (`prayer-closet.html`, `/closet/`, `inner-room.html`, `fbi.html`) | 301 to the profile host | 200 |
| **both hosts** | `/js/`, `/css/`, `/assets/`, `/data/`, `/vendor/`, `sw.js`, `manifest.json`, `embed.html`, `carry.html`, `/.well-known/` | 200 | 200 (never 301: shared images, embeds, the installed app and certificate renewal depend on them) |

Why the profile pages are served on both hosts: their home is Matthew's host (recruiters, résumés, printed cards and
search keep their addresses), but "Everything should be running on the player, every page": inside the platform a
link to them stays on the platform's origin, so the engine can keep the song playing (as a page today, as a view
once SPEC-ENGINE stage 4 lists them). Their own `<link rel="canonical">` already names Matthew's host, so the
in-platform copy needs no head change and adds no duplicate in search.

### 2.3 The one setting

`data/seo/domain-architecture.json` v2 (shape; full text in section 3.4):

```json
{
  "schema_version": "mccluster-domain-architecture/v2",
  "platform": {
    "origin": "https://mccluster.org",
    "operator": "https://matthew.mccluster.org/#mccluster-corp",
    "website_id": "https://mccluster.org/#website",
    "site_name": "McCluster Corp",
    "root": "the Equity Uprise World (mnet.html)",
    "front_door_path": "/index.html",
    "static_origin": "https://matthew.mccluster.org",
    "next": { "origin": "https://equityuprise.com", "state": "planned; DNS at WordPress.com; inert" }
  },
  "tenants": {
    "matthew": {
      "host": "matthew.mccluster.org",
      "entity": "https://matthew.mccluster.org/#matthew-mccluster",
      "website_id": "https://matthew.mccluster.org/#website",
      "site_name": "Matthew McCluster",
      "root": "index.html",
      "carry": "/carry.html"
    }
  },
  "both_hosts": ["/js/", "/css/", "/assets/", "/data/", "/vendor/", "/sw.js", "/manifest.json", "/embed.html", "/carry.html", "/.well-known/"],
  "doors": { "www.mccluster.org": "platform", "humanuprise.com": "platform (when routed)", "here.mccluster.org": "zone rule to matthew.mccluster.org" },
  "url_ownership": { "platform": ["…"], "profile": ["…"], "profile_only": ["…"] }
}
```

`static_origin` is where the Worker fetches files (GitHub Pages, reached as the profile host); it is a fetch target,
never a link. `tools/build-site-hosts.mjs` reads the record and writes, each with `--check` in CI:

| Output | Read by |
| --- | --- |
| `workers/mccluster/src/platform/hosts.generated.js` | the host router (2.4), the CORS list (`lib/http.js` `DEFAULT_ORIGINS`), frame-ancestors, the returns in `creator-billing.js`, `action-connect.js`, `action-archive.js`, `connect.js`, `social/router.js` |
| a generated block at the top of `js/shell-boot.js` setting `window.MCC_SITE` (the first script in the head of the 110 pages that load the bar) | `js/tabbar.js`, `js/world-audio-continuity.js`, `js/music-shell.js`, `js/live-content.js` (cookie domain), `js/mnet.js`, `js/action-globe.js` and `js/travel/*` (Whip links), `js/carry.js` |
| `supabase/functions/_shared/site-hosts.ts` | every function that builds a return address |
| the canonical, `og:url`, `og:site_name` and JSON-LD `url`/`isPartOf` of every page (`--write` rewrites them by set; `@id`s are never touched) | search, shares, `tools/build-sitemap.mjs` (which already refuses a page whose canonical is not its own URL) |
| both hosts' `sitemap.xml`, `robots.txt`, `llms.txt`, the video sitemap, IndexNow's host | crawlers |
| `deploy-pages.yml` `verify-live` hosts | CI |

A test (`scripts/test/site-hosts.test.mjs`) scans `js/`, `workers/mccluster/src/` and `supabase/functions/` for a host
literal outside the generated outputs, and runs the router and the client's host logic with the record rewritten to
`platform.origin = https://equityuprise.com` and `mccluster.org` as a tenant: every path still resolves, nothing
answers a host it should not. That is the "prepare without breaking anything" proof.

### 2.4 The host router (Worker)

One router replaces the two host routers' rules (`company-site/router.js`, `human-uprise/router.js`; the files keep
their names and generated pages). Requests are classified by host from the generated table, then by path set.

| Host | Path class | Answer |
| --- | --- | --- |
| platform | `/` | the World, head as today (`WORLD_HEAD`) |
| platform | `/mnet.html` | 301 to `/` with the query (as today) |
| platform | `/index.html` with a World query (`view=`, `mission=`) | 301 to `/` with the query (as today); without one, `/index.html` is the HERE front door |
| platform | `/company`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/news/…` | generated or server-rendered, as today |
| platform | platform or profile page, static file | pass-through from `static_origin`, path and query |
| platform | profile-only page | 301 to the profile host, same path |
| platform | `http:` | 301 to `https:` (as today) |
| `www` | anything | 301 to the platform, same path and query (today: some to the apex, the rest to Matthew's host) |
| profile host | profile page, profile-only page, both-hosts path, `/.well-known/acme-challenge/…` | `fetch(request)` to its origin (GitHub Pages): a same-zone request skips Worker routes and goes to the origin (Read: Cloudflare Workers routing docs, "Routes cannot be the target of a same-zone fetch()"; the Worker has no `global_fetch_strictly_public` flag, `wrangler.toml:3-4`) |
| profile host | `/` or `/index.html` with a World query (`view=`, `mission=`) | 301 to the platform root with the query (replaces the client-side forward at `js/tabbar.js:83-87`) |
| profile host | platform page (any other `.html` or directory path) | 301 to the platform, same path and query |
| profile host | any other path | pass-through (a 404 stays a 404, so `deploy-pages.yml`'s private-path check still means something) |
| `humanuprise.com`, `www` | anything | 301 to the platform, same path and query (inert until routed) |

Rules every pass-through keeps:

- **Never follow an upstream redirect.** GitHub answers `/engineering` and `/action` with `301 Location:
  https://matthew.mccluster.org/<dir>/` (Measured). Following it serves a directory at a slashless platform address
  and breaks its relative links. The router fetches with `redirect: 'manual'` and rewrites a `Location` on the static
  origin to the requesting host.
- **Headers by class.** Documents: `frame-ancestors 'self'` (the platform frames only itself once Music and the World
  share it), `x-frame-options: SAMEORIGIN`, HSTS, the permissions policy, the World's report-only policy.
  `embed.html`: no frame restriction (`frame-ancestors *`, no `x-frame-options`), because other people's sites frame
  it. `carry.html`: `frame-ancestors` the platform only. Static files: as today. `/company` and `/news/`: `img-src
  'self'` once their images are named on the platform (P2).
- **No `noindex` on platform or profile pages** served by the platform: their canonicals say where they live. The
  World's rooms keep the `<meta name="robots" content="noindex">` they already carry.
- **Documents may be cached at the edge for 60 s** (`cf: { cacheTtl: 60 }` on the upstream fetch) to win back most of
  the measured hop; static files keep today's caching.

### 2.5 Metadata and the two entities

- **Canonical and `og:url`**: platform pages name `platform.origin + path`; profile and profile-only pages name the
  profile host. Written by the generator; `tools/build-sitemap.mjs` and the domain test refuse anything else.
- **`og:site_name`**: the platform's `site_name` (McCluster Corp) on platform pages; "Matthew McCluster" on profile
  pages. Today `catalogue.html` and `docket-516.html` say "Matthew McCluster" (Read); they become the platform's.
- **WebSite nodes**: platform pages are `isPartOf` `https://mccluster.org/#website` (published by the Organization);
  profile pages keep `https://matthew.mccluster.org/#website` (published by the Person). Each WebSite node is defined
  in full only on its own host's root and company page, as today.
- **`@id`s never move**: Person `https://matthew.mccluster.org/#matthew-mccluster`; Organization
  `https://matthew.mccluster.org/#mccluster-corp` (url `https://mccluster.org/`); the album
  `https://matthew.mccluster.org/#album`; recordings `https://matthew.mccluster.org/catalogue.html#…`; the World's
  SoftwareApplication `https://matthew.mccluster.org/mnet.html#uprise-action-network`. Their `url` follows the page:
  the album's to `https://mccluster.org/album.html`, the World's to `https://mccluster.org/`, Equity Uprise's
  (`current_url`) to `https://mccluster.org/docket-516.html`; the Person's stays on his host. The generator edits
  `data/seo/entity-graph.json` and reruns `tools/build-profile-entity.mjs` and `tools/build-company-site.mjs`.
- **Copy**: platform pages talk about the platform and the work; profile pages about Matthew. The album stays a front
  door to Matthew's profile, never the platform's homepage. Whip never appears under McCluster Corp.
- **Crawlers**: each host serves its own `robots.txt`, `sitemap.xml` and `llms.txt`. Cloudflare's managed robots
  setting prepends an AI-training block (Amazonbot, GPTBot, ClaudeBot, Google-Extended and others `Disallow: /`,
  `Content-Signal: ai-train=no`) to the zone's robots answers (Measured on the apex and `www`), while Matthew's host
  says "READ IT" today. Once his host is proxied (P3) it gets the same block. Which rule he wants is question 3.

### 2.6 Sign-in: carried, never in a URL

**The carry** (P1):

1. A platform page with no usable session, and no `mcc_carry_v1` mark in its own storage, adds a hidden frame of
   `https://matthew.mccluster.org/carry.html` (the tenant's `carry` path from the table) and waits up to 4 s for it.
2. `carry.html` (a static page on the profile host, served on both hosts, never redirected) loads `js/mcc-auth.js`.
   It answers only a message whose `event.origin` is the platform's and whose `event.source` is its parent, and only
   one request id once. It refreshes its stored session if needed (`MCC.refreshIfNeeded`) and posts to the platform
   origin exactly (`postMessage(msg, PLATFORM_ORIGIN)`): the **access token only** (never the refresh token), plus
   the carry list below.
3. The platform exchanges the token at `POST /v1/auth/handoff` as a bearer header (the existing route: checks the
   token with Supabase, requires an Origin on the CORS list, mints a magic-link token hash without e-mailing), verifies
   it at Supabase and stores its own session with the existing paired write (`js/tabbar.js:976-984`). No refresh token
   crosses; the old host's session is left as it is (nobody is signed out); the mark records the result.
4. Measured: with Chrome's default storage partitioning on, a `matthew.mccluster.org` frame inside a `mccluster.org`
   page reads `matthew.mccluster.org`'s own localStorage and Cache Storage; inside a cross-site page it reads an empty
   partition (`out/chromium/storage-partitioned.json`). Safari partitions by site as well (Inferred; device row 3).
5. **When it cannot carry** (private browsing, blocked storage, the old host's session expired with no refresh, or
   the Home Screen app, whose storage is separate from Safari's), the account chip and the sign-in page show one line
   for 30 days: "McCluster now lives at mccluster.org. If you were signed in before, you still are; if not, sign in
   once here." Nothing else asks.

**The fragment hand-off is retired**: P1 stops writing `#mcc_handoff=` (`handoffHref`, `js/tabbar.js:897-909`); the
reader (`arriveWithHandoff`, `:914`) keeps scrubbing any old link until P4, then goes. `auth/seek-first-handoff.html`
(the console's own fragment hand-off) is outside this move and is listed for the same review.

**Providers and e-mail links**: redirects are already origin-relative and `https://mccluster.org/**` is on Supabase's
list. Matthew sets Supabase's Site URL to `https://mccluster.org` (P2), so confirmation and reset e-mails that use
the Site URL land on the platform; links already sent land on Matthew's host and follow the 301 with their query and
fragment.

### 2.7 What else carries (same frame, same message)

| Item | Key | Rule |
| --- | --- | --- |
| Analytics device | `mcc_device` | only when the privacy notice was agreed (the shared cookie) and the platform has none yet, so one listener stays one device in the counts |
| The song pocket | `mcc-pocket` | adopted when the platform has none: the bar offers "Pick up at 1:23" |
| Kept songs | the URLs in `mcc-vault-v1` | the platform shows one line, "You kept 12 songs at the old address. Keep them here too?"; a tap re-downloads them into the platform's vault (same files, same paths); the old copies stay where they are |
| Mute, theme | `mcc_music_mute` (SPEC-ENGINE), `theme` | adopted when unset |

The privacy answer is already shared (cookie `Domain=mccluster.org`). Alerts (web push) are off
(`WEB_PUSH_ENABLED = "false"`), so no subscription has to move.

### 2.8 The installed app

- The app installed from Matthew's host keeps launching: its `start_url` (`/index.html`) is a profile page and stays
  200 there, and `manifest.json` and `sw.js` stay on both hosts. Its links to platform pages leave the app's scope,
  so the phone shows them in the app's in-app browser sheet: working, not seamless. Offline, the old app keeps its
  cached pages and kept songs (the service worker serves them from its own caches).
- On launch in standalone mode on the profile host, the bar's script (`js/tabbar.js`, which the front door already
  loads; `index.html` itself is not edited) shows a one-time card: "The app now lives at mccluster.org. Open it there
  and add it to your Home Screen; your sign-in and kept songs come with you." (the carry does the rest when the page
  opens in a browser; the Home Screen app's own storage is the exception in 2.6).
- The platform serves the same manifest; an app added from `mccluster.org` is a new app of the platform's origin.
  Whether it opens on the World or on the HERE page is question 5; until then it opens where today's app opens
  (`./index.html`, the HERE page on the platform).

### 2.9 Checkout and account returns

P0 makes every return follow the request: the return origin is the request's `Origin` when it is on the generated
site list, otherwise the platform's. With everyone still on Matthew's host the behaviour is unchanged; on the platform
the buyer comes back to the platform, signed in. The three functions that return to the dead
`mcclusterishere.github.io/Here` get the same rule. Stripe webhooks call the API host and do not change.

### 2.10 equityuprise.com later (stage F, prepared now, built later)

What flips: `platform.origin` becomes `https://equityuprise.com`; the World moves to its root; `mccluster.org` becomes
McCluster Corp's tenant (its root becomes the company page, `/company` and `/news/` stay, every platform path answers
301 to `equityuprise.com`); `matthew.mccluster.org` stays Matthew's tenant; the platform's WebSite becomes
`https://equityuprise.com/#website` (published by McCluster Corp, site name Equity Uprise); the Organization's `url`
stays `https://mccluster.org/`.

What it needs that this move does not:

- **DNS on Cloudflare**: `equityuprise.com` is on WordPress.com's nameservers today (Measured); Matthew adds the zone
  to the Cloudflare account and changes the nameservers at the registrar, or creates records there pointing at
  Cloudflare (his call; it has no mail today).
- **A static origin that never redirects**: from another zone, the Worker's fetch of `matthew.mccluster.org` would
  meet that host's Worker route (Inferred: only same-zone fetches skip routes), and a platform page would loop
  through a 301. By then the static origin is the Cloudflare Pages export (`mccluster-web`, when its release runner
  exists), or the profile router passes requests that carry Cloudflare's `CF-Worker` header naming the platform's
  zone straight to GitHub (a forged header would only fetch a public file).
- **Sign-in asks once**: `equityuprise.com` and `mccluster.org` are different sites, so the carry frame sees an empty
  partition (Measured for cross-site in Chromium). The clear line of 2.6 is the path; the privacy notice shows once
  more there (its cookie belongs to `mccluster.org`).
- **Lists**: Supabase redirect list and Site URL, the API's CORS list, the analytics collector's first-party hosts
  (`supabase/functions/collect/index.ts:225`), Search Console. The generator covers the code; the provider settings
  are Matthew's.

---

## 3. Law and record changes (exact text; one change, with the code of P0)

### 3.1 AGENTS.md

Plane table, lines 15-16, become:

```
| McCluster Corp's platform | `https://mccluster.org`: the whole site, set in one place (`data/seo/domain-architecture.json` → `platform.origin`), served by Worker `mccluster` by host from the static files this repo publishes. See `docs/control-plane/DOMAINS-AND-ENTITIES.md` |
| Matthew McCluster's profile (personal) | `https://matthew.mccluster.org`: his profile, a tenant of the platform; pages that moved answer 301 to the platform |
```

Hard rule 4 (line 34), the sentence "The public site is static and ships to `matthew.mccluster.org` from this repo,
not from `Here`." becomes "The public site is static and ships from this repo (GitHub Pages; never from `Here`);
Worker `mccluster` serves it by host: the platform (`mccluster.org`) and Matthew's profile (`matthew.mccluster.org`)."

Hard rule 15 (line 51) is replaced whole (written for the recommended answers to questions 1, 2 and 4 in section 7;
another answer changes the pages it names, not its shape):

> 15. **One platform, tenant properties, separate entities. Never collapse them.** The platform is one origin, set in
> one place (`data/seo/domain-architecture.json` → `platform.origin`): `https://mccluster.org/` (owner, 2026-11-23:
> "let's just have the whole site on mccluster.org instead, and matthew.mccluster.org be my profile, my personal
> profile"), and later `https://equityuprise.com/` (owner, 2026-11-23: "the real shit should be equityuprise.com. We
> haven't done that yet, but it shall be so soon enough. We must prepare without breaking anything to do that."). No
> other file names a host; the generator writes it everywhere. The platform serves every page at its path: the Equity
> Uprise World at its root (owner, 2026-10-15), music, albums, artists, Creator Studio, the account, checkout, the
> company page (`/company`) and news. `https://matthew.mccluster.org/` is **Matthew McCluster's** personal profile, a
> tenant of the platform: his front door, profile, résumés, engineering, portfolio, photography, films, press and
> policy writing keep their addresses there; McCluster is his artist name, the same Person; Whip Equipped LLC, his
> separate company, lives only there; every other page answers 301 to the same path on the platform. **Hosting is not
> identity.** McCluster Corp operates the platform: the platform's metadata, share cards, Organization data and
> navigation are McCluster Corp's, with Equity Uprise as the public brand (owner, 2026-10-28: "the public brand is
> Equity Uprise, not Human Uprise"; "Human Uprise" survives only as a legacy technical identifier). Matthew's profile
> pages are Matthew-first wherever they are shown, with their canonical on his host; the I AM HERE album is a front
> door to his profile, never the platform's homepage. Hierarchy: Matthew McCluster founded McCluster Corp; McCluster
> Corp operates Equity Uprise (the public brand: the public-interest project and its movement-creation social
> platform, the Equity Uprise World), PRIM3 (learning product, not a recording alias) and the McCluster Platform;
> **Whip Equipped LLC is Matthew's separate company, never a McCluster Corp sub-brand**; I AM HERE is Matthew's
> album, published through the ecosystem. Stable `@id`s do not move: Person
> `https://matthew.mccluster.org/#matthew-mccluster`; Organization `https://matthew.mccluster.org/#mccluster-corp`,
> whose `url` is `https://mccluster.org/`; a page that changes host changes its URL, canonical and WebSite, never an
> `@id`. **No working address breaks**: a page that moves answers 301 from its old address, path for path, after its
> canonical and sitemap entry moved; static files, embeds and the installed app's start page answer on both hosts;
> sessions move through the carry page (`carry.html` on the profile host, `js/carry.js` on the platform), never with a
> token in a URL; when they cannot, one clear line asks once. `https://humanuprise.com/` is a legacy-named McCluster
> Corp door, inert until the owner routes it, then a 301 to the platform. Authority:
> `data/seo/domain-architecture.json` and `docs/control-plane/DOMAINS-AND-ENTITIES.md`; tests enforce it.

### 3.2 The seven agent adapters

Each names the new heading by number (`scripts/test/domain-architecture.test.mjs:176` reads it from AGENTS.md):
`15. One platform, tenant properties, separate entities. Never collapse them.` (CLAUDE.md:58, CODEX.md:44,
GEMINI.md:42, .cursorrules:34, .cursor/rules/mccluster.mdc:36, .github/copilot-instructions.md:42,
.github/instructions/mccluster.instructions.md:26).

CLAUDE.md lines 15-18 become:

```
One platform, tenant properties, separate entities (`docs/control-plane/DOMAINS-AND-ENTITIES.md`):
`https://mccluster.org` is **McCluster Corp's** platform and the whole site (Worker `mccluster` by host; set in one place, `data/seo/domain-architecture.json` → `platform.origin`): its root is the Equity Uprise World (owner, 2026-10-15), music, albums, artists, Creator Studio and the account live there too (owner, 2026-11-23); **the public brand is Equity Uprise, not Human Uprise** (owner, 2026-10-28), and the company page is `/company`. `https://equityuprise.com` becomes the platform later by changing that one setting (owner, 2026-11-23).
`https://matthew.mccluster.org` is **Matthew McCluster's** personal profile, a tenant of the platform (McCluster is his artist name, the same Person); its pages that moved answer 301 to the platform.
`https://humanuprise.com` is a legacy-named door, a **McCluster Corp** host (never a third entity), inert until the owner routes it; then it answers 301 to the platform.
```

CLAUDE.md line 27 (stop item 13) keeps its first sentence ("**Never collapse McCluster Corp and Matthew McCluster.**",
asserted at `domain-architecture.test.mjs:139`) and continues: "Platform pages carry McCluster Corp's metadata
(Organization `url` `https://mccluster.org/`); Matthew's profile pages are Matthew-first wherever they are shown, with
their canonical on `matthew.mccluster.org` (the I AM HERE album is a front door there, not the identity). …" (the rest
unchanged). Lines 37-38 (plane rows) follow 3.1. CODEX.md:19-26, GEMINI.md:17-24, .github/copilot-instructions.md:17-24,
.cursorrules:14-17, .cursor/rules/mccluster.mdc:16-19 and .github/instructions/mccluster.instructions.md:9 get the same
two facts in their own shape: the platform is `mccluster.org` (whole site, one setting), Matthew's host is his
profile (a tenant), never collapse the entities.

### 3.3 docs/control-plane/DOMAINS-AND-ENTITIES.md

- Title and opening: "One platform, tenant properties, separate entities", authority quote of 2026-11-23 added
  under the 2026-10-03 instruction it amends.
- The table (lines 11-19): rows Whose house / Answers / Share preview / Entity / WebSite node / Source / Served by,
  for "the platform `https://mccluster.org/`" (the whole site; McCluster Corp; `https://mccluster.org/#website`;
  source: the static site plus the generated company pages; served by Worker `mccluster`) and "Matthew's profile
  `https://matthew.mccluster.org/`" (Matthew McCluster; his WebSite; source: the profile pages; served by Worker
  `mccluster` by host from the same static files once routed, GitHub Pages until then).
- "The front-door model" (21-26): kept, reworded: the platform's door is the World; Matthew's profile's door is the
  album; the album is never the platform's homepage.
- "What lives where (and why most URLs do not move)" (100-135) becomes "What lives where, and how a page moves": the
  four sets of 2.2; the move rule (canonical and sitemap first, 301 after, both hosts for static files, the carry for
  sessions, returns follow the request); the 2026-10 reasons ("sessions are per-origin", "checkout returns are
  hardcoded", "the redirect allowlist names that host") answered one by one with the measured carry and P0.
- "The edge, today and target" (137-206): today's measured answers (1.1), the router table (2.4), the stages (4) and
  the owner's steps (7), replacing the October activation list (which is done: the apex is routed).
- "The World's door today" (208-221) and "The legacy-named host" (239-279): the World is the platform's root;
  `humanuprise.com` answers 301 to the platform when routed.
- "Changing either property" (281-292): adds `tools/build-site-hosts.mjs --check/--write` and the rule that a host
  appears only in the record.

### 3.4 data/seo/domain-architecture.json

`schema_version` `mccluster-domain-architecture/v2`; `updated_at` the day of the change; `authority` adds "Owner
instruction, 2026-11-23"; `rule`: "One platform, tenant properties, separate entities. The platform (platform.origin)
serves every page; tenants are properties of their own entities on it; hosting is not identity; no working address
breaks: a page that moves answers 301 from its old address after its canonical and sitemap entry moved." New blocks
`platform`, `tenants`, `both_hosts`, `doors` (2.3). `properties.company` and `properties.personal` are kept as aliases
of `platform` and `tenants.matthew` until every reader moves (the domain test, `tools/build-company-site.mjs`,
`scripts/test/human-uprise-door.test.mjs`), then removed in P4. `url_ownership` becomes `platform`, `profile`,
`profile_only` (2.2) with every published page in exactly one; `why_company_apps_stay_put` is replaced by
`how_a_page_moves`; `edge.now` records the measured state of 2026-11-23 (1.1), `edge.target` the router table,
`edge.activation_owner_steps` section 7; `properties.human_uprise.open_question` keeps the owner's call (question 4);
`entities.equity_uprise.current_url`, `uprise_action_network.current_url` and `i_am_here.current_url` follow their
pages to the platform; `entities.*.id` unchanged.

### 3.5 The canonical architecture pair and the ecosystem map

`docs/control-plane/canonical-architecture.json` → `public_properties` (machine) and
`docs/control-plane/CANONICAL-ARCHITECTURE.md` → "Public properties" (human) change together (their CI requires it):
`rule` "One platform, tenant properties, separate entities; never collapse them. Serving the platform and its
tenants is ingress and routing inside Worker mccluster, not a new Worker, store or identity."; `company` →
`platform` (host `mccluster.org`, `served_by` `worker:mccluster`, `serves` "every page, path for path; the World at /;
the HERE front door at /index.html"); `personal` → `tenants.matthew` (host `matthew.mccluster.org`, `served_by`
`worker:mccluster` once routed, `github-pages` until then); `human_uprise` "301 to the platform when routed".
`domain-architecture.test.mjs:140-141` reads `public_properties.company.host` and `served_by`: the test moves to
`public_properties.platform`. `docs/control-plane/ECOSYSTEM.md`: the map's two boxes and the "What lives where" rows
for "Matthew McCluster's pages" and "McCluster Corp's pages".

### 3.6 Tests and other records that change on purpose

- `scripts/test/domain-architecture.test.mjs`: the new heading; the platform/tenant record; every published page in
  one set; per set, the expected canonical host, `og:site_name` and WebSite `isPartOf`; the `@id` set byte-identical
  to `b51ede03`'s (a fixture of today's `@id`s); Matthew's root still Matthew-first (lines 91-102, unchanged).
- `workers/mccluster/test/company-site.test.mjs:80-106, 149-174` (today's 301s to Matthew's host become
  pass-through, `/index.html` becomes the front door, `www` sends everything to the apex),
  `human-uprise-site.test.mjs` (301 to the platform), `scripts/test/human-uprise-door.test.mjs:30-56, 125-185` (the
  bar's host logic, the hand-off), `scripts/test/cloudflare-pages-stage.test.mjs` (the target host table),
  `scripts/test/publish-strip-parity.test.mjs` (unchanged rule, checked).
- Docs that describe today's split: `docs/control-plane/SHARED-NAVIGATION.md`, `docs/music/MUSIC-WORLD-CONTINUITY.md`,
  `docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md` ("Production domain"),
  `docs/control-plane/CLOUDFLARE-PAGES-DIRECT-UPLOAD.md` (target host), `docs/design/WORLD-SIGN-IN-DOOR.md` (item 12
  answered by Matthew's Site URL step), `data/README.md` (the new record and generator).

---

## 4. Stages

Every stage keeps every working address answering, and is undone by reversing its one deploy or setting.

| Stage | Deploys | Only Matthew can change | Undo |
| --- | --- | --- | --- |
| P0 prepare | Pages, Worker, Supabase functions (from `main`) | merging | revert the commit (each deploy follows `main`) |
| P1 the platform serves everything | Pages, then Worker | merging | Worker: roll back to the previous deployment (dashboard, seconds); Pages: revert |
| P2 canonicals, sitemaps, metadata | Pages, Worker | merging; Search Console (add `mccluster.org`, submit its sitemap); Supabase Site URL | revert; resubmit sitemaps; Site URL back |
| P3 the profile host answers 301s | none (the router shipped in P0, inert) | Cloudflare: SSL rule check, proxy the `matthew` record, add the route `matthew.mccluster.org/*` | remove the route (seconds); DNS-only again |
| P4 clean-up | Pages, Worker | merging; optional: the `here` rule's target, `humanuprise.com` routing | revert |
| F equityuprise.com | Pages, Worker, functions | the zone on Cloudflare, nameservers, routes, Supabase lists, Search Console, the day | flip the setting back; routes off |

### P0: prepare, with no visible change

What:
- The record v2 and `tools/build-site-hosts.mjs` with `--check` (CI) and `--write`; every published page classified.
- The generated outputs of 2.3, and every host literal in `js/`, `workers/mccluster/src/` and `supabase/functions/`
  replaced by them. With today's values the generated table describes today exactly: the platform serves the World
  and its rooms, Matthew's host everything; so the live answers do not change.
- Returns follow the request (2.9), including the three that point at the dead `Here` address.
- The router of 2.4 behind the table: the platform's "serves everything" and the profile host's 301s are off in the
  table; the profile router answers only once a route exists (it never runs before P3). The pass-through fix
  (`redirect: 'manual'` and `Location` rewrite) ships now, because it is right today too.
- `carry.html` (profile host, inert until a platform page asks) and `js/carry.js` (not loaded yet).
- The law of section 3, with the record's `edge.now` naming the stage that is live, so the law never claims a stage
  that has not shipped (each later stage updates `edge.now` in its own change).
- Tests: `scripts/test/site-hosts.test.mjs` (no stray host literal; the equityuprise rewrite resolves every path);
  `workers/mccluster/test/platform-router.test.mjs` (every host × path class × method, with today's table and with
  the P1 and P3 tables); `scripts/test/carry.test.mjs` (origin checks, one answer per id, no refresh token, nothing
  posted to another origin); the function return rule (a unit test per function); the domain test v2.

Acceptance: CI green; `scripts/e2e/platform-hosts.e2e.mjs` (the crawl of section 9 made a suite) shows every path on
every host with the same status, location and canonical as before the deploy; the `@id` set is identical.

### P1: the platform serves everything

What:
- Table: the platform serves every page (2.2); `www` sends everything to the apex.
- Client: on the platform the bar is local (Music `listen.html`, M `index.html`, Globe `/`); on the profile host
  Music and the Globe go to the platform and the M to its own root (amended 2026-11-24, below: Music, the account
  and an artist's page stay on the profile host until P3); the World is `/` and `/mnet.html` only, never
  `/index.html` (`js/tabbar.js:346`, `js/world-audio-continuity.js:17`, `js/music-shell.js` `world()` on the branch).
- The carry is on (platform pages load `js/carry.js`); the fragment hand-off writer is off; the clear line shows where
  the carry found nothing.
- Canonicals unchanged: the platform's copies still name Matthew's host, so search does not move yet.
- Order inside P1: Pages first (the client is right on both today's and tomorrow's Worker), then the Worker. Either
  order is safe: an old client on the new Worker links to Matthew's host, which still serves everything; a new client
  on the old Worker links locally and gets today's 301.

**Amendment, 2026-11-24 (the P1 review, VP1-3): on the profile host the song keeps playing until P3.** As first
written, the bar on `matthew.mccluster.org` sent Music and the account chip to the platform. A door to another
origin is a page load (`js/music-shell.js` `decide()`), so a song playing on his album or artist page stopped at the
first tap on Music or the chip, where P0 opened Listen or the sign-in over the one player as a view and the song
played on (the music shell's e2e: 10 of 113 checks failed). Matthew's direction decides it: "We must prepare without
breaking anything to do that" and "I want a singular fucking music engine with 1 fucking player at all times". So,
from P1 until P3 answers its 301s:
- On the profile host, the bar's doors to the pages the one player opens over itself as views stay on the profile
  host, as at P0: the Music tab and the owner's Play tab (`listen.html`), the account chip, the signed-out person tab
  and the World wing's Account room (`account.html`), an artist's page in the bar's middle cell
  (`music-creator.html?handle=`), the installed dock's house (`navigation.house`), and the World transport's title,
  which returns to Music (`musicHome`). One small function decides it, `pageBase` in `js/tabbar.js` (and `musicHome`
  in `js/world-audio-continuity.js`), reading `profile_host_routed` from the table: at P3 it is true and these go to
  the platform like every other page.
- A link that already crossed hosts at P0 keeps P0's behaviour: the Globe (the platform's World, over Music as
  before), and every other page (the album from Listen or an artist page, music videos, hire, Control, the games, a
  member's front page), each a page load at P0 too. The M is his own root, as written. The Now sheet's album and
  artist links are relative, so they stay on the host they are on.
- On the platform nothing changes: the bar is local.
The rest of P1 stands. Recorded in `data/seo/domain-architecture.json` (`edge.now.p1_changes` `bar_local`,
`edge.stages` P1), `docs/control-plane/DOMAINS-AND-ENTITIES.md`, hard rule 15 in `AGENTS.md` and the music record
(`docs/music/MUSIC-RELEASE-20261119.md`, M5); held by `scripts/test/site-hosts-engine.test.mjs` and
`scripts/e2e/carry.e2e.mjs` (on his album: Music and the chip on his host, the Globe on the platform), with
`scripts/e2e/music-shell.e2e.mjs` unchanged.

The same review made the carry's two promises visible (2.6.5 and 2.7, nothing else changed): on a phone, which never
shows a title, the account chip shows the clear line in a note under itself until it is closed (remembered on that
device; the sign-in page says it in its pane instead, and the World, whose door is its sign-in, leaves it to the next
page), and a top-level platform page other than the World that shows the chip offers the songs kept at the old
address once, in the bar's own peek card ("You kept 2 songs at the old address. Keep them here
too?"; a tap keeps the same files at the same paths in the platform's vault, Not now lets them be). Songs are counted
as songs: the lyrics, posters and covers the album kept beside them ride along uncounted.

Acceptance:
- The crawl: every public path on `mccluster.org` answers 200 or the same redirect class as on Matthew's host, with no
  console error the P0 baseline does not have (section 9 has today's statuses, redirects and heads) and no request
  for a document on Matthew's host.
- Sign-in: signed in on Matthew's host (fixture account on the plane fixtures), open `mccluster.org/listen.html`:
  signed in after one carry; no URL in the browser history or the network log contains a token; the old host stays
  signed in.
- Checkout fixtures (Stripe test mode on the plane fixtures) started on the platform return to the platform, signed in.
- `embed.html` from the platform renders inside a page of a foreign test origin.
- The World framed over Music on the platform is same-origin (the frame's `location.origin` equals the parent's).
- Matthew's host is unchanged: the installed app's `start_url`, `manifest.json` and `sw.js` answer 200 there.

### P2: canonicals, sitemaps and structured data move

What: `tools/build-site-hosts.mjs --write` rewrites the platform pages' canonical, `og:url`, `og:site_name` and
JSON-LD `url`/`isPartOf`; profile pages keep theirs; `@id`s untouched. `data/seo/entity-graph.json` urls follow; the
company generator and the profile entity generator rerun. Two sitemaps (`https://mccluster.org/sitemap.xml` lists the
platform pages; Matthew's lists the profile pages), two `robots.txt`, two `llms.txt`, the video sitemap split,
IndexNow sending each host's changed pages, `/company` and `/news/` with `img-src 'self'`. Matthew: Search Console
(add and verify the `mccluster.org` property; the record says its verification TXT records exist,
`DOMAINS-AND-ENTITIES.md:198`, and the zone publishes three TXT records; submit its sitemap; resubmit his own) and Supabase's Site URL. Not Search Console's Change of Address tool: this is a partial move, and that tool
expects a whole site to redirect.

Acceptance: `tools/build-sitemap.mjs --check` and the domain test v2 pass (every page's canonical is its own host's
URL); the crawl on both hosts shows each page's canonical on its set's host; the `@id` set is identical to today's;
the Rich Results test passes for `album.html`, `catalogue.html` and `matthew-mccluster.html` on their hosts.

### P3: Matthew's host answers 301s for the pages that moved

What (all Matthew's, in this order, in Cloudflare):
1. **SSL/TLS**: read the zone's encryption mode. If it is "Full (strict)", add a Configuration Rule for the hostname
   `matthew.mccluster.org` with SSL "Full" first: GitHub Pages renews its certificate only while the name points at
   GitHub, so once proxied its certificate may lapse (Inferred; with "Full" the edge accepts it either way). The
   router passes `/.well-known/acme-challenge/` through in any case.
2. **DNS**: switch the `matthew` CNAME (to `mcclusterishere.github.io`) from DNS only to Proxied.
3. **Workers Routes**: add `matthew.mccluster.org/*` → Worker `mccluster`.

Then: platform pages on Matthew's host answer 301 to the platform; profile pages, profile-only pages and static files
answer 200 from GitHub through the Worker; `deploy-pages.yml`'s `verify-live` checks both hosts (stamp and files on
the platform, the front door and a sample 301 on the profile host, the private paths as 404 on both). GitHub may show
"DNS check unsuccessful" for the custom domain; the site keeps serving (Inferred; watched for a week).

Acceptance: the redirect map test (every URL in today's two sitemaps, `url_ownership`, the QR and campaign links in
`data/`, and 50 shared addresses from analytics' top landing paths → expected final URL and one hop); the crawl on
both hosts; the carry on arrival by a 301; the installed app (Matthew's device rows 6-8); the certificate's expiry
date recorded.

Rollback: remove the route (requests reach GitHub through the proxy, as before), and if needed switch the record back
to DNS only.

### P4: clean-up (after 30 quiet days)

Remove the hand-off reader, the World-host special cases in the bar, the aliases in the record, SPEC-ENGINE's
World-to-Music hand-over (5.5; only the profile host's front door keeps one, section 5), and the `frame-ancestors`
entries nobody uses. The installed-app card stays until analytics shows no launches from the old app for 30 days.
Optional, Matthew: point `here.mccluster.org`'s redirect rule at `https://mccluster.org/$1` (one hop instead of two),
and route `humanuprise.com` (question 4).

### F: equityuprise.com (later; section 2.10)

Prerequisites: the Cloudflare zone, a non-redirecting static origin, the provider lists. Then the same staging:
F1 the new platform serves everything (old platform still serving), F2 canonicals and sitemaps, F3 `mccluster.org`
answers 301s for platform pages and becomes the company's tenant. Sign-in asks once (cross-site).

---

## 5. What the one engine gains, and the order

| SPEC-ENGINE today | With P1 |
| --- | --- |
| 5.2: the World over Music is a frame of `https://mccluster.org/` inside Matthew's music page: cross-origin, so the parent keeps the transport and the frame only shows state | the frame is same-origin with Music: it can call the retained engine directly, inside the tap |
| 5.3: World links back to Music need a `postMessage` bridge (`music-open`) with origin and nonce checks | a direct call into the retained document's shell; or the World opens as one more view (M5 views are same-origin frames) |
| 5.4: the World opened directly runs its own engine instance; Music from there is a page load on another host | the World's document is the platform's retained document; Music opens over it as views; one element |
| 5.5: across hosts the song is handed over in the address fragment and one tap picks it up | not needed between the World and Music; kept only for the one path that still crosses: a song started on the front door at Matthew's host, then Music |
| 5.6: commerce doors (License, On the record, Book the studio) hidden on the company host | the music and its doors are platform pages: shown the same everywhere |
| 15, question 1 (show the music at mccluster.org?) | answered: yes |
| 13 and question 2 (the front page on the one player?) | answered: yes. P1 serves the front door at `/index.html` on the platform, so the M button can open it as a page or view of the same origin; the engine builds the player into it (index.html, named by Matthew: "the front page") |
| 4.11 and question 3 (count the World's shuffle as plays?) | answered: yes. The engine sends the shuffle's starts to the listen ledger like any song (engine work) |
| 5.1 (opening the World leaves the sound as it is) | confirmed by Matthew: opening the World or tapping the Globe while a song plays keeps the song and its order; the shuffle starts only when nothing is held (an engine test row) |

The order:

1. Now, in parallel: P0 and the engine's stages 0 and 1 (music pages; they are origin-neutral). They share
   `js/tabbar.js`, `js/music-shell.js` and `js/world-audio-continuity.js`: one owner per file per week, P0 rebases on
   the engine's stage 1 or the other way round, never both open on one file.
2. P1, before the engine's stage 2 (the World on the engine). Stage 2 is then built once, for one origin, without the
   hand-over, the second engine instance or the cross-origin bridge.
3. P2 and the engine's stage 3 (sign-in; its pop-up `auth/popup.html` is origin-relative and the platform is already
   on Supabase's list).
4. P3 when Matthew has ten minutes in Cloudflare; then P4 and the engine's stage 4 (more pages as views, the front
   door included).

---

## 6. Risks, and how each is tested before and after

| # | Risk | How it would break | Contained by | Tested |
| --- | --- | --- | --- | --- |
| 1 | An old address stops working (shares, QR codes, campaigns, e-mails, search) | a page answers 404 or loops | path-for-path 301 with query; pages served on the platform before any 301 exists (P1 before P3); profile pages never move | before: today's GET baseline (section 9), then P0's crawl and redirect map of the unchanged site; after each stage: the same crawl and map, diffed |
| 2 | Search loses the pages for a while | two copies with different canonicals; a canonical pointing at a redirect | canonicals flip (P2) before the 301s (P3), on both copies at once; profile pages keep theirs; no Change of Address tool | `build-sitemap --check`; the domain test v2; Search Console coverage watched for 4 weeks after P2 and P3 |
| 3 | Members appear signed out | sessions are per origin | the carry (measured same-site); the clear line; the old host never signed out | `scripts/e2e/carry.e2e.mjs` (Chromium, partitioning on); device row 3 on Safari |
| 4 | A token leaks through a URL | history, logs, Referer | the carry is `postMessage` to an exact origin; the fragment writer goes in P1 | the carry e2e asserts no request URL or history entry contains the token |
| 5 | A purchase returns to the wrong host | hard-coded returns | returns follow the request (P0, before P1) | a unit test per function; checkout fixtures on both hosts |
| 6 | Embeds on other sites go blank | the platform's frame headers | `embed.html` exempt; served on both hosts; never 301 | an e2e frames it from a foreign origin |
| 7 | Old images and share cards break | an asset 301 under `img-src` rules | static files never 301; `/company`, `/news/` move to `img-src 'self'` in P2 | the crawl's image requests; `company-site.test.mjs` CSP case |
| 8 | Directory pages break on the platform | the pass-through follows GitHub's slash redirect | `redirect: 'manual'` and `Location` rewrite (P0) | router unit tests for `/engineering`, `/action`, `/whip` |
| 9 | Offline songs vanish | the vault is per origin | the old app keeps its vault; the kept list carries and re-keeps | `music-offline-vault` e2e on both hosts; device row 7 |
| 10 | The installed app strands Matthew | out-of-scope navigation, separate storage | start page stays 200; one-time move card; re-add from the platform | device rows 6-8 |
| 11 | GitHub's certificate lapses behind the proxy | 526 errors on Matthew's host | the SSL rule for the host; ACME path passed through; rollback to DNS only | certificate expiry checked at P3 and 30 days later |
| 12 | Slower pages, more Worker requests | one extra hop per page; every file through the Worker | 60 s edge cache for documents; static caching as today | TTFB before/after (section 1.1 numbers); Matthew checks the Workers plan covers the requests |
| 13 | The two entities blur | company metadata on Matthew's pages or the reverse | per-set metadata written by the generator; `@id`s fixed; Whip only on his host | the domain test v2; the crawl reads each page's head |
| 14 | AI crawlers treated differently than Matthew wants | the zone's managed robots | his decision (question 3) applied per host | robots bodies on both hosts after P3 |
| 15 | Analytics doubles listeners | a new device id per origin | the device id carries (after the privacy agreement) | the carry e2e; a dated note on the dashboards at P1 |
| 16 | Deploys land out of order | Pages and the Worker deploy separately | the client and the router read one table; each tolerates the other's previous state | the router and client unit tests run with both tables |
| 17 | The privacy notice shows twice | per-origin storage | its cookie is `Domain=mccluster.org` already | first-visit e2e on the platform after a visit to the profile host |
| 18 | Stage F loops or signs everyone out | a redirecting static origin; cross-site storage | F's prerequisites (2.10) | the equityuprise rewrite in `site-hosts.test.mjs`; an F rehearsal on a preview hostname |
| 19 | `mccluster.org/index.html` changes meaning | today it 301s to the World; from P1 it is the HERE front door | World queries on it still 301 to `/`; the World's canonical, sitemap entry and links have always been `/`, never `/index.html` | the redirect map carries `mccluster.org/index.html` with and without `?view=feed` |

---

## 7. Matthew's steps, in plain words, and the questions only he can answer

Steps:

1. Read this and say go, and answer the questions below.
2. After P2 ships: in Google Search Console add `mccluster.org` (the record says its DNS verification is in place) and
   submit `https://mccluster.org/sitemap.xml`. In Supabase, set the Site URL to `https://mccluster.org`.
3. When P3 is ready (about ten minutes, in Cloudflare): check the SSL setting (add the rule if it says "Full
   (strict)"), turn the orange cloud on for `matthew`, and add the Worker route `matthew.mccluster.org/*`. To undo:
   delete the route.
4. In Cloudflare, check that the Workers plan covers every page and file going through the Worker.
5. On your iPhone: open `mccluster.org` in Safari, check you are signed in, add it to your Home Screen, open the new
   icon, keep your albums again if it offers, then delete the old icon.
6. Later, for equityuprise.com: move its DNS from WordPress.com to Cloudflare, then pick the day.
7. Run the device rows below once each stage is live.

Device rows (iPhone, Safari unless named):
1. Open `mccluster.org/listen.html`: Music, not a redirect; play a song; tap the M: your HERE page opens on
   `mccluster.org` (address `…/index.html`).
2. Tap the Globe while the song plays: the World opens, the song and its order stay.
3. Signed in at `matthew.mccluster.org` before the move, open `mccluster.org`: signed in, no sign-in screen.
4. Open an old link (`matthew.mccluster.org/album.html?album=here`): it lands on the same album at `mccluster.org`.
5. Open `matthew.mccluster.org`: your HERE page, your address, not a redirect; your résumé link stays on your host.
6. The old Home Screen app still opens; it shows the move card once.
7. Keep an album in the new app, Airplane Mode, play it.
8. Buy a song in test mode (when checkout is on): you come back to `mccluster.org`, signed in.

Questions:

1. **Your address's first page.** `matthew.mccluster.org` keeps opening on your HERE page (the album experience) as
   today. Or should it open on your profile page (`matthew-mccluster.html`)?
2. **Your résumé, engineering, portfolio, photography, films and press pages.** Keep their home at
   `matthew.mccluster.org` (recommended: recruiters and search keep the same links; they still open inside
   mccluster.org), or move them to mccluster.org too?
3. **AI crawlers.** Cloudflare tells AI training crawlers to stay off `mccluster.org`; your own site's robots file says
   "read it". Once everything moves, which do you want on each address?
4. **humanuprise.com.** When it is ever switched on, send it to `mccluster.org` (recommended), or keep it as a separate
   door to the World?
5. **The app you add from mccluster.org.** Should it open on the World or on your HERE page?

---

## 8. File plan

| Path | Change | Stage |
| --- | --- | --- |
| `data/seo/domain-architecture.json` | v2 (3.4); every page classified | P0 |
| `tools/build-site-hosts.mjs` (new) | `--check`/`--write`; writes the outputs of 2.3 | P0, P2 |
| `workers/mccluster/src/platform/hosts.generated.js`, `workers/mccluster/src/platform/router.js` (new) | the table and the router of 2.4; `company-site/router.js` and `human-uprise/router.js` keep their generated pages and call it | P0 |
| `workers/mccluster/src/world-host.js` | `redirect: 'manual'` with `Location` rewrite; headers by class; frame-ancestors from the table; 60 s document cache | P0 |
| `workers/mccluster/src/entry-platform.js` | the platform router before the API (in place of the two calls) | P0 |
| `workers/mccluster/src/lib/http.js`, `creator-billing.js`, `action-connect.js`, `action-archive.js`, `connect.js`, `social/router.js` | origins from the table; returns follow the request | P0 |
| `workers/mccluster/wrangler.toml` | `PUBLIC_ORIGIN` documented as the static origin (test seam); `APEX_ORIGIN` and `PUBLIC_APP_URL` removed or derived | P0 |
| `supabase/functions/_shared/site-hosts.ts` (new) and the ten functions of 1.2 | returns follow the request | P0 |
| `js/shell-boot.js` | the generated `window.MCC_SITE` block | P0 |
| `js/tabbar.js` | hosts from `MCC_SITE`; local bar on the platform; World = `/` and `/mnet.html`; hand-off writer off (P1), reader removed (P4) | P0, P1, P4 |
| `js/world-audio-continuity.js`, `js/music-shell.js` (branch) | hosts from `MCC_SITE`; `/index.html` is the front door, not the World | P0, P1 |
| `js/live-content.js`, `js/mnet.js`, `js/action-globe.js`, `js/travel/world-travel.mjs`, `js/travel/whip-booking.mjs`, `js/world-source-profile.js`, `js/news-brief.js` | hosts from `MCC_SITE` | P0 |
| `carry.html` (new), `js/carry.js` (new) | the carry of 2.6 and 2.7; the clear line | P0 (inert), P1 |
| `index.html` | unchanged (hard rule 3); the installed-app move card (2.8) is drawn by `js/tabbar.js`, which the front door already loads (`index.html:564`), on the profile host in standalone mode only | P1 |
| every platform page | canonical, `og:url`, `og:site_name`, JSON-LD `url`/`isPartOf` by the generator | P2 |
| `data/seo/entity-graph.json`, `data/seo/company-site.json`, `data/seo/sitemap-pages.json`, `sitemap.xml`, `sitemap-video.xml`, `robots.txt`, `llms.txt`, `tools/build-sitemap.mjs`, `tools/build-company-site.mjs`, `tools/build-profile-entity.mjs`, `tools/indexnow-changed.mjs`, `.github/workflows/indexnow.yml` | per-host maps and metadata | P2 |
| `.github/workflows/deploy-pages.yml` | `verify-live` on both hosts; `CNAME` unchanged | P2, P3 |
| AGENTS.md, the seven adapters, DOMAINS-AND-ENTITIES.md, the canonical architecture pair, ECOSYSTEM.md, the docs of 3.6 | section 3 | P0 |
| Tests (new): `scripts/test/site-hosts.test.mjs`, `scripts/test/carry.test.mjs`, `workers/mccluster/test/platform-router.test.mjs`, `scripts/e2e/platform-hosts.e2e.mjs`, `scripts/e2e/carry.e2e.mjs`; changed: 3.6 | P0-P3 |
| CI and the source map | the new suites in the workflows that run their neighbours; source map rows for the new files | P0 |

---

## 9. Evidence

Under (local evidence folder of the 2026-11-23 session; not in the repository):

- `dns.sh`, `parse_doh.py` → `out/dns.txt`: every name on two public resolvers (DNS over HTTPS); TXT records counted,
  not copied.
- `hosts.sh` → `out/hosts.txt`: 46 paths on each host by HEAD, redirects followed by hand; `out/headers-key.txt`
  (security headers); `out/timing.txt` (TTFB samples); `out/equityuprise-wp.html` (the placeholder's page, read for
  its title).
- `storage.cjs` → `out/chromium/storage.json` (Playwright's default, partitioning off) and
  `out/chromium/storage-partitioned.json` (Chrome's default, partitioning on): same-site frame storage shared,
  cross-site frame storage partitioned. Only the throwaway browser profile's storage was written.
- `get-key.sh`, `parse-get.py` → `out/get/chains.tsv`, `out/get/parsed.json`: 24 key paths (`paths-key.json`: the
  front door, music, Creator Studio, account, checkout, company and member pages, the profile pages, Whip, the embed,
  Control) by GET on both hosts, redirects followed by hand, no script run. On `mccluster.org`: `/index.html` 301 to
  `/` (the World, whose head the Worker writes: canonical `https://mccluster.org/`, `og:site_name` McCluster Corp,
  `isPartOf` `https://mccluster.org/#website`; `mnet.html` itself carries none, `world-host.js:39-50`);
  `account.html` and `login.html` 200 (World rooms, `noindex`); the other 21 one hop 301 to the same path on Matthew's
  host, query kept. On Matthew's host all 24 answer 200: 17 name a canonical on his host and none elsewhere, 7 have no
  canonical (`music-creator`, `account`, `login`, `front`, `member-front`, `embed`, `control`); `og:site_name`
  "Matthew McCluster" on 5 (`index`, `catalogue`, `docket-516`, `mccluster-corp`, `engineering`), two of them company
  pages that P2 moves to McCluster Corp; JSON-LD `isPartOf` `https://matthew.mccluster.org/#website` on 7; 53
  distinct `@id`s, all on `https://matthew.mccluster.org/` except the World's; 23 of 24 load `js/shell-boot.js` and
  `js/tabbar.js` (`embed.html` neither), so the generated `MCC_SITE` block reaches every app page; absolute references
  to Matthew's host per document 0 to 143 (`catalogue.html` 143, `matthew-mccluster.html` 63, `index.html` 35).
- `crawl.cjs` with `paths-key.json`: the browser crawl of the same 24 paths (the platform served the way the
  pass-through would, the document fetched from Matthew's host and answered at the platform address; Matthew's host as
  the baseline; GET only, analytics, media and non-GET requests aborted, service workers blocked, nobody signed in)
  was queued behind other suites on the shared browser lock and stopped unrun. It is the seed of
  `scripts/e2e/platform-hosts.e2e.mjs`; P0 runs it before any change and keeps its console and request baseline.
- Cloudflare's documentation (search): routes are not the target of a same-zone `fetch()`; without
  `global_fetch_strictly_public` (no default date) a same-zone subrequest goes to the zone's origin.
- Notes: (local evidence folder of the 2026-11-23 session; not in the repository).
