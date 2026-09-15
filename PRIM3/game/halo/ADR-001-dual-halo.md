# ADR-001: Dual Halo, shared engine and isolated worlds

Status: Accepted for review

## Decision

Maintain two separately deployable products:

1. Halo Ops: real authenticated operational world.
2. PRIM3 Halo: fictional videogame world.

Share a versioned renderer/interaction engine only. Persist and serve data through isolated namespaces and policy boundaries.

## Why

A single mixed world would create correctness, privacy, narrative, performance, and product-design problems. The game needs curated deterministic campaign state. Halo Ops needs real operational truth. Sharing the visualization engine captures the useful software reuse without making one product's data model contaminate the other.

## Consequences

- game releases cannot accidentally surface production live feeds;
- real Halo remains useful as a nongamified backend product;
- both can evolve UI independently;
- common globe/camera/layer improvements can be reused;
- campaign data can be versioned and tested as canon;
- a deliberate transformation pipeline is required for any public real-world dataset reused as static game scenery.
