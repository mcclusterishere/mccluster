# The search and answer-engine authority system

How matthew.mccluster.org makes the real record of Matthew McCluster's work
complete, verifiable, connected, machine-readable and hard to misunderstand:
for Google (including AI Overviews and AI Mode), Bing and Copilot, ChatGPT
search and other retrieval systems, recruiters, clients and browser agents.

Written 2026-10-03, after reconciling with the Stage 1/2A/2B authority work
(#311 canonical identity v2, #312 the four recruiter lanes, #313 the
recruiter evidence ledger and role map). It supersedes the sitemap and
Person-entity sections of [`docs/seo-matthew-mccluster.md`](seo-matthew-mccluster.md),
which stays as history and for its analysis of which name queries are winnable.

**Nothing here promises a ranking.** It does the things that are technically
and editorially defensible and that raise the odds of being found, cited and
correctly understood. **Truth is the first optimization variable:** a claim
the evidence does not support is a liability in every one of those systems.

---

## 0. The short version

| You want to... | Do this |
| --- | --- |
| Change a fact about Matthew (title, sameAs, award, education, a project) | Edit `data/seo/entity-graph.json`, then `node tools/build-profile-entity.mjs` |
| Change a price | Edit `data/offers.json`, then `node tools/build-hire-schema.mjs` |
| Add or fix a track | Edit `data/catalogue.json` / `data/albums.json`, then `node tools/build-catalogue.mjs` |
| Publish a dated milestone | Add an item to `data/seo/evidence-ledger.json` with evidence and today's `published` date; a person verifies it; set `publish: true`; then `node tools/build-newsroom.mjs` |
| Change a recruiter lane or role title | Edit `data/seo/recruiter-evidence.json`, then `node tools/build-recruiter-role-map.mjs` |
| Add a page to search | Add its URL to `data/seo/sitemap-pages.json`, then `node tools/build-sitemap.mjs` |
| Edit the résumé page | `node tools/build-resume.mjs` (PDF, DOCX, stamp); for the IT résumé `node tools/build-it-resume.mjs`; check with `tools/verify-resume.mjs` / `tools/verify-it-resume.mjs` |
| Check everything | `node --test scripts/test/seo-authority.test.mjs scripts/test/seo-contract.test.mjs` (runs every generator's `--check` and `tools/verify-llms.py`) |

CI runs both on every pull request, inside the repository's existing test
step (`node --test scripts/test/*.test.mjs` in `mcp-continuity-ci.yml`).

---

## 1. Research basis (checked 2026-10-02/03)

### A. Official, current guidance this system follows

| Guidance | Source | What it changed here |
| --- | --- | --- |
| No special optimization or AI files are needed for AI Overviews/AI Mode; pages must be indexed and snippet-eligible; query fan-out issues related searches across subtopics | [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) (updated 2025-12-10) | Pages are written to answer the subquestions around each topic (§8); no "AI chunking"; snippet controls left open (`max-snippet:-1`) |
| Unique, satisfying content; good page experience; content Google can access | [Top ways to perform well in AI experiences](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search) (2025-05-21) | Case studies with primary evidence; static HTML for critical information |
| ProfilePage is a page with `mainEntity` Person; homepages do not qualify | [ProfilePage structured data](https://developers.google.com/search/docs/appearance/structured-data/profile-page) (2026-09-08) | One ProfilePage (the profile), separate from the Person node |
| Organization markup on the home page or one about page; use specific subtypes | [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization) (2026-09-08) | Organization defined on the profile/home; programs typed `Project`, the network `WebApplication` |
| Article author: Person with url/sameAs; name only; datePublished/dateModified | [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article) (2026-09-08) | Case studies and the Docket explainer |
| Google ignores `priority` and `changefreq`; uses `lastmod` only when consistently accurate | [Build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) (2026-07-08) | lastmod = each page's last commit, re-dated at deploy; priority/changefreq removed |
| Use `<img>`, descriptive alt, srcset, image sitemaps; CSS backgrounds are not indexed | [Image SEO](https://developers.google.com/search/docs/appearance/google-images) (2026-03-02) | Image entries in the sitemap; catalogue covers as real `<img>` |
| Video needs a page where it is embedded and visible, a thumbnail, stable URLs; VideoObject needs uploadDate | [Video SEO](https://developers.google.com/search/docs/appearance/video) (2025-12-18) | Video sitemap for embedded films; no VideoObject where the upload date is unknown |
| Full-screen dialogs make content hard for search engines to understand; prefer small banners | [Avoid intrusive interstitials](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials) (2025-12-10) | Privacy notice is a banner on public document pages (§2.1) |
| FAQ rich results are retired (deprecated May 2026) | [FAQ structured data](https://developers.google.com/search/docs/appearance/structured-data/faqpage) | No new FAQPage markup; visible Q&A kept as plain HTML |
| Spam policies: cloaking, doorways, hidden text, keyword stuffing, link spam, scaled content, site reputation abuse | [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) (2026-08-28) | §14 |
| Google-Agent is a user-triggered fetcher for agents acting for a user | [Google user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) (2026-08-19) | Agent readiness through real links, labels and no wall (§2.1) |
| IndexNow: submit only changed URLs; key file at the root | [IndexNow documentation](https://www.indexnow.org/documentation) | Post-deploy ping of changed public pages only (§10) |
| Bing guidelines (Feb 2026): GEO is a named category; clear entity names, facts stated directly near the top; noarchive/nocache affect Copilot; prompt injection is abuse | Bing Webmaster Guidelines, summarized by [Search Engine Journal](https://www.searchenginejournal.com/bing-adds-geo-to-official-guidelines-expands-ai-abuse-definitions/568442) (Bing's own page is script-rendered and could not be read directly) | Consistent entity names; a factual first paragraph on every authority page; no hidden instructions for models |

### B. Useful experiments (kept, but not relied on)

- **`llms.txt`.** Google says no AI text files are needed. It costs little, an
  agent can use it, and `tools/verify-llms.py` keeps it true. Kept.
- **Answer-engine citation testing** with the fixed prompts in
  `docs/seo/query-set.json`, run by hand monthly (§12).
- **Wikidata item** for Matthew McCluster once third-party coverage exists (§11).

### C. Folklore (not done)

`meta keywords` (ignored; left where it already was, not added), sitemap
`priority`/`changefreq`, "chunking content for AI", repeating the name for
"entity density", FAQPage markup for rich results, city-name landing pages.

### D. Tactics that risk spam policies (never done)

Doorway or city pages, hidden text or links, text written for models that
people cannot see, prompt injection, fake reviews or `AggregateRating` on
our own services, `JobPosting` used to advertise a candidate, scraped or
mass-generated pages, bought links, structured data describing things the
page does not show, backdating.

---

## 2. Architecture

One pattern everywhere: **source data → generator → committed output → verifier → CI.**

```
data/seo/entity-graph.json      ─► tools/build-profile-entity.mjs     ─► matthew-mccluster.html (ProfilePage + the full graph)
data/offers.json                ─► tools/build-hire-schema.mjs        ─► hire.html (Service ×4 + Offers, approved prices only)
data/catalogue.json + albums    ─► tools/build-catalogue.mjs          ─► catalogue.html (static registry + MusicAlbum/MusicRecording)
data/seo/evidence-ledger.json   ─► tools/build-newsroom.mjs           ─► newsroom.html + feed.xml (verified + publish only)
data/seo/recruiter-evidence.json─► tools/build-recruiter-role-map.mjs ─► engineering/recruiter-role-map.html
data/gallery.json               ─► tools/build-walls.mjs              ─► walls/*.html (photo pages)
data/seo/sitemap-pages.json     ─► tools/build-sitemap.mjs            ─► sitemap.xml (+ images) + sitemap-video.xml
resume pages                    ─► tools/build-resume.mjs / build-it-resume.mjs ─► PDF + DOCX + visible-text stamp
deploy (main)                   ─► deploy-pages.yml dates the sitemap from git history, then ships
deploy succeeded                ─► indexnow.yml pings only the public pages that changed (tools/indexnow-changed.mjs)
pull request                    ─► scripts/test/seo-authority.test.mjs + seo-contract.test.mjs (+ verify-llms)
```

Every generator has `--check`; the tests run them all, so a hand edit inside
a generated block, or a data change without a rebuild, fails CI.
`data/` is published with the site, so it holds only public-safe facts.
Internal review notes (unverified claims, owner actions, discrepancies) live
in `docs/seo/evidence-review.json`; `docs/` is stripped from the deploy.

The evidence pages share one stylesheet, `css/authority.css`: `auth__*`
cards for routing pages and the `rec__*` long-form coat for documents.

### 2.1 The privacy notice on public document pages

`js/live-content.js` shows a full-screen "Privacy before entry" dialog that
hides the page until the visitor agrees. On pages that carry
`<meta name="mcc-privacy-notice" content="banner">` it is a compact bar at
the bottom instead. **What is recorded does not change:** `js/analytics.js`
still records nothing, sets no device or session id and registers no service
worker until the notice is acknowledged. The words on the page become
readable first, to a recruiter, a search engine and a browser agent.
Opted in: the profile, both résumés, the engineering pages, services, hire,
press, newsroom, catalogue, gallery, portfolio, policy pages, the Docket
explainer, the Designer Kicks case study, card, sites-details, whip, license. The house itself (accounts,
Mnet, the desks, players) keeps the gate. The banner never prints.
**This is an owner decision to confirm** (§13).

---

## 3. The entity graph

One definition, in `data/seo/entity-graph.json`, emitted once on the
profile; stable `@id`s referenced everywhere else.

| Entity | @id | Type | Home |
| --- | --- | --- | --- |
| Matthew McCluster | `https://matthew.mccluster.org/#matthew-mccluster` | Person | `matthew-mccluster.html` |
| The profile page | `…/matthew-mccluster.html#profile-page` | ProfilePage (the canonical one) | itself |
| The website | `…/#website` | WebSite (name "Matthew McCluster") | home |
| McCluster Corp | `…/#mccluster-corp` | Organization (Bridgeport, CT) | `mccluster-corp.html` is the canonical company/product hub; profile and home reference the same @id |
| Equity Uprise | `…/#equity-uprise` | Project of McCluster Corp; url `docket-516.html` | `docket-516.html` |
| PRIM3 | `…/prim3.html#prim3` | Project | `prim3.html` |
| Whip Equipped LLC | `…/whip.html#whip-equipped` | Organization, owned by the Person | `whip.html` |
| Uprise Action Network | `…/mnet.html#uprise-action-network` | SoftwareApplication | `mnet.html` |
| McCluster Platform | `…/engineering/mccluster-platform.html#mccluster-platform` | SoftwareSourceCode | platform page |
| Southern Connecticut State University | `…/#southern-connecticut-state-university` | CollegeOrUniversity | profile |
| I AM HERE | `…/#album` | MusicAlbum | home, catalogue |
| Each recording | `…/catalogue.html#<slug>` | MusicRecording | catalogue |
| Each service | `…/hire.html#<offer-id>` | Service | hire |

Relationships: Person `worksFor` McCluster Corp, `owns` Whip Equipped,
`affiliation` **Southern Connecticut State University (current first-year
student, computer science; never `alumniOf`)**; McCluster Corp `founder`
Person, `subOrganization` Equity Uprise and PRIM3, `owns` the Action Network
and the platform. Occupations carry O*NET-SOC codes so a recruiter's system
can match them; the names are the ones #311 set. Credentials are only the
two with public documents (CompTIA ITF+, the CT State IT Bootcamp).

**sameAs** lists only profiles of this person: GitHub, ORCID, ISNI, LinkedIn
(the one resolved profile), Muso.AI, Instagram, YouTube, TikTok. The
rendered `rel="me"` links on the profile must match it exactly (tested).
Credits (the A$hon Voyage production credit) are `MusicRecording.producer`,
never sameAs. McCluster Corp's sameAs is its ISNI only.
`identity_resolution` in the graph file records the policy and is never
emitted.

**Disambiguation:** `disambiguatingDescription` states the distinguishing
facts and that he is not the athlete or comedian with a similar surname.

**Deliberately absent:** a degree (none is claimed); a current charity
status (the certificate's period ended September 30, 2026; only the
issued-October-2025 fact and the number are stated); Apex Kingdom in the
graph (its citation is in the press kit as a document, not an entity claim);
PRIM3 game lore as biography.

## 4. Schema strategy, by page type

| Page | Types | Notes |
| --- | --- | --- |
| Profile | ProfilePage, Person, Organizations, Projects, SoftwareApplication, SoftwareSourceCode, CollegeOrUniversity, MusicAlbum/Recording, BreadcrumbList | generated |
| Home | WebSite, MusicAlbum (tracks → catalogue @ids), Organization, VideoObject | JSON-LD only; the UI is not touched |
| Recruiter hub | CollectionPage, hasPart the four lanes, ItemList | |
| Lane pages (IT support, data center, field technology) | ProfilePage about the Person + Occupation | #312; never JobPosting |
| Platform, IPC | TechArticle (author @id, Occupation, citation = the evidence) | |
| Role map | generated from the recruiter ledger | |
| Hire | WebPage, Service ×4 with Offers (hourly as `HUR`, "from" as `minPrice`) | generated, approved lines only |
| Services | CollectionPage pointing at the hire.html Service @ids | no second price list |
| Catalogue | MusicAlbum, MusicRecording (isrcCode, duration) | credits only where stated |
| Newsroom | CollectionPage + ItemList of DigitalDocument/Event/Report | generated, verified only |
| Docket 516R | Article about the Council docket (sameAs the Council's pages) | |
| Photo walls | ImageGallery, ImageObject, Event, client Organization | no `organizer` unless the data names one; films are not images |
| Card, policy, portfolio, résumé (IT) | WebPage / CollectionPage referencing the Person | only the profile claims the canonical ProfilePage @id |

## 5. URL taxonomy

Indexable (in `sitemap.xml`; each self-canonical and never `noindex`):

- **Identity:** `/matthew-mccluster.html`, `/resume-it-support.html`, `/card.html`, `/press.html`, `/newsroom.html`
- **Recruiter / IT:** `/engineering/` (hub), the four lanes `/engineering/it-support-systems.html`, `/engineering/data-center-networking.html`, `/engineering/mccluster-platform.html`, `/engineering/field-technology-telematics.html`, the case study `/engineering/ipc-infrastructure.html`, and `/engineering/recruiter-role-map.html`
- **Services:** `/services.html`, `/hire.html`, `/sites.html`, `/sites-details.html`, `/case-designer-kicks.html`
- **Photography and film:** `/gallery.html`, `/walls/*.html`, `/shots.html`, `/films.html`, `/portfolio.html`
- **Music:** `/`, `/album.html`, `/listen.html`, `/catalogue.html`, `/license.html`
- **Civic and policy:** `/docket-516.html` (Equity Uprise front page), `/policy.html`, `/policy-memo-dna.html`, `/action/`, `/heal-the-3rd-world.html`, `/end-racism.html`
- **Other ventures:** `/whip.html`, `/prayer-closet.html`, `/closet/sent.html`, `/inner-room.html`, `/privacy.html`

Out on purpose: desks and accounts (noindex or disallowed), redirect stubs
(`tracks/*`, `merch.html`, `walls.html`, ...), the shelved Equity Uprise rooms
in `_unfinished/` (not published), `management.html` (it says `noindex`; the
#311 allowlist still listed it, and the sitemap generator now refuses it).

No city pages. The service area is two real home bases (Bridgeport, CT and
Decatur, GA) and travel at cost, stated once on `services.html`.

---

## 6. The recruiter cluster

Four lanes (#312), one evidence ledger (#313), one hub:

| Lane | Page | Strongest evidence |
| --- | --- | --- |
| IT support & systems | `it-support-systems.html` | Résumé (Robert Half 2018–2021, F.R.E.E.D.O.M. Inc.), CompTIA ITF+, CT State IT Bootcamp |
| Data center, networking & infrastructure | `data-center-networking.html` + the IPC case study | IPC's engagement document (primary) |
| Platform, backend & technical operations | `mccluster-platform.html` | Public source code; architecture and operations are his, coding agents contribute implementation |
| Field technology, telematics & vehicle systems | `field-technology-telematics.html` | Résumé (Whip Equipped LLC, 2024–present): first-party, labeled as such |

The hub (`/engineering/`) keeps the long-form evidence a recruiter reads:
skills with where each was used, experience, education, certificates and
the questions recruiters ask. The role map lists the job titles per lane and
says plainly that a title is role fit, not a title held. The IPC case study
shows the document's scope beside the résumé, marks "Not listed" where the
résumé does not claim a row, quotes the document's own purpose (to help
staff "identify the many technologies they may have assisted with"), and
names the role by the document's cover title, Infrastructure Associate.
`JobPosting` is never used to advertise a candidate.

## 7. Commercial services

`/services.html` defines each service, its deliverables, the work behind it
and the process, and points at `/hire.html` for the price. Prices exist in
one place (`data/offers.json`); the Service/Offer markup is generated from
approved, listed lines only.

---

## 8. Query fan-out: the subquestions each page answers

| Topic | Subquestions | Where answered |
| --- | --- | --- |
| Who is Matthew McCluster? | which one (not the athlete); what he does; where; organizations; recognition; identifiers; contact | profile first paragraph, At a glance, Recognition, identifiers |
| Can he do this IT job? | which roles; what tools; where used; proof; certifications; education; location; résumé file | `/engineering/` tables, case studies, résumé |
| What did he do at IPC? | scope; hardware; networking; dates; employer of record | IPC case study |
| What has he built? | stack; data/access control; releases; Linux; payments; how it is built | platform case study |
| Hire him for a project? | services; deliverables; prices; area; process; rights; examples | services, hire |
| His music? | albums; tracks; ISRCs; credits; licensing | catalogue, album, license |
| Equity Uprise? | what it is; who founded it; recognition; Docket 516R; how to join | Docket explainer, newsroom, profile |
| Is it real? | primary documents | newsroom, Recognition links, case-study evidence |

---

## 9. Evidence and the newsroom

`data/seo/evidence-ledger.json` (public) holds each dated claim: `date`
(when it happened), `published` (when this site first published it),
title, summary, `claims`, `evidence` (label + repository path or source
URL), the entities it is about, `verification_status` and `publish`. Only
`verified` + `publish` items render; a publish flag on an unverified item
stops the build. The CT charity certificate, the credentials and the IPC
document are verified but not newsroom items (`publish: false`, as #311 set).

**Press-release workflow.** Nothing is auto-published. A release describes a
real event: add the item with its `date`, today's `published` (never
earlier), the claims and the evidence; a person opens the evidence and sets
`verified`; set `publish`; rebuild; open a PR. The newsroom shows the event
date and, when different, the publication date; the feed is dated by
publication. Claims that cannot be evidenced go to
`docs/seo/evidence-review.json` with an owner action, and never ship.

## 10. Indexing workflow

1. **Google Search Console:** verify the `matthew.mccluster.org` property
   (a Domain property for `mccluster.org` also covers the apex and `here.`);
   submit `sitemap.xml` and `sitemap-video.xml`; URL-inspect and request
   indexing for `/matthew-mccluster.html`, `/engineering/`,
   `/resume-it-support.html`, `/docket-516.html`, `/newsroom.html`.
   AI Overviews/AI Mode traffic appears in Performance → Search type: Web.
2. **Bing Webmaster Tools:** import from Search Console; submit both
   sitemaps. IndexNow is already wired (`indexnow.yml`, key file at the root).
3. **IndexNow:** automatic after each successful deploy, only for changed
   public pages. By hand: `node scripts/indexnow-ping.mjs <path> ...`.
4. **Feed:** `feed.xml` (Atom) carries the newsroom.

---

## 11. External profile remediation (manual)

These cannot be done from the repository. Each strengthens the same entity.

| Where | Action |
| --- | --- |
| ORCID | Add `https://matthew.mccluster.org/matthew-mccluster.html` as a website; add a biography (the 50-word bio in `data/dossier.json`); add employment (McCluster Corp, founder, 2025 to present) and education (SCSU, computer science, in progress); add keywords. Today it has a name and one work, nothing else. |
| LinkedIn | Website field → the profile URL; headline consistent with the profile; add the CompTIA and CT State certificates; add SCSU (in progress); add McCluster Corp as a company page if eligible; confirm the IPC title of record (§13). |
| GitHub `mcclusterishere` | Create the profile README repository (`mcclusterishere/mcclusterishere`) linking the profile, `/engineering/` and the platform case study; set the profile website field. |
| YouTube, Instagram, TikTok | Display name "Matthew McCluster" (not only "McCluster"); bio link to the profile. |
| Muso.AI | Link the profile; add the QT6KV recordings and their credits. |
| ISNI | Confirm the record lists the website. |
| Google Business Profile | Only if a service-area business is legitimately operated; otherwise skip. |
| Wikidata | Only after independent coverage that names him exists. Cite the General Assembly citation and proclamations, write neutrally, expect review. |

---

## 12. Measurement

The query set and the 2026-10-03 baseline are in
[`docs/seo/query-set.json`](seo/query-set.json). Baseline in one line: a
search for "Matthew McCluster" returned only Dexter McCluster; "Equity
Uprise", "McCluster Corp" and "I AM HERE … Matthew McCluster" returned
nothing relevant; the home page is indexed; "Docket 516R" is a live topic
with no plain-English explainer ranking.

Track monthly:

| Signal | Where |
| --- | --- |
| Impressions, clicks, CTR, position per query set and landing page | Search Console Performance (Web, which includes AI features); Bing WMT |
| Indexed pages, crawl errors, sitemap read status | Search Console Pages + Sitemaps; Bing WMT |
| Rich-result validity (ProfilePage, Article, Breadcrumb, Video) | Search Console Enhancements; Rich Results Test |
| Résumé downloads, role emails, service inquiries | first-party analytics events `data-cta` (`bio-resume-pdf`, `eng-email`, `services-book`, `d516-group`, ...) |
| Answer-engine citations | run each prompt in `answer_engine_prompts` in Google AI Mode, ChatGPT search, Copilot and Perplexity; record whether matthew.mccluster.org is cited and whether the facts are right; save screenshots with the date |
| Referring domains | Search Console Links; Bing WMT backlinks |

---

## 13. Decisions only the owner can make

| Item | What was found | Recommendation |
| --- | --- | --- |
| **IPC job title** | The IPC engagement document's cover reads "Infrastructure Associate"; both résumé pages and the graph's occupation list say "Infrastructure Engineer" | Confirm the title of record with PeopleSERVE/IPC and align the résumés. Employment checks report the title of record. The IPC case study names the role by the document's title. |
| **"Instructed new team members"** | The document lists that duty under "Leadership (Kevin)" | Confirm or remove from the résumé. Not repeated on the new pages. |
| **Microsoft 365 / Active Directory at IPC** | On the IT résumé; not in IPC's document | Confirm. The hub attributes these skills to Robert Half and F.R.E.E.D.O.M. only. |
| **CT charity registration** | The certificate's period ended September 30, 2026 | Confirm the renewal on elicense.ct.gov and replace the PDF. Until then pages state only that the certificate was issued October 28, 2025; the ledger item stays `publish: false`. |
| **Georgia base** | Profile says Acworth; booking page says Decatur | Pick one for public pages. |
| **Privacy banner on document pages** | Changed from a wall to a banner (§2.1); recording behaviour unchanged | Confirm, or remove the meta from any page that should keep the wall. |
| **"Money or the Power" credit** | `data/catalogue.json` has no credit; the Docket page credits Old Jay ft. Ocho (prod. Pax) | Add the credit to the catalogue data. The graph already credits Old Jay. |
| **CIA Mind Control credit** | Released under an alias | Decide whether its public artist credit is Matthew McCluster. Until then the graph lists the album with no artist. |
| **Bridgeport proclamation scan** | Cropped along its right edge | Upload a complete scan. |
| **Release and upload dates** | I AM HERE has only "2026"; the Vaunt films have no upload date | Supply them; then the album gets an exact `datePublished` and the films can carry VideoObject. |
| **Equity Uprise group migration** | `supabase/pending_migrations/20261003150000_equity_uprise_group_docket_516r.sql` is written and was executed against the real table definitions locally (twice, idempotent). It sits in `pending_migrations/` because the drift guard admits only migrations recorded in the production ledger | Apply it (rolled-back dry run, then run), move it to `supabase/migrations/` and record it in `supabase/production-ledger.json`. Until then the group, campaign and missions linked from `docket-516.html` do not exist. |

---

## 14. Prohibited

Everything in §1.D. Also: any claim not in the evidence ledger or on the
résumé; a sameAs that is not this person's profile; markup describing
content the page does not show; publishing a gated title in markup or static
HTML; changing `index.html`'s UI for SEO; a city page.

## 15. Future experiments

- A per-track watch page for the films that matter most, once upload dates are known.
- A Wikidata item after independent coverage.
- Server-rendering the gallery's event list (the walls already are).
- Measuring whether the banner notice changes recruiter engagement (`data-cta` events).

## 16. Backlog

**P0 · indexability and entity correctness**
1. Apply the Equity Uprise group migration (§13).
2. Submit both sitemaps and request indexing for the five authority pages (§10).
3. Resolve the IPC title and the two résumé bullets (§13).
4. Confirm the CT charity renewal (§13).

**P1 · recruiter and commercial conversion**
5. LinkedIn and ORCID remediation (§11).
6. GitHub profile README linking `/engineering/`.
7. Remove `user-scalable=no` from the remaining published pages where no gesture depends on it (rule 14 in AGENTS.md); they were left alone here because they are interactive UIs.

**P2 · content, case studies, newsroom**
8. A web-design case study (Shiloh Baptist Church app, Yohana Robertson's lead site) with before/after and what was built.
9. A photography case study for the DeKalb County and 100 Black Men work, with the client's permission.
10. Newsroom entries for the album release and Docket filings once evidenced.

**P3 · external authority**
11. Local coverage that names "Matthew McCluster" in full (the strongest third-party signal available).
12. Wikidata, after 11.

**P4 · experimental**
13. Monthly answer-engine citation runs (§12).
14. Watch pages for key films.
