# Equity Uprise Building — Floor 03: Fellowship + Network

> Status: **CANONICAL FLOOR 3 SPEC — LOCKED FOR QUALITY CONTROL**  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Fellowship + Network**  
> This file is the source of truth for Floor 3 floor-plan work, 360 panorama generation, hotspot placement, 3D reconstruction, and implementation.  
> Do not generate a Floor 3 environment that conflicts with this document.


> **Core V2 migration authority:** `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json`.
> Combined-model finished-floor elevation: **+27'-0"**.
> Shared vertical systems override any stale Core V1 coordinate language on this branch.

## 1. Repo-derived purpose

Floor 3 spatializes the existing Equity Uprise fellowship, opportunity-matching, profile/network, and interview workflows.

Relevant repo functions:

### `fellowship.html` — Equity Uprise Policy Fellowship
The current fellowship experience contains a 16-question application/record flow covering:
- identity and preferred name;
- contact information;
- city/state/ZIP;
- age range;
- occupation/field;
- civic record;
- policy priorities;
- first-priority selection;
- talent / "superpower";
- how the applicant would use that talent;
- ways the applicant can participate;
- optional social links;
- why the nonpartisan/middle-of-the-aisle approach speaks to the applicant;
- contact consent.

A person reads the fellowship record; the physical floor should therefore provide real places for private interview/review conversations, but it should not expose application details publicly.

### `fellowships.html` — fellowship/opportunity directory
Existing functions:
- search;
- topic filter;
- match-me flow;
- program directory;
- program source/provenance;
- host-submitted program listings;
- program location, duration, stipend wording, eligibility, deadline notes, tags, topics and remote status.

The floor may represent this as a dynamic opportunity/matching surface. It must not invent programs that are not in the live directory.

### `profile.html` — people/network
Existing functions:
- public, unlisted and private profiles;
- display name, headline, biography;
- region for matching;
- interests;
- goals;
- openness to fellowships, organizing, speaking, mentoring and work;
- links;
- host/program role;
- controlled contact details and opt-ins.

Physical implication:
- the floor needs a clear **People / Network** component;
- private contact information must not appear on public displays.

### `dashboard.html`
Existing functions relevant here:
- matched programs;
- application tracking;
- saves;
- application stage;
- due-date/notes tracking;
- next-step guidance.

### `supabase/functions/eu-calendar/index.ts`
Existing workflow includes real fellowship interview requests and confirmed meetings.

Physical implication:
- Floor 3 needs modest, private interview / stakeholder meeting rooms;
- it does not need a large conference suite.

### Boundary with other floors
- Political/public topic discussion remains on **Floor 2 — Public Forum**.
- Media/art/music belongs on **Floor 4 — Media + Culture**.
- Policy/evidence work belongs on **Floor 5 — Policy + Proof**.
- Internal moderation/control-plane functions remain back-of-house and are not Floor 3's public identity.

---

## 2. Architectural intent

Floor 3 is the building's **opportunity and people floor**.

A visitor arriving from the elevator should understand:

- I can discover fellowships/programs that match my interests.
- I can see who participates in the network.
- I can continue or review my own application activity privately.
- If I have an interview, there are quiet rooms for it.
- The floor is not trying to sell me a fantasy "career center"; it is a functional civic opportunity exchange.

The room should feel human, calm and useful.

It is **not**:
- a recruiting expo;
- a corporate HR floor;
- a job fair;
- a campaign office;
- a social-media wall;
- a classroom;
- a large coworking floor;
- an auditorium;
- an admin/moderation room.

---

## 3. Locked building shell

This level inherits the Core V2 building datum exactly.

- Exterior footprint: **72'-0" × 72'-0"**
- Gross conceptual area: **5,184 sq ft**
- Structural coordination grid: **18' × 18'**
- Floor-to-floor: **13'-6"**
- Finished-floor elevation in combined model: **+27'-0"**
- North is up.

Shared vertical systems:
- passenger elevator: **X54–62 / Y34–44**
- West Service Core: **X0–18 / Y54–72**
- service/freight elevator shaft: **X0–8 / Y60–72**
- revised Stair B: **X8–18 / Y54–72**
- Stair A: **X60–72 / Y54–72**
- MEP/riser reservation: approximately **X50–60 / Y66–72**

Both stairs must physically rise the full **13'-6"** between finished floors in combined deterministic geometry. Floor slabs must preserve the shared elevator/stair openings from `building-core-v2.json`.

The service/freight elevator is a service system and is **not** counted as a substitute for a required exit.

## 4. Exterior-access rule

Floor 3 has:
- **no exterior entrance**;
- **no exterior door**;
- **no balcony**;
- **no terrace**.

The south and exposed perimeter are sealed upper-floor glazing/windows.

Protected stair doors lead into protected stair enclosures, not outdoors.

---

## 5. Canonical 360 coordinate system

### Camera
- approximately **(36,28)**
- eye height approximately **5'-4" AFF**
- level horizon

### 0° / north-forward
The **Opportunity Exchange**: one shared opportunity table with the **FELLOWSHIP + NETWORK** identity wall beyond it.

### +90° / east-right
The **fixed elevator/core** with one slim member/interview check-in terminal adjacent to the elevator lobby.

### 180° / south-behind
Two modest, glazed fellowship interview / stakeholder meeting rooms along the southwest/south-central portion of the floor, with sealed upper-floor glazing continuing along the south perimeter.

There is **no exterior door**.

### -90° / west-left
The **People + Network lounge** and public people/network information surface.

---

## 6. Opportunity Exchange

### Function
The central floor function supports:
- fellowship/program search;
- matching;
- reviewing program details;
- saving/shortlisting opportunities;
- checking application stages;
- lightweight application work.

### Shared opportunity table
Use one rectangular shared table:
- approximately **16 ft long × 4 ft wide**;
- centered approximately around **(36,41)**;
- **6 seats maximum**;
- one accessible seating position;
- durable matte commercial finish;
- concealed power/data routed through floor service.

This is not a giant interactive command table.

### Opportunity / Network Wall
Approximate wall band:
- **X 22–50 / Y 50–54**

It carries:
- exact approved Equity Uprise mark;
- **FELLOWSHIP + NETWORK**;
- three restrained dynamic information zones:
  1. **MATCH**
  2. **PEOPLE**
  3. **APPLICATIONS**

The displayed program/person/application content must come from real system data. Do not bake current program names, deadlines, political positions or private application data permanently into the architecture.

---

## 7. People + Network lounge

Locate west of the central exchange, approximately:
- **X 2–18 / Y 18–34**

### Purpose
Supports:
- informal fellow-to-fellow conversation;
- networking;
- mentorship conversation;
- meeting another participant before/after an interview;
- browsing the public people directory.

### Furniture
Keep it restrained:
- one compact sofa/bench;
- two lounge chairs;
- one small table;
- 4–6 seats total;
- one or two plants.

### People / Network surface
One wall-mounted information surface may show:
- public profiles;
- interests/goals;
- public host/program roles;
- network navigation.

Never show:
- private phone numbers;
- private email addresses;
- unlisted/private profiles;
- private notes;
- internal role/moderation data.

---

## 8. Interview / stakeholder meeting rooms

Floor 3 includes **two** small interview / stakeholder meeting rooms because the repo has an actual interview scheduling workflow.

### Interview / Stakeholder Meeting A
Approximate coordinates:
- **X 2–14 / Y 4–16**
- approximate inside size: **12' × 12'**

### Interview / Stakeholder Meeting B
Approximate coordinates:
- **X 16–28 / Y 4–16**
- approximate inside size: **12' × 12'**

### Each room
Provide:
- table for 4;
- four chairs maximum;
- simple display/monitor;
- acoustic ceiling/wall treatment;
- framed glass interior wall with privacy band/frit or controllable privacy treatment;
- solid acoustic door;
- no decorative stage/podium.

These rooms support:
- fellowship interviews;
- mentorship meetings;
- application review conversations;
- scheduled network conversations.

They are not private offices assigned to specific people.

---

## 9. Member / Meeting Check-In

Use one slim terminal beside the elevator lobby:
- approximate footprint **X 49–51 / Y 24–29**.

Functions may include:
- member recognition/sign-in;
- interview arrival;
- application/dashboard continuation;
- floor directory.

No staffed reception desk is required on Floor 3.

---

## 10. South perimeter

The south facade remains an upper-floor facade.

Use:
- sealed glazing/windows;
- column rhythm aligned with the building grid;
- the two interview / stakeholder meeting rooms positioned inside the glazing line;
- no exterior door;
- no terrace/balcony access.

Do not treat the south facade as a lobby entrance.

---

## 11. North support band

The north support band is replanned around the Core V2 West Service Core.

### West service approach
- **X0–18 / Y54–60**
- conceptual approach to the freight/service elevator and Stair B
- no public furniture or floor-specific program may block it

### Public/support corridor
- **X18–60 / Y54–60**
- target approximately **6 ft clear**

### Accessible restroom A
- **X18–26 / Y60–70**
- conceptual 8' × 10'

### Accessible restroom B
- **X26–34 / Y60–70**
- conceptual 8' × 10'

### Fellowship / Relationship Records
- **X34–42 / Y60–72**
- conceptual 8' × 12'

### Network / IT
- **X42–50 / Y60–72**
- conceptual 8' × 12'

### Janitor
- **X50–54 / Y60–66**

### MEP / risers
- **X50–60 / Y66–72**
- vertically stacked Core V2 reservation

The service/freight shaft, both stair enclosures and all shared slab openings are do-not-block geometry.

## 12. Stairs / vertical circulation

### Passenger elevator
- shaft **X54–62 / Y34–44**
- west-facing public door
- primary public vertical circulation

### Service / freight elevator
- shaft **X0–8 / Y60–72**
- south-facing service access into the north service band
- floor program may not intrude into the shaft
- not treated as a required exit

### Stair A
- enclosure **X60–72 / Y54–72**
- protected vertical continuity through the building stack
- full **13'-6"** rise per level in combined geometry
- schematic dogleg/U-shaped stair with intermediate landing
- shared slab opening approximately **X60.75–71.25 / Y58.25–71.25**

### Stair B
- enclosure **X8–18 / Y54–72**
- protected remote vertical continuity through the building stack
- full **13'-6"** rise per level in combined geometry
- schematic dogleg/U-shaped stair with intermediate landing
- shared slab opening approximately **X8.75–17.25 / Y58.25–71.25**

The old short decorative stair placeholders are retired on the Core V2 branch. Exact code geometry remains a licensed professional-design task.

## 13. Circulation

### Primary
Elevator → Opportunity Exchange:
- approximately **6 ft clear** where practical.

### Secondary
Opportunity Exchange → People Lounge:
- at least approximately **4 ft clear** at schematic level.

### Interview route
Elevator/Opportunity Exchange → interview / stakeholder meeting rooms:
- direct;
- unobstructed;
- does not cut through lounge furniture.

### North support route
Opportunity Exchange → restrooms / stairs:
- clear and legible.

---

## 14. Accessibility

At concept level provide:
- accessible elevator arrival;
- step-free circulation;
- accessible opportunity-table position;
- accessible member/interview terminal;
- accessible lounge seating position;
- accessible interview-room route/door/turning space;
- accessible restroom concepts;
- visual/audible life-safety notification.

Do not label the plan ADA-compliant until licensed professional review is complete.

---

## 15. Life safety

Conceptually preserve:
- two protected stairs;
- rated core separation as ultimately required;
- sprinkler/fire alarm coverage as required;
- emergency lighting;
- illuminated exits;
- unobstructed egress.

Final occupancy classification, occupant load, exit separation, travel distance and stair sizing require code analysis.

---

## 16. Structure

Do not move the structural/core system for furniture.

The floor must respect:
- 72' × 72' shell;
- 18' coordination grid;
- vertically aligned core/riser locations;
- structural loading appropriate to the final occupancy.

---

## 17. Material palette

Continue the same building family:

### Floor
- honed gray concrete / stone-look commercial floor;
- modest acoustic rug only in the People + Network lounge.

### Walls
- warm dark-gray mineral finish;
- blackened/gunmetal steel;
- restrained warm wood at shared table/wall details;
- framed glass at interview / stakeholder meeting rooms.

### Red accent
Use sparingly:
- floor identifier;
- active dynamic-screen state;
- restrained ceiling/reveal detail.

No nightclub red wash.

---

## 18. Ceiling / lighting

### Opportunity Exchange
Use a simple linear or rectangular architectural pendant/ceiling element aligned with the shared table.

### Interview / stakeholder meeting rooms
Warm, flattering, low-glare task/ambient lighting.

### Lounge
Softer warm lighting.

General appearance:
- approximately **2700–3000K** warm-white;
- no sci-fi light tunnels;
- no giant illuminated rings.

---

## 19. Acoustics

Floor 3 should support simultaneous interviews and informal networking.

Use:
- acoustic ceilings;
- absorptive wall treatment;
- acoustic seals at interview-room doors;
- privacy treatment at interview-room glass;
- upholstered lounge furniture;
- low-noise HVAC.

Normal interview conversation should not be intelligible across the main floor.

---

## 20. Technology / power / data

Provide plausible service routes for:
- opportunity wall;
- public people/network display;
- member/interview check-in;
- shared opportunity table;
- interview-room displays;
- Wi-Fi/network access.

Private application/profile data should display only to the authenticated individual, not on public wall surfaces.

---

## 21. Privacy / security

This floor deals with personal profiles and applications, so privacy is architectural as well as digital.

Public displays may show only public data.

Private:
- application records;
- contact details;
- interview notes;
- unlisted/private profiles;
- staff review data

must remain on authenticated devices or in secure support areas.

Use discreet access control for back-of-house support/records and IT.

No tactical checkpoint.

---

## 22. Branding

Use the exact approved Equity Uprise mark.

Primary application:
- north **FELLOWSHIP + NETWORK** wall.

Secondary:
- modest Floor 3 identifier at elevator.

Do not:
- redraw/crop the mark;
- invent slogans;
- use HM branding;
- turn the space into a logo showroom.

---

## 23. Furniture identity

Canonical visible furniture:
- one 16' × 4' opportunity table;
- 6 opportunity-table chairs;
- one sofa/bench;
- two lounge chairs;
- one lounge table;
- two interview tables;
- four chairs per interview room;
- one member/interview check-in terminal;
- one or two plants.

No additional large furniture is canonical.

---

## 24. Canonical 360 panorama requirements

### Technical
- true 2:1 equirectangular panorama;
- locked camera datum;
- level horizon;
- continuous floor/ceiling/perimeter;
- coherent upper-floor shell.

### Required cardinal views

**0° / north:**  
Opportunity table + FELLOWSHIP + NETWORK wall with Match / People / Applications surfaces.

**+90° / east:**  
Fixed elevator/core + member/interview check-in.

**180° / south:**  
Two modest glazed interview / stakeholder meeting rooms with sealed upper-floor glazing beyond/around them. No exterior door.

**-90° / west:**  
People + Network lounge and public people/network surface.

### Must not appear
- exterior entrance;
- balcony;
- terrace;
- staffed reception desk;
- campaign room;
- stage/podium;
- classroom rows;
- job-fair booths;
- giant employer logos;
- political issue debate wall;
- media studio;
- evidence/archive displays;
- admin moderation screens;
- giant command table;
- invented fellowship/program names.

---

## 25. Hotspot logic

Suggested Floor 3 hotspots:

1. **Match** → fellowship/program matching.
2. **People** → public profile/network directory.
3. **Applications** → signed-in application tracker/dashboard.
4. **Opportunity table** → directory/browse experience.
5. **Interview / Stakeholder Meeting A/B** → scheduled interview/meeting context.
6. **Member check-in** → personal dashboard/interview arrival.
7. **Elevator** → floor selector.
8. **People + Network lounge** → profile/network experience.

---

## 25A. Semantic interaction modes

The existing Floor 3 rooms and surfaces support distinct digital modes without adding rooms or changing geometry:

- **Our Fellows** — the Equity Uprise cohort / fellow record, distinct from external opportunities.
- **External Opportunities** — the fellowship/opportunity directory.
- **Submit / Host Programs** — authenticated host/member submission path; moderation remains private.
- **Apply / Application Status** — fellowship application intake and private status tracking.
- **Relationship Graph** — authorized staff view of people, organizations, initiatives and relationship stage; never a public contact database.
- **Enterprise Development** — public program information with private fit review/agreement state.

These modes primarily live on the Opportunity / Network Wall, Opportunity Exchange, Member / Meeting Check-In and meeting-room displays. They are **states of existing architecture**, not separate departments.

## 26. Content neutrality / authenticity rule

Program names, deadlines, eligibility, stipends, and source claims shown in the environment must come from the actual live directory or verified source data.

Do not invent opportunities to make the scene look populated.

The physical architecture should not favor a political position or political organization.

---

## 27. Floor 3 identity in one sentence

**A compact opportunity-and-people floor where fellows and visitors can discover real programs, manage their next step, meet one another, and hold private fellowship interviews without turning the building into a corporate recruiting center.**

---

## 28. Quality-control checklist

- [ ] 72' × 72' shell preserved
- [ ] 18' grid preserved
- [ ] elevator at X 54–62 / Y 34–44
- [ ] Stair A at X 60–72 / Y 54–72
- [ ] Stair B at X 8–18 / Y 54–72
- [ ] MEP/riser stack preserved
- [ ] no exterior public door
- [ ] no balcony/terrace
- [ ] 360 camera approximately (36,28)
- [ ] opportunity table north/forward
- [ ] elevator + check-in east/right
- [ ] two interview / stakeholder meeting rooms south
- [ ] people/network lounge west
- [ ] no staffed reception desk
- [ ] services/restrooms stack vertically
- [ ] public displays expose no private data
- [ ] no invented fellowship/program content
- [ ] room remains modest/simple
- [ ] generated imagery remains subordinate to written/CAD geometry


### Core V2 migration QC
- [ ] finished-floor elevation matches `building-core-v2.json`
- [ ] service/freight elevator shaft X0–8 / Y60–72 is preserved
- [ ] revised Stair B X8–18 / Y54–72 is preserved
- [ ] Stair A X60–72 / Y54–72 is preserved
- [ ] both stairs span the full 13'-6" floor-to-floor rise in combined geometry
- [ ] shared slab openings remain unobstructed
- [ ] no floor-local decorative stair is treated as vertical-continuity authority

## Repo capability binding — 2026-09-21 reconciliation audit

This floor is bound to the repo-wide program map:
`production/equity-uprise-capability-map-v2.json`.

The current capability authority contains **56 canonical capabilities**. Repo-source counts are governed by the generated source-coverage report. A capability may appear here as a primary function or as a cross-floor part of a larger workflow.

### Primary capabilities
- **Public profiles / people directory** (`profiles`, built) — People + Network Lounge and Opportunity / Network Wall.
- **Private member contact/consent record** (`private-contact`, built) — Never shown publicly; represented only as protected relationship records/back-office state.
- **Fellowship/opportunity directory** (`fellowship-directory`, built) — Opportunity Exchange.
- **Profile/topic-based opportunity matching** (`fellowship-matching`, built) — Opportunity table and member check-in.
- **Host-submitted fellowship listings with moderation** (`host-listings`, built) — Opportunity Exchange submission path; moderation on Floor 6 Desk.
- **Policy Fellowship/application workflow** (`fellowship-applications`, built) — Fellowship application path, application tracking, and interview/meeting rooms.
- **Interview requests, availability and calendar scheduling** (`interviews-calendar`, built_guarded) — Member / Meeting Check-In and two Interview / Stakeholder Meeting rooms; no private calendar data shown publicly.
- **Stakeholder people/organizations and initiative relationship graph** (`stakeholder-graph`, built) — People + Network layer and access-controlled relationship views; not a public contact database.
- **Meetings, participants and commitments** (`meetings-commitments`, built) — Interview / Stakeholder Meeting rooms plus institutional follow-through in Penthouse Command.
- **Equity Uprise fellowship cohort / fellow record** (`fellowship-cohort`, built) — People + Network Lounge / Opportunity Wall carries the actual Equity Uprise cohort and fellow record, distinct from the external fellowship directory.
- **Equity Uprise enterprise development program lane** (`enterprise-development`, built_guarded) — Opportunity Exchange includes a business/workforce/digital-capacity program lane. Program fit, measurable connected revenue and signed agreements are reviewed in meeting/briefing spaces; the building does not hardcode prices or imply automatic approval.

### Secondary / cross-floor capabilities
- **Member dashboard / private personal desk** (`member-dashboard`, built) — Member Check-In opens private matches, applications, saves, perspectives and conversation threads.
- **M-Verified organization/profile intake** (`verification`, built_manual) — Intake / Verification Consultation on Floor 1; verified identity becomes part of Floor 3 network context.
- **Stakeholder and organization intake** (`stakeholder-intake`, built) — Reception/intake on Floor 1; relationship graph on Floors 3 and 6.
- **Partner / sponsor pathways** (`partnership-sponsorship`, built_public_pathway) — Partner / Executive Briefing room and Institutional Salon.
- **Artist/creator participation and studio workflow** (`artist-creator`, built_shared_platform) — Creator Recording Room and Edit / Review Suite.
- **Google Workspace/Gmail relationship bridge** (`google-workspace`, built_disabled_until_configured) — Desk Operations / Systems; relevant communications project into stakeholder relationship state.
- **Consent-aware outbound stakeholder outreach bridge** (`outreach`, built_not_armed_by_default) — Access-controlled stakeholder pipeline; never a public blast console.

### Boundary rule
The building metaphor must preserve the source product's public/private and approval boundaries. A capability being represented on this floor does **not** make private records, OAuth credentials, contact data, moderation state, outreach controls, financial/accounting details, government submission controls, music delivery controls, or other guarded operations publicly accessible.

Enterprise Development is represented as a program pathway, not as a pricing billboard; commercial terms remain external program data. Detailed Equity Uprise Mission Fund accounting remains quiet until its governance/custody/accounting/reporting state is publishable.

This section describes repo/program fidelity. It does not alter the shared Core V2 geometry and is **not for construction**.
