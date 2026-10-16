# Seek First ↔ Hitman's Halo: internal-to-external intelligence contract

Status: implementation contract for PR #411; no production route changes.

## Product boundaries
- **Seek First** is the owner-only internal investigation workspace. It reads McCluster-owned site and operational information from canonical, authorized analytics and evidence APIs. It does not host a replacement globe or fetch public-world providers.
- **Hitman's Halo** remains the complete application in `mcclusterishere/hitmans-halo`. Preserve its Cesium renderer, sensors, HUD, aircraft/cockpit, voice, and independent provider middleware. Do not copy its frontend into the Worker.
- **McCluster** remains the sole authorization, tenant isolation, provenance, audit and owner-data control plane. No second customer or payments database.
- Existing `/v1/seek-first/*` spatial API endpoints are legacy-compatible and must not be removed until consumers migrate. Its existing console stays available as a diagnostic surface, not the owner product homepage.

## Handoff v1
The client creates a context object with: version=1, investigation_id (opaque server identifier), start/end UTC, geographic viewport (optional), selected layer IDs, and only privacy-approved aggregate references. Never put session tokens, raw IPs, customer records, creator payout information, provider keys, or arbitrary URLs in a shareable link.

The owner workspace POSTs context to an authenticated server-side endpoint. The server checks the actor's immutable user ID, org membership, referenced resource authorization and aggregate disclosure threshold; stores a short-lived one-time handoff with expiry and audit entry; and returns an opaque handle.

Halo exchanges the handle over an authenticated, same-owner channel, reads a scoped summary and the authorized aggregate geographic overlay, then opens the original 3D runtime at the supplied viewport/time window. A failed/expired handle must fail closed and must not affect public Halo feeds.

The reverse direction saves a world observation as a sourced evidence reference linked to the original investigation. External correlations are *hypotheses*, not established causes.

## Deployment gates
1. Owner authentication and tenant isolation tests, including forbidden cross-org IDs and expired handles.
2. Preserve all Halo existing tests and verify original imagery/terrain fallback, flight, satellite, camera and sensor controls.
3. Seek First internal-only page must show actual owner data or a truthful empty/error state; never fabricate activity.
4. No regression to PR #411 financial authorization or refund reservation migrations.
5. No public access to owner analytics, provider keys, or internal spatial operations.
6. Do not redirect the production `/internal/seek-first` entry until a real owner-data workspace is tested.

## Data access
Seek First: canonical owner analytics, campaigns, sales summaries, creator metrics, evidence, authorized geographic aggregates.
Halo: its existing public/licensed external providers plus a *separate*, owner-gated, privacy-bounded overlay from the same McCluster data services. Avoid per-visitor geolocation.
