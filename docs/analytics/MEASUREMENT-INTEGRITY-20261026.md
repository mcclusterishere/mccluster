# Measurement integrity repair checkpoints

Base: `396760eb72121e9673c6fc3df062f3af29660c10`. Reference: the owner's
37-page analytics architecture audit dated 2026-10-26 (Library
`libfile_cf2a1f808774819185ffa9344648e264`). This is implementation in a draft,
not a production rollout or a claim that current raw-to-lean data is missing.
The audited 56,774-row window had healthy parity.

## Checkpoint 1: defensible existing metrics

Audience Science v3 separates preview start/end reports from music_complete
reports. The historical completion ratio is null with an explicit unavailable
reason: these rows cannot identify paired eligible attempts. It no longer emits
`deep_listening`. Counts remain browser reports, not proven attention or payable
units. The dictionary version changes with this comparability break.

Page performance retains the SQL's legacy score for comparison, but labels its
volume weight, weighted action points, repeat-session proxy and exit-report
populations explicitly. Zero prior views cannot yield a percentage trend; absent
exit reports cannot yield a measured zero rate. No stored rows or SQL changed.

## Checkpoint 2: browser payload minimization and final-event delivery

The first-party collector boundary allowlists error diagnostics, clicks and copy
counts. It omits clicked/copied prose, removes URL queries/fragments/credentials,
scrubs recognizable emails/tokens and bounds nested custom properties. The exact
Autofill diagnostic signature and real application stack locations remain useful;
no error event or classification is suppressed. Unknown product event properties
still require purpose-by-purpose review; this does not certify arbitrary text as
anonymous. Tenant SDK and server collector enforcement remain separate work.

Events queued by later hidden/pagehide handlers now send with keepalive instead
of relying on a suspended timer. BFCache restoration resumes normal batching.
Existing consent, minimized recovery envelopes and stable retry IDs are preserved.
Synthetic transport tests cover redaction, genuine failures, fallback retries,
late lifecycle producers, BFCache and consent revocation. No observed leak is
claimed, and no production payload was fetched for these tests.

## Checkpoint 3: event-bound account evidence

Audience Science joins raw identity to lean behavior by event ID and device,
never by a later device login. Anonymous history stays device-only even when
only one account has been observed. Shared-device ambiguity remains visible;
conflicting identity evidence stays unknown. Profiles are not distinct people.

Signup Journeys v3 scopes every raw read to first-party rows. Only each event's
collector-verified uid can contribute account/music/source attribution. Client
signup context and anonymous or other-account history cannot establish a music
touch. The UI calls absent attribution unknown and excludes unknown sources
from known-source counts. This deliberately reduces speculative attribution;
it does not backfill missing signals. Owner checks and failed-read behavior stay.

## Checkpoint 4: shared browser-progress contract

Static discovery, Creator discovery and standalone World playback reuse one
adapter in the existing analytics loader. Starts follow `playing`, rejected
plays remain diagnostics, and preview endings stay separate from full endings.
Attempts carry a random ID, increasing event sequence, monotonic elapsed time,
validated played seconds, excluded gap duration and discontinuity count. The
existing transport still supplies a stable event ID through retries; server
`events.at` remains receipt time. No client timestamp is treated as server time.

Position deltas must agree with monotonic time and playback rate; paused,
seeking, frozen and buffering intervals add no seconds. Callback gaps above
2.5 seconds are explicitly unmeasured. Regular background playback counts;
muted playback is still browser progress, not proof of audibility or attention.
A new loop/selection/reload starts fresh; no missing history is reconstructed.
The old `music_complete.listened_seconds` wall-clock calculation is replaced.
Existing rows are not relabeled or backfilled.

This contract does not authorize a product qualification threshold, a statutory
royalty unit, an ad impression or a payment. The entitlement listen ledger,
album/Pocket legacy emitters and deliberately untracked embeds are not silently
migrated. Canonical ownership joins remain unknown without verified IDs.
The existing lean schema does not yet project attempt fields, so historical
completion rates remain unavailable rather than mixing incompatible producers.

Validation: 7 new adapter unit cases, 117 real Audio-element Music/World browser
checks (including 7 new measurement checks), and the existing 356 Analytics UI
checks across 11 sections at 390/820/1024/1440px with nested-pane assertions.
All browser data/audio/accounts are local fixtures; production was not accessed.

## Remaining work

- Replace latest-UID visitor attribution with event-bound account evidence and
  explicit ambiguous/unattributed history. The dormant v6 proposal below passes
  isolated SQL tests; detail/history consumers and deployment remain gated.
- Extend purpose-specific allowlists to remaining producers/tenant SDK and enforce
  at ingestion; add minimized occurrence metadata. Preserve current consent and
  intentional untracked embeds. Keep recovery outbox payloads minimal.
- Extend validated progress to album/Pocket and review entitlement heartbeat
  semantics separately. Server admission/projection and paired-attempt reporting
  remain pending; no qualified-listen threshold is activated.
- Server validation/projection and schema/taxonomy reconciliation with explicit
  pending SQL; isolated migration and tenant-deletion tests before approval.
- Observable projection failures, retention enforcement evidence, immutable
  tenant history, coverage/freshness and unknown joins.
- Canonical recording/artist relations require verified ownership evidence;
  no title-based creator mapping, historical invented signals, ad activation,
  royalty rule or payout allocation is authorized by this work.

## Checkpoint 5: dormant database proposals and dependency plan

`supabase/pending/analytics_visitor_event_identity_v6.sql` adds a new, unused
service-role-only invoker RPC. The isolated PostgreSQL test first reproduces
v5 assigning six shared-device events to the latest account, then verifies v6
partitions those events into anonymous/A/B buckets using each raw event UUID.
It preserves filter/search/pagination behavior, avoids double-counting paired
full-play reports as starts, scopes location search to the relevant bucket and
excludes tenant rows. It neither replaces v5 nor changes any row.

`supabase/pending/analytics_tenant_history_restrict_v1.sql` proposes changing the
existing raw-event site foreign key from SET NULL to RESTRICT. A site with
retained events then cannot be deleted until its retention/deletion workflow is
explicitly resolved. The fixture verifies a denied delete leaves both raw and
lean site IDs intact; applying the proposal twice is safe. No live delete was
attempted, and no current tenant-loss incident is claimed.

Activation order (requires exact approval; none performed):

1. Review the existing database objects and representative bounded query plans;
   these local tests establish semantics, not production latency.
2. Finish event-bound visitor-detail/session-history consumers. A shared session
   can span anonymous and several account buckets, so session membership sums
   are not distinct sessions or people. Do not point the Worker at v6 yet.
3. Review the tenant archive/deletion behavior, locking window and rollback.
   Never delete events merely to make a tenant deletion succeed.
4. Apply approved SQL transactionally through the established migration process;
   record exact live versions/bytes in the production ledger and drift contract.
5. Release compatible Worker/UI consumers, verify authenticated reads and compare
   raw/lean scope and completeness. Retention scheduling remains separately
   unverified; neither proposal activates a cron job or changes the 400-day policy.

CI runs these proposals only in isolated PostgreSQL/WASM with synthetic rows.

## Coordination and activation gates

Reviewed open #406 (cards), #410 (geo), #411 (artist ranks), #417 (precision
prototype), #541 (selection origin), and #638 (active self-service). None is
assumed deployed or merged wholesale. #417 needs corrected background/segment
semantics; #541 must preserve current privacy and client-outcome fixes.
Do not edit #638's branch or duplicate its Docket artist/profile ownership work.
Coordinate overlap in music-engine/World and canonical content through the parent.

The authenticated browser automation endpoint remains blocked by the previously
observed network restriction. No retry/bypass is part of this implementation.
No production DB/schema mutation, deployment, security-setting change or new
collection purpose is included. Future schema proposals remain pending until
exact approval; thresholds/short-track policy, rights and retention decisions
must not be invented as product facts.
