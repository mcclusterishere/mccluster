# Equity Uprise Building — Floor 03: Fellowship + Network

> Status: **CANONICAL FLOOR 3 SPEC — LOCKED FOR QUALITY CONTROL**  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Fellowship + Network**  
> This file is the source of truth for Floor 3 floor-plan work, 360 panorama generation, hotspot placement, 3D reconstruction, and implementation.  
> Do not generate a Floor 3 environment that conflicts with this document.

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
- Floor 3 needs modest, private interview rooms;
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

Floor 3 inherits the exact building datum from Floors 1 and 2.

- Exterior footprint: **72'-0" × 72'-0"**
- Gross conceptual area: **5,184 sq ft**
- Structural coordination grid: **18' × 18'**
- Floor-to-floor target: **13'-6"**
- North is up.

The following vertical systems are fixed:

- Elevator hoistway: **X 54–62 / Y 34–44**
- Stair A: **X 60–72 / Y 54–72**
- Stair B: **X 0–12 / Y 54–72**
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**
- Canonical 360 camera datum: approximately **(36, 28)**

No Floor 3 program may move these systems.

---

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
Two modest, glazed fellowship interview rooms along the southwest/south-central portion of the floor, with sealed upper-floor glazing continuing along the south perimeter.

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

### Identity / opportunity wall
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

## 8. Fellowship interview rooms

Floor 3 includes **two** small interview rooms because the repo has an actual interview scheduling workflow.

### Interview Room A
Approximate coordinates:
- **X 2–14 / Y 4–16**
- approximate inside size: **12' × 12'**

### Interview Room B
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

## 9. Member / interview check-in

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
- the two interview rooms positioned inside the glazing line;
- no exterior door;
- no terrace/balcony access.

Do not treat the south facade as a lobby entrance.

---

## 11. North support band

Stack services vertically for a buildable building.

### Corridor
- **Y 54–60**
- approximately **6 ft clear** target

### Accessible restroom A
- **X 12–20 / Y 60–70**
- conceptual 8' × 10'

### Accessible restroom B
- **X 20–28 / Y 60–70**
- conceptual 8' × 10'

### Fellowship support / records
- **X 28–40 / Y 60–72**
- conceptual 12' × 12'
- secure, back-of-house
- supports interview/application materials, supplies and secure record handling
- not a public display room

### Network / IT
- **X 40–50 / Y 60–72**
- conceptual 10' × 12'
- supports opportunity/people displays and floor technology

### Janitor
- **X 50–54 / Y 60–66**
- conceptual 4' × 6'

### MEP / risers
- approximately **X 50–60 / Y 66–72**
- vertically stacked with lower floors

---

## 12. Stairs / vertical circulation

### Elevator
Same hoistway and door orientation as Floors 1–2.

### Stair A
Same enclosure:
- **X 60–72 / Y 54–72**

### Stair B
Same enclosure:
- **X 0–12 / Y 54–72**

Both are protected internal stairs at Floor 3. Neither is an exterior public entrance.

---

## 13. Circulation

### Primary
Elevator → Opportunity Exchange:
- approximately **6 ft clear** where practical.

### Secondary
Opportunity Exchange → People Lounge:
- at least approximately **4 ft clear** at schematic level.

### Interview route
Elevator/Opportunity Exchange → interview rooms:
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
- framed glass at interview rooms.

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

### Interview rooms
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
Two modest glazed interview rooms with sealed upper-floor glazing beyond/around them. No exterior door.

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
5. **Interview Room A/B** → scheduled interview/meeting context.
6. **Member check-in** → personal dashboard/interview arrival.
7. **Elevator** → floor selector.
8. **People + Network lounge** → profile/network experience.

---

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
- [ ] Stair B at X 0–12 / Y 54–72
- [ ] MEP/riser stack preserved
- [ ] no exterior public door
- [ ] no balcony/terrace
- [ ] 360 camera approximately (36,28)
- [ ] opportunity table north/forward
- [ ] elevator + check-in east/right
- [ ] two interview rooms south
- [ ] people/network lounge west
- [ ] no staffed reception desk
- [ ] services/restrooms stack vertically
- [ ] public displays expose no private data
- [ ] no invented fellowship/program content
- [ ] room remains modest/simple
- [ ] generated imagery remains subordinate to written/CAD geometry
