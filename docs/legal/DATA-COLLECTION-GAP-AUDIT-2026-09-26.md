# McCluster data collection gap audit — 2026-09-26

This audit compares the canonical McCluster web property, its first-party analytics collector, account intake, and the live Supabase schema.

## Current collection

### Account and identity
- Supabase Auth: email/password, verification state, auth identities and sessions.
- Canonical identity: `m_people`, auth-user links, platform profile, Mnet profile.
- `fan_profiles`: legal name, display name, postal address, phone, verification timestamps, birth year, marketing/share consent history, source and tier.
- `m_devices`: random first-party installation identifier, first/last seen, app/org context and bounded metadata.

### Device, network and traffic
- Random first-party device and session identifiers.
- Server-observed IP address and user agent.
- Edge/network signals when Cloudflare exposes them: country/region/city/postal approximation, edge latitude/longitude, timezone, ASN/network owner, colo/metro, protocol/TLS, RTT/delivery metadata, bot classification and client hints.
- Browser facts: screen/viewport, DPR, language, timezone, platform/mobile/touch, CPU core count/device-memory hints when exposed, network-quality hints, WebGPU/WASM/service-worker support, orientation, standalone/PWA state and related capability signals.
- Product behavior: page/route views, clicks, link/form events, scrolling/reading signals, selected public-copy events, errors/rejections and real-user performance metrics.
- Precise geolocation can record latitude/longitude, accuracy and device-supplied altitude/heading/speed only through the browser geolocation permission model.

## Live coverage snapshot

Snapshot taken 2026-09-26 from project `zmnhbrjyhxzhkxmhkexs`.

- Auth users: **77**; email-confirmed: **71**.
- Fan profiles: **3**.
- Fan profiles with a non-empty legal name: **1**.
- Fan profiles with a complete mailing address: **0**.
- Fan profiles with a phone: **1**.
- Fan profiles with birth year: **0**.
- M-device rows: **93**, representing **59** people.
- Events in the prior 30 days: **58,545**.
- Events with first-party device ID, IP and user agent: **49,169** each.
- Events with city, edge latitude/longitude and ASN: **46,327** each.
- Country column populated in the same window: **0**. The Worker now falls back to the incoming `CF-IPCountry` header when `request.cf.country` is unexpectedly absent; production should be re-measured after deployment.
- Events linked to a signed-in user: **6,826**.
- Precise-location events: **2**.

The principal gap is therefore account/profile completion and linkage, not raw telemetry volume.

## Gaps to close

1. Require legal first and last name in the canonical account-creation flow.
2. Require a complete mailing address before an account is considered swag-eligible.
3. Add conservative garbage-name screening plus server-side validation before it is ever treated as verification.
4. Version the site-entry privacy acknowledgement and keep it distinct from optional marketing/sharing consent and OS/browser sensitive-data permissions.
5. Give precise location an explicit purpose and use the normal browser permission prompt. An acknowledgement page cannot override that permission.
6. Increase signed-in event linkage so account activity can be understood without inventing a hardware fingerprint.
7. Add promotion rules and a deterministic auditable monthly swag-selection job before activating a random drawing.
8. Keep retention/deletion rules aligned with the privacy notice and the actual stored fields.

## Signals that are intentionally unavailable or excluded

A normal website cannot read a phone's IMEI, hardware serial number or MAC address. The web collector must not fabricate them or attempt circumvention. McCluster already uses a random first-party installation identifier instead. A future native app may use platform-approved app/vendor identifiers where available, but must still follow platform permission and privacy rules.

## Operating objective

Bridge every legitimate, technically available collection gap that has a defined product, security, fraud-prevention, analytics, fulfillment or compliance purpose. Do not collect a signal merely because it exists; do not claim hardware identifiers that the platform does not expose; and do not treat a blanket privacy acknowledgement as consent for separately protected data.
