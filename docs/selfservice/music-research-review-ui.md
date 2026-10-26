# Private research review UI integration

Local milestone from `a396e549`. No schema was applied, no remote records changed, and no model or provider executed.

## Reused path

`music-research.html`, `css/music-research-queue.css` and `js/music-research-queue.mjs` reconcile the existing #543 review prototype at `2d0b8da4e3dd` (`_unfinished/music-runtime/research-jobs.html` and the corresponding CSS/JS). The workspace now links to the review page. This preserves the existing stage history, creator approve/reject/cancel RPCs and short-lived private artifact signing. It adds no queue, runner or publishing action.

The review page fetches `GET /v1/music-workspace/analysis`. The Worker forwards the member JWT to new read-only `music_workspace_research_state()`. The SQL joins canonical creator tracks to authoritative **completed** handoff rows, checks both account and canonical creator ownership plus matching master path/provenance, and returns bounded owner-only recordings/jobs/artifacts and model metadata. Private master paths and service credentials are not returned. A `?track=` URL can select only an item already in this verified result; it cannot grant access or determine the owner.

Rights-incomplete handoffs remain visible for recovery but cannot be queued. `creator.html` is the linked path to complete release rights. Approved prior-stage jobs are required for the next stage. The existing SQL revalidates rights and stage approval at enqueue/claim; frontend state is not authorization.

## Consent, retry and availability

- Each request requires an unchecked-by-default explicit analysis consent checkbox. Changes to recording/stage/model and refreshed records clear consent. Requests send `consent:true` only through the existing workspace enqueue bridge. No direct five-argument prototype enqueue remains.
- Failed requests preserve their idempotency key and selection for retry. Accepted requests clear the consent/key. A retry acknowledgement is described as acceptance, not a claim that processing finished.
- Worker and database enqueue flags still default off. Read-only history and creator review remain accessible when enqueue is disabled. Execution has its separate existing default-off database gate; the UI distinguishes “cannot request” from “queued work will wait because processing is disabled.” No configuration is enabled by the UI.
- Unavailable schema/configuration clears stale private records and disables requests. Account changes clear records, consent and signed links; stale asynchronous results cannot populate another account's state.
- Artifact links are signed only after an explicit click with the current member session, expire in 120 seconds, and must resolve to the configured Supabase origin. There are no automatic master/artifact reads or uploads.

## Verification

```sh
node --test scripts/test/music-research-review-browser.mjs scripts/test/music-research-sql.mjs scripts/test/music-workspace-research-worker.mjs
```

Chromium runs the actual page/module/CSS with intercepted fixture endpoints at 390px and 1440px. Tests measure no horizontal overflow and cover foreign track selection, required fresh consent, same-key retries, creator approval before the next stage, unavailable/default-off configuration, account-switch cleanup, explicit private signing and hostile preview-origin rejection.

PGlite runs the actual new state RPC with the reconciled queue and bridge: two non-admin creators, completed handoff requirement, owner-only state, incomplete-rights eligibility and capability defaults. Worker tests verify user-JWT forwarding and that GET cannot turn an absent Worker enqueue flag on. PGMQ/auth/storage remain local fixtures; there is no claim of live Supabase verification.

## Pending release work

Add `supabase/pending/music_workspace_research_state.sql` after the existing handoff/queue/bridge dependencies in the reviewed migration ledger. Deploy the state RPC, Worker GET handler and page together after staging verification. Keep enqueue and execution disabled unless separately authorized. Existing PGMQ compatibility, model/worker configuration and release gates remain documented in `music-research-reconciliation.md`; this UI integration does not grant those permissions.
