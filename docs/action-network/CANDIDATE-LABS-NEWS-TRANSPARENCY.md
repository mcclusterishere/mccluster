# Candidate Research Labs and Independent News Transparency Engine

## Candidate role contract
A candidate is not a verified officeholder. `civic_candidate_profiles` represents an opt-in member exploring, declaring, filing for, or ending a candidacy. Filing verification must be based on official election records. `civic_candidate_cohorts` and `civic_policy_lab_projects` support collaborative policy research. Public access remains disabled until authorization, verification, and privacy policies are implemented.

Free research capabilities: public bill search, official sources, cited research documents, issue taxonomies, public hearing schedules, and collaborative cohort workspaces. Do not infer individual political preferences, score voter susceptibility, or automatically generate/send targeted political persuasion. Campaign operations involving fundraising, expenditures, or voter data require jurisdiction-specific legal and privacy review.

## News transparency product
Ground News has no verified public free developer API. Build original ingestion and provenance, not cloned copyrighted content or proprietary ratings.

Data model: media_entities (publishers, owners, funds), media_relationships (dated, sourced, verified edges), media_outlets (domain/feed), media_articles (headline, URL, time, topic), media_story_clusters (reviewed groups), media_source_assessments (observable transparency dimensions). All scores, if later introduced, must be explicit reproducible formulas tied to verifiable facts; avoid overall partisan ratings, favorable/unfavorable political rankings, and inferred corporate political intent. Ownership is not proof of editorial control. An absent relationship is unknown, not proof of independence.

## Initial source adapters
- GDELT DOC 2.0: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ — news discovery; check reuse/traffic conditions
- GDELT data: https://www.gdeltproject.org/data.html — multilingual events and metadata
- RSS/Atom: publisher-authorized feeds and official government press feeds, observing robots/terms
- Wikidata SPARQL: entity identifier bootstrap; verify ownership claims against company filings
- SEC EDGAR: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data — U.S. issuer filings and ownership disclosures, rate limits and fair access apply
- UK Companies House: https://developer.company-information.service.gov.uk/ — registration and terms required
- GLEIF: https://www.gleif.org/en/lei-data/gleif-api — entity identities, not a complete ownership graph

## Deterministic processing
1. Normalize canonical URLs and feed GUIDs; deduplicate exact URLs.
2. Extract declared source and publication time. Preserve source links.
3. Apply explicit, auditable topic dictionaries, jurisdiction tags and user-selected filters.
4. Cluster only on deterministic high-confidence keys or reviewed story assignments; never claim different stories are identical on keyword overlap alone.
5. Display source count, publication times, ownership provenance, and unknown/unverified coverage.
6. For ownership paths, show dated evidence per edge, percentage if known, and confidence as VERIFIED/UNVERIFIED, never inferred ideological alignment.
7. Respect publisher copyrights: link to original content; don't mirror article bodies without a license.
8. Audit corrections, disputes, and stale ownership links.

## Delivery gates
Schema applied; importer, API connectivity, UI, verification, candidate self-service, legal review and tests remain pending. No production-ready news coverage or campaigns are claimed.
