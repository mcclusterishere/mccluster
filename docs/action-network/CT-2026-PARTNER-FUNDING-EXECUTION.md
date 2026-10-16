# Action Network — Connecticut partner execution brief (2026-10-15)

**Status:** INTERNAL PROPOSAL. No Connecticut Health Foundation, Faith CDC, Grassroots Fund, municipality, or grant recipient has authorized the proposed missions or promised funds. No participant earnings are advertised.

## Release reconciliation — 16 October 2026

The funding catalog, owner-only API and Control Create → Funding view are integrated with the current three-workspace shell. The production migration and current ledger remain unchanged. The older proposed public office pin and Navigate WIP controls below are deferred to the current transportation branch; this release does not replace the newer public globe. External search is on demand with bounded responses, and unknown award amounts remain unknown. Private catalog state is cleared on authentication changes.

## Outcomes-first rule

Every mission proposal names (1) the **actual funder or grant program**, (2) the **eligible lead or awardee**, (3) an allowable work package, (4) the funder's measurable output, (5) privacy-preserving proof, (6) partner signoff, and (7) the approved expenditure line from which compensation may be paid. If any of these are unknown, the mission remains private draft.

## Connecticut Health Foundation

- Official office address: **100 Pearl Street, 6th Floor, West Tower, Hartford, CT 06103**.
- Source: https://www.cthealth.org/directions-parking/
- The geographic pin in the globe identifies the office only, NOT a program service desk, claim/check-in point, or representation of the foundation's endorsement.
- Published programs: program grants quarterly; president's discretionary grants on rolling basis; topic-specific RFPs irregular.
- Source: https://www.cthealth.org/what-we-do/grantmaking/seeking-a-grant/
- RFPs: none currently open as of 2026-10-15: https://www.cthealth.org/what-we-do/grantmaking/open-rfps/
- On June 30, 2026, the foundation named 42 trusted-messenger grantees receiving a combined $567,200 for Medicaid and SNAP information. Awarded grants are not available to Action Network absent an authorized program agreement.
- Source: https://www.cthealth.org/latest-news/news-releases/grants-for-trusted-messengers-to-share-information-about-upcoming-changes-to-medicaid-and-snap/
- Seven hidden mission proposals are in `supabase/pending/action_partner_opportunity_drafts_v1.sql`.

**Foundation conversation**: propose an independently evaluated digital outreach-and-verification pilot aligned with published reporting metrics, or a delivery contract with an existing funded trusted-messenger grantee. Ask explicitly about eligible compensation, referral policies, data-sharing agreements, oversight, and which 2027 metrics still apply.

**Potential real grantees to approach:** Project Access of New Haven, Integrated Refugee and Immigrant Services, PT Partners and the Connecticut Institute for Refugees and Immigrants. The foundation's 2026 release lists these among grantees. No relationship is implied.

**Data policy:** never ingest diagnoses, insurance cards, benefit IDs, recipients' GPS, names, telephone numbers, or claims decisions into Action Network. Collect event IDs, counts, approved source/campaign IDs, signed completion evidence and de-identified aggregates. Only an authorized partner should hold the contact/eligibility record. Don't pay per positive enrollment outcome without counsel reviewing applicable anti-kickback, inducement and health-program rules.

## Grassroots Fund — DO NOT WAIT FOR 2027

- **Seed**: $500–$1,000, rolling, decision usually 4–6 weeks. Two or more grassroots decision-makers; a 501(c)(3) designation is not necessarily required.
- Source: https://grassrootsfund.org/grant-programs/seed-grants
- **Grow**: larger 2027 cycle, distinct from Seed: https://grassrootsfund.org/grant-programs/grow-grants
- Micro-granting and regranting are excluded. Propose a **volunteer-led neighborhood greening and cleanup pilot**, purchasing only eligible supplies, outreach materials or project expenses. Do not propose cash bounties funded from Seed unless the Fund expressly authorizes a specific cost and it complies with the grant terms.
- Partner organizer requirement: at least two local decision makers. Confirm a group bank account and eligibility before applying.

## Faith CDC + municipal AI service problem — Cities Deliver

- **Proposed lead**: Faith CD Corporation / Faith Community Development Corporation, subject to legal-entity verification and written board/authorized-signatory consent. An email sent Sept. 16, 2026 by Richard Bangs to the owner supplied tax-exemption and incorporation documents; those attachments are confidential and are deliberately NOT included in this public repository.
- Faith CDC's published work includes housing, education, sustainability and technical assistance. Headquarters: 477 Broad St, Bridgeport, CT.
- Source: https://www.faithcdc.org/
- **Prospective city partner:** Bridgeport, CT. No city partnership yet.
- City already uses SeeClickFix for non-emergency Bridgeport 311: https://www.bridgeportct.gov/bridgeport-311
- Potential first-party city contact: Department of Information Technology Services, 45 Lyon Terrace, Director Curtis Denton, itshelpdesk@bridgeportct.gov (source: https://www.bridgeportct.gov/government/departments/information-technology-services).
- City procurement, privacy, accessibility, and SeeClickFix integration/licensing terms must be reviewed before using the platform to file or synchronize service requests.
- **Specific problem to validate with the city:** residents struggle to identify which municipal service channel to use, communicate a report in the right format and understand what happened afterward. This is a *hypothesis for discovery*, NOT a verified City of Bridgeport priority.
- **Pilot:** opt-in, multilingual AI assistant helps residents classify non-emergency service needs using an approved city service directory; authorized human reviewer confirms and routes requests into the **existing city 311 system**; staff receive aggregate dashboards for referral volume, triage time, duplicate flags, resolution status and accessibility outcomes. Do not replace emergency services or make AI authoritative over government decisions.
- **Second potential pilot:** navigation to verified health/social benefit providers with trained human follow-up; measure successful handoffs and time to assistance, not sensitive eligibility/diagnosis.
- **Funder:** Cities Deliver, Rockefeller + OpenAI Foundation; launched 2026-10-14, Round 1 closes **2026-11-29**. Eligible lead, committed city government partner, charitable benefit, meaningful frontier AI and outcome evaluation required. Official: https://citiesdeliver.rockefellerfoundation.org/ ; https://www.rockefellerfoundation.org/cities-deliver-ai-solutions-for-public-services/
- Ask clarifying questions by **2026-10-31** via citiesdeliver@rockround.org.
- **Immediate dependency:** Faith CDC governing-body authorization, city partner commitment, project scope, responsible AI/data policy, baseline metrics and 24-month operating model.

## Existing bounty stack and safety

`action_bounties`, `action_bounty_funding_ledger`, and `action_bounty_claims` already provide reward reservation and payout state primitives. Promotion must require:
1. Signed scope from an eligible grant recipient/authorized partner.
2. Approved budget and permitted cost category; confirm payroll/contractor tax classification.
3. Reserved, reconciled actual funds; do not confuse opportunity amount with available cash.
4. Program-specific proof checks, reviewer role, duplicate and fraud controls.
5. Privacy and vulnerable-population review.
6. Existing bounty SQL fix `supabase/pending/action_bounty_claim_existing_row_guard_v1.sql` applied only after scratch tests and production ledger verification.

The new prospective records are in a **separate, non-public draft table** with `status='draft'`, `visibility='admin_only'`, `claim_enabled=false`, `compensation_cents IS NULL` enforced by DB checks. They do not enter `action_globe_public_region_missions()` and are not public offers.

## Opportunity Intelligence API integration plan

- **Grants.gov search2**: `POST https://api.grants.gov/v1/api/search2` with `{"keyword":"community health","oppStatuses":"posted|forecasted"}`. Search is public and does not require an API key. Source: https://www.grants.gov/api/common/search2
- **USAspending.gov**: `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` to find **past awards/recipients**. Public/no key for basic endpoints. Source: https://api.usaspending.gov/docs/endpoints
- **SeeClickFix/Open311**: use service-code/requests GET routes only when terms and city authorization permit; no automatic public report filing: https://seeclickfix.com/open311/v2/docs
- **CT Health Foundation / Grassroots / CT R2**: manual reviewed source adapters or licensed published data, not imagined official APIs. Their webpages are not official machine-readable grant-award feeds.
- **Admin pipeline**: provider adapter -> canonical `funding_opportunities` record (source URL, retrieved date, update hash, eligibility, deadline, status, funding restrictions) -> human review -> partner plan -> private mission draft -> partner approval -> proof/payment security gates -> native bounty stack.
- First endpoint should be `GET /v1/control/funding/opportunities` **owner-gated**, backed by sourced records and pagination. Add an hourly/daily ingestion job only with source-specific freshness requirements, rate limits, retries, deduplication and license checks. Do not grant browser clients a vendor API key or reveal unpublished partner negotiations.
- API adapters and recurring ingestion are **NOT implemented** by the present feature branch.

## Navigation mode WIP

- The live-app-compatible frontend branch adds a verified-address office point distinct from active mission pins and a Navigation WIP affordance.
- Google Maps URLs launch turn-by-turn navigation or route preview; **no Google Maps API key or Maps SDK is needed for this URL handoff**: https://developers.google.com/maps/documentation/urls/get-started
- Origin is omitted so Google can resolve device location with the user's consent. Action Network does not store GPS or claim an estimated travel time.
- Future fully embedded navigation would require routing engine/provider, rate-limit, mobile permissions, attribution/licensing and accessibility checks. Avoid depending on uncontracted public OSM tile endpoints for a high-scale commercial map.
- The 100 Pearl coordinate is an approximate building-level map point from publicly available address geocoding; the **street address** is the authoritative navigation destination.
