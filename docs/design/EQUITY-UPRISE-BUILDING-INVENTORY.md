# Equity Uprise Building UI — Repo Inventory & Image Plan

> Status: **CORE V2 CURRENT AUTHORITY; B1 + SIX EQUITY FLOORS + LEVEL 7 ROOF; CURRENT PROGRAM AUTHORITY BINDS TO THE 2026-09-21 CAPABILITY AND DEVELOPMENT ARCHITECTURE.**
> Purpose: turn the existing Equity Uprise ecosystem into a navigable building UI rather than inventing generic rooms.
> Full repo audit: `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`
> Canonical Floor 1 semantic identity: **Arrival / Orientation / Intake**  
> Canonical Floor 1 long-form spec (legacy-compatible filename): `docs/design/equity-uprise-building/FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md`  
Legacy-compatible filename; semantic identity is **Arrival / Orientation / Intake**.
> **Mandatory spatial authority:** `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md`
> Canonical Floor 1 interior plan assets: `docs/design/equity-uprise-building/references/floor-01/`  
> Canonical Floor 1 site/egress plan assets: `docs/design/equity-uprise-building/references/floor-01-site/`
> Floors 2–6 are reconciled current-pass program authorities with active real-3D implementations and floor-specific preservation/inventory packages.
> Floor 2: `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md` + `FLOOR-02-PROGRAM-RECONCILIATION.md`
> Floor 3: `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md` + `FLOOR-03-PROGRAM-RECONCILIATION.md`
> Floor 4: `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md` + `FLOOR-04-PROGRAM-RECONCILIATION.md`
> Floor 5: `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md` + `FLOOR-05-PROGRAM-RECONCILIATION.md`
> Floor 6: `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md` + `FLOOR-06-PROGRAM-RECONCILIATION.md`
> Level 7 current program authority: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md` + `FLOOR-07-PROGRAM-RECONCILIATION.md`
> Level 7 preservation map: `docs/design/equity-uprise-building/FLOOR-07-V1-V2-PRESERVATION-MAP.md`
> Level 7 Core V2 plan basis: `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md`
> Level 7 ecosystem-routing contract: `docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md`
> Level 7 inventory / real-3D builder: `docs/design/equity-uprise-building/production/floor-07/floor-07-object-inventory.json` + `build_equity_uprise_floor_07_v2.py`
> Level 7 origin/pre-program remains historical context only: `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md`

> **Program maturity boundary:** Floors 1–7 are reconciled for the current iterative pass. B1 remains a restricted technical/support level. Generated assets remain derived and must match deterministic regeneration; visual approval is still distinct from machine validation.

## Core V2 vertical-circulation authority

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

The capability map currently tracks **56 repo-grounded capabilities** and distinguishes implemented, approval-gated, manual, externally configurable, shared-platform, intentionally unarmed, schematic-future and experimental-separate states.

### Floor roles after reconciliation

| Level | Identity | Repo-faithful role | Canonical semantic anchors |
|---|---|---|---|
| 1 | Arrival / Orientation / Intake | enter / orient / verify / establish Development Passport / route next action | Entry Vestibule; Arrival Atrium; Orientation Lounge; Intake / Verification Consultation; Development Passport Studio; Journey Wall; Reception; Next Action / Building Directory |
| 2 | Public Forum | listen / discuss / record / member context | Public Forum; Topics / Perspectives / Conversations Wall; Listening Lounge; Member Check-In |
| 3 | Fellowship + Network | people / opportunities / relationships / meetings | Opportunity Exchange; Opportunity / Network Wall; People + Network Lounge; Interview / Stakeholder Meeting A/B; Member / Meeting Check-In |
| 4 | Media + Culture | listen / create / edit / archive / release | Media / Listening Zone; Media / Release Wall; Rally Gallery; Creator Recording; Edit / Review; Media / Release Control |
| 5 | Policy + Proof | research / evidence / publication / filings / impact | Policy Lab; Policy / Publication / Impact Wall; Evidence + Proof Archive; Source Review; Publication / Submission Review; Research / Publication Navigator |
| 6 | Penthouse Command | institutional direction / Desk / approvals / operations / spatial intelligence | Institutional Command Wall; Halo Globe / Spatial Intelligence; Institutional Salon; Strategy Review; Partner / Executive Briefing; Control / Audit Records; Desk Operations / Systems |
| 7 | Roof / Mobility Portal | ecosystem navigation / departure / arrival | Ecosystem Routing Interface; City Overlook; Candidate Mobility Zone |

### What this means

The building is **not** one room per webpage, API or database table.

A physical zone may represent a coherent family of related capabilities:
- Floor 3 compresses fellowships, profiles, stakeholders, meetings, commitments and relationship workflows;
- Floor 4 compresses catalogue/listening, artists, recording/editing, approved derivatives, rights/release state and DDEX operations;
- Floor 5 compresses initiatives, research workspace, sources/claims/evidence, manuscripts, publications, government submissions, monitors, citations and impact;
- Floor 6 compresses the public institutional Desk plus access-controlled moderation, approvals, integrations, automation, outreach, status and audit state, with one shared-platform Halo Globe / Spatial Intelligence viewport. The globe is public-visible but sanitized/read-only outside protected owner/admin operation.

Private software remains private in the building metaphor. A room representing an internal system does not make its data publicly visible.

### Halo Globe / spatial-intelligence rule

Floor 6 contains exactly one suspended **Halo Globe / Spatial Intelligence** instrument. It is a permissioned viewport into the shared McCluster Seek First / Hitman's Halo plane, not a separate Equity Uprise backend. Public and ordinary authenticated states are read-only and entitlement-scoped; protected owner/admin operation hands off to the real Halo surface. The globe does not justify a new room, floor, tactical surveillance wall or military-command aesthetic.

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

### Reconciliation proof status

As of the 2026-09-22 roof/whole-building reconciliation:

- **253** Equity Uprise source/support files are classified in the source ledger;
- **102** are directly tied to one or more building capabilities;
- **151** are support/development-authority sources and intentionally do not create additional rooms/floors;
- **56** canonical Equity Uprise capabilities are represented in the building;
- repo-source exact-set classification is enforced by `production/verify_equity_uprise_repo_sources.py`;
- repo-source exact-set audit baseline: **912 / 912 passed**;
- capability/floor/routing audit baseline: **464 / 464 passed** and reruns on every program change;
- generated plan semantic/artifact audit baseline: **437 / 437 passed** and reruns deterministically;
- Level 7 detailed roof: **45 / 45 inventory records**, **15 / 15 build/visual-completeness checks passed**;
- B1→Level 7 schematic human-walkability audit: **41 / 41 passed**;
- combined B1-to-roof geometry remains a mandatory deterministic CI gate; exact current mesh count/SHA live in `production/generated/equity-uprise-building-core-v2-report.json` rather than being duplicated here.

The source classification ledger is:
`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json`.

The capability authority is:
`docs/design/equity-uprise-building/production/equity-uprise-capability-map-v2.json`.

A new Equity Uprise-specific source file must be classified and, when it introduces a real program capability, mapped into the building before the architecture may be called current.

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

## 2. Current building information architecture — B1 + six enclosed floors + roof level

The building is intentionally compact: **six enclosed occupied floors plus a seventh navigable roof level**. Wider, more useful floors are preferred over a tall decorative tower.

| Level | Current working identity | Real Equity Uprise functions compressed into the level | Iterative status |
|---|---|---|---|
| 7 | Roof / Mobility Portal | protected-stair arrival, ecosystem-plane navigation/departure/arrival, city overlook, conceptual candidate mobility zone, optional Uprise World route | **RECONCILED / REAL 3D ACTIVE** |
| 6 | Penthouse Command | Institutional overview, current live work, direction / high-level strategy, permissioned Halo spatial-intelligence viewport, transition/access to roof | **RECONCILED / REAL 3D ACTIVE** |
| 5 | Policy + Proof | initiatives, research workspace, sources/claims/evidence, Docket 516R, manuscripts, publications, filings, monitors, citations/impact | **RECONCILED / REAL 3D ACTIVE** |
| 4 | Media + Culture | event media, music/catalogue, artists, civic anthems, recording/editing, release/rights/DDEX, cultural storytelling | **RECONCILED / REAL 3D ACTIVE** |
| 3 | Fellowship + Network | Policy Fellowship, directory/matching, profiles, stakeholders, relationships, meetings/commitments, partner network | **RECONCILED / REAL 3D ACTIVE** |
| 2 | Public Forum | topics, perspectives, neutral listening/conversations, member dashboard context, discussion/activity | **RECONCILED / REAL 3D ACTIVE** |
| 1 | Arrival / Orientation / Intake | arrival, orientation, Development Passport, verification/intake, next-action routing, building safety and first-stage competency work | **RECONCILED / REAL 3D ACTIVE** |

Do not add extra enclosed floors merely because a separate web page exists. Level 7 is the intentionally approved roof level.

### B1 Underground Operations / Technical Service Basement

B1 sits beneath the developmental building at **-13'-6"** as the restricted **Underground Operations / Technical Service** layer.

It is **not** part of the six-letter E-Q-U-I-T-Y progression and is not a normal public program floor. It is the restricted **Underground Operations / Technical Service** layer and the canonical gateway to the future inter-building tunnel backbone.

Its job is to make the virtual headquarters behave like a serious physical/digital twin by housing:
- mechanical plant;
- electrical/emergency power;
- fire protection/water;
- network/telecom core;
- sump/flood management;
- facilities workshop/storage;
- building-systems lab;
- service receiving/staging;
- Tunnel Operations Concourse / Security Gate;
- Tunnel Portal / Transfer Lock.

Live B1/tunnel access is limited to McCluster house-owner or explicitly delegated underground-operations-admin authority. Ordinary Equity Uprise admin/staff roles do not inherit it. Learner/instructor work occurs in a sandboxed clone.

B1 also creates a persistent training substrate for building systems, emergency response, infrastructure, cybersecurity, continuity and operational decision-support exercises.

Floor 1 remains the modeled level of exit discharge.

Authority:
- `equity-uprise-building/BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- `equity-uprise-building/production/basement-b1-program.json`
- `equity-uprise-building/UNDERGROUND-TUNNEL-NETWORK-SPEC.md`
- `equity-uprise-building/production/underground-tunnel-network.json`

Derived restricted scene package:
- `equity-uprise-building/production/basement-b1/README.md`
- generated B1 manifest/materials/lighting/camera/hotspots/routing/states in the same folder

## Floor 1 canonical long-form file

`docs/design/equity-uprise-building/FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md`

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

## 3. Building hierarchy and physical continuity

The current working vertical narrative is:

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

## 9. Current chassis decisions and iterative-program gate

The following chassis decisions are no longer open questions; floor-program semantics above Floor 1 remain iterative:

- enclosed occupied floors: **6**;
- navigable roof level: **Level 7 — Roof / Mobility Portal**;
- Floor 1: **Arrival / Orientation / Intake** — reconciled for the current iterative pass;
- Floor 2 working identity: **Public Forum** — pre-iterative rewrite;
- Floor 3 working identity: **Fellowship + Network** — pre-iterative rewrite;
- Floor 4 working identity: **Media + Culture** — pre-iterative rewrite;
- Floor 5 working identity: **Policy + Proof** — pre-iterative rewrite;
- Floor 6 working identity: **Penthouse Command** — pre-iterative rewrite;
- Level 7 working identity: **Roof / Mobility Portal** — pre-iterative rewrite;
- only Floor 1 has a ground-level public exterior entrance;
- Floors 2–6 have no exterior doors/balconies/terraces;
- Level 7 is intentionally open-air and reached from the internal core;
- Floor 6 must preserve roof-access/core continuity;
- elevator/core location is fixed vertically;
- 360 camera orientation is fixed relative to the core;
- HM graphics are not Equity Uprise building branding;
- room content must map to audited Equity Uprise functions.

### Current quality-control status

**B1 — RECONCILED CURRENT PASS**

Canonical authority:
- `docs/design/equity-uprise-building/BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- `docs/design/equity-uprise-building/UNDERGROUND-TUNNEL-NETWORK-SPEC.md`
- `docs/design/equity-uprise-building/production/basement-b1-program.json`
- `docs/design/equity-uprise-building/production/underground-tunnel-network.json`

B1 live operations remain restricted; learner/instructor work uses a sandboxed clone.

**Floor 1 — CURRENT-PASS PROGRAM COMPLETE / SCHEMATIC RENDER-READY**

Canonical authority:
- `docs/design/equity-uprise-building/FLOOR-01-DIGITAL-TWIN-PROGRAM.md`
- `docs/design/equity-uprise-building/FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md` *(legacy-compatible filename only)*
- `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
- `docs/design/equity-uprise-building/FLOOR-01-SITE-EGRESS-SIMULATION.md`
- `docs/design/equity-uprise-building/production/floor-01/floor-01-digital-twin-program.json`
- `docs/design/equity-uprise-building/production/floor-01/floor-01-site-egress.json`

"Complete" here means the current activity/space program, B1 relationship, access model, life-safety/site simulation, and shared-core integration are reconciled. It does **not** mean final art direction, final architectural engineering, or production-quality 3D is finished.

**Floors 2–6 — RECONCILED CURRENT PASS / REAL 3D ACTIVE**

Each floor has completed program reconciliation, historical-preservation review, inventory-backed 3D work, stack integration and current machine coverage. Direct visual approval remains an iterative human gate.

**Level 7 — RECONCILED CURRENT PASS / REAL 3D ACTIVE**

The roof program is reconciled around exactly three repo-backed capabilities: ecosystem routing, conceptual roof mobility, and optional-route-only Uprise World. Both protected stairs must physically reach the +81 ft roof walking plane through real roof-door openings. Direct passenger-elevator roof service remains unassumed, and the mobility reservation remains non-operational pending real feasibility.

Generated plans, production packages, contact sheets and GLB/reports are **derived-only** and must be regenerated from current authority. A derived artifact that differs after deterministic regeneration is stale even if an older validation report said it passed.

Proceed one floor at a time.
