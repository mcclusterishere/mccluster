# McCluster AI Harness

McCluster is the model-agnostic AI control plane for the company. Models are replaceable reasoning engines; McCluster owns memory, operational state, tools, policies, provenance, and approval gates.

## Canonical architecture

- GitHub `mcclusterishere/mccluster`: code, schemas, adapters, policies, tests, public-safe documentation, and audit history.
- Cloudflare Worker `mccluster` / `https://api.mccluster.org`: orchestration and provider routing layer.
- Supabase `zmnhbrjyhxzhkxmhkexs`: canonical private memory and operational data plane.
- OVH **McCluster Core**: persistent execution plane for the agent harness, schedulers, long-running agents, queue consumers, builds, controlled code execution, caches, and machine-level MCP tools. Core uses canonical Worker/Supabase contracts and owns no shadow memory or operational truth.
- Supabase private schema `ai_context`: raw AI conversations, normalized messages, durable memories, decisions, model runs, artifact links, sync cursors, context snapshots, and ingestion receipts.
- Existing `out_*` tables: outreach CRM.
- Existing `ops_*` tables: objectives, signals, lead scores, jobs, recommendations, and repo telemetry.

The public website must never read raw `ai_context` tables directly.

## Privacy boundary

Raw conversations, private reasoning artifacts supplied by providers, company-sensitive context, credentials, and unredacted context dumps MUST NOT be committed to this public repository.

The `ai_context` schema is private and is not a public website datastore. Anonymous and ordinary authenticated browser roles have no direct access. Server-side adapters, approved workers, and authenticated ingestion services are the only intended writers/readers.

Git may contain intentionally redacted or generated context summaries when useful, but never the raw private corpus by default.

## Ingestion contract

All providers normalize into one McCluster conversation shape before storage. Current ingress is the authenticated Supabase Edge Function `context-ingest`.

Required envelope:

```json
{
  "org_id": "uuid",
  "provider": "chatgpt | claude | grok | gemini | copilot | local | other",
  "account_label": "default",
  "adapter_version": "string",
  "external_conversation_id": "provider-specific-id",
  "title": "optional title",
  "source_url": "optional provider URL",
  "model_family": "optional family",
  "started_at": "optional ISO timestamp",
  "last_message_at": "optional ISO timestamp",
  "metadata": {},
  "idempotency_key": "stable unique sync key",
  "messages": [
    {
      "id": "optional provider message id",
      "role": "user | assistant | system | tool | other",
      "model": "optional exact model",
      "content": "message text",
      "occurred_at": "optional ISO timestamp",
      "ordinal": 0,
      "metadata": {}
    }
  ]
}
```

Ingress is idempotent. Payload and message hashes prevent accidental duplication. Every accepted conversation is queued for asynchronous enrichment.

## Memory model

Raw transcript is not the same thing as durable memory.

`ai_context.messages` preserves the normalized source record. `ai_context.memory_items` stores canonical facts, preferences, project state, constraints, relationships, and other durable context derived from one or more source messages. Every durable memory should preserve provenance, confidence, status, sensitivity, and freshness where applicable.

A later statement may supersede an earlier memory. Do not silently overwrite historical evidence. Canonical memory should point back to its sources.

`ai_context.context_snapshots` stores compact Markdown summaries for model context windows. Snapshots are generated views of the private corpus, not the source of truth.

## Retrieval

The private corpus supports:

- Postgres full-text search for lexical retrieval.
- pgvector semantic retrieval for embeddings.
- structured filters by provider, project, conversation, timestamp, subject, sensitivity, and artifact relationship.
- hybrid retrieval that combines durable memory, recent messages, CRM/ops state, and relevant repository context.

A model should receive the smallest sufficient context package, not the entire transcript archive on every request.

## Model adapters

Claude, ChatGPT, Grok, Gemini, Copilot, local models, and future providers are adapters. No provider owns canonical context.

Each adapter should be able to:

1. authenticate to the McCluster harness;
2. ingest its conversation transcript or event stream;
3. query approved context relevant to the current objective;
4. write model-run provenance and tool outcomes;
5. propose memories/decisions/objectives with sources;
6. use the same CRM and ops state as every other model.

Provider-specific conversation formats belong in adapters, not in the database core.

## Decision architecture

McCluster may autonomously research, classify, retrieve, summarize, score, reconcile, test, lint, monitor, draft, queue work, discover candidate objectives, and recommend actions.

Consequential actions remain policy-gated. External communications, production deploy/merge, spending money, destructive data changes, authentication/authorization changes, binding commitments, legal filings, and other high-impact actions require the applicable approval policy before execution.

Every company decision should be auditable through `ai_context.decisions`, including its status, rationale summary, risk class, provenance, and approval where required.

The long-term goal is not an unbounded model that silently runs the company. It is an auditable company operating system in which AI can take increasingly broad delegated actions inside explicit authority, budget, risk, and rollback boundaries.

## Autonomous loop

Target steady state:

1. ingest provider conversations and operational events;
2. normalize and deduplicate them;
3. enrich messages into searchable embeddings and candidate durable memories;
4. reconcile CRM, repo, calendar/email, project, and campaign state;
5. rank objectives and next-best actions;
6. run safe background work;
7. test outputs and detect anomalies;
8. request approval when an action crosses a policy boundary;
9. execute approved actions;
10. record outcome and feed it back into memory/scoring.

## Repo rule for every coding AI

Before building AI features, read this file plus `AGENTS.md` and the relevant model instruction file. Never create a shadow memory database, parallel CRM, competing source of orchestration truth, or raw-chat directory in public Git. This rule does **not** prohibit the registered McCluster Core execution plane. Persistent work that exceeds Worker limits belongs on Core, while its authoritative state remains in Supabase. Read `MCCLUSTER-CORE.md`.

When an adapter exists, use the canonical context plane. When one does not exist, implement an adapter that targets the canonical ingestion/retrieval contracts rather than inventing another memory system.
