# Equity Uprise — Core V2 File-by-File Migration Manifest

> Branch: `architecture/equity-uprise-core-v2`
>
> Purpose: enumerate every building artifact that must be changed, regenerated, rebuilt, audited, or intentionally left untouched when migrating from the current floor-local core to the vertically connected Core V2.
>
> **Not for construction.** Core/stair/elevator/life-safety geometry remains schematic pending licensed professional design and jurisdiction-specific review.

## Current migration progress — 2026-09-21

### Completed on migration branch
- [x] shared Core V2 written spec
- [x] shared machine-readable `building-core-v2.json`
- [x] cross-floor validation contract
- [x] building inventory Core V2 update
- [x] branch-scoped reference authority update
- [x] Floor 1–6 + Level 7 schematic-plan bases rewritten
- [x] Floor 1–6 + Level 7 long-form specs rewritten
- [x] all seven versioned Core V2 DXF/SVG/PNG plan sets generated
- [x] all seven reference READMEs point to Core V2 and label Core V1 files legacy
- [x] Floor 1–7 deterministic production packages generated from shared core
- [x] combined stacked GLB generated
- [x] combined GLB independently verified: **27/27 checks passed**
- [x] both stairs verified across all six 13'-6" level transitions
- [x] continuous passenger and freight/service shaft geometry generated
- [x] combined self-contained browser viewer built
- [x] Floor 1–7 viewer entry files converted to derived shared-building views
- [x] agent instruction files updated with Core V2 authority
- [x] old Floor 1 Core V1 Python builder/verifier retired on migration branch
- [x] old Floor 1-only workflow restricted to Core V1/main compatibility
- [x] Level 7 routing/preprogram documents coordinated with Core V2 physical arrival

### Combined-model validation evidence
- GLB: `production/generated/equity-uprise-building-core-v2.glb`
- report: `production/generated/equity-uprise-building-core-v2-report.json`
- GLB size: **389,456 bytes**
- mesh count: **667**
- SHA-256: `1febf1593fcdac4a5848235b199e9981bbccbf137edf00e4455381852c3a5db7`
- deterministic checks: **27 passed / 0 failed**

### Remaining before promotion to main
- [x] audit public Equity Uprise pages for old 3D/viewer links — no old viewer links found
- [x] audit active text files for stale Core V1 geometry outside intentionally retained legacy/history files — clean; historical replacement language retained intentionally
- [ ] visually review the combined Core V2 browser scene with owner
- [ ] visually review the seven Core V2 plan images with owner
- [ ] resolve any owner-requested layout changes
- [ ] final branch-wide migration validation
- [ ] owner approval to promote Core V2
- [ ] merge/promote to main
- [ ] allow normal Pages deployment to replace legacy Floor 1/Floor 2 live entry points

## Migration status vocabulary

- **NEW** — does not exist on main; create as a Core V2 authority/derived artifact.
- **REWRITE** — existing semantic/source-of-truth file must change materially.
- **MODIFY** — existing file needs bounded edits/cross-reference changes.
- **REGENERATE** — derived geometry/image file must be produced again from Core V2.
- **REBUILD** — executable/rendered artifact must be rebuilt from the new authority.
- **AUDIT** — inspect for stale references; change only if it actually references old geometry.
- **UNCHANGED** — intentionally remains as-is.

---

# A. Building-wide source of truth

## NEW

1. `docs/design/equity-uprise-building/production/building-core-v2.json`
   - single machine-readable shared core;
   - shell, floor elevations, passenger elevator, service/freight lift, Stair A, revised Stair B, MEP, slab openings, common IDs.

2. `docs/design/equity-uprise-building/BUILDING-CORE-V2-SPEC.md`
   - final written building-core authority after owner approval;
   - replaces proposal status with locked Core V2 language.

3. `docs/design/equity-uprise-building/CORE-V2-FILE-MIGRATION-MANIFEST.md`
   - this migration checklist.

4. `docs/design/equity-uprise-building/production/building-v2-validation.json`
   - cross-floor validation rules: stack, elevations, shaft continuity, stair continuity, slab openings.

## REWRITE / MODIFY

5. `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` — **REWRITE**
   - replace old Stair B coordinates;
   - register west service core and freight/service elevator;
   - register shared Core V2 JSON before floor production packages;
   - change geometry authority ordering to include shared core;
   - remove stale language that implies current floor-local stairs prove continuity.

6. `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md` — **REWRITE**
   - building-wide vertical circulation narrative;
   - west service core;
   - true stacked elevations;
   - Floor 6/Level 7 service-lift and stair continuity;
   - migration implications for support zones.

7. `docs/design/EQUITY-UPRISE-REPO-AUDIT.md` — **AUDIT**
   - change only sections that explicitly encode physical building/core geometry;
   - platform/product-function findings remain untouched.

8. `docs/design/equity-uprise-building/BUILDING-CORE-V2-PROPOSAL.md` — **MODIFY / ARCHIVE STATUS**
   - branch-only proposal becomes historical rationale after the final Core V2 spec is locked;
   - do not leave it competing with final authority.

---

# B. Floor 1 — Lobby + Intake

## Written authority

9. `docs/design/equity-uprise-building/FLOOR-01-LOBBY-INTAKE-360-SPEC.md` — **REWRITE**
   - west support/core layout;
   - service/freight elevator access;
   - revised Stair B;
   - real 13'6" stair continuity and slab opening;
   - circulation/support impacts.

10. `docs/design/equity-uprise-building/FLOOR-01-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**
    - exact Core V2 coordinates;
    - revised room/support boundaries;
    - shaft/slab opening geometry;
    - freight/service lobby relationship;
    - real vertical datum.

## Canonical plan references

11. `docs/design/equity-uprise-building/references/floor-01/README.md` — **REWRITE**
12. `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.dxf` — **REGENERATE**
13. `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.svg` — **REGENERATE**
14. `docs/design/equity-uprise-building/references/floor-01/equity-uprise-floor-01-viable-schematic-v3.png` — **REGENERATE**

Preferred Core V2 practice: version the regenerated assets rather than silently pretending v3 contains the old geometry, e.g. `...core-v2.dxf/svg/png`, then update references.

## Production package

15. `docs/design/equity-uprise-building/production/floor-01/README.md` — **REWRITE**
16. `docs/design/equity-uprise-building/production/floor-01/floor-01-scene-manifest.json` — **REWRITE**
17. `docs/design/equity-uprise-building/production/floor-01/floor-01-geometry-notes.md` — **REWRITE**
18. `docs/design/equity-uprise-building/production/floor-01/floor-01-camera.json` — **AUDIT**
19. `docs/design/equity-uprise-building/production/floor-01/floor-01-hotspots.json` — **MODIFY**
20. `docs/design/equity-uprise-building/production/floor-01/floor-01-routing.json` — **MODIFY**
21. `docs/design/equity-uprise-building/production/floor-01/floor-01-states.json` — **AUDIT**
22. `docs/design/equity-uprise-building/production/floor-01/floor-01-lighting.json` — **AUDIT**
23. `docs/design/equity-uprise-building/production/floor-01/floor-01-materials.json` — **UNCHANGED unless new freight-core finish is required**
24. `docs/design/equity-uprise-building/production/floor-01/build_equity_uprise_floor_01.py` — **REBUILD**
25. `docs/design/equity-uprise-building/production/floor-01/verify_floor_01_scene.py` — **REWRITE**
26. `docs/design/equity-uprise-building/production/floor-01/generated/README.md` — **REWRITE**
27. `docs/design/equity-uprise-building/production/floor-01/generated/equity-uprise-floor-01-deterministic-v1-report.json` — **REGENERATE**
28. generated Floor 1 GLB artifact — **REGENERATE**
    - current chat/generated GLB is obsolete after Core V2.

## Browser scene

29. `equity-uprise-floor-01-3d.html` — **REBUILD**
   - use actual Floor 1 elevation;
   - actual opening into Stair A/Stair B;
   - west service lift;
   - no 10'6" fake stair;
   - derived from common Core V2.

---

# C. Floor 2 — Public Forum

## Written authority

30. `docs/design/equity-uprise-building/FLOOR-02-PUBLIC-FORUM-360-SPEC.md` — **REWRITE**
31. `docs/design/equity-uprise-building/FLOOR-02-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**

Changes:
- West Service Core;
- revised support rooms;
- freight/service lift;
- revised Stair B;
- true Floor 1↔2 stair connection;
- Floor 2 finished-floor elevation +13'6";
- coordinated slab openings.

## Canonical plan references

32. `docs/design/equity-uprise-building/references/floor-02/README.md` — **REWRITE**
33. `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.dxf` — **REGENERATE**
34. `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.svg` — **REGENERATE**
35. `docs/design/equity-uprise-building/references/floor-02/equity-uprise-floor-02-public-forum-schematic-v1.png` — **REGENERATE**

## Production package

36. `docs/design/equity-uprise-building/production/floor-02/README.md` — **REWRITE**
37. `docs/design/equity-uprise-building/production/floor-02/floor-02-scene-manifest.json` — **REWRITE**
38. `docs/design/equity-uprise-building/production/floor-02/floor-02-geometry-notes.md` — **REWRITE**
39. `docs/design/equity-uprise-building/production/floor-02/floor-02-camera.json` — **AUDIT**
40. `docs/design/equity-uprise-building/production/floor-02/floor-02-hotspots.json` — **MODIFY**
41. `docs/design/equity-uprise-building/production/floor-02/floor-02-routing.json` — **MODIFY**
42. `docs/design/equity-uprise-building/production/floor-02/floor-02-states.json` — **AUDIT**
43. `docs/design/equity-uprise-building/production/floor-02/floor-02-lighting.json` — **AUDIT**
44. `docs/design/equity-uprise-building/production/floor-02/floor-02-materials.json` — **UNCHANGED unless service-core finish changes**

## NEW Floor 2 deterministic build/verification

45. `docs/design/equity-uprise-building/production/floor-02/build_equity_uprise_floor_02.py` — **NEW**
46. `docs/design/equity-uprise-building/production/floor-02/verify_floor_02_scene.py` — **NEW**
47. `docs/design/equity-uprise-building/production/floor-02/generated/README.md` — **NEW**
48. `docs/design/equity-uprise-building/production/floor-02/generated/equity-uprise-floor-02-core-v2-report.json` — **NEW/GENERATE**
49. Floor 2 Core V2 GLB — **NEW/GENERATE**

## Browser scene

50. `equity-uprise-floor-02-3d.html` — **REBUILD**
   - actual +13'6" world elevation;
   - real stair arrival from Floor 1;
   - freight/service lift;
   - shared building coordinates.

---

# D. Floor 3 — Fellowship + Network

## Written authority

51. `docs/design/equity-uprise-building/FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md` — **REWRITE**
52. `docs/design/equity-uprise-building/FLOOR-03-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**

## Canonical references

53. `docs/design/equity-uprise-building/references/floor-03/README.md` — **REWRITE**
54. `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.dxf` — **REGENERATE**
55. `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.svg` — **REGENERATE**
56. `docs/design/equity-uprise-building/references/floor-03/equity-uprise-floor-03-fellowship-network-schematic-v1.png` — **REGENERATE**

## Production / 3D

57. `docs/design/equity-uprise-building/production/floor-03/` — **NEW COMPLETE PACKAGE**
58. `equity-uprise-floor-03-3d.html` — **NEW**
   - finished-floor elevation +27'0".

---

# E. Floor 4 — Media + Culture

59. `docs/design/equity-uprise-building/FLOOR-04-MEDIA-CULTURE-360-SPEC.md` — **REWRITE**
60. `docs/design/equity-uprise-building/FLOOR-04-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**
61. `docs/design/equity-uprise-building/references/floor-04/README.md` — **REWRITE**
62. `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.dxf` — **REGENERATE**
63. `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.svg` — **REGENERATE**
64. `docs/design/equity-uprise-building/references/floor-04/equity-uprise-floor-04-media-culture-schematic-v1.png` — **REGENERATE**
65. `docs/design/equity-uprise-building/production/floor-04/` — **NEW COMPLETE PACKAGE**
66. `equity-uprise-floor-04-3d.html` — **NEW**
   - finished-floor elevation +40'6".

---

# F. Floor 5 — Policy + Proof

67. `docs/design/equity-uprise-building/FLOOR-05-POLICY-PROOF-360-SPEC.md` — **REWRITE**
68. `docs/design/equity-uprise-building/FLOOR-05-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**
69. `docs/design/equity-uprise-building/references/floor-05/README.md` — **REWRITE**
70. `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.dxf` — **REGENERATE**
71. `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.svg` — **REGENERATE**
72. `docs/design/equity-uprise-building/references/floor-05/equity-uprise-floor-05-policy-proof-schematic-v1.png` — **REGENERATE**
73. `docs/design/equity-uprise-building/production/floor-05/` — **NEW COMPLETE PACKAGE**
74. `equity-uprise-floor-05-3d.html` — **NEW**
   - finished-floor elevation +54'0".

---

# G. Floor 6 — Penthouse Command

75. `docs/design/equity-uprise-building/FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md` — **REWRITE**
76. `docs/design/equity-uprise-building/FLOOR-06-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**
77. `docs/design/equity-uprise-building/references/floor-06/README.md` — **REWRITE**
78. `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.dxf` — **REGENERATE**
79. `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.svg` — **REGENERATE**
80. `docs/design/equity-uprise-building/references/floor-06/equity-uprise-floor-06-penthouse-command-schematic-v1.png` — **REGENERATE**
81. `docs/design/equity-uprise-building/production/floor-06/` — **NEW COMPLETE PACKAGE**
82. `equity-uprise-floor-06-3d.html` — **NEW**
   - finished-floor elevation +67'6";
   - explicit continuity into Level 7.

---

# H. Level 7 — Roof / Mobility Portal

## Written authority

83. `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md` — **REWRITE**
84. `docs/design/equity-uprise-building/FLOOR-07-SCHEMATIC-PLAN-BASIS.md` — **REWRITE**
85. `docs/design/equity-uprise-building/FLOOR-07-ECOSYSTEM-ROUTING-CONTRACT.md` — **AUDIT / MODIFY**
   - update only physical arrival/core/service references;
   - destination-routing semantics remain intact.
86. `docs/design/equity-uprise-building/FLOOR-07-ROOF-MOBILITY-PORTAL-PREPROGRAM.md` — **AUDIT / historical context**
   - preserve as origin/context; annotate if coordinates are superseded.

## Canonical references

87. `docs/design/equity-uprise-building/references/floor-07/README.md` — **REWRITE**
88. `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.dxf` — **REGENERATE**
89. `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.svg` — **REGENERATE**
90. `docs/design/equity-uprise-building/references/floor-07/equity-uprise-level-07-roof-mobility-portal-schematic-v1.png` — **REGENERATE**

## Production / 3D

91. `docs/design/equity-uprise-building/production/floor-07/` — **NEW COMPLETE PACKAGE**
92. `equity-uprise-floor-07-3d.html` — **NEW**
   - roof walking datum +81'0";
   - actual stair/core/service arrival.

---

# I. Combined building geometry / navigation

## NEW

93. `docs/design/equity-uprise-building/production/build_equity_uprise_building_v2.py`
   - shared deterministic full-building generator.

94. `docs/design/equity-uprise-building/production/verify_equity_uprise_building_v2.py`
   - validates vertical stacking, shaft continuity, slab openings and floor elevations.

95. `docs/design/equity-uprise-building/production/generated/equity-uprise-building-core-v2.glb`
   - combined stacked building model.

96. `docs/design/equity-uprise-building/production/generated/equity-uprise-building-core-v2-report.json`
   - reproducibility/geometry report.

97. `equity-uprise-building-3d.html`
   - combined navigable building;
   - floor isolation;
   - cutaway;
   - vertical circulation;
   - selectable floors;
   - freight/service core visibility.

This combined scene becomes the strongest proof that floors are vertically connected.

---

# J. CI / validation workflows

98. `.github/workflows/equity-uprise-floor-01-3d.yml` — **REPLACE / GENERALIZE**
   - stop validating only Floor 1;
   - use shared Core V2;
   - verify full building plus per-floor outputs.

99. `.github/workflows/equity-uprise-building-v2.yml` — **NEW**
   - deterministic build;
   - geometry validation;
   - artifact upload;
   - fail on stale old-core references where appropriate.

---

# K. Agent / coding instructions

These currently tell agents to use Floor 1 production material and building authority. They must explicitly require Core V2 after approval.

100. `AGENTS.md` — **MODIFY**
101. `CLAUDE.md` — **MODIFY**
102. `CODEX.md` — **MODIFY**
103. `GEMINI.md` — **MODIFY**
104. `.cursorrules` — **MODIFY**
105. `.github/copilot-instructions.md` — **MODIFY**

Required new rule:
- shared Core V2 authority is read before any floor-specific production file;
- floor viewers may not independently redefine stairs/elevators/elevations;
- generated imagery never overrides the stacked model.

---

# L. Public Equity Uprise site files — audit only

These are not automatically architecture-source files and should not be rewritten merely because the physical core changes.

106. `equity-uprise.html` — **AUDIT**
   - update only if it links/embeds old 3D viewer URLs or describes old physical circulation.

107. `equity-uprise-fellowship.html` — **AUDIT**
108. `docs/equity-uprise-platform.md` — **AUDIT**
109. `js/equity-uprise-institutional.js` — **AUDIT**
110. `js/equity-uprise-fellowship-live.js` — **AUDIT**
111. `css/equity-uprise-app.css` — **UNCHANGED unless new viewer UI uses it**
112. `css/equity-uprise-institutional.css` — **UNCHANGED unless new viewer UI uses it**
113. `redirects/equity-uprise.html` — **AUDIT**

---

# M. Brand asset

114. `assets/img/equity-uprise-logo.webp` — **UNCHANGED**
   - exact artwork remains authoritative;
   - do not redraw/crop/replace during Core V2 migration.

---

# N. GitHub Pages deployment

115. `.github/workflows/deploy-pages.yml` — **AUDIT**
   - verify all new combined/per-floor viewer files survive the publishing-strip step;
   - no architectural changes required unless deployment excludes new assets.

116. `CNAME` — **UNCHANGED**

---

# O. Old-core retirement rules

After Core V2 is approved and validated:

- old DXF/SVG/PNG plan geometry must not remain labeled canonical;
- old Floor 1 GLB/report must not remain labeled current;
- current Floor 1/Floor 2 browser scenes must be replaced or explicitly marked legacy;
- old Stair B coordinate language must be removed from all active authority files;
- no active file may claim the nine-tread/10'6" placeholder is a real floor-to-floor stair;
- old files may be retained under a clearly named `legacy/core-v1/` archive if historical traceability is desired.

Do **not** delete old authority until the replacement files are generated and cross-validated.

---

# P. Migration execution order

1. Lock final Core V2 geometry.
2. Create `building-core-v2.json`.
3. Create final `BUILDING-CORE-V2-SPEC.md`.
4. Update building-wide authority/inventory.
5. Rewrite all seven floor/level specs and plan bases.
6. Regenerate all seven DXF/SVG/PNG plan sets.
7. Rewrite/create all floor production packages.
8. Build combined stacked GLB.
9. Validate cross-floor continuity.
10. Rebuild per-floor viewers as views of the shared model.
11. Build combined navigable viewer.
12. Update agent instructions.
13. Audit public site links/deployment.
14. Only then promote Core V2 to main/canonical status.

## Main-branch safety

All Core V2 migration work should remain on:
`architecture/equity-uprise-core-v2`

until:
- the shared core passes deterministic validation;
- all floor plans are regenerated;
- no stale active authority remains;
- the combined viewer proves vertical continuity;
- owner approves promotion.

