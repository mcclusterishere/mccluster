# Equity Uprise Building UI — Repo Inventory & Image Plan

> Status: AUDIT FIRST. Do not generate production building art until this inventory is approved.
> Purpose: turn the existing Equity Uprise ecosystem into a navigable building UI rather than inventing generic rooms.

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

## 2. Recommended building information architecture

The building should represent **real Equity Uprise functions**, not generic office filler.

### Floor / zone candidates

| Zone | Real Equity Uprise function | Existing destination |
|---|---|---|
| Penthouse / Command | Equity Uprise overview + live institutional work | `equity-uprise.html` |
| Policy Lab | Working paper + policy architecture | Institutional Desk / `policy.html` |
| Evidence Room | Docket 516R + source documents | `docket-516.html` |
| Proof Room | Citations, proclamations, credentials, verified claims | credentials + Past Work |
| Media Studio | Broadcasts, event media, civic explainers | Institutional Desk / archives |
| Music / Culture Studio | Equity Uprise album + civic anthems + artists | `album.html?album=equity-uprise` |
| Fellowship Floor | Policy Fellowship / fellow participation | `fellowship.html` |
| Opportunity Exchange | Fellowship directory + matching | `fellowships.html` |
| Public Forum | Topics / perspectives / public issue participation | `topics.html` |
| People / Network | Profiles + people directory | `profile.html` |
| Member Desk | Saves, applications, threads, matches | `dashboard.html` |
| Partnerships / Intake | Organizations, sponsors, issue intake | Join view |
| Archive | Past work / case files | Institutional Desk Past Work |
| Operations / Back Office | Admin / moderation / campaigns | `uprise-admin.html` |
| World Portal | Future entry to Uprise World | unfinished Uprise World |

These names are working labels, not final art labels.

---

## 3. Building hierarchy recommendation

### Public / prestige floors
Top of tower:
- Penthouse Command
- Policy Lab
- Proof Room
- Evidence Room
- Media / Culture

### Community / participation floors
Middle:
- Fellowship
- Opportunity Exchange
- Public Forum
- People / Network
- Partnerships / Intake

### Operational / archive floors
Lower:
- Member Desk
- Archive
- Operations / Back Office
- Systems / Data
- Lobby / Entry

This gives the building a logical vertical narrative:
**vision → policy → proof → media → people → participation → operations → record.**

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

## 9. Current decision gate

Before any new production image is generated, decide:

- exact number of floors
- which existing Equity Uprise functions deserve their own room
- which functions should be grouped
- whether internal/admin rooms are visible to the public
- whether Uprise World is a room/portal in this building
- whether the building is branded as Equity Uprise HQ, a civic institute, or another in-world name
