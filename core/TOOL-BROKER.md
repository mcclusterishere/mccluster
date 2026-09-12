# McCluster Core Tool Broker

The Core broker is a loopback-only bridge between McCluster agents and normalized tools. It is deliberately not another public API or source of truth.

## Two layers

Core now exposes two related but distinct registries:

1. **Capability Registry** — stable McCluster intent such as `video.generate`, `model3d.generate`, `code.build`, or `system.health`.
2. **Tool Registry** — concrete executable implementations discovered from MCP servers or registered HTTP endpoints.

Normal products and agents should prefer capabilities. Raw tools remain available for diagnostics, expert operation, provider-specific controls, and building new bindings.

## Default upstreams

The broker currently discovers the canonical McCluster media MCP surface:

- `https://api.mccluster.org/v1/media/mcp`

and registers the canonical Worker health endpoint as an ordinary HTTP tool.

Additional MCP servers and HTTP tools may be registered through root-controlled environment JSON without giving credentials to the low-privilege OpenCode process.

## Local HTTP surface

The service binds to `127.0.0.1:4777` by default.

Health:

- `GET /health`

Capabilities:

- `GET /v1/capabilities`
- `POST /v1/capabilities/resolve`
- `POST /v1/capabilities/call`

Raw tools:

- `GET /v1/tools`
- `POST /v1/tools/call`

MCP:

- `POST /mcp`

A configured `CORE_BROKER_TOKEN` protects every route except `/health`.

## MCP behavior

`tools/list` returns two classes of tools:

- currently resolvable stable capabilities, under provider-independent names such as `system.health` and `media.generate`;
- namespaced raw implementation tools such as `mccluster.media.generate`.

`tools/call` checks the capability registry first. If the name is a capability, Core resolves the highest-priority available binding and delegates through the raw tool bus. Otherwise the name is treated as a raw tool.

The broker targets MCP `2026-07-28` and keeps the public edge separate: remote clients should still reach McCluster through `api.mccluster.org`, not port 4777.

## Provider-independent resolution

A capability binding carries:

- `capability`
- `provider`
- `tool`
- `transport`
- `status`
- `priority`
- `features`

Resolution keeps only active bindings whose underlying tools are discoverable, applies requested provider/transport/feature requirements, then selects the highest-priority result. Planned capabilities fail closed.

The v1 resolver is intentionally deterministic. The next evaluation layer will score implementations using measured quality, latency, cost, reliability, controls, and McCluster-specific acceptance data rather than marketing claims.

## Configuration

Raw MCP servers:

```text
CORE_MCP_SERVERS_JSON=[...]
```

Raw HTTP tools:

```text
CORE_HTTP_TOOLS_JSON=[...]
```

Additional stable capability definitions:

```text
CORE_CAPABILITIES_JSON=[...]
```

Additional bindings:

```text
CORE_CAPABILITY_BINDINGS_JSON=[...]
```

Secrets referenced by an MCP server's `bearerEnv` stay in `/etc/mccluster/core.env`; they are never copied into catalog JSON or exposed to `mccluster-agent`.

## Security boundary

- loopback bind only;
- `mccluster-core` owns upstream credentials;
- `mccluster-agent` / OpenCode receives no production API credentials;
- raw HTTP registration rejects unsafe non-HTTPS remote destinations except loopback;
- capability ids never contain provider credentials or secret material;
- a capability being declared does not authorize it; normal McCluster authorization, budgets, and approval policy remain downstream enforcement points.

See `docs/control-plane/CAPABILITY-REGISTRY.md` for the semantic contract.
