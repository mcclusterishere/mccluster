# McCluster Capability Registry

Status: v1 foundation, 2026-09-12.

## Purpose

The Capability Registry is the stable contract between callers and implementations.

Callers ask McCluster for **what they want done** (`video.generate`, `model3d.generate`, `code.build`) rather than naming a provider, SDK, MCP server, model, or HTTP endpoint. Provider-specific tools remain replaceable implementations under those capability ids.

This prevents provider churn from leaking into the website, agents, workflows, or customer integrations.

## Capability vs. tool

A **capability** is a McCluster-owned semantic contract:

- stable id and description;
- provider-neutral input/output schemas;
- lifecycle (`active`, `planned`, `deprecated`);
- execution mode (`sync`, `async`, `either`);
- risk and approval class;
- supported interfaces (`http`, `mcp`, `agent`).

A **binding** points one capability at one implementation:

- provider/implementation id;
- normalized tool name;
- transport;
- health/discovery availability;
- priority;
- implementation features.

A **tool** is an executable endpoint discovered or registered by the Core tool bus. Tools can arrive over MCP, ordinary HTTP, or future local/native adapters. Raw tools remain visible for diagnostics and expert use, but normal products should call capabilities.

## Stable naming

Capability ids must describe intent, not vendors.

Good:

- `video.generate`
- `model3d.generate`
- `world.generate`
- `code.build`
- `research.web`
- `deploy.preview`

Bad:

- `minimax.video`
- `meshy.generate`
- `openai.code`
- `fal.image`

Provider names belong in bindings, not capability ids.

## Resolution

Resolution is intentionally separate from execution.

1. Read the requested capability.
2. Reject unknown, planned, disabled, or deprecated work when policy says it cannot execute.
3. Read the normalized tool snapshot.
4. Keep only active bindings whose underlying tools are currently discoverable.
5. Apply requested implementation requirements (provider, transport, feature flags, etc.).
6. Sort candidates by priority.
7. Return the winning binding plus alternatives.
8. On execution, call the winning tool through the existing tool bus.

The resolver does not pretend an unimplemented capability works. Planned capabilities are visible to product planning but fail closed at execution time.

## Interfaces

The loopback Core broker exposes the same registry through HTTP and MCP.

HTTP:

- `GET /v1/capabilities`
- `POST /v1/capabilities/resolve`
- `POST /v1/capabilities/call`

MCP:

- active/resolvable capabilities appear directly in `tools/list` under their stable capability ids;
- `tools/call` on a capability id resolves a binding and delegates to the normalized tool bus;
- provider-specific/raw tools remain namespaced (for example `mccluster.media.generate`).

Agents should normally use capability ids. This keeps prompts and durable workflows portable across provider changes.

## Current v1 catalog

The repository-controlled seed catalog lives at `core/capabilities/catalog.json`.

The first active bindings reuse the existing McCluster Worker and media MCP surface instead of inventing duplicate implementations. The catalog also declares planned contracts for image, video, audio, 3D, world generation, web research, repository inspection, coding, game building, and preview deployment.

Declaring a capability as planned does **not** authorize or implement it.

## Extension model

Root-controlled VPS configuration may add definitions and bindings through:

- `CORE_CAPABILITIES_JSON`
- `CORE_CAPABILITY_BINDINGS_JSON`

This is for controlled deployment-time additions. Long-term provider/model state and quality telemetry should be synchronized with the canonical Supabase control plane rather than becoming a second hidden registry on the VPS.

## Protocol research incorporated

MCP `2026-07-28` makes the capability layer easier to operate because remote calls are stateless, tool input/output schemas use JSON Schema 2020-12, and `tools/list` is cacheable. McCluster therefore keeps capability schemas provider-neutral and presents resolved capabilities as ordinary MCP tools while retaining HTTP access to the same runtime objects.

## What v1 deliberately does not do

V1 is the semantic registry and deterministic binding resolver. It does not yet claim to be the final quality router.

The next layer is the evaluation harness: implementations such as MiniMax, Veo, Runway, Meshy, Tripo, World Labs, Codex, Claude, Gemini, and local models should earn routing priority from measured task quality, controls, latency, cost, reliability, and McCluster-specific acceptance data.

Until an implementation passes that evaluation and receives an active binding, the corresponding specialized capability stays planned or unavailable.
