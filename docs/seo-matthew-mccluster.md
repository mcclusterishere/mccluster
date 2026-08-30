# Search visibility for the name

What was done on this site for the queries **"Matthew McCluster"**,
**"McCluster"**, and **"Matthew"** — what is now in place, what only the
owner can do, and an honest read on which of those three is actually
winnable.

Worked from `Matthew_McCluster_SEO_Strategy.pdf` (2026-08-17), plus an
audit of what the repository already had.

> **Since this was written, the site moved.** `here.mccluster.org` was
> renamed to `matthew.mccluster.org` — the rename the repo had been
> planning since 2026-07-30. Every URL below is the new host, and the
> old one forwards. That change *helps* everything in this document: the
> Person `@id` had always claimed `matthew.mccluster.org`, and until the
> rename it pointed at a domain that did not resolve. It does now. See
> [`docs/domain-cutover.md`](domain-cutover.md).

---

## 1. Read this part first: which queries are winnable

The three names are three completely different problems, and it is worth
being blunt about that before anyone measures success against the wrong
one.

| Query | Realistic outcome | Why |
|---|---|---|
| **"Matthew McCluster"** | **Winnable — should be the top result, and the knowledge panel is reachable** | Low competition. The main rival is phonetic drift toward Dexter McCluster (NFL) and Matt McCusker (comedian). That is an *entity disambiguation* problem, and disambiguation is exactly what the work below does. |
| **"McCluster"** | **Partly winnable — page one is plausible, position one is not** | Dexter McCluster has a decade of national sports coverage behind him. Realistic target: rank for "McCluster" *plus* almost any qualifier — McCluster Corp, McCluster Bridgeport, McCluster creative director, McCluster photographer. |
| **"Matthew" alone** | **Not winnable, and not worth spending on** | That query competes with the Gospel of Matthew, Matthew McConaughey, Matthew Perry, and the given name itself. No amount of on-site work moves it, and no honest consultant will tell you otherwise. Spend the effort on the first two. |

The strategy PDF is right about the cause — phonetic collision with
higher-traffic people — and right that structured data is the lever. It
is worth knowing that the fix works by making the *entity* unmistakable,
not by repeating the name more often.

---

## 2. What the site already had

Worth recording, because it is unusually strong and most of the PDF's
advice was already implemented or superseded:

- One `Person` node with a stable `@id` (`https://matthew.mccluster.org/#matthew-mccluster`) referenced across 8 pages, rather than a fresh Person object per page.
- **ORCID and ISNI** identifiers. These are stronger identity signals than any social profile, because they are registry-issued and third-party controlled.
- A real custom domain, server-rendered flat HTML, canonical tags, breadcrumbs, and an existing Organization entity with EIN, UEID, ISNI and ISRC prefix.

Two pieces of the PDF were therefore **deliberately not applied**:

1. **`"url": "https://your-github-username.github.io"`** — the site has a real custom domain on a real property. Pointing the entity at a github.io subdomain would be a downgrade.
2. **The keyword phrase "Matthew McCluster | IT Specialist, Photographer & Creator"** — the site's established positioning is "Creative Director & Founder," and it is carried consistently across titles, OG tags and schema. Overwriting a consistent brand phrase with a conflicting one costs more than it gains. The *intent* behind the advice was honored differently: IT is now represented as an occupation and a `knowsAbout` term, so the IT dimension is indexable without contradicting the brand.

---

## 3. What changed

### The Person entity — `matthew-mccluster.html`, `index.html`

- **`disambiguatingDescription`** — schema.org's purpose-built field for precisely this problem. It states the distinguishing facts (born in Bridgeport, founder of McCluster Corp and Equity Uprise, works across CT and GA, carries ORCID and ISNI) and closes by noting he is not the athlete or the comedian who share a similar surname.
- **`sameAs` grew from 5 to 7**, adding **LinkedIn** and **Muso.AI credits**. `sameAs` is the single strongest reconciliation signal available; LinkedIn in particular is one Google leans on heavily for people.
- **`alumniOf`** added — CT State Community College (Housatonic), carrying `alternateName: "Housatonic Community College"` so the older name reconciles too; New Haven Job Corps; Urban Leadership Fellowship. All three were already corroborated by credentials in `data/dossier.json`.
- **`birthPlace`** Bridgeport, and `workLocation` upgraded from bare region codes to named localities (Bridgeport CT, Acworth GA). Local qualifiers are the cheapest way to win the "McCluster + qualifier" queries.
- **`hasOccupation`** extended with IT Support Specialist and Community Organizer; `knowsAbout` extended to cover all four pillars the PDF names.
- **The SoundCloud link was *not* put in `sameAs`.** It is a track URL on another artist's account crediting him as producer — that is a *credit*, not an identity profile, and a wrong `sameAs` weakens reconciliation rather than helping it. It is modeled honestly as a `MusicRecording` with `producer` pointing at the Person `@id`.

### The rendered links now match the schema

The "Find Matthew McCluster" block lists LinkedIn and Muso.AI alongside the
existing profiles, each with `rel="me"`. Structured data *claims* an
identity; a crawlable link that resolves to a profile carrying the same
name is what *corroborates* it. Keep the two lists in step — a profile in
one and not the other makes the claim weaker, not stronger.

### One person, one `@id`

`management.html` was referencing the Person as
the person under the old `here` host while the other seven pages
used the canonical `matthew.mccluster.org` id. That is one human
being described as two graph nodes, which is the exact failure mode this
whole exercise exists to avoid. Now unified — verified: **one Person `@id`
across all 8 pages.**

### The sitemap was missing the identity pages

The most consequential fix in this pass. `sitemap.xml` was scoped years ago
to "the album property," and the side effect was that
**`matthew-mccluster.html` — the page carrying the Person schema, the ORCID
and ISNI identifiers, the proclamations and the credentials — was never
handed to Google at all.** Neither was the press kit that cites it.

Added: `matthew-mccluster.html` (priority 1.0), `press.html`, `card.html`,
`management.html`, `hire.html`, `films.html`, `shots.html`.
`fellowship.html` still stays out for the documented reason — it is an
intake form with no document on it to index — but it now carries a
canonical tag so shared links with tracking parameters stop competing with
the clean URL.

### The new Equity Uprise rooms

`topics.html`, `fellowships.html` and `profile.html` each got
`CollectionPage` + `BreadcrumbList` structured data, Open Graph and Twitter
cards, and `author`/`publisher` pointing at the same two `@id`s the rest of
the house uses. Each also carries one contextual internal link to
`matthew-mccluster.html` with descriptive anchor text. Three new indexable
pages that reinforce the existing entity rather than diluting it.

### A broken internal link, on about a dozen pages

`js/theme.js` rewrote the HITMAN nav tab to a bare `hitman-facility.html`,
so every page under `closet/`, `walls/` and `tracks/` pointed that tab at a
URL that 404s. Broken internal links waste crawl budget and leak link
equity. Now resolves through a relative house root.

That was one of two checks standing red in the repo's own smoke suite
before this pass. The other was the no-long-dash gate on `sites.html`,
failing on an em dash inside the CSS *comment* that `js/masthead.js`
injects into every page — the gate reads `outerHTML`, so injected comment
text counts. Changed to a colon. **The release gate is now green**, which
matters beyond tidiness: a permanently-red check is one everybody learns
to scroll past, and then a real regression arrives and nobody looks.

---

## 4. What only the owner can do

On-site work is done. These are off-site, and several matter more than
anything above.

1. **Google Search Console.** Verify `matthew.mccluster.org`, submit `sitemap.xml`, then request indexing on `matthew-mccluster.html` specifically. Nothing on this list moves faster. (I have no access to your Google account — this one is genuinely yours.)
2. **Make the `sameAs` links point back.** Reconciliation is strongest when it is mutual. On LinkedIn, Instagram, YouTube, TikTok and Muso.AI, set the website field to `https://matthew.mccluster.org/matthew-mccluster.html`. A one-way claim is a claim; a two-way one is corroboration.
3. **Use the same name string everywhere.** "Matthew McCluster" — not "Matt," not "M. McCluster" — in every profile display name and byline. Consistency across properties is what merges them into one entity.
4. **The GitHub profile repository.** The PDF is right about this one. A public repo named exactly `mcclusterishere` with a README describing the IT, media, and civic work is a high-authority page that ranks fast, and it should link to `matthew.mccluster.org/matthew-mccluster.html`. Repository descriptions should be filled in with real keyword-bearing sentences.
5. **Wikidata.** Given the ORCID and ISNI already exist, an item is defensible and is the most direct on-ramp to a Google knowledge panel. Do not write it promotionally, and expect scrutiny — cite the two proclamations and the SSRN paper.
6. **Press citations.** The proclamations and Docket 516 work are the strongest third-party signals available. Local coverage that names "Matthew McCluster" in full text will move the needle more than any further schema.

---

## 5. How to check it worked

- **Rich Results Test** (`search.google.com/test/rich-results`) on `matthew-mccluster.html` and `index.html` — confirms the Person entity parses as intended.
- **Schema Markup Validator** (`validator.schema.org`) — checks the whole graph, including the `@id` references.
- All 22 JSON-LD blocks in the repo parse as valid JSON; every `@id` cross-reference resolves; every sitemap URL exists on disk. Re-check after any edit with the validation snippets in this repo's history, or simply re-run the smoke suite.
- Expect **weeks, not days.** Entity reconciliation is slow, and a knowledge panel — if it comes — follows the Wikidata and press work, not the schema alone.

---

## 6. If you change these files

The `sameAs` array and the rendered "Find Matthew McCluster" link list must
be edited **together**. The Person `@id` must stay
`https://matthew.mccluster.org/#matthew-mccluster` on every page that
mentions him. And nothing goes in `sameAs` that is not a profile page for
this person — credits, mentions and press go in their own properties.
