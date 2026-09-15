# McCluster Compute Node Protocol

Status: v1 implementation branch, 2026-09-12.

## Goal

Turn owned or self-hosted GPU/accelerator machines into a private McCluster compute fabric without giving those machines control-plane credentials and without making each worker a publicly reachable server.

A node advertises **capabilities**, not products. Examples:

- `model3d.generate` implemented by `hunyuan3d.2-1.local`;
- `video.generate` implemented by `ltx.local`;
- `image.generate` implemented by an owned image workflow;
- later audio, vision, simulation, game-build, rendering, and other accelerator-backed capabilities.

The protocol is McCluster-owned. It is not a claim of compatibility with Kubernetes, Nomad, Ray, or an IETF HTTP-signature profile. Those systems inform the design patterns—resource advertisement, heartbeats, durable leases, bounded concurrency—but `mccluster-compute/1` is our own application protocol.

## Topology

```text
McCluster products / agents
        |
Capability Registry
        |
Core Tool Bus
        |
ops_compute_tasks (Supabase)
        |
Core compute gateway 127.0.0.1:4788
        |
TLS reverse tunnel / authenticated ingress
        |
        +------------------------------+
        |                              |
GPU node A                         GPU node B
outbound HTTPS only                outbound HTTPS only
Ed25519 identity                   Ed25519 identity
local executor                     local executor
(ComfyUI later)                    (other runtime)
```

The Core gateway MUST bind to loopback. Port 4788 is not an Internet-facing service. Remote nodes reach it through an HTTPS reverse tunnel/proxy. A node never needs inbound firewall exposure.

## Trust model

### Core owns

- canonical organizations and policy;
- capability definitions and approval state;
- durable task/lease state;
- scheduler decisions;
- audit/provenance;
- service-role access to Supabase;
- enrollment/admin secrets.

### Compute node owns

- its Ed25519 private key;
- accelerator drivers;
- model weights;
- local executors/workflows;
- node-local configuration;
- generated temporary working data.

### A compute node MUST NOT receive

- the Supabase service-role key;
- GitHub write credentials owned by Core;
- Twilio credentials;
- Cloudflare administrative credentials;
- another node's private key;
- arbitrary shell commands from the scheduler.

The task payload is a typed capability input. The node agent dispatches it only to a node-owner-configured loopback executor.

## Protocol identifier

`mccluster-compute/1`

Current default timings:

- heartbeat: 30 seconds;
- lease: 120 seconds;
- signed-request clock window: 5 minutes;
- offline scheduling threshold: 3 minutes without a node heartbeat.

These values are configurable within server-side safety bounds.

## Enrollment

Enrollment is the only bootstrap operation that uses a shared bearer secret.

1. The node generates an Ed25519 key pair locally.
2. The private key is written `0600` and never leaves the machine.
3. The node POSTs its public key, inventory, capability manifest, organization, labels, and agent version to `/v1/compute/enroll` with the one-time/rotatable enrollment token.
4. Core derives the node ID from the SHA-256 fingerprint of the public key.
5. Core stores the public key and manifest in `ops_compute_nodes`.
6. The enrollment token can be removed from that node and rotated after enrollment.
7. Every subsequent request uses the node key, not the bootstrap secret.

A previously enrolled public key cannot move to another organization through re-enrollment. Revoked identities cannot enroll themselves again.

## Node identity

Node IDs are deterministic:

```text
node_<first 32 hex characters of SHA256(SPKI public key)>
```

The full key fingerprint is also persisted and unique.

## Signed request profile

Every post-enrollment node request contains:

```text
x-mccluster-compute-protocol: mccluster-compute/1
x-mccluster-node-id: node_...
x-mccluster-timestamp: <ISO-8601>
x-mccluster-nonce: <unique nonce>
x-mccluster-content-sha256: <base64url SHA-256 of exact body bytes>
x-mccluster-signature: <base64url Ed25519 signature>
```

The signed canonical string is:

```text
MCCLUSTER-COMPUTE-V1
<METHOD>
<PATH>
<NODE_ID>
<TIMESTAMP>
<NONCE>
<BODY_DIGEST>
```

Core verifies the stored public key, node ID, timestamp window, exact body digest, and Ed25519 signature. Accepted nonces are persisted in `ops_compute_nonces`, so replay protection survives Core restarts and works across multiple future gateway replicas.

TLS is still mandatory. Application signatures complement transport encryption; they do not replace it.

## Capability advertisement

A node manifest contains one or more entries such as:

```json
{
  "capability": "model3d.generate",
  "implementation": "hunyuan3d.2-1.local",
  "backend": "comfyui",
  "model": "Hunyuan3D 2.1",
  "version": "2.1",
  "features": {
    "text_to_3d": true,
    "image_to_3d": true,
    "pbr": true
  },
  "input_schema": { "type": "object" },
  "output_schema": { "type": "object" },
  "max_concurrency": 1,
  "min_vram_bytes": 20000000000
}
```

Core normalizes every node-advertised implementation to:

```text
hosting = self-hosted
billing = compute
```

The local manifest may additionally contain an `executor` object, but that executor address/configuration is stripped from the public registration. Core learns what the node can do, not how to reach the node's private local services.

Unknown capability IDs may appear in raw node inventory but do not automatically extend the Capability Registry policy catalog. A capability still has to exist in the McCluster-owned catalog, and its lifecycle must be `active`, before normal products/agents can resolve it.

## Hardware inventory

The v1 node agent reports:

- hostname, OS/platform and architecture;
- CPU count;
- total memory;
- free disk;
- GPU model, UUID, VRAM, driver and compute capability when NVIDIA `nvidia-smi` is available;
- runtime version;
- current load/lease count.

The protocol itself is vendor-neutral. Additional inventory probes for AMD/ROCm, Apple/Metal and other accelerators can be added without changing the capability contract.

## Heartbeat and liveness

`POST /v1/compute/heartbeat`

A signed heartbeat refreshes:

- `last_seen_at`;
- hardware inventory;
- capability manifest;
- labels;
- current load;
- agent version;
- node concurrency limit.

A node in `revoked` or `quarantined` state cannot heartbeat or claim work. A `draining` node remains known but receives no new leases.

## Task and lease lifecycle

Tasks are durable rows in `ops_compute_tasks`.

```text
queued -> leased -> running -> done
                    |          
                    +-> failed -> queued (bounded retry)
                    
expired lease -> queued (if attempts remain)
              -> failed (if exhausted)
```

Nodes pull work. Core never connects inward to a worker.

### Claim

`POST /v1/compute/lease`

The node does not choose an arbitrary task type in its request. Core reads the node's stored manifest and atomically claims a matching queued task using `FOR UPDATE SKIP LOCKED`.

The scheduler checks:

- same organization;
- node is online and fresh;
- concurrency capacity remains;
- requested capability is advertised;
- explicit implementation, when present, is advertised;
- requested feature requirements are a subset of the advertised implementation features;
- `run_after`, priority, and retry limits.

The lease response carries a random one-time lease token. Only its SHA-256 hash is stored in the database.

### Start

`POST /v1/compute/leases/:id/start`

Requires both the signed node identity and the lease token.

### Progress heartbeat

`POST /v1/compute/leases/:id/heartbeat`

Extends a running lease and may save bounded progress metadata.

### Complete

`POST /v1/compute/leases/:id/complete`

Stores the normalized result and marks the task done. Expired leases cannot complete successfully.

### Fail

`POST /v1/compute/leases/:id/fail`

Stores the error. Retry is bounded by task policy and exponential backoff.

### Expiry

Lease expiry is durable. The next scheduler claim transaction atomically marks newly expired leases and requeues only their tasks. Historical expired leases cannot accidentally requeue a task that later received another lease.

## Database objects

`ops_compute_nodes`
: enrolled node identity, inventory, capabilities, labels, liveness and state.

`ops_compute_tasks`
: canonical durable compute queue.

`ops_compute_leases`
: ownership/expiry/progress/result record for each execution attempt.

`ops_compute_nonces`
: replay-defense ledger for signed node requests.

All four tables have RLS enabled and direct `anon` / `authenticated` access revoked. Lease and nonce RPCs are service-role-only.

## Core gateway API

Loopback service: `127.0.0.1:4788`.

Bootstrap/admin:

- `POST /v1/compute/enroll` — enrollment bearer token;
- `GET /v1/compute/nodes` — admin bearer token;
- `GET /v1/compute/capabilities` — admin bearer token;
- `POST /v1/compute/tasks` — admin bearer token.

Signed node operations:

- `POST /v1/compute/heartbeat`;
- `POST /v1/compute/lease`;
- `POST /v1/compute/leases/:id/start`;
- `POST /v1/compute/leases/:id/heartbeat`;
- `POST /v1/compute/leases/:id/complete`;
- `POST /v1/compute/leases/:id/fail`.

## Capability Registry integration

Live node implementations are discovered from `ops_compute_nodes` by the Core tool registry.

Each live `(capability, implementation)` pair becomes a temporary raw compute tool with a dynamic binding equivalent to:

```text
provider = mccluster-compute
transport = compute
hosting = self-hosted
billing = compute
```

This does **not** let a node invent product policy. The binding only participates when the capability already exists and is active in the McCluster Capability Registry.

When a stable capability resolves to a compute binding, the tool bus enqueues a task pinned to that implementation. The scheduler then selects an eligible live node. The caller sees a stable capability contract, not a GPU hostname or ComfyUI endpoint.

## Local executor boundary

The v1 node agent accepts only configured HTTP(S) executors on loopback (`127.0.0.1`, `::1`, or `localhost`). It does not accept shell commands from Core.

That boundary is intentional. The next phase can put a McCluster adapter in front of ComfyUI so the node receives a provider-neutral input and the adapter translates it into a known versioned workflow.

## Example node files

- `core/compute-node.env.example`
- `core/compute-capabilities.example.json`
- `core/systemd/mccluster-compute-node.service`

The example capability manifest shows the future Hunyuan3D/ComfyUI shape but does not claim that the ComfyUI adapter is implemented yet.

## Operational rules

1. Never expose the node agent itself to the Internet.
2. Never give a node the Supabase service-role key.
3. Never publish Core port 4788 directly; use TLS reverse ingress.
4. Rotate enrollment tokens after bootstrap.
5. Revoke or quarantine compromised nodes centrally.
6. Keep node private keys root/node-user readable only.
7. Treat capability advertisements as availability evidence, not authorization grants.
8. Keep consequential actions behind the existing McCluster policy/approval layer.
9. Do not auto-activate unknown capabilities because a node claims to support them.
10. Do not let compute nodes bypass the capability registry to reach paid APIs directly.
