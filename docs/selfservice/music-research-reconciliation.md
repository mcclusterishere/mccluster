# Existing music research queue: local reconciliation

This is a local repair and bounded integration of #543 at `2d0b8da4e3dd`, following the private workspace handoff in `ed588f9e`. The old branch is unchanged. Nothing is applied, deployed, scheduled or executing a provider.

## Repaired implementation

`supabase/pending/music_research_pipeline_reconciled.sql` reconciles the complete existing SQL into one definition of each table/function/policy. It repairs the truncated idempotency expression, removes the duplicated function tail, preserves the intended daily creator cap and CPU/GPU resource routing, and uses one restrictive private-output policy. The daily cap is serialized per creator; an acknowledged identical retry still succeeds at the cap, while a different model/parent with the same key is refused. Failed expired jobs clear their lease tokens so the existing status/lease constraint does not prevent cleanup. Claiming rechecks current rights, track eligibility and prior-stage approval, including changes made after enqueue.

The existing owner, rights, commercial model, prior-stage review, service-only worker, fencing-token and private-artifact checks remain. Enqueue additionally requires explicit `p_consent=true`, records `consented_at`, and verifies positive master/collaborator attestations. Model selection alone is not consent. This adds a sixth optional argument to the original enqueue RPC; the pinned browser client's old five-argument call now fails closed until deliberately updated. The worker claim/heartbeat/finish/fail contract and queue name remain unchanged.

The artifact deliberately fails transactionally if the original five-argument enqueue overload already exists. A partly applied or independently deployed draft needs an inspected upgrade migration; do not assume the fresh-install artifact can upgrade unknown state. No old deployment state was modified or inferred.

## Bounded workspace integration

- `supabase/pending/music_workspace_research_bridge.sql` exposes `music_workspace_research_enqueue`. It requires explicit consent and a canonical creator-owned track joined to an authoritative **completed** workspace handoff, with matching private master path and provenance ID. It delegates to the repaired existing queue, which checks rights and prior-stage approval again.
- `workers/mccluster/src/music-workspace-research.js` mounts `POST /v1/music-workspace/analysis` through the existing workspace handler. It forwards the member JWT, never substitutes the service role as actor, bounds request size, validates input, preserves the caller's idempotency key and returns only an accepted job ID. It does not fetch media, execute models or claim jobs.
- Worker flag `MUSIC_WORKSPACE_RESEARCH_ENQUEUE_ENABLED` is **off when absent**; only the exact string `true` permits the RPC call. No config enables it in this change.
- SQL `music_research_capabilities.enqueue_enabled` and `execution_enabled` both initialize **false** and cannot be changed by authenticated members. Enabling enqueue does not enable claims. Execution gate applies to new claims; existing active jobs require explicit cancellation if an operator stops a previously enabled service.
- The integrated `music-research.html` review page now reads server-verified workspace state, exposes existing private review controls, and keeps requests disabled unless both configured enqueue gates allow them. The earlier pure `music-workspace-analysis.js` readiness preview remains conservative/disabled; it is not the authorization path. The actual queue bridge is guarded by database checks. This milestone does not introduce a new queue, runner or claim that customers can process audio live. See `music-research-review-ui.md` for fixture evidence.

## Evidence and limits

```sh
node --test scripts/test/music-research-sql.mjs scripts/test/music-workspace-research-worker.mjs
```

The full reconciled SQL and bridge execute in isolated PGlite fixtures, including function bodies called under authenticated/service roles. Coverage includes two non-admin creators, rights/collaborator consent, explicit analysis consent, completed handoff provenance, private output access, creator review, stage dependencies, daily limit and idempotency, service-only claiming, CPU/GPU routing, stale lease rejection, revoked-model cleanup, cancellation and default-off capabilities. Worker tests prove no network when disabled/invalid, member-JWT forwarding to the one existing queue RPC, same-key retry and no provider call.

PGMQ transport, canonical auth/identity/storage tables and media are fixtures. This is real PostgreSQL SQL/function/RLS execution, **not** a live Supabase or real PGMQ extension integration test. Current [PGMQ API documentation](https://pgmq.github.io/pgmq/api/sql/functions/) documents the four-argument JSON-filtered read used by the existing worker, but marks conditional filtering experimental. The target staging extension version/signature must be checked before applying. [Supabase's extension reference](https://supabase.com/docs/guides/queues/pgmq) is the deployment reference; fixtures do not prove its installed version.

## Exact remaining gates

1. **Engineering/staging verification pending:** inspect target schema state and PGMQ version; confirm filtered read compatibility, actual grants/RLS and canonical creator identities. Review the pending artifacts in dependency order: existing creator/workspace schema → private handoff → reconciled queue → workspace bridge. Convert to the approved migration ledger only after review. The original syntax defect is fixed locally; it is no longer an external blocker.
2. **Release/configuration authorization pending:** applying migrations, deploying the Worker and enabling enqueue are separate actions not performed here. The enqueue flags remain false. No real customer job should be created as a verification shortcut.
3. **Provider/model execution authorization pending:** keep SQL execution false and do not start the existing CPU/GPU worker. Before activation, review the existing manifest and SQL model approvals together, commercial rights and SHA-pinned checkpoints for separation/transcription, installed adapter executables and isolated resource limits, and private worker credentials. This change provisions no host, credentials or checkpoints and accepts no license. First-party analysis does not need a new third-party API account, but still needs an approved deployment/configuration and explicit creator consent. Third-party models are not implicitly authorized by that first-party option.
4. **Customer review UX integrated locally:** `music-research.html` now uses the completed-handoff state RPC and explicit consent bridge, retaining creator review and private artifacts. Its pending state migration and static UI still require the same staging/release checks. Provider output is never a publication instruction.
