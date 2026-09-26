# McCluster Analytics Telemetry Gap Audit

**Audit date:** 2026-09-26  
**Authority:** `mcclusterishere/mccluster` + Supabase `zmnhbrjyhxzhkxmhkexs`  
**Scope:** first-party McCluster property, McCluster Insight collection path, account attribution, device/network/location telemetry, and what the Analytics UI actually exposes.

## Goal

Bridge every useful, technically available, purpose-appropriate gap between what the browser/edge can observe and what McCluster Analytics can query and explain.

That does **not** mean inventing fields a normal website cannot access, using fingerprints to defeat a cleared browser, or treating a site-level privacy acknowledgement as a substitute for an operating-system permission. The product should be exhaustive about real signals and explicit about boundaries.

## What production already holds

The source of truth is `public.events`. At audit time there were roughly 78.8k event rows. Collection coverage moves as traffic arrives, so these counts are a dated snapshot rather than constants.

| Signal | Production state at audit | Analytics UI before this pass |
| --- | ---: | --- |
| IP address | ~48.9k events | hidden |
| Random first-party device ID | ~48.9k | mostly hidden |
| Session ID | ~48.9k | mostly hidden |
| User agent | ~48.9k | hidden |
| City | ~46.1k | raw table queried it, UI barely exposed it |
| Region | ~45.9k | hidden |
| Postal code | ~45.2k | hidden |
| Edge latitude / longitude | ~46.1k | hidden |
| Timezone | ~46.1k | hidden |
| ASN | ~46.1k | hidden |
| ISP / network organization | ~46.1k | partially surfaced |
| Screen dimensions | ~49.0k | hidden |
| Viewport dimensions | ~49.0k | hidden |
| Device pixel ratio | ~49.0k | hidden |
| Platform / mobile hint | ~49.0k | hidden |
| CPU logical-thread count | ~49.0k | hidden |
| Device-memory bucket | ~28.7k | hidden |
| Touch-point count | ~46.4k | hidden |
| Browser network quality | ~46.4k | partially surfaced |
| Cloudflare colo | ~43.8k | hidden |
| HTTP protocol / TLS version | ~43.8k | hidden |
| Edge TCP RTT | ~43.8k | hidden |
| Precise-location events | 2 events | hidden |
| Country | **0 populated rows** | displayed as blank |

The country gap was a real pipeline defect: `request.cf.country` existed at the Worker but the reserved `CF-IPCountry` header did not survive the Worker-to-Supabase hop. This pass mirrors the observed country into `x-mcc-country` and teaches the collector to prefer that house-owned header.

## Account and music attribution

The system had both halves of the answer but not the relationship:

- Auth knew when an account was created.
- `public.events` knew which device/session played a song.
- Signed-in events carried a server-verified `uid`.
- No reporting surface joined the pre-signup device history to the later verified account identity.

Audit snapshot:

- 77 Auth accounts
- 71 confirmed
- 67 accounts already represented by at least one verified `events.uid`
- 7,174 events already linked to a verified account
- 6,086 music-start events in the measured history
- 4,835 of those music starts already carried a device ID

That is enough to reconstruct historical attribution for a meaningful share of accounts without pretending correlation is causation.

The owner analytics route added in this pass uses a **7-day pre-signup attribution window**:

- **last-touch track:** final track observed on the bridged device before account creation;
- **assisted tracks:** every track observed on that device during the attribution window;
- **source → track → account:** explicit relationship edges for graphing;
- elapsed minutes from final track to account creation;
- observed IP/network/location/device context for auditing the join.

The UI must call this *attribution*, never "proof that a song caused the signup."

## What is feasible but still needs a dedicated product decision

### Account identity and monthly swag

The existing `fan_profiles` table already has:

- legal name;
- mailing address fields;
- city / region / postal / country;
- phone;
- email-verification mirror;
- consent history.

Today those physical-mail fields are optional and are collected after account creation. The requested future contract is different:

1. dedicated first-name and last-name fields;
2. an account-completion gate that requires the mailing address before the account can use gated member features;
3. a documented monthly-swag eligibility state;
4. server-side anti-abuse checks rather than a JavaScript-only name check.

A "real-name detector" can reject obvious junk, placeholders, URLs, repeated garbage, and known test strings. It cannot prove that a name is a government identity. If legal identity proof becomes necessary, that is an identity-verification product, not a regex.

A monthly random giveaway also needs official promotion rules before the system selects winners: eligibility, prize description/value, drawing cadence, geographic restrictions, odds/disclosures, fulfillment, and a no-purchase requirement where applicable. Analytics should prepare eligibility data; it should not silently become the legal rules engine.

### Privacy acknowledgement gate

A mandatory site-entry acknowledgement is technically feasible and can be stored with a privacy-notice version.

The correct boundary is:

- do not create the persistent analytics device/session identifiers before the acknowledgement on a property configured to require it;
- always leave the Privacy Notice itself readable;
- continue honoring GPC / DNT independently;
- do not claim that "I agree" overrides browser or OS permissions;
- precise geolocation still requires the browser/OS permission state.

### Additional browser-exposed device facts

Browsers expose different amounts of device detail. Where supported, a browser may expose model/version/client-hint information. Those fields are optional and coverage will be browser-dependent.

Do not turn those attributes into a fingerprint designed to survive deletion of the first-party random device ID.

## What a normal website cannot collect

These are not "missing implementation"; they are unavailable or intentionally restricted platform identifiers:

- phone IMEI / MEID;
- device hardware serial number;
- SIM serial / IMSI;
- factory MAC address;
- arbitrary installed-app identifiers;
- another app's advertising/device identifier.

Modern Android restricts IMEI and serial to privileged/system, carrier, or specially managed-device cases. A normal browser page has no API for them. McCluster should use its resettable first-party random device ID plus authenticated M Account identity for web analytics.

## Visualization gap

Before this pass, the board had a time-series line but used magnitude bars for nearly every other question, including relationships.

Relationship questions should use relationship views:

- acquisition source → song → account;
- page → next page;
- track → account creation;
- later: creator → track → audience segment, campaign → content → conversion, and device/network condition → error/conversion where sample sizes are sufficient.

Bars remain appropriate for rankings and magnitude. Lines remain appropriate for time. Tables remain appropriate for exact forensic records.

## Access boundary

Raw identifying telemetry is not ordinary customer analytics.

- customer/property analytics: aggregate site-scoped reporting under existing tenancy rules;
- McCluster owner/operator analytics: capability-gated identity/forensics routes;
- no service-role key in the browser;
- no raw cross-tenant identity rows;
- raw IP, device/session identifiers and account joins remain owner/operator-only.

## Acceptance criteria for this pass

- country survives the Worker → collector hop;
- Analytics has an owner-only Identity section;
- source → song → account is rendered as a relationship flow;
- page → next-page paths are rendered as a relationship flow;
- account journeys show source, last-touch track, elapsed time, and observed network/location context;
- owner-only forensics exposes already-collected raw IP/location/network/device/session telemetry;
- normal property owners do not inherit the owner identity/forensics route;
- existing GPC/DNT and precise-geolocation permission boundaries remain intact;
- no attempt is made to collect IMEI, hardware serial, MAC address, or a fingerprint-derived replacement.
