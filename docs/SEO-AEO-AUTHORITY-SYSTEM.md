# The search and answer-engine authority system

How matthew.mccluster.org makes the real record of Matthew McCluster's work
complete, verifiable, connected, machine-readable and hard to misunderstand:
for Google (including AI Overviews and AI Mode), Bing and Copilot, ChatGPT
search and other retrieval systems, recruiters, clients and browser agents.

Written 2026-10-03. It supersedes the sitemap and Person-entity sections of
[`docs/seo-matthew-mccluster.md`](seo-matthew-mccluster.md), which stays as
history and for its still-correct analysis of which name queries are winnable.

**Nothing here promises a ranking.** It does the things that are technically
and editorially defensible and that raise the odds of being found, cited and
correctly understood. **Truth is the first optimization variable:** a claim
the evidence does not support is a liability in every one of those systems.

---

## 0. The short version

| You want to... | Do this |
| --- | --- |
| Change a fact about Matthew (title, sameAs, award, education) | Edit `data/entity-graph.json`, then `node tools/seo/build-entity-jsonld.mjs` |
| Change a price | Edit `data/offers.json`, then `node tools/seo/build-offer-jsonld.mjs` |
| Add or fix a track | Edit `data/catalogue.json` / `data/albums.json`, then `node tools/seo/build-catalogue.mjs` |
| Publish a dated milestone | Add an entry to `docs/seo/evidence-ledger.json` with evidence, mark it `verified` + `publish`, then `node tools/seo/build-newsroom.mjs` |
| Add a page to search | Add it to `PAGES` in `tools/seo/build-sitemaps.mjs`, then run it |
| Edit the résumé page | Then `node tools/build-resume.mjs` (PDF, IT PDF and DOCX) and `python3 scripts/resume-docx.py resume-it-support.html assets/resume/matthew-mccluster-resume-it-support.docx` |
| Check everything | `node --test scripts/test/seo-contract.test.mjs` and `python3 tools/verify-llms.py` |

CI runs both on every pull request that touches pages, data, the sitemaps or
these tools (`.github/workflows/seo-contract.yml`).

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

```
data/entity-graph.json ──► tools/seo/build-entity-jsonld.mjs ──► matthew-mccluster.html (ProfilePage + full graph)
data/offers.json       ──► tools/seo/build-offer-jsonld.mjs  ──► hire.html (Service + Offer, approved prices only)
data/catalogue.json  ┐
data/albums.json     ┴──► tools/seo/build-catalogue.mjs      ──► catalogue.html (static registry + MusicAlbum/MusicRecording)
docs/seo/evidence-ledger.json ► tools/seo/build-newsroom.mjs ──► newsroom.html + feed.xml (verified entries only)
data/gallery.json      ──► tools/build-walls.mjs             ──► walls/*.html (photo pages)
pages + git history    ──► tools/seo/build-sitemaps.mjs      ──► sitemap.xml (+ images) + sitemap-video.xml
deploy (main)          ──► deploy-pages.yml re-dates the sitemap from git, then ships
deploy succeeded       ──► indexnow.yml pings only the public pages that changed
pull request           ──► seo-contract.yml: scripts/test/seo-contract.test.mjs + tools/verify-llms.py
```

Every generator has `--check`; the contract test runs them all, so a hand
edit inside a generated block, or a data change without a rebuild, fails CI.

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

One definition, stable `@id`s, referenced everywhere else.

| Entity | @id | Type | Home |
| --- | --- | --- | --- |
| Matthew McCluster | `https://matthew.mccluster.org/#matthew-mccluster` | Person | `matthew-mccluster.html` |
| The profile page | `https://matthew.mccluster.org/matthew-mccluster.html` | ProfilePage | itself |
| The website | `https://matthew.mccluster.org/#website` | WebSite (name "Matthew McCluster") | home + profile |
| McCluster Corp | `https://matthew.mccluster.org/#mccluster-corp` | Organization | profile, home |
| Equity Uprise | `https://matthew.mccluster.org/#equity-uprise` | Project (sub-organization of McCluster Corp) | `docket-516.html` |
| Whip Equipped LLC | `https://matthew.mccluster.org/#whip-equipped` | Organization | `whip.html` |
| Uprise Action Network | `https://matthew.mccluster.org/#action-network` | WebApplication | `action/` |
| I AM HERE | `https://matthew.mccluster.org/#album` | MusicAlbum | home, catalogue |
| Each recording | `https://matthew.mccluster.org/catalogue.html#<slug>` | MusicRecording | catalogue |
| Each service | `https://matthew.mccluster.org/hire.html#<offer-id>` | Service | hire |

Relationships: Person `worksFor` McCluster Corp; `affiliation` Equity
Uprise, Whip Equipped, **Southern Connecticut State University (current
student, computer science)**; McCluster Corp `founder` Person and
`subOrganization` Equity Uprise; Equity Uprise `parentOrganization` McCluster
Corp; the Action Network `publisher` McCluster Corp; albums `byArtist`
Person where the site says so; recordings `inAlbum` their album; services
`provider` Person and `brand` McCluster Corp.

**sameAs** lists only profiles of this person: ORCID, ISNI, LinkedIn,
Muso.AI, GitHub, Instagram, YouTube, TikTok. The rendered `rel="me"` links
on the profile must match it exactly (the contract test checks). Credits
(the SoundCloud production credit) are modelled as `MusicRecording.producer`,
never as sameAs. McCluster Corp's sameAs is its ISNI only; the personal
social accounts are the Person's, not the company's.

**Disambiguation:** `disambiguatingDescription` states the distinguishing
facts (Bridgeport native, McCluster Corp, Equity Uprise, ORCID, ISNI) and
that he is not the athlete or comedian with a similar surname.

**Deliberately absent:** Apex Kingdom (separate entity and a religious
affiliation; not presented without the owner asking); an artist credit for
CIA Mind Control (published under an alias); a degree (none is claimed:
SCSU is a current enrollment, so `affiliation`, never `alumniOf`).

---

## 4. Schema strategy, by page type

| Page | Types | Notes |
| --- | --- | --- |
| Profile | ProfilePage, Person, Organization ×2, Project, WebApplication, WebSite, MusicRecording (credit), BreadcrumbList | generated |
| Home | WebSite, MusicAlbum, Person (consistent subset), Organization, VideoObject | metadata-only edits; the UI is not touched |
| Recruiter hub | CollectionPage + ItemList of case studies | |
| Case studies | Article (author Person @id), SoftwareSourceCode, BreadcrumbList | `citation` = the evidence |
| Hire | WebPage, Service ×4 with Offers | generated from approved ledger lines only |
| Services | CollectionPage pointing at the hire.html Service @ids | no second price list |
| Catalogue | CollectionPage, MusicAlbum, MusicRecording (isrcCode, duration) | credits only where stated |
| Newsroom | CollectionPage + ItemList of DigitalDocument/Event/Report/Article | generated, verified only |
| Docket 516R | Article about the Council docket (sameAs the Council's pages) | |
| Photo walls | ImageGallery, ImageObject, Event, client Organization | no `organizer` claim; films are not images |
| Press | AboutPage about Person + Organization | |
| Résumé (IT), policy, portfolio, card | WebPage / CollectionPage referencing the Person | the profile is the only ProfilePage |

---

## 5. URL taxonomy

Indexable (in `sitemap.xml`; each self-canonical and never `noindex`):

- **Identity:** `/matthew-mccluster.html`, `/resume-it-support.html`, `/card.html`, `/press.html`, `/newsroom.html`
- **Recruiter / IT:** `/engineering/`, `/engineering/ipc-data-center.html`, `/engineering/mccluster-platform.html`
- **Services:** `/services.html`, `/hire.html`, `/sites.html`, `/sites-details.html`, `/case-designer-kicks.html`
- **Photography and film:** `/gallery.html`, `/walls/*.html`, `/shots.html`, `/films.html`, `/portfolio.html`
- **Music:** `/`, `/album.html`, `/listen.html`, `/catalogue.html`, `/license.html`
- **Civic and policy:** `/docket-516.html` (Equity Uprise front page), `/policy.html`, `/policy-memo-dna.html`, `/action/`, `/heal-the-3rd-world.html`, `/end-racism.html`
- **Other ventures:** `/whip.html`, `/prayer-closet.html`, `/closet/sent.html`, `/inner-room.html`, `/privacy.html`

Out on purpose: desks and accounts (noindex or disallowed), redirect stubs
(`tracks/*`, `merch.html`, `walls.html`, ...), the shelved Equity Uprise rooms
in `_unfinished/` (not published), `management.html` (it says `noindex`; it was
in the old sitemap anyway, which this fixes).

No city pages. The service area is two real home bases (Bridgeport, CT and
Decatur, GA) and travel at cost, stated once on `services.html`.

---

## 6. The recruiter cluster

Built only from the résumé and documents: Robert Half desktop/IT support
(2018 to 2021), IPC Systems data center through PeopleSERVE (2021 to 2023),
F.R.E.E.D.O.M. Inc. platform support (2021 to 2026), the McCluster platform
(2025 to present), CompTIA ITF+, the CT State IT Bootcamp certificate, and
current computer science study at SCSU.

`/engineering/` answers, per role title (IT Support Specialist, Desktop
Support, Field IT, Data Center Technician, Infrastructure Technician, Network
Support, Systems Technician, Web/Platform Developer): what the experience
was and where its evidence comes from, graded **Résumé**, **IPC document**,
or **Source code**. The IPC case study shows the engagement document's scope
beside what the résumé claims, and shows "Not listed" where they differ.

Not targeted, because nothing supports it: telematics/GPS/fleet systems
(Whip Equipped has a rental operator console, not telematics), automotive
technology systems, any certification beyond the two, any degree.
`JobPosting` is never used to advertise a candidate.

---

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

`docs/seo/evidence-ledger.json` holds every dated public claim with its
evidence, verification status (`verified`, `needs-verification`,
`owner-statement`) and publication status (`publish`, `hold`,
`not-for-newsroom`). Only `verified` + `publish` entries render, and the
contract test enforces it.

**Press-release workflow.** Nothing is auto-published. A release describes a
real event: add the entry with `event_date`, today's `publish_date` (never
earlier), the factual claims and the evidence URLs; a person opens the
evidence and sets `verified`; set `publish`; rebuild; open a PR. The newsroom
shows the event date and, when different, the publication date. An entry
that cannot be evidenced stays `hold` with an `owner_action`.

---

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
| **IPC job title** | The IPC engagement document's cover reads "Infrastructure Associate" (and `data/dossier.json` agrees); both résumé pages say "Infrastructure Engineer" | Confirm the title of record with PeopleSERVE/IPC and align the résumés. Employment checks report the title of record. The new pages avoid naming the title. |
| **"Instructed new team members"** | The document lists that duty under "Leadership (Kevin)" | Confirm or remove from the résumé. Not repeated on the new pages. |
| **Microsoft 365 / Active Directory at IPC** | On the IT résumé; not in IPC's document | Confirm. The new pages attribute these skills to Robert Half and F.R.E.E.D.O.M. only. |
| **CT charity registration** | The certificate on file shows an expiration of 09/30/2026 | Confirm the renewal on elicense.ct.gov and replace the PDF. New copy says "registered in October 2025", never "is registered". |
| **Georgia base** | Profile says Acworth; booking page says Decatur | Pick one for public pages. |
| **Privacy banner on document pages** | Changed from a wall to a banner (§2.1); recording behaviour unchanged | Confirm, or remove the meta from any page that should keep the wall. |
| **"Money or the Power" credit** | `data/catalogue.json` has no credit; the Docket page credits Old Jay ft. Ocho (prod. Pax) | Add the credit to the catalogue data. The graph already credits Old Jay. |
| **CIA Mind Control credit** | Released under an alias | Decide whether its public artist credit is Matthew McCluster. Until then the graph lists the album with no artist. |
| **Bridgeport proclamation scan** | Cropped along its right edge | Upload a complete scan. |
| **Release and upload dates** | I AM HERE has only "2026"; the Vaunt films have no upload date | Supply them; then the album gets an exact `datePublished` and the films can carry VideoObject. |
| **Equity Uprise group migration** | `supabase/migrations/20261003150000_equity_uprise_group_docket_516r.sql` is written and was executed against the real table definitions locally (twice, idempotent) | Apply it to production the usual way (dry run, then run). Until then the group, campaign and missions linked from `docket-516.html` do not exist. |

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
7. Remove `user-scalable=no` from the remaining 25 published pages where no gesture depends on it (rule 14 in AGENTS.md); they were left alone here because they are interactive UIs.

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
