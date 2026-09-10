# Seek First Cost & Eligibility Ledger — September 2026

**Status:** planning / procurement authority  
**Reviewed:** 2026-09-10  
**Architecture:** existing McCluster Worker + Supabase + Seek First viewer; no second authoritative backend

## Executive budget

Because McCluster already has a Cloudflare Worker and Supabase project, the owner-only Seek First viewer does **not** inherently require a new $24/month VM.

### Budget bands

| Band | What it means | Fixed incremental target |
|---|---|---:|
| Existing-stack prototype | Keep current Worker/Supabase plan, use open/keyless feeds, static/CDN viewer | ~$0 incremental if current quotas suffice |
| Reliable owner production | Workers Paid if needed + Supabase Pro | ~$30/month if neither cost is already being paid |
| Rich owner console | Reliable owner production + controlled Google/OpenAI usage | ~$30–75/month target |
| Research-enhanced | Add approved academic/nonprofit imagery/data entitlements | often $0 direct API spend, but license-lane restricted |
| Scale / multi-user | larger DB/compute/cache + paid provider licenses | measure before budgeting; provider contracts dominate |

Current reference prices:
- Cloudflare Workers Paid minimum: $5/month.
- Supabase Pro: from $25/month; paid plan includes $10/month compute credit sufficient for one Micro project under current pricing.
- Google Photorealistic 3D Tiles: 1,000 free monthly events, then $6/1,000 in the first paid tier.
- AI usage is variable and should be budgeted separately with provider-side limits.

## The key strategy: stack **lanes**, not credentials

Do not try to make one eligibility category pay for every product use.

The canonical entitlement firewall already supports the correct structure:

```text
PUBLIC_OPEN -> broadly reusable subject to source terms
ACADEMIC    -> internal/non-commercial research only unless separately licensed
NONPROFIT   -> nonprofit mission lane only unless separately licensed
COMMERCIAL  -> paid/commercial product lane
INTERNAL    -> owner/control-plane view over legitimately acquired sources
RESTRICTED  -> explicit agreements/authorization only
```

The owner console may visually combine data from multiple lanes because it is an internal analysis surface, but every source retains its own provenance, terms and persistence policy. A commercial/player-facing product may only receive sources whose terms authorize that consumer lane.

## Best cost reducers

### 1. Public/government/open data — P0

Use these before buying a commercial equivalent when the public source satisfies the use case.

Already registered in McCluster:
- U.S. Census
- EIA
- BLS
- FRED
- USAspending
- Grants.gov
- EPA
- USGS
- NHTSA
- NASA FIRMS
- Copernicus
- CelesTrak
- OSM/Overpass

High-value additions to implement:
- **National Weather Service API** — forecasts, observations and alerts; U.S. government open data, free for any purpose with reasonable rate limits.
- **OpenFEMA** — public FEMA disaster, assistance, mitigation, NFIP and related datasets; API requires no registration.
- **NASA EONET v3** — GeoJSON natural-event feed and event-linked imagery/layer metadata.
- **CISA Known Exploited Vulnerabilities (KEV)** — authoritative exploited-in-the-wild defensive vulnerability catalog, downloadable as JSON/CSV.
- **NIST NVD 2.0** — CVE/CPE/vulnerability-management context; current feeds/APIs include CVSS plus 2026 SSVC/affected-data additions.
- **NOAA/NCEI CDO** — climate/station data; free token, documented 5 req/s and 10,000/day token limit.

These sources strengthen both the real GEV and the Security+/Network+/infrastructure educational bridge.

## Nonprofit leverage

### Microsoft for Nonprofits

Eligible nonprofits can currently receive **$2,000 USD in Azure credits per year**. This can fund optional compute, queues, storage, AI/search experiments, batch geospatial processing or disaster-recovery infrastructure without changing McCluster's canonical backend architecture.

Reference: https://www.microsoft.com/en-us/nonprofits/azure

### AWS Nonprofit Credit Program

AWS currently advertises **up to $5,000 USD in AWS Promotional Credit** for eligible nonprofits through its nonprofit credit program. Some program/partner pages expose different offer amounts, so verify the exact available grant in the applicant's geography/account before designing around it.

Reference: https://aws.amazon.com/government-education/nonprofits/nonprofit-credit-program/

Use case for Seek First: optional raster processing, archival jobs, batch ETL, object storage, or a subordinate compute node. Do not relocate the canonical auth/entitlement backend merely to consume credits.

### AWS Imagine Grant

Registered U.S. 501(c) organizations may apply. This is competitive grant funding/credit support, not automatic infrastructure entitlement.

Reference: https://aws.amazon.com/government-education/nonprofits/aws-imagine-grant-program/

### Google Maps Platform Public Programs — nonprofit

Verified Google for Nonprofits organizations can apply for additional Google Maps Platform credits. Current program information states credits start at **$250/month** for Google Maps Platform and **$75/month** for Google Earth for eligible approved nonprofits.

Reference: https://developers.google.com/maps/billing-and-pricing/public-programs

This is one of the most directly relevant subsidies because photorealistic 3D, places and mapping can otherwise become a material GEV cost.

### Mapbox nonprofit support

Mapbox accepts nonprofit-support applications and may provide donated or discounted services when free tiers are insufficient; applications are currently reviewed in May and November.

Reference: https://www.mapbox.com/nonprofit

### Esri nonprofit program

Eligible U.S. 501(c)(3) public charities may receive ArcGIS software/subscriptions at discounts reported by Esri as **50–99%**, plus developer tools and Living Atlas access. This is valuable for an analysis/operator lane, though it is not automatically the best renderer backend for Seek First.

Reference: https://www.esri.com/en-us/industries/nonprofit/nonprofit-program

### Cloudflare Project Galileo

Not a generic nonprofit discount. It is for vulnerable public-interest organizations in areas such as human rights, civil society, journalism and democracy. Approved participants receive Cloudflare Business-plan-style protections, Workers and Zero Trust benefits. Apply only if the organization's public-interest mission genuinely fits the program.

Reference: https://www.cloudflare.com/galileo/

## Student / academic leverage

### Azure for Students

Eligible full-time students at accredited degree-granting institutions currently receive **$100 Azure credit**, no credit card required, plus selected free services. Personal/student benefits should fund learning/research prototypes rather than silently underwriting a commercial product unless the offer terms expressly permit it.

Reference: https://azure.microsoft.com/en-us/free/students

### GitHub Student Developer Pack

Keep it active for current partner offers and development tooling, but do **not** budget on the old DigitalOcean credit. GitHub's July 2026 changelog states DigitalOcean left the Student Developer Pack and the offer ended July 31, 2026; prior credits expired August 1, 2026.

References:
- https://github.com/github-education-resources/Student-Developer-Pack-Current-Partners-FAQ/blob/main/SDP-changelog.md
- https://education.github.com/pack

### Planet Education & Research

Any university-affiliated student, faculty member or researcher may apply. Planet currently advertises a **free Basic** E&R tier with up to **3,000 km²/month** of PlanetScope/RapidEye imagery. It is explicitly non-commercial/personal research access; Planet data may not be used to build a value-added product for sale under the Basic research license.

Therefore:
- valid for an ACADEMIC / research layer;
- useful for PRIM3 research, change-detection experiments and internal study;
- **not** a free commercial imagery backend for public/player GEV.

Reference: https://account.planet.com/industries/education-and-research/

### OpenSky institutional research

OpenSky says institutional researchers can request expanded/unlimited API access and historical data. However its published terms also state that REST API use is for non-profit research/education and that operational integration into a live product/service requires a written license, regardless of nonprofit status.

Therefore:
- academic research lane: apply for institutional research access;
- owner operational/product lane: negotiate written operational licensing or use an appropriately licensed aircraft provider/fallback.

References:
- https://opensky-network.org/about/faq
- https://opensky-network.org/about/terms-of-use

### Copernicus Data Space

Copernicus provides open/free Sentinel data and free core API/processing access with fair-use capacity. Current openEO general-user accounts receive a monthly free processing-credit allocation. This is one of the strongest lawful low-cost Earth-observation backbones available to Seek First.

References:
- https://dataspace.copernicus.eu/
- https://documentation.dataspace.copernicus.eu/APIs.html

## Veteran leverage

Treat veteran status as a **separate program axis**, not an assumed privileged-data/API lane.

### What is real

- AWS Certification exams may be reimbursable for qualifying U.S. veterans through GI Bill education benefits (up to the applicable reimbursement limits). This reduces training/certification cost, **not GEV cloud/API cost**.
- VA Lighthouse/VA Developer APIs exist for legitimate Veteran-facing applications. Protected Veteran data is not a general OSINT feed. OAuth APIs require Veteran consent or an approved consumer relationship; some client-credentials/restricted endpoints require VA employment or specific VA agreements.

References:
- https://aws.amazon.com/certification/veterans-reimbursement/
- https://developer.va.gov/explore/api/veteran-service-history-and-eligibility/docs?version=current

### What not to budget on

There is no verified general-purpose “veteran API credit” that should be treated as a universal cloud subsidy for Seek First. Veteran programs are more likely to reduce education/training expenses or enable a specific Veteran-service application than to subsidize unrelated geospatial product infrastructure.

## Government-access strategy

Separate three categories:

### Open government data
No special status required. Prefer it aggressively.

Examples: NWS, FEMA, Census, EIA, BLS, USAspending, Grants.gov, EPA, USGS, NHTSA, NASA EONET/FIRMS, CISA KEV, NVD.

### Registered-but-public developer APIs
May require a free API key/account for rate management but no special government relationship.

Examples: NOAA CDO token, NVD API key, FIRMS MAP_KEY.

### Restricted government data
Requires a real program purpose, agreement, user consent, contract, federal relationship, ATO or other authorization depending on the system.

Examples include restricted VA APIs and many non-public operational government feeds. Do not model these as free “better data” simply because the owner/nonprofit/student/veteran has a relationship to government.

## Near-term provider budget recommendation

### Keep at $0 until needed
- NWS
- OpenFEMA
- USGS
- CISA KEV
- NVD
- EONET
- Census
- EIA where free registration/key suffices
- BLS
- FRED
- USAspending
- Grants.gov
- NHTSA
- Copernicus core access
- OSM/Overpass subject to responsible use/rate limits

### Keep under free caps / approved credits
- Google Maps / 3D Tiles
- Mapbox
- TomTom
- Cloudflare Worker usage

### Explicitly budget/cap
- OpenAI Realtime / model calls
- Supabase Pro when persistence reliability requires it
- commercial aircraft/traffic/maritime feeds if public/research terms do not authorize the product use
- satellite imagery beyond academic/open entitlements

## Procurement rule

For every new source, record before activation:

```text
source_key
provider
source_class
consumer_lane
credential_owner
license/terms URL
commercial use allowed? yes/no
public display allowed? yes/no
redistribution allowed? yes/no
persistence allowed? yes/no/limited
retention limit
free quota
paid rate
grant/credit program
renewal date
attribution requirement
fallback source
```

This turns “find free APIs” into a controlled FinOps/data-governance system rather than a pile of keys nobody remembers the terms for.
