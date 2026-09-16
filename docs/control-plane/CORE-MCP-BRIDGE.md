# McCluster Core remote MCP bridge

Status: implemented, not yet provisioned.

The path `MCCLUSTER-CORE.md` has always specified, now built:

```text
MCP client
  -> https://api.mccluster.org/v1/core/mcp     Cloudflare Worker `mccluster`
  -> https://core.mccluster.org                Cloudflare Tunnel
  -> http://127.0.0.1:4777/mcp                 Core tool broker on the OVH VPS
```

## Invariants

These are properties of the implementation, not deployment preferences. A
change that breaks one is a change to the contract.

| Invariant | Where it is enforced |
| --- | --- |
| Core binds to `127.0.0.1:4777` and nothing else | `core/src/tool-broker.mjs` throws at startup on a non-loopback `CORE_BROKER_HOST` |
| Port 4777 is never publicly reachable | No firewall rule is added; cloudflared dials outbound to Cloudflare |
| Cloudflare is the public authentication and policy edge | `workers/mccluster/src/entry.js` route; Core is not addressable directly |
| Owner authorization | `org_members … role=owner` on the McCluster house org, the same gate `/v1/ai` uses |
| Machine-to-machine signed authentication | `CORE_BROKER_TOKEN` **and** a per-request HMAC (`CORE_EDGE_SIGNING_KEY`) |
| Replay protection | timestamp window + nonce cache + body digest in `core/src/broker-edge-auth.mjs` |
| No generic shell or arbitrary command execution | No such capability is allowlisted; raw tool names are refused before dispatch |
| Normalized capability surface, no production credentials | Only stable capability ids are published; upstream diagnostics are stripped at the edge |
| Capability risk/approval semantics unchanged | Risk and approval travel in each tool's `_meta`; Core enforces them downstream exactly as before |

Both hops must pass. Owner authorization alone does not reach Core, and a valid
machine signature alone does not satisfy the owner gate.

## Remote capability allowlist

Core's tool bus also carries raw, provider-namespaced tools
(`mccluster.media.generate`, compute-node tools, whatever an upstream MCP server
advertises). Those are for local agents and on-host diagnostics. None of them
are reachable remotely.

The remote surface is an allowlist by construction, in
`workers/mccluster/src/core/mcp.js`. A capability added to Core's catalog is
**not** published remotely until it is named here in a reviewed edit.

| Capability | Risk | Approval |
| --- | --- | --- |
| `system.health` | read | none |
| `media.models.search` | read | none |
| `media.model.recommend` | read | none |
| `repo.inspect` | read | none |
| `image.generate` | spend | budget-gated |
| `video.generate` | spend | budget-gated |
| `audio.generate` | spend | budget-gated |
| `model3d.generate` | spend | budget-gated |
| `world.generate` | spend | budget-gated |
| `code.build` | write | review-required |
| `deploy.preview` | write | review-required |

Deliberately **not** allowlisted, though they exist in the catalog:
`media.generate`, `media.job.get`, `research.web`, `game.build`.

Listing a capability here means a remote owner may *ask*. It does not grant
spend or bypass review: budget-gated and review-required capabilities stay gated
in Core.

## MCP methods

| Method | Handling |
| --- | --- |
| `initialize` | answered at the edge; never reaches Core |
| `ping` | answered at the edge |
| `notifications/initialized` | accepted at the edge (202) |
| `tools/list` | forwarded, then filtered to the allowlist with diagnostics stripped |
| `tools/call` | allowlist checked **before** dispatch; a refused name never reaches Core |

Any other method is rejected with `-32601`. The route is not a general proxy.

## Provisioning

Nothing below is done. The bridge fails closed until it is: with
`CORE_BROKER_URL` or `CORE_BROKER_TOKEN` unset the route answers 503 and
dispatches nothing.

`CORE_BROKER_TOKEN` and `CORE_EDGE_SIGNING_KEY` are one pair of values that must
be **identical** in both places. Generate them with a CSPRNG (32 bytes, hex).

### 1. Cloudflare Worker `mccluster`

`CORE_BROKER_URL` is a plain var and belongs in `wrangler.toml` under `[vars]`:

```toml
CORE_BROKER_URL = "https://core.mccluster.org"
```

The other two are secrets and must never enter Git:

```bash
wrangler secret put CORE_BROKER_TOKEN
wrangler secret put CORE_EDGE_SIGNING_KEY
```

Optional: `CORE_BROKER_TIMEOUT_MS` (default 30000).

### 2. OVH `/etc/mccluster/core.env`

Same two values, root-owned and group-readable only by the runner:

```bash
CORE_BROKER_TOKEN=<same value as the Worker secret>
CORE_EDGE_SIGNING_KEY=<same value as the Worker secret>
```

The file stays `root:mccluster-core 0640`. Restart the broker after editing.

### 3. Cloudflare Tunnel

The tunnel is transport, not authorization. `core.mccluster.org` resolves
publicly; Core's own credentials are what protect it. Do not treat "it is behind
a tunnel" as a reason to relax either credential.

Do **not** open 4777 in the firewall. cloudflared holds an outbound connection,
so the VPS needs no inbound rule and no public listener.

Run as root on the VPS:

```bash
cloudflared tunnel login
cloudflared tunnel create mccluster-core
cloudflared tunnel route dns mccluster-core core.mccluster.org
```

`/etc/cloudflared/config.yml`, with the tunnel id from `tunnel create`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: core.mccluster.org
    service: http://127.0.0.1:4777
    originRequest:
      connectTimeout: 10s
  # Anything else is refused at the tunnel rather than reaching the host.
  - service: http_status:404
```

Then:

```bash
cloudflared service install
systemctl enable --now cloudflared
```

The single `ingress` entry is what keeps this narrow: only
`core.mccluster.org` maps to the broker, and every other hostname that reaches
the tunnel gets a 404 without touching the host. The firewall is left alone —
verify with `ss -ltnp | grep 4777`, which must show `127.0.0.1:4777` only.

## Acceptance criteria

| # | Check | How |
| --- | --- | --- |
| 1 | broker `/health` works locally | `curl -s localhost:4777/health` on the VPS |
| 2 | unsigned remote broker calls fail | signed-key configured, signature omitted → 401 |
| 3 | invalid bearer fails | wrong `CORE_BROKER_TOKEN` → 401 |
| 4 | valid signed request succeeds | correct bearer + fresh signature → 200 |
| 5 | replayed request fails | resend the same signed request → 409 `EDGE_REPLAY_DETECTED` |
| 6 | public `/v1/core/mcp` initializes | `initialize` → `protocolVersion` |
| 7 | owner `tools/list` returns the allowlist | 11 capabilities, no raw tools |
| 8 | `system.health` works remotely | `tools/call` → Core health |
| 9 | `model3d.generate` visible remotely | present in `tools/list` with `risk: spend`, provider may stay fal |
| 10 | no direct public access to 4777 | `nc -z -w5 15.204.235.103 4777` from off-host must fail |

Criteria 2–5 are covered by automated tests (`core/test/broker-edge-auth.test.mjs`,
verified against a running broker). Criteria 6–9 are covered at the edge by
`workers/mccluster/test/core-bridge.test.mjs` against a mocked Core, and need a
live re-run after provisioning. Criterion 10 can only be checked from off-host.
