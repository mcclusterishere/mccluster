# Music Control Room — measurement contract (v1)

## Current status
Client-side instrumentation added to `js/music-engine.js` on the feature branch. Backend ingestion, persisted aggregates, dashboards, QA and production deployment remain unimplemented. Do not represent sample or unverified data as real listening metrics.

## Event contract
`music_listen_start`, `music_listen_checkpoint`, `music_listen_end`. Common fields: `playback_id` (ephemeral session), `track`, `album_slug`, `creator_track_id` where available, `access_state`, `position_seconds`, `duration_seconds`, `listened_seconds`, `preview`. Checkpoint/end include `covered_buckets` (five-second position buckets); end includes `reason` and `seek_count`.

## Server implementation requirements
1. Explicit allowlist and schema validation of events at existing analytics ingress. Reject unknown names, malformed UUIDs, negative durations, nonfinite values, unreasonable position/duration, oversized buckets, oversized payloads. Authenticate where available, rate-limit and dedupe by playback ID + monotonic sequence; never trust claimed listens for ad billing.
2. Server-verified media grants and delivery receipts for any financially relevant play; client telemetry is observational only. Ad impressions need separate verifiable ad-server events.
3. Retain raw event data for a defined short period; produce privacy-preserving daily aggregates per track, room and campaign. Enforce owner-only Control access; never expose device-level or applicant biometric data in public API.
4. Listening-time metrics: sum observed forward media-clock deltas excluding seeks, pauses and background gaps. Distinguish **total listened** (replays included) from **unique timeline coverage** (deduped five-second buckets). A 30-second song replayed twice is 60 seconds listened but only 30 seconds unique coverage.
5. Dashboard per song: starts, qualified starts, unique approximate listeners, average/median listened seconds, percent duration listened, full completions, replay rate, seek heatmap, five-second retention, room 1/2/3 engagement, exits, source campaign, preview-to-application conversion, ad eligible opportunities, verified ad impressions and gross/net revenue. Expose denominator, sampling, confidence and missing-data warnings.
6. Accurate retention requires interval overlap and deduplication on the server. Five-second buckets currently indicate observed coverage, not verified uninterrupted audio. Do not call them precise audible exposure.
7. QA matrix: seek forward/backward, rapid play/pause, hidden tab, locked screen, stalled stream, reload, network offline, repeat same song, autoplay block, concurrent tabs, anonymous vs member, preview expiry, signed-in full access. Check both iOS Safari and desktop browsers.
8. Migration and CI: version analytics event schema and aggregate query, prove existing Control forensics and Stripe reporting remain unchanged; validate RLS and owner gating.

## Important existing-client limitations to resolve before release
- Pauses and stalls currently close a measurement segment; a resume begins a new playback ID. Aggregate multiple segments as one visit when appropriate.
- The current client-side timer excludes hidden-page intervals, including legitimate background audio. Use media element state and carefully tested page lifecycle handling to distinguish background playback from suspension.
- `music_complete` existing event remains wall-clock-based and must not be relabeled as actual listening time.
- `js/music-engine.js` is one of several playback paths; audit `album.html`, native audio elements, `js/label.js`, and other players before claiming catalog-wide coverage.
- Ensure frontend event transport allows the new names and persists them before claiming dashboard coverage.
