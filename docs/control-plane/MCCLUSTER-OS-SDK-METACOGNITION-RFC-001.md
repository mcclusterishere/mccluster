# RFC-001: McCluster OS SDK and Evidence-Grounded Metacognition

- **Status:** PROPOSED / review required. This document is a design specification, not a claim that its new SDK, evaluator, or interfaces are deployed.
- **Draft date:** 2026-10-18
- **Architecture authority:** [Canonical architecture](CANONICAL-ARCHITECTURE.md) and [machine-readable manifest](canonical-architecture.json).
- **Foundation revision inspected:** `mcclusterishere/mccluster@ad78fb38af726a08345adedcf70a82408f30f25c` (main).
- **Related:** [AI Harness](AI-HARNESS.md), [Capability Registry](CAPABILITY-REGISTRY.md), [Operational Intelligence Finish Line](OPERATIONAL-INTELLIGENCE-FINISH-LINE.md), [MCP Continuity](MCP-CONTINUITY.md), [Observability](OBSERVABILITY.md), [Issue #509](https://github.com/mcclusterishere/mccluster/issues/509) and [OVH recovery #510](https://github.com/mcclusterishere/mccluster/issues/510).
- **Companion proposed artifacts:** `sdk/contract-v1.schema.json` and `sdk/evaluation-protocol-v1.md`.
- **Implementation status:** design-only; no production migrations, SDK package release, production routes, model switches, or deployment authorization in this RFC.

## 1. Purpose and definition of done

McCluster OS is an AI-native **software platform / application runtime**, not at this stage a replacement Linux or Android kernel. It is built on existing operating systems and exposes authenticated, provider-independent capabilities to products, developers, and eventually devices.

The product goal is to make the existing McCluster system installable and programmable **without duplicating its control plane**. A developer should be able to build a separate application with stable contracts and verified organizational permissions, regardless of whether a capability is implemented by OVH, a trusted compute node, or an authorized external model/provider.

A metacognitive system in this RFC is an **observable, bounded control loop**: monitor evidence about work, evaluate uncertainty and results, select appropriate strategy/resources, and submit permitted follow-up actions. It is not consciousness, self-certified truth, model self-modification, or unlimited autonomy.

**Success requires both:** (a) an independently reusable SDK used by an actual application without privileged credentials and (b) objectively measured improvement on predefined tasks, without violating security, budgets, authority, or reproducibility.

## 2. Existing reality versus proposed additions

### Already in `mcclusterishere/mccluster` source

- Canonical durable organization, objectives, jobs, agent history and private memory in Supabase; `ops_agent_jobs`, `ops_objectives`, `ai_context`.
- Persistent OVH Core runner (`core/src/runner.mjs`), broker (`core/src/tool-broker.mjs`), capability catalog (`core/capabilities/catalog.json`), resolver (`core/src/capabilities/registry.mjs`), compute-node protocol, and local-model adapter.
- SDK-adjacent implementations: `packages/ai` provides a vendor-neutral model gateway; `native` uses Expo/React Native; the web analytics SDK is `js/mc-analytics.js`.
- A bounded reflection executor (`core/src/executors/objective-reflection.mjs` and `core/src/reflection-policy.mjs`) consumes canonical objectives/jobs and may queue limited `local_analysis`, `repo_health` or draft `code_patch` work. This is **not evidence** that self-improvement has been validated.
- An observability event contract (`public.control_observability_events`) and a read-only `core.resume` continuity capability.
- The canonical architecture explicitly prohibits shadow schedulers, objective stores, memory databases, unapproved model-side deployment, and unprivileged access to service-role credentials.

### Related but distinct repositories

| Repository | Existing source | Proposed responsibility | Must not own |
| --- | --- | --- | --- |
| `mcclusterishere/mccluster` | Trusted backend, canonical catalog, Core, edge, policies and database contracts | **Authority** for server APIs, schemas, runtime, and policies | Unreviewed breaking replacements of canonical architecture |
| `mcclusterishere/McCluster-OS` | Shared arithmetic `@mccluster/dial` and experimental `@mccluster/task-queue` | **Prospective distribution** of pure `@mccluster/contracts`, `@mccluster/sdk`, local device adapters, and reusable nonprivileged libraries, subject to review | Its own independent production control-plane database/scheduler |
| `mcclusterishere/mccluster-we-trust` | Configurable Music/identity/Globe shell, Studio, manifest validator, revisioned publication design, client generator | **First real SDK consumer / application product** | A second M Account authority or privileged backend |

**Important discovered conflict (D-01):** `McCluster-OS/packages/task-queue` currently implements `FileTaskStore` and a filesystem job lifecycle. It may remain a local experiment or test fixture. It **must not** become a competing live McCluster job scheduler. If its API is useful, write an explicit adapter to canonical `ops_agent_jobs` and validate ownership, leases, deduplication and idempotency there. Do not silently swap the database for a file queue.

**Presentation-state exception:** `mccluster-we-trust` may hold validated, versioned presentation configuration and publication revisions in D1 only within its narrowly defined product boundary. It cannot hold canonical identity, operational jobs, private AI memory, payments, or tenant privileges. The current `kernel/authorization.js` Core authorization endpoint is **proposed**, not yet proven live.

## 3. Architectural decisions (proposed)

| ID | Decision |
| --- | --- |
| D-01 | Exactly one authoritative work scheduler (`ops_agent_jobs`) and objective plane (`ops_objectives`). |
| D-02 | Exactly one authoritative private cross-model memory plane (`ai_context`); no filesystem shadow memory or raw-private-context Git export. |
| D-03 | Capability IDs describe user intent (for example `image.generate`), never vendors. Canonical catalog drives contracts. |
| D-04 | SDKs are **untrusted clients**, never sources of entitlements, identity, authorization, or budget truth. |
| D-05 | Models may propose and execute policy-authorized reversible tasks, but cannot grant authority, merge, deploy, purchase, publish, or sign contracts by themselves. |
| D-06 | Reflection proposals are **candidate strategy updates** until checked against external evidence, evals, and a separate policy gate. |
| D-07 | Evidence, plans, eval results and deployment provenance must be replayable from durable references without storing hidden model reasoning. |
| D-08 | Core and cloud services have replaceable provider adapters; SDK contracts remain provider-neutral. |
| D-09 | Device-local compute can operate offline within bounded, expiring authority, but cannot become a second global truth/financial decision maker. |
| D-10 | SDK, MCP, HTTP and native adapters map to **one semantic capability contract**; adapters must not create alternate authorization policies. |
| D-11 | Versioned app installs and tenant presentation revisions cannot assert Core administrative privileges. |
| D-12 | OVH runtime recovery is an independent infrastructure concern, never a blanket blocker for independently safe SDK/docs/feature reviews or Cloudflare releases. An OVH-dependent feature still requires its own live-runtime proof. |

An architecture-changing follow-up PR must update both `CANONICAL-ARCHITECTURE.md` and `canonical-architecture.json` together. This RFC alone intentionally changes neither.

## 4. Terms and developer-facing boundaries

- **API:** the externally defined contract/endpoint. **SDK:** idiomatic typed client and helpers implementing that contract. **MCP:** interoperable AI tool/resource protocol, not a scheduler or permission system.
- **Capability:** a stable requested operation with schema, risk, approval class, execution mode, and lifecycle; **binding:** a provider/tool implementation that can fulfill it; **tool:** concrete executable endpoint.
- **Runtime:** Core's executor plus policy-gated adapters, not the model itself. **Agent:** policy-constrained task controller operating over capabilities.
- **Reflection:** produces a diagnosis and proposed revision. **Metacognitive control:** uses independent feedback to change future strategy. **Learning:** only a **measured, approved** durable strategy update or separately authorized model-training procedure.
- **Spec wording:** MUST/MUST NOT designate acceptance requirements for a future compliant implementation; SHOULD denotes strong defaults; MAY denotes optional behavior. Until this RFC is approved and code is merged, these are **proposed requirements**, not live-feature claims.

## 5. Public SDK contract v1

### Proposed packages

1. `@mccluster/contracts` — JSON Schemas, generated TypeScript types, enumerations, compatibility fixtures. **Generated from or validated against** `core/capabilities/catalog.json` and canonical auth/job policy; cannot define duplicate capability meanings.
2. `@mccluster/sdk` — thin TS/JS client for `capabilities.list`, `capabilities.invoke`, `jobs.submit`, `jobs.get`, `sessions.resume`; optional availability of `jobs.cancel` and approval flows only when an actual authorized server adapter exists. **These are proposed methods, not claims that identical HTTP routes already exist.**
3. Subsequent `@mccluster/sdk-python` and device adapters only after contract conformance; do not add more clients until a first consumer passes acceptance.
4. Existing `@mccluster/dial` remains a pure reusable mathematics library. The existing `packages/ai` provider gateway is an implementation candidate to be adapted, not unilaterally replaced.

The machine-readable candidate envelopes are in `sdk/contract-v1.schema.json`. They define `CapabilityRequest`, `ExecutionReceipt`, `EvidenceReference`, `ReflectionProposal`, `EvaluationResult`, and `ErrorResponse`.

### Public request and execution

An SDK caller MAY supply `request_id`, an idempotency key for write/async work, validated capability ID, typed input, and an optional correlation ID. The **server** derives and stamps authenticated subject, authorized organization, risk policy and budget. Client-supplied tenant names/slugs, roles, "admin" flags or model-generated assertions are not proof of access.

For synchronous calls the gateway returns typed data plus provenance or a typed failure. For accepted asynchronous jobs it returns a durable job ID and observable state; reconnecting/retrying with the same idempotency key MUST NOT duplicate paid or externally visible effects. **Accepted work survives browser/process disconnects.**

A proposed normalized public state machine is `queued -> running -> completed|failed|cancelled` with `awaiting_approval` as a distinct policy state when needed. The adapter MUST map canonical server state truth instead of independently advancing client-side state. Cancellation is best-effort until an actual job cancellation protocol is implemented; a caller may not infer rollback from a cancelled HTTP request.

### Versioning and compatibility

- v1 contract identifier: `mccluster.sdk/1.0`; semantic package versions are separate.
- Contract names and serialization MUST be stable during an SDK major version; additive optional fields are acceptable, narrowing or redefining a field requires a major version.
- Unknown enum/lifecycle values and invalid required fields must fail safely with typed errors. Unknown/failed data reads are not empty success.
- HTTP and MCP are transport adapters; any MCP version must be negotiated/tested rather than hard-coded as a new truth. MCP tool schemas use JSON Schema; schema compatibility tests must cover both HTTP and MCP mappings.
- Capability `planned` does not imply executable; bindings that cannot be discovered are `unavailable`.
- Every versioned release records the source SHA, contract version, target runtime, and compatibility matrix.

## 6. Trust, tenancy, and effect boundaries

| Boundary | Requirement |
| --- | --- |
| Browser/native → edge | Bearer/OAuth proof or supported verified session; short-lived credentials; no service-role keys; input/rate/size limits |
| Edge → Core | Existing authenticated/signed bridge and allowlisted capabilities; explicit caller identity and org derived from trusted auth |
| Core → Supabase | Tenant/org enforcement on each action; canonical job, objective, memory, provenance and approval records |
| Core → compute node | Signed scoped leases; no broad Supabase service-role credentials or autonomous deployment authority |
| Core → model/provider | Minimum context, server-side secrets, redacted telemetry, explicit budget and data-use policy |
| Product presentation | Site manifest controls appearance only; never owner/tenant/role entitlement |
| Agent → side effects | Policy authorization, idempotency, risk classification, approval where required, and rollback/compensation plan |

Risk classes at minimum reuse the catalog's `read`, `write`, `spend`, `deploy` and `destructive`; "read" is not automatically harmless when it exposes sensitive material. Attack cases include cross-tenant actor spoofing, prompt-injection instructions from retrieved content, replay, forged completion evidence, grant escalation via presentation manifests, unexpected provider spend, dependency supply-chain attacks, and false "no pending approvals" reports.

The **source-status invariant** is mandatory: `ok` with an empty list means verified empty; `missing`, `unavailable`, `invalid` and `partial` must remain distinguishable. An unreadable approval source never becomes an empty approval list.

## 7. Metacognitive lifecycle (proposed)

`OBSERVE → QUALIFY EVIDENCE → PLAN → AUTHORIZE → EXECUTE → VERIFY → REFLECT → EVALUATE → PROPOSE UPDATE`

1. **Observe:** read authorized canonical objectives, recent jobs, memory references, test results, source health, and trace IDs. Never assume missing observations are negative evidence.
2. **Qualify:** attach source IDs, immutable artifact hashes where possible, freshness, tenant scope, and source reliability. Reject forged/unverifiable external effects.
3. **Plan:** identify an objective, alternatives, dependencies, predicted cost/risk and stop conditions; version the plan. Prefer reversible inspection before privileged action.
4. **Authorize:** enforce policies outside the model. Record any human approval independently. Never promote a proposed new capability based only on model confidence.
5. **Execute:** claim/lease one canonical job; use the stable capability resolver and approved binding; preserve idempotency and timeout/retry budgets.
6. **Verify:** evaluate objective-specific facts with independent checks: tests, HTTP runtime readback, database constraints, signed receipts, or an authorized human verdict. Self-generated narrative alone cannot establish completion.
7. **Reflect:** produce concise structured `diagnosis`, `evidence_refs`, `uncertainty`, `candidate_strategy`, and `proposed_next_action`. No hidden chain-of-thought logging. Current Core's bounded reflection remains the implementation baseline.
8. **Evaluate:** replay candidates on held-out tasks or shadow mode; compare to baseline on quality, completion, latency, cost, safety, and calibration.
9. **Propose update:** approve an immutable *skill/routing/prompt/policy revision* only through appropriate review/authority. Changes to model weights require separate dataset-rights and training approval.

**Boundedness:** every loop declares an objective scope, allowed capabilities, maximum tool calls/attempts, time, token/compute/spend budget, and a stop condition. A strategy cannot grant itself additional budget or permissions. New policies MUST NOT weaken the existing reflection allowlist (three total follow-up jobs, at most one draft code patch in the inspected implementation) without separate reviewed tests and explicit approval.

### Memory is not training

| Category | Canonical handling |
| --- | --- |
| Working | Transient model context; derived from minimum relevant context |
| Episodic | Canonical job, action, evidence and outcome records |
| Semantic | `ai_context` sourced memories and operational ontology; confidence, freshness, provenance and sensitivity |
| Procedural | Reviewed, signed/versioned capability handlers, templates, skills and workflow policies |
| Evaluation | Task fixtures, policy/model/prompt version, run metadata, metrics and outcomes |
| Weights/adapters | Separate model artifacts; no automatic fine-tuning on user or customer content |

Memory candidates must support review, supersession, deletion/retention and provenance. Repeated text is not independent corroboration. Private source data, copyrighted assets, likenesses, or regulated records cannot be silently converted to training data. Raw prompts/responses and model-private reasoning do not enter general observability events by default.

## 8. Evaluation, uncertainty, and accountability

The companion [evaluation protocol](sdk/evaluation-protocol-v1.md) defines experimental design. Every iteration measures against a fixed, versioned task set:

- **A:** single-pass agent, no reflective iteration;
- **B:** tool-using agent with observation and verification;
- **C:** same tool/policy access as B, plus bounded evidence-based reflection.

Keep model version, task distribution, budgets, and test environment matched. Use repeated trials or paired comparison where stochasticity matters; blind adjudication for subjective quality; independent tests for code/security. Record confidence/abstention and calibration instead of treating verbal certainty as accuracy.

**Hard stop:** any unauthorized external side effect, tenant leak, fabricated verified-completion receipt, uncontrolled spend, automatic production merge/deploy, or other critical policy violation disqualifies that candidate regardless of apparent task-success lift.

Performance promotion needs a predeclared meaningful quality improvement with no safety regression, acceptable cost/latency, and reproducible provenance; isolated favorable examples do not count. Reflection itself is an additional tool with cost and risk, not automatically beneficial.

### Telemetry and privacy

Continue using canonical `public.control_observability_events`: correlate authorized request, capability, job, tool, evaluator, and decision through trace/request/resource IDs. Maintain bounded metadata, source-level status and error classification, and required redaction. Do not install automatic third-party trace exporters that upload prompts/outputs or credentials. OpenTelemetry conventions can be mapped into the existing store with reviewed content/attribute allowlists, not a second operational log database.

## 9. Rollout and acceptance gates

| Gate | Required output | Evidence; no "done" on intent alone |
| --- | --- | --- |
| G0 — approve architecture | Reviewed RFC, schema and evaluation protocol | Owners sign off on authority, privacy, persistence, and unresolved decisions |
| G1 — contracts | Catalog-compatible JSON Schema/types and mocked SDK | Contract tests pass for active/planned/unavailable, malicious payloads, errors, version skew and idempotency |
| G2 — trusted consumer | First `mccluster-we-trust` installation uses SDK with real Core identity and tenant grants | Authorized owner can edit/publish; another tenant/guest denied; public published revision works; no shadow data |
| G3 — reflection control | Read-only trace/receipt + proposal path; evaluation harness | Replayed independent outcomes beat fixed baselines under safety thresholds |
| G4 — second consumer | Separate application uses same SDK/contract with no backend fork | Install/upgrade, compatibility, failure/recovery, and authorization tests |
| G5 — device/offline | Local capability adapter plus scoped sync | No offline global privilege; recovery and conflict handling tested |
| G6 — model adaptation (optional) | Rights-reviewed dataset and benchmark | New adapter wins held-out eval; model provenance, rollback and opt-out verified |

**Dependency rule:** an SDK/doc PR does not require an OVH promotion to merge if independently reviewed. Live Core-dependent acceptance gates remain blocked until the actual served Core SHA and APIs are independently verified. GitHub branch state alone is not deployment evidence. This RFC does not alter `deploy/ovh-production` or release policies.

## 10. Implementation sequence and ownership

1. **Current canonical repository:** ratify the contracts, machine schemas, compatibility rules and test fixtures. Keep runtime integration on its own PR.
2. **McCluster-OS (future package PR):** implement pure generated `@mccluster/contracts` and a minimal `@mccluster/sdk` using canonical API adapters. Define explicit package/release provenance. Quarantine or adapt `@mccluster/task-queue`; never add it to Core's production job path unchanged.
3. **McCluster We Trust (consumer PR):** implement the missing trusted Core authorization boundary; use the SDK for entitlements and capability access; prove tenant isolation and site publish/rollback. Keep D1 scoped to presentation history.
4. **Core metacognition (separate PR):** augment existing reflection executor with verified outcome receipts, source statuses, risk limits, trace references, and offline evaluation mode, not a parallel agent supervisor.
5. **SDK conformance:** test against mocks, actual existing Core/edge behavior and adversarial negatives, then publish semantic package versions only after G1–G2 are proven.
6. **Later research:** Python SDK, local-device adapters, strategy policy optimization, optional PEFT/TRL training after rights review.

## 11. Explicit open decisions requiring review

- Which public edge routes actually support each proposed SDK method? Map to **observed** endpoints and reject/mark unsupported rather than inventing new deployed URLs.
- Will `@mccluster/sdk` source permanently live under `McCluster-OS`, or be generated there from canonical schemas in `mccluster`? **Proposal:** source under OS repo, canonical contract verification in main.
- Which organization-scoped developer apps may obtain delegated credentials, and how are grants revoked?
- How to model approval pause/resume and cancellation safely over existing `ops_agent_jobs` without inventing a shadow queue?
- What minimum data rights/retention guarantees are required before evaluations or model training include user-contributed content?
- Which independently verified operational outcome (not merely text matching) defines each benchmark's success?

These questions are gates, not permission to bypass architecture.

## 12. Research and standards references

Primary references below are **design inputs**, not adopted substitutes for McCluster policies:

- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) — tool discovery and schemas.
- [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) — optional agent runtime, human review and tool-use patterns.
- [LangGraph interrupts / idempotency](https://docs.langchain.com/oss/javascript/langgraph/interrupts) — side-effect boundaries in replayable graph execution.
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/) — interoperable event/span attribute vocabulary.
- [ReAct](https://arxiv.org/abs/2210.03629), [Reflexion](https://arxiv.org/abs/2303.11366), [Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT](https://arxiv.org/abs/2310.08560) — reasoning/action, feedback, memory/reflection, context management research.

**Normative anchor:** the live-tested McCluster architecture and policies in this repository take precedence over illustrative patterns from external SDKs.
