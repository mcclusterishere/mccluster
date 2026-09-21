# Equity Uprise — Repository Audit for Building / 360 Environment Design

> Audit date: 2026-09-20  
> Scope: the complete Equity Uprise surface in `mcclusterishere/mccluster` as it affects the physical-building metaphor, floor program, 360-room generation, navigation, and future implementation.  
> Architectural rule: the building must represent functions that actually exist in the Equity Uprise product/program. Do not invent generic rooms merely to fill space.

## Executive conclusion

Equity Uprise is not one page. It is a connected civic-policy platform with six broad functional families:

1. **Institutional / live work** — current issues, policy intelligence, public affairs, working papers and institutional engagements.
2. **Evidence / proof / archive** — Docket 516R, case files, citations, proclamations, technical records and policy documents.
3. **Media / culture** — event media, civic explainers, broadcasts, music, artists and civic anthems.
4. **Fellowship / opportunity / network** — fellowship applications, fellowship directory, profiles, matching and people.
5. **Public participation / member activity** — topics, perspectives, conversations, saves, applications and personal dashboards.
6. **Operations / research infrastructure** — moderation, research workspaces, publishing, monitoring, government submissions, calendar, intake, automation and audit/control systems.

The six-floor building should compress these real functions into a legible physical hierarchy rather than create one room per web page.

---

## 1. Public-facing Equity Uprise surfaces

### `equity-uprise.html` — Institutional Desk

This is the primary institutional face.

It has three top-level modes:

- **Now**
  - current public-affairs / policy-intelligence work;
  - current infrastructure and data-center governance work;
  - research-to-public-record operating model;
  - working paper / policy architecture.

- **Past work**
  - Docket 516R;
  - DeKalb District 3 campaign media + marketing;
  - October 5 convening;
  - policy memo programs;
  - Urban Leaders Fellowship, explicitly separated by provenance;
  - infrastructure practice;
  - metrics and proof documents.

- **Join**
  - fellows;
  - organizations;
  - operators / developers / utilities / builders / suppliers;
  - residents / environmental groups / ratepayer advocates;
  - foundations / universities / neutral civic institutions;
  - live-issue engagement intake.

The current working-paper modules are:
1. classification + aggregation;
2. sound + low-frequency acoustics;
3. water + cooling;
4. power + generation;
5. independent review;
6. continuing compliance.

### `equity-uprise-fellowship.html` — Fellowship + Artists face

This is the narrative/community-facing side of the program.

It includes:
- origin story;
- policy-history material;
- Georgia school-meals work;
- Docket 516 / 516R record;
- fellowship record;
- people/fellows;
- October 5 Bridgeport programming;
- artist/civic-anthem participation;
- partnerships and sponsorship.

### `fellowship.html`

Policy Fellowship application / review surface.

### `fellowships.html`

Fellowship/opportunity directory with:
- matching;
- directory browsing;
- program-source transparency;
- host-submitted program listing queue;
- program metadata and eligibility.

### `topics.html`

Public issue-participation surface with:
- neutral framing;
- documented context;
- structured questions;
- open responses;
- conversation handoff;
- public perspectives;
- related programs.

### `profile.html`

People/network surface with:
- public profiles;
- directory;
- interests/goals;
- geographic matching;
- host/program role;
- controlled contact information;
- profile privacy states.

### `dashboard.html`

Signed-in personal/member workspace with:
- fellowship matches;
- application tracker;
- saved programs;
- recorded perspectives;
- conversation threads;
- next-step guidance.

### `verify.html`

Organization/profile verification intake with legal/business identity and registry-based proof fields.

### `docket-516.html`

Evidence Room / public-record explainer and searchable Docket 516/516R document system.

### `policy.html`

Policy archive / multi-project policy record.

### `policy-memo-dna.html`

Full policy memorandum.

### `walls/eu-rally.html`

October 5 / Equity Uprise Rally photographic wall/archive.

### Music / catalogue

Equity Uprise links into the native music/catalogue system, including the Equity Uprise album and civic-anthem participation.

---

## 2. Platform data model and digital rooms

`docs/equity-uprise-platform.md` defines a real platform, not a marketing mockup.

The documented public/application rooms are:
- `topics.html`;
- `fellowships.html`;
- `profile.html`;
- `dashboard.html`;
- `uprise-admin.html`.

The platform distinguishes:
- profiles;
- private contact details;
- topics;
- public perspectives;
- conversations/messages;
- fellowship sources;
- fellowship listings;
- saves;
- applications;
- campaigns;
- recipients;
- suppressions;
- append-only audit history.

The architecture therefore needs spaces for:
- public listening;
- opportunities;
- people/network;
- private member work;
- internal operations.

It does **not** need a separate decorative room for every database table.

---

## 3. Intake, conversation and routing capabilities

### `supabase/functions/eu-intake/index.ts`

Public intake accepts:
- stakeholder intake;
- fellowship intake.

The browser cannot choose privileged publication/approval states.

Physical-building implication:
- the lobby needs a believable **public intake / reception function**;
- it does not need to expose administrative workflow controls.

### `supabase/functions/eu-converse/index.ts`

The listening desk:
- hears what a visitor cares about;
- records interests/goals;
- recommends real fellowship/program matches;
- can file a perspective with consent;
- can hand a thread to a human.

Physical-building implication:
- the first floor should include a **human-scale consultation/intake room** or desk;
- public issue conversation belongs visually to the public-participation ecosystem, not to a giant command center.

### `supabase/functions/eu-calendar/index.ts`

Handles:
- public derived interview slots;
- interview requests;
- approved event creation.

Physical-building implication:
- scheduled visitor/fellow interviews need a small meeting/intake room;
- no giant scheduling room is warranted.

---

## 4. Research, policy and publication operations

### `supabase/functions/eu-workspace/index.ts`

Authenticated collaboration for fellows/researchers/editors:
- create research projects;
- add and verify sources;
- add claims;
- link evidence;
- write manuscript sections;
- review/comment;
- approve sections.

### `supabase/functions/eu-publish/index.ts`

Canonical publication gate:
- manuscript readiness;
- publication approval;
- rendering/package creation;
- distribution planning;
- approval-gated distribution.

### `supabase/functions/eu-government/index.ts`

Government-submission workflow:
- draft/create;
- update;
- preflight;
- approval-gated submission.

### `supabase/functions/eu-monitor/index.ts`

Recurring intelligence monitoring:
- RSS;
- source health;
- research literature;
- government/regulatory dockets;
- legislation/agendas;
- stakeholder sites;
- citations;
- custom APIs.

Physical-building implication:
- policy/evidence/research belong primarily on **Floor 5 — Policy + Proof**;
- operating systems themselves are back-of-house and should not dominate the public environment.

---

## 5. Music / culture operations

### `supabase/functions/eu-music/index.ts`

Supports:
- release creation;
- metadata and rights preflight;
- approval-gated DDEX delivery.

Together with the public Equity Uprise album, civic anthems, event media and artists, this justifies a dedicated **Media + Culture** identity on Floor 4.

---

## 6. Administrative / control plane

### `uprise-admin.html`

Internal desk includes:
- perspectives moderation;
- fellowship listings queue;
- conversations;
- topics;
- people and roles;
- audit log.

### `supabase/functions/eu-control/index.ts`

Approval/capability control surface.

### `supabase/functions/eu-status/index.ts`

Operational health for integrations, distribution targets, jobs, monitors, OAuth, fellowship/interview queues.

Physical-building implication:
- internal controls are **back-of-house**;
- they should not become a public-facing “control room” merely because they exist in software;
- a small staff/service zone can be concealed within the fixed core or future back-office area.

---

## 7. Uprise World

The existing Uprise World work under:
- `_unfinished/uprise-world/`;
- `docs/uprise-world/`;

is a distinct visual/interaction experiment with its own Living Sketch system.

It must **not** be used as architectural authority for the six-floor Equity Uprise building.

It can later be reached through a portal/link if desired, but the building environment remains its own visual system.

---

## 8. Canonical six-floor compression

The approved compact building program is:

| Floor | Identity | Repo functions compressed into the floor |
|---|---|---|
| 6 | Penthouse Command | Institutional overview, current live work, high-level direction |
| 5 | Policy + Proof | Working paper, policy archive, evidence, Docket 516R, credentials, research/proof |
| 4 | Media + Culture | Broadcast/event media, music, artists, civic anthems, cultural storytelling |
| 3 | Fellowship + Network | Fellowship application, directory, profiles, people, opportunity matching |
| 2 | Public Forum | Topics, perspectives, conversations, member activity / discussion |
| 1 | Lobby + Intake | Arrival, reception, visitor orientation, stakeholder/organization intake, routing |

This is a compression model. A floor may contain multiple web destinations.

---

## 9. Building-wide physical continuity rules

These rules override image-generation improvisation.

### Vertical core

- The elevator shaft is one fixed vertical element.
- Its position must be identical in every floor panorama.
- Stair/service cores must remain vertically aligned as well.
- Floor furniture changes; structural/core geometry does not wander.

### Exterior access

- **Floor 1 is the only public floor with an exterior entrance.**
- Floors 2–6 have no doors to outside.
- Floors 2–6 have no balconies or terraces unless a future architectural revision explicitly adds one.
- Upper-floor glazing is sealed perimeter glazing.

### 360 coordinate system

For canonical equirectangular panoramas:

- **0° / image center:** principal identity/function wall for that floor.
- **+90° / right quadrant:** fixed elevator/core zone.
- **180° / panorama seam:** opposite side of the room.
  - Floor 1: main public entrance crosses this seam.
  - Floors 2–6: this becomes enclosed interior/perimeter wall/circulation, never an exterior door.
- **-90° / left quadrant:** secondary program area.

The virtual camera should stay in approximately the same plan position relative to the fixed elevator core on every floor.

### Material continuity

Base building material family:
- dark charcoal stone / mineral finish;
- blackened or gunmetal steel;
- smoked/clear glass;
- warm wood used sparingly;
- polished concrete or honed stone flooring;
- restrained red light accents;
- warm practical white lighting.

Avoid turning each floor into a different sci-fi universe.

### Branding

- Use the approved Equity Uprise mark only.
- Do not redraw, approximate, crop or invent the logo.
- Keep brand applications limited and architectural.
- HM graphics are not Equity Uprise building branding.

---

## 10. Floor 1 conclusion from the audit

Floor 1 should **not** attempt to display the whole Equity Uprise program.

Its real job is:

1. get a visitor in from the street;
2. make the institution identifiable;
3. let a visitor ask where to go;
4. support a short intake/consultation;
5. provide a modest waiting area;
6. control access to upper floors;
7. move the visitor to the elevator.

That is enough.

Canonical Floor 1 builder/360 specification:
`docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`.
