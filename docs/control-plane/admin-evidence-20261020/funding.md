# W10 funding register — implementation evidence

Source baseline: `e9d8604988496783fa25f4c450bd49fec69ba476`, 20 October 2026. This is source work for review. No migration, application, contact, award, payment, production deployment or license change was performed.

## Current truth and delta

The existing `action_funding_opportunities` relation has four source-backed program records and a separate ten-row private partner-draft relation. Its broad `availability` values cannot represent grants, credits, loans, tax incentives, invitations and expired programs accurately. Its Cities Deliver note incorrectly restricted applicants to nonprofits. Its `reviewed_at` date is not a selected applicant's eligibility review.

This increment adds **one nullable JSONB column**, `action_funding_opportunities.criteria_register`, and seeds **72 route records with 440 criteria**, preserving N01–N04's original primary keys and the existing private drafts. It adds no table, scheduler, application writer or financial authority. The pending seed retains legacy notes in `previous_catalog_record` and does not overwrite a non-null register on replay. New amendments require a new reviewed migration rather than silently replacing prior evidence.

`funding-register.json` is the reviewable seed input, not a second live authority. Supabase remains runtime truth. `scripts/funding/render-register-seed.mjs` only renders/checks pending SQL and cannot contact a database. The existing proprietary repository license remains in force.

The new read route is `GET /v1/control/funding/register`; `?route_id=C02` returns criteria/source detail. It lives behind the unchanged canonical house-owner dispatcher. Responses are private/no-store. Lists are capped at 100 plus a lookahead row and explicitly report truncation. Missing schema and failed reads are distinct from a successful empty register. Existing `/catalog`, `/search`, `/awards` and partner drafting contracts remain in place.

## Meaning and evidence

- `required_eligibility`, `required_submission`, `scored`, `recommendation` and `proposed_target` are different classes. W01–W10 engineering targets are never presented as funder mandates.
- `evidenced`, `gap`, `unverified`, `external_prerequisite`, `not_applicable`, `closed` and `incompatible` are evidence states, not scores. Required unresolved gates block readiness.
- Technical mapping, applicant eligibility and submission readiness are separate. No percentage, reviewer weighting, probability or sum of anticipated awards is computed.
- A general catalog has no selected private applicant. Therefore this API **cannot conclude that any applicant is eligible**, even if every technical checkbox has a value. It returns `eligible_to_apply:null` when that fact is unknown and `false` for a known blocking route/gate.
- Imported `evidenced` or `not_applicable` labels are downgraded unless a reviewed primary-source version and independently resolved evidence references exist. The current route provides no evidence resolver and accepts no evidence through query parameters. A hash alone cannot supply truth or reviewer authority.
- Closed historical awards stay closed. Current NLnet routes stay incompatible based on the supplied brief; no proposal narrative or funded code is generated for them. Credits, allocations, investments, loans and tax incentives are separately labeled, and none becomes available cash.
- Exact published instants are enforced at the boundary. NSF's submitting-organization-local deadlines retain that unresolved timezone; the implementation does not invent an applicant's zone.

## Source refresh and limitations

`funding-source-refresh.json` records a bounded refresh attempt for every one of the 72 official URLs: 62 returned complete response bytes, four were unavailable, and six returned empty/tiny/over-cap bodies. **This is transport evidence, not 62 verified funding calls.** Source bytes are excluded from Git. Checks used a 15-second request timeout, 2 MB cap, up to eight parallel requests and SHA-256 of returned bytes.

Selected facts were actually rechecked on current primary pages for C02, C03, N01, N02 and N04: deadline/time basis, the relevant core scope/applicant rules, and explicitly recorded ranges. These records say `selected_facts_checked`, not full verification. All 72 records remain `screening_not_exhaustive`; unknown amounts, track rules, amendment details, costs/materials/IP rules and reporting obligations remain unknown where not established. The brief's reported amounts are explicitly identified as such. Track amounts are not added together.

Current primary references used:

- [PESOSE NSF 26-506](https://www.nsf.gov/funding/opportunities/pesose-pathways-enable-secure-open-source-ecosystems/nsf26-506/solicitation): deadline and revision sections.
- [AI Datasets NSF 26-512](https://www.nsf.gov/funding/opportunities/ai-datasets-unlocking-dataset-value-ai-enabled-scientific-discovery/nsf26-512/solicitation): deadline; I, II, V.A.
- [Cities Deliver portal](https://citiesdeliver.rockefellerfoundation.org/), [FAQ](https://citiesdeliver.rockefellerfoundation.org/docs/RFNPrograms/RFOverviewandfaqsv5.pdf), [terms](https://citiesdeliver.rockefellerfoundation.org/docs/RFNPrograms/Cities-Deliver-AI-Solutions-for-Public-Services-Terms-and-Conditions-Final.pdf): deadline; FAQ pp. 2–4; terms §§1–2. A later amendment/form review remains required.
- [CT Health grant process](https://www.cthealth.org/what-we-do/grantmaking/seeking-a-grant/): eligibility and discretionary-grant sections.
- [Seed program](https://grassrootsfund.org/grant-programs/seed-grants): deadline, grant size and eligibility. The supplied brief's linked-rubric $700 minimum versus page $500 minimum is retained as an unresolved discrepancy.
- [NLnet current policy](https://nlnet.nl/foundation/policies/generativeAI/) and [20 October announcement](https://nlnet.nl/news/2026/20261020-AI-policy.html) could not be independently read in this refresh. The restrictive brief-derived status is retained rather than assuming compatibility.

A complete call-by-call requirements review, private applicant evidence resolution and budget/accounting integrations remain open W10 work. The register deliberately exposes these gaps; it is not a completed application packet or a claim of funding eligibility.

## Validation

```
node --test workers/mccluster/test/funding-intelligence.test.mjs workers/mccluster/test/funding-requirements.test.mjs
node scripts/funding/render-register-seed.mjs --check
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/funding/validate-register-db.mjs
```

Observed: **18/18 targeted tests passed**. The PGlite 0.5.10 isolated database run passed: 72 opportunity rows; four civic IDs preserved; ten private drafts unchanged; repeat seed preserves subsequent metadata; malformed arrays and missing schema versions rejected; anonymous reads denied; ordinary authenticated rows hidden; admin reads allowed by the preexisting policy; browser writes denied. The RLS helper is a controlled local fixture, not a production identity test. No new repository dependency was installed.

Tests cover historical/closed calls, PI/licensing/partner gaps, incompatible AI workflow, forged evidence/N/A labels, deadline boundaries, noncash instruments, invalid/duplicate manifests, bounded results, absent schema and upstream failure. They do not assert that an external partner, PI appointment, award, public release or source amendment exists.

## Promotion and rollback

1. Review the 72-route seed, its `unverified`/external statuses and current canonical migration ledger. Recheck selected call versions before preparing any application.
2. Validate `20261020193357_funding_criteria_register_v1.sql` in a staging copy after `20261016020407_action_partner_opportunity_drafts_v1.sql`. No migration is auto-applied.
3. Promote the reviewed SQL and Worker through the existing process. Read the list and selected detail through an actual authorized owner session; verify guest/member denial and direct database boundaries.
4. Worker rollback can omit the new route without removing the metadata. Prefer this additive rollback. If data removal is required, first export the reviewed register/history; do not delete the four legacy programs or the partner drafts, and do not erase later review evidence merely to revert a seed.

The existing table's authenticated-admin SELECT policy is unchanged. Do not place confidential applicant documents, raw tax/ownership records, private contact data or partner letters in this program catalog. Their authorized private record integration is still pending.
