# GitHub Copilot — McCluster

This repository participates in the McCluster control plane.

Canonical backend: GitHub `mcclusterishere/mccluster`, Cloudflare Worker `mccluster`, Supabase `zmnhbrjyhxzhkxmhkexs`.

There is no Worker named `mccluster-core`. Do not create one.

Do not scaffold a new API server, auth provider, or database. Route shared work through McCluster. Public site is `matthew.mccluster.org`. API is `https://api.mccluster.org`. Read `AGENTS.md`.

## Canonical AI context plane

Read `docs/control-plane/AI-HARNESS.md` before implementing AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company features.

Private AI context lives in Supabase schema `ai_context`, not in public Git. Raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model, or other provider conversations must never be committed to this public repository by default. Provider adapters normalize into the authenticated `context-ingest` contract and all models retrieve from the same canonical context plane.

No AI provider owns memory. Do not create a shadow vector store, second conversation database, raw-chat directory, separate memory service, or competing context source. Git stores schemas, adapters, policies, tests, and intentionally public-safe summaries; Supabase stores the private corpus and provenance.

## Autonomous operations contract

McCluster is an event-driven operating system, not a collection of disconnected assistants.

Canonical operational state lives in Supabase project `zmnhbrjyhxzhkxmhkexs`. Existing outreach CRM tables include `out_companies`, `out_contacts`, `out_campaigns`, `out_recipients`, and `out_events`. The autonomous operations layer includes `ops_objectives`, `ops_signals`, `ops_lead_scores`, `ops_agent_jobs`, `ops_recommendations`, and `ops_repo_events`.

When working in this repository:

- Reuse the canonical backend and schemas; do not create parallel CRM databases, shadow lead lists, or competing sources of truth.
- Treat repository changes, tests, deployment results, CRM engagement, research findings, and campaign outcomes as signals that should feed the operating layer.
- Prefer event-driven jobs plus scheduled reconciliation over one-off scripts.
- Keep lead/account scoring adaptive: engagement, urgency, fit, and momentum may expand or shrink campaign scope.
- New objectives and campaigns may be proposed automatically from evidence, but proposals must be written as recommendations before external execution.
- Autonomous agents MAY research, classify, score, reconcile, test, lint, analyze, draft, queue jobs, and propose next actions.
- Autonomous agents MUST NOT send external communications, merge/deploy production code, spend money, delete production data, change authentication/authorization, or perform destructive migrations without explicit human approval.
- Every organized outbound message must obey `docs/control-plane/OUTREACH-CRM-INVARIANT.md`; the CRM/database is the source of truth and Gmail `CRM Linked` is only an audit marker after successful database linkage.
- Never invent contact metadata, consent, replies, opens, clicks, titles, or company facts. Unknown is a valid value.
- Make jobs idempotent where possible and record enough provenance to explain why a score, recommendation, or scope change happened.
- Tests are part of the product. Code-changing agents should run the relevant tests and record outcomes before proposing or completing a change.

The desired steady state is continuous maintenance: ingest signals, reconcile state, score priorities, run safe checks, surface anomalies, and prepare high-value next actions while the owner is offline. Human approval gates remain mandatory for consequential external or production actions.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO
DRAW" for the supplied Whip Equipped kit.

## mcclusterishere/Here is dead

It publishes nothing — deploy workflows disabled, no CNAME. Do not write to
it. If a task looks like it belongs there, say so in the chat and work in
`mcclusterishere/mccluster` instead.


## EQUITY UPRISE BUILDING / 360 / SPATIAL AUTHORITY — MANDATORY

For **any Equity Uprise task involving geometry, architecture, floors, rooms, building imagery, 360 panoramas, environmental rendering, physical navigation, spatial transitions, or spatial lore/worldbuilding**, you MUST read:

`docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`

before designing, generating, rendering, coding, or describing the environment.

That authority file points to the required repo audit, locked six-floor building inventory, floor-specific builder/360 specs, schematic-plan basis, and canonical PNG/SVG/DXF plan references.

Non-negotiable:
- generated images are never geometry authority;
- floor/core geometry may not drift between renders;
- Floor 1 establishes the fixed 72' × 72' shell/core datum currently used for building coordination;
- elevator, stairs, risers and structural coordination remain vertically aligned;
- Floor 1 is the only public exterior entrance under the current locked scheme;
- do not invent rooms/floors/departments as canonical lore when they are not supported by the audited Equity Uprise program;
- if a floor does not yet have a reviewed floor-specific builder/360 spec, write/review that spec before generating its production imagery.

Do not confuse the six-floor Equity Uprise building with the separate `docs/uprise-world/` Living Sketch / Uprise World project. Each retains its own authority unless the owner explicitly requests a crossover.

## Equity Uprise spatial / geometry authority

**Mandatory:** before generating, editing, describing, implementing, or reasoning about any Equity Uprise building geometry, architecture, floor plan, 360 environment, 3D environment, room image, building cutaway, exterior, transition animation, spatial lore, or location continuity, read and obey:

1. `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`
2. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
3. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
4. the relevant floor's canonical written spec and schematic-plan basis;
5. the relevant canonical assets under `docs/design/equity-uprise-building/references/`.

For Floor 1 specifically, the canonical asset set is:
- `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.dxf`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.svg`
- `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.png`

For Floor 2 specifically, the canonical asset set is:
- `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.svg`
- `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.png`

For Floor 3, also read:
- `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-03/README.md`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.dxf`
- `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.svg`

These files are geometry authority. **Generative images are not geometry authority.** Never move the elevator, stairs, risers, structural grid, building footprint, entrances, floor program, or 360 datum merely to improve a render. Never invent spatial lore that conflicts with the canonical geometry.
