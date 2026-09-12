# Dual Halo Hosting Target

Both Halo surfaces are first-class hosted products.

## Halo Ops

Purpose: authenticated, nongamified operational backend for McCluster.

Target flow:

```text
Matthew / authorized operator
        |
        v
McCluster identity + authorization
        |
        v
Cloudflare edge
        |
        v
private Halo Ops origin on OVH/Core
        |
        v
approved real operational data/services
```

The origin must bind loopback/private network only and use Cloudflare Tunnel or an equivalent reviewed private ingress. Do not expose its application port directly to the Internet.

## PRIM3 Halo

Purpose: fictional game-world mission selector and campaign runtime.

Target flow:

```text
player / learner
        |
        v
PRIM3 game surface
        |
        v
Cloudflare edge
        |
        v
separately deployable PRIM3 Halo origin
        |
        v
prim3_game state + fictional campaign assets
```

The game origin must not receive Halo Ops service credentials and must not query operational tables/feeds.

## Release isolation

A Halo Ops release and PRIM3 Halo release should be independently promotable and rollbackable. They may depend on the same versioned `halo-engine` package, but one product's deploy should not require redeploying the other.

## Initial route names

Treat hostnames/routes as proposed until DNS/current routing audit is complete. Good targets are an authenticated McCluster backend route for Halo Ops and a PRIM3-specific game hostname/route for PRIM3 Halo. Do not create DNS merely from this document.
