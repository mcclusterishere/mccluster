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

## Capabilities, not a hardcoded ladder

The first fix used a three-rung ladder — `viewer < staff < owner` — written
into `authz.ts`. It worked and it was the wrong shape, because the database
already contained a better answer that nothing had ever read:

| Table | What it is | Rows |
| --- | --- | --- |
| `control_capabilities` | the vocabulary of privileged acts, graded by risk | 18 |
| `control_role_capabilities` | which role holds which capability | 63 |
| `control_commands` | a privileged act that was actually attempted | — |
| `control_audit` | every decision, allow and deny | — |

`authz.ts` now reads the first two. The consequence that matters: **changing
who may send mail as an organisation is an `UPDATE`, not a redeploy.**

### The bug that had to be fixed first

The two tables did not speak the same role vocabulary:

```
org_members.role                CHECK (role IN ('owner','staff','viewer'))
control_role_capabilities.role  owner, admin, staff, member
```

`viewer` — a role the system can actually issue, and the default for anyone
invited without elevation — held **zero** capabilities. `admin` and `member`
held 21 between them and can never appear in `org_members` at all.

Joining membership to capabilities without noticing would have silently
locked every viewer out of everything, and looked like a permissions bug in
a hundred places. `0059_capability_role_reconciliation.sql` fixes it
additively and raises if any issuable role is left with no capability.

`admin` and `member` are deliberately left in place and deliberately left
unreachable — see that migration for why.

### What each action requires

| Function | Action | Capability | Risk |
| --- | --- | --- | --- |
| `outreach` | `stats` | `campaign.read` | low |
| `outreach` | `build` | `campaign.prepare` | medium |
| `outreach` | `pause` | `campaign.pause` | medium |
| `outreach` | **`send`** | **`campaign.send`** | **high** |
| `social` | `channels`, `stats` | `social.read` | low |
| `social` | `queue` | `social.queue` | medium |
| `social` | **`dispatch`** | **`social.publish`** | **high** |
| `ops-chat` | any | `ops.use` | medium |

The line that matters is the high one. Everything above it can be undone by
someone having a bad morning. A sent email cannot.

## The audit trail

Every decision lands in `control_audit` — `authz.allow` and `authz.deny`
alike. A refusal is a fact worth keeping; it is the only trace a probe
leaves. An absent grant and an explicit `allowed = false` are recorded
differently, because "never granted" and "taken away" mean different things
to whoever reads the trail later.

The two **high**-risk acts additionally open a `control_commands` row
*before* they run, so an act that dies mid-flight still says who started it.
Status values are the four that table's CHECK constraint permits:

```
allowed  → the act is authorized and starting
executed → it finished
failed   → it threw
denied   → reserved; refusals never open a command row, they go to audit
```

A row still at `allowed` with a `started_at` and no `finished_at` is an act
that died mid-flight, which is exactly the thing worth being able to find.

**Both writers swallow their own errors on purpose.** If `control_audit` is
unwritable, the choice is between failing every privileged call — an audit
outage becoming a total outage — and proceeding unrecorded. It takes the
second. The writes are awaited, so ordinary operation produces a complete
trail; only actual failure is silent.

> Getting this right needed a live probe, not a reading. The first version
> wrote `status: "running"`, which the CHECK constraint rejects — and
> because `beginCommand` swallows its errors, **no command row would ever
> have been written and nothing would have said so.** The trail would have
> looked empty because it was working.

## Approval is not a claim

`social` gated paid channels on whether `approved_by` was set — and read
that field **from the request body**. Writing a name into the JSON approved
your own spend.

`approved_by` is now the verified caller's id, written by the server, and
only when that caller actually holds `social.publish`. `p.approved_by` is
ignored entirely.

A real approval is a server-generated fact about *actor + capability +
resource*. A string the caller supplies is a wish.

## Guarding vs. branching

`requireCapability()` **throws** on refusal, so a caller that forgets to
check the return value still cannot proceed — the failure mode of an
omitted `if` is the dangerous one, and this shape does not have it.

`hasCapability()` returns a boolean and writes no audit row. It is for
branching, never guarding: the code asking itself "may they *also* stamp
this as approved?" on the way to doing something the caller is already
allowed to do. Recording a `deny` there would fill the trail with refusals
nobody was refused.

## Caching

The grant matrix is ~60 rows and changes when a human decides it should. It
is cached in module scope with a 60-second TTL, so an operator who revokes a
capability sees it take effect within a minute rather than waiting for
isolates to recycle. Concurrent cold starts share one fetch.

**Role lookup is deliberately not cached.** If a grant must be revoked
*immediately*, revoke the membership: that takes effect on the next request.

## The same rules in the Worker

The Cloudflare Worker cannot import `authz.ts` — different runtime — but
it reads the **same two tables**, so there is one vocabulary and one
grant matrix across both. `workers/mccluster/src/social/router.js` and
`media/router.js` each have a `resolveOrg(env, userId, orgId, capability)`.

Both had the identical defect, found on 2026-09-07: `getOrg()` selected
`org_id,role` and **no call site ever read the role**. Membership in any
org was the whole check.

| Worker route | Capability |
| --- | --- |
| `GET /v1/social/accounts`, `campaigns`, `automations`, leaderboard | `social.read` |
| `POST /v1/social/accounts` | **`social.connect`** |
| `POST /v1/social/campaigns`, `publish`, `posts`, `metrics`, `automations` | `social.queue` |
| `POST /v1/social/variants/generate`, `/v1/media/generate`, `/v1/media/bakeoff` | `media.generate` |
| `GET /v1/media/jobs/:id` | `campaign.read` |

`social.connect` is new in `0060`. Attaching a credential decides which
account everything afterwards speaks as, which is strictly more
dangerous than posting once, so it is graded high and owner-only rather
than folded into `social.publish`.

### The org default was a footgun on its own

Given no `org_id`, both routers took `order=added_at.asc&limit=1` — the
caller's *oldest* membership. For an operator in several client orgs,
omitting one query parameter published to whichever client they joined
first. No attacker required. Both now refuse and ask which org, unless
the caller belongs to exactly one.

### `credential_ref` is a secret selector

`social_accounts.credential_ref` holds the **name** of a Worker secret,
resolved with `env[ref]`. Storing the name rather than the token is
right; taking the name from the request body and looking it up with no
constraint was not. Any member could have pointed an account at
`STRIPE_SECRET_KEY`.

It must now match `SOCIAL_[A-Z0-9_]{1,64}` — enforced by a CHECK
constraint in `0060`, at the write site in `router.js`, and again at the
read site in `meta.js`, so a row predating the constraint still cannot
select an unrelated binding.

## Publishing exactly once

`processInstagramPublishQueue` read `state in ('queued','processing')`
and published in a plain loop with nothing between the read and the call
to Meta — and `processing` is the state set *after* a media container is
created and *before* `media_publish`. Two overlapping cron runs did not
merely race for a queued job; the second re-selected a job the first was
mid-publish and called `media_publish` on the same container again. The
client's Reel goes out twice. `dedupe_key` never helped: it is unique on
our table and says nothing about how many times we called Instagram.

Jobs are now claimed with a compare-and-swap:

```
PATCH social_publish_jobs?id=eq.$1&or=(lease_until.is.null,lease_until.lt.$now)
```

A concurrent updater blocks on the row lock, re-evaluates the predicate
against the committed new version, matches nothing, and gets zero rows
back. Zero rows means someone else owns it.

The lease **expires rather than releases**, so a Worker that dies
mid-publish does not strand the job — and it covers **one phase, not the
whole job**, because the second phase is meant to be a later run.
Holding it across both would turn a safety mechanism into a ten-minute
delay on every post.

## Identity elsewhere: `context-ingest` and `context-query`

Both derived the caller by base64-decoding the JWT payload and trusting
`sub` — rule 1, violated again, in the two functions that read and write
`ai_context`, the private cross-model transcript store.

**It was not exploitable as deployed.** A forged token with a chosen `sub`
is rejected by the gateway before reaching the function; confirmed by direct
request on 2026-09-07. But the safety of the private context store rested
entirely on a project setting those files do not control — one toggle and
`sub` becomes attacker-chosen, which is full impersonation of any org member
over every stored transcript. `context-ingest` also stamped that unverified
identity into its receipt as `ingested_by`.

Both now call `verifyCaller`. Their org-membership checks are unchanged.

## What is still open

- **No service actor exists.** Nothing may call these functions
  unattended — no cron, no CI, no automation — because every path now
  requires a human's token. If a drip sender is ever wanted, it needs a
  first-class machine actor with its own capabilities, not a shared key.
- **`control_commands` is a record, not a bus.** Rows are written by the
  act; nothing proposes work into the table and waits. `control_approvals`
  and `control_leases` remain unused, and MCP (`mcp_calls`,
  `mcp_approvals`) is still not the mandatory choke point.
- **`operator_members` is still empty and still unused.** The concept
  exists; nothing reads it. `org_members` is the real membership table.
- **Seventeen of twenty edge functions still have no capability check.**
  This work covers five. The rest are either public by design
  (`unsubscribe`, `intake`, webhooks) or have not been reviewed.

## Retirement list

`docs/here-inventory.md` and `docs/architecture/current-state.md` both
already record `pay-now`, `connect-onboard` and `backend-sub` as superseded
by `checkout`, to be retired once `checkout` deployed. `checkout` deployed.
They were never retired and are still serving.

They belong to the `mcclusterishere/Here` era, their `SITE` constant points
at that dead origin, they read `public.providers` (zero rows), and
`public.payments` is also zero — no payment has ever completed through them.

**`pay-now` is the one to deal with first.** `verify_jwt` is false, so an
anonymous caller can mint a Stripe Checkout session on the platform account
for any amount with an attacker-chosen product name rendered on a
Stripe-hosted page. Nothing in either repository calls it.

Their source is now committed under `supabase/functions/` so that deleting
the deployed functions is reversible.

## Adding a privileged function

Import from `_shared/authz.ts`. Resolve the caller, then the resource, then
the capability. Name the capability in `control_capabilities` first — an
undefined name fails closed with a 500, on purpose, because only our own
code can reach that branch. Never reach for the service key before all three
have happened, and never accept an org id or an approver from the caller.
