# Equity Uprise Lifetime Development — Canonical Design Package

> Status: DEVELOPMENT-PROGRAM AUTHORITY / PRE-BUILDING-REWRITE
>
> Branch: architecture/equity-uprise-core-v2
>
> This package defines the human-development system that the future Equity Uprise building interface must support. It does not override building-core geometry, floor plans, stairs, elevators, MEP reservations, or any other physical design authority.

## Purpose

Equity Uprise is being designed as a free lifetime development environment, not a temporary course catalog. A participant receives a persistent Development Passport that tracks goals, learning, verified competencies, projects, credentials, evidence, relationships, opportunities, cohort readiness, and longitudinal progress.

The participant experience should remain simple even when the system behind it is comprehensive.

Primary interaction rule:

NEXT → WHY → DO → PROVE → UNLOCKS

A participant should usually see one recommended next action, with optional alternatives and deeper exploration available on demand.

## Canonical files in this package

1. DEVELOPMENT-JOURNEY.md
   - Seven-stage human-development journey.
   - Free lifetime-program model.
   - Development Passport behavior.
   - Project and cohort progression.

2. COMPETENCY-ARCHITECTURE.md
   - Competency philosophy.
   - Seven-state maturity ladder.
   - Universal, shared, and pathway structure.
   - 42-competency catalog summary.

3. competency-catalog.json
   - Machine-readable 42-competency authority.

4. stage-competency-map.json
   - Machine-readable primary-home mapping for the seven developmental stages.
   - Competencies may continue developing beyond their home stage.

5. EVIDENCE-ASSESSMENT-ARCHITECTURE.md
   - Evidence classes, authenticity, context, independence, reviewer authority, integrity, reassessment, and credential separation.

6. ASSESSMENT-RUBRIC-TEMPLATE.md
   - Canonical six-dimension assessment framework.
   - 0–4 criterion scale.
   - Critical-criterion and maturity-state rules.

7. competency-rubrics.json
   - Machine-readable instantiated assessment definitions for all 42 competencies.

8. DESIGN-RATIONALE.md
   - Records why these decisions were made so later contributors do not reconstruct the system from filenames alone.

## Relationship to the building

The building must ultimately be derived in this order:

repository capabilities
→ institutional program
→ human-development journey
→ competency/evidence requirements
→ physical activity and space requirements
→ authoritative physical program
→ interaction map
→ generated plans / 3D / UI

The six enclosed levels are expected to align with the six letters in EQUITY, while the Level 7 roof / upward symbol is intended as the culmination. The actual acronym words are intentionally NOT locked yet. They should be chosen only after the developmental and physical program is reconciled.

## Core principles

- Free lifetime participation is the baseline.
- Specialized paid or limited cohorts sit above, not instead of, the free lifetime program.
- Federal or external certificates are evidence, not automatic proof of mastery.
- Competency is earned through evidence and increasingly independent performance.
- Learn → Apply → Produce → Verify is preferred over passive course completion.
- Projects are the connective tissue of development.
- The Passport records capability and evidence, not XP points.
- Authorization remains separate from competence.
- AI assistance is disclosed and assessed, not categorically prohibited.
- The comprehensive backend must be progressively disclosed so participants are not overwhelmed.
- Physical building design must wait until the program authority is coherent enough to justify rooms, adjacencies, equipment, and interaction surfaces.

## Current maturity

This package is canonical for the development-program architecture but remains versionable. It intentionally precedes the planned physical-building program rewrite.

No physical building files should be rewritten merely because this package exists. The next architectural phase must explicitly reconcile this program against the current Core V2 building chassis before changing geometry.



## Federal training authority

9. FEDERAL-TRAINING-CATALOG.md
   - Canonical rules for federal/external training records.
   - Separates active course records, annual/versioned programs, candidate providers, and reference-only material.

10. federal-training-catalog.json
   - Machine-readable federal training authority.
   - Exact provider/title/code/URL, award semantics, prerequisites, verification date, and annual revalidation policy.
