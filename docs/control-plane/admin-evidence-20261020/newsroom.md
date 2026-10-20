# W05 newsroom hardening evidence

Implementation date: 2026-10-20. Base: `e9d8604988496783fa25f4c450bd49fec69ba476`, after merged PRs 558/559. This is local implementation and synthetic integration evidence. No production writes, deployment, publication, migration, publisher submission or partner outreach occurred.

## Authority and delta

The existing Worker, Core `local_analysis`, `ops_agent_jobs`, native `network_posts`, and `network_scheduled_posts` remain authoritative. There is no new database, scheduler, newsroom, auth system, paid inference path, or frontend shell. No new SQL migration is required for these changes. Existing grants and the unique `network_posts.scheduled_post_id` fence are retained.

| Existing contract | Narrow change |
| --- | --- |
| `ops_agent_jobs` primary key | Deterministic edition ID derived from organization, report date, ISO country, editorial timezone and edition version 2; insertion ignores a primary-key conflict and reads the existing row. |
| Job `input` JSON | Frozen numbered source snapshot, desk/timezone/language, discovery window, seed timestamp, coverage bounds/caps. |
| Job `output` JSON | Strict validated draft with `editorial_status:needs_review`; no-coverage receipts have no analysis. |
| `/v1/news-briefs` | Adds window, timezone, coverage, deadline, late, editorial status and validation; retains existing sections and role filtering. |
| `/v1/news-briefs/request` | Same frozen edition on replay; a failed edition returns 409 and directs review of the existing bounded job. `again` cannot silently replace its evidence. |
| `/v1/mnet/posts` and existing schedule | Server-issued review metadata binds the current text, public visibility, group/reply scope, note and sources to the authenticated owner. Duplicate requests converge. |
| Existing native-post PATCH | An ordinary body/visibility edit invalidates review. Explicit owner PATCH with `newsroom:true` approves the exact resulting revision. |
| `/news/`, RSS, sitemap | Require current owner authority, live native post and matching review. Unreviewed edited/withdrawn/private articles are 410; revoked/non-owner sources remain 404. Responses use `no-store`. |

Owner: all briefing desks, grant management, newsroom publication. Region leader: read/request only granted countries. Other signed-in members and guests: denied briefing access. Public readers: only currently authorized, live, reviewed newsroom articles. This change does not grant country leaders public-newsroom publication rights. The pending `supabase/pending/20261020170000_news_region_leads.sql` remains a promotion prerequisite for region leaders; the live migration ledger was not changed or asserted verified by this work.

## Edition and source behavior

US uses `America/New_York`. Defaults for GB, KE, NG and FR are `Europe/London`, `Africa/Nairobi`, `Africa/Lagos` and `Europe/Paris`. Other desks explicitly report `UTC` and `timezone_basis:default_utc_desk`; an operator must choose an appropriate editorial desk before claiming local-national coverage. `NEWS_BRIEF_DESKS` can supply JSON such as `{"KE":"Africa/Nairobi","AU":{"timezone":"Australia/Sydney"}}`. US stays pinned to New York. Invalid zones fail configuration. Countries spanning several zones still have one declared editorial desk; this is not a claim of a single national timezone.

Each desk covers its previous local calendar day with a half-open UTC window. It becomes eligible after 00:20 local. Deadline is 07:00 local the following day; tests cover New York's 23/25-hour DST days and London's 25-hour day. Late completion is measured from the durable job update time, not when someone opens the card. A queued/running overdue job stays queued/running and late; it is not a delivered draft. The snapshot is frozen at enqueue. Late-arriving source records do not rewrite it. A separately reviewed future edition/correction is required; no automatic correction edition generator was added.

The US job has priority 95 in both the existing job queue and local inference request. Maximum attempts remains 2. Cron processes US, configured countries, granted countries, then bounded busy desks (at most 40 planned desks per invocation). Each successful or no-coverage desk has a durable job receipt. Per-run receipts distinguish `queued`, `existing`, `no_coverage`, `coverage_incomplete`, `too_early`, and `enqueue_failed`; a partial failure does not suppress subsequent desks or next-run repair. Incomplete/new no-coverage reports are logged by the existing cron hook. There is no persisted aggregate seed transaction: successful individual rows survive, and missing identities are recomputed. `complete` describes that invocation's seed plan, not model completion or publication.

The query is restricted to existing `gdelt_gkg_v2` rows. It scans at most 30,000 retained rows and samples at most 80 headlines per desk. Caps and sampling are exposed. Existing country classification is automated place matching; it is not verified event geography. Existing story-key/title deduplication is retained and is not proof of independent corroboration. Language scope remains English only. No article body is downloaded; model input excludes outbound URLs.

The legacy `published_at` value is projected as `discovered_at` with `time_basis:discovery`; publisher `published_at` and event `observed_at` are null. `retrieved_at` is the store's `imported_at` when present. Native record/source IDs survive in the job snapshot. A successful store query reports `store_read_ok` and explicitly `upstream_health_unverified`. No usable rows after a complete scan means only `no_coverage`. A capped scan with no retained rows for a desk instead emits retryable `coverage_incomplete`, makes the run incomplete, and inserts no frozen job; a later scan or country request can recover that desk. A country-scoped request also returns 503 for an incomplete empty scan. A source read error cannot become an empty completed edition.

## Validation and review

News output must be JSON with exactly `summary`, `findings`, `assumptions`, `next_actions`, `support`. Bounds: summary 1,200 characters; 1–8 findings, 1–4 assumptions, 0–6 conditional implications, each at most 600 characters; at most 32 support anchors. Summary/findings/implications cite allowed numbered sources. Every finding needs a cited exact headline substring. Evidence must match the job's country/date and supplied country/time windows. Malformed JSON, free text, fenced JSON, unknown keys, unknown citation IDs, missing support and out-of-window/country sources fail validation. Ordinary non-news local analysis retains its existing fallback contract.

This is a structural and source-resolution check, **not semantic fact verification**. An exact substring can still fail to support a claim. The output explicitly says `support_status:requires_human_review` and `publication_authorized:false`. The reader shows a draft requiring human review. Unsupported assertions, contradictions, economic forecast horizons and alternative scenarios still require editorial judgment. There is no automatic `ready` or verified-truth state. Legacy completed jobs are `unvalidated_legacy`.

The native-post review receipt contains schema/version, approved state, SHA-256 of the rendered content inputs, reviewer M UID and review timestamp. Client metadata cannot smuggle in the receipt. Public rendering recomputes the hash, so even an out-of-band body/source edit that preserves old metadata fails. Same-content explicit re-review preserves the revision hash but records the current review action. Publication IDs derive from actor+revision; scheduled IDs also include normalized publish time. Cancelled/withdrawn requests cannot be resurrected through replay. Scheduled publication rechecks the claimed current payload and the current owner grant, and uses the existing unique scheduled-post fence.

The receipt holds only the latest native-post review. It is not an append-only editorial history, a reviewed Intel briefing, or a guarantee of independent editorial adjudication. Creating the required `intel_briefings`/claim-review links to execution and native post is outstanding. No second authority was invented to imply that work is complete.

## GDELT verification and external status

Official sources checked on 2026-10-20:

- [GDELT About, contact and terms](https://www.gdeltproject.org/about.html): project datasets require GDELT attribution/link when redistributed. Its general contact guidance does not establish publisher acceptance or guaranteed inclusion. No contact was sent.
- [DOC 2.0 API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): documents exact-domain queries (`domainis:`), useful for later observed indexing checks. No observation of a McCluster article in GDELT was made.
- [GKG v2.1 codebook](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf): distinguishes batch record IDs and document/date metadata. The repository's ingestion meaning is treated conservatively as discovery, not an independently checked publisher/event timestamp.

The existing canonical pages, NewsArticle data, RSS and sitemap remain discoverable outputs. They do not prove GDELT indexing. Searches did not establish a current official self-service publisher inclusion contract. Indexing is unconfirmed until an external record naming an exact canonical URL is observed and retained. Original reporting and any additional source licenses/languages require separate evidence; GDELT dataset terms do not establish rights to copy publishers' full articles.

## Verification and promotion

Local command:

```sh
node --test core/test/news-brief-validation.test.mjs workers/mccluster/test/news-brief-resilience.test.mjs workers/mccluster/test/newsroom-review.test.mjs workers/mccluster/test/news-briefs.test.mjs workers/mccluster/test/newsroom.test.mjs workers/mccluster/test/mnet-scheduled.test.mjs scripts/test/news-brief-page.test.mjs
```

Result: **59 passed, 0 failed**. Tests execute real handlers/executor against controlled synthetic storage/model fixtures. They cover failure after US succeeds and subsequent recovery, missing-desk recovery after scan truncation, retryable incomplete country requests, concurrent edition and publication requests, DST, caps, time semantics, model invalid citations/excerpts, normal edits and unchanged-content re-review, clearing reviewed sources/notes, out-of-band content/source edits preserving old approval, revoked grants, private/withdrawn articles, stale scheduled snapshots, cancelled/lost claims, and source/model failure. No live-model quality, hardware throughput, production permissions, browser screenshot equivalence, migration ledger, or 07:00 delivery SLO was measured here.

Promotion prerequisites:

1. Review the exact combined diff and deploy coordinated Core/Worker versions; a legacy executor must not consume new jobs while still accepting free text. Keep new seeding disabled during an incompatible mixed-version rollout.
2. Inventory existing articles/schedules and review their exact current content. **Legacy articles without a bound receipt become 410 and legacy newsroom schedules fail review.** Re-review each retained article through authenticated owner PATCH with `newsroom:true`; do not bulk stamp inferred approval. Existing API supports this, but no additional migration UI was added. Reschedule legacy scheduled content through the existing reviewed request path.
3. Verify active owner/region grants, pending table ledger and chosen desk zones. Test current production source/provider health, actual Core model output and the US deadline under representative queue load.
4. Account for pre-deployment cached articles; new `no-store` responses cannot invalidate a previously cached copy by themselves. Use the existing authorized purge mechanism when promoting if needed.

Rollback should disable seeding and preserve receipt metadata/evidence. Reverting the renderer to code that accepts metadata-only approval would reopen unreviewed articles; do not use that as a safety rollback. Reverting only the executor while seeding new editions is also incompatible. No rollout or rollback was executed.

Remaining measured-work gaps: every cron invocation still performs a bounded discovery scan; repeated-scan costs and runtime payload/context limits need representative measurements before efficiency/SLO claims. There is no expanded licensed/local-language source ingestion, full claim contradiction adjudication, append-only correction history, Intel briefing linkage, country-leader publication grant model, independent article indexing receipt, or real community intervention outcome. A queued job, an article view, a scheduled post or a completed mission alone is not verified community impact. Named partners, their authority, baseline/intervention/observation period and independently reviewed outcomes remain external prerequisites, not fabricated fixtures.
