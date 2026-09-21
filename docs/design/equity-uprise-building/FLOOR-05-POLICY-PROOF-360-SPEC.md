# Equity Uprise Building — Floor 05: Policy + Proof

> Status: **WORKING PRE-ITERATIVE FLOOR 5 PROGRAM REFERENCE — CORE V2 CHASSIS RETAINED**  
> Program note: this floor has **not** yet received the activity/space reconciliation completed for Floor 1. Preserve useful repo-derived requirements, but do not treat the current room program or working identity as final.  
> Building: compact six-floor Equity Uprise headquarters / civic institute  
> Floor identity: **Policy + Proof**  
> This file is the source of truth for Floor 5 floor-plan work, 360 panorama generation, hotspot placement, 3D reconstruction, and implementation.  
> Do not generate a Floor 5 environment that conflicts with this document.


> **Core V2 chassis authority:** `BUILDING-CORE-V2-SPEC.md` + `production/building-core-v2.json`.
> Combined-model finished-floor elevation: **+54'-0"**.
> Shared vertical systems override any stale Core V1 coordinate language on this branch.

## 1. Repo-derived purpose

Floor 5 spatializes Equity Uprise's real policy, evidence, research, verification, publication, and public-record systems.

### `equity-uprise.html` — current policy architecture

The active institutional work includes:
- public affairs;
- policy intelligence;
- civic media;
- infrastructure/data-center governance;
- research-to-public-record workflow;
- a working-paper/policy architecture.

Current policy modules documented in the repo:
1. classification + aggregation;
2. sound + low-frequency acoustics;
3. water + cooling;
4. power + generation;
5. independent review;
6. continuing compliance.

These are live policy modules. They may appear dynamically on research displays but should not be permanently engraved into the building.

### `docket-516.html` — Evidence Room

The repo contains a substantive Docket 516 / 516R evidence system with:
- plain-English explanation;
- procedural history;
- parties/players;
- an indexed Evidence Room;
- public-record terminology;
- application/testimony/exhibit/comment/transcript distinctions;
- the closed Docket 516R record.

The page references an archive of hundreds of filings. This justifies a real evidence/archive component on Floor 5.

### `policy.html` and `policy-memo-dna.html`

The policy record includes:
- the 2024 memorandum to Governor Brian Kemp;
- Georgia school-meals policy work;
- Connecticut Docket 516 / 516R public-record work;
- source-backed policy writing and references.

Physical implication:
- Floor 5 needs a policy-writing/research environment;
- it should not become a ceremonial museum of past wins.

### Proof / credential records

The repo contains real proof documents including:
- Connecticut General Assembly citations;
- Bridgeport Equity Uprise Human Rights Day proclamation;
- Georgia Youth Innovation & Civic Leadership Week proclamation;
- Docket 516 / 516R evidence;
- infrastructure engagement documentation;
- public-charity/organizational proof records.

Only records actually present in the repo or live system may be shown.

### `supabase/functions/eu-workspace/index.ts`

The research workspace supports:
- research projects;
- source addition and verification;
- claims;
- evidence linking;
- manuscript sections;
- review comments;
- section approval.

This is the strongest functional basis for the Policy Lab.

### `supabase/functions/eu-publish/index.ts`

The publication workflow includes:
- manuscript readiness checks;
- unsupported-claim checks;
- review;
- canonical publication preparation;
- approval;
- rendering;
- distribution planning.

Physical implication:
- Floor 5 needs a quiet publication/review room;
- publication and distribution controls remain secure.

### `supabase/functions/eu-monitor/index.ts`

The monitoring system can observe:
- RSS feeds;
- source health;
- research literature;
- government dockets;
- legislation/agendas;
- stakeholder sites;
- citations;
- custom APIs.

Monitors observe; they do not publish or file automatically.

Physical implication:
- policy intelligence may be represented as a restrained research-status surface;
- do not create a giant live-surveillance command center.

### `supabase/functions/eu-government/index.ts`

Government submission workflow supports:
- drafting;
- editing;
- preflight;
- approval-gated submission.

Physical implication:
- a publication/submission review room is justified;
- filing controls are not public wall content.

### Boundary with other floors
- Floor 2 = public discussion.
- Floor 3 = fellowships/network.
- Floor 4 = media/culture.
- Floor 6 = institutional direction/current command view.

Floor 5 is specifically **where claims become supported records and policy documents**.

---

## 2. Architectural intent

Floor 5 should feel like a serious, compact research institute.

A visitor/researcher should understand:
- policy work is developed here;
- sources and claims are checked here;
- the public record is preserved here;
- documents are reviewed before publication/submission;
- proof is organized, not theatrically displayed.

The atmosphere should be more focused and quieter than Floors 2–4.

It is **not**:
- a military war room;
- an intelligence agency command center;
- a courthouse;
- a library with endless stacks;
- a museum of awards;
- a government filing office;
- a newsroom;
- an admin/control-plane room.

---

## 3. Locked building shell

This level inherits the Core V2 building datum exactly.

- Exterior footprint: **72'-0" × 72'-0"**
- Gross conceptual area: **5,184 sq ft**
- Structural coordination grid: **18' × 18'**
- Floor-to-floor: **13'-6"**
- Finished-floor elevation in combined model: **+54'-0"**
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

Floor 5 has:
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
The **Policy Lab** with the **POLICY + PROOF** research/evidence wall beyond it.

### +90° / east-right
The fixed elevator/core with one slim Research / Publication Navigator adjacent to the elevator lobby.

### 180° / south-behind
Two modest enclosed rooms:
- **Source Review Room**
- **Publication / Submission Review Room**

Beyond/around them is sealed upper-floor glazing.

There is no exterior door.

### -90° / west-left
The **Evidence + Proof Archive**, including restrained Docket 516/516R and credential/proof access.

---

## 6. Central Policy Lab

### Function
Supports:
- research-project collaboration;
- policy drafting;
- claim/source review;
- evidence linking;
- manuscript review;
- small working sessions;
- working-paper development.

### Policy table
Use one substantial but modest shared research table:
- approximately **16 ft × 5 ft**;
- centered approximately around **(36,41)**;
- **8 seats maximum**;
- one accessible seating position;
- concealed power/data through a real floor-service route.

This is a working table, not a holographic command table.

### Policy / Publication / Impact Wall
Approximate wall band:
- **X 22–50 / Y 50–54**

It carries:
- exact approved Equity Uprise mark;
- **POLICY + PROOF**;
- three restrained dynamic information zones:
  1. **RESEARCH**
  2. **EVIDENCE**
  3. **RECORD**

These surfaces may show:
- current research-project state;
- source verification;
- claim/evidence status;
- policy-module navigation;
- publication readiness;
- public-record navigation.

Do not permanently bake current political policy positions, claims, or conclusions into architectural graphics.

---

## 7. Evidence + Proof Archive

Locate west of the central Policy Lab:
- approximately **X 2–18 / Y 18–40**

### Purpose
Supports:
- Docket 516 / 516R archive access;
- evidence/document browsing;
- public-record terminology;
- citations/proclamations/credential proof;
- infrastructure-engagement documentation;
- source provenance.

### Physical character
Use:
- one restrained document/archive wall;
- a few secure flat files/storage cabinets;
- one compact reading table;
- 4 seats maximum;
- one digital archive/search surface.

Do not create endless decorative bookshelves.

### Proof wall
Only actual documented items may appear.

Examples supported by the repo include:
- Connecticut General Assembly citations;
- Bridgeport Human Rights Day proclamation;
- Georgia Youth Innovation & Civic Leadership Week proclamation;
- Docket 516/516R record;
- infrastructure engagement documentation.

Do not invent certificates, awards, agencies, or outcomes.

---

## 8. Source Review Room

Approximate coordinates:
- **X 2–15 / Y 4–16**
- approximately **13' × 12'**

### Function
Supports:
- source review;
- citation checking;
- claim-to-source comparison;
- sensitive-source discussion;
- small research review meetings.

### Contents
- one 5' × 3' table;
- 4 chairs maximum;
- one wall display;
- secure document surface/storage;
- privacy/acoustic treatment.

This is not a legal deposition room.

---

## 9. Publication / Submission Review Room

Approximate coordinates:
- **X 17–32 / Y 4–16**
- approximately **15' × 12'**

### Function
Supports:
- manuscript review;
- publication readiness;
- review comments;
- section approval;
- government-submission preflight;
- final human review before approval-gated actions.

### Contents
- one 7' × 3' review table;
- 4–6 chairs maximum;
- one wall display;
- secure workstation connection;
- acoustic/privacy treatment.

Public-facing imagery must not reveal:
- private drafts;
- submission credentials;
- approval tokens;
- unpublished sensitive claims;
- private reviewer comments.

---

## 10. Research / Publication Navigator

One slim terminal adjacent to the elevator:
- approximate footprint **X 49–51 / Y 24–29**

Functions may include:
- current project navigation;
- Evidence Room access;
- policy archive;
- publication status;
- floor directory.

No staffed reception desk.

---

## 11. South perimeter

The two review rooms sit inside the south facade line.

Use:
- sealed upper-floor glazing;
- controlled daylight;
- internal privacy/acoustic lining where needed;
- no exterior door;
- no balcony/terrace.

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

### Secure Evidence Storage
- **X34–42 / Y60–72**
- conceptual 8' × 12'

### Research / Publication Systems
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
Elevator → Policy Lab:
- approximately **6 ft clear** where practical.

Policy Lab → north support/stairs:
- approximately **6 ft clear**.

### Secondary
Policy Lab → Evidence + Proof Archive:
- at least approximately **4 ft clear**.

Policy Lab → review rooms:
- direct, unobstructed and accessible.

Do not obstruct circulation with display cases.

---

## 15. Accessibility

At concept level provide:
- accessible elevator arrival;
- step-free routes;
- accessible Policy Lab seating;
- accessible archive/search position;
- accessible review-room routes;
- accessible research terminal;
- accessible restroom concepts;
- visual/audible life-safety notification.

Do not claim ADA compliance until licensed review.

---

## 16. Life safety

Conceptually preserve:
- two protected stairs;
- required core separations;
- sprinkler/fire-alarm coverage as required;
- emergency lighting;
- exit signage;
- unobstructed egress.

Archive/storage loads and fire protection require professional design.

Final occupancy, occupant load, travel distance, exit separation, ratings and fire protection require code analysis.

---

## 17. Structure

Respect:
- 72' × 72' shell;
- 18' coordination grid;
- vertically aligned cores/risers;
- final structural loading for document/archive storage.

Heavy archive cabinets must be coordinated with real structural capacity.

---

## 18. Material palette

Continue the building family.

### Floor
- honed gray concrete / durable stone-look commercial floor;
- low-pile acoustic textile only in archive/reading zones if desired.

### Walls
- warm dark-gray mineral finish;
- blackened/gunmetal steel;
- restrained wood acoustic slats;
- archival/display millwork in dark neutral finishes;
- framed glass at review rooms only where privacy remains credible.

### Red accent
Use sparingly:
- active research status;
- floor identifier;
- thin architectural reveal.

No red command-center glow.

---

## 19. Ceiling / lighting

### Policy Lab
Use:
- even, high-quality task lighting;
- restrained linear fixture over table;
- acoustic ceiling treatment.

### Archive
Use:
- low-UV, document-safe accent/reading lighting where real documents are displayed;
- controlled glare.

### Review rooms
Use:
- dimmable task/ambient lighting;
- screen-friendly lighting.

General appearance:
- warm-neutral approximately **3000K**;
- slightly brighter and more task-oriented than Floor 4.

---

## 20. Acoustics

Floor 5 requires quiet concentration.

Use:
- acoustic ceiling;
- wall absorption;
- sealed review-room doors;
- low-noise HVAC;
- soft furnishings only where useful;
- acoustic separation from elevator/service noise.

Normal review-room conversation should not carry into the central lab.

---

## 21. Technology / power / data

Provide plausible service routes for:
- Policy / Publication / Impact Wall;
- archive/search surface;
- Research / Publication Navigator;
- Policy Lab table;
- Source Review Room;
- Publication/Submission Review Room;
- secure Research/Policy IT.

Private research and approval data remain on authenticated systems.

---

## 22. Privacy / records / security

Public or visitor-accessible displays may show:
- public policy documents;
- public filings;
- public citations/proclamations;
- published research;
- public Evidence Room records.

Do not publicly expose:
- draft manuscripts;
- unpublished claims;
- sensitive source notes;
- private reviewer comments;
- approval tokens;
- government-submission credentials;
- secure monitor configuration;
- personal data.

Secure Evidence Storage and Research/Policy IT are back-of-house.

---

## 23. Branding

Use the exact approved Equity Uprise mark.

Primary:
- north POLICY / PUBLICATION / IMPACT wall.

Secondary:
- modest Floor 5 identifier at elevator.

Do not:
- redraw/crop the mark;
- use HM branding;
- create fake seals or government insignia;
- invent institutional endorsements.

---

## 24. Furniture identity

Canonical visible furniture:
- one 16' × 5' Policy Lab table;
- 8 chairs maximum;
- one compact archive reading table;
- 4 archive seats maximum;
- one Source Review table + 4 chairs;
- one Publication/Submission Review table + 4–6 chairs;
- one Research / Publication Navigator;
- restrained archive cabinets/display cases.

No additional large furniture is canonical.

---

## 25. Canonical 360 panorama requirements

### Technical
- true 2:1 equirectangular panorama;
- locked camera datum;
- level horizon;
- continuous upper-floor shell;
- believable document/archive storage.

### Required cardinal views

**0° / north:**  
Policy Lab + POLICY / PUBLICATION / IMPACT wall with Research / Evidence / Record surfaces.

**+90° / east:**  
Fixed elevator/core + Research / Publication Navigator.

**180° / south:**  
Source Review Room + Publication / Submission Review Room + sealed glazing. No exterior door.

**-90° / west:**  
Evidence + Proof Archive with restrained Docket/credential/public-record access.

### Must not appear
- exterior entrance;
- balcony;
- terrace;
- giant war-room map;
- holographic globe;
- newsroom;
- courtroom;
- campaign signage;
- invented government seals;
- giant trophy/award wall;
- Public Forum discussion setup;
- music/media studio gear;
- fellowship directory;
- admin control dashboard;
- fake policy outcomes;
- invented documents.

---

## 26. Hotspot logic

Suggested Floor 5 hotspots:

1. **Research** → working paper / research projects.
2. **Evidence** → Docket 516/516R Evidence Room.
3. **Record** → policy archive / published record.
4. **Evidence + Proof Archive** → credentials/proclamations/public evidence.
5. **Source Review Room** → source/claim verification context.
6. **Publication / Submission Review** → publication/government preflight context.
7. **Research terminal** → project/archive navigation.
8. **Elevator** → floor selector.

---

## 26A. Semantic interaction modes

Floor 5's existing lab, archive, review rooms and wall expose the full research-to-record lifecycle as distinct modes:

- **Claims ↔ Evidence** — explicit claim/evidence relationships and source verification.
- **Artifact Provenance / Lineage** — source → canonical artifact → derivative lineage.
- **Distribution / Syndication** — approval-gated publication distribution state.
- **Contributor Identity / ORCID** — contributor identity/configuration status inside publication workflow.
- **DOI / Crossref** — DOI deposit/verification state; configuration-dependent where external credentials are required.
- **Dockets / Regulatory Watch** — government targets/dockets and recurring intelligence.
- **Monitor / Watchlist** — source, literature, government, stakeholder and citation monitoring with impact findings.

These are screen/wall/workspace states inside the existing Policy Lab, Source Review, Publication / Submission Review, Evidence Archive and Research / Publication Navigator. They do not add rooms or move evidence/control authority.

## 27. Political-neutrality / evidence rule

Floor 5 may contain policy work, but the architecture itself does not endorse a political side.

Policy claims, source status, research findings, and public-record content must come from the actual Equity Uprise repo/live system.

Distinguish:
- source;
- claim;
- evidence;
- analysis;
- approved/publication state.

Do not convert draft or contested material into permanent architectural fact.

---

## 28. Floor 5 identity in one sentence

**A quiet policy-and-evidence floor where research is written, sources are checked, public records are organized, and documents are reviewed before they become durable public work.**

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
- [ ] Policy Lab north/forward
- [ ] elevator + research terminal east/right
- [ ] review rooms south
- [ ] Evidence + Proof Archive west
- [ ] services/restrooms stack vertically
- [ ] archive/document loads treated plausibly
- [ ] public displays expose no private drafts/credentials
- [ ] no invented evidence/documents/outcomes
- [ ] room remains serious and modest
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
- **Research projects and memberships** (`research-projects`, built) — Policy Lab.
- **Sources, verification, supersession and citations** (`source-graph`, built) — Source Review Room and Evidence + Proof Archive.
- **Claims linked to evidence** (`claim-evidence`, built) — Evidence graph on Policy / Publication / Impact Wall.
- **Manuscripts, sections, revisions and review comments** (`manuscript-review`, built) — Policy Lab and Publication / Submission Review room.
- **Docket 516/516R evidence room and public-record archive** (`evidence-room`, built) — Evidence + Proof Archive; media context may also appear on Floor 4.
- **Credentials, citations, proclamations and proof documents** (`credentials-proof`, built) — Evidence + Proof Archive and institutional record.
- **Canonical artifact graph and derivative lineage** (`artifacts`, built) — Publication/Proof systems; communication derivatives route to Floor 4.
- **Canonical publications and versions of record** (`publications`, built_guarded) — Publication / Submission Review and Policy / Publication / Impact Wall.
- **Approved publication distribution/syndication** (`publication-distribution`, built_disabled_until_configured) — Access-controlled distribution state on Floor 5; approval authority on Floor 6.
- **ORCID contributor identity** (`orcid`, built_disabled_until_configured) — Publication contributor identity; no separate room.
- **Crossref DOI deposit/verification** (`crossref`, built_disabled_until_configured) — Publication/version-of-record system; no separate room.
- **Government targets/dockets and recurring docket intelligence** (`government-dockets`, built_guarded) — Policy Lab and monitor/filing surfaces.
- **Government filing/submission workflow** (`government-submissions`, built_guarded) — Publication / Submission Review; final external authorization is a Floor 6 control function.
- **Research/source/government/stakeholder/citation monitors** (`monitoring`, built) — Policy / Publication / Impact Wall for findings; operations health on Floor 6.
- **Citation snapshots and impact events** (`citations-impact`, built) — Policy / Publication / Impact Wall and institutional proof.

### Secondary / cross-floor capabilities
- **Living policy initiative portfolio** (`initiative-portfolio`, built) — Penthouse Command portfolio direction; individual research/evidence work occurs on Floor 5.
- **Press release, executive summary and social-prep derivatives** (`communication-derivatives`, built) — Edit / Review Suite; lineage remains tied to Floor 5 source artifacts.
- **Immutable normalized Equity Uprise event ledger** (`event-ledger`, built) — Control / Audit Records support and cross-floor institutional memory.

### Boundary rule
The building metaphor must preserve the source product's public/private and approval boundaries. A capability being represented on this floor does **not** make private records, OAuth credentials, contact data, moderation state, outreach controls, financial/accounting details, government submission controls, music delivery controls, or other guarded operations publicly accessible.

Enterprise Development is represented as a program pathway, not as a pricing billboard; commercial terms remain external program data. Detailed Equity Uprise Mission Fund accounting remains quiet until its governance/custody/accounting/reporting state is publishable.

This section describes repo/program fidelity. It does not alter the shared Core V2 geometry and is **not for construction**.
