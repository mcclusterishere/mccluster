# Equity Uprise — Federal Training Catalog & Building Binding Authority

> Status: **CANONICAL V1 — FEDERAL TRAINING SOURCE OF TRUTH**
>
> Last issuer verification: **2026-09-22**
>
> This is an instructional/evidence architecture. It does **not** turn federal course completion into Equity Uprise competency mastery, construction authority, professional licensure, or permission to operate live building systems.

## Purpose

The repository previously mixed exact FEMA course references with broad agency names such as IRS, EPA, HHS/OHRP, NIH, ATSDR/CDC, CISA, DOE, NOAA and NASA. This layer makes those references resolvable and auditable.

Canonical machine-readable authority:
- `FEDERAL-TRAINING-CATALOG.json`
- `FEDERAL-TRAINING-BINDINGS.json`
- `verify_federal_training_catalog.py`

## Classification law

Every federal item is one of:
1. **course / course series / course path** — an issuer-defined training completion can be represented accurately;
2. **dynamic program** — the agency maintains a changing catalog and an individual offering is pinned only when selected for a cohort;
3. **reference material / dataset** — used for labs and research but never represented as a course credential.

Credential state and Equity Uprise competency state remain separate.

## Immediate hands-on readiness

**Ready now without a physical lab**
- FEMA IS-100.C, IS-120.C, IS-130.A, IS-200.C, IS-201.A, IS-235.C and IS-238 can drive emergency/ICS/exercise scenarios in the existing digital twin.
- IRS VITA/TCE Link & Learn Taxes can pair with the current Practice Lab and Floor 1 intake/privacy/service workflows.
- HHS/OHRP foundational and participant-centered consent training can pair with Floor 1 intake/privacy and Floor 5 Policy + Proof work.
- CISA ICS 300/401 can pair with the Step 4A cyber/BAS/OT lab set.
- EPA Portfolio Manager, NOAA Digital Coast, NASA ARSET, ATSDR PHAT, DOE/FEMP and CDC EHTER Awareness can support software/data/simulation labs now.

**Real-lab / eligibility dependent**
- CISA ICS 301 is an in-person Red/Blue exercise and remains a later external cyber-range experience.
- CDC EHTER Operations is a 40-hour in-person course with eligibility rules.
- Physical cable certification, OTDR, RF surveys, live BAS, energized electrical work, real fire-alarm work and commissioning require proper hardware, authorization and competent supervision.
- FEMP live-building re-tuning requires an authorized facility/BAS/metering environment.

## Normalizations

- `FEMA ICS-100` is a stale shorthand. Canonical ID/title: **FEMA IS-100.C — Introduction to the Incident Command System, ICS 100**.
- `IS-238` is active as of 2026-09-22. Canonical title: **Critical Concepts of Supply Chain Flow and Resilience**.
- The handoff phrase “Planning and Analysis for Safety and Security” is retained only as a stale/incorrect alias for provenance; it is not the current IS-238 title.
- IRS VITA/TCE records are tax-year-specific and must refresh annually.
- DOE/FEMP, NOAA Digital Coast and NASA ARSET are intentionally represented as dynamic programs until a specific offering is selected.
- NIH is resolved through OHRP’s foundational training where OHRP states it can satisfy the NIH human-subjects education requirement.

## Non-course boundary

Do **not** create credential records for:
- OSHA emergency-action/underground-construction regulations;
- FHWA tunnel manuals;
- NIST SP 800-82;
- NVD;
- CISA Known Exploited Vulnerabilities (KEV).

These remain reference/standards/data inputs.

## Building safety boundary

Floor 1's existing training law is preserved:
- live B1 access is not granted to learners;
- Building Systems Lab launches a sandboxed clone;
- all federal cyber/OT/life-safety bindings are instructional;
- no course completion grants control of live B1, BAS, access control, fire alarm, electrical, security or network systems.

## Refresh cadence

Re-verify:
- **IRS** before each tax-season cohort;
- **dynamic catalogs** (DOE/FEMP, NOAA, NASA, EPA) before each cohort;
- **CISA in-person dates/eligibility** at enrollment;
- **all federal URLs/titles** at least annually or when CI/provenance review detects a change.
