# Private workspace → existing release review

Local implementation milestone, based on `0a92578a`; not deployed. No real media, account, release or provider operation was performed. This extends #629's private workspace, not a new DAW, publisher or analysis queue.

## Existing implementation boundaries reviewed

| Source | Reused contract / limitation |
| --- | --- |
| #629, `music-workspace.html`, `js/music-workspace.js`, `workers/mccluster/src/music-workspace.js`, pending `20261026009400_music_workspace.sql` | Project roles, immutable originals/credits, versions, owner release-ready selection and existing microphone capture. |
| #278, `create.html`, `js/create.js` | Existing social camera/file capture and playback trimming. Selecting a file starts its upload; therefore the workspace links to this tool with an explicit explanation and never passes private assets to it. It is not a rendered audio mix export. |
| #144, `creator.html`, `js/music-creator-studio.js`, `20260920041011_music_creator_platform_v1.sql` | Canonical private `creator-masters`, creator identity, rights attestations, `draft` → `pending_review`. The existing review/publishing boundary remains. |
| #541 at `e528b3609a84`, `js/resonance/upload-hook.mjs`, `scripts/research-engine/derive-stems-score.py` | Existing local resonance/score preview and rights-attested submission; no automatic provider execution added. |
| #543 at `2d0b8da4e3dd`, `js/music-research-queue.mjs`, `scripts/research-engine/music-job-worker.mjs`, `scripts/research-engine/model-adapters.mjs`, `supabase/pending/music_research_pipeline_v1.sql` | Existing enqueue, approved prior stage, reviewed model, private artifacts. The pinned SQL has a truncated enqueue expression and duplicated function tail. Its separate reconciled pending artifact now passes local SQL fixtures; see `music-research-reconciliation.md`. Activation remains disabled. Parsing the full pinned SQL in local PGlite failed with SQLSTATE `42601`, `syntax error at or near "then"`, position `21598`. Do not apply this pinned file or infer that its queue is working. |

See `RECONCILIATION-2026-10-26.md` for the original pinned reference ledger. Files above were inspected as implementation evidence, not release authorization.

## Implemented path

1. A workspace owner marks a version ready. Editors can supply credited originals but cannot transfer a release. The owner selects **one supported original**, not an automatically mixed arrangement; unsupported WebM/Ogg recordings must first be exported to WAV, MP3, FLAC or M4A through an appropriate existing/local editor.
2. Explicit transfer authorization is required. The user-JWT prepare RPC checks the current owner, ready version, membership of the original in that version, and active canonical creator identity. It snapshots all version credits/uploader IDs/checksums. It does not infer collaborator permission from editing access.
3. The Worker reads the immutable private original with the member JWT, checks byte count/checksum, and copies to a deterministic owner-scoped private master with overwrite disabled. Retry accepts only an identical existing copy. Reads are bounded to the original's declared size (at most 25 MiB).
4. Only the service-authorized finalization RPC can create the existing creator-owned track after copy verification. The track is private, `draft`, account access, rights `incomplete`. No rights attestation is generated. Retrying the same project/version/original returns the same track. The original and credit snapshot remain intact. A failed finalization can leave a private copy for retry; it does not delete source or overwrite a destination.
5. `creator.html?workspace_draft=<uuid>` uses the verified session, canonical identity filter and owner UID to retrieve the private draft. Only the configured Supabase private master origin is fetched. It fills the existing release form, carries original credits/provenance, and leaves rights checkboxes unchecked. Account changes prevent submission. The existing explicit preview/rights submission reuses the private master and submits to the existing release review; no second master upload or new publishing endpoint.
6. `music-workspace-analysis.js` is a **pure readiness contract**, not an active queue endpoint. It verifies creator ownership, explicit analysis consent, canonical rights attestation, prior-stage creator approval and model review, then always refuses enqueue/provider execution pending integration. No provider execution is enabled, even with all fixture gates satisfied.

## Local verification

Run:

```sh
node --test scripts/test/music-workspace-handoff-db.mjs scripts/test/music-workspace-handoff-worker.mjs scripts/test/music-workspace-handoff-browser.mjs scripts/test/music-workspace-db.mjs scripts/test/music-workspace-worker.mjs scripts/test/music-workspace-browser.mjs scripts/test/music-creator-page.test.mjs
```

- PGlite applies actual workspace SQL, new handoff SQL and the actual canonical creator-track guard with local schema/auth/storage fixtures. Two non-admin collaborators exercise editor denial, owner authorization, original credit preservation, private destination ownership, authenticated finalization denial, checksum denial, retry idempotency and revoked collaboration access.
- Worker fixture requests prove member-JWT private copying, no overwrite, checksum failure isolation, service-only finalization and no public-object request. Analysis fixtures retain explicit rights/prior-stage approval and always disable enqueue.
- Chromium runs the actual Creator Studio module with intercepted HTTP/storage fixtures: owner-only draft load, no upload on opening, fresh rights required, original provenance retained, preview-only transfer on explicit submission, existing `pending_review` path, foreign owner rejection and account-change rejection. This is not live Supabase/storage verification.
- Existing workspace recording/isolation and Creator Studio regression tests remain part of the command. No real media upload or publication is used by any new test.

## Remaining release gates

- **Pending, not applied:** review/apply workspace dependencies and `supabase/pending/music_workspace_release_handoff.sql` through the repository's approved migration ledger; verify canonical creator identity schema, private buckets/RLS, and function grants against the intended staging schema. This file deliberately is not a production timestamp migration. Local Supabase CLI scaffolding could not run because its home-cache directory `/home/agent/.supabase` was read-only; no remote action was attempted. Local SQL fixtures ran successfully.
- **Pending, not deployed:** release the Worker and UI together after staging validation. Current live production capability is not established by these tests.
- **Pending analysis activation:** the locally repairable #543 SQL defect is fixed in a separate reconciled pending artifact and its existing queue/stage approvals are tested. See `music-research-reconciliation.md` for the default-off bridge, staging extension verification, model/configuration review and separate deployment/provider authorization. No replacement queue is provided.
- **Existing rights boundary:** the owner must have actual rights and collaborator permissions, select a finished master, supply the desired preview and explicitly submit rights for existing release review. A transfer authorization does not clear rights or publish content. Existing social capture uploads remain a separate user action.
