# Platform reconstruction v1

This branch reconstructs production-relevant capabilities stranded on historical branches onto current main instead of merging stale branch histories.

## Recovered capabilities

### Private communications transport
Source lineage: `closure/ten-point-backlog`.

Restores the Android/SIM relay client and its CI. The existing server-side communications API remains authoritative for enrollment, contacts, outbox, delivery state and assistant policy; the Android app owns only the physical carrier hop.

### Infrastructure control plane
Source lineage: `claude/backend-control-integration-601s0k`.

Restores the operations control surface and provider adapters for GitHub, Cloudflare, Supabase management, OVH and site operations. REST and MCP routes share the same action/authority layer. Scheduled estate snapshots make infrastructure drift observable instead of requiring a human to remember to inspect providers.

### Sovereign media asset plane
Source lineage: `selfhost/sovereign-media-fabric-v1` and `product/mccluster-console-v1`.

Restores asset ingress, asset gateway and sovereignty audit services around the preview/compute primitives already present on main. This is the storage/delivery side of moving media generation from third-party-only execution toward McCluster-controlled OVH/GPU nodes.

## Deliberately not copied

- stale OAuth code: current main already has the newer Core MCP/OAuth implementation;
- old preview gateway: current main already contains the evolved preview gateway;
- PR #104 signal spine: not copied until its fingerprint/retry-state defects are repaired against current main;
- dependency-review workflow from the old closure branch: it currently fails because the repository dependency graph is not enabled;
- historical runner/objective branches whose capabilities are already represented by current Core.

## Architectural target

M Account identity -> normalized signals -> durable objectives -> Initiative OS / DAG planning -> autonomous Core workers -> infrastructure and compute control -> product-domain execution -> completion evidence -> human approval where policy requires it.

Communications, media/music, social, PRIM3, Whip, Equity Uprise and future products should consume this common spine rather than grow independent control planes.
