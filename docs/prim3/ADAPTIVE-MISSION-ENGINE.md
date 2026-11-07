# PRIM3 adaptive mission engine: inspection, research, local slice

2026-11-04. Implementation prepared for draft repository review. No production writes, deployment, external inference, new infrastructure or canonical campaign edits.

## 1. Existing system inspected

- `docs/prim3/HITMANS-HALO-WORLD-CANON.md`, `PRIM3/game/halo/data-boundary.json`, source policy, canon status and implementation order: fictional Earth campaign; public geography is permitted; operational Halo feeds are denied. The 66 canonical missions and research-gated assignments must remain intact. This slice is explicitly a non-canon side operation. News-inspired fiction needs reviewed public snapshots, not a bridge to Halo Ops.
- `docs/universe/UNIVERSE-SCHEMA.md` and registry: independent game state and engines; no portal or universe added here.
- `docs/game-hub/README.md`, `data/game-hub/modules.json`: Game Hub links Transit, HQ, course and owner-gated World; chemistry already has separate local practice/review. The Hub is not itself a mission compiler or authoritative LMS.
- `js/prim3-world/missions.mjs`: draft validation, cast-country coverage and mission links. World missions are side operations, not campaign canon. `js/prim3-tactics/transit.mjs` currently uses World mission metadata to dress the tactical level; level hooks supply some brief/debrief behavior. Shared movement/resolver files are untouched by this task.
- `workers/mccluster/src/prim3/mission-variant.js`, readiness tests: approved-variant selection, targeted review, scaffolding, immutable technical truth, separate tactical difficulty and minimum tool floor already exist. Preserve these when integrating; this slice is a math item evaluator, not their replacement.
- `workers/mccluster/src/prim3/news-desk.js` and `core/src/executors/prim3-agent-news.mjs`: owner-only regional briefs/comments derived from news articles. News desk content is not automatically verified game content. Do not wire operational credentials or raw text into the game.
- Learning evidence #707 exists locally as commit `1f404dbd`. Its migration is `20261103182544_learning_evidence_v1.sql`; the Nov 3 production schema snapshot records that migration and RLS-enabled `learning_lab_sessions` / `learning_evidence_events`. This is repository evidence of a snapshot, not a fresh production query. GitHub PR lookup returned Forbidden; no retry or remote mutation was made.
- `workers/mccluster/src/prim3/learning.js`: current owner-only audience switch; authenticated self-owned sessions; registered pack/version/scenario; append-only hash chain; reviewer workflow; automated ratings capped at Demonstrated. `completeSession` accepts bounded competency signals from clients; it does not validate these new coordinate answers. Do not submit this preview's scores as official competency or Principles credit.
- Existing append endpoint assigns sequence under DB locking but has no caller event-id replay receipt. Retrying a lost acknowledgement could duplicate submitted learning events. Production offline sync needs a transactional receipt, not browser-only deduplication.
- `docs/prim3/LEARNING-MODALITY-CONTRACT.md`: Principles remains mastery authority; Missions completion is separate. All IDs and existing data are preserved.

## 2. Research and design decisions

Sources consulted November 4, 2026:

| Primary source | Consequence for this design |
| --- | --- |
| [Common Core 6.NS.C.8](https://thecorestandards.org/Math/Content/6/NS/C/8/) | First bounded skill: distances between points sharing a coordinate, using signed coordinates and absolute value. Hex distance is a separate extension, not falsely mapped to this standard. |
| [IES practice guide: Organizing Instruction and Study](https://ies.ed.gov/ncee/wwc/practiceguide/1) | Use worked examples, retrieval opportunities and delayed checks. A brief provides one example; hints and explanations are recorded separately from independent answers. |
| [Karpicke & Roediger, 2008, original study](https://web.mit.edu/jbelcher/www/learner/retrieval.pdf) | Repeated retrieval improved delayed vocabulary recall in this experiment. This motivates testing retention, but does not prove that this game's math loop improves learning. |
| [Yudelson, Koedinger & Gordon, Individualized Bayesian Knowledge Tracing](https://www.cs.cmu.edu/~ggordon/yudelson-koedinger-gordon-individualized-bayesian-knowledge-tracing.pdf) | Skill-specific observations can support fitted learner models. Do not invent mastery probabilities or deploy uncalibrated BKT. Start with a transparent rule and evaluate predictive calibration on held-out learners. |
| [ADL xAPI data specification](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md) | Keep response, success and completion distinct. A future export can map to xAPI; this slice does not claim xAPI conformance or add an LRS. |
| [GDELT DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | News discovery is not truth verification. Preserve publisher URL and publication date in a reviewed public snapshot; distinguish source-country metadata from event location. Never use search results as proof of wrongdoing. |

The two-independent-correct progression rule is an explicit prototype heuristic, not a research-validated threshold. Level 1 uses positive coordinates; levels 2–3 add negative coordinates and negative rows. Incorrect answers step down one level; hinted success does not count toward advancement. New problem coordinates and distances vary. No speed score, tactical win or character survival enters the learning rule.

### Proposed production flow, not yet connected

1. Existing Core job system discovers public news with bounded retries, per-source quotas and backoff. Deduplicate canonical publisher URL and upstream event ID. Preserve publication time separately from discovery time. Missing/ambiguous provenance stays in review.
2. A restricted owner desk chooses an approved, versioned template, broad country/region, public source snapshot and canon reference. Review checks news accuracy, geography, fiction, suitability, and no real-person accusations. No freeform news text enters executable instructions or fictional adversary fields. Don't infer accuracy merely because GDELT indexed it.
3. One transaction releases an immutable reviewed revision. `expires_at = released_at + 24h`; edits produce a new reviewed revision, never silently extend an old release. Public lists and start/answer operations enforce time server-side. Owner can revoke. Retain past evidence after expiry.
4. If news fails, offer clearly labeled, pre-reviewed evergreen practice. Do not relabel stale content as current or fabricate a source/date. Cached released content may remain available only until its original expiry. Offline work after expiry remains pending/unvalidated until review; no automatic credit.
5. Authenticated API in existing Worker resolves tenant membership and user from trusted session. Service-role calls must include tenant and user constraints; client `role`, `tenant` and correctness flags are never authority. No new browser-facing backend.
6. Issued item IDs bind mission revision, session, skill, generator/evaluator version and parameters. Server computes the answer. Difficulty is per skill and must remain independent from tactical challenge. Explain each adaptation and permit scaffolding.
7. Atomically append attempt evidence plus `(tenant_id, user_id, session_id, client_event_id)` receipt and payload hash; exact retries return original result, altered retries conflict, ordering errors preserve the queue. Client discards only acknowledged events, scopes queues to account/tenant and clears on account changes. No raw news bodies, chat transcripts, emails or unnecessary PII in evidence. Retention/export/deletion policy needs owner review before persistent rollout.
8. Append to existing learning-evidence sessions through a reviewed registry/evaluator adapter. Keep game outcome, local practice, validated assessment and human credential review distinct. Never award Principles mastery by finishing the game.

### Database review proposal (not a migration)

Keep existing public learning tables and IDs. Isolate game content in the proposed `prim3_game` namespace inside the existing Supabase project. Candidate entities: versioned template/review records; reviewed source snapshots; immutable releases; server-issued items; idempotency receipts linked to existing learning session UUIDs. Add unique tenant/source/template identities, release expiry constraints, foreign keys and indexes before routes. RLS must constrain tenant membership plus owner/learner roles, not merely authenticated access. Resolve actual organization membership and registered pack mappings from current schema before drafting DDL. Do not reuse the preview's sequential IDs in production. The local in-memory service is not a database substitute.

### Evaluation before rollout

Compare fixed-difficulty authored practice, this transparent adaptive rule, and later fitted BKT using the same skill/item bank and comparable exposure. Split data by learner and time; keep unseen items for transfer and delayed checks (for example 7 days). Primary outcome: independently answered held-out math items, not engagement or mission wins. Report sample sizes, missingness, confidence intervals, learning gain, hint dependence, completion and accessibility outcomes. For BKT report log loss/Brier calibration and subgroup uncertainty. Predefine non-inferiority/benefit thresholds after baseline variance and sample-size planning; no numerical efficacy claim exists yet.

Reliability gates: duplicate/expiry/revocation tests; corrupted/missing source tests; cross-tenant and cross-user denial; replay and concurrent receipt tests against local PostgreSQL; account-switch queue tests; answer-key property tests; moderation review samples; mobile/keyboard walkthrough. The present tests cover the reference service only, not production concurrency or RLS.

## 3. Implemented local slice

- `PRIM3/game/halo/adaptive/engine.mjs`: no dependencies/network. Owner draft/review/release/revoke, immutable released payloads, 24-hour availability, stale/future-source rejection, event-ID and URL dedupe, allowlisted provenance copying without headlines/actors, explicitly labeled fallback. Trusted-principal contract with tenant/user checks. Brief/play/debrief state machine, deterministic integer validation, hints, variable coordinate questions, bounded three-level adaptation, replay receipts and ordered evidence.
- `tools/prim3-mission-lab.html`: functional phone-first owner and learner walkthrough using simulated identities. It has no remote authority, persistence, credentials or paid model. Reload loses all state. Its default is offline practice, not an invented live headline.
- `scripts/test/prim3-adaptive-missions.test.mjs`: isolation, source validation, duplicates, exact expiry, stale review, revocation, correct/invalid answers, adaptation, hints, debrief, replay after expiry and mutation resistance.

Tactical integration contract: consume a released mission ID/revision and show `brief`; emit a separate game outcome and validated question answer events at authored checkpoints; show debrief after play. Do not import or change movement costs, tile selection, AP or renderer code here. Future hex questions must use the tactical engine's coordinate convention and authoritative path costs, with their own skill tag. This task made no tactical-file edits; direct coordination with the other execution environment was unavailable.

## Initial prototype verification

34 focused Node tests passed (10 new plus existing learning, compiler and readiness suites). Chromium walkthrough reached debrief with no page errors; at both 390px and 1280px, document scrollWidth equaled clientWidth. The self-contained downloadable HTML passed the same walkthrough when served alone over localhost; direct file-URL testing was blocked by the managed Chromium policy. Browser fixture exercised independent and hinted success. No PostgreSQL test was run because no database code changed. No production freshness or live news verification is claimed.

At the end of the initial prototype, authenticated routes and learning persistence were not connected. The authorized continuation below connects a bounded flow; live news ingestion, cross-session learner profiles, all tactical variants, hex math, a deployed preview and efficacy validation remain outside this slice. Owner review and production authorization are still required before deployment or applying migrations. The self-contained download permits local preview without publishing a site.


## 4. Authorized continuation: existing learning service and tactical handoff

The bounded integrated path is `prim3-mission.html` → owner review → mission brief → `prim3-transit.html` in a separate tab → return to the coordinate checkpoint → server-checked answers → saved debrief. It uses the existing owner gate and learning handler. The production route is disabled by default; the page must not claim to be live before deployment and owner configuration.

### Implementation and exact integration seams

- `workers/mccluster/src/prim3/learning.js`: nine added lines import/route the adapter under the existing owner gate and prevent generic client event/completion endpoints from bypassing its evaluator. Existing packs, audience policy, IDs and rating logic are unchanged.
- `workers/mccluster/src/prim3/adaptive-learning.js`: fixed versioned `prim3-coordinate-practice` pack/scenario handled by its own bounded adapter. Uses the existing `learning_lab_sessions` and `learning_evidence_events` tables; no schema changes. Root learning session list/read routes can still show its records. It deliberately does not inject this math practice into the certification pathway registry.
- `prim3-mission.html`, `css/prim3-mission.css`, `js/prim3-mission/{app,client}.mjs`: gated review and brief, explicit tactical handoff, assessment, account-scoped pending request recovery and debrief. The existing shared bottom bar is preserved. It does not add another global navigation system.
- No files in `js/prim3-tactics/`, `prim3-transit.html`, Game Hub catalog or the other task's branch were edited. The only integration dependency is the existing `prim3-transit.html` route. The handoff preserves its save and carries no reset flag. The game outcome is explicitly learner-reported; the adapter never interprets a win as correctness or mastery.
- The available collaboration tree contained only this task. Direct messages to the separate tactical execution task were unavailable. The handoff contract is intentionally additive and conflict-free: future tactical checkpoints may call the practice client, but must never post a correctness flag or alter the evaluator's answer.

### Routes and owner configuration

All paths are under the existing `/v1/prim3/learning/adaptive` namespace:

| Method/path | Behavior |
| --- | --- |
| GET `/` | Owner-only readiness/configuration, fixed template, scope, 24-hour policy and event limit. |
| POST `/sessions` | Requires explicit fiction/geography review, fixed template ID and a retry-stable session UUID. Creates the existing learning session and signed release evidence. |
| GET `/sessions/:id` | Enforces ownership, verifies signed evidence, replays the deterministic evaluator and returns current question/debrief. |
| POST `/sessions/:id/events` | Accepts begin, handoff, hint, answer or finish; validates answer and order server-side; stores one signed evidence event; closes the existing session after signed finish. |

Operator prerequisites, not set by this task: `PRIM3_ADAPTIVE_ENABLED=true` and a separately provisioned random `PRIM3_ADAPTIVE_SIGNING_KEY` of at least 32 characters. The existing Supabase settings and house-owner authorization remain required. No service-role key is reused as a signing key. Keep the feature disabled until local DB/runtime checks and release approval. Turning the flag off is the global stop control; per-release administrative revocation UI is not implemented in this adapter. There is no live news input in the integrated path.

### Evidence and retry behavior

The current RLS lets learners append self-reported evidence. Consequently a database hash chain cannot prove a server graded an answer. This adapter signs canonical payloads with HMAC-SHA256 and verifies them before every replay/debrief. Payloads bind user, session, evaluator version, issued seed, action, result and server time; unverified or altered evidence fails closed. Supabase JSON key reordering does not invalidate signatures. Direct database clients can obstruct their own session with invalid evidence but cannot turn it into validated credit through this adapter.

Each API action uses a deterministic UUID-shaped primary key derived from session and step. The existing primary-key constraint prevents two answers from taking the same step. A failed duplicate INSERT rolls back its hash-chain trigger in PostgreSQL. On uncertain insert outcomes, the adapter reads and verifies the existing receipt; identical retries return the original result, conflicting retries return 409. There is no upsert on append-only evidence. A signed finish and session closure are separate existing-table operations: if closure fails, retrying the same finish repairs closure without appending another event.

The browser stores one pending request in sessionStorage under the server-confirmed owner's ID before sending. Reload/retry preserves the request ID and body. Account changes clear its pending local state and conceal the page. Storage failure refuses submission. Neither auth tokens nor complete learner histories are copied into the pending queue. Expired releases reject new evidence but acknowledge already accepted retries. New questions vary with a server-issued seed and signed replay context; sessions do not all use the same question sequence.

This proves answer correctness within a versioned practice session, not learner identity beyond the authenticated account, independent work outside the app, a credential, long-term mastery or a tactical victory. Hints requested through this flow are durable evidence; external help cannot be detected. Principles credit and competency-rating writes remain absent.

### Reproducible validation and exact working path

From the repository root, serve static assets locally:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

In another shell:

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/e2e/prim3-mission-integration.e2e.mjs
```

The test opens `http://127.0.0.1:8765/prim3-mission.html`. It intercepts only the test owner's API calls and runs the **actual** `handleLearning` handler against an in-memory PostgREST double. No production tokens, API, database or news feed are contacted. It opens the actual Transit route as a handoff, then verifies a lost answer response, page reload, exact retry, hinted answer and debrief at 390px and 1280px. It does not revalidate tactical WebGL/movement; that belongs to the separate task. The test omits unrelated shared-bar JavaScript.

Opening the new page normally still uses the real existing owner gate/API, and the undeployed route is unavailable. The above is a local integration test, not a publicly hosted working product. The original self-contained `PRIM3-Mission-Lab.html` Library artifact remains unchanged and usable independently; it is still the initial in-memory preview.

Focused Node tests cover evaluator behavior, the actual learning handler with a PostgREST double, lost ACKs, concurrent duplicate/conflicting submissions, signed payload tampering, exact owner/user scopes, disabled configuration, body limits, expiry, generic endpoint bypass rejection, closure recovery, client storage/account changes, and the existing owner gate/learning/readiness/compiler regressions. PostgreSQL tools and Worker build/runtime tools were unavailable in this environment, so SQL trigger concurrency and Cloudflare bundling/runtime remain release checks. No production schema or auth policy was changed. Key rotation/versioned verification, broader tenant rollout, persistent learner adaptation across sessions and full in-game checkpoint callbacks remain follow-ups.

Final continuation result: 79 focused Node tests passed; both integrated browser runs passed at 390px and 1280px with no page errors or horizontal overflow. The repository diff check passed. These validation results precede repository review publication; nothing was deployed or applied to production.

Repository review base: main at `4fc32c84970d1a5cbc69c2df218e700bcea14032`. Related tactical work is mcclusterishere/mccluster#739 (reviewed head `e53b27e5f1a0216299e4f39ac5ab1fff5ba0e70d`) and upstream mcclusterishere/Prim3#21 (`0e49209dd7e59c97ee45cf350fd35bbe09f2dcc1`). This change does not overlap their files or require their unmerged code: it hands off to the existing Transit route. No matching adaptive learning PR was found in the open-PR review.
