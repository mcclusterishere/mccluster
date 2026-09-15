# PRIM3 LMS ingestion architecture

Status: implementation contract

## Boundary

PRIM3 and McCluster stay separate repositories with deliberately different responsibilities.

| Responsibility | Owner |
| --- | --- |
| Story canon, seasons, episodes and song identity | `mcclusterishere/Prim3` |
| Source concept clusters and R E T lab mapping | `mcclusterishere/Prim3` |
| Machine readable publication metadata for 21 episode and song units | `mcclusterishere/Prim3` |
| Three certification foundation modules | `mcclusterishere/mccluster` |
| Instructional decomposition and certification enrichment | `mcclusterishere/mccluster` |
| Public LMS shell and visual delivery | `mcclusterishere/mccluster` |
| M Account, learner state and progress | McCluster control plane |
| Course feed validation, cache and curriculum adapter API | Worker `mccluster` |
| Learner persistence | shared McCluster Supabase |

There is no separate PRIM3 production backend. The historical `mcclusterishere/prim3-backend` repository is retired and must not become a competing authentication, database or API plane.

## Canonical curriculum rule: 66 modules

The course contains exactly **66 instructional modules**.

The total is built from two layers:

1. **3 certification foundation modules** owned by McCluster. These modules are not attached to any song or episode.
2. **63 PRIM3 aligned modules** created by expanding the 21 canonical PRIM3 episode and song source units into exactly three instructional modules each.

The arithmetic is fixed:

```text
3 certification foundation modules
+ 21 PRIM3 source units × 3 instructional modules each
= 66 total instructional modules
```

The whole course count is **66**, not 63. The number 63 describes only the song aligned subtotal.

Do not create a 67th module. If a topic is dense, improve the reading, examples, assessment and practice inside its assigned module. The opening foundation block and the infrastructure bridge inside each PRIM3 unit exist specifically to prevent certification material from being crammed into song concepts that do not naturally teach it.

## Module numbering

Module identifiers are sequential across the complete LMS:

```text
M01 to M03   certification foundation, no song, no episode
M04 to M06   PRIM3 U01
M07 to M09   PRIM3 U02
...
M64 to M66   PRIM3 U21
```

The first three modules must have no PRIM3 `unit_id`, no song identity and no episode identity. Their curriculum origin is `mccluster-certification-foundation`.

PRIM3 source units remain U01 through U21 and remain unchanged as source identities.

## Certification foundation

The opening foundation block creates room for essential Security Plus and Network Plus concepts that the album does not explicitly teach.

Current foundation modules:

1. **M01 Security Foundations and Risk**
2. **M02 Networking Foundations**
3. **M03 Identity, Cryptography and Access**

These modules are not treated as complete certification coverage by themselves. They establish vocabulary and mental models that later modules deepen and demonstrate.

## PRIM3 source unit decomposition

PRIM3 `main` publishes 21 canonical episode and song source units. Those are source authorities, not final LMS module boundaries.

McCluster expands every PRIM3 source unit into exactly three instructional modules:

1. **SONG CORE A**: one focused source derived concept cluster.
2. **SONG CORE B**: a second focused source derived concept cluster.
3. **INFRASTRUCTURE AND EXAM BRIDGE**: infrastructure, services, operations and certification material that enriches the source without pretending the music taught material it did not contain.

This produces the 63 song aligned modules that follow the three opening foundations.

Example: `White Grey Black Hat` receives separate modules for **White Grey Black Hat**, **White Grey Black Box**, and **Penetration Testing Infrastructure, Scope and Remediation**. Hat terminology is not recombined with box terminology in the beginner lesson.

`Red Blue Purple White Team` likewise begins with separate **Red and Blue Teams** and **Purple and White Teams** instruction before its broader security engineering and exercise operations bridge.

## Data flow

```text
mcclusterishere/Prim3 main
  CANON.md
  MAIN-STATUS.md
  game/LEARNING-MISSION-SOURCE-OF-TRUTH.md
  learning/MISSION-CONCEPT-LAB-MATRIX.md
       |
       | publishes canon derived source metadata
       v
  learning/course/course-feed.json
       |
       | source schema 1.0.0, 21 source units
       v
api.mccluster.org/v1/prim3/course
  Worker: workers/mccluster/src/prim3/index.js
  validates exactly 21 ordered PRIM3 source units
  prepends 3 McCluster certification foundation modules
  expands each PRIM3 source unit into exactly 3 modules
  preserves source provenance
  marks McCluster enrichment separately
  returns LMS schema 3.0.0, exactly 66 modules
  requires an authenticated M Account
       |
       v
matthew.mccluster.org/prim3.html
  3 certification foundations
  7 PRIM3 seasons
  21 PRIM3 source units
  63 PRIM3 aligned modules
  66 modules total
  LEARN required for progression
  REMEMBER, WATCH and LAB available on PRIM3 aligned modules
  course price zero after account creation
       |
       v
M Account -> /v1/prim3/progress -> shared McCluster Supabase
```

## Why adapt instead of copying files

The LMS must not fork PRIM3 canon. McCluster asks PRIM3 for a compact publication feed and transforms that source contract into a teaching structure. Updating a song title, episode title, concept map or lab name on PRIM3 `main` can therefore reach McCluster after the Worker cache expires without maintaining duplicate canon.

The three opening certification foundations are intentionally different. They are McCluster curriculum and do not claim PRIM3 song or story provenance.

Large narrative and game assets stay in PRIM3. McCluster receives only the metadata required for course construction.

## PRIM3 source feed contract

PRIM3 source schema: `1.0.0`

Required invariants:

* `course.id = prim3-foundation`
* exactly 21 source units
* ordered source entries representing the 21 canonical PRIM3 units
* season and episode identity
* song identity when published
* source concept clusters
* source learning objectives
* R E T lab names when the canonical matrix defines them
* repository relative source pointers
* production readiness status

A breaking source contract change increments the PRIM3 source `schema_version` and requires McCluster ingestion support before it lands on PRIM3 `main`.

The PRIM3 source feed does **not** publish the three certification foundations. McCluster owns those modules.

## LMS course contract

McCluster publishes LMS schema `3.0.0`:

```text
course.id = prim3-foundation-v3
source_course_id = prim3-foundation
source_unit_count = 21
foundation_module_count = 3
song_aligned_module_count = 63
module_count = 66
account_required = true
price_cents = 0
```

Canonical module strategy:

```text
3 certification foundation modules plus 3 instructional modules per episode and song unit
```

`module_count = 66` is an invariant, not a target or minimum.

Foundation modules contain:

* `foundation = true`
* no PRIM3 unit identity
* no episode identity
* no song identity
* `curriculum_origin = mccluster-certification-foundation`
* explicit Security Plus and Network Plus alignment

Song aligned modules contain PRIM3 unit identity, source pointers, part identity and curriculum provenance.

`curriculum_origin = prim3-source` means the module teaches concepts explicitly present in canonical PRIM3 source material.

`curriculum_origin = mccluster-enrichment` means McCluster adds supporting material.

`curriculum_origin = prim3-source+mccluster-enrichment` means a bridge contains both remaining source concepts and added curriculum.

Enrichment must never be represented as material taught by the song when it is not present in the song.

## Mandatory certification coverage

The mandatory certification targets are:

* CompTIA Security Plus SY0 701
* CompTIA Network Plus N10 009

The course is intended to cover every numbered objective and every official bullet and nested bullet beneath those objectives across the fixed 66 module structure.

A certification objective is not complete merely because an objective number appears in metadata. Completion requires the material to be:

1. assigned to one or more modules
2. taught in conventional lesson content
3. checked through assessment, practice or both
4. traceable in the curriculum coverage contract

The songs are memory reinforcement. They are never allowed to substitute for missing certification instruction.

A Plus may be used as optional enrichment when basic hardware or operating system context improves a lesson, but A Plus coverage is not a completion gate for this course version.

The machine readable certification inventory and coverage rules live at:

```text
docs/prim3/COMPTIA-COVERAGE.json
```

## Course content versus course delivery

A reserved instructional slot does not automatically become an assessable LMS lesson.

PRIM3 supplies source meaning for song aligned units. McCluster supplies conventional reading, vocabulary, examples and assessments. The first three foundations are also authored entirely by McCluster.

Until a focused lesson is authored and reviewed, the LMS may display its mapped concepts and source companions but must mark the lesson `BUILDING` and must not award credit.

The curriculum can expose all 66 intended slots without publishing shallow placeholder lessons.

## User facing punctuation rule

Authored lesson copy must not contain em dash characters, en dash characters, dash characters or hyphen characters.

The LMS sanitizes dynamic source metadata before displaying it inside lesson surfaces, and authored lesson data is validated in code so prohibited punctuation cannot quietly enter published coursework.

Internal implementation identifiers, source paths and certification codes may retain punctuation when required for correctness. The prohibition applies to learner facing prose and lesson copy.

## Account gate and learner state

The course is free, but an M Account is required to start. There is no anonymous course mode.

The account requirement exists so progress, assessment scores and unlock state belong to the learner rather than one browser. The API independently enforces the gate.

Table: `public.prim3_course_progress`

Primary key:

```text
(user_id, course_id, module_id)
```

The 66 module LMS uses:

```text
course_id = prim3-foundation-v3
```

This prevents the previous 63 module numbering from being misinterpreted after every PRIM3 aligned module moved three positions later.

The browser local mirror likewise uses a new storage namespace. Old local progress is not silently applied to the new module meanings.

Stored fields include reading completion, assessment score, assessment attempts, passed timestamp, mastery metadata and last activity. The Worker validates the M Account bearer token before persistence. Best scores are preserved when later syncs contain a lower attempt.

## API

Authenticated course delivery:

```text
GET /v1/prim3
GET /v1/prim3/course
GET /v1/prim3/course/health
GET /v1/prim3/course/modules/M01
GET /v1/prim3/course/modules/M66
GET /v1/prim3/course/units/U01
GET /v1/prim3/course/units/U21
```

Authenticated learner progress:

```text
GET    /v1/prim3/progress
POST   /v1/prim3/progress/M01
POST   /v1/prim3/progress/M66
DELETE /v1/prim3/progress
```

The `units/Uxx` surface exposes the 21 PRIM3 source units only.

The `modules/Mxx` surface exposes all 66 instructional modules, including the three songless foundations.

## Failure behavior

* A valid cached PRIM3 source feed may be used while fresh source is unavailable.
* On cache miss the Worker retrieves PRIM3 `main`, validates it and then constructs the complete 66 module LMS.
* An invalid or incomplete PRIM3 source feed fails closed rather than silently reshaping the course.
* Unauthenticated course and API access fails closed with an M Account requirement.
* A learner progress sync failure never converts the course into anonymous enrollment.

## Brand asset

The global PRIM3 tab uses `assets/img/prim3-tab.png`, a direct resample of the owner approved PRIM3 helmet and wordmark artwork. Do not trace, redraw, recolor or replace it with a generic cyber glyph.

## Historical backend

`mcclusterishere/prim3-backend` contains an old standalone FastAPI and OpenAI experiment. It is not part of this architecture. New AI or backend behavior must route through the existing McCluster control plane rather than reviving that service.
