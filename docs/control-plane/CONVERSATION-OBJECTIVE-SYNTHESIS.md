# Conversation → Objective Synthesis

## Purpose

McCluster Core may turn already-authorized provider conversations into durable canonical objectives without treating every message as an instruction and without creating a second transcript store.

The canonical boundaries are:

- `ai_context` is the private source of truth for provider conversations and raw messages.
- `public.ops_objectives` is the canonical durable objective registry.
- `public.ops_agent_jobs` is the canonical durable execution queue.
- Public job rows carry conversation references and bounded provenance only. They do **not** carry raw transcript content.

## Flow

```text
provider conversation
        |
        v
POST /v1/ai/ingest
        |
        v
context-ingest
  ai_context.conversations/messages
  ai_context.ingestion_receipts
        |
        | receipt + conversation UUID only
        v
objective_synthesis job
        |
        | private server-to-server request
        v
context-core
  x-mccluster-context-token
  bounded ai_context read
        |
        v
OVH Core + local Ollama
        |
        v
deterministic synthesis policy
   ignore | create | update
        |
        v
public.ops_objectives
        |
        v
bounded objective_reflection
```

## Privacy boundary

`workers/mccluster/src/ai/objectives.js` deliberately enqueues only a reference object containing the provider, canonical conversation UUID, ingestion receipt ID, idempotency metadata, fingerprint, and optional source URL/timestamp. It never copies the message array into `ops_agent_jobs.input`.

The Core executor retrieves the bounded transcript only when the job is actually executing. `supabase/functions/context-core` reads the private `ai_context` schema and is authenticated with a dedicated `MCCLUSTER_CONTEXT_TOKEN`. That token belongs only to trusted server-side Core and the Edge Function secret store; it must not be exposed to browsers or the low-privilege coding agent.

The function requires both `org_id` and `conversation_id`, verifies the internal token, then returns at most the configured bounded number of messages/characters for that specific conversation. It does not provide public listing, free-form search, or cross-organization discovery.

## Retry and idempotency model

The Worker derives a deterministic synthesis job UUID from the canonical conversation/receipt fingerprint and inserts with an atomic conflict-ignore operation. Concurrent retries converge on the same job ID instead of creating duplicate synthesis jobs.

Before mutating an objective, the executor checkpoints the normalized model decision on the parent synthesis job. A retry therefore reuses the accepted decision instead of asking the model again.

A synthesized create receives a deterministic objective UUID derived from the synthesis job and source fingerprint. `createObjective` uses conflict-safe insertion and returns the already-existing canonical objective on retry.

The optional follow-up `objective_reflection` also receives a deterministic child job UUID. If reflection scheduling fails after the objective mutation, retrying synthesis reuses the same objective and the same reflection job instead of duplicating either.

## Deterministic policy

The model may suggest only:

- `ignore`
- `create`
- `update`

A create or update requires confidence `>= 0.72`. Updates may reference only IDs supplied from the current **active** canonical objective set. The executor does not permit synthesized completion/cancellation, direct code patches, deploys, merges, communications, spending, legal actions, auth changes, destructive data changes, or production mutations.

Model output is advisory until deterministic policy accepts it.

## Evidence and provenance

The executor may persist bounded metadata such as:

- provider
- conversation UUID
- ingestion receipt ID
- source fingerprint
- source URL
- observed timestamp
- message count / bounded character count
- model usage metadata
- confidence / rationale

Raw transcript text remains in `ai_context`; it is not copied into job output or objective provenance.

## Deployment requirements

Production activation requires the following to be configured before enabling `objective_synthesis` jobs on the live runner:

1. deploy `context-core`;
2. generate a strong random `MCCLUSTER_CONTEXT_TOKEN`;
3. set that token as a Supabase Edge Function secret and in root-owned `/etc/mccluster/core.env`;
4. never place the token in `agent.env` or a browser-facing Worker binding;
5. deploy the updated Worker `/v1/ai/ingest` handoff and Core runner;
6. prove a canary conversation can create exactly one synthesis job across repeated ingests and that `ops_agent_jobs.input` contains no raw messages.

Merging this code is not equivalent to performing those deployment steps.
