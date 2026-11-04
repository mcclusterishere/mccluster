# Character commenting: evidence, previews and bounded coverage

Status: implementation for branch review, 2026-11-02. No deployment, production SQL, new character accounts, live cap changes, timer changes or broad backfill accompanies this work. This extends the existing Core actor engine and local Qwen adapter. It does not create a separate scheduler, memory store, backend, paid fallback or model-training pipeline.

## What changes

`core/src/executors/actor-news-comment.mjs` keeps the existing actor lookup, rolling daily cap, job receipt replay and atomic publication RPC. Generation uses the shared evidence/preview pipeline, but **v3 cannot authorize new publication**: every candidate has `publication_eligible:false` and `review.approved:false`, including candidates approved by the model. The legacy executor records `review_withheld`; a model verdict is never treated as owner approval. Deploying this branch would suspend new automatic news comments until a separately reviewed publication gate exists. The deployed runtime, SQL, caps and timers are unchanged by this branch push. An additional source read still detects changes during inference; transactional source-version comparison remains a requirement before broader publication.

`actor_comment_preview` is a separate registered Core executor. It reads a canonical item reference and an existing actor, then returns a proposal. It has no publication dependency and ignores caller-provided content, grants, persona overrides and publish flags. A paused actor can be inspected without enabling it. No production timer enqueues this new job type.

The public news-comments API now returns `actor.is_ai` and fails closed if actor identity lookup fails. The shared discussion renderer shows **AI character** beside the name, with an operator explanation. The name remains **Royce** when that is the stored display name. It does not depend on a profile bio or a renamed display name for disclosure.

## Evidence contract

`core/src/actors/evidence.mjs` produces `actor-evidence/v2`:

- Canonical `kind`, item ID, revision, URL, separate publisher/discovery/update dates, capture time and explicit unknowns.
- Access level `full`, `partial`, `headline` or `unavailable`, with a reason. `full_text_received` and `full_text_in_context` refer specifically to complete publisher article text; song lyrics and posts have their own source types.
- Stable source IDs, full-content SHA-256, context SHA-256, original source byte count, source type, attribution, grant and observed time. Source IDs survive prompt-budget changes while context hashes show exactly what was included. Reply hashes cover the complete original body before the 600-byte reply context cap: a tail-only edit changes source identity even when the visible prefix is unchanged. Per-source `truncated` and UTF-8 byte counts describe the actual clipping.
- At most 6,000 UTF-8 bytes of source text, reduced further when prompt framing/persona/history consumes the context budget. Clipped article, lyric or post bodies become `partial`; reply entries independently report truncation. The pipeline conservatively bounds serialized prompt bytes and reserves completion/framing space; it withholds if it cannot fit. It does not silently call a truncated article a full read.

News uses the existing native-reader permission policy unchanged. Its single implementation now lives under `core/src/actors/news-reader-policy.mjs` so standalone OVH installation includes it; the Worker re-exports it. The production approved-grant list remains empty. Article payloads cannot grant themselves permission. Authorized full or partial `text_blocks` require a current matching grant, an approved adapter and attribution. There is no arbitrary URL fetch, paywall workaround, publisher HTML execution or rights inference from public availability.

Current canonical news loading still has discovery metadata only. Full-text ingestion is **not** now available in production; until publisher authorization and a reviewed content adapter exist, previews truthfully use headlines or abstain. A GDELT `published_at` is recorded as discovery time, never assumed to be publisher time.

Songs distinguish catalog fields from revision-matched, explicitly authorized lyrics. A text-only Qwen pass never sets `audio_observed`, even if a caller supplies an audio URL or an `audio_observed` claim. No audio is fetched. Canonical song preview currently reads active `music_catalog_objects`; an authorized lyrics adapter must supply versioned text before lyric analysis is available there.

Post preview reads a public, non-group, non-deleted canonical post and the latest six comments. It respects both block directions for the actor and excludes blocked authors. Posts and replies remain attributed statements, not independently verified news. Private/network/group posts are excluded. The pure snapshot builder also rejects private/deleted replies.

The job output stores a receipt with hashes and metadata rather than a second copy of the full article. Bounded evidence quotes accompany a proposal needing owner review in the private existing job output. Never commit runtime inputs or model transcripts to Git.

## Generation and review

The existing loopback `localAiChat` remains the only default inference path. Suggested initial settings are explicit and unbenchmarked: context 8,192; generation 480 tokens at temperature 0.55; review 640 tokens at temperature 0; thinking off; priority -30; 120-second timeout for each call. The adapter retains its existing serialization/priority policy. Missing runtime, malformed JSON, output truncation, unusable evidence or failed review produces a withheld result. There is no remote fallback or repair loop.

The prompt contract is `actor-grounded/v3`. Generation must return an item ID, `comment` or `abstain`, exact source-quote anchors, and consecutive claim units covering the entire comment. Available article/post/lyric text must be used rather than just a title. Headline/catalog context abstains before inference by default. Explicit `thin_context_mode:question_preview` permits private evaluation of open questions or hypothetical conditions, with no publication eligibility. Deterministic checks flag formatting/abuse, false firsthand identity, unobserved audio, overstated reading, invented numbers, unsupported recency, known generalizations and presuppositions, copied comments and text without an evidence connection. These patterns do not establish semantic reliability.

The separate adversarial review is asked to assess unsupported implications as well as explicit claims. Its structural contract requires grounding, relevance and voice judgments, an explanation, valid source anchors and a verdict for every claim unit. A bare `{approved:true}` is insufficient. Each claim audit preserves the exact text, model-proposed kind, source/context hashes and matched quote, while marking `entailment:unverified`. Quote matching is structural provenance only. Even a fully conforming positive model verdict produces `needs_owner_review`, `review.approved:false`, `review.model_approved:true` and `semantic_gate:not_validated`; it does not establish human approval or factual correctness. Completion evidence rejects attempts to promote this output to approved or publication-eligible.

Owner-run prompt-level calibration of the local Qwen reviewer failed an unsupported-behavior negative control: it returned a positive verdict despite the missing evidence. That calibration used the owner chat interface, not the exact current v3 Core roles/settings, so it neither measures v3 performance nor proves improvement. Raw transcripts remain in private canonical records. Tests deliberately allow a mocked reviewer to approve unsupported paraphrases and verify that publication remains blocked. Unit tests establish contracts and known regressions, not general semantic reliability, entertaining prose or model quality. Owner-scored OVH samples and a validated publication policy are required before any rollout.

Each proposal includes source/persona/prompt hashes, requested and returned settings, separate generation/review elapsed times, reported model, implementation, queue wait and usage when exposed. An adapter default model name is distinguished from a reported runtime model. Unexposed digest/token/settings fields remain null. CLI diagnostics separately capture installed model digest and Ollama version when available.

## Cast and owner editing

Only the explicitly selected **adaptation cast**, which may span PRIM3 and Hitman, belongs in expanded coverage. No broad Hitman roster is assumed. Canon/story editing belongs to the separate canon task. This branch makes no claim about unverified characters or the story's employer/founder relationships.

The authoritative source is the separate **`mcclusterishere/Prim3` repository**, pinned for this review at `160020bdeac4afa0cd3f25638169e657af55bc29`; the empty local `PRIM3/game/halo/world-roster.v1.json` is not the source roster. `core/config/actor-canon-sources.json` records public source paths, versions, statuses, blob hashes and pinned links for root `CANON.md`, the immediate cast, Hitman dossiers, psychology authority and Aya's specialist authority. `story/PRIM3-CHARACTER-DOSSIERS.md` is explicitly **PROPOSED** and cannot authorize a persona. Specialist canon overrides short summaries where non-conflicting. Writer truth is not permission to disclose lore in a public comment.

The final adaptation subset and its account approvals remain pending in the separate canon workflow. The known immediate-story roster is **not** selected wholesale. `core/config/actor-personas.example.json` therefore retains empty `characters` and `selected_cast`. No extra contemporary Benji identity is created: the pinned canon identifies Benji as McCluster's historical identity. Existing unversioned actor personas are reported as `not_reconciled`, with null canon version and no invented source references. Their old biography text is excluded from prompts pending reconciliation; stored conversational voice/motivation can still serve private evaluation under the existing actor row. It does not overcome the v3 publication hold.

New configuration uses `actor-persona/v1`, an immutable config version, explicit `selected_cast`, and character records containing:

- Existing `actor_key`, unchanged display name and `identity_kind: fictional_ai`.
- `identity_status: pending | approved | rejected`, plus an approval reference for approved identities.
- A canon version/status, versioned source references with explicit source statuses, and canon approval reference. Approved identities require verified canon and CANON, CANON-AUTHORING-AUTHORITY or OWNER_APPROVED sources; PROPOSED sources cannot qualify.
- Separate voice perspective, rhythm, humor and motivation; topical affinities and allowed own-platform surfaces.

Identical voice configurations are rejected. The pinned sources distinguish, for example, Royce's control/legitimacy sensitivity from Aya's evidence/safety focus and economical humor; those differences inform owner-authored voice records only after adaptation selection, not automatic account creation. Source references must be verified by the canon/owner workflow; validation checks their presence, not their truth. No model can approve an identity or manufacture a roster. Fictional foreign-influence plots and other story missions never become real commenting-campaign goals. The coverage policy accepts only ordinary own-platform commentary and rejects campaign objectives and audience targeting; generation/review prompts separately enforce that boundary.

Store each approved record on the **existing** `ops_platform_actors.persona.commenting` object:

```json
{
  "config_version": "the-reviewed-cast-version",
  "selected": false,
  "character": "the validated character record described above"
}
```

The string above is explanatory, not a usable record. `personaConfigFromActors` assembles a view of these existing rows, checks matching actor keys and requires consistent config versions. Selection, account approval and surface approval remain separate checks. This change performs no actor updates or identity provisioning. Coverage jobs pin config version, character digest and prompt version. Missing/changed persona config is withheld instead of silently reverting to Royce or a default personality. A supplied prompt version must exactly match the deployed contract; a mismatch, including an empty or null value, returns `prompt_version_mismatch` before source reads or inference. Manual previews may omit the expected prompt version and record the actual one; that is not a version pin.

## Coverage and proposed Control contract

`core/src/actors/coverage.mjs` is a **pure planner**, default disabled. It prepares descriptors for the existing `enqueueJob`/`ops_agent_jobs` contract. It never submits jobs itself. Both a future canonical creation signal and scheduled reconciliation can feed the same planner; no live triggers are installed here.

Proposed initial preview-only budgets: 3 proposals per batch, 6 pending, 12 per rolling day across the selected cast, 3 per actor/day, 2 queue attempts, 100 input records per page, no backfill. These are testable proposal limits, not measured daily capacity or production publication limits. A bounded backfill requires an explicit start date and item budget at most 100. The existing publication limit and six-hour seeding timer remain unchanged.

The planner rotates news/song/post surfaces, processes oldest eligible items within each surface, picks one relevant approved selected persona, and balances actor counts. Stable UUID job IDs depend on organization + surface + canonical item, not actor/config version; cast changes cannot create a fresh automatic job for the same item. Existing queued/completed/failed jobs suppress duplicate plans. Retry-exhausted items remain visible for owner action. Deferred capacity-limited work is not advanced past in the proposed checkpoint.

Checkpoints contain per-surface `(timestamp,id)`, next surface and scanned count. Persist them only together with accepted existing-queue work in an existing orchestration job's input/output; do not persist a proposed checkpoint before enqueue succeeds. A withheld preview is not successful published coverage. `coverageStatus` projects job outcomes/review/metrics for the owner and keeps withheld, pending, needs-owner-review and published outcomes distinct.

**All plans return `dispatchable:false`.** Stable IDs prevent duplicate queue records via the existing upsert, but a pure snapshot cannot enforce shared daily/backlog caps across independent dispatchers. Before automatic scheduling, the existing data plane needs one atomic budget reservation + enqueue + checkpoint transaction. Before multi-character publication it also needs item-wide uniqueness and source/persona-version comparison in the atomic publication boundary. Existing SQL only provides per-actor article uniqueness and job replay. No new SQL or security policy is introduced here.

Suggested owner Control integration, within existing owner authorization and existing job tools, not a new public API:

| Operation | Input | Result |
| --- | --- | --- |
| Preview one item | `actor_comment_preview`, existing actor key, `input:{kind,item_id,expected_revision,prompt_version,thin_context_mode}` | Private `published:false`, `publication_eligible:false` proposal or explicit withheld reason |
| Edit a persona | Existing actor's `persona.commenting`, validated against reviewed canon and expected prior config version | Versioned record; no account creation or automatic activation |
| Review coverage | Existing preview jobs, source access/unknowns, selected-cast config and bounded load snapshot | Planned/deferred/withheld/needs-owner-review counts, checkpoints, metrics and per-item reasons |
| Review a proposal | Comment, separate AI badge, actual included evidence, source/version hashes, reviewer findings | Owner decision stored with existing job/recommendation evidence; preview is never promoted by a `publish:true` flag |
| Enable a rollout | Concrete reviewed cast, source grants, global/per-actor caps, stop controls, runtime benchmark and atomic dispatch/publication contracts | Separate release decision; not implemented or authorized by a preview |

No Control/studio redesign is included. Integration hotspots outside Core are limited to `platform-api.js` (response field and strict news-identity lookup), `news-reader-policy.js` (shared-policy re-export), and `js/mnet.js` (one disclosure badge).

## Bounded OVH proof

No local adapter is listening in the implementation workspace: a read-only request to `http://127.0.0.1:4790/diagnostics` returned `ECONNREFUSED`. No model generations, publication jobs or OVH changes were attempted from this workspace. All test responses are synthetic mocks, not claimed Qwen samples.

`core/test/fixtures/actor-preview-batch.json` contains six synthetic **inputs only**: authorized full news text, neutral headline-only news, a public post/thread, authorized lyrics, article prompt injection and unavailable private content. Example-domain grants cover only those synthetic strings. They are not real source licenses, real character approvals or generated outputs.

After the parent has authorized access to the exact reviewed branch in an isolated OVH checkout, run the preview CLI on loopback, writing results to private storage outside Git:

```sh
cd /path/to/reviewed-checkout/core
node src/actor-preview-cli.mjs --local test/fixtures/actor-preview-batch.json > /private/path/actor-preview-results.jsonl
```

The preview CLI requires explicit `--local`, limits each batch to six sequential samples and has no publication imports. Start with a private two-sample copy if load warrants. Its headline fixture explicitly selects question-preview mode; ordinary headline jobs still abstain by default. Use the isolated preview CLI for calibration, not the seed script, runner or deployed legacy news executor. The v3 branch holds new news publication, but the older deployed executor can still publish.

`core/test/fixtures/actor-review-adversarial.json` contains 18 synthetic unsupported-claim/presupposition candidates and three open-question/hypothetical controls. They are evaluation inputs, not model outputs or successful examples. The review-only CLI calls the same Core review function, roles and settings even when deterministic checks flag a candidate, so regex coverage cannot hide a weak model reviewer. Expected labels are excluded from the model prompt.

```sh
node src/actor-review-eval-cli.mjs --local test/fixtures/actor-review-adversarial.json 0 2 > /private/path/actor-review-results-0.jsonl
```

Arguments are a zero-based offset and batch limit (default 2, maximum 6), with sequential calls. Advance the offset only after examining the private results and runtime load. The output separates deterministic issues, the raw advisory verdict, model metrics, source/claim provenance and `false_approval`. That field measures a raw positive verdict on an expected-reject fixture; it is not a complete accuracy score or publication decision. Failed calls have `false_approval:null` and must not be counted as correct rejections. Inspect malformed verdicts separately, measure false rejections on positive controls, and report case counts with every aggregate. This tool does not run generation or fabricate generation metrics.

Record exact commit, fixture/version hashes, reported model + installed digest/Ollama version, returned context/output settings, generation/review/queue timings and token counts where exposed. Score useful source-specific detail, conversational quality, individual voice, unsupported assertions/implications, identity honesty, abstention and repeat rate. Repeat on a small approved actual cast subset once canon is reconciled; synthetic voices cannot prove cast authenticity. Keep raw outputs private and share only an intentionally safe aggregate.

Acceptance before increased live volume: no false personal/audio/full-reading claims; all injected/unsupported negative-control proposals withheld; every accepted factual assertion traceable; no accidental publication or duplicate item; correct character identity; owner-rated useful/non-generic prose. Measure ordinary interactive-queue contention and both cold/warm samples before selecting budgets. Polling intervals are not exact latency, and a small batch is not guaranteed daily throughput. If quality or capacity fails, adjust prompts, context selection and existing runtime settings first; model training or paid inference requires a separate decision.

## Implementation verification

On 2026-11-02, the complete Core suite passed **398 tests**, including **55 actor tests**. `npm run check`, syntax checks for all 10 changed modules/tests, `git diff --check`, and imports of seven actor modules from an isolated copy of only the deployable `core/src/` tree passed. The preceding branch verification on 2026-11-01 passed **63 affected Worker tests** and **85 site/data tests**; those surfaces have no further code changes in this correction. Worker bundle compilation was not run because the local Wrangler executable is not installed. Existing database publication SQL was not changed or run.

The repository was confirmed public. A review of the changed files found no raw runtime transcripts, private canon documents or generated runtime outputs; the credential-pattern scan found no matches. Synthetic input fixtures and mocks are labeled as such. No live-quality, throughput, distinct-cast or production-publication success is claimed by these tests.
