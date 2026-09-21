# Equity Uprise Building — Floor 04: Media + Culture

> Status: **CANONICAL FLOOR 4 SPEC — LOCKED FOR QUALITY CONTROL**  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Media + Culture**  
> This file is the source of truth for Floor 4 floor-plan work, 360 panorama generation, hotspot placement, 3D reconstruction, and implementation.  
> Do not generate a Floor 4 environment that conflicts with this document.


> **Core V2 migration authority:** `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json`.
> Combined-model finished-floor elevation: **+40'-6"**.
> Shared vertical systems override any stale Core V1 coordinate language on this branch.

## 1. Repo-derived purpose

Floor 4 spatializes the existing Equity Uprise media/culture functions documented in the repo.

### Equity Uprise civic-anthem catalogue

`data/albums.json` defines the Equity Uprise release as a real four-track civic-anthem collection. The current catalogue includes:
- Environmental Injustice;
- Environmental Injustice (Brave mix);
- Please Set Me Free;
- Money or the Power.

These are live catalogue data, not permanent architectural signage. Future catalogue changes should not require rebuilding the room.

### `equity-uprise-fellowship.html`

Existing culture/media participation includes:
- October 5 Bridgeport program;
- the rally photo wall;
- civic anthem submissions;
- artist participation;
- film/community work;
- partnership/sponsorship around programming;
- entry into the music/listening system.

### `walls/eu-rally.html`

The repo contains an actual photographic archive for the Equity Uprise Rally / October 5 program.

Physical implication:
- Floor 4 should contain a modest archive/gallery component;
- the gallery should use real Equity Uprise media, not invented event photos.

### `supabase/functions/eu-music/index.ts`

The Equity Uprise backend includes a real music supply-chain workflow:
- release creation;
- release metadata;
- recordings/tracks;
- rights splits;
- UPC/ISRC/master-owner preflight;
- approval-gated DDEX delivery.

Physical implication:
- Floor 4 may contain a small creator/review workspace and media support room;
- it should not expose rights/admin controls publicly.

### `docs/music-platform.md`

The wider McCluster music system already distinguishes:
- public listening/discovery;
- creator identity;
- creator submissions;
- private masters;
- rights/derivative-work attestations;
- release review;
- licensing/commerce;
- analytics.

Floor 4 uses only the parts that belong in the Equity Uprise public/cultural environment. Operator/admin review remains secure/back-of-house.

### Boundary with other floors
- Floor 2 handles public issue discussion.
- Floor 3 handles fellows, people, opportunities and interviews.
- Floor 5 handles policy/evidence/proof.
- Floor 6 handles institutional direction.

Floor 4 therefore focuses on **listening, watching, cultural memory, creator participation, and small-scale media production**.

---

## 2. Architectural intent

Floor 4 should feel like a restrained civic media room inside the same institute.

A visitor should understand:
- I can hear Equity Uprise music here.
- I can watch event/civic media here.
- I can browse a real visual archive.
- Artists/creators have a modest place to record/review work.
- The floor is not pretending to be a commercial recording campus.

It is **not**:
- a nightclub;
- a concert venue;
- a radio station;
- a television newsroom;
- a large soundstage;
- a luxury recording studio;
- a public admin desk;
- a giant content-control room.

---

## 3. Locked building shell

This level inherits the Core V2 building datum exactly.

- Exterior footprint: **72'-0" × 72'-0"**
- Gross conceptual area: **5,184 sq ft**
- Structural coordination grid: **18' × 18'**
- Floor-to-floor: **13'-6"**
- Finished-floor elevation in combined model: **+40'-6"**
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

Floor 4 has:
- **no exterior entrance**;
- **no exterior door**;
- **no balcony**;
- **no terrace**.

The south and exposed perimeter remain sealed upper-floor glazing/windows.

Protected stair doors enter protected stair enclosures only.

---

## 5. Canonical 360 coordinate system

### Camera
- approximately **(36,28)**
- eye height approximately **5'-4" AFF**
- level horizon

### 0° / north-forward
The **Media Wall / Listening Room** with the **MEDIA + CULTURE** identity above/beyond it.

### +90° / east-right
The fixed elevator/core with one slim floor-control/listening check-in terminal adjacent to the elevator lobby.

### 180° / south-behind
Two modest production rooms:
- **Creator Recording Room**
- **Edit / Review Suite**

Beyond/around them is sealed upper-floor glazing.

There is no exterior door.

### -90° / west-left
The **Culture Archive / Rally Gallery** with a small informal viewing lounge.

---

## 6. Central listening / screening room

### Function
Supports:
- listening to the Equity Uprise catalogue;
- watching civic/event media;
- reviewing short films/explainers;
- small artist/community screenings;
- cultural programming for modest groups.

### Seating
Use a low, flexible lounge arrangement rather than theater rows.

Canonical daily configuration:
- one low central sectional/bench arrangement;
- two movable lounge chairs;
- **8 seats maximum**.

Planning zone:
- approximately **X 24–48 / Y 28–50**

Do not add tiered seating.

### Media wall
Approximate wall band:
- **X 22–50 / Y 50–54**

It carries:
- exact approved Equity Uprise mark;
- **MEDIA + CULTURE**;
- three restrained dynamic media zones:
  1. **LISTEN**
  2. **WATCH**
  3. **ARCHIVE**

The active album, track names, event photos, videos and program content must come from repo/live data. Do not permanently engrave current track titles into architectural finishes.

The media wall is a playback surface, not a broadcast-control dashboard.

---

## 7. Culture Archive / Rally Gallery

Locate on the west side:
- approximately **X 2–18 / Y 18–38**

### Purpose
Supports:
- the October 5 / Rally photographic record;
- event stills;
- civic-culture archive material;
- visual documentation connected to Equity Uprise programming.

### Display
Use one continuous or segmented gallery wall with:
- 4–6 frames/screens maximum in the canonical scene;
- real archive images where available;
- simple captions/metadata;
- no invented event history.

### Informal viewing lounge
Provide:
- one compact bench/sofa;
- two chairs;
- one small table;
- 4–6 seats total.

The archive should feel like a civic photo wall, not an art museum.

---

## 8. Creator Recording Room

Floor 4 includes one small recording room because the repo supports civic-anthem submissions and an actual music release workflow.

Approximate coordinates:
- **X 2–15 / Y 4–16**
- conceptual inside size: approximately **13' × 12'**

### Function
Supports:
- voice recording;
- civic-anthem demo recording;
- spoken-word narration;
- short-form audio capture;
- simple creator session.

### Contents
Keep it compact:
- one microphone position;
- one small work surface;
- two visitor/artist seats maximum;
- acoustic wall treatment;
- acoustic ceiling treatment;
- interior observation/glass panel only if needed;
- no large vocal booth inside this already-small room.

This is not a commercial tracking room for full bands.

---

## 9. Edit / Review Suite

Approximate coordinates:
- **X 17–31 / Y 4–16**
- conceptual inside size: approximately **14' × 12'**

### Function
Supports:
- listening/review;
- short video editing;
- photo selects;
- caption/subtitle review;
- release/artwork review;
- creator collaboration.

### Contents
Use:
- one two-person editing desk/workstation;
- one client/visitor chair pair or compact bench;
- one calibrated display/monitor;
- acoustic treatment.

Do not expose:
- DDEX credentials;
- payment/commerce controls;
- private masters;
- rights splits;
- operator approval controls

on public-facing screens.

---

## 10. Media / Release Control

Use one slim terminal adjacent to elevator:
- approximate footprint **X 49–51 / Y 24–29**

Functions may include:
- continue listening;
- open the Equity Uprise album;
- navigate artist/creator participation;
- access floor directory;
- return to personal media session where appropriate.

No staffed reception desk is required.

---

## 11. South perimeter

The production rooms sit inside the south facade line.

Use:
- sealed upper-floor glazing;
- controlled daylight with acoustic/privacy treatment;
- no exterior door;
- no balcony/terrace.

Where studio acoustics require opaque wall construction, the exterior may remain visually/glazingly consistent outside while interior lining creates acoustic isolation.

---

## 12. North support band

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

### Media equipment / storage
- **X34–42 / Y60–72**
- conceptual 8' × 12'

### Media / Music Operations
- **X42–50 / Y60–72**
- conceptual 8' × 12'

### Janitor
- **X50–54 / Y60–66**

### MEP / risers
- **X50–60 / Y66–72**
- vertically stacked Core V2 reservation

The service/freight shaft, both stair enclosures and all shared slab openings are do-not-block geometry.

## 13. Stairs / vertical circulation

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

## 14. Circulation

### Primary
Elevator → central media/listening room:
- approximately **6 ft clear** where practical.

Media room → stairs/restrooms:
- approximately **6 ft clear** where practical.

### Secondary
Media room → archive/gallery:
- at least approximately **4 ft clear**.

Media room → production rooms:
- direct and unobstructed;
- do not route through lounge furniture.

Open floor area is intentional.

---

## 15. Accessibility

At concept level provide:
- accessible elevator arrival;
- step-free circulation;
- accessible seating position in media/listening room;
- accessible archive/gallery route;
- accessible recording/edit-room approach;
- accessible Media / Release Control terminal;
- accessible restroom concepts;
- visual/audible life-safety notification.

Do not claim ADA compliance until licensed review.

---

## 16. Life safety

Conceptually preserve:
- two protected stairs;
- rated core separation as required;
- sprinkler/fire alarm coverage as required;
- emergency lighting;
- exit signage;
- unobstructed egress.

Acoustic construction may not compromise required ratings or egress.

Final occupancy, occupant load and life-safety calculations require professional code analysis.

---

## 17. Structure

Respect:
- the 72' × 72' shell;
- 18' coordination grid;
- aligned vertical systems;
- final floor-loading requirements.

Acoustic isolation assemblies and suspended ceilings must be coordinated with real structure rather than floating independently in renders.

---

## 18. Material palette

Continue the same Equity Uprise building family.

### Floor
- honed gray concrete / durable stone-look floor in circulation;
- acoustic rug/carpet zones only in listening/gallery areas;
- resilient/acoustic flooring in production rooms where appropriate.

### Walls
- warm dark-gray mineral finish;
- blackened/gunmetal steel trim;
- restrained wood acoustic slats;
- fabric/acoustic panels in production rooms;
- framed glass only where acoustic/privacy performance remains believable.

### Red accent
Use sparingly:
- playback active state;
- floor identifier;
- thin architectural reveal.

No nightclub lighting.

---

## 19. Ceiling / lighting

### Central room
Use:
- simple acoustic ceiling treatment;
- restrained linear/perimeter lighting;
- one modest feature fixture if needed.

### Gallery
Use controlled wall-wash/accent lighting.

### Production rooms
Use practical dimmable working light, not theatrical color effects by default.

General appearance:
- warm-white approximately **2700–3000K**;
- screen/image color must remain legible.

---

## 20. Acoustics

Acoustic performance is critical on Floor 4.

### Central listening room
Use:
- absorptive ceiling;
- absorptive wall treatment;
- upholstered seating;
- controlled reverberation.

### Creator Recording Room
Use stronger acoustic isolation:
- decoupled or high-STC assemblies as designed later;
- sealed acoustic door;
- acoustic treatment;
- low-noise ventilation.

### Edit / Review Suite
Use:
- controlled reflections;
- acoustic door/seals;
- monitor/listening position coordinated to room geometry.

### Mechanical noise
Low-noise HVAC is essential.

Final acoustic assemblies require specialist design.

---

## 21. Technology / power / data

Provide plausible service routes for:
- central media wall;
- Media / Release Control terminal;
- gallery displays;
- recording room;
- edit suite;
- network/IT systems;
- media storage charging area.

Private masters and rights/admin information remain on secure systems.

Do not depict impossible wireless equipment with no power/data/service route.

---

## 22. Privacy / rights / security

Public media displays may show:
- released/public Equity Uprise music;
- public rally/event photos;
- public film/civic media;
- public artist/creator information.

Do not publicly expose:
- unreleased masters;
- private creator contact details;
- rights splits;
- DDEX recipient credentials;
- licensing/payment information;
- operator approval queues.

Media Equipment/Storage and Media/Music IT remain secure.

---

## 23. Branding

Use the exact approved Equity Uprise mark.

Primary:
- north MEDIA + CULTURE wall.

Secondary:
- modest Floor 4 identifier at elevator.

Do not:
- redraw/crop the mark;
- use HM branding;
- create fake artist/company logos;
- cover the floor in promotional graphics.

---

## 24. Furniture identity

Canonical visible furniture:
- one low 8-seat maximum listening/screening arrangement;
- two movable lounge chairs within that count;
- one archive/gallery bench or compact sofa;
- two archive/gallery chairs;
- one archive/gallery table;
- one small recording-room work surface;
- two recording-room seats maximum;
- one two-person editing workstation;
- two edit/review visitor seats;
- one elevator-side Media / Release Control terminal.

No additional large furniture is canonical.

---

## 25. Canonical 360 panorama requirements

### Technical
- true 2:1 equirectangular panorama;
- locked camera datum;
- level horizon;
- continuous upper-floor shell;
- acoustically plausible production-room construction.

### Required cardinal views

**0° / north:**  
Central listening/screening room + MEDIA + CULTURE wall with Listen / Watch / Archive surfaces.

**+90° / east:**  
Fixed elevator/core + slim Media / Release Control terminal.

**180° / south:**  
Creator Recording Room + Edit / Review Suite + sealed upper-floor glazing. No exterior door.

**-90° / west:**  
Culture Archive / Rally Gallery + modest informal viewing lounge.

### Must not appear
- exterior entrance;
- balcony;
- terrace;
- nightclub bar;
- concert stage;
- giant mixing console;
- full commercial recording studio;
- newsroom set;
- giant video wall covering every wall;
- fellowship directory;
- Public Forum issue wall;
- Evidence Room materials;
- admin music-rights console;
- invented event photographs;
- invented artist/release names.

---

## 26. Hotspot logic

Suggested Floor 4 hotspots:

1. **Listen** → Equity Uprise album / music engine.
2. **Watch** → public civic/event video.
3. **Archive** → rally/photo archive.
4. **Culture Archive wall** → full rally/gallery view.
5. **Creator Recording Room** → civic-anthem/creator participation.
6. **Edit / Review Suite** → creator/review workflow context.
7. **Media / Release Control terminal** → listening/navigation state.
8. **Elevator** → floor selector.

---

## 26A. Semantic interaction modes

The existing Media + Culture spaces carry the post-creation pipeline explicitly:

- **Rights / Clearance** — private rights/catalog/release state inside Media / Music Operations and Release Control.
- **Licensing / Commerce** — public terms and rights-cleared offers, with authenticated checkout where supported.
- **Release / Delivery** — approval-gated release preparation and delivery operations.
- **DDEX Status** — private delivery/configuration state; never presented as connected when provider/partner configuration is absent.

These modes use the Creator Recording Room, Edit / Review Suite, Media / Release Control and supporting displays. They do not justify additional rooms.

## 27. Content-authenticity rule

All public music, artist, rally, event and archive content shown on Floor 4 must come from actual repo/live records.

Do not invent:
- civic anthems;
- artist collaborations;
- events;
- rally photography;
- release metadata;
- cultural-history claims.

The floor may be atmospheric; the content must remain factual.

---

## 28. Floor 4 identity in one sentence

**A restrained civic media floor where Equity Uprise's real music, event imagery and cultural record can be heard and seen, with only enough production space to support creators and review work without turning the institute into a commercial entertainment complex.**

---

## 29. Quality-control checklist

- [ ] 72' × 72' shell preserved
- [ ] 18' grid preserved
- [ ] elevator at X 54–62 / Y 34–44
- [ ] Stair A at X 60–72 / Y 54–72
- [ ] Stair B at X 8–18 / Y 54–72
- [ ] MEP/riser stack preserved
- [ ] no exterior public door
- [ ] no balcony/terrace
- [ ] 360 camera approximately (36,28)
- [ ] central media/listening room north
- [ ] elevator + Media / Release Control terminal east
- [ ] production rooms south
- [ ] archive/gallery west
- [ ] services/restrooms stack vertically
- [ ] acoustic logic is plausible
- [ ] public displays expose no private/restricted media data
- [ ] no invented music/events/photos
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
- **Equity Uprise music/catalogue listening surface** (`music-catalogue`, built_shared_platform) — Media / Listening Zone.
- **Artist/creator participation and studio workflow** (`artist-creator`, built_shared_platform) — Creator Recording Room and Edit / Review Suite.
- **Music rights/catalog/release graph** (`music-rights`, built) — Media / Music Operations support and Media / Release Control.
- **Equity Uprise/McCluster release preparation** (`music-release`, built_guarded) — Media / Release Control; high-risk delivery approval belongs to Floor 6.
- **DDEX ERN delivery** (`ddex`, built_disabled_until_configured) — Media release pipeline, not a public room.
- **Equity Uprise Rally/event media archive** (`rally-media`, built) — Culture Archive / Rally Gallery.
- **Press release, executive summary and social-prep derivatives** (`communication-derivatives`, built) — Edit / Review Suite; lineage remains tied to Floor 5 source artifacts.
- **Creator licensing / commerce** (`creator-licensing-commerce`, built_shared_platform) — Creator Studio / Media + Culture workflow. Rights-cleared releases may expose licensing offers and authenticated checkout through the shared McCluster Music stack; this does not resurrect the retired marketplace.

### Secondary / cross-floor capabilities
- **Docket 516/516R evidence room and public-record archive** (`evidence-room`, built) — Evidence + Proof Archive; media context may also appear on Floor 4.
- **Canonical artifact graph and derivative lineage** (`artifacts`, built) — Publication/Proof systems; communication derivatives route to Floor 4.

### Boundary rule
The building metaphor must preserve the source product's public/private and approval boundaries. A capability being represented on this floor does **not** make private records, OAuth credentials, contact data, moderation state, outreach controls, financial/accounting details, government submission controls, music delivery controls, or other guarded operations publicly accessible.

Enterprise Development is represented as a program pathway, not as a pricing billboard; commercial terms remain external program data. Detailed Equity Uprise Mission Fund accounting remains quiet until its governance/custody/accounting/reporting state is publishable.

This section describes repo/program fidelity. It does not alter the shared Core V2 geometry and is **not for construction**.
