# PRIM3 LMS ingestion architecture

Status: implementation contract

## Boundary

PRIM3 and McCluster stay separate repositories with deliberately different responsibilities.

| Responsibility | Owner |
| --- | --- |
| Story canon, seasons, episodes, song identity | `mcclusterishere/Prim3` |
| Concept clusters and R/E/T lab mapping | `mcclusterishere/Prim3` |
| Machine-readable course publication metadata | `mcclusterishere/Prim3` |
| Public LMS shell and visual delivery | `mcclusterishere/mccluster` |
| M Account, learner state and progress | McCluster control plane |
| Course-feed validation/cache API | Worker `mccluster` |
| Learner persistence | Supabase `zmnhbrjyhxzhkxmhkexs` |

There is no separate PRIM3 production backend. The historical `mcclusterishere/prim3-backend` repository is retired and must not become a competing auth/database/API plane.

## Data flow

```text
mcclusterishere/Prim3 (main)
  CANON.md
  MAIN-STATUS.md
  game/LEARNING-MISSION-SOURCE-OF-TRUTH.md
  learning/MISSION-CONCEPT-LAB-MATRIX.md
       |
       | publishes CANON-DERIVED metadata
       v
  learning/course/course-feed.json
       |
       | raw, versioned JSON
       v
api.mccluster.org/v1/prim3/course
  Worker: workers/mccluster/src/prim3/index.js
  - validates schema + course identity
  - requires exactly 21 ordered module slots
  - normalizes module fields
  - caches source for five minutes
       |
       v
matthew.mccluster.org/prim3.html
  - groups 7 seasons / 21 modules
  - LEARN is required progression
  - REMEMBER / WATCH / LAB are aligned companions
       |
       +-- unsigned learner -> device-local continuity
       |
       `-- signed-in M Account -> /v1/prim3/progress -> Supabase
```

## Why pull ingestion instead of copying files

The LMS must not fork PRIM3 canon. McCluster asks PRIM3 for a compact publication feed and renders from that contract. Updating a song title, episode title, concept map or lab name on PRIM3 `main` therefore reaches McCluster after the Worker cache expires without copying the same authority into two repositories.

The feed contains metadata and source pointers, not every story file. Large narrative/game assets stay in PRIM3. McCluster only receives what course delivery needs.

## Course-feed contract

Current schema: `1.0.0`

Required invariants:

- `course.id = prim3-foundation`
- exactly 21 modules
- ordered IDs `M01` through `M21`
- season + episode ID/title
- song title, except the deliberately protected open Song #21 slot
- concept cluster
- learning objectives
- R/E/T lab names when the canonical matrix defines them
- repository-relative source pointers
- production/readiness status

A breaking contract change increments `schema_version` and requires McCluster ingestion support before it lands on PRIM3 `main`.

## Course content vs course delivery

A canonical module does not automatically become an assessable LMS lesson.

PRIM3 supplies **what the module means**. McCluster's LEARN layer supplies the conventional instruction and assessment. Until a LEARN lesson is authored and reviewed, the LMS may show canonical concepts/objectives/companions but must mark the required lesson as `BUILDING` and must not award credit.

This prevents the system from fabricating tests just because story metadata exists.

## Learner state

Table: `public.prim3_course_progress`

Primary key:

```text
(user_id, course_id, module_id)
```

Stored fields include reading completion, assessment score/attempts, passed timestamp, mastery metadata and last activity. RLS limits direct user access to rows whose `user_id = auth.uid()`; Worker operations use the McCluster service boundary after validating the M Account bearer token.

Anonymous use remains possible through local device state. Signing into M Account merges server progress into local state, preserving the stronger completion/score when both exist.

## API

Public course metadata:

```text
GET /v1/prim3
GET /v1/prim3/course
GET /v1/prim3/course/health
GET /v1/prim3/course/modules/M02
```

Authenticated learner progress:

```text
GET    /v1/prim3/progress
POST   /v1/prim3/progress/M02
DELETE /v1/prim3/progress
```

Progress POST accepts reading-completion state and/or an assessment score. The Worker verifies the requested module exists in the current canonical feed before persisting it.

## Failure behavior

- If Worker cache contains a valid feed, it serves the cached copy.
- On a cache miss it retrieves PRIM3 `main`, validates, then caches.
- An invalid or incomplete feed fails closed rather than silently reshaping the course.
- During feature-branch development, the static LMS may use the raw PRIM3 feed as a temporary read-only fallback before the Worker route is deployed.
- Learner progress sync failure never destroys device-local state; it reports local continuity and retries on future interaction/page load.

## Brand asset

The global PRIM3 tab uses `assets/img/prim3-tab.png`, a direct resample of the owner-approved PRIM3 helmet/wordmark artwork. Do not trace, redraw, recolor or replace it with a generic cyber glyph.

## Historical backend

`mcclusterishere/prim3-backend` contains an old standalone FastAPI/OpenAI experiment. It is not part of this architecture. New AI or backend behavior must route through McCluster's existing AI/control plane rather than reviving that service.
