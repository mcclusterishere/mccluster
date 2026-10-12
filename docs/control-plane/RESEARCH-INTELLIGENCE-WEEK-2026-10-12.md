# Research Intelligence Week — 2026-10-12

Issue: #412

## Weekly backend objective

The backend's primary goal for this week is to become a private **Research Intelligence** system that joins three existing planes without duplicating them:

1. **First-party website intelligence** — Control analytics, forensics, Audience Science, experience/experiment telemetry.
2. **World / policy intelligence** — Seek First provider gateway, spatial sources, public/open datasets, policy/government sources.
3. **Research / publication intelligence** — research projects, evidence/source provenance, manuscript production, reproducibility, and scholarly distribution.

The owner-facing product is a **Policy Research** module in Control.

## Target workflow

```text
research question
  -> evidence/source collection
  -> governed dataset
  -> analysis
  -> claims/findings
  -> manuscript or policy brief
  -> review
  -> reproducibility bundle
  -> publication/distribution
```

## Existing systems are canonical

Do not create parallel ledgers.

- Visitor analytics: `workers/mccluster/src/analytics/*`
- World/spatial intelligence: `workers/mccluster/src/seek-first/*`
- Experience evidence plane: `experience_*`, `research_projects`, `research_sources`, `research_artifacts`
- Publication pipeline: Equity Uprise manuscript/publication tables and functions
- Scholarly distribution: existing Zenodo, ORCID, OSF, SSRN/Crossref adapters where configured
- Decision/evidence intelligence: existing private decision-intelligence work

## Policy Research module

Owner-only Control surface with these views:

- Projects / research questions
- Visitor & audience analytics
- World / spatial intelligence
- Evidence & source matrix
- Dataset builder
- Analysis / reproducibility
- Manuscript / policy brief
- Publication / distribution

## Research-grade contract

A value may be operationally useful without being publication-eligible.

Every paper-bound datum or aggregate should retain, where applicable:

- source URI and source identity;
- retrieval timestamp;
- observed/published timestamp;
- source license / entitlement / lane;
- query/extract parameters;
- transformation version;
- code commit and policy/model version;
- retention/expiry state;
- de-identification / aggregation state;
- citation key;
- research-project association;
- consent / human-subjects eligibility state.

Production telemetry is **not automatically converted into research data**. The system should make eligible streams research-addressable, then gate publication datasets on licensing, minimization, de-identification and applicable human-subjects review.

## Visitor intelligence boundary

The goal is high-resolution first-party operational analytics, not covert identity enrichment.

Allowed product goals include:

- funnels and journeys;
- cohorts and retention;
- acquisition/source attribution;
- content affinity;
- conversions and outcomes;
- experiments and propensities;
- session/error/page-performance analysis;
- safe geographic aggregation;
- transparent behavioral features with evidence counts.

Do not infer protected or highly sensitive traits from browsing behavior and do not build third-party shadow profiles or cross-site identity stitching.

## World intelligence boundary

Seek First remains the governed provider gateway.

Source entitlements, academic/commercial/public lanes, attribution, persistence limits and retention rules remain enforceable. A visible map layer is not automatically eligible for archival or publication.

## Reproducibility bundle

A publishable project should be able to produce:

- manuscript or policy brief;
- methods;
- data dictionary;
- source/citation manifest;
- query/extract manifest;
- eligible de-identified dataset or aggregate;
- analysis code/notebook reference;
- limitations;
- exact Git commit;
- policy/model version;
- publication receipt / DOI where applicable.

## Scholarly publication targets

The repository already contains publication adapters for:

- Zenodo
- ORCID
- OSF
- SSRN
- Crossref where configured

The Policy Research module should expose readiness, missing credentials, approval requirements and external receipts rather than silently attempting distribution.

## This week's definition of done

- One owner-only Research Intelligence read model unifies first-party analytics, research registry and world/source readiness.
- Control exposes a Policy Research module using that read model.
- A project can attach governed visitor aggregates and Seek First extracts to an evidence/source matrix.
- Dataset eligibility gates prevent raw/private/ineligible data from entering publication bundles.
- Claims retain citations, provenance and contradictory evidence.
- Reproducibility bundle generation works for at least one project.
- Publication preflight reports Zenodo / ORCID / OSF / SSRN / Crossref readiness.
- One internal end-to-end pilot produces a draft policy brief from real source data plus first-party aggregate analytics.
- No new public-facing analytics/research surfaces are introduced.
