# McCluster Console

Status: design + implementation contract
Branch: `product/mccluster-console-v1`
Parent: `selfhost/sovereign-media-fabric-v1`

## Purpose

McCluster Console is the owner operating environment for McCluster Core. It is not a branded chat widget and it is not a thin wrapper around a hosted LLM. It is the first-party interface for conversations, projects, memory, files, tools, assets, autonomous jobs, approvals, code, generation, and system state.

The public visitor chat ("The Desk") remains a separate product surface. The Console is authenticated owner/workspace software.

The invariant is:

> The Console talks to McCluster capabilities. Models and infrastructure are replaceable implementations.

A conversation must continue to exist if a model changes. A project must continue to exist if a database implementation changes. Memory must continue to exist if an embedding model changes. A tool name must continue to mean the same thing if its execution moves from OVH CPU to a rented GPU to owned hardware.

## Product goal

The Console should eventually subsume the disconnected back-office/admin surfaces into one coherent workspace. The owner should be able to open one application and:

- create and organize projects;
- maintain durable, branchable conversations;
- chat with local models and route selected tasks to specialist models;
- see exactly which memories, files, project instructions, tools, and assets are in context;
- invoke McCluster MCP/Core capabilities from conversation;
- create image, video, audio, 3D, world, code and preview jobs;
- leave long-running jobs running after the browser closes;
- resume work from another device;
- inspect tool calls and durable execution events without exposing hidden model chain-of-thought;
- approve or reject consequential actions;
- inspect budgets and sovereignty status;
- browse generated assets and provenance;
- attach repository branches, files, datasets and web research to projects;
- fork a conversation at any message and preserve both histories;
- switch between private owner workspaces and future team workspaces without mixing memory.

## Product surfaces

### 1. Workspace rail

Left rail:

- New conversation
- Search
- Projects
- Pinned conversations
- Recent conversations
- Agents
- Jobs
- Asset Vault
- Repositories
- System

Projects are durable context boundaries, not folders. A project owns its instructions, memories, files, repos, assets, budget policy, tool policy and conversations.

### 2. Conversation canvas

Center pane:

- streaming assistant output;
- markdown/code rendering;
- file and asset cards;
- image/video/audio/3D previews;
- tool-call status chips;
- background-job cards that continue updating after the model turn ends;
- branch/fork controls per message;
- regenerate from a chosen historical point without destroying the original branch;
- per-message provenance and source attachments;
- command palette / slash commands;
- multimodal composer;
- queued-send support when the local model or GPU worker is offline.

The conversation is a durable object in the data plane. It is not browser-local state.

### 3. Context Inspector

Right pane. This is a core differentiator.

Before a model call, the Console can show the exact context envelope assembled for that turn:

- system/workspace instructions;
- project instructions;
- active conversation window;
- conversation summary;
- pinned memories;
- retrieved semantic memories;
- attached files/chunks;
- tool result references;
- selected assets;
- token/character budget;
- selected model and routing reason.

Each source is inspectable and removable from the next turn. The product must never pretend "memory" is magic.

### 4. Memory Ledger

Memory is explicit, scoped, provenance-aware and editable.

Memory classes:

1. `pinned` — owner explicitly says this should persist.
2. `project` — durable facts/instructions relevant only to one project.
3. `conversation_summary` — compact summary used to keep long threads usable.
4. `semantic` — retrievable durable facts extracted from previous work, with source links and confidence.
5. `episodic` — notable completed jobs/decisions/results.
6. `working` — short-lived scratch state with expiration.

Every memory entry carries:

- id;
- workspace/project scope;
- text or structured payload;
- source conversation/message/job/file;
- created_at / updated_at;
- author (`owner`, `assistant`, `system`);
- confidence where extraction was automatic;
- pinned flag;
- expiry where appropriate;
- embedding revision where semantic retrieval is used;
- tombstone/deletion state.

The user can pin, edit, exclude and delete memories from the UI. Deleted memory must not remain silently retrievable from a vector index.

### 5. Execution Ledger

The Console should expose operational events, not private chain-of-thought.

For each turn/job show:

- model selected;
- model/runtime revision;
- start/end/duration;
- tool calls requested;
- tool result summaries;
- job ids;
- approval events;
- compute node;
- cost/compute accounting;
- asset ids;
- source commit where code executed;
- errors/retries;
- sovereignty classification.

This becomes the audit trail for autonomous work.

### 6. Artifacts

A conversation may open a persistent artifact beside the chat:

- source file;
- webpage preview;
- generated image;
- video timeline;
- GLB/3D viewer;
- audio player/waveform;
- code diff;
- document;
- data table;
- world/game build;
- self-hosted deploy preview.

Artifacts belong to projects and have versions. Messages refer to artifact versions rather than pasting giant payloads into conversation history.

### 7. Sovereignty bar

The application should make execution locality visible.

Example status:

`SOVEREIGN · Qwen3 8B · OVH Core · local tools · no metered inference`

or

`HYBRID · local planner · external specialist authorized for this turn`

A user must be able to enforce `local-only`/`sovereign-required` for an entire project or a single turn.

## Three planes

Do not build Console as one giant web application with business logic in the browser.

### A. Experience plane

Browser/PWA at `console.mccluster.org` (preferred) or `/console` behind the same origin.

Responsibilities:

- authentication/session UI;
- project/conversation navigation;
- optimistic message UI;
- SSE/WebSocket event subscription;
- Context Inspector;
- approvals;
- artifact viewers;
- no server secrets;
- no direct inference-provider keys;
- no direct execution against Core.

### B. Conversation/control plane

Owned backend service on OVH/Core, loopback bound and exposed through authenticated TLS edge.

Responsibilities:

- authorization;
- conversation CRUD;
- branch DAG;
- message append/idempotency;
- model routing;
- context assembly;
- memory retrieval;
- tool dispatch through Core capability registry;
- asynchronous run state;
- streaming event fanout;
- approval gates;
- job linkage;
- asset linkage;
- provenance.

Suggested internal service name: `mccluster-console-api`.

### C. Model/compute plane

Replaceable execution implementations:

- Ollama/Qwen on OVH today;
- larger local LLM on GPU node later;
- local image/video/audio/3D engines via McCluster Compute;
- optional external specialist implementations only when policy explicitly permits them.

The UI never calls Ollama directly.

## Reuse before rewrite

The repository already has useful primitives and they should be reused rather than creating parallel systems:

- Core normalized capability registry;
- MCP/tool broker;
- compute gateway/node protocol;
- existing local Ollama/OpenCode configuration;
- private `context-core` reads through `core/src/context-client.mjs`;
- existing Supabase auth while the data layer is still hosted;
- Asset Vault from Sovereign Media Fabric;
- objectives/jobs/approvals where compatible;
- self-hosted preview runtime.

The existing public `chat.html`/`deskchat-core.js` is NOT the Console. It is intentionally anonymous visitor messaging and should remain isolated from owner memory and tools.

## Initial data model

Names are contractual concepts; physical persistence may begin in existing Postgres and later move to self-hosted Postgres without changing the API.

### `console_workspaces`

- `id uuid pk`
- `org_id uuid not null`
- `name text`
- `slug text`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

### `console_projects`

- `id uuid pk`
- `workspace_id uuid`
- `name text`
- `description text`
- `instructions text`
- `sovereignty_mode text` (`required|prefer|off`)
- `default_model_route jsonb`
- `tool_policy jsonb`
- `budget_policy jsonb`
- `archived_at timestamptz null`
- timestamps

### `console_conversations`

- `id uuid pk`
- `workspace_id uuid`
- `project_id uuid null`
- `title text`
- `root_conversation_id uuid`
- `parent_conversation_id uuid null`
- `forked_from_message_id uuid null`
- `current_branch_key text`
- `summary text null`
- `summary_revision bigint`
- `archived_at timestamptz null`
- timestamps

### `console_messages`

Append-only logical event stream.

- `id uuid pk`
- `conversation_id uuid`
- `parent_message_id uuid null`
- `branch_key text`
- `role text` (`user|assistant|tool|system`)
- `content jsonb`
- `status text` (`queued|streaming|complete|failed|cancelled`)
- `model_route jsonb null`
- `run_id uuid null`
- `created_by uuid null`
- timestamps

Never destructively overwrite a completed message to implement regenerate/edit. Create a branch.

### `console_runs`

- `id uuid pk`
- `conversation_id uuid`
- `trigger_message_id uuid`
- `status`
- `requested_route jsonb`
- `resolved_route jsonb`
- `context_manifest jsonb`
- `started_at`
- `completed_at`
- `error jsonb null`
- `usage jsonb`
- `sovereignty jsonb`

### `console_run_events`

Append-only execution/event stream used for live UI and replay.

- `seq bigserial`
- `run_id uuid`
- `type text`
- `payload jsonb`
- `created_at`

Examples: `run.started`, `model.selected`, `token.delta`, `tool.requested`, `tool.started`, `tool.completed`, `job.queued`, `asset.created`, `approval.required`, `approval.resolved`, `run.completed`.

### `console_memories`

Fields described in Memory Ledger above. Semantic vectors should be an implementation detail; text/source identity remains canonical.

### `console_project_resources`

Links projects to repositories, files, assets, external references and future connected sources without copying their whole contents into project rows.

### `console_artifacts`

Versioned durable working objects. Binary payloads belong in the Asset Vault; the database stores identity, metadata and versions.

## Conversation branch model

Conversation history is a DAG, not a mutable list.

Editing an old user message or regenerating an assistant response creates a new branch key from that message. The original history remains addressable. This gives the Console true time travel instead of destructive regeneration.

The UI may present one active path at a time while preserving the graph underneath.

## Context assembly

A context envelope is built server-side for every model invocation.

Suggested order:

1. runtime/system policy;
2. workspace policy;
3. project instructions;
4. explicit turn instructions;
5. project pinned memories;
6. conversation pinned memories;
7. compact conversation summary;
8. semantic retrieval results constrained to the current scope;
9. selected file/resource chunks;
10. recent message window;
11. tool schema/capability hints relevant to the request.

The assembler records a `context_manifest` before dispatch. The model's hidden reasoning is not stored or exposed; source context and operational events are.

## Model router

Public model labels should be logical profiles, not vendor names:

- `fast-local`
- `deep-local`
- `code-local`
- `vision-local`
- `creative-local`
- `auto`

Today `fast-local` can resolve to the existing Qwen/Ollama runtime. Future GPU nodes can advertise stronger local models. Existing conversations do not change.

Routing inputs:

- project sovereignty policy;
- task classification;
- required modality;
- context size;
- model health;
- available hardware;
- latency target;
- budget;
- user override.

In `sovereign-required`, failure to find a compatible local implementation produces a waiting/unavailable state, never a silent hosted-model call.

## Tools

The assistant should not receive an unbounded universe of raw infrastructure methods. It receives McCluster capability tools based on workspace/project/turn policy.

Examples already present or planned:

- `system.health`
- `repo.inspect`
- `code.build`
- `deploy.preview`
- `image.generate`
- `video.generate`
- `audio.generate`
- `model3d.generate`
- `world.generate`
- `media.job.get`

Console adds owner-level navigation/control APIs but should not duplicate capability implementations.

## Async-first behavior

A model turn and a job are different lifetimes.

If a conversation starts a 20-minute render, closing the browser must not cancel it. The message links to a durable job/run. The Console reconnects to the run event stream later and renders the eventual asset result.

When the GPU is offline, generation jobs may remain queued while the local CPU model continues planning/coding/research work.

## API contract v1

External owner-authenticated endpoints, names illustrative:

- `GET /v1/console/bootstrap`
- `GET|POST /v1/console/projects`
- `GET|PATCH /v1/console/projects/:id`
- `GET|POST /v1/console/conversations`
- `GET /v1/console/conversations/:id`
- `POST /v1/console/conversations/:id/messages`
- `POST /v1/console/conversations/:id/fork`
- `POST /v1/console/runs/:id/cancel`
- `GET /v1/console/runs/:id/events` (SSE initially)
- `GET|POST|PATCH|DELETE /v1/console/memories`
- `GET /v1/console/jobs`
- `GET /v1/console/assets`
- `GET /v1/console/models`
- `GET /v1/console/capabilities`
- `POST /v1/console/approvals/:id`

Message submission should return immediately with durable message/run ids. Streaming arrives separately over SSE so browser reconnects are safe.

All mutating endpoints support idempotency keys.

## Authentication and authorization

Initial phase may reuse current authenticated user identity, but Console authorization is an explicit owner/workspace role check on every server endpoint.

No browser possession of a publishable/anon key is sufficient authorization for Core tools.

The Console API must never expose Core machine credentials, compute enrollment tokens, model secrets or provider credentials.

Future self-hosted auth should be an implementation swap behind the same owner/workspace identity contract.

## UI design direction

Do not clone ChatGPT visually. Borrow the proven information architecture and then exceed it.

Desktop layout:

`workspace rail | conversation | context/artifact inspector`

Mobile/iPad:

- conversation stays primary;
- left rail becomes a sheet;
- inspector becomes a second sheet;
- composer stays thumb-reachable;
- project/model/sovereignty state remains visible without consuming the screen.

Visual language should use McCluster's existing dark/material/ruby system, but the Console should feel denser and more operational than the public album/portfolio property.

## Features that make it materially better than a normal chat UI

1. Context Inspector — see and control exactly what the model will receive.
2. Memory Ledger — editable, sourced, scoped durable memory rather than opaque personalization.
3. Execution Ledger — replayable operational record of model/tool/job activity.
4. Branch DAG — true non-destructive conversation time travel.
5. Persistent Artifacts — code, 3D, video, documents and previews as first-class versioned objects.
6. Background autonomy — jobs outlive browser sessions.
7. Sovereignty enforcement — local-only is policy, not a promise.
8. Capability routing — conversations ask for `video.generate`, not a particular vendor.
9. Project operating system — instructions, repos, assets, agents, budgets and memories share one scope.
10. Inspectable orchestration — owner can see which model/node/tool handled work and why.
11. Local/offline degradation — when internet/external services are unavailable, the owned Core/local model remains useful.
12. One control surface — replace separate admin, chat, media-job, repo, asset and runtime dashboards over time.

## Non-goals / traps

- Do not fork the existing anonymous Desk chat into owner AI functionality.
- Do not store conversation truth only in browser localStorage.
- Do not call Ollama directly from the browser.
- Do not bind conversation ids to a model provider.
- Do not store giant binary assets in message rows.
- Do not treat embeddings as canonical memory.
- Do not implement regenerate by overwriting history.
- Do not put long-running inference inside the browser request lifetime.
- Do not make Supabase, Cloudflare or another SaaS part of the public Console contract. They may be current implementations while replacement seams are preserved.
- Do not expose hidden chain-of-thought; expose context, tool events, results and provenance instead.

## Implementation sequence

### Phase 0 — audit and contract

- inventory current `admin.html`, `chat.html`, `deskchat-core.js`, auth/session code, Core context, existing conversation/context tables/functions and AI endpoints;
- identify reusable schema and conflicts;
- write migration plan without breaking public Desk chat or current automation.

### Phase 1 — durable chat

- owner-authenticated Console shell;
- projects/conversations/messages/runs schema;
- create/list/search conversations;
- local Qwen streaming through server-side model router;
- durable SSE event log;
- resume after reload/device switch;
- basic project scope.

Acceptance: owner can chat with the local model from the website, reload, and see the same conversation.

### Phase 2 — memory + context inspector

- summaries;
- explicit pinned memory;
- semantic retrieval;
- Context Inspector manifest;
- editable memory UI;
- project-scoped retrieval tests;
- deletion/tombstone tests.

Acceptance: owner can inspect why a memory entered a turn, remove it, and prove it no longer retrieves.

### Phase 3 — Core tool use

- capability discovery;
- owner policy;
- tool dispatch;
- execution ledger;
- approvals;
- jobs survive browser disconnect;
- `media.job.get`/asset completion reflected into chat.

Acceptance: website conversation can ask Core for a repository inspection and a self-hosted preview; later the same surface returns sovereign 3D/video assets.

### Phase 4 — artifacts/projects

- file/project resources;
- artifact pane;
- code diffs;
- Asset Vault previews;
- GLB viewer;
- video/audio player;
- project repos and instructions;
- conversation branching UI.

### Phase 5 — autonomous workspace

- agents attached to projects;
- schedules/objectives;
- inbox of decisions/approvals;
- overnight/background work;
- owner morning summary;
- notification routing.

### Phase 6 — data-plane sovereignty

Replace hosted persistence/auth/edge implementations incrementally while preserving the Console API:

- self-hosted Postgres;
- self-hosted vector index/pgvector;
- self-hosted auth/session service or compatible identity layer;
- direct TLS/reverse-proxy fallback independent of Cloudflare;
- replication/backups/restore drills.

## Definition of done for v1

v1 is not done because a chat box renders.

It is done when the owner can:

1. sign into Console;
2. create a project;
3. start multiple durable conversations;
4. chat with the local model through McCluster Core;
5. reload and resume conversations;
6. search conversation history;
7. pin/edit/delete scoped memories;
8. inspect the exact context manifest for a turn;
9. invoke at least one Core read tool and one long-running job;
10. close the browser and later see the completed job;
11. view resulting McCluster-owned assets;
12. fork a conversation without losing the original;
13. inspect execution provenance;
14. enforce sovereign-required routing;
15. operate without any mandatory hosted LLM API.

## Naming

Working product name: **McCluster Console**.

Internal services should use boring descriptive names (`console-api`, `context-core`, `asset-vault`, `compute-gateway`) even if the consumer-facing experience later receives a more expressive name. Architecture should not depend on branding.
