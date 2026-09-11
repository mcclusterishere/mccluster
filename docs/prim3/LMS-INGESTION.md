# PRIM3 LMS ingestion architecture

Status: implementation contract

## Boundary

PRIM3 and McCluster stay separate repositories with deliberately different responsibilities.

| Responsibility | Owner |
| --- | --- |
| Story canon, seasons, episodes, song identity | `mcclusterishere/Prim3` |
| Source concept clusters and R/E/T lab mapping | `mcclusterishere/Prim3` |
| Machine-readable publication metadata for 21 episode/song units | `mcclusterishere/Prim3` |
| Instructional decomposition and enrichment | `mcclusterishere/mccluster` |
| Public LMS shell and visual delivery | `mcclusterishere/mccluster` |
| M Account, learner state and progress | McCluster control plane |
| Course-feed validation/cache + curriculum adapter API | Worker `mccluster` |
| Learner persistence | shared McCluster Supabase |

There is no separate PRIM3 production backend. The historical `mcclusterishere/prim3-backend` repository is retired and must not become a competing auth/database/API plane.

## Curriculum rule: 21 source units, 63 instructional modules

PRIM3 `main` publishes **21 canonical episode/song source units**. Those are not the final LMS module boundaries.

McCluster expands every source unit into exactly three beginner-sized instructional modules:

1. **SONG CORE A** — one focused source-derived concept cluster.
2. **SONG CORE B** — a second focused source-derived concept cluster.
3. **INFRASTRUCTURE + EXAM BRIDGE** — hardware, infrastructure, services, operational process and relevant CompTIA objective families that enrich the source without pretending the music taught material it did not contain.

That produces **63 instructional modules**. The decomposition is intentionally slower than the album. A learner should not have to understand unrelated terminology in the same sitting merely because it appears in one song.

Example: the `White Grey Black Hat` source unit becomes separate modules for **White/Grey/Black Hat**, **White/Grey/Black Box**, and **Pen-Test Infrastructure, Scope & Remediation**. Hat terminology is not recombined with box terminology in the beginner lesson.

The `Red Blue Purple White Team` source unit likewise starts with **Red & Blue Teams**, then **Purple & White Teams**, before the third module covers the broader security-engineering/exercise-operating model and source concepts such as the additional development-team colors.

## Data flow

```text
mcclusterishere/Prim3 (main)
  CANON.md
  MAIN-STATUS.md
  game/LEARNING-MISSION-SOURCE-OF-TRUTH.md
  learning/MISSION-CONCEPT-LAB-MATRIX.md
       |
       | publishes canon-derived source metadata
       v
  learning/course/course-feed.json
       |
       | schema 1.0.0 / 21 source units
       v
api.mccluster.org/v1/prim3/course
  Worker: workers/mccluster/src/prim3/index.js
  - validates PRIM3 source schema + identity
  - requires exactly 21 ordered source units
  - preserves source provenance
  - expands each source unit into three instructional modules
  - marks enrichment separately from PRIM3-source curriculum
  - returns LMS schema 2.0.0 / 63 modules
  - requires an authenticated M Account
       |
       v
matthew.mccluster.org/prim3.html
  - 7 seasons / 21 episode-song units / 63 modules
  - LEARN is required progression
  - REMEMBER / WATCH / LAB are aligned companions
  - course price = $0 after account creation
       |
       v
M Account -> /v1/prim3/progress -> shared McCluster Supabase
```

## Why adapt instead of copying files

The LMS must not fork PRIM3 canon. McCluster asks PRIM3 for a compact publication feed and transforms that source contract into a teaching structure. Updating a song title, episode title, concept map or lab name on PRIM3 `main` therefore reaches McCluster after the Worker cache expires without copying the same authority into two repositories.

The source feed contains metadata and repository pointers, not every story file. Large narrative/game assets stay in PRIM3. McCluster receives only what course construction needs.

## Source-feed contract

PRIM3 source schema: `1.0.0`

Required invariants:

- `course.id = prim3-foundation`
- exactly 21 source units
- ordered source IDs `M01` through `M21` in the PRIM3 publication contract
- season + episode ID/title
- song title, except the deliberately protected open Song #21 slot
- source concept clusters
- source learning objectives
- R/E/T lab names when the canonical matrix defines them
- repository-relative source pointers
- production/readiness status

A breaking source-contract change increments `schema_version` and requires McCluster ingestion support before it lands on PRIM3 `main`.

## LMS course contract

McCluster publishes LMS schema `2.0.0`:

- `course.id = prim3-foundation-v2`
- `source_course_id = prim3-foundation`
- `source_unit_count = 21`
- `module_count = 63`
- `module_strategy = 3 instructional modules per episode/song unit`
- `account_required = true`
- `price_cents = 0`

Every instructional module contains `unit_id`, `part`, `part_label`, song/episode identity, source pointers and `curriculum_origin`.

`curriculum_origin = prim3-source` means the module is teaching concepts explicitly present in the canonical source unit. `curriculum_origin = mccluster-enrichment` means McCluster is adding supporting infrastructure/exam material. Enrichment must never be represented as song-derived content.

## Course content vs course delivery

A generated instructional slot does not automatically become an assessable LMS lesson.

PRIM3 supplies source meaning. McCluster's LEARN layer supplies conventional reading, vocabulary, examples and assessment. Until a focused LEARN lesson is authored and reviewed, the LMS may display its mapped concepts/objectives/companions but must mark the lesson `BUILDING` and must not award credit.

The curriculum can therefore expose all 63 intended slots immediately without rushing 63 shallow lessons into production.

## Account gate and learner state

The course is **free**, but an M Account is required to start. There is no anonymous course mode.

The account requirement exists so progress, assessment scores and unlock state belong to the learner rather than to one browser. The API enforces the gate as well as the UI; a direct unauthenticated request cannot bypass it.

Table: `public.prim3_course_progress`

Primary key:

```text
(user_id, course_id, module_id)
```

The v2 LMS uses `course_id = prim3-foundation-v2`, preventing the prior 21-module prototype's progress semantics from colliding with the 63-module structure.

Stored fields include reading completion, assessment score/attempts, passed timestamp, mastery metadata and last activity. The Worker validates the M Account bearer token before service-side persistence. Best scores are preserved when a later sync only updates reading state or carries a lower attempt.

The browser may keep a local mirror for responsive rendering and offline-safe continuity, but it is not an anonymous enrollment mechanism. Without an authenticated M Account, the LMS coursework remains gated.

## API

Authenticated course delivery:

```text
GET /v1/prim3
GET /v1/prim3/course
GET /v1/prim3/course/health
GET /v1/prim3/course/modules/M05
GET /v1/prim3/course/units/U02
```

Authenticated learner progress:

```text
GET    /v1/prim3/progress
POST   /v1/prim3/progress/M05
DELETE /v1/prim3/progress
```

The `units/Uxx` surface exposes the original 21 source units. The `modules/Mxx` surface exposes one of the 63 instructional modules.

## CompTIA enrichment rule

The third module in each unit may reference relevant current CompTIA objective families such as A+, Network+ and Security+. These mappings are curriculum guidance, not a claim that listening to PRIM3 alone constitutes complete exam preparation.

The bridge should teach the physical/logical machinery behind the mnemonic: hardware, cabling, boot/storage, virtualization, cloud, identity, networking, recovery, monitoring, troubleshooting and operational controls where relevant.

## Failure behavior

- If the Worker cache contains a valid PRIM3 source feed, it can use that cached source.
- On a cache miss it retrieves PRIM3 `main`, validates it, then expands the source units.
- An invalid or incomplete PRIM3 source feed fails closed rather than silently reshaping the course.
- Unauthenticated course/API access fails closed with an M Account requirement.
- A learner-progress sync failure never converts the course into an anonymous course; the browser can retain its local mirror and retry after authenticated connectivity returns.

## Brand asset

The global PRIM3 tab uses `assets/img/prim3-tab.png`, a direct resample of the owner-approved PRIM3 helmet/wordmark artwork. Do not trace, redraw, recolor or replace it with a generic cyber glyph.

## Historical backend

`mcclusterishere/prim3-backend` contains an old standalone FastAPI/OpenAI experiment. It is not part of this architecture. New AI or backend behavior must route through McCluster's existing AI/control plane rather than reviving that service.
