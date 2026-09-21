# Equity Uprise Building — Floor 02: Public Forum

> Status: **CANONICAL FLOOR 2 SPEC — LOCKED FOR QUALITY CONTROL**  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Public Forum**  
> This file is the source of truth for future Floor 2 floor-plan work, 360 panorama generation, hotspot placement, 3D reconstruction, and implementation.  
> Do not generate a new Floor 2 environment that conflicts with this document.

## 1. Repo-derived purpose

Floor 2 spatializes the existing Equity Uprise public-participation system.

The relevant repo functions are:

### `topics.html`
- neutral issue framing;
- documented context;
- structured questions;
- public perspectives;
- "put it on the record";
- "talk it through";
- related program routing.

### `dashboard.html`
- a signed-in person's recorded perspectives;
- conversation threads;
- lightweight member activity;
- next-step routing.

### `supabase/functions/eu-converse/index.ts`
- listens without taking a political position;
- records what a visitor cares about;
- can file a visitor's perspective only with consent;
- can hand a conversation to a human;
- can recommend existing opportunities, but only from the real directory.

### `uprise-admin.html`
Moderation/admin work exists, but it is **back-of-house**. The Public Forum must not become an admin control room.

### Floor-boundary rule
The full fellowship/opportunity directory and people/network program belong on **Floor 3 — Fellowship + Network**. Floor 2 may provide a simple "Opportunities" / "Next Steps" routing surface because the public-topic flow already points users toward programs, but it may not duplicate Floor 3.

---

## 2. Architectural intent

Floor 2 is a modest civic discussion floor.

It should feel like a real place where:
- a small group can sit around one table and discuss an issue;
- a visitor can review current topics and public perspectives;
- a person can sit off to the side and talk through a concern privately enough for a normal conversation;
- a signed-in member can check in near the elevator and continue their activity;
- a visitor can move to the correct next floor without the room becoming a digital command center.

The floor should be calm, legible and intentionally under-furnished.

This is **not**:
- a city-council chamber;
- a lecture hall;
- a campaign war room;
- a television studio;
- a social-media operations center;
- a futuristic mission-control room;
- a fellowship directory floor;
- an admin moderation room.

---

## 3. Locked building shell

Floor 2 inherits the Floor 1 building datum exactly.

- Exterior footprint: **72'-0" × 72'-0"**
- Gross conceptual area: **5,184 sq ft**
- Structural coordination grid: **18' × 18'**
- Floor-to-floor target: **13'-6"**
- North is up.

The following vertical systems may not move:

- Elevator hoistway: **X 54–62 / Y 34–44**
- Stair A: **X 60–72 / Y 54–72**
- Stair B: **X 0–12 / Y 54–72**
- MEP/riser reservation: approximately **X 50–60 / Y 66–72**
- Canonical 360 camera plan datum: approximately **(36, 28)**

Floor 2 is an upper floor of the same building, not a new shell.

---

## 4. Exterior-access rule

Floor 2 has:

- **no exterior entrance**;
- **no exterior door**;
- **no balcony**;
- **no terrace**;
- **no exterior stair used as a public entrance**.

The south, west and other exposed perimeter walls may have **sealed building glazing/windows**.

A rendered door that appears to open outside is a continuity failure.

Protected stairs may discharge externally only at the ground floor as resolved by the final architect/code design; their Floor 2 doors enter protected stair enclosures, not the outdoors.

---

## 5. Canonical 360 coordinate system

The Floor 2 panorama uses the same camera relationship as Floor 1.

### Camera
- plan coordinate approximately **(36, 28)**;
- eye height approximately **5'-4" AFF**;
- level horizon.

### 0° / north-forward
The **Public Forum discussion table** with the **Equity Uprise / PUBLIC FORUM feature wall** beyond it.

### +90° / east-right
The **fixed elevator/core**, with a small member check-in terminal immediately adjacent to the elevator lobby.

### 180° / south-behind
A quiet enclosed perimeter with **sealed windows/glazing**.

There is **no exterior door** at this direction on Floor 2.

### -90° / west-left
The **conversation/lounge zone**.

---

## 6. Central Public Forum

### Function
The central space supports:
- small facilitated discussions;
- issue briefings;
- structured listening sessions;
- public-perspective conversations;
- working sessions around documented topic material.

### Table
Use one round or softly polygonal commercial discussion table:
- approximately **12 ft diameter**;
- **8 seats maximum** in the canonical daily configuration;
- durable matte surface;
- integrated floor/table power only if physically routed;
- no glowing holographic surface.

The table is centered approximately around **(36, 39)**.

### Why one table
The repo's public-participation model is conversational, not auditorium-scale. The physical floor should reinforce that.

Do not add rows of audience chairs or a second large table.

---

## 7. Public Forum feature / issue wall

The north-facing feature wall is the Floor 2 identity surface.

Approximate wall band:
- **X 24–48 / Y 50–54**

It carries:
- the exact approved Equity Uprise mark;
- the words **PUBLIC FORUM**;
- three restrained flush information surfaces:
  1. **CURRENT ISSUES**
  2. **PERSPECTIVES**
  3. **OPPORTUNITIES**

These headings describe the existing digital flow. The actual issue content is dynamic and must not be baked permanently into architectural artwork.

Do not permanently engrave current political topics into the building.

The screens/panels should read as architectural information surfaces, not a command center.

---

## 8. Conversation / listening lounge

Locate on the west side, approximately within:
- **X 2–18 / Y 14–30**

### Furniture
Canonical daily layout:
- one compact sofa or bench;
- two lounge chairs;
- one small table;
- optional small acoustic rug;
- one or two plants.

Target: **4–6 lounge seats**, not a club.

### Digital interaction
One slim wall-mounted or side-mounted **Talk It Through / Listening** interface is acceptable.

It may route to the existing conversation system.

Do not add:
- multiple booths;
- rows of terminals;
- recording-studio equipment;
- a second reception desk.

---

## 9. Member check-in at elevator

The user's earlier continuity decision is preserved:

**member check-in belongs at the elevator, not as a separate desk.**

Provide one slim check-in terminal adjacent to the elevator lobby, approximately:
- **X 49–51 / Y 24–29**

It may support:
- member recognition/sign-in;
- return-to-conversation;
- route to personal dashboard;
- floor directory.

It must not obstruct the elevator approach.

There is no staffed Floor 2 reception desk.

---

## 10. South perimeter / quiet edge

The south side is deliberately simple.

Use:
- sealed windows or building glazing;
- wall/column rhythm aligned to the shell;
- optional narrow integrated bench only if it does not clutter circulation.

Do not create:
- a door;
- balcony access;
- terrace furniture;
- exterior signage;
- another program zone merely to fill space.

The visual emptiness helps the forum breathe.

---

## 11. North support band

Floor 2 preserves efficient vertical stacking of building services.

### Public/support corridor
- approximate band: **Y 54–60**
- target clear width: approximately **6 ft**

### Accessible restroom A
- **X 12–20 / Y 60–70**
- conceptual 8' × 10'

### Accessible restroom B
- **X 20–28 / Y 60–70**
- conceptual 8' × 10'

Plumbing is intentionally stacked over Floor 1.

### Forum storage
- **X 28–40 / Y 60–72**
- stores folding/stacking support chairs, tabletop accessories, cleaning/support supplies and forum materials;
- not a public room.

### AV / IT
- **X 40–50 / Y 60–72**
- supports the three information surfaces, forum display/control, network and floor technology;
- not an operations command room.

### Janitor
- **X 50–54 / Y 60–66**

### MEP / risers
- approximately **X 50–60 / Y 66–72**
- stacks with Floor 1 and future floors.

---

## 12. Stairs / vertical circulation

### Elevator
Same shaft and door orientation as Floor 1.

### Stair A
Same enclosure coordinates as Floor 1:
- **X 60–72 / Y 54–72**

Floor 2 enters the protected enclosure. It does not exit outdoors.

### Stair B
Same enclosure coordinates:
- **X 0–12 / Y 54–72**

Floor 2 enters the protected enclosure. It does not exit outdoors.

Final stair geometry, ratings and code compliance remain professional-design tasks.

---

## 13. Circulation

### Primary public movement
Elevator → forum table / feature wall.

Maintain approximately **6 ft clear** where practical.

### Secondary movement
Forum → lounge/listening zone.

Maintain approximately **4 ft clear** minimum at schematic level.

### North service movement
Forum → restrooms / stairs.

Keep it legible and unobstructed.

No furniture should float into primary paths merely to make a render look richer.

---

## 14. Accessibility

At concept level provide:
- accessible elevator arrival;
- step-free routes;
- accessible seating position at the forum table;
- wheelchair turning/approach clearances;
- accessible lounge position;
- accessible member terminal;
- accessible restrooms;
- visual/audible life-safety notification.

Do not label the plan ADA-compliant until licensed code review is complete.

---

## 15. Life safety

Conceptually preserve:
- two protected stairs;
- rated core separation as ultimately required;
- sprinkler/fire-alarm coverage as required;
- illuminated exit signage;
- emergency lighting;
- unobstructed egress routes;
- no lock-in condition at the Public Forum.

Floor 2 occupancy classification, occupant load, exit separation, travel distance and stair width require actual code analysis.

---

## 16. Structure

The Floor 2 plan must respect:
- the 72' × 72' shell;
- the 18' coordination grid;
- vertically aligned columns/core;
- floor loading appropriate for assembly/business use as ultimately engineered.

The discussion table and furniture do not drive structural-column relocation.

---

## 17. Material palette

Floor 2 continues the building material family established on Floor 1.

### Floor
- honed gray concrete / stone-look commercial flooring;
- low-to-medium reflectance;
- area rug only in the conversation lounge if desired.

### Walls
- warm dark-gray mineral/plaster finish;
- blackened/gunmetal steel trim;
- restrained wood accent at table or wall;
- acoustic panels integrated discreetly.

### Metal
Slightly lived-in premium gunmetal/blackened steel.

No fake rust or heavy distress.

### Red accent
Use sparingly:
- a restrained ceiling/reveal line;
- active state on information surfaces;
- subtle wayfinding.

No red nightclub wash.

---

## 18. Ceiling and lighting

### Ceiling
Simple acoustic ceiling plane coordinated with:
- sprinklers;
- lighting;
- HVAC;
- AV;
- acoustic treatment.

### Forum lighting
One restrained circular or soft geometric fixture may align over the discussion table.

It should read as architectural lighting, not a spaceship ring.

### General lighting
Warm-white appearance around **2700–3000K**.

### Screen lighting
Information surfaces should not be bright enough to dominate the room.

---

## 19. Acoustics

Acoustics matter more on Floor 2 than decoration.

Use:
- absorptive ceiling treatment;
- acoustic wall panels or backed slat treatment;
- upholstered lounge furniture;
- soft floor zone in lounge;
- acoustic separation at support/service rooms;
- low-noise HVAC.

The central discussion should be intelligible without amplifying every normal conversation.

---

## 20. Technology / power / data

Provide conceptually:
- floor/table power routed from real pathways;
- network connectivity to the information wall;
- member check-in power/data;
- Wi-Fi;
- AV/IT support room;
- discreet ceiling microphone/speaker provisions only if a later implementation needs them.

Do not depict wireless-looking devices that have no plausible power/data route.

---

## 21. Security / privacy

The Public Forum is welcoming but not uncontrolled.

Use:
- normal member check-in at elevator;
- discreet cameras at core/circulation as appropriate;
- controlled access to AV/IT and service rooms;
- no visible tactical/security theater.

Public perspectives are a digital/content workflow. Do not display private contact information on public wall surfaces.

---

## 22. Branding

Use the exact approved Equity Uprise logo.

Primary application:
- north Public Forum feature wall.

Secondary:
- small floor identifier near elevator.

Do not:
- redraw the mark;
- invent slogans;
- add HM branding;
- cover the room in logos.

---

## 23. Furniture identity

Floor 2 canonical furniture count should remain low.

Required:
- one 8-seat forum table;
- 8 forum chairs;
- one sofa/bench;
- two lounge chairs;
- one small lounge table;
- one member check-in terminal;
- optional one or two plants.

That is enough.

---

## 24. Canonical 360 panorama requirements

### Technical
- true 2:1 equirectangular panorama;
- eye-level camera at the locked datum;
- level horizon;
- continuous floor/ceiling/perimeter;
- no stretched front-facing render masquerading as 360.

### Required cardinal views

**0° / north:**  
Forum table + Equity Uprise / PUBLIC FORUM wall + restrained Current Issues / Perspectives / Opportunities surfaces.

**+90° / east:**  
Fixed elevator/core + member check-in.

**180° / south:**  
Sealed windows/perimeter. **No outside door.**

**-90° / west:**  
Conversation/lounge zone.

### Must not appear
- exterior entrance;
- balcony;
- terrace;
- member reception desk;
- stage/podium;
- auditorium seating;
- campaign signage;
- giant live-news wall;
- moderation/admin consoles;
- fellowship directory wall;
- media-studio equipment;
- holographic globe;
- excessive kiosks;
- unrelated decorative rooms.

---

## 25. Hotspot logic

Suggested Floor 2 hotspots:

1. **Forum table** → current issue / structured discussion.
2. **Current Issues** → `topics.html`.
3. **Perspectives** → public perspectives / person's own recorded views.
4. **Opportunities** → route upward to Floor 3 / related-program discovery.
5. **Talk It Through** → conversation interface.
6. **Member check-in** → signed-in dashboard/member activity.
7. **Elevator** → floor selector.

Keep hotspots limited and purposeful.

---

## 26. Political-neutrality / content rule

The physical floor does not endorse an issue position.

Current issues shown on digital surfaces must come from the live Equity Uprise content/data system and should preserve the neutral framing implemented in the repo.

Do not make one position visually dominant through permanent architecture, lighting, scale, or placement.

---

## 27. Floor 2 identity in one sentence

**A restrained civic discussion floor centered on one real conversation table, with dynamic issue/perspective information ahead, member check-in at the fixed elevator, and a small listening lounge to the side—inside the same building shell established on Floor 1.**

---

## 28. Quality-control checklist

Before approving any Floor 2 plan/render/360:

- [ ] Is the floor exactly 72' × 72'?
- [ ] Are both stairs in the exact Floor 1 stack locations?
- [ ] Is the elevator exactly X 54–62 / Y 34–44?
- [ ] Are MEP/risers vertically aligned?
- [ ] Is there **no exterior entrance**?
- [ ] Are there **no balconies or terraces**?
- [ ] Is the 360 camera still approximately (36,28)?
- [ ] Is the 0° view the forum table/feature wall?
- [ ] Is the +90° view elevator + member check-in?
- [ ] Is the 180° view sealed perimeter glazing/wall?
- [ ] Is the -90° view the conversation lounge?
- [ ] Is there one forum table with no more than 8 canonical seats?
- [ ] Is there no staffed member reception desk?
- [ ] Are Current Issues / Perspectives / Opportunities dynamic surfaces, not permanent political content?
- [ ] Are restrooms/services stacked logically?
- [ ] Does the room remain modest and simple?
- [ ] Could this physically stack above Floor 1?
- [ ] Is any generated render subordinate to the written/CAD geometry?
