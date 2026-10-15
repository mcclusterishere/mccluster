# Global Civic Discovery — Activation Runbook

## Current implementation
Migration `20261014060000_civic_global_discovery.sql` creates a source registry, hierarchical civic jurisdictions, permanent offices, officeholder terms, public official contact channels, and sync audit records. No outbound contact or funded bounties are enabled by this migration. All new sources start disabled. Public RLS only shows verified jurisdictions/offices/terms and independently verified public contact channels.

## Activate free and registration-based sources

| Source key | Sign up / documentation | Credential | Next integration step |
| --- | --- | --- | --- |
| wikidata | https://www.wikidata.org/wiki/Help:Data_access | none | Build country-scoped Wikidata query adapter; confirm against official sources. Avoid large SPARQL scans. |
| uk_parliament | https://developer.parliament.uk/ | none for public API | Add members and constituencies adapter; verify license and source identifiers. |
| canada_commons | https://www.ourcommons.ca/en/open-data | no API key for public datasets | Add federal members/constituencies import. |
| brazil_camara | https://dadosabertos.camara.leg.br/swagger/api.html | public endpoints | Add deputies and offices import. |
| ipu_parline | https://data.ipu.org/data-tools/api/ | verify access terms | Add country/parliament/chamber import; confirm access/terms. |
| congress_gov | https://api.congress.gov/sign-up/ | CONGRESS_API_KEY | Add federal legislation/member adapter. |
| openstates | https://docs.openstates.org/api-v3/ | OPENSTATES_API_KEY | Add state people and jurisdictions; limited municipal coverage. |
| legiscan | https://legiscan.com/legiscan | LEGISCAN_API_KEY | Existing `scripts/policy/legiscan-sync.mjs` is a preliminary search importer; needs detail validation, mapping and scheduling. |
| legistar | https://webapi.legistar.com/ | per municipality / possible token | Create municipal/county adapter and municipality coverage registry. |
| official_local | https://www.usa.gov/local-governments | jurisdiction-specific | Source-by-source reviewed ingestion for councils, counties, mayors, and wards. |

## Secret handling
Configure keys only in the authorized server runtime or Supabase secrets. Do not commit keys, place them in HTML, or expose service-role credentials to browser clients. For example, register `CONGRESS_API_KEY`, `OPENSTATES_API_KEY`, `LEGISCAN_API_KEY` in the secure environment and run an authenticated connectivity test before enabling each source.

## Coverage contract
Never label unverified Wikidata entries as official. Record source URL, jurisdiction, verification timestamp, and officeholder term dates. Keep government office records independent of people. A state/province region is insufficient to resolve county/municipal/ward representation; use private address-to-district matching when consented and supported. No claim of universal coverage.

## Security and civic boundaries
No bulk emailing of public offices, auto-contact, constituent political profiling, paid policy bounties, or public release of private addresses. Contact missions require member approval, reviewed destination, and traceable delivery. Public records are descriptive and politically neutral.

## Verification checklist
1. Run Supabase migration and verify registry rows and RLS.
2. Confirm anonymous users cannot read unverified offices or private sync logs.
3. Configure one source credential server-side; check quota/license.
4. Build a source adapter, run a small import, verify official source links.
5. Publish only reviewed records; show stale/partial coverage in globe.
6. Monitor sync failures, duplicates, official changes and term expiry.
