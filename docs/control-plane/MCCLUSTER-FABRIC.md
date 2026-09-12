# McCluster Fabric v1

McCluster Fabric is the replication layer beneath conversation memory, objective synthesis, planning, and execution. Its job is to make an event heard by any participating node converge across Supabase, Cloudflare, and the OVH Core without creating competing truths or infinite relay loops.

## Nodes

- **Supabase** — canonical durable event log, receipts, and peer outbox.
- **Cloudflare Worker `mccluster`** — authenticated edge ingress and Cloudflare relay consumer.
- **OVH McCluster Core** — outbound-only execution node with a disk-backed emergency spool.

Supabase remains canonical durable truth. Cloudflare and OVH are independent relay participants, not shadow databases.

## Delivery contract

Every event has one immutable identity:

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "org_id": "uuid",
  "trace_id": "uuid",
  "kind": "conversation.ingested",
  "origin_node": "cloudflare",
  "occurred_at": "RFC3339 timestamp",
  "content_hash": "sha256",
  "payload": {}
}
```

`content_hash` is SHA-256 over the stable canonical representation of every field above except `content_hash`. Routing metadata is intentionally excluded from the envelope. Delivery history belongs in receipts, not mutable `hops` inside the event.

The invariant is **at-least-once transport with exactly-once logical identity**:

- repeating an existing `event_id` with the same hash is an idempotent duplicate;
- repeating an existing `event_id` with a different hash is a collision and must fail closed;
- a node may receive the same event through more than one path but must ACK/process the same logical event only once.

## Durable Supabase state

`public.fabric_events` is immutable from application credentials. Backend service credentials receive only `SELECT, INSERT`.

`public.fabric_receipts` records which nodes have heard and ACKed an event.

`public.fabric_outbox` records delivery work for Cloudflare and OVH. A database trigger seeds delivery rows when a new event arrives. Direct relay is an acceleration path; the outbox is the correctness path.

All three tables have RLS enabled and no `anon` or `authenticated` privileges. Backend Data API grants are explicit.

## Conversation identity

Accepted `/v1/ai/ingest` calls automatically emit a `conversation.ingested` Fabric event after `context-ingest` succeeds.

- `event_id` = `ai_context.ingestion_receipts.id`
- `trace_id` = canonical `ai_context.conversations.id`
- `org_id` = authorized organization
- origin = `cloudflare`

Because `context-ingest` is idempotent by provider + idempotency key and returns the same receipt for a duplicate request, repeated provider delivery converges on the same Fabric event.

## Relay paths

```text
                         ┌────────────────────┐
                         │      Supabase      │
                         │ events / receipts  │
                         │ durable outbox     │
                         └────────┬───────────┘
                                  │
                       pull + ACK │ pull + ACK
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │    Cloudflare    │◄──────►│     OVH Core     │
          │ edge + cron pull │ direct │ outbound + spool │
          └──────────────────┘        └──────────────────┘
```

### Cloudflare-origin event

1. Cloudflare accepts/authenticates the source.
2. Event is inserted into `fabric_events`.
3. Database trigger ACKs Supabase, ACKs Cloudflare because it is the origin, and creates an OVH outbox row.
4. OVH polls the outbox, verifies the hash, ACKs its receipt, and closes its delivery row.

### OVH-origin event

1. Core creates the envelope and attempts canonical Supabase persistence.
2. Trigger ACKs Supabase and OVH and creates a Cloudflare outbox row.
3. Core may also POST the same envelope directly to Cloudflare using `MCCLUSTER_FABRIC_TOKEN` as a low-latency acceleration path.
4. Cloudflare's scheduled consumer closes any remaining delivery row.
5. If Supabase is unavailable, Core writes the envelope atomically to `/var/lib/mccluster-core/fabric-spool` and retries it after connectivity returns.

### Supabase-origin event

Inserting a canonical event with `origin_node='supabase'` creates durable outbox rows for both Cloudflare and OVH. Each peer ACKs independently.

## Security

- OVH remains outbound-only; Fabric adds no public listener to the VPS.
- `MCCLUSTER_FABRIC_TOKEN` is a secret shared only by trusted internal nodes and must never be committed.
- Cloudflare's internal `POST /v1/fabric/events` requires the Fabric token and an explicit source-node header.
- Human status reads use the existing authenticated Worker path.
- Model interpretation and action authorization happen after replication. Hearing a sentence does not authorize executing it.

## Reconciliation

The Core periodically scans recent canonical events and recreates missing peer outbox rows idempotently. This repairs accidental outbox deletion or interrupted delivery. Cloudflare's existing five-minute scheduled Worker drains Cloudflare-targeted outbox work; `mccluster-fabric.service` continuously drains OVH-targeted work.

## Failure model

v1 tolerates either Cloudflare or OVH being offline while Supabase is reachable; pending rows replay when the peer returns. OVH additionally tolerates a temporary Supabase outage through its disk spool.

For complete independent durability while **Cloudflare hears an event during a simultaneous Supabase outage**, Cloudflare still needs a configured durable local spool (Cloudflare Queue or Durable Object storage). That infrastructure is the remaining v1.1 hardening step; `waitUntil()` alone is not treated as durable storage.

## Deployment

Code in Git is not proof of a running node.

Required runtime steps:

1. deploy the `mccluster` Worker with secret `MCCLUSTER_FABRIC_TOKEN`;
2. install the same token in `/etc/mccluster/core.env` on OVH;
3. install/enable `core/systemd/mccluster-fabric.service`;
4. verify one event obtains ACK receipts from all three nodes;
5. only then treat Fabric as live end-to-end.
