# McCluster Core tool broker

The Core tool broker gives local agents one normalized tool bus without making MCP itself the architecture.

## Interfaces

The broker listens on `127.0.0.1:4777` only.

- `GET /health` — broker and upstream discovery health.
- `GET /v1/tools` — normalized tool catalog for ordinary HTTP clients.
- `POST /v1/tools/call` — ordinary JSON/HTTP tool execution.
- `POST /mcp` — MCP `2026-07-28` `tools/list` and `tools/call` over the same registry.

Both interfaces call the same underlying tool definitions. Business logic must not be duplicated between MCP and REST.

## Built-in upstreams

Core ships with:

- remote MCP discovery against `https://api.mccluster.org/v1/media/mcp`, exposed locally with names such as `mccluster.media.models.search` and `mccluster.media.generate`;
- a plain HTTP health tool named `mccluster.health` against the canonical Worker.

The MCP media server remains the public edge implementation. Core is a client/broker, not a replacement Worker.

## Optional upstreams

Root may add approved remote MCP servers with `CORE_MCP_SERVERS_JSON` and approved HTTP tools with `CORE_HTTP_TOOLS_JSON` in `/etc/mccluster/core.env`.

Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback targets. Credentials are referenced by environment-variable name (`bearerEnv` or `headerEnv`) instead of being embedded in the registry JSON.

Example MCP registration:

```text
CORE_MCP_SERVERS_JSON=[{"id":"example","namespace":"example","url":"https://example.com/mcp","protocolVersion":"2026-07-28","bearerEnv":"EXAMPLE_TOKEN"}]
```

Example HTTP registration:

```text
CORE_HTTP_TOOLS_JSON=[{"name":"example.status","title":"Example status","inputSchema":{"type":"object","properties":{}},"request":{"method":"GET","url":"https://example.com/status"}}]
```

## Local authorization

Set `CORE_BROKER_TOKEN` to require `Authorization: Bearer ...` for `/v1/tools`, `/v1/tools/call`, and `/mcp`. `/health` remains available over loopback for systemd health checks.

Do not expose port 4777 publicly. Remote clients should continue to enter through the authenticated Cloudflare Worker at `api.mccluster.org`.

## Smoke tests

After installing `mccluster-core-tool-broker.service`:

```bash
curl -s http://127.0.0.1:4777/health | jq
curl -s http://127.0.0.1:4777/v1/tools | jq '.tools[] | {name,transport}'
```

The catalog should contain at minimum `mccluster.health` and the discovered `mccluster.media.*` MCP tools while the public media MCP endpoint is healthy.

To exercise the ordinary HTTP alternative:

```bash
curl -s http://127.0.0.1:4777/v1/tools/call \
  -H 'content-type: application/json' \
  --data '{"tool":"mccluster.health","arguments":{}}' | jq
```

To exercise Core as an MCP server/broker:

```bash
curl -s http://127.0.0.1:4777/mcp \
  -H 'content-type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq
```

## Security boundary

The broker runs as `mccluster-core`, not `mccluster-agent`. OpenCode therefore still receives no production Supabase, GitHub, Twilio, or upstream API credentials. Later agent access should be mediated through explicitly approved broker calls rather than by copying secrets into the model process.
