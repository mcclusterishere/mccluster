# Conversation to Objective Synthesis

McCluster Core may derive durable objectives from authenticated conversations without treating every message as an execution command.

## Canonical flow

1. An authenticated provider adapter sends a conversation to `POST /v1/ai/ingest`.
2. `context-ingest` writes the raw conversation into the private `ai_context` schema and returns an immutable receipt.
3. The Worker queues one deterministic `objective_synthesis` job in `public.ops_agent_jobs` using only bounded references: provider, conversation id, receipt id, fingerprint, and observed time.
4. The public job never stores raw transcript content, source URL, external conversation id, or raw idempotency key.
5. OVH Core claims the job and calls the token-gated `context-core` Edge Function to read at most 40 messages / 96,000 characters from the referenced conversation.
6. The resident local model proposes only `ignore`, `create`, or `update`.
7. Deterministic policy rejects mutations below 0.72 confidence, rejects missing names, and permits updates only to active objective IDs supplied to the model.
8. Accepted creates/updates write the canonical `public.ops_objectives` record and preserve source fingerprints in objective scope for retry safety.
9. A deterministic follow-up `objective_reflection` job may be queued. Existing reflection/DAG safety policy continues to control unattended work.

## Authority boundaries

- `ai_context` is authoritative for raw provider conversations.
- `public.ops_objectives` is authoritative for durable owner objectives.
- `public.ops_agent_jobs` is authoritative for execution state.
- The model is advisory. Deterministic policy authorizes mutations.
- Objective synthesis may not complete/cancel objectives, merge/deploy code, communicate externally, spend money, change authentication, perform legal acts, or mutate production outside the objective registry.

## Privacy boundary

`context-core` is server-to-server only. It is configured with `verify_jwt = false` specifically because the OVH service may use a modern opaque Supabase secret key rather than a user JWT; access is instead protected by a dedicated `MCCLUSTER_CONTEXT_TOKEN`, compared by digest without early byte mismatch exit. The function also requires both organization ID and conversation UUID in every query.

The same token must be installed as a Supabase Edge Function secret and in root-owned `/etc/mccluster/core.env` on OVH. It must never be exposed to browsers or autonomous coding agents.

## Retry / duplicate behavior

Synthesis job IDs are deterministic from the immutable source fingerprint. Objective creation and reflection child IDs are also deterministic. Core checkpoints the accepted model decision before mutation so a transient failure after model inference does not produce a different decision on retry.

This path intentionally does not introduce a second memory database, workflow engine, or scheduler.
