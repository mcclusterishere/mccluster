# PRIM backend tracking architecture

Status: implementation contract

## Purpose

PRIM tracking must use the existing McCluster control plane rather than creating another LMS backend.

The public learning model is:

P Principles: Learn it.

R Rhythm: Remember it.

I Immersion: See it.

M Missions: Do it.

Principles is the mandatory education layer. Rhythm, Immersion and Missions are separately tracked reinforcement or application layers.

## Current live data path

Browser

→ McCluster Cloudflare Worker at `api.mccluster.org`

→ M Account authentication

→ PRIM3 course and progress routes

→ Supabase `prim3_course_progress`

The existing `mastery` JSON column is the modality extension point. No second learner database is required.

Principles continues to use the existing reading, assessment score, attempts and pass fields.

For each PRIM3 source unit, the first Principles module is the unit tracking anchor for Rhythm, Immersion and Missions. Example: U01 uses M04 as its tracking anchor.

The anchor row may contain:

```json
{
  "prim": {
    "R": {
      "completed": true,
      "completed_at": "timestamp",
      "metadata": {}
    },
    "I": {
      "completed": false,
      "completed_at": null,
      "metadata": {}
    },
    "M": {
      "completed": false,
      "completed_at": null,
      "metadata": {}
    }
  }
}
```

P is not manually stored in this object. Principles completion is derived from required module pass state so reinforcement can never manufacture course credit.

## Browser integration API

`window.PRIM3_TRACKING` is the learner side integration surface.

`refresh()` reloads authenticated learner progress and certification maps.

`summary()` returns the most recent local summary used by the dashboard.

`recordModality(unitId, letter, completed, metadata)` records R, I or M against the source unit tracking anchor through the existing authenticated Worker progress route.

Future integrations should call this helper only after a real completion event.

Examples:

A music player may record R after the learner satisfies the approved listening completion rule.

An episode player may record I after the approved viewing completion rule.

The game may record M after a mission result is accepted by the approved game backend contract.

Those completion rules are intentionally not invented here.

## Objective tracking

The dashboard compares Principles modules actually passed by the learner against the existing curriculum ledgers.

Security Plus uses `SECURITY-PLUS-TOPIC-LEDGER.json`.

Network Plus uses `NETWORK-PLUS-TOPIC-LEDGER.json`.

A Plus uses `APLUS-PRECURSOR-MAP.json` as a supporting foundation tracker.

An objective is displayed as mastered only when every Principles module currently assigned to that objective has been passed.

Partial objective coverage is also visible so the learner can see which certification areas are already in progress.

This is deliberately stricter than counting an objective as complete because its number appeared in one lesson.

## Cloudflare role

Cloudflare is the public edge and remains the only browser facing backend surface.

It performs authentication, course ingestion, progress validation and Supabase writes.

The browser must never connect directly to the VPS for learner state.

The browser must never receive Supabase service credentials.

## Supabase role

Supabase remains the system of record for learner state.

The current `prim3_course_progress` table already contains the fields needed for Principles progress and the `mastery` extension used by the other PRIM modalities.

This means the PRIM tracking launch does not require a shadow schema or a second authentication model.

If future analytics require an append only learning event ledger, that should be added to the same Supabase project through a reviewed migration rather than created on the VPS.

## VPS and McCluster Core role

The VPS is the persistent execution plane, not the public LMS backend.

The current Core runtime work uses the durable `ops_agent_jobs` queue and keeps the broker on loopback. That architecture is the correct place for asynchronous learning intelligence after the Core runtime is merged and deployed.

Recommended future Core job types include:

`prim3_progress_digest`

Summarize learner progress and recently mastered objectives.

`prim3_review_recommendation`

Find the next Principles concepts that need review using objective gaps and assessment history.

`prim3_curriculum_gap_audit`

Compare authored lessons against the Security Plus, Network Plus and A Plus maps and flag objectives whose required instruction or assessment is still incomplete.

`prim3_retention_analysis`

Compare Principles mastery with later Rhythm, Immersion and Mission participation after enough real learner data exists.

These jobs must read from the canonical Supabase state and return derived outputs through the McCluster control plane. They must not create a VPS only learner profile database.

## Event flow after Core runtime integration

Learner action

→ Cloudflare Worker

→ Supabase canonical progress

→ reviewed trigger or scheduler creates a bounded Core job

→ VPS Core runner claims the job

→ local or remote model performs analysis

→ result is written to canonical McCluster tables

→ Cloudflare exposes only the authorized result to the learner or operator

The VPS is therefore the thinking and execution layer while Supabase remains memory and Cloudflare remains the controlled edge.

## Privacy and scope

Track only what is required for learning progress, objective coverage, reinforcement status and approved analytics.

Do not send raw private learner data into autonomous coding tools.

Do not let a local model independently modify learner mastery.

Derived recommendations may suggest review, but Principles mastery continues to come from the approved course and assessment rules.
