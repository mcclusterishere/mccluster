# Conversation → Objective Synthesis

Status: autonomy v3 contract.

## Purpose

McCluster Core should learn durable owner objectives from conversations without treating every message as an instruction to execute.

This layer connects the existing private `ai_context` ingestion plane to canonical `public.ops_objectives` through a bounded, auditable synthesis job.

It does **not** create a new conversation database, event store, scheduler, or autonomous action surface.

## Flow

```text
provider conversation / event adapter
              |
              v
      POST /v1/ai/ingest
              |
              v
    ai_context context-ingest
   conversation + messages + receipt
              |
              v
     objective_synthesis job
       in ops_agent_jobs
              |
              v
       OVH McCluster Core
              |
      current objectives
          + messages
              |
              v
         local Ollama
              |
              v
 deterministic synthesis policy
      /        |        \
  ignore     create     update
              |          |
              +----+-----+
                   v
           public.ops_objectives
                   |
                   v
      bounded objective_reflection
                   |
                   v
          safe analysis / plans
```

## Canonical ownership

- Provider conversations remain authoritative in `ai_context`.
- Ingestion receipts remain the idempotency boundary for provider sync.
- Durable objectives remain authoritative in `public.ops_objectives`.
- Durable Core work remains authoritative in `public.ops_agent_jobs`.
- Objective provenance is stored in the existing objective `scope` JSON rather than a shadow lineage database.

## Ingestion handoff

`POST /v1/ai/ingest` keeps its existing context-ingestion contract.

After a successful context ingest, the Worker attempts to enqueue `objective_synthesis` unless the payload contains:

```json
{
  "synthesize_objectives": false
}
```

The synthesis handoff uses:

- the durable `conversation_id` from the ingestion receipt;
- provider and external conversation identifiers;
- the ingest idempotency key;
- source URL when supplied;
- a SHA-256 source fingerprint;
- at most the newest 40 messages;
- at most 96,000 characters total, with an individual message cap.

If context ingestion succeeds but synthesis enqueue fails, ingestion is not rolled back. The API response reports the synthesis error separately. Repeating the same idempotent ingest can retry the handoff.

## Dedupe

The Worker checks existing `objective_synthesis` jobs for the same canonical conversation target and source fingerprint before inserting another job.

A provider retry with the same ingest identity therefore does not manufacture another synthesis pass.

A later conversation sync with a new idempotency key gets a new fingerprint and may legitimately update the objective state.

## Synthesis policy

The local model may suggest only:

- `ignore`
- `create`
- `update`

The deterministic policy then enforces:

- confidence must be at least `0.72` for create/update;
- create/update requires a non-empty bounded objective name;
- priority is clamped to `0..100`;
- update may target only an objective ID included in the canonical objective set supplied to the model;
- unrecognized actions become `ignore`;
- model-supplied status, execution instructions, deploy flags, communication requests, and other extra fields are discarded.

## What counts as an objective

The synthesis prompt distinguishes a durable owner outcome from:

- a one-off factual question;
- casual brainstorming;
- a transient status update;
- an assistant recommendation the owner never adopted;
- an isolated research request with no sustained outcome.

It prefers updating an existing objective over creating a near-duplicate.

## Mutation boundary

Objective synthesis may create an objective with status `active` or patch an existing objective only when it is already `active`.

It may not autonomously:

- complete or cancel an objective;
- create a `code_patch` job;
- deploy or merge;
- send email, SMS, or social communications;
- spend money;
- take legal action;
- change authentication or authorization;
- perform destructive data changes;
- mutate production infrastructure.

## Provenance

Each synthesized objective retains source provenance under `scope.synthesis`, including recent source fingerprints, provider/conversation identifiers, confidence, reason, and the synthesis job ID.

Only the most recent bounded source set is retained in that objective field; full conversation history remains in `ai_context`.

## Reflection handoff

After a create/update, Core may enqueue one `objective_reflection` job for the objective when another reflection for that objective is not already queued/running.

This does not grant new execution authority. `objective_reflection` and dependency-aware planning retain their existing deterministic safe-job allowlists.

Set:

```json
{
  "schedule_reflection": false
}
```

on ingestion to synthesize/update the objective without triggering the reflection lane.

## Provider adapters

This contract is provider-independent. ChatGPT exports/connectors, Claude, Gmail, GitHub activity, calendar context, and future adapters should all normalize into the existing `/v1/ai/ingest` conversation contract instead of writing objectives directly.

Adapters are responsible for stable:

- `provider`
- `external_conversation_id`
- `idempotency_key`
- message IDs when available
- source timestamps
- source URLs when available

The synthesis engine is responsible for objective interpretation; adapters should not embed business logic for objective creation.

## Security

The existing `/v1/ai/*` owner authorization remains in force. Cross-org ingest is rejected before context ingestion or synthesis queueing.

Core continues to use backend-only Supabase credentials. No new browser credential or public unauthenticated endpoint is introduced.
