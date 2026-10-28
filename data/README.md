# `data/`: what is the record, what is derived, and who writes each

Every JSON file here is read by a page, a tool or a test. Some are the
source of a fact (the owner edits them); some are generated from another
file and must not be edited by hand; some are display mirrors of a Supabase
table that is the real authority. This file says which is which, so no one
types the same fact twice or fixes a generated file where it will be
overwritten. The control-plane law is `../AGENTS.md`; the two properties are
`../docs/control-plane/DOMAINS-AND-ENTITIES.md`.

Rule of thumb: **if a file names a generator, run the generator.** Every
generator has a `--check` mode, and the unit suite (`node --test
scripts/test/*.test.mjs`, which the Worker deploy runs) fails when a
generated file has drifted from its source.

## Music

| File | Role | Written by | Read by |
| --- | --- | --- | --- |
| `albums.json` | **Source.** The shelf: every record, in release order, with each track's title, `sub`, `credit`, audio `src`, poster, `lyrics` file, reel, music video, commerce experience and gate. The audio file's name without its extension is the track's **slug** everywhere (a gated track's slug is its bucket folder). | owner, by hand | `album.html`, `listen.html` (`js/listen.js`), `music-videos.html`, `catalogue.html`, the World's random song (`js/world-audio-continuity.js`), the Worker (`workers/mccluster/src/platform-api.js` names it as the catalogue), the three generators below |
| `ddex/identifiers.json` | **Source** for ISRCs. The QT6KV desk's ledger: append-only, one code per slug, never reminted. Allocation order is `albums.json`. | the DDEX desk exports it; a code already published on a slug is recorded here, not reissued (`docs/ddex.md`) | `tools/build-music-registry.mjs` |
| `../workers/mccluster/src/music/tracks.js` | **Derived.** Each public track's length in seconds, measured from the committed audio (the container is sniffed, not the extension). The listen ledger counts a finish against it. | `node scripts/music-track-lengths.mjs` (`--check`; `scripts/test/music-track-lengths.test.mjs`) | the Worker's music routes, `tools/build-music-registry.mjs` |
| `catalogue.json` | **Derived.** The public registry: one row per track on the shelf with its slug, title, credit, album, house number, `m:ss` length and ISRC. Do not edit it; change `albums.json`, the ledger or the audio. | `node tools/build-music-registry.mjs` (`--check`) | `catalogue.html`, `js/listen.js`, `album.html` (credit lines), `tools/build-catalogue.mjs`, `llms.txt` (`tools/verify-llms.py` counts it) |
| `../catalogue.html` (generated blocks) | **Derived.** The registry rows, the shelf links and the MusicAlbum/MusicRecording graph, as static HTML between the `catalogue-*` markers. | `node tools/build-catalogue.mjs` (`--check`, run by `scripts/test/seo-contract.test.mjs`) | crawlers; the page's own script repaints the same rows |
| `lyrics/<file>.json` | **Source.** Timed (`lines[].t`, `lines[].text`) or plain lyrics. Which file belongs to which track is `albums.json`'s `track.lyrics`: the file name need not match the slug (`money-or-the-power.dk.json`). | owner, by hand | `album.html`, the World headline (`js/world-audio-continuity.js`, through `albums.json`), `scripts/build-captions.mjs`, `docket-516.html` |
| `reels/<slug>.json` | **Source.** The cut list a track's music video follows. | owner, by hand | `album.html` through `albums.json`'s `track.reel` |
| `playlists.json` | **Source.** Playlists over the shelf. | owner | `album.html` |

Adding a song: put the file under `assets/audio/`, add the track to
`albums.json`, let the desk issue its ISRC in the ledger, then run
`node scripts/music-track-lengths.mjs && node tools/build-music-registry.mjs
&& node tools/build-catalogue.mjs` and update the count in `llms.txt`.

## Photography and the walls

| File | Role | Written by | Read by |
| --- | --- | --- | --- |
| `walls-intake.json` | **Source.** Which events are walls, their prefix, cover and whether their stills sell. | owner | `tools/wall-index.mjs` |
| `assets/img/<event>/` | **Source.** The frames that actually landed. | owner uploads | `tools/wall-index.mjs` |
| `gallery.json` | **Mixed.** Each event's story, client and venue are the owner's; each wall's `media` array and `cover` are **derived** from the folder on disk and overwritten on every run. Edit the prose, never the media list. | `node tools/wall-index.mjs` (`--check`); prose by hand | `gallery.html`, `admin.html`, `tools/build-walls.mjs` (the static `walls/<id>.html` pages), `tools/build-sitemap.mjs` |
| `prints.json` | **Mirror** of the sellable stills; prices and rights live in Supabase (`rights_flags`, offerings). | owner, kept in step with the database | `admin.html`, `js/counter.js`, `js/control-room/work-tools.js` |
| `shots/*.json`, `portfolio.json`, `archive.json` | **Source.** Curated sets for `shots.html`, `production.html` and the archive. | owner | those pages; `llms.txt` counts `portfolio.json` |
| `vault-intake.json` | **Source** for a workflow, not a page: Drive links that `vault-ingest.yml` pulls and files into Supabase. | owner | the workflow only |

## Commerce

| File | Role | Written by | Read by |
| --- | --- | --- | --- |
| `offerings.json` | **Mirror, display only.** The authoritative offerings ledger is the Supabase table from `supabase/replay_migrations/0007_offerings.sql` and its successors; checkout reads the database row for price and seller. Change the database first, then this. | owner, in step with the database | `services.html`, `sites*.html`, `scripts/kb-build.mjs`, `scripts/smoke.mjs` |
| `offers.json`, `merch.json`, `prayer-closet.json`, `market-rates.json`, `sites.json` | **Source** for the pages that paint them; prices that are charged come from the database, never from these. | owner | `services.html`, `sites*.html`, `prayer-closet.html`, `js/prices.js`, `js/closet.js`, the knowledge base build |
| `clients.json`, `environments.json`, `domains.json`, `providers.json` | **Source.** Client products staged to Cloudflare Pages, the album environments, hosting domains and providers. | owner | `scripts/stage-cloudflare-pages.mjs`, `js/env.js`, `js/floorcache.js` |

## Entity, SEO and the two properties

`seo/` is the machine-readable authority for who the properties are
(`docs/control-plane/DOMAINS-AND-ENTITIES.md`). Its files are **sources**;
what they generate lives outside `data/`:

| Source | Generator (`--check` in `scripts/test/seo-authority.test.mjs` / `seo-contract.test.mjs`) | Output |
| --- | --- | --- |
| `seo/entity-graph.json` | `tools/build-profile-entity.mjs`, `tools/build-hire-schema.mjs` | the JSON-LD on `matthew-mccluster.html`, `hire.html` |
| `seo/company-site.json` | `tools/build-company-site.mjs` | `workers/mccluster/src/company-site/pages.generated.js` |
| `seo/evidence-ledger.json` | `tools/build-newsroom.mjs` | `newsroom.html`, `press.html` claims |
| `seo/recruiter-evidence.json` | `tools/build-recruiter-role-map.mjs` | `engineering/recruiter-role-map.html` |
| `seo/sitemap-pages.json` | `tools/build-sitemap.mjs` (`deploy-pages.yml` re-dates it from git) | `sitemap*.xml` |
| `seo/domain-architecture.json` | none: read directly by `index.html`, the company router and the tests | |
| `product-context.json`, `brands.json`, `roles.json`, `dossier.json`, `card.json`, `legacy-page-routes.json` | none: read directly (`mccluster-corp.html`, `ecosystem.html`, `card.html`, `tools/vcard.mjs`, the tests) | |

## The World, action and research

| File | Role | Written by | Read by |
| --- | --- | --- | --- |
| `geo/*.json`, `geo/admin1/`, `geo/world-states/`, `geo/world-state-areas/` | **Derived** from Natural Earth (pinned release named in each tool). Never hand-edited. | `tools/build-country-boundaries.mjs`, `tools/build-admin1-boundaries.mjs`, `tools/build-world-countries.mjs`, `tools/build-world-states.mjs`, `tools/build-flag-sprite.mjs` | `js/mnet.js`, `js/world-countries.js`, the admin analytics globe |
| `travel/cities.json` | **Derived** from Natural Earth populated places (`travel/README.md`). | the README's recipe | `js/travel/world-travel.mjs` |
| `travel.json` | **Source.** Travel quote inputs. | owner | `workers/travel-quote.js` |
| `action/docket-516r-archive.json`, `docket-516-files.json`, `cause.json` | **Source.** The Docket 516R archive, its files and the cause page. | owner | `js/docket-cohort-showcase.js`, `js/cohort-profile.js`, `docket-516.html`, `js/cause.js` |
| `eu-fellowships.json`, `eu-topics.json`, `fellows.json` | **Source.** Fellowship programs and topics; `tools/eu-export-seed.sh` seeds the database from them. | owner | `js/eu-api.js`, `llms.txt` (`tools/verify-llms.py` counts them) |
| `research/references.json`, `scripture/*.json` | **Source.** The research reference registry and the inner room's chapters. | owner | `research.html`, `inner-room.html`, `js/closet.js` |
| `analytics/application-schema-inventory.json` | **Derived** snapshot of the Supabase schema (metadata only, no rows), dated inside. | an audit run | `js/control-room/analytics-unified.js` |
| `front-projects/` | **Source.** Client project fronts, served as published. | owner | `scripts/test/vaunt-project.test.mjs` |
