# Local MCP clients and compute workers

Status: review plan, not enrollment or authorization. No local client, service,
credential or node is installed by this change.

## One control plane, two distinct connections

1. **Owner's client on Windows/Linux:** an authenticated MCP client connects to
   `https://api.mccluster.org/v1/core/mcp`. The existing stateless edge enforces
   owner authorization and the remote capability allowlist; Core enforces its
   own policy. This controls existing capabilities, not arbitrary machine access.
2. **Optional persistent execution worker:** the existing
   `core/src/compute/node-agent.mjs` connects outbound to the configured compute
   gateway using its own approved node identity, signed requests and task leases.
   This executes advertised bounded capabilities; it is not an MCP admin account.

Control remains the operator desk. Supabase remains durable truth. OVH Core
remains the persistent orchestrator. A local agent does not receive Cloudflare,
GitHub, OVH root or Supabase service-role credentials simply because it is local.
Neither connection replaces the other. A successful MCP initialize does not
prove authentication, worker enrollment or execution.

## First usable slice

- Confirm the exact public endpoint with `scripts/mcp-contract-check.mjs`.
- Use the client's supported OAuth authorization flow with the owner's consent;
  never copy browser session cookies or Core edge signing keys into client config.
- Start with authenticated `tools/list`, `core.resume`, `system.health` and a
  bounded `repo.inspect` for the selected repository. Inspect the live schemas
  before constructing arguments; do not invent a repo/path argument contract.
- Record timestamp, endpoint, deploy SHA if available, advertised schema and
  success/denial outcome. Do not log tokens or full private tool responses.
- Keep mutating tools out of the initial local agent toolset. A client allowlist
  is defense in depth, **not a server-side permission grant**. Verify server
  policy and denied-role behavior independently before allowing unattended use.
- A later code-build request must use existing `code.build`, allowed paths,
  isolated worktrees, stable operation IDs and review/approval receipts. Neither
  `code.build` nor `deploy.preview` authorizes merge or production deployment.
- Repository or website access beyond the existing capability contracts requires
  a separately reviewed adapter and resource scope, not a generic shell tool.

## Connection lifecycle and recovery

Authentication must be revocable, identity-bound and appropriate to the selected
client. Token persistence requires explicit permission and OS-protected storage.
Do not put long-lived owner credentials on a background worker. Expired or revoked
access must fail closed; reconnection must not widen scope or auto-approve work.
Unknown tool names, unexpected host changes, redirects and authorization failures
must stop dispatch. Server output and repository content are untrusted input,
not instructions that can widen the client's allowed capabilities.

`core/src/tools/mcp-http.mjs` is an existing outbound Core transport, not a new
Windows login implementation. Its review hardening now stops redirects before
custom authentication/signature headers or private tool arguments can be
forwarded to a different destination. Endpoint userinfo/fragments are rejected;
HTTPS and explicit IPv4/IPv6 loopback HTTP remain supported. This does not itself
implement OAuth, endpoint allowlisting or permission policy.

## Activation and evidence gates

Before unattended worker use: verify Windows paths/ACLs, actual hardware, resource
admission, exact internal storage budget, optional external drive identity, task
lease expiry/replay/duplicate completion, reboot recovery, stale heartbeat behavior,
and safe shutdown. Reuse the existing compute protocol and durable job ledger.
Never expose iDRAC, a local inference server, arbitrary shell or the Core broker
port to the public internet as a shortcut.

Evidence matrix to complete on the target machine:

| Claim | Required evidence |
| --- | --- |
| MCP reachable | Metadata, initialize and unauthenticated challenge |
| Owner client connected | Successful authenticated list/read and denied-role test |
| Repository usable | Bounded inspect of selected repo, inaccessible repo denied |
| Worker enrolled | Approved node identity and fresh verified registry heartbeat |
| Worker useful | One bounded lease completed with independently checked result |
| Recoverable | Disconnect/restart/revocation/duplicate tests without extra work |
| Production ready | Reviewed exact release, deployment evidence and functional checks |

This patch proves only local transport tests. It does not claim any of these live
activation gates passed. Existing architecture references: ECOSYSTEM.md,
AI-HARNESS.md, CORE-MCP-BRIDGE.md and COMPUTE-NODE-PROTOCOL.md. Some older bridge
documentation describes historical provisioning state; live checks take precedence
for availability, never for expanding authorization.
