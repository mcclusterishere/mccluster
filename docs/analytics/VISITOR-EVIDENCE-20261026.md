# Visitor evidence and ingress minimization

This draft builds on PR #640 at `431da5bd385395672c208b3f294273f6f46e970f`; that green branch is unchanged. No production SQL, application release, retention deletion or historical rewriting is part of this work.

## Evidence and repair

The prior Worker discovered devices associated with an account, then queried every session on those devices. A shared device therefore transferred anonymous periods and other accounts' events into that account's history. A first/latest UID could also label an entire mixed session. The isolated PostgreSQL fixture reproduces the v5 defect before checking the repair.

The pending `analytics_visitor_list_v6` and `analytics_session_evidence_v6` join raw identity to the same projected event ID, constrained by tenant and device. Account buckets require the raw UID on each event. Device buckets contain only events without an attributed account. Missing identity joins stay visible as unknown evidence. A session may belong to multiple observed profiles; profiles and session memberships are not distinct people. No latest-device login is propagated backwards.

Visitor detail, history, session drilldown and lazy history now share that policy. Scoped session reads include only that account/device's raw events and matching aggregates. `View whole session` explicitly restores the complete session. Mixed sessions offer identity choices without loading a guessed account's history. Account profiles without history, missing/deleted evidence, raw/projection mismatch, truncated timelines, genuine backend failure and absent RPCs have distinct outcomes. Requests abandoned by back, close, filters, range changes or another scope cannot overwrite the current view.

The session RPC uses #640's existing `browser-start/v3` full-start vocabulary (`album_play`, `music_play`, `song_start`, `track_start`), exposes preview starts separately, and returns its metric version. These are browser reports, not proof of attention, qualified listening, earnings or payment. Account-creation track context is explicitly unverified. No approved Audience/Journeys metric definitions changed.

## Collector boundary

The existing Edge Function is the canonical writer for direct, Worker-proxied and verified tenant ingress. It now applies diagnostic/click/copy and playback property allowlists there, strips URL queries/fragments/credentials, scrubs common secrets/email patterns, bounds nesting/arrays/string sizes, and enforces UTF-8 property/device budgets. Stable event IDs, verified identity, verified tenant/host, artist/recording IDs and playback measurement fields remain separate. Valid diagnostics and actual application errors are preserved. The change is prospective; stored evidence is not rewritten.

Other custom events retain bounded, scrubbed properties rather than a full taxonomy allowlist. This is a minimization layer, not a claim that arbitrary free text or URL paths are anonymous. Full event-purpose contracts remain future work. Existing consent, GPC/DNT, cookieless and tenant denial gates are unchanged; deliberately untracked embeds remain untracked. No new telemetry purpose or payout path is introduced.

## Activation dependencies — pending exact authorization

1. Review this diff on top of #640; do not deploy its Worker alone. PRs #406, #410, #411 and #417 were reviewed. They contain adjacent reporting, geo and planned taxonomy/causal work; importing their whole branches would mix unrelated scope. This unit reuses the existing event, projection, owner gate, profile and consent structures.
2. Review bounded production query plans and index use for the two pending v6 RPCs, including a 180-day history window, mixed sessions, searched/paged lists and shared devices. Synthetic fixtures pass but cannot establish production performance. No production EXPLAIN or schema mutation was run for this unit.
3. After explicit SQL approval, apply the exact reviewed visitor and session RPC definitions under the repository's migration-ledger procedure. They are stable SECURITY INVOKER functions with PUBLIC/anon/authenticated execution revoked and service_role only. They write no rows and retain v5 functions. No new indexes, tenant deletion changes or retention jobs are activated here.
4. Verify deployed definitions/signatures and authorized owner-only reads, then release the compatible Worker/UI together. Missing RPCs return actionable `503 analytics_identity_schema_required`; malformed responses and projection mismatch remain failures, never empty-success or v5 fallbacks.
5. Deploy the separately reviewed collector change through its established release path; no collector deployment is performed by this draft. Rollback restores the prior compatible application/collector, then drops only the new RPCs if desired. The prior v5 application has the documented identity defect, so rollback must disclose that limitation.

## Verification

- Synthetic PGlite: reproduces v5 reassignment; verifies account/device/anonymous boundaries, visitor/history count parity, missing projection identity, tenant/date isolation, pagination, location search, invalid scope, role denial and invoker execution. Existing tenant restriction proposal tests remain dormant fixtures.
- Actual Worker routes: owner authorization, scoped raw reads and RPC parameters, mixed/capped sessions, missing evidence, empty known account history, backend/schema errors and malformed RPC responses.
- Actual collector handler: direct and verified tenant payloads, replay IDs, consent denial, cookieless/GPC/DNT, real errors and the exact Autofill diagnostic signature, URL/secret scrubbing, Unicode size budgets and inherited-property event names.
- Actual Control UI: scope changes and late history responses, retry/back/filter/range races. Chromium synthetic fixtures at 390, 820, 1024 and 1440px plus 320px nested panes verify profile-to-session scope, history, whole-session/back/close, seven readable metric cards, no horizontal overflow and screenshots.

These checks use fixtures. No authenticated live QA is claimed; the previously denied cloud browser operation was not retried. Production query plans, SQL activation and subsequent normal authenticated UI verification remain explicit release gates.
