# Character commenting: evidence, previews and bounded coverage

Status: implementation for branch review, 2026-11-01. No deployment, production SQL, new character accounts, live cap changes, timer changes or broad backfill accompanies this work. This extends the existing Core actor engine and local Qwen adapter. It does not create a separate scheduler, memory store, backend, paid fallback or model-training pipeline.

## What changes

`core/src/executors/actor-news-comment.mjs` keeps the existing actor lookup, rolling daily cap, job receipt replay and atomic publication RPC. Generation now uses the shared evidence/preview pipeline. Unsupported output is a recorded `review_withheld` outcome, not a publishing attempt. An additional source read catches changes during inference before calling the RPC. The existing SQL RPC is unchanged; transactional source-version comparison remains a requirement before broader publication.

`actor_comment_preview` is a separate registered Core executor. It reads a canonical item reference and an existing actor, then returns a proposal. It has no publication dependency and ignores caller-provided content, grants, persona overrides and publish flags. A paused actor can be inspected without enabling it. No production timer enqueues this new job type.

The public news-comments API now returns `actor.is_ai` and fails closed if actor identity lookup fails. The shared discussion renderer shows **AI character** beside the name, with an operator explanation. The name remains **Royce** when that is the stored display name. It does not depend on a profile bio or a renamed display name for disclosure.

## Evidence contract

`core/src/actors/evidence.mjs` produces `actor-evidence/v1`:

- Canonical `kind`, item ID, revision, URL, separate publisher/discovery/update dates, capture time and explicit unknowns.
- Access level `full`, `partial`, `headline` or `unavailable`, with a reason. `full_text_received` and `full_text_in_context` refer specifically to complete publisher article text; song lyrics and posts have their own source types.
- Stable source IDs, full-content SHA-256, context SHA-256, source type, attribution, grant and observed time. Source IDs survive prompt-budget changes while context hashes show exactly what was included.
- At most 6,000 UTF-8 bytes of source text, reduced further when prompt framing/persona/history consumes the context budget. Truncation becomes `partial`. The pipeline conservatively bounds serialized prompt bytes and reserves completion/framing space; it withholds if it cannot fit. It does not silently call a truncated article a full read.

News uses the existing native-reader permission policy unchanged. Its single implementation now lives under `core/src/actors/news-reader-policy.mjs` so standalone OVH installation includes it; the Worker re-exports it. The production approved-grant list remains empty. Article payloads cannot grant themselves permission. Authorized full or partial `text_blocks` require a current matching grant, an approved adapter and attribution. There is no arbitrary URL fetch, paywall workaround, publisher HTML execution or rights inference from public availability.

Current canonical news loading still has discovery metadata only. Full-text ingestion is **not** now available in production; until publisher authorization and a reviewed content adapter exist, previews truthfully use headlines or abstain. A GDELT `published_at` is recorded as discovery time, never assumed to be publisher time.

Songs distinguish catalog fields from revision-matched, explicitly authorized lyrics. A text-only Qwen pass never sets `audio_observed`, even if a caller supplies an audio URL or an `audio_observed` claim. No audio is fetched. Canonical song preview currently reads active `music_catalog_objects`; an authorized lyrics adapter must supply versioned text before lyric analysis is available there.

Post preview reads a public, non-group, non-deleted canonical post and the latest six comments. It respects both block directions for the actor and excludes blocked authors. Posts and replies remain attributed statements, not independently verified news. Private/network/group posts are excluded. The pure snapshot builder also rejects private/deleted replies.

The job output stores a receipt with hashes and metadata rather than a second copy of the full article. Bounded evidence quotes accompany a ready proposal in the private existing job output. Never commit runtime inputs or model transcripts to Git.

## Generation and review

The existing loopback `localAiChat` remains the only default inference path. Suggested initial settings are explicit and unbenchmarked: context 8,192; generation 480 tokens at temperature 0.55; review 640 tokens at temperature 0; thinking off; priority -30; 120-second timeout for each call. The adapter retains its existing serialization/priority policy. Missing runtime, malformed JSON, output truncation, unusable evidence or failed review produces a withheld result. There is no remote fallback or repair loop.

Generation must return an item ID, `comment` or `abstain`, and exact source-quote anchors. Available article/post/lyric text must be used rather than just a title. Thin context requires questions or conditional language. Deterministic checks catch formatting/abuse, false firsthand identity, unobserved audio, overstated reading, invented numbers, unsupported recency, known unsupported generalizations, copied comments and generic text without an evidence connection.

The separate adversarial review checks unsupported implications as well as explicit claims. It must report grounding, relevance and voice consistency, no issues, an explanation, and independently valid source anchors. A bare `{approved:true}` is insufficient. Quoting a true source does not prove every assertion in a comment; the prompt explicitly warns the reviewer about that distinction.

These checks are conservative heuristics plus a local-model judgment. Unit tests establish contracts and known regressions, not general semantic reliability, entertaining prose or model quality. Owner-scored OVH samples are required before changing publication volume.

Each proposal includes source/persona/prompt hashes, requested and returned settings, separate generation/review elapsed times, reported model, implementation, queue wait and usage when exposed. An adapter default model name is distinguished from a reported runtime model. Unexposed digest/token/settings fields remain null. CLI diagnostics separately capture installed model digest and Ollama version when available.

## Cast and owner editing

Only the explicitly selected **adaptation cast**, which may span PRIM3 and Hitman, belongs in expanded coverage. No broad Hitman roster is assumed. Canon/story editing belongs to the separate canon task. This branch makes no claim about unverified characters or the story's employer/founder relationships.

The repository's `PRIM3/game/halo/world-roster.v1.json` is empty and research-gated. No canonical roster was supplied to this implementation. `core/config/actor-personas.example.json` therefore has empty `characters` and `selected_cast`. It is a contract example, not an additional registry. Existing unversioned actor personas are reported as `not_reconciled`, with null canon version and no invented source references. Their already-authorized legacy news path remains controlled by the existing actor row and RPC.

New configuration uses `actor-persona/v1`, an immutable config version, explicit `selected_cast`, and character records containing:

- Existing `actor_key`, unchanged display name and `identity_kind: fictional_ai`.
- `identity_status: pending | approved | rejected`, plus an approval reference for approved identities.
- A canon version, versioned source references and canon approval reference.
- Separate voice perspective, rhythm, humor and motivation; topical affinities and allowed own-platform surfaces.

Identical voice configurations are rejected. Source references must be verified by the canon/owner workflow; validation checks their presence, not their truth. No model can approve an identity or manufacture a roster.

Store each approved record on the **existing** `ops_platform_actors.persona.commenting` object:

```json
{
  "config_version": "the-reviewed-cast-version",
  "selected": false,
  "character": "the validated character record described above"
}
```

The string above is explanatory, not a usable record. `personaConfigFromActors` assembles a view of these existing rows, checks matching actor keys and requires consistent config versions. Selection, account approval and surface approval remain separate checks. This change performs no actor updates or identity provisioning. Coverage jobs pin config version and character digest; missing/changed config is withheld instead of silently reverting to Royce or a default personality.

## Coverage and proposed Control contract

`core/src/actors/coverage.mjs` is a **pure planner**, default disabled. It prepares descriptors for the existing `enqueueJob`/`ops_agent_jobs` contract. It never submits jobs itself. Both a future canonical creation signal and scheduled reconciliation can feed the same planner; no live triggers are installed here.

Proposed initial preview-only budgets: 3 proposals per batch, 6 pending, 12 per rolling day across the selected cast, 3 per actor/day, 2 queue attempts, 100 input records per page, no backfill. These are testable proposal limits, not measured daily capacity or production publication limits. A bounded backfill requires an explicit start date and item budget at most 100. The existing publication limit and six-hour seeding timer remain unchanged.

The planner rotates news/song/post surfaces, processes oldest eligible items within each surface, picks one relevant approved selected persona, and balances actor counts. Stable UUID job IDs depend on organization + surface + canonical item, not actor/config version; cast changes cannot create a fresh automatic job for the same item. Existing queued/completed/failed jobs suppress duplicate plans. Retry-exhausted items remain visible for owner action. Deferred capacity-limited work is not advanced past in the proposed checkpoint.

Checkpoints contain per-surface `(timestamp,id)`, next surface and scanned count. Persist them only together with accepted existing-queue work in an existing orchestration job's input/output; do not persist a proposed checkpoint before enqueue succeeds. A withheld preview is not successful published coverage. `coverageStatus` projects job outcomes/review/metrics for the owner and keeps withheld, pending, ready and published distinct.

**All plans return `dispatchable:false`.** Stable IDs prevent duplicate queue records via the existing upsert, but a pure snapshot cannot enforce shared daily/backlog caps across independent dispatchers. Before automatic scheduling, the existing data plane needs one atomic budget reservation + enqueue + checkpoint transaction. Before multi-character publication it also needs item-wide uniqueness and source/persona-version comparison in the atomic publication boundary. Existing SQL only provides per-actor article uniqueness and job replay. No new SQL or security policy is introduced here.

Suggested owner Control integration, within existing owner authorization and existing job tools, not a new public API:

| Operation | Input | Result |
| --- | --- | --- |
| Preview one item | `actor_comment_preview`, existing actor key, `input:{kind,item_id,expected_revision}` | Private `published:false` proposal or explicit withheld reason |
| Edit a persona | Existing actor's `persona.commenting`, validated against reviewed canon and expected prior config version | Versioned record; no account creation or automatic activation |
| Review coverage | Existing preview jobs, source access/unknowns, selected-cast config and bounded load snapshot | Planned/deferred/withheld/ready counts, checkpoints, metrics and per-item reasons |
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

The CLI requires explicit `--local`, limits each batch to six sequential samples and has no publication imports. Start with a private two-sample copy if load warrants. Do not invoke `actor_news_comment`, the seed script, or the runner as a preview: those existing paths can publish.

Record exact commit, fixture/version hashes, reported model + installed digest/Ollama version, returned context/output settings, generation/review/queue timings and token counts where exposed. Score useful source-specific detail, conversational quality, individual voice, unsupported assertions/implications, identity honesty, abstention and repeat rate. Repeat on a small approved actual cast subset once canon is reconciled; synthetic voices cannot prove cast authenticity. Keep raw outputs private and share only an intentionally safe aggregate.

Acceptance before increased live volume: no false personal/audio/full-reading claims; all injected/unsupported negative-control proposals withheld; every accepted factual assertion traceable; no accidental publication or duplicate item; correct character identity; owner-rated useful/non-generic prose. Measure ordinary interactive-queue contention and both cold/warm samples before selecting budgets. Polling intervals are not exact latency, and a small batch is not guaranteed daily throughput. If quality or capacity fails, adjust prompts, context selection and existing runtime settings first; model training or paid inference requires a separate decision.

## Implementation verification

On 2026-11-01, the complete Core suite passed **384 tests**, the affected Worker suites passed **63 tests**, and the site/data suites passed **85 tests**. Core syntax checks, syntax checks for the new modules, `git diff --check`, and importing the actor modules from an isolated copy of only the deployable `core/` tree passed. Worker bundle compilation was not run because the local Wrangler executable is not installed. Existing database publication SQL was not changed or run.

The repository was confirmed public. A review of the 23 changed files found no raw runtime transcripts, private canon documents or generated runtime outputs; the credential-pattern scan found no matches. Synthetic input fixtures and mocks are labeled as such. No live-quality, throughput, distinct-cast or production-publication success is claimed by these tests.
