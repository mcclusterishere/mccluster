# File a public comment: the adapter

Mission `7cfac26a-…` "File a public comment" (open). Owner, 2026-10-15: integrate
Regulations.gov and the Federal Register so members pick what to comment on through the platform.

**Rule: the platform never files a comment for anyone.** The member drafts here, then files it
themselves on the official form. The tracking number the form gives them is their proof.

## Shipped here (read only, off by default)

`workers/mccluster/src/public-comment.js`, wired in `src/index.js`:

| Route | Who | What |
| --- | --- | --- |
| `GET /v1/public-comment/open?agency=EPA&agency_slug=…&q=…&state=CT` | signed-in members | open proposed rules from both sources, merged, soonest deadline first |
| `POST /v1/public-comment/handoff` `{comment_url, text}` | signed-in members | checks the draft against the official limit (5,000 characters), warns on emoji, returns the official form link; stores and sends nothing |

- Flag: `PUBLIC_COMMENT_LISTING_ENABLED` (wrangler `[vars]`, `"false"`). Anything but `"true"` → 404.
- Secret: `REGULATIONS_GOV_API_KEY` (an api.data.gov key; `wrangler secret put`). Without it the
  Regulations.gov half reports `not_configured`; the Federal Register half still answers.
- A failing source reports `error`, never a count of zero; both failing → 502, nothing cached.
  Good answers are cached 15 minutes per query, so the provider sees one request per window.
- "State" is a words match ("mentions Connecticut"), not a jurisdiction claim. Neither API filters
  federal proposed rules by state.
- Tests use synthetic fixtures shaped after each documented response
  (`workers/mccluster/test/fixtures/public-comment/`). A live call could not be made from this
  environment (Federal Register answered 403 to this IP; Regulations.gov `DEMO_KEY` answered 429),
  so field names are from documentation, not from a live response.

Not shipped: the member UI (pick a docket, draft, open the form), and any posting.

## Sources, terms and limits

**Regulations.gov API v4** (GSA), <https://open.gsa.gov/api/regulationsgov/> and its OpenAPI
document <https://open.gsa.gov/api/regulationsgov/v4/openapi.yaml> (read 2026-10-15):
- base `https://api.regulations.gov/v4`; `GET /documents`, `/dockets`, `/comments`;
- key from api.data.gov in `X-Api-Key`; `DEMO_KEY` is for demonstration only;
- `filter[withinCommentPeriod]=true` ("documents that are open for comment"; `false` is not
  accepted, omit it instead), `filter[agencyId]`, `filter[documentType]` (Notice, Rule, Proposed
  Rule, Supporting & Related Material, Other), `filter[searchTerm]`, `filter[commentEndDate][ge|le]`,
  `sort=commentEndDate`, `page[size]` 5–250, `page[number]` 1–20; documents carry `openForComment`,
  `commentEndDate`, `docketId`, `frDocNum`;
- GET limits follow api.data.gov: **1,000 requests an hour** by default; `DEMO_KEY` 30 an hour and
  50 a day per IP (<https://api.data.gov/docs/developer-manual/>). GSA may raise GET limits on request.
- **Posting (`POST /v4/comments`)**: needs a separate commenting key, approved after an
  organization/entity validation through the Help Desk; limited to **50 requests a minute and 500
  an hour**, not raisable; the key holder must link to the terms of participation
  (<https://www.regulations.gov/user-notice>) and privacy notice, and certifies that comments are
  lawfully gathered and represent real persons, with no fabricated or misappropriated identities;
  keys can be disabled; agencies must approve API comments before they appear; individuals need
  first and last name; 5,000 characters; emoji invalid.

**Federal Register API v1** (<https://www.federalregister.gov/developers/documentation/api/v1>):
no API key. `GET /api/v1/documents.json` with `conditions[type][]=PRORULE`,
`conditions[agencies][]=<slug>`, `conditions[term]=…`, `fields[]=…`. `comments_close_on` can be
empty, so the adapter keeps only documents whose deadline is today or later. The adapter also
sends `conditions[comment_date][gte]` (UNVERIFIED against a live response; the code filter is what
decides). No published rate limit was found; be polite and cache.

## Why the default is a deep link, not the posting API

1. The posting key requires McCluster Corp to pass GSA validation and accept certification duties
   for every comment it relays.
2. A relayed comment is the platform speaking for a person. The owner's rule is explicit consent;
   the safest consent is the person pressing submit on the government's own form.
3. Agencies review API comments before they appear, so the member gets no immediate proof; the
   official form's tracking number is better proof for the mission review.

If the owner later wants posting: a separate PR, a GSA commenting key, a per-comment consent record
(the exact text, the docket, the name used, the time), the terms and privacy links on the form, and
no batching. Mission completion still needs an admin to verify the proof.

## To turn it on

1. Get an api.data.gov key; `wrangler secret put REGULATIONS_GOV_API_KEY` on Worker `mccluster`.
2. Set `PUBLIC_COMMENT_LISTING_ENABLED = "true"` in `workers/mccluster/wrangler.toml` and deploy.
3. Build the member UI on the two routes.
