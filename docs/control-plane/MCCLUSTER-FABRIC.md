# McCluster Fabric v1

McCluster Fabric is the immutable event relay beneath conversation memory, objective synthesis, planning, and execution. Its purpose is to let Supabase, the Cloudflare Worker, and the OVH Core converge on the same accepted events without creating competing sources of truth or relay loops.

## Authority model

- **Supabase** is the canonical durable event log, receipt ledger, and peer outbox.
- **Cloudflare Worker `mccluster`** is the authenticated public edge and Cloudflare relay consumer.
- **OVH McCluster Core** is the persistent execution node and owns a disk-backed emergency spool.

Cloudflare and OVH are relay participants. They do not replace Supabase as canonical state.

## Envelope

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

`content_hash` is SHA-256 over a stable recursive key ordering and a canonical UTC millisecond timestamp. Delivery metadata is excluded from the hash and belongs in receipts/outbox state.

The transport invariant is **at-least-once delivery with exactly-once logical identity**:

- same `event_id` + same hash = idempotent duplicate;
- same `event_id` + different hash = collision and fail closed;
- the same event may arrive over more than one route, but each node records the same immutable event identity.

## Privacy boundary

Fabric events are metadata/reference envelopes, not conversation storage.

For `conversation.ingested`, raw transcript messages are explicitly forbidden in the Fabric payload. The canonical transcript remains in private `ai_context`. The Fabric event may carry only bounded references such as the internal conversation ID, receipt ID, provider, message count, and payload hash.

This means every node can learn that a conversation was accepted without duplicating the private transcript into the public job/event plane.

## Durable Supabase state

`public.fabric_events` stores immutable canonical events. Service credentials receive only `SELECT, INSERT`.

`public.fabric_receipts` records which nodes have acknowledged an event.

`public.fabric_outbox` records pending delivery work for Cloudflare and OVH. A database trigger seeds receipts/outbox rows after every canonical insert.

All Fabric tables have RLS enabled. `anon` and `authenticated` receive no table privileges.

## Conversation identity

Successful `/v1/ai/ingest` requests emit a `conversation.ingested` Fabric event after `context-ingest` accepts the conversation.

- `event_id` = immutable `ai_context.ingestion_receipts.id`
- `trace_id` = canonical `ai_context.conversations.id`
- `occurred_at` = immutable ingestion receipt `created_at`
- `org_id` = authorized organization
- origin = `cloudflare`

Because provider + idempotency key returns the same ingestion receipt, retries recreate the same candidate event and therefore the same hash. A differing replay fails as an event collision instead of silently replacing canonical content.

## Relay paths

```text
                         +--------------------+
                         |      Supabase      |
                         | events / receipts  |
                         | durable outbox     |
                         +---------+----------+
                                   |
                        pull + ACK | pull + ACK
                    +--------------+--------------+
                    v                             v
          +------------------+          +------------------+
          |    Cloudflare    |<-------->|     OVH Core     |
          | edge + cron pull |  direct  | outbound + spool |
          +------------------+          +------------------+
```

### Cloudflare-origin event

1. Cloudflare authenticates the request that caused the event.
2. The event is inserted atomically into `fabric_events` using conflict-safe identity handling.
3. The database trigger ACKs Supabase and Cloudflare and creates an OVH outbox row.
4. OVH polls the outbox, recomputes the canonical hash, ACKs its receipt, and closes the delivery row.

### OVH-origin event

1. Core creates and hashes the canonical envelope.
2. Core attempts Supabase persistence.
3. The trigger ACKs Supabase and OVH and creates the Cloudflare outbox row.
4. Core may additionally POST the same immutable envelope to Cloudflare using `MCCLUSTER_FABRIC_TOKEN` as a low-latency acceleration route.
5. If canonical persistence is temporarily unavailable, Core writes the event atomically into `/var/lib/mccluster-core/fabric-spool` and retries later.

### Supabase-origin event

A canonical event inserted with `origin_node='supabase'` seeds delivery rows for both Cloudflare and OVH. Each peer verifies and ACKs independently.

## Security

- OVH remains outbound-only; Fabric opens no new public VPS listener.
- `MCCLUSTER_FABRIC_TOKEN` is server-side only and must never be committed or exposed to browsers/OpenCode.
- Cloudflare `POST /v1/fabric/events` requires the Fabric token plus an explicit source-node header and verifies that header against the immutable `origin_node`.
- Human event-status reads require existing user authentication and organization-owner authorization.
- Event body size is bounded.
- Hash mismatch, origin mismatch, and event-ID collision fail closed.
- Hearing an event is not permission to execute a consequential action; governance remains in the execution layer.

## Reconciliation and failure model

The Core periodically scans recent canonical events and idempotently recreates missing peer outbox rows. The Cloudflare scheduled Worker drains Cloudflare-targeted rows; `mccluster-fabric.service` drains OVH-targeted rows.

v1 tolerates Cloudflare or OVH being temporarily offline while Supabase remains reachable. OVH additionally survives a temporary canonical-store outage through its disk spool.

A simultaneous Supabase outage while Cloudflare is the first node to hear a brand-new event still requires Cloudflare-local durable storage for full independent durability. A Queue or Durable Object is the planned v1.1 hardening step; `waitUntil()` alone is not considered durable storage.

## Runtime configuration

Core:

- `MCCLUSTER_FABRIC_TOKEN`
- `MCCLUSTER_FABRIC_URL` (defaults to `https://api.mccluster.org`)
- `MCCLUSTER_FABRIC_SPOOL_DIR`
- `MCCLUSTER_FABRIC_POLL_MS`
- `MCCLUSTER_FABRIC_RECONCILE_EVERY`
- `MCCLUSTER_FABRIC_MAX_EVENT_BYTES`

Worker:

- `MCCLUSTER_FABRIC_TOKEN`
- existing Supabase backend configuration

## Definition of live

Merged code is not proof that Fabric is running. Treat Fabric as live only after all of the following are verified:

1. the Fabric migration is applied;
2. the `mccluster` Worker is deployed with its Fabric secret;
3. the same secret exists in `/etc/mccluster/core.env`;
4. `mccluster-fabric.service` is installed, enabled, and active;
5. a test event produces ACK receipts from Supabase, Cloudflare, and OVH;
6. no raw transcript content appears in `fabric_events`.
