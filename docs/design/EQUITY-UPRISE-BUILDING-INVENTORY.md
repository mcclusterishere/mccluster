# Equity Uprise Building UI — Repo Inventory & Image Plan

> Status: **CORE V2 GEOMETRY + REPO CAPABILITY RECONCILIATION ACTIVE ON `architecture/equity-uprise-core-v2`; SIX ENCLOSED FLOORS + LEVEL 7 ROOF RETAINED; PROGRAM AUTHORITY NOW BINDS TO THE 2026-09-21 CAPABILITY MAP.**
> Purpose: turn the existing Equity Uprise ecosystem into a navigable building UI rather than inventing generic rooms.
> Full repo audit: `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
> Canonical Floor 1 spec: `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`
> **Mandatory spatial authority:** `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`
> Canonical Floor 1 plan assets: `docs/design/equity-uprise-building/references/floor-01/`
> Canonical Floor 2 spec: `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
> Canonical Floor 2 plan basis: `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
> Canonical Floor 2 plan assets: `docs/design/equity-uprise-building/references/floor-02/`
> Canonical Floor 3 spec: `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md`
> Canonical Floor 3 plan basis: `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md`
> Canonical Floor 3 plan assets: `docs/design/equity-uprise-building/references/floor-03/`
> Canonical Floor 4 spec: `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md`
> Canonical Floor 4 plan basis: `docs/design/equity-uprise-building/FLOOR-04-SCHEMATIC-PLAN-BASIS.md`
> Canonical Floor 4 plan assets: `docs/design/equity-uprise-building/references/floor-04/`
> Canonical Floor 5 spec: `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md`
> Canonical Floor 5 plan basis: `docs/design/equity-uprise-building/FLOOR-05-SCHEMATIC-PLAN-BASIS.md`
> Canonical Floor 5 plan assets: `docs/design/equity-uprise-building/references/floor-05/`
> Canonical Floor 6 spec: `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
> Canonical Floor 6 plan basis: `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`
> Canonical Floor 6 plan assets: `docs/design/equity-uprise-building/references/floor-06/`
> Canonical Level 7 spec: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md`
> Canonical Level 7 plan basis: `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md`
> Canonical Level 7 ecosystem contract: `docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`
> Canonical Level 7 plan assets: `docs/design/equity-uprise-building/references/floor-07/`
> Level 7 origin/pre-program: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md`

## Core V2 vertical-circulation migration

> Branch authority: `architecture/equity-uprise-core-v2`
>
> Shared source: `equity-uprise-building/BUILDING-CORE-V2-SPEC.md` + `equity-uprise-building/production/building-core-v2.json`.

The building remains six enclosed occupied floors plus Level 7 roof, but its vertical-circulation model is revised so the floors exist as one physically stacked 3D building rather than independent floor-local scenes.

### Shared finished-floor elevations
- Floor 1: **0'-0"**
- Floor 2: **+13'-6"**
- Floor 3: **+27'-0"**
- Floor 4: **+40'-6"**
- Floor 5: **+54'-0"**
- Floor 6: **+67'-6"**
- Level 7 roof: **+81'-0"**

### Shared Core V2 systems
- passenger elevator: **X54–62 / Y34–44**
- West Service Core: **X0–18 / Y54–72**
- service/freight elevator: **X0–8 / Y60–72**
- revised Stair B: **X8–18 / Y54–72**
- Stair A: **X60–72 / Y54–72**
- MEP/riser: approximately **X50–60 / Y66–72**

Both protected stairs are required to physically traverse the full **13'-6"** between level datums in the combined deterministic model. Shared slab openings are coordinated in `building-core-v2.json`.

The freight/service elevator is additional service circulation. It is not treated as a replacement for a required stair/exit.

### North support-band consequence on Floors 1–6
Common replanned geometry:
- west service approach: **X0–18 / Y54–60**
- public/support corridor: **X18–60 / Y54–60**
- Restroom A: **X18–26 / Y60–70**
- Restroom B: **X26–34 / Y60–70**
- floor-specific support A: **X34–42 / Y60–72**
- floor-specific support B: **X42–50 / Y60–72**
- janitor: **X50–54 / Y60–66**
- MEP/riser: **X50–60 / Y66–72**

Public-facing floor identities remain stable where practical; support/service geometry yields to the shared vertical core.

## 2026-09-21 repo capability reconciliation

The building program is now explicitly bound to:

- `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
- `docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`
- `docs/design/equity-uprise-building/production/core-v2-floor-programs.json`

The capability map currently tracks **51 repo-grounded capabilities** and distinguishes implemented, approval-gated, manual, externally configurable, shared-platform, intentionally unarmed, schematic-future and experimental-separate states.

### Floor roles after reconciliation

| Level | Identity | Repo-faithful role | Canonical semantic anchors |
|---|---|---|---|
| 1 | Lobby + Intake | arrival / trust / verification / intake / routing | Arrival / Identity Wall; Intake / Verification Consultation; Arrival / Routing Directory |
| 2 | Public Forum | listen / discuss / record / member context | Public Forum; Topics / Perspectives / Conversations Wall; Listening Lounge; Member Check-In |
| 3 | Fellowship + Network | people / opportunities / relationships / meetings | Opportunity Exchange; Opportunity / Network Wall; People + Network Lounge; Interview / Stakeholder Meeting A/B; Member / Meeting Check-In |
| 4 | Media + Culture | listen / create / edit / archive / release | Media / Listening Zone; Media / Release Wall; Rally Gallery; Creator Recording; Edit / Review; Media / Release Control |
| 5 | Policy + Proof | research / evidence / publication / filings / impact | Policy Lab; Policy / Publication / Impact Wall; Evidence + Proof Archive; Source Review; Publication / Submission Review; Research / Publication Navigator |
| 6 | Penthouse Command | institutional direction / Desk / approvals / operations | Institutional Command Wall; Institutional Salon; Strategy Review; Partner / Executive Briefing; Control / Audit Records; Desk Operations / Systems |
| 7 | Roof / Mobility Portal | ecosystem navigation / departure / arrival | Ecosystem Routing Interface; City Overlook; Candidate Mobility Zone |

### What this means

The building is **not** one room per webpage, API or database table.

A physical zone may represent a coherent family of related capabilities:
- Floor 3 compresses fellowships, profiles, stakeholders, meetings, commitments and relationship workflows;
- Floor 4 compresses catalogue/listening, artists, recording/editing, approved derivatives, rights/release state and DDEX operations;
- Floor 5 compresses initiatives, research workspace, sources/claims/evidence, manuscripts, publications, government submissions, monitors, citations and impact;
- Floor 6 compresses the public institutional Desk plus access-controlled moderation, approvals, integrations, automation, outreach, status and audit state.

Private software remains private in the building metaphor. A room representing an internal system does not make its data publicly visible.

### Interaction correction

Passenger-elevator service is canonical only for Floors **1–6**. Level 7 remains reachable by the protected stairs unless a later professional design establishes a real passenger-elevator roof stop. The production routing generator and program validator enforce this distinction.

### Ongoing completeness gate

Any future feature that materially changes Equity Uprise must:
1. be added to the capability map;
2. receive a primary floor or explicit exclusion;
3. receive secondary-floor mappings where the workflow crosses levels;
4. preserve its real access/approval boundary;
5. pass `production/verify_equity_uprise_program_coverage.py`;
6. only then be treated as represented by the building.

## 1. What exists today

### A. Institutional Desk — `equity-uprise.html`
Primary public-facing Equity Uprise page.

#### View 01 — NOW
Current work and live issue intelligence.

Existing content:
- Public affairs
- Policy intelligence
- Civic media
- Current infrastructure/data-center policy work
- Research-to-public-record operating model
- Working paper / policy architecture

Current policy modules:
1. Classification + aggregation
2. Sound + low-frequency acoustics
3. Water + cooling
4. Power + generation
5. Independent review
6. Continuing compliance

#### View 02 — PAST WORK
Documented case files and prior work.

Current case-file modules:
1. Docket 516R
2. DeKalb District 3 campaign media + marketing
3. October 5 convening
4. Policy memo programs
5. Urban Leaders Fellowship — external/provenance-separated
6. Infrastructure practice

Existing proof/credential material:
- Connecticut General Assembly citation — McCluster Corp
- Connecticut General Assembly citation — Matthew McCluster
- Bridgeport Equity Uprise Human Rights Day proclamation
- Georgia Youth Innovation & Civic Leadership Week proclamation
- Docket 516 / 516R Evidence Room
- Data-center infrastructure engagement record

#### View 03 — JOIN
Existing participation paths:
- Join as a fellow
- Join as an organization
- Operators / developers / utilities / builders / suppliers
- Residents / environmental groups / ratepayer advocates
- Foundations / universities / neutral civic institutions
- Bring a live issue

---

### B. Fellowship + Artists face — `equity-uprise-fellowship.html`
Separate public face of Equity Uprise.

Existing themes/modules:
- Equity Uprise origin story
- Policy work / policy memo history
- Healthy School Meals blueprint
- Docket 516 / 516R record
- Fellowship record
- People / fellows
- October 5 Bridgeport program
- Ways to participate
- Artists / civic anthem submissions
- Partnership / sponsorship pathways

Related pages:
- `fellowship.html` — Policy Fellowship application
- `fellowships.html` — fellowship directory
- `topics.html` — public issue/topic participation
- `profile.html` — public/member profiles
- `verify.html` — verified profile / organization record

---

### C. Equity Uprise platform rooms
Documented in `docs/equity-uprise-platform.md`.

Existing platform rooms:
1. `topics.html`
   - topic hubs
   - issue framing
   - documented context
   - structured questions
   - open responses
   - related programs

2. `fellowships.html`
   - fellowship explorer
   - matching
   - sources
   - host listing form

3. `profile.html`
   - public profile
   - people directory
   - self-editing
   - private contact card

4. `dashboard.html`
   - matches
   - application tracker
   - saves
   - perspectives
   - conversation threads

5. `uprise-admin.html`
   - moderation
   - listings
   - conversations
   - topic copy
   - people/roles
   - activity log

---

### D. Evidence / research / record systems
These are major Equity Uprise destinations and should not be treated as minor links.

- `docket-516.html` — Evidence Room / Docket record
- `policy.html` — policy archive
- `policy-memo-dna.html` — policy memorandum
- credential PDFs under `assets/credentials/`
- infrastructure engagement record
- current working paper embedded in Institutional Desk

---

### E. Culture / media systems
Existing Equity Uprise media/culture layer:

- `album.html?album=equity-uprise` — Equity Uprise music/catalogue
- native music-engine link from Institutional Desk
- October 5 program / broadcast archive
- civic anthem submission path
- creator / artist participation through the Fellowship + Artists face

---

### F. Community / participation systems
Existing human-facing participation layer:

- Fellows
- Fellowship directory
- Topic discussions
- Profiles / people directory
- Organization participation
- Public issue submissions
- Partnerships
- Sponsorship
- Verified profiles / organizations

---

### G. Internal operating systems
These exist but should probably be represented as private/back-of-house spaces rather than public-facing floors.

- `uprise-admin.html` — desk/admin room
- Equity Uprise database/platform tables
- conversations
- moderation
- campaigns
- recipients
- suppressions
- audit log
- worker/automation infrastructure

---

### H. Uprise World — experimental/unfinished
Existing experimental world work lives under:
- `_unfinished/uprise-world/`
- `docs/uprise-world/`

Important: this is a separate visual system and should not accidentally dictate the new building art.

Existing concepts include:
- Uprise World
- Proof Room
- landmarks
- documents / discovery
- interactive environment
- Living Sketch style experiment

The building UI can link to or contain an entry point to this world later, but the building redesign should be its own coherent system.

---

## 2. Locked building information architecture — six enclosed floors + roof level

The building is intentionally compact: **six enclosed occupied floors plus a seventh navigable roof level**. Wider, more useful floors are preferred over a tall decorative tower.

| Level | Locked identity | Real Equity Uprise functions compressed into the level | Builder-spec status |
|---|---|---|---|
| 7 | Roof / Mobility Portal | Rooftop overlook, vertical arrival, **ecosystem-plane cross-site navigation/departure/arrival**, candidate mobility zone pending operational feasibility | **CANONICAL SPEC + SCHEMATIC GEOMETRY LOCKED** |
| 6 | Penthouse Command | Institutional overview, current live work, direction / high-level strategy, transition/access to roof | **LOCKED** |
| 5 | Policy + Proof | initiatives, research workspace, sources/claims/evidence, Docket 516R, manuscripts, publications, filings, monitors, citations/impact | **LOCKED** |
| 4 | Media + Culture | event media, music/catalogue, artists, civic anthems, recording/editing, release/rights/DDEX, cultural storytelling | **LOCKED** |
| 3 | Fellowship + Network | Policy Fellowship, directory/matching, profiles, stakeholders, relationships, meetings/commitments, partner network | **LOCKED** |
| 2 | Public Forum | topics, perspectives, neutral listening/conversations, member dashboard context, discussion/activity | **LOCKED** |
| 1 | Lobby + Intake | arrival, reception, verification, stakeholder/organization intake, visitor orientation, routing | **LOCKED** |

Do not add extra enclosed floors merely because a separate web page exists. Level 7 is the intentionally approved roof level.

### Floor 1 canonical file

`docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`

### Builder-spec workflow

Each remaining floor must be completed one at a time:

1. audit the repo functions that belong on that floor;
2. write a real-building program and adjacency description;
3. lock vertical-core continuity;
4. define the 360 coordinate system and required cardinal views;
5. define what may and may not appear;
6. review the written spec;
7. only then generate or revise the 360 panorama.

---

## 3. Locked building hierarchy and physical continuity

The vertical narrative is:

**arrival → public conversation → people/opportunity → culture/media → policy/proof → institutional direction → rooftop mobility / departure**

### Fixed vertical core

The elevator is a single real shaft.

- It remains in the exact same plan location on Floors 1–6.
- Floor 6 must preserve a viable continuation of vertical access to Level 7. Final elevator service to the roof is subject to professional/code/engineering design; stair-based roof access must remain possible.
- In canonical 360 panoramas it occupies the **+90° / right quadrant** relative to the fixed camera.
- Stairs/service risers remain vertically aligned as well.
- A floor's furniture program may never displace or relocate the core.

### Exterior-access rule

- **Floor 1 is the only ground-level public entrance.**
- Floors 2–6 have no exterior doors in their 360 environments.
- Floors 2–6 have no balconies or terraces.
- Upper-floor perimeter glazing is sealed building glazing unless a later architectural revision explicitly changes the shell.
- **Level 7 is the open-air roof destination** and is reached from the interior vertical core; it is not a second building entrance.
- The roof may contain a **candidate mobility pad / helipad zone**, but exact aviation geometry remains unlocked until site/aircraft/regulatory/structural feasibility is established.

### Canonical interior 360 orientation

- **0° / image center:** primary identity/function wall for that floor.
- **+90° / right quadrant:** fixed elevator/core.
- **180° / panorama seam:** opposite side of room.
  - Floor 1: main public entrance crosses this seam.
  - Floors 2–6: enclosed interior/perimeter wall/circulation, never an outside door.
- **-90° / left quadrant:** secondary program zone.

The virtual camera stays in approximately the same plan position relative to the core on every level.

### Level 7 ecosystem-plane rule

Level 7 is the permanent cross-site ecosystem layer.

- Equity Uprise is one website/building in a larger website/building network.
- Users leave/arrive through the Level 7 roof experience.
- Helicopter/vertical-lift travel is the canonical transition metaphor.
- The roof plan does **not** map every website.
- Destinations must be data-driven through the Level 7 ecosystem-routing contract.
- New websites/buildings should be able to register as destinations without changing Equity Uprise roof geometry.

### Architectural character

The building is a compact civic-policy institute, not a luxury skyscraper.

Base language:
- charcoal stone / mineral finish;
- blackened or gunmetal steel;
- smoked/clear glass;
- warm wood used sparingly;
- honed stone or polished concrete;
- warm practical white lighting;
- restrained red accent lighting.

Empty space is allowed. Quality is preferred over object count.

---
## 4. Interaction model

### Default state
- User enters at Penthouse / Command.
- The building is the navigation surface.
- No conventional card-grid homepage should compete with it.

### Scroll
- Vertical scroll moves downward through the building.
- Each floor remains spatially consistent.
- Floor numbers / labels can remain pinned as navigation.

### Click / tap
Clicking a room should:
1. visually select the room
2. run a short camera/pan/zoom transition
3. reveal the room's dedicated UI state
4. provide a clear way back to the building overview

### Transition language
Use cinematic environmental transitions rather than normal page fades:
- camera push-in
- lateral pan
- elevator travel
- steel shutters / doors
- light-up floor indicator
- room illumination
- focus rack / depth shift
- red guide-light activation

Do not make navigation slow. The animation should sell place, then get out of the way.

---

## 5. Image asset families required

Do **not** attempt to generate everything as one final image.

### BUILDING MASTER ASSETS
- vertical master cutaway — full tower
- wide master cutaway — same exact tower/composition adapted for desktop
- mobile-safe master derivative
- clean building-only version with minimal/no labels
- labeled navigation version

### FLOOR ASSETS
One close-up master for each approved floor/zone.

Each room needs:
- idle/default state
- selected/active state
- optional highlighted hotspot state

### TRANSITION ASSETS
Depending on implementation:
- floor-to-floor transition plates
- room-entry transition frames
- elevator/shaft transition
- door/shutter foreground plates
- light/glow overlays

### UI OVERLAYS
- floor numbers
- labels
- hotspot markers
- selection rings
- room title plates
- back/return control
- scroll/floor indicator
- cinematic frame treatment

### MATERIAL ASSETS
- worn blackened steel
- brushed gunmetal
- edge wear
- red emissive channel
- smoked glass
- dark marble / composite surface
- subtle industrial fasteners / seams

---

## 6. Same-building consistency requirements

The vertical and wide masters must be recognizably the **same exact building**.

Lock before production:
- facade silhouette
- number of floors
- floor heights
- window geometry
- structural columns
- exterior tower crown
- elevator/service spine
- room order
- major furniture silhouettes
- red-light positions
- major signage positions

Do not independently prompt two unrelated buildings and call them variants.

Preferred workflow:
1. establish one canonical building master
2. approve architecture
3. derive alternate compositions from that master
4. derive floor close-ups from that master
5. derive transition plates from those approved states

---

## 7. Visual direction

Target:
- premium cinematic industrial
- slightly worn blackened steel
- brushed / machined gunmetal
- restrained edge wear
- red emissive channels
- smoked glass
- strong shadow / practical lighting
- expensive architecture
- real-world material weight

Avoid:
- generic sci-fi dashboard
- videogame HUD spam
- neon cyberpunk overload
- cartoon icons
- random rooms that do not map to Equity Uprise
- text baked into image when HTML should render it
- fake HM branding throughout the Equity Uprise environment

The HM logo/reference is a **material-direction reference only**, not the Equity Uprise building identity.

---

## 8. Production order

1. Approve this inventory.
2. Approve final floor/room list.
3. Approve floor order.
4. Create a simple building diagram / wireframe.
5. Lock canonical architecture.
6. Generate vertical master.
7. Derive wide master from the approved vertical architecture.
8. Generate room close-ups in batches.
9. Generate transition plates.
10. Build hotspot/label overlay system in HTML/CSS/JS.
11. Implement and test scroll/navigation.
12. Only then polish motion and secondary UI.

---

## 9. Locked decisions and quality-control gate

The following are no longer open questions:

- enclosed occupied floors: **6**;
- navigable roof level: **Level 7 — Roof / Mobility Portal**;
- Floor 1: **Lobby + Intake**;
- Floor 2: **Public Forum**;
- Floor 3: **Fellowship + Network**;
- Floor 4: **Media + Culture**;
- Floor 5: **Policy + Proof**;
- Floor 6: **Penthouse Command**;
- Level 7: **Roof / Mobility Portal**;
- only Floor 1 has a ground-level public exterior entrance;
- Floors 2–6 have no exterior doors/balconies/terraces;
- Level 7 is intentionally open-air and reached from the internal core;
- Floor 6 must preserve roof-access/core continuity;
- elevator/core location is fixed vertically;
- 360 camera orientation is fixed relative to the core;
- HM graphics are not Equity Uprise building branding;
- room content must map to audited Equity Uprise functions.

### Current quality-control status

**Floor 1 — LOCKED**

Canonical file:
`docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md`

**Floor 2 — LOCKED**

Canonical files:
- `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-02/`

**Floor 6 — LOCKED**

Canonical files:
- `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`
- `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/references/floor-06/`

**Level 7 — CANONICAL ROOF GEOMETRY + ECOSYSTEM SEMANTICS LOCKED; OPERATIONAL HELIPAD/VERTIPORT FEASIBILITY PENDING**

Do not treat prior generated floor images as architectural authority. They are concept iterations only.

Proceed one floor at a time.
