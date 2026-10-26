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

## Remaining work, not implemented by checkpoint 1

- Replace latest-UID visitor attribution with event-bound account evidence and
  explicit ambiguous/unattributed history. Audience Science's existing ambiguity
  guard is retained/tested, but is not a repair of the Visitors RPC.
- Purpose-specific allowlists/scrubbing, lifecycle flush ordering and minimized
  replay/occurrence metadata. Preserve current consent and intentional untracked
  embeds. Do not restore rich payloads to the minimal recovery outbox.
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
