# Authorization on the control plane

## The mistake this document exists to prevent

Three deployed functions — `outreach`, `social`, `ops-chat` — were set to
`verify_jwt = true`, then switched to the service-role key and did the work.
Nothing in between asked whether the caller was entitled to anything.

`verify_jwt` answers *"is this a real token for this project?"*. It does not
answer *"may this person send mail as this organisation?"*. Treating the
first as the second is the confused-deputy pattern: the function holds
authority the caller does not, and hands it over on request.

**How bad it actually was:** the publishable key — the one in the page
source of every McCluster site — passes `verify_jwt`. Verified by direct
request against the deployed functions on 2026-09-05. The bar was not
"any McCluster account"; it was "read the HTML".

## The rules

`supabase/functions/_shared/authz.ts` is the only place these are decided.

1. **Verify, don't decode.** A JWT payload is base64, not a signature.
   `ops-chat` read `sub` out of the payload for its audit trail; anyone can
   write a payload. `verifyCaller()` asks the issuer.
2. **The org comes from the resource.** Never the request body, never an
   environment variable. If the caller names the org, the caller picks
   their own tenant. `orgOfCampaign()` reads it off the row.
3. **The service key is not a person.** A function calling another with the
   service key means the far end executes on the platform's authority
   instead of a human's. That token is refused as an identity; callers
   forward the human's token and the human is authorized again downstream.
4. **Identity before resource.** Resolve who is asking, *then* the thing
   they asked about. The other order answers differently for a real id
   than a made-up one, which tells a stranger which ids exist.

## The role ladder

`org_members.role`, ordered:

| Role | May |
| --- | --- |
| `viewer` | read what the org already did |
| `staff` | change the org's own state — draft, build, queue, pause |
| `owner` | irreversible outward acts — send mail, publish, approve spend |

The line that matters is the last one. Everything above it can be undone by
someone having a bad morning. A sent email cannot.

| Function | Action | Needs |
| --- | --- | --- |
| `outreach` | `stats` | viewer |
| `outreach` | `build`, `pause` | staff |
| `outreach` | **`send`** | **owner** |
| `social` | `channels`, `stats` | viewer |
| `social` | `queue` | staff |
| `social` | **`dispatch`** | **owner** |
| `ops-chat` | any | staff |

## Approval is not a claim

`social` gated paid channels on whether `approved_by` was set — and read
that field **from the request body**. Writing a name into the JSON approved
your own spend.

`approved_by` is now the verified caller's id, written by the server, and
only when that caller is an `owner`. `p.approved_by` is ignored entirely.

A real approval is a server-generated fact about *actor + capability +
resource*. A string the caller supplies is a wish.

## What is still open

- **`ops-chat` checks `ANTHROPIC_API_KEY` before it authorizes**, so an
  unauthenticated caller learns whether that key is configured. Trivial, but
  it should authorize first. (The key is currently unset, so that function
  returns 503 to everyone regardless.)
- **No service actor exists.** Nothing may call these functions
  unattended — no cron, no CI, no automation — because every path now
  requires a human's token. If a drip sender is ever wanted, it needs a
  first-class machine actor with its own capabilities, not a shared key.
- **`operator_members` is still empty and still unused.** The concept
  exists; nothing reads it. `org_members` is the real membership table.
- **MCP is still not the command bus.** `mcp_calls` and `mcp_approvals`
  are both empty — the proposal/approval machinery in `0028_mcp.sql` has
  never been used. These fixes put authorization in front of three
  functions; they do not make MCP the mandatory choke point.

## Adding a privileged function

Import from `_shared/authz.ts`. Resolve the caller, then the resource, then
the role. Never reach for the service key before all three have happened,
and never accept an org id or an approver from the caller.
