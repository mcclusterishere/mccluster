# Equity Uprise — Repository-to-Building Reconciliation Audit

> Audit date: **2026-09-22**  
> Audit scope: current repository tree  
> Repository: `mcclusterishere/mccluster`  
> Scope: Equity Uprise public surfaces, platform rooms, data model, Policy OS, research/publication stack, media/music stack, outreach/integration/control systems, building authority, floor programs, routing/hotspots and Core V2 generated architecture.  
> **Not for construction.** This audit validates program fidelity and deterministic building semantics, not building-code compliance or real-world architectural/engineering feasibility.

## Executive conclusion

The approved structure of **six enclosed floors plus the Level 7 roof is still the correct compression model** for the current Equity Uprise repository.

No additional enclosed floor is justified by the repo.

The previous building model was directionally correct but **under-described several capabilities that now exist in the Policy OS and operating stack**. The reconciliation identified and corrected those gaps without changing the Core V2 shell or floor hierarchy.

The building now uses this functional progression:

**arrival / trust → public listening / participation → people / opportunities / relationships → culture / creation / release → research / evidence / publication / impact → institutional direction / approvals / operations → ecosystem departure / arrival**

The canonical machine-readable program authority is:

`docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`

That map currently contains **56 repo-grounded capabilities**.

Status distribution:
- `built` — Implemented in repo.
- `built_guarded` — Implemented with explicit access/approval controls.
- `built_manual` — Public flow exists but completion is human/manual.
- `built_disabled_until_configured` — Implementation exists but external credentials/provider/agreements/configuration are required.
- `built_not_armed_by_default` — Underlying system exists but outbound operation is intentionally not enabled by default.
- `built_shared_platform` — Implemented in shared McCluster platform and used by Equity Uprise rather than duplicated.
- `built_public_pathway` — Public path exists; relationship/fulfillment work is handled institutionally.
- `schematic_future_feasibility` — Architectural/digital reservation only, subject to real-world feasibility.
- `experimental_separate` — Separate experimental system; optional route, not building authority.

## Audit method

This reconciliation did not treat a marketing page as the whole product.

The branch tree was swept for Equity Uprise and closely related surfaces, then the architecture was checked against the implementation families that materially define the institution:

- public institutional record and fellowship/program pages;
- topic, perspective and conversation systems;
- profiles, private contact, member dashboard and people directory;
- fellowship directory, matching, applications, host listings and interviews;
- M-Verified organization/profile intake;
- stakeholder organizations, relationship graph, communications, meetings and commitments;
- living policy initiatives;
- research projects, sources, claims, evidence, manuscripts and review;
- artifacts, publications, version-of-record and distribution;
- ORCID and Crossref integration paths;
- government targets, dockets, submissions and receipts;
- monitors, citation snapshots and impact events;
- Equity Uprise music/catalogue, artists, releases, rights and DDEX;
- communication derivatives;
- moderation/admin Desk;
- control approvals, OAuth/integrations, jobs/workflows, status/health and event ledger;
- Google Workspace relationship bridge;
- consent-aware outbound outreach;
- Hitman's Halo / Seek First spatial-intelligence projection and entitlement boundary;
- Level 7 ecosystem routing and the separate experimental Uprise World.

Representative source authority includes:
- `docs/equity-uprise-platform.md`
- `equity-uprise.html`
- `equity-uprise-fellowship.html`
- `topics.html`
- `fellowships.html`
- `fellowship.html`
- `profile.html`
- `dashboard.html`
- `uprise-admin.html`
- `verify.html`
- `docket-516.html`
- `policy.html`
- `walls/eu-rally.html`
- `docs/music-platform.md`
- Equity Uprise migrations under `supabase/replay_migrations/`
- Equity Uprise Edge Functions under `supabase/functions/`.

This audit describes what the repo implements, declares, or explicitly reserves. It does **not** independently verify every factual claim made inside public policy/program content.

## What the prior building underrepresented

The prior floor hierarchy was sound. The missing fidelity was mostly semantic:

1. **Floor 1** had intake but did not name M-Verified / verification strongly enough.
2. **Floor 2** represented public discussion but its identity wall did not explicitly bind topics, perspectives and conversations.
3. **Floor 3** was too fellowship-centric; the repo also has stakeholder organizations, relationship stages, meetings, commitments, calendar/interview workflow, partnerships and private contact boundaries.
4. **Floor 4** represented media/culture but under-described release operations, rights/catalog state, DDEX and communication derivatives.
5. **Floor 5** represented policy/evidence but under-described the living initiative docket, claim/evidence graph, manuscripts/reviews, canonical publications, distribution, government filings, monitoring, citations and impact.
6. **Floor 6** represented institutional direction but under-described the real private Desk: moderation, roles, approvals, integrations, workflow/jobs, outreach, health/status and immutable audit/event state.
7. **Floor 6** also lacked a coherent spatial-intelligence instrument. The reconciliation adds one restrained Halo Globe / Spatial Intelligence viewport, visible to all through a sanitized read-only projection while protected owner/admin operations remain in the real Halo / Seek First plane.
8. **Level 7** incorrectly had a generated passenger-elevator hotspot despite Core V2 explicitly not assuming direct passenger-elevator roof service.

All eight issues are now represented in the Core V2 program/capability authority. The production generator has also been changed so future routing preserves those boundaries.

## Canonical floor model

| Level | Identity | Functional role | Primary capability count | Total represented capability count |
|---|---|---|---:|---:|
| 1 | Arrival / Orientation / Intake | enter / orient / verify / establish Passport / route next action / foundational safety | 2 | 7 |
| 2 | Public Forum | listen / discuss / record / member context | 4 | 5 |
| 3 | Fellowship + Network | people / opportunities / relationships / meetings | 11 | 18 |
| 4 | Media + Culture | listen / create / edit / archive / release | 8 | 10 |
| 5 | Policy + Proof | research / evidence / publication / filings / impact | 15 | 18 |
| 6 | Penthouse Command | institutional direction / Desk / approvals / operations / spatial intelligence | 13 | 32 |
| 7 | Roof / Mobility Portal | ecosystem navigation / departure / arrival | 3 | 3 |

A capability may appear on more than one floor only when the secondary location expresses a real part of the same workflow. Example: a government submission is prepared/reviewed on Floor 5, while irreversible authorization belongs to Floor 6.


## Floor 1 — Arrival / Orientation / Intake

**Role:** arrival / orientation / verification / Development Passport / next-action routing / foundational safety.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `verification` | M-Verified organization/profile intake | built_manual | public-intake-human-reviewed |
| `stakeholder-intake` | Stakeholder and organization intake | built | public-intake-private-relationship-state |

### Cross-floor capabilities represented here

Floor 1 may route into broader Equity Uprise services without pretending those services physically live in dedicated Floor 1 rooms. Development Passport, Journey Wall and next-action routing are now part of the current Floor 1 program authority even where the underlying product capability is shared rather than a standalone building-capability ID.

- **Neutral conversation/help** (`conversation-agent`) — concierge/orientation support with human handoff.
- **Fellowship applications** (`fellowship-applications`) — routed from Next Action / Building Directory when a participant is ready.
- **Interview/calendar scheduling** (`interviews-calendar`) — appointment routing without exposing private calendar state.
- **Program support / enterprise-development pathways** — available as next-step routes, not permanent lobby furniture.

### Development-program binding

Working stage: **ENTER**

Primary competencies:
- `CORE-01` Self-Direction
- `CORE-05` Digital Fluency
- `CORE-06` Civic & Institutional Literacy
- `CORE-07` Professional Practice
- `CORE-08` Safety & Resilience

### Architectural reading

- public: **Entry Vestibule**
- public: **Arrival Atrium**
- public/social: **Orientation Lounge**
- private-session-capable: **Intake / Verification Consultation**
- shared-space/private-data: **Development Passport Studio**
- public-with-private-personalization: **Journey Wall**
- public-counter/staff-private: **Reception / Concierge / Security Desk**
- public/authenticated-personalization: **Next Action / Building Directory**
- controlled/back-office: **Building Operations / Life Safety**
- controlled/back-office: **IT / Electrical**

**Boundary:** Floor 1 receives, orients, verifies and routes people. It does not expose privileged workflow state, live B1/tunnel operations, or another participant's Passport data.

## Floor 2 — Public Forum

**Role:** listen / discuss / record / member context.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `public-issues` | Public issue/topic hubs | built | public |
| `perspectives` | Public perspectives with consent + moderation | built | public-plus-moderated-private |
| `conversation-agent` | Neutral listening/conversation agent | built | public-with-human-escalation |
| `member-dashboard` | Member dashboard / private personal desk | built | private-member |

### Cross-floor capabilities represented here

- **Profile/topic-based opportunity matching** (`fellowship-matching`) — Opportunity table and member check-in.

### Architectural reading

- public/member-facing: **Public Forum**
- public/member-facing: **Topics / Perspectives / Conversations wall**
- public/member-facing: **Listening Lounge**
- public/member-facing: **Member Check-In**


**Boundary:** Public issue framing remains neutral; private dashboard content is visible only after member authentication.

## Floor 3 — Fellowship + Network

**Role:** people / opportunities / relationships / meetings.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `profiles` | Public profiles / people directory | built | public-self-controlled |
| `private-contact` | Private member contact/consent record | built | owner-self-only |
| `fellowship-directory` | Fellowship/opportunity directory | built | public |
| `fellowship-matching` | Profile/topic-based opportunity matching | built | member-public-directory |
| `host-listings` | Host-submitted fellowship listings with moderation | built | public-submission-private-moderation |
| `fellowship-applications` | Policy Fellowship/application workflow | built | public-intake-private-state |
| `interviews-calendar` | Interview requests, availability and calendar scheduling | built_guarded | public-derived-slots-private-calendar |
| `stakeholder-graph` | Stakeholder people/organizations and initiative relationship graph | built | private-operations |
| `meetings-commitments` | Meetings, participants and commitments | built | private-operations |

### Cross-floor capabilities represented here

- **Member dashboard / private personal desk** (`member-dashboard`) — Member Check-In opens private matches, applications, saves, perspectives and conversation threads.
- **M-Verified organization/profile intake** (`verification`) — Intake / Verification Consultation on Floor 1; verified identity becomes part of Floor 3 network context.
- **Stakeholder and organization intake** (`stakeholder-intake`) — Reception/intake on Floor 1; relationship graph on Floors 3 and 6.
- **Partner / sponsor pathways** (`partnership-sponsorship`) — Partner / Executive Briefing room and Institutional Salon.
- **Artist/creator participation and studio workflow** (`artist-creator`) — Creator Recording Room and Edit / Review Suite.
- **Google Workspace/Gmail relationship bridge** (`google-workspace`) — Desk Operations / Systems; relevant communications project into stakeholder relationship state.
- **Consent-aware outbound stakeholder outreach bridge** (`outreach`) — Access-controlled stakeholder pipeline; never a public blast console.

### Architectural reading

- public/member-facing: **Opportunity Exchange**
- public/member-facing: **Opportunity / Network Wall**
- public/member-facing: **People + Network Lounge**
- public/member-facing: **Member / Meeting Check-In**
- controlled/back-office: **Interview / Stakeholder Meeting A**
- controlled/back-office: **Interview / Stakeholder Meeting B**
- controlled/back-office: **Fellowship / Relationship Records**

**Boundary:** Public people/opportunity surfaces never expose private contact fields or internal stakeholder notes.

## Floor 4 — Media + Culture

**Role:** listen / create / edit / archive / release.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `music-catalogue` | Equity Uprise music/catalogue listening surface | built_shared_platform | public |
| `artist-creator` | Artist/creator participation and studio workflow | built_shared_platform | public-account-based |
| `music-rights` | Music rights/catalog/release graph | built | private-operations-with-public-catalogue |
| `music-release` | Equity Uprise/McCluster release preparation | built_guarded | private-approval-gated |
| `ddex` | DDEX ERN delivery | built_disabled_until_configured | private-high-risk |
| `rally-media` | Equity Uprise Rally/event media archive | built | public |
| `communication-derivatives` | Press release, executive summary and social-prep derivatives | built | private-preparation |

### Cross-floor capabilities represented here

- **Docket 516/516R evidence room and public-record archive** (`evidence-room`) — Evidence + Proof Archive; media context may also appear on Floor 4.
- **Canonical artifact graph and derivative lineage** (`artifacts`) — Publication/Proof systems; communication derivatives route to Floor 4.

### Architectural reading

- public/member-facing: **Media / Listening Zone**
- public/member-facing: **Culture Archive / Rally Gallery**
- controlled/back-office: **Creator Recording Room**
- controlled/back-office: **Edit / Review Suite**
- controlled/back-office: **Media / Release Control**
- controlled/back-office: **Media / Music Operations**

**Boundary:** Rights, DDEX and delivery state stay operational/private; the public floor expresses the catalogue, culture and approved work.

## Floor 5 — Policy + Proof

**Role:** research / evidence / publication / filings / impact.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `research-projects` | Research projects and memberships | built | mixed-public-internal |
| `source-graph` | Sources, verification, supersession and citations | built | internal-with-published-output |
| `claim-evidence` | Claims linked to evidence | built | internal-with-published-output |
| `manuscript-review` | Manuscripts, sections, revisions and review comments | built | internal |
| `evidence-room` | Docket 516/516R evidence room and public-record archive | built | public |
| `credentials-proof` | Credentials, citations, proclamations and proof documents | built | public-record |
| `artifacts` | Canonical artifact graph and derivative lineage | built | mixed |
| `publications` | Canonical publications and versions of record | built_guarded | published-public-workflow-private |
| `publication-distribution` | Approved publication distribution/syndication | built_disabled_until_configured | private-approval-gated |
| `orcid` | ORCID contributor identity | built_disabled_until_configured | private-contributor-integration |
| `crossref` | Crossref DOI deposit/verification | built_disabled_until_configured | private-publication-integration |
| `government-dockets` | Government targets/dockets and recurring docket intelligence | built_guarded | private-research-with-public-output |
| `government-submissions` | Government filing/submission workflow | built_guarded | private-high-risk |
| `monitoring` | Research/source/government/stakeholder/citation monitors | built | private-operations |
| `citations-impact` | Citation snapshots and impact events | built | mixed |

### Cross-floor capabilities represented here

- **Living policy initiative portfolio** (`initiative-portfolio`) — Penthouse Command portfolio direction; individual research/evidence work occurs on Floor 5.
- **Press release, executive summary and social-prep derivatives** (`communication-derivatives`) — Edit / Review Suite; lineage remains tied to Floor 5 source artifacts.
- **Immutable normalized Equity Uprise event ledger** (`event-ledger`) — Control / Audit Records support and cross-floor institutional memory.

### Architectural reading

- public/member-facing: **Evidence + Proof Archive**
- public/member-facing: **Published proof/publications**
- controlled/back-office: **Policy Lab**
- controlled/back-office: **Source Review Room**
- controlled/back-office: **Publication / Submission Review**
- controlled/back-office: **Research / Publication Navigator**
- controlled/back-office: **Research / Publication Systems**

**Boundary:** This floor is the canonical research-to-record engine; approval authority for irreversible external acts remains on Floor 6.

## Floor 6 — Penthouse Command

**Role:** institutional direction / Desk / approvals / operations.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `institutional-desk` | Institutional Desk / finished public record | built | public |
| `partnership-sponsorship` | Partner / sponsor pathways | built_public_pathway | public-contact-private-relationship-state |
| `initiative-portfolio` | Living policy initiative portfolio | built | public-summary-private-operations |
| `admin-desk` | Moderation/listings/conversations/topics/roles/audit Desk | built | private-editor-owner |
| `control-approvals` | Capabilities, approval requests and decisions | built | private-authorized |
| `integrations-oauth` | Integration registry and OAuth connection state | built | private-owner |
| `workflows-jobs` | Event-driven workflows, jobs and approvals | built | private-operations |
| `status-health` | Integration/job/monitor/queue health | built | private-operations |
| `google-workspace` | Google Workspace/Gmail relationship bridge | built_disabled_until_configured | private |
| `outreach` | Consent-aware outbound stakeholder outreach bridge | built_not_armed_by_default | private-high-risk |
| `event-ledger` | Immutable normalized Equity Uprise event ledger | built | private-audit |
| `program-support-funding` | Program funding / support pathway | built_public_pathway | public-support-pathway-private-detailed-fund-governance |
| `halo-spatial-intelligence` | Hitman's Halo / Seek First spatial-intelligence viewport | built_shared_platform | public-sanitized-read-only-role-scoped-owner-admin |

### Cross-floor capabilities represented here

- **Public perspectives with consent + moderation** (`perspectives`) — Public Forum record surfaces; moderation remains private Desk work on Floor 6.
- **Neutral listening/conversation agent** (`conversation-agent`) — Listening Lounge; human handoff routes to the Desk without making the agent an ideological authority.
- **Private member contact/consent record** (`private-contact`) — Never shown publicly; represented only as protected relationship records/back-office state.
- **Host-submitted fellowship listings with moderation** (`host-listings`) — Opportunity Exchange submission path; moderation on Floor 6 Desk.
- **Interview requests, availability and calendar scheduling** (`interviews-calendar`) — Member / Meeting Check-In and two Interview / Stakeholder Meeting rooms; no private calendar data shown publicly.
- **Stakeholder and organization intake** (`stakeholder-intake`) — Reception/intake on Floor 1; relationship graph on Floors 3 and 6.
- **Stakeholder people/organizations and initiative relationship graph** (`stakeholder-graph`) — People + Network layer and access-controlled relationship views; not a public contact database.
- **Meetings, participants and commitments** (`meetings-commitments`) — Interview / Stakeholder Meeting rooms plus institutional follow-through in Penthouse Command.
- **Credentials, citations, proclamations and proof documents** (`credentials-proof`) — Evidence + Proof Archive and institutional record.
- **Canonical publications and versions of record** (`publications`) — Publication / Submission Review and Policy / Publication / Impact Wall.
- **Approved publication distribution/syndication** (`publication-distribution`) — Access-controlled distribution state on Floor 5; approval authority on Floor 6.
- **Government targets/dockets and recurring docket intelligence** (`government-dockets`) — Policy Lab and monitor/filing surfaces.
- **Government filing/submission workflow** (`government-submissions`) — Publication / Submission Review; final external authorization is a Floor 6 control function.
- **Research/source/government/stakeholder/citation monitors** (`monitoring`) — Policy / Publication / Impact Wall for findings; operations health on Floor 6.
- **Citation snapshots and impact events** (`citations-impact`) — Policy / Publication / Impact Wall and institutional proof.
- **Equity Uprise/McCluster release preparation** (`music-release`) — Media / Release Control; high-risk delivery approval belongs to Floor 6.
- **DDEX ERN delivery** (`ddex`) — Media release pipeline, not a public room.

### Architectural reading

- public/member-facing: **Institutional Salon**
- public/member-facing: **Public institutional mode of Command Wall**
- controlled/back-office: **Penthouse Command authenticated mode**
- controlled/back-office: **Strategy Review**
- controlled/back-office: **Partner / Executive Briefing**
- controlled/back-office: **Control / Audit Records**
- controlled/back-office: **Desk Operations / Systems**
- shared-platform instrument: **Halo Globe / Spatial Intelligence** — public sanitized read-only projection; protected owner/admin operational handoff

**Boundary:** Private control/admin/outreach functions must be access-controlled and must not turn the public building into a surveillance or tactical control room. The Halo Globe is a shared spatial-intelligence instrument, not permission to expose private data or duplicate Halo's backend.

## Floor 7 — Roof / Mobility Portal

**Role:** ecosystem navigation / departure / arrival.

### Primary repo capabilities

| Capability | Repo function | Status | Visibility |
|---|---|---|---|
| `ecosystem-routing` | Cross-site ecosystem routing/departure/arrival layer | built_as_building_contract | public-navigation |
| `roof-mobility` | Candidate rooftop mobility reservation | schematic_future_feasibility | conceptual |
| `uprise-world` | Uprise World experimental visual system | experimental_separate | optional-route-only |

### Cross-floor capabilities represented here

- None.

### Architectural reading

- public/member-facing: **Ecosystem Routing Interface**
- public/member-facing: **City Overlook**
- public/member-facing: **Candidate Mobility Zone**
- controlled/back-office: **Service / Equipment Band**

**Boundary:** Passenger-elevator roof service is not assumed. Mobility remains a candidate reservation pending real-world feasibility.


## Public/private fidelity

The building must preserve software permissions rather than flattening everything into public architecture.

### Public or public-facing systems

Examples:
- institutional record;
- topics;
- moderated public perspectives;
- fellowship directory/matching;
- public profiles;
- verified-organization application;
- evidence/public record;
- approved publications;
- media/catalogue;
- rally/culture archive;
- Level 7 ecosystem routing.

### Member/private systems

Examples:
- dashboard state;
- applications and saves;
- private contact details;
- owned conversation threads;
- interview/calendar state;
- internal research workspaces.

### Staff/editor/admin systems

Examples:
- moderation queues;
- fellowship listing review;
- stakeholder relationship state;
- manuscript review;
- publication/distribution controls;
- government filing controls;
- music delivery/DDEX controls;
- approval decisions;
- OAuth/integration state;
- jobs/workflows;
- monitoring health;
- outreach;
- audit/event history.

A private capability may be represented by a room or support zone without becoming anonymously clickable or publicly readable.

## Political/public-issue neutrality

Equity Uprise contains policy and public-issue work. The building therefore needs spaces for public conversation, research, evidence, publication and government-facing work.

Those spaces must not encode a partisan or ideological answer into the architecture.

Floor 2 represents **participation and documented issue framing**, not a preferred political position.  
Floor 5 represents **research/evidence/publication/filing workflows**, not an endorsement engine.  
Floor 6 represents **institutional operations and approvals**, not a political command center.

The neutral-listening posture implemented by `eu-converse` remains the correct behavioral model for the Public Forum.

## Shared-platform fidelity

Some capabilities Equity Uprise uses are provided by broader McCluster systems rather than duplicated inside an Equity Uprise-specific stack.

Examples include:
- parts of the music/creator platform;
- hardened outbound delivery infrastructure;
- central control/approval mechanisms.

The building represents the Equity Uprise use of those systems where it matters to the institution. It must not falsely imply that Equity Uprise owns a parallel duplicate backend.

## Current non-final / intentionally constrained systems

The following should remain visually honest:

- **M-Verified:** current web flow is human-reviewed/manual; do not depict automated registry issuance that does not exist.
- **External publication/repository integrations:** code paths exist, but some require credentials/provider configuration.
- **ORCID/Crossref:** integration paths exist; configuration/credentials may still be required.
- **DDEX:** worker/release path exists; external validation/partner configuration is still required.
- **Outbound outreach:** underlying bridge exists but is deliberately not armed by default.
- **Government submission:** implemented as approval-gated; never depict anonymous one-click filing.
- **Level 7 mobility:** candidate reservation only; no approved helipad/vertiport claim.
- **Uprise World:** separate experimental visual system; may become an ecosystem destination but is not building geometry authority.

## Core V2 architectural fidelity

Program reconciliation does not change the already approved Core V2 physical stack:

- 72' × 72' floor plate;
- Floors 1–6 enclosed;
- Level 7 open roof;
- finished floors 0 / 13.5 / 27 / 40.5 / 54 / 67.5 / 81 ft;
- passenger elevator X54–62 / Y34–44, Floors 1–6;
- freight/service elevator X0–8 / Y60–72;
- revised Stair B X8–18 / Y54–72;
- Stair A X60–72 / Y54–72;
- continuous 13'-6" schematic stair transitions;
- canonical 3 ft south-facing protected-stair access openings at every served level;
- Stair A roof door X61.5–64.5 / Y54 and Stair B roof door X14–17 / Y54;
- both protected-stair upper landings meet the +81 ft roof walking plane exactly;
- coordinated slab openings;
- Floor 1 only ground-level public entrance.

Physical construction/code compliance remains outside the proof provided by deterministic geometry.

## Interaction corrections required by the audit

The production routing model must:
- use the zone `route_key` from `core-v2-floor-programs.json`;
- distinguish generic building navigation from passenger-elevator destinations;
- offer passenger-elevator destinations only on Floors 1–6;
- expose no passenger-elevator hotspot on Level 7;
- keep the freight/service elevator non-public;
- declare access metadata for private routes;
- keep arbitrary external redirects disabled;
- never expose approval-gated operations as anonymous/public actions.

These rules are enforced by:
`production/verify_equity_uprise_program_coverage.py`.

## Canonical program authority after this audit

For deciding **what Equity Uprise contains and which floor represents it**, authority is:

1. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
2. `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`
3. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`
4. `docs/design/equity-uprise-building/production/core-v2-floor-programs.json`
5. floor-specific long-form spec
6. floor-specific schematic basis
7. Core V2 DXF/SVG/PNG
8. deterministic production package
9. generated 3D/render/web output.

For **geometry**, `BUILDING-CORE-V2-SPEC.md` and `production/building-core-v2.json` remain above floor-local artifacts.

## Validation evidence — 2026-09-22

The current reconciliation is backed by deterministic repo, program, plan, geometry, and walking-plane gates:

| Layer | Result | What it proves |
|---|---:|---|
| Repo-source classification | **253 sources classified** | Current source ledger contains 102 capability sources and 151 explicitly support/development-authority sources. The exact discovered-set gate remains enforced by `verify_equity_uprise_repo_sources.py`. |
| Repo-source validator | **912 / 912 passed** | The discovered source set, classifications and support/capability accounting match the current repository state. |
| Capability / floor / routing coverage | **466 / 466 passed** | All 56 canonical capabilities are assigned to their primary and declared secondary floors; interaction-mode and zone routes resolve; private/high-risk routes remain non-public; Halo public mode is read-only with owner-authenticated operational handoff; Level 7 does not imply passenger-elevator service. |
| Generated plan semantics | **488 / 488 passed** | Active Core V2 SVG/DXF/PNG sets exist for B1 and Floors 1–7 and remain machine-checked against canonical labels/program semantics. |
| Level 7 detailed roof | **45 / 45 inventory records; 15 / 15 build checks passed** | The current Level 7 builder represents the complete reconciled roof inventory and visual-completeness requirements. |
| B1→Level 7 walkability | **44 / 44 checks passed** | Exact elevations/rises, 22-riser stair math, access openings, slab openings, roof-door state, roof walking-plane connection, Level 7 capability set, and passenger-elevator exclusion are coherent. |
| Combined stacked geometry | **840 meshes / 41 / 41 checks passed** | The combined GLB must prove eight physical elevations, all protected-stair transitions, real served-level stair openings, vertical shafts, Level 7 headhouse caps, and the Floor 6 Halo envelope. |

Canonical audit support files:
- `production/equity-uprise-repo-source-map-v2.json`
- `production/verify_equity_uprise_repo_sources.py`
- `production/verify_equity_uprise_program_coverage.py`
- `production/verify_core_v2_plan_semantics.py`
- `production/generated/equity-uprise-program-coverage-report.json`
- `production/generated/equity-uprise-core-v2-plan-semantics-report.json`
- `production/generated/equity-uprise-building-core-v2-report.json`

Current combined deterministic chassis: **840 meshes**, **41/41 checks passing**, SHA-256 `afebd08c811d083b6ae957677cedbff51d4c629e36a19341eddc385b3e8e28c7`. The Level 7 detailed roof is **283 meshes**, **45/45 inventory records**, **15/15 checks passing**. These exact values remain independently recorded in generated reports and must stay current in CI.

These checks establish current repo/building consistency. They do **not** establish building-code compliance, permit readiness, structural adequacy, accessibility compliance, fire/life-safety compliance, or operational aviation feasibility.

## Audit verdict

Against the Equity Uprise functionality currently implemented or explicitly represented in this repository:

- the **six enclosed floors + roof hierarchy is retained**;
- every audited capability has a primary floor;
- cross-floor workflows have explicit secondary-floor representation;
- public/private/approval boundaries are encoded in the capability map;
- semantic floor labels have been tightened to match actual repo functions;
- the old floor-local vertical-core problem remains fixed by Core V2;
- Level 7 passenger-elevator semantics are corrected;
- Floor 6 contains one permissioned Halo Globe / Spatial Intelligence instrument without changing the shared shell/core;
- the previously weakly expressed capabilities on Floors 3–6 now have explicit interaction modes rather than extra rooms;
- no extra decorative department/floor is required.

Future Equity Uprise features must update the capability map and pass program-coverage validation before architectural work treats the building as complete.


### B1 / Floor 1 digital-twin completion

The current Core V2 branch now includes a non-developmental B1 technical/service basement and a Floor 1 exterior/site/exit-discharge simulation layer.

B1 does not add an Equity Uprise product capability ID and does not consume an E-Q-U-I-T-Y developmental stage.

Floor 1 remains the modeled level of exit discharge.

The building validators now check:
- B1 vertical-system continuity;
- B1 program/core overlap;
- protected-stair discharge doors;
- basement-direction discharge controls at Floor 1;
- public-way/site egress concepts;
- two assembly areas;
- emergency-action-plan components;
- Floor 1 linkage to the canonical B1/site authorities.


## Derived-artifact regeneration gate

After the 2026-09-21 Floor 1/B1 authority reconciliation, committed derived artifacts must be regenerated from the current machine authorities before the building is treated as render-current. This includes Floor 1/B1 production JSON, active DXF/SVG/PNG plans, plan-generation manifest, generated validation reports, and the combined B1-to-roof GLB. A green source validator without a post-authority publish is not sufficient evidence that committed render artifacts are current.


### Current-pass publication checkpoint

Final current-pass derived-artifact publish completed after the Floor 1 render-readiness status and later-floor authority demotion changes. The committed generated snapshot now matches the current authority and is guarded by CI drift detection.


### Deterministic derived-artifact guarantee

DXF run-specific header metadata and program-coverage set iteration are normalized so committed derived artifacts can be checked byte-for-byte for deterministic drift.
