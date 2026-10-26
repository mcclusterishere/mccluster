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

## Remaining work

- Replace latest-UID visitor attribution with event-bound account evidence and
  explicit ambiguous/unattributed history. The account-evidence repairs above
  do not change the existing Visitors RPC; its replacement still needs isolated
  SQL validation and explicit activation approval.
- Extend purpose-specific allowlists to remaining producers/tenant SDK and enforce
  at ingestion; add minimized occurrence metadata. Preserve current consent and
  intentional untracked embeds. Keep recovery outbox payloads minimal.
- Shared progress adapter: attempts versus segments, monotonic sequence,
  same event IDs on retry, pause/seek/buffer/gap/background/loop coverage across
  existing players. Existing entitlement credit behavior must remain separate.
- Server validation/projection and schema/taxonomy reconciliation with explicit
  pending SQL; isolated migration and tenant-deletion tests before approval.
- Observable projection failures, retention enforcement evidence, immutable
  tenant history, coverage/freshness and unknown joins.
- Canonical recording/artist relations require verified ownership evidence;
  no title-based creator mapping, historical invented signals, ad activation,
  royalty rule or payout allocation is authorized by this work.

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
