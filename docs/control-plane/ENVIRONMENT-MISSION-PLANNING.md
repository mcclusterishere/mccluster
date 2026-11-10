# Environmental mission news and sponsor preparation

Local integration, 2026-11-08. No production writes, schema changes, outreach,
publication, deployment or UI acceptance were performed by this implementation.
The parent work owns route/UI integration and aggregate acceptance.

## Authority and findings

- Official source reports remain primary via the existing public environmental
  feed and its source/actionability contract. This adapter never reads Halo pairs.
- `media_news_articles` is the canonical GDELT metadata store. Its `published_at`
  is presented as GDELT seen time. Titles are claims, locations are automated
  mentions, and neither constitutes verification of environmental injustice.
- Existing `newsroom-review.js` approves an author's newsroom post, not imported
  GDELT evidence. Existing `world_news_pairs` is owner-only automatic matching,
  not news review. Neither is reused as an implied approval.
- `ops_recommendations` already has organization, type, rationale, JSON proposed
  action, status and decision timestamp. Its existing schema can hold explicit
  owner context review without another database or a migration.
- Sponsors remain canonical `out_companies`. An exact excerpt from company notes
  supports only an alignment hypothesis. No company fact, contact, consent,
  partnership, recipient, campaign or send outcome is inferred.

Read authorities: AGENTS.md, CODEX.md, AI-HARNESS.md, CAPABILITY-REGISTRY.md,
WORLD-ENVIRONMENT.md, WORLD-ENVIRONMENT-CONTRACT.md, PRIVATE-NEWS-CONTEXT.md,
OUTREACH-CRM-INVARIANT.md. DDL inspected in the media-news namespace and GKG
migrations, `supabase/replay_migrations/0065_outreach_engine_core.sql`, and
`20261028230000_schema_reconcile_production_only_v1.sql`.

## Interfaces and owner controls

`workers/mccluster/src/environment-mission-planning.js` exports pure
`environmentNewsRevision(article)`, `prepareEnvironmentMission(input)` and
`prepareEnvironmentSponsorDraft(input)`, and an injected
`createEnvironmentPlanningService({authorizeOwner,repository,now})`.
Pure helpers are not an authorization boundary and must never consume client
assertions about canonical rows or reviews.

`workers/mccluster/src/environment-planning-mccluster.js` exports
`createMcClusterEnvironmentPlanning({request,env,readEvent,fetchImpl,now})`.
`readEvent(eventId)` must return the current normalized canonical public event,
not a client event. The adapter reuses bearer authentication, `isHouseOwner`,
service reads and the configured canonical Supabase connection. It returns:

- `context({eventId,actionId})`: current candidate headlines with exact SHA-256
  metadata revisions, plus `reviewed` entries including canonical `review_id`.
  At most 100 latest retained headlines from the past 24 hours, explicitly
  limited and not asserted to be geographically relevant. No body download.
- `review({eventId,actionId,articleId,revision,headlineExcerpt,rationale})`:
  re-fetches rows, validates exact revision and headline substring, checks source
  currency and owner permission, then writes one `ops_recommendations` record.
  Returns `{ok,review_id,article_id,revision,scope}` only after confirmed save.
- `plan({eventId,actionId})`: official-source-backed remote mission preview with
  reviewed news claims. No mission save/open or fabricated completion state.
- `companies({eventId,actionId})`: up to 50 same-org canonical companies, excluding
  declined/unknown status and missing notes. Returns candidates with company_id,
  name, alignmentExcerpt and matched_terms. Ordering is deterministic exact-word
  overlap with reviewed headlines/mission title, not an AI score or established
  fit. The exact notes excerpt can be passed directly to sponsorDraft. Company
  notes may have multiple lines; one bounded exact line is retained. The bounded
  alphabetic company pool is not a claim of exhaustive sponsor discovery.
- `sponsorDraft({eventId,actionId,companyId,alignmentExcerpt})`: same-org CRM
  lookup and exact notes evidence produce a private draft with citations and
  explicit gates. Drafts include at most three complete citations and never exceed
  12,000 characters; citation_total/citation_included/citation_limitation disclose
  omissions. The owner-verification paragraph quotes exact internal CRM notes
  without presenting them as verified public facts. Normal newline/tab prose is
  accepted for review rationale and CRM notes/excerpts; other controls fail closed.
  No draft is placed in an external mailbox or CRM campaign.
- `approvedContext({eventId,reviewId,actionId='resource-check'})`: owner-gated
  revalidation for proposal integration. Returns null for absent, revoked,
  changed, stale or expired evidence. Returns only public-safe article/title/URL,
  seen time, revision, attribution and notice; never reviewer identity, private
  rationale, company notes or operational metadata. Pass the actual actionId.

All route methods are owner-only, not merely signed-in/admin. API routes should
send private/no-store responses and map `ENVIRONMENT_PLANNING_ERROR_CODES` plus
`.code/.status` to their standard safe error handling. `approvedContext` is an
internal owner-gated method; do not use it as a public read endpoint. Member
mission proposals without a news review remain the existing unchanged flow.

## Stored context review contract

An explicit review writes recommendation_type `environment_news_context`,
status `approved`, org_id from authenticated house ownership, decided_at from
server time. The insert omits confidence so the canonical NOT NULL default of
0.5000 applies. proposed_action.confidence_basis explicitly labels that value as
an uncalibrated database default, not a model score. The proposed_action JSON
contains schema `environment-news-context/v1`, event_id, article_id,
article_revision, exact headline_excerpt, reviewer_id, retained metadata snapshot
and scope `news_context_only_not_mission_or_outreach_approval`.

This is approval of headline context only. It is not a mission approval, send
permission, finding of injustice or licensed-article-body permission. Every read
checks the reviewer is still a canonical house owner, the review belongs to this
organization/event, the retained article revision matches, and both news and
review are within 24 hours. Retained GDELT rows can be pruned; missing rows fail
closed. Rejected or otherwise non-approved records never qualify.

No SQL is required for local implementation. Production acceptance must verify
these existing columns and service-role permissions rather than applying a new
schema. Review inserts are append-only decisions; a repeated explicit review
can create another row, not a deduplication or transactional-idempotency claim.
Use the existing canonical recommendation status controls for revocation. No
new standalone review table, localStorage ledger or grant was added.

Proposal integration should call approvedContext immediately before canonical
world_environment_propose and attach only its public-safe result to the immutable
source snapshot. If a supplied review ID fails revalidation, fail the request
rather than silently implying news-backed approval. The parent owns validating
that SQL preserves this new optional snapshot field and concurrency/reload tests.

## Verification and boundaries

Run from workers/mccluster:

```
node --import ./test/support/offline-network.mjs --test test/environment-mission-planning.test.mjs test/environment-planning-mccluster.test.mjs
```

36 focused offline tests pass. The isolated PGlite rehearsal at
`scripts/test-environment-planning-pglite.mjs` also passes using verbatim canonical
ops_recommendations and out_companies CREATE TABLE statements. It tests the real
review insert/reload, non-null confidence default, actual company statuses and
fields, and rejection of the former explicit-null confidence bug. Title, rationale,
status and recommendation_type are unbounded text in that DDL; statuses/types are
restricted by this application contract, not an invented database CHECK. Tests cover official-source primacy, exact metadata
and excerpt review, daily freshness, unknown/malformed data, cross-org refusal,
source expiry, safe remote action scope, input immutability, missing reviewer,
owner rejection before private reads, mocked canonical write and reload, changed
news, revoked review, write failure, safe immutable attribution, CRM alignment,
no fabricated recipient/consent/partnership and typed failures. All HTTP calls
are injected mocks. These are not production RLS, concurrent SQL or browser tests.

No sender or scheduler is implemented. Future outreach requires a verified
recipient and applicable explicit approval; all organized sends must preserve
canonical out_campaigns/out_recipients/out_events provider linkage before they
are considered complete. A proposal or draft never establishes a partnership.
