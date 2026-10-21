# Analytics command deck

Implementation on the current Control Room and owner workspace, 16 October 2026.

## Interaction

Analytics occupies the available viewport above the existing application dock.
The Cesium globe and its country/state selection survive chapter changes. The
tabs, previous/next controls, horizontal touch gestures and arrow/Home/End keys
select the same chapter. The selected chapter owns its detailed vertical scroll;
the document does not become a stack of dashboards. Phone KPI cards use a
horizontal rail. Swiping a table, chart or KPI rail does not change chapters.

Views: Overview, Audience, Journeys, Content, Action & Business, World Intelligence,
Cameras, Adaptive, Site Health, Data Coverage and Setup. The full existing overview
remains under “All measured metrics & geographic coverage.” Existing operations,
commerce, publishing, identity and account workflows retain their native routes.

Refresh is explicit, with an optional 60-second refresh while Analytics is visible
and the operator is not editing. Provider snapshots and camera checks are not
automatically polled. This is refresh-based data delivery, not a streaming transport.

## Camera measurements

`GET /v1/analytics/cameras` requires verified McCluster house owner membership and
reads the existing Halo internal connection. It returns distinct camera IDs with
valid coordinates, per-provider counts/status/timestamps, retained stale records,
and duplicate/invalid exclusions. It does not expose provider URLs or credentials.

`POST /v1/analytics/cameras/check` accepts up to four camera IDs, never URLs. It
checks two frames concurrently through Halo's existing authoritative ID resolver.
Each request is timed out, redirects are refused, and image bodies are bounded.
Only upstream image responses with supported raster signatures reach the browser;
the browser must decode the image successfully before it contributes to
**Verified image feeds**. HTML errors, synthetic/Street View substitutes, broken
images and video-only feeds without snapshots do not contribute.

The camera screen displays catalog, verified, failed and unchecked counts, together
with check time and supplied capture time. “Verify all feeds” processes the current
catalog in bounded batches. Stop interrupts subsequent batches; hiding the page
pauses the run after its current batch. Verification can resume for unchecked IDs.
Checks are session measurements, cleared on catalog refresh/sign-out/session change.
Only the latest decoded preview is retained in browser memory. No durable health
history or continuous live-feed guarantee is implied by these checks.

The existing `HALO_INTERNAL_TOKEN` and optional `HALO_API_BASE` settings are reused.
No new Worker, database, auth mechanism, provider account or secret is introduced.
The member CCTV eligibility route remains unchanged.

## Coverage and scope

`GET /v1/analytics/coverage` is owner-only. It reads exact current counts for
headlines, publishers, missions, proofs, organization-scoped ingest records,
connectors and observability events. An unavailable count is null, never zero.
These all-time inventory counts are distinct from the selected analytics window.
The existing field directory remains schema metadata, not a row-count estimate.

Existing scope rules remain visible: geographic selection applies only to reads
that support it, mission states are all-time, and provider snapshots retain their
own timestamps. This change does not apply the pending country/region/evidence
migrations or claim that absent archives are populated.

## Validation and release

The browser harness uses clearly isolated synthetic API fixtures with the actual
Control page and Cesium renderer. It exercises 390, 820 and 1280-pixel layouts,
the owner workspace at 390 and 1180 pixels, touch/keyboard navigation, retained
globe state, bounded overflow, failed sources and decoded-image counts. Separate
workspace checks cover owner authorization, route changes, Halo isolation and
sign-out. Worker tests cover count normalization, media rejection and authorization.

Production catalog and image verification were not run from this development
environment: Halo UI initialization failed in its cloud browser and the catalog
URL was blocked there. After the reviewed frontend and canonical Worker are
released together, open Analytics → Cameras, load the catalog and run verification
to obtain the production measurement. Test fixture numbers are not deployment data.

Release follows the existing repository workflow. No production merge, deployment,
schema change or camera ingestion schedule is performed by this implementation.
