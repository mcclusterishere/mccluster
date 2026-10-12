# Research Intelligence Plane v1

This module turns the existing Research Lab, first-party analytics, and Seek First
spatial intelligence into a reproducible evidence workflow.

## Boundary

Research publication uses aggregate/de-identified evidence by default. Raw visitor
identifiers, emails, IP addresses, device IDs and session-level forensics remain
owner-only operational telemetry and are not publication evidence. The claim graph
can preserve contradictory evidence instead of forcing a single narrative.

## API foundation

- `GET /v1/research` — capabilities and privacy posture.
- `GET /v1/research/projects` — Research Lab registry.
- `GET /v1/research/sources` — canonical bibliography.
- `POST /v1/research/citations/export` — deterministic CSL-JSON, BibTeX or RIS.
- `GET /v1/research/project-packet?project_key=...` — project, evidence,
  claims, artifacts, bibliography and publication-readiness summary.

All routes require the canonical McCluster house owner.

## Evidence model

`research_evidence_snapshots` records the exact source system, query specification,
data window, row count, privacy class and optional SHA-256 of an analysis input.
`research_claims` records draft/supported/contested/rejected/published claims.
`research_claim_evidence` links a claim to exactly one bibliographic source or
one evidence snapshot and labels the relationship supports/contradicts/context.

This is deliberately compatible with:
- Audience Science and aggregate analytics;
- Seek First governed spatial/public-data queries;
- existing Research Lab projects/artifacts;
- the existing Equity Uprise publication distribution implementation for Zenodo,
  OSF and ORCID.

## Next vertical slice

1. Capture immutable aggregate analytics snapshots from Audience Science.
2. Capture governed Seek First query manifests with source attribution/licensing.
3. Add claim editing and automatic source locators in Control.
4. Bridge a reviewed project packet into the existing manuscript/publication
   pipeline, keeping Zenodo/OSF/ORCID publication approval-gated.
