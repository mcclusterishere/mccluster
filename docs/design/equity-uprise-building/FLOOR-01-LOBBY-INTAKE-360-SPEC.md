# Equity Uprise Building — Floor 01: Lobby + Intake

> Status: **CANONICAL FLOOR 1 EXPERIENCE / DIGITAL-TWIN SPEC — CORE V2 CHASSIS RETAINED**  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Arrival / Orientation / Intake**  
> This file is the source of truth for future Floor 1 floor-plan work, 360 panorama generation, hotspot placement, and implementation.  
> Do not generate a new Floor 1 environment that conflicts with this document.
> Activity/simulation authority: `FLOOR-01-DIGITAL-TWIN-PROGRAM.md` + `production/floor-01/floor-01-digital-twin-program.json`
> Geometry companion: `FLOOR-01-SCHEMATIC-PLAN-BASIS.md`
> Mandatory authority: `REFERENCE-AUTHORITY.md`
> Canonical plan references: `references/floor-01/`


> **Core V2 migration authority:** `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json`.
> Combined-model finished-floor elevation: **0'-0"**.
> Shared vertical systems override any stale Core V1 coordinate language on this branch.

### Digital-twin fidelity rule

Floor 1 is part of a virtual headquarters, but it must be designed and modeled as a high-fidelity hypothetical physical building. Architectural, accessibility, life-safety, MEP, IT, security, service and operational systems are educational/simulation assets, not decorative leftovers.

The project does **not** currently claim real-world code compliance. Exact compliance requires a later explicit simulation profile with jurisdiction, code editions, occupancy assumptions and engineering assumptions.

The Floor 1 activity/simulation program controls what people do and what systems/scenarios must be representable. The shared Core V2 files continue to control the fixed vertical chassis.

## 1. Architectural intent

Floor 1 is the public threshold of Equity Uprise.

It is not a hotel lobby, luxury club, command center, museum, or convention hall. It should feel like a small, serious, contemporary civic-policy institute with enough material identity to be memorable without pretending to be a billion-dollar headquarters.

A visitor should understand the floor within seconds:

- **I came in through the main entrance.**
- **Reception is directly ahead.**
- **I can sit and wait on the left.**
- **I can have an intake conversation in the small glass room.**
- **The elevator to the rest of Equity Uprise is on the right.**
- **There is no mystery about circulation.**

The floor should be visually calm. Empty space is intentional.

---

## 2. Conceptual building size and Floor 1 planning basis

### Overall building planning module
- exterior footprint: **72'-0" × 72'-0"**
- conceptual gross floor area: **5,184 sq ft**
- structural coordination grid: **18' × 18'**
- Floor 1 finished-floor elevation: **0'-0"**
- floor-to-floor: **13'-6"**

### Core V2 vertical systems
- passenger elevator: **X54–62 / Y34–44**
- West Service Core: **X0–18 / Y54–72**
- service/freight elevator: **X0–8 / Y60–72**
- revised Stair B: **X8–18 / Y54–72**
- Stair A: **X60–72 / Y54–72**
- MEP/riser: approximately **X50–60 / Y66–72**

Floor 1 remains the only normal ground-level public entrance. Exit-only protected-stair discharge doors and the secure service/delivery entrance are not public entrances.

A non-developmental B1 Technical / Service Basement exists at -13'-6". Stair A, Stair B, the passenger elevator, freight/service elevator and MEP systems continue to B1. Floor 1 remains the modeled level of exit discharge.

### Floor 1 public-facing area
The approved Floor 1 program now centers the Entry Vestibule, Arrival Atrium, Orientation Lounge, Intake / Verification Consultation, Development Passport Studio, Journey Wall, Reception / Concierge / Security Desk and Next Action / Building Directory. Core V2 preserves the north/west service and vertical chassis while the digital-twin program deepens the floor's institutional and simulation functions.

### Arrival Atrium

Planning zone:
- **X20–52 / Y10–30**

Purpose:
- public arrival and avatar presence;
- returning-member continue-work prompt;
- wayfinding and meeting routing;
- emergency-map and alarm/navigation context.

### Development Passport Studio

Planning zone:
- **X20–52 / Y32–44**

Purpose:
- goals and pathway selection;
- competency/credential/project review;
- private personalized next action;
- privacy/accessibility preferences.

The Studio is a shared architectural area with private user interfaces. Nearby avatars may see occupancy/activity status but never another participant's private Passport content.

## 3. Canonical 360 coordinate system

This orientation is mandatory for consistency with every future floor.

### Camera position

Place the virtual 360 camera:
- near the center of the public lobby;
- approximately **5 ft 2 in–5 ft 6 in above finished floor**;
- level horizon;
- not tucked against any wall;
- with enough clearance that the space reads naturally in every direction.

### 0° — image center / forward

The **main reception wall and reception desk**.

This is the visual anchor.

### +90° — right quadrant

The **fixed elevator / vertical core**.

This location becomes the fixed elevator position for Floors 2–6.

### 180° — image seam / directly behind viewer

The **main public entrance from outside**.

For an equirectangular panorama centered on reception, the entrance may appear split between the far left and far right edges of the flattened 2:1 image. That is correct.

This seam location is a public exterior entry **only on Floor 1**.

### -90° — left quadrant

The **orientation lounge and intake room**.

---

## 4. Arrival sequence

A real visitor approaches from the exterior plaza/sidewalk and enters through one primary public entrance.

### Exterior-to-interior transition

Use:
- a simple glazed storefront/curtain-wall entrance;
- pair of automatic or balanced glass entry doors;
- weather vestibule where climate requires it;
- dark metal framing consistent with the building;
- modest address/Equity Uprise identification.

Do not create:
- a giant revolving door;
- valet/drop-off theatrics;
- ceremonial stairs;
- red carpet;
- grand canopy;
- outdoor lounge.

The exterior entry should communicate a professional civic organization, not a hotel.

### Inside the door

Immediately inside, the visitor should have a clean sightline to:
1. reception straight ahead;
2. lounge/intake to the left;
3. elevator/core to the right.

Wayfinding should be intuitive before signage is read.

---

## 5. Reception / Concierge / Security zone

### Function

Reception performs:
- greeting;
- visitor check-in;
- directions;
- appointment confirmation;
- simple stakeholder/organization intake routing;
- building access control.

It does not perform deep policy work or fellowship interviews in the open lobby.

### Desk

Use one simple reception desk:
- approximately **9–11 ft long**;
- depth around **30–36 in**;
- capacity for **one primary staff position plus one flexible second position**;
- one lowered accessible transaction section;
- cable management fully concealed.

Form:
- rectilinear or gently curved;
- no giant circular command console.

Material:
- dark honed stone, solid-surface, or durable composite;
- blackened-steel reveal/details;
- optional narrow red light reveal at the toe-kick, kept dim.

### Behind reception

A single feature wall.

It carries:
- the approved Equity Uprise logo;
- no giant paragraph;
- no crowded values list.

The logo should be fabricated as dimensional signage or a backlit/halo-lit mark with restrained luminance.

One secondary line such as **LOBBY + INTAKE** or a small directory is acceptable.

---

## 6. Orientation lounge

Locate left of the central lobby.

### Purpose

Waiting for:
- appointments;
- partner meetings;
- interviews;
- organization/stakeholder intake.

### Furniture

Keep it small:
- one compact sofa or bench;
- two lounge chairs;
- one coffee/side table;
- one floor/table lamp if needed;
- one or two plants;
- one rug or acoustic textile zone.

Target seating: **6–8 people maximum**.

Do not furnish it like a private club.

### Sightlines

A seated visitor should still be able to see:
- reception;
- the elevator zone;
- the intake-room door.

---

## 7. Intake / verification consultation room

Adjacent to the lounge, preferably behind a framed glass partition.

### Function

Supports:
- stakeholder intake;
- prospective organizational engagement discussion;
- visitor consultation;
- short fellowship/interest screening;
- scheduled conversation;
- sensitive discussion that should not happen at reception.

### Size and capacity

Approximate room:
- **10 ft x 12 ft to 11 ft x 14 ft**;
- table for 4–6;
- simple wall display or monitor;
- no large presentation theater.

### Privacy

Use:
- framed glass with partial privacy band/frit or switchable/privacy film if desired;
- solid acoustic door;
- acoustic wall/ceiling treatment;
- target speech privacy appropriate for normal professional meetings.

Label only:
**INTAKE** or **NEW MEMBER / PARTNER INTAKE**.

Do not cover the glass in marketing copy.

---

## 8. Fixed elevator / vertical core

### Passenger elevator
- shaft **X54–62 / Y34–44**
- west-facing door into the elevator lobby
- primary public vertical circulation

### West Service Core
- overall reservation **X0–18 / Y54–72**

### Service / freight elevator
- shaft **X0–8 / Y60–72**
- conceptual south-facing service access
- staff/service use; not a replacement for a required exit

### Stair B
- revised enclosure **X8–18 / Y54–72**
- protected stair
- full **13'-6"** rise to Floor 2 in combined geometry
- shared slab opening approximately **X8.75–17.25 / Y58.25–71.25**

### Stair A
- enclosure **X60–72 / Y54–72**
- protected stair
- full **13'-6"** rise to Floor 2 in combined geometry
- shared slab opening approximately **X60.75–71.25 / Y58.25–71.25**

### Access control
Public elevator access and service/freight access may use different control rules. Final access-control, fire-service and egress behavior require professional design.

The browser/3D model may no longer use shortened decorative stair flights as vertical-continuity proof.

## 9. Public wayfinding / digital interaction

Floor 1 gets **one canonical wayfinding / next-action terminal**, not a bank of competing public kiosks.

The Development Passport Studio may contain multiple work positions because it is a work area, not a collection of unrelated lobby kiosks.

The slim Next Action / Building Directory can provide:
- check in;
- building directory;
- personalized next action after authentication;
- appointment lookup;
- accessible-route/help request;
- emergency-route guidance during scenarios.

Do not create separate lobby kiosks for every Equity Uprise capability. The building routes people into work; it does not turn the lobby into a menu wall.

---

## 10. Back-of-house requirements

Core V2 replans the north support band around the West Service Core.

- west service approach: **X0–18 / Y54–60**
- public/support corridor: **X18–60 / Y54–60**
- accessible restroom A: **X18–26 / Y60–70**
- accessible restroom B: **X26–34 / Y60–70**
- building operations / life safety: **X34–42 / Y60–72**
- IT / electrical: **X42–50 / Y60–72**
- janitor: **X50–54 / Y60–66**
- MEP / riser: **X50–60 / Y66–72**

The freight shaft **X0–8 / Y60–72**, revised Stair B **X8–18 / Y54–72**, Stair A **X60–72 / Y54–72**, and their slab openings are protected shared geometry.

Support functions may shrink/rebalance as shown, but reception/intake/public circulation may not invade the vertical core.

## 11. Circulation

The public circulation loop must be obvious.

### Primary path

Entrance → reception → elevator.

Keep this path wide, direct and furniture-free.

### Secondary path

Reception → lounge/intake.

### Clearances

Concept planning targets:
- primary path roughly **6 ft clear** where possible;
- secondary circulation at least **4 ft clear**;
- maintain accessible turning areas at reception, elevator and intake-room approach;
- do not place decorative objects in the path of travel.

Furniture should sit in zones, not float randomly in circulation.

---

## 12. Accessibility

At concept level, provide for:
- step-free public entry;
- accessible door clearances;
- accessible reception-counter portion;
- accessible elevator;
- wheelchair turning space;
- clear route to intake room;
- accessible seating position in lounge and intake room;
- accessible restroom in the back-of-house/public-support zone;
- visual and audible life-safety notification.

Final dimensions/code compliance require licensed design review for the real jurisdiction.

---

## 13. Life safety

Exterior/site authority:
- `FLOOR-01-SITE-EGRESS-SIMULATION.md`
- `production/floor-01/floor-01-site-egress.json`

B1 authority:
- `BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md`
- `production/basement-b1-program.json`

Because protected stairs continue below Floor 1, the level-of-discharge landing must include modeled barriers/wayfinding that prevent occupants from unintentionally continuing to B1 during evacuation.

Even though the 360 visual is not a construction document, the room must be designed as if it can actually exist.

Assume:
- full sprinkler coverage where required;
- addressable fire alarm;
- illuminated exit signage;
- emergency lighting;
- two compliant means of egress from occupied upper floors;
- rated separation around elevator/stair/service core as required;
- fire extinguisher/cabinet placed discreetly;
- no furniture blocking egress.

Do not make the glass public entrance the building's only conceptual escape path.

---

## 14. Structural / architectural shell

Keep the shell simple.

### Structure

Use a believable regular grid:
- steel or reinforced concrete frame;
- perimeter columns coordinated with glazing;
- non-loadbearing interior partitions around program areas.

### Perimeter

Floor 1 may have:
- real exterior entrance glazing;
- fixed/operable code-compliant glazing as appropriate.

No decorative cutouts that make the building impossible to stack vertically.

### Vertical alignment

The elevator/core walls shown here determine the alignment of Floors 2–6.

---

## 15. Material palette

The Floor 1 palette establishes the building-wide base.

### Floor

Preferred:
- honed or lightly polished charcoal/medium-gray concrete or stone-look porcelain;
- subtle wear and real joints;
- low-to-medium reflectance.

Avoid mirror-black marble.

### Walls

Use a restrained combination of:
- mineral plaster / dark warm-gray wall finish;
- charcoal stone-look panel at reception;
- blackened-steel trim;
- vertical wood slats used only as a warm accent;
- framed glass at intake room.

### Metals

- gunmetal;
- blackened steel;
- dark anodized aluminum.

The metal should feel slightly lived-in, not distressed or rusty.

### Red accent

Red is an identity accent, not the room's light source.

Use it in:
- one ceiling/cove line;
- a narrow reveal at reception;
- occasional wayfinding detail.

Do not line every edge in red neon.

---

## 16. Ceiling

A simple dark acoustic/mineral ceiling plane with:
- recessed warm-white downlights;
- one restrained circular/perimeter red cove/reveal that establishes the Equity Uprise visual language;
- integrated HVAC slots/diffusers.

Do not use multiple concentric sci-fi rings.

---

## 17. Lighting

Lighting should make the room welcoming and legible.

### General

- warm-white architectural lighting, approximately **2700–3000K** appearance;
- good vertical illumination at faces/reception;
- lower ambient light in lounge;
- task lighting inside intake room.

### Red light

Keep dim and architectural.

It must not:
- tint every surface red;
- overpower skin tones;
- make the lobby feel like a nightclub.

### Exterior at night

City/exterior light may be visible through the entrance/glazing but is background context only.

---

## 18. Acoustics

The room should not sound like a stone box.

Use:
- acoustic ceiling treatment;
- upholstered lounge seating;
- rug in lounge;
- absorptive backing at slat walls where appropriate;
- acoustic treatment in intake room;
- soft-close hardware.

Reception and intake should support normal confidential conversation without excessive reverberation.

---

## 19. Mechanical / electrical / data

The visual should respect real building services.

Plan for:
- linear slot diffusers or discreet ceiling supply;
- perimeter conditioning at glazing;
- return-air paths coordinated with ceiling;
- dedicated cooling/data for IT closet;
- floor/wall power at reception;
- concealed power/data for directory;
- Wi-Fi access point coverage;
- emergency power/life-safety circuits as required.

Do not place impossible freestanding electronics with no power/data path.

---

## 20. Security

Security is quiet and institutional, not militarized.

Provide conceptually:
- reception sightline to entrance;
- door/access-control hardware;
- one or two discreet cameras covering entry and core;
- visitor credential/check-in capability;
- controlled upper-floor elevator access if desired;
- secure staff/service door.

No weapons screening, turnstile forest or tactical checkpoint unless a later program decision explicitly requires it.

---

## 21. Branding and signage

### Primary mark

Use the exact approved Equity Uprise logo on the reception feature wall.

Do not:
- redraw;
- stylize;
- crop;
- recolor arbitrarily;
- invent alternate lockups.

### Secondary signage

Only what is needed:
- Lobby + Intake;
- Elevators / Floors 2–6;
- Intake;
- Restrooms/Exit where required;
- small building directory.

Avoid slogan walls and value-word lists.

---

## 22. Furniture identity

Furniture should be durable commercial-grade, simple and contemporary.

Avoid:
- gold luxury-club furniture;
- dramatic executive thrones;
- excessive decorative tables;
- novelty futuristic furniture.

The lobby needs:
- reception desk;
- 6–8 lounge seats total;
- one lounge table;
- intake table + 4–6 chairs;
- one directory;
- plants in a few deliberate locations.

That is enough.

---

## 23. Canonical 360 panorama requirements

Every Floor 1 360 visual must satisfy all of these.

### Technical composition

- true **2:1 equirectangular panorama**;
- eye-level camera;
- level horizon;
- coherent full-room wrap;
- no front-facing image simply stretched wide;
- floor and ceiling must resolve continuously through the seam.

### Required cardinal views

**0° / center:**  
Reception desk + Equity Uprise logo wall.

**+90° / right:**  
Fixed elevator/core.

**180° / seam:**  
Main exterior entrance/vestibule. This is the only floor where the seam is an exterior public entry.

**-90° / left:**  
Lounge + intake room.

### Required visible objects

- main entrance;
- reception;
- exact Equity Uprise logo;
- elevator/core;
- lounge;
- intake/consultation room;
- one minimal directory;
- modest plants;
- believable ceiling/floor.

### Must not appear

- balcony;
- terrace;
- second public exterior entrance;
- giant command table;
- holographic globe;
- multiple kiosk banks;
- giant world-map display;
- partner/donor wall dominating the room;
- media studio equipment;
- policy/evidence displays;
- fellowship directory wall;
- public forum topics wall;
- admin control screens;
- excessive slogans;
- overbuilt luxury-club styling.

Those belong elsewhere or nowhere.

---

## 24. Future hotspot logic

Floor 1 360 implementation should reserve a small number of interactive hotspots.

Suggested hotspots:
1. **Elevator** → open floor selector / move to another floor.
2. **Reception** → Equity Uprise overview / contact.
3. **Intake room** → stakeholder/organization intake.
4. **Directory** → building/program directory.
5. **Entrance** → return to exterior/building overview if an exterior scene exists.

Do not turn every chair or decorative object into a hotspot.

---

## 25. Floor 1 identity in one sentence

**A compact, serious civic-institute lobby where a visitor enters, immediately understands who Equity Uprise is, can speak to a person privately, and can move upward through the building without visual clutter or architectural confusion.**

---

## 26. Quality-control checklist

Before approving any new Floor 1 panorama, answer yes to every item:

- [ ] Is the main exterior entrance clearly present?
- [ ] Is reception directly opposite the entrance?
- [ ] Is the elevator on the fixed right-side core?
- [ ] Does the lounge/intake occupy the left-side zone?
- [ ] Is the exact approved Equity Uprise logo used?
- [ ] Is there only one primary reception desk?
- [ ] Is there only one small directory/check-in device?
- [ ] Does the room look like a modest professional institute rather than a luxury club?
- [ ] Is red lighting restrained?
- [ ] Are circulation paths free of furniture?
- [ ] Does the equirectangular seam make spatial sense?
- [ ] Can this floor stack logically under Floor 2?
- [ ] Could a builder plausibly construct what is shown?


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

The current capability authority contains **56 canonical building capabilities**; repo-source counts are governed by the generated source-coverage report. The separate Lifetime Development competency architecture is intentionally not collapsed into the building-capability count.

### Primary capabilities
- **M-Verified organization/profile intake** (`verification`, built_manual) — Intake / Verification Consultation on Floor 1; verified identity becomes part of Floor 3 network context.
- **Stakeholder and organization intake** (`stakeholder-intake`, built) — Reception/intake on Floor 1; relationship graph on Floors 3 and 6.

### Secondary / cross-floor capabilities
- **Neutral listening/conversation agent** (`conversation-agent`, built) — Listening Lounge; human handoff routes to the Desk without making the agent an ideological authority.
- **Policy Fellowship/application workflow** (`fellowship-applications`, built) — Fellowship application path, application tracking, and interview/meeting rooms.
- **Interview requests, availability and calendar scheduling** (`interviews-calendar`, built_guarded) — Member / Meeting Check-In and two Interview / Stakeholder Meeting rooms; no private calendar data shown publicly.
- **Program funding / support pathway** (`program-support-funding`, built_public_pathway) — Institutional Salon / Support represents donations, sponsorship and program-support routing. The detailed Equity Uprise Mission Fund record exists but its per-program meters/splits remain quiet until governance, custody, accounting and reporting are publishable.
- **Equity Uprise enterprise development program lane** (`enterprise-development`, built_guarded) — Opportunity Exchange includes a business/workforce/digital-capacity program lane. Program fit, measurable connected revenue and signed agreements are reviewed in meeting/briefing spaces; the building does not hardcode prices or imply automatic approval.

### Boundary rule
The building metaphor must preserve the source product's public/private and approval boundaries. A capability being represented on this floor does **not** make private records, OAuth credentials, contact data, moderation state, outreach controls, financial/accounting details, government submission controls, music delivery controls, or other guarded operations publicly accessible.

Enterprise Development is represented as a program pathway, not as a pricing billboard; commercial terms remain external program data. Detailed Equity Uprise Mission Fund accounting remains quiet until its governance/custody/accounting/reporting state is publishable.

This section describes repo/program fidelity. It does not alter the shared Core V2 geometry and is **not for construction**.


## Floor 1 completion addendum — B1 / site / emergency planning

Floor 1 is considered simulation-program complete only when the current machine-readable site/B1 authorities remain present and validated.

The model now includes:
- two protected-stair exterior discharge concepts;
- a south public/accessible approach;
- a secure west service approach;
- two assembly areas;
- emergency equipment markers;
- emergency-action-plan data;
- B1 technical/service infrastructure;
- below-grade egress/accessibility training hooks.

See `SIMULATION-CODE-REFERENCE-PROFILE.md` for the researched real-world reference basis and its limitations.
