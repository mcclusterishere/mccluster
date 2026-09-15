# PRIM3 Halo Architecture

## Product split

```text
                         shared Halo engine
             globe / camera / layers / selection / UI
                              |
             +----------------+----------------+
             |                                 |
       Halo Ops (REAL)                  PRIM3 Halo (GAME)
       authenticated                     fictional Earth
       operational data                  campaign data only
       production policy                 game policy/RLS
       real event streams                no live ops feeds
```

The shared layer is software, never shared state.

## Preferred renderer

Start with CesiumJS for the canonical 3D globe because the game needs an actual planet-scale mission selector, accurate globe coordinates, long camera flights between continents, terrain/3D extensibility, and future facility/world layers. Keep mission overlays behind a small renderer interface so MapLibre GL JS can be used for flatter tactical/briefing maps without changing campaign data.

Do not make deck.gl GlobeView the primary globe while its globe path remains explicitly experimental.

## Runtime boundary

Proposed paths:

- shared engine: `packages/halo-engine/`
- real application: `apps/halo-ops/`
- fictional campaign: `PRIM3/game/halo/`

Proposed APIs:

- real: `/v1/halo/*`
- game: `/v1/prim3/game/*`

Proposed persistence:

- real operational tables remain in their production namespaces;
- fictional game state uses `prim3_game` schema/tables with separate RLS and grants.

## Hosting

Both surfaces use the canonical McCluster edge/control plane. Cloudflare remains public ingress/auth. OVH Core may host long-lived/private application services through loopback/private listeners and Cloudflare Tunnel. A service may not be made public by directly opening an origin port.

Halo Ops and PRIM3 Halo should have separately deployable processes/releases even if they consume the same shared renderer package.

## Deployment experience

Halo Ops target: Matthew signs into McCluster and opens an authenticated backend Halo view with no gamification layer required.

PRIM3 Halo target: learner/player opens a mission-control globe, sees only game-world layers, selects an available mission, receives briefing/cast/intel, and deploys through a globe-to-site camera transition.

## Data crossing

Default deny. If a generic real-world public dataset is ever transformed into game scenery, that transformation must be explicit, reviewed, cached as a game asset, stripped of live/private semantics, and no longer queried as a production operational feed at game runtime.
