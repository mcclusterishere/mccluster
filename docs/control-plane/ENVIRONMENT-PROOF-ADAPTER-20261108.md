# Environmental proof adapter: local review

Status: local code and socket-free tests only. Nothing applied, uploaded, pushed,
published or deployed. This adds narrow wrappers on the canonical McCluster
Supabase action proof, assignment, review, points and feed mechanisms.

## Host integration

Import `createEnvironmentProofAdapter` and `ENVIRONMENT_PROOF_ERRORS` from
`workers/mccluster/src/environment-proofs.js`. Construct with `(request, env,
{fetchImpl})`. Invoke only after the existing installation module policy and
verified-principal gates, repeating the mutation policy gate before writes.
The adapter uses the incoming bearer authorization for every RPC. The API key
header is not substituted for user authorization. SQL checks identity and scope
again, including when called directly outside the Worker.

Methods:

- `read(context,{assignmentId})`: own environmental assignment only. Returns
  `assignment_id,status,mission_status,can_submit,can_share,share,post_id,proof_published,proof`.
  Proof is null or `proof_id,proof_revision,proof_type,proof_url,statement,status,review_note,
  reviewed_at`. `can_submit` describes canonical assignment/mission status,
  not a promise that any live-required or other installed proof gate permits it.
- `submit(context,{assignmentId,proof_type,statement,proof_url,share,consent})`:
  text/link only, statement 20–4000 characters, HTTPS links without credentials,
  explicit boolean share and consent true. Public sharing additionally requires
  statement + two newlines + optional URL to fit the canonical 2,000-character
  post cap; otherwise proof_too_long_for_sharing is returned without truncation. Returns canonical submission fields
  `proof_id,assignment_id,status,retry` plus share. No caller metadata, asset,
  location, identity, point award or verification is accepted.
- `share(context,{assignmentId,share,consent})`: explicit boolean; true requires
  consent true. Returns assignment_id,share,post_id,proof_published. False is a future-share
  preference, never deletion of an already published post. Display proof_published as
  already public even when the latest returned preference is false. A post_id
  alone confirms only a canonical card, not publication of the actual proof.
- `list(context)`: house-owner only SQL wrapper, returns proofs and limited.
  Each row has proof_id,proof_revision,assignment_id,mission_id,title,proof_type,proof_url,
  statement,status,review_note,created_at. Maximum 200 proofs: pending first (oldest first), then reviewed newest first.
  pending_remaining and total_remaining disclose overflow. Reviewing pending
  items and refreshing exposes the next oldest work.
- `review(context,{proofId,decision,expected_revision,review_note})`: house-owner check plus existing
  canonical `eu_is_admin()` check, no inferred privilege/grant. Canonical
  verified/rejected decisions only, note <=2000 characters. A mandatory
  expected_revision is the 32-lowercase-hex proof_revision from the displayed
  read/list row. The wrapper locks assignment then proof in canonical order and
  compares the current row before calling canonical review. A stale decision
  fails with proof_changed and must be reloaded/reviewed, never automatically
  retried with a new revision. Missing/malformed revision fails invalid_proof. Returns the
  canonical proof_id,assignment_id,status and award/idempotency fields.

Errors carry `.code`. Allow only `ENVIRONMENT_PROOF_ERRORS`; unknown failures
remain persistence_unavailable. Live-required rejection is
proof_requires_live_capture; the text/link feature never activates recording.
Host must bound incoming JSON bodies, mark all responses private/no-store, and
sanitize/validate returned shapes before rendering. Render proof statements and
notes as text, never HTML. Link rendering must allow HTTPS only.

## Database review and RPC registry

Pending file `supabase/pending/20261108120000_world_environment_proofs_v1.sql`
requires canonical action migrations (including latest 20261004015451 retry
migration), feed-share migration, and pending world_environment_v1. Review and
explicit release authorization are still required. Do not run it automatically.
It creates no parallel tables and does not replace canonical proof/review paths.
Two nullable fields on action_share_intents bind exact environmental proof
consent and record successful publication. Existing/legacy intents remain NULL.
An environmental-only trigger runs after canonical card creation on verification
and enriches that same post with only the exact verified statement and optional
HTTPS URL. It never includes review notes, identity details or private metadata.
It does not change nonenvironmental cards. No consent is inferred from generic
legacy share=true. Failed enrichment is caught so verification/points survive;
explicit consented share can retry. The published snapshot remains on opt-out,
but future consent is cleared. proof_published additionally checks the actual
post body, author, public visibility and absence of deletion/moderation. It is
false for a bare card, failed enrichment, or an edited/deleted/private post.
Submission calls canonical submit and share-intent in one transaction under the
assignment lock, preserving rejected-proof retry history and resetting stale
share preferences to the explicit new choice. Failed submission rolls back both.

Add reviewed live-callers registry entries for this adapter to:

- world_environment_proof_read(p_assignment)
- world_environment_proof_submit(p_assignment,p_proof_type,p_statement,p_proof_url,p_share,p_consent)
- world_environment_proof_share(p_assignment,p_share,p_consent)
- world_environment_proofs()
- world_environment_proof_review(p_proof,p_decision,p_expected_revision,p_review_note)

The canonical published-share function is `share_verified_action`, not
`action_share_verified`. Canonical verification triggers honor explicit sharing;
a failed trigger publication does not undo verification. A member can retry
sharing after verification. Review, notification, points and feed idempotency
stay in the existing functions and tables.

## Verification

`node --test workers/mccluster/test/environment-proofs.test.mjs`: 8 passing.

`node scripts/test-environment-proofs-pglite.mjs`: passing against the existing
PGlite runtime at /tmp/owner-postgres-tools. Exercises canonical migrations,
read/submit/share/list/review denial for wrong roles, explicit consent, rollback
of failed choices, rejected retry/history, notifications, immutable verified
proofs, exactly-once points, automatic opted-in publication, idempotent explicit
sharing, false without post deletion, and the real live-required trigger. Also verifies exact opted-in proof
publication, legacy/opt-out privacy, replacement-consent binding, post-edit
detection, failed enrichment/card creation with recovery, the current 2,000
character public post cap, and untouched nonenvironmental sharing. The harness
loads the latest camera-loop canonical sharing implementation and the latest
retry/review functions, not just the original share-card function.

PGlite is sequential, socket-free validation. Native concurrent locking,
production schema compatibility, deployment, and integrated UI require separate
checks. No production readiness claim is made by this focused suite.


## Approved release order and suspension

These files are pending review artifacts, never automatically executed. Before
any production action, obtain explicit release approval and verify the deployed
canonical schema, existing grants, function owners and triggers. Apply canonical
action/feed/camera/retry prerequisites first, then world_environment_v1, then
20261108120000_world_environment_proofs_v1.sql. Review RPC registry and host/UI
compatibility before enabling consumer access. No new service-role permission
is needed: the Worker calls wrappers using the member's verified bearer.

The paired `.rollback.sql` is a suspension script, not an unpublish migration.
It removes only the environmental enrichment trigger and revokes EXECUTE on this
extension's wrappers/helpers from PUBLIC, anon, authenticated and service_role.
It leaves canonical proof/review/share mechanisms, posts, points, consent and
publication receipts intact. Existing public proof remains public. The database
owner/superuser still has ownership authority; this is not an owner lockout.

For separately approved recovery, inspect retained state and restore only the
reviewed trigger and five authenticated wrapper grants from the forward file.
Do not rerun its non-idempotent ADD COLUMN statements, bulk publish missed work,
or interpret historical receipts as new consent. Members can explicitly retry
sharing after restoration. No recovery is run automatically.

The disposable PGlite rehearsal additionally verifies helper denial for anon,
authenticated and service_role; suspension of all five wrappers; unchanged
proof/post/point/receipt counts; retained consent snapshots; continued canonical
sharing; and removal only of the environmental publication trigger.


Review revisions are optimistic concurrency tokens, not credentials. The digest
is MD5 over the complete canonical proof row serialized with UTC timestamps,
including proof ID, assignment/user, evidence, metadata, status, created_at,
reviewed_at and reviewer fields. Even rejected-to-same-content retries invalidate
the old token. The private pure revision helper has no public/member/service
EXECUTE grant. The old three-argument wrapper overload is explicitly removed;
registry and suspension now use world_environment_proof_review(uuid,text,text,text).
PGlite tests replace evidence under the same proof ID, reject stale approval
without awards/publication, reject the old revision after identical-text retry,
accept a reloaded revision, and retain owner/self-review restrictions. Native
concurrent interleavings remain untested; canonical lock order is preserved.
