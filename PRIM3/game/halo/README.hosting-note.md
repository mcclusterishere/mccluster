# Hosting Separation Note

This canon branch intentionally does not create DNS, open ports, or deploy services. The hosting requirement is accepted, but implementation follows the production-synchronization release gate.

Both future origins must bind loopback/private interfaces and be published through reviewed Cloudflare/private ingress. Halo Ops and PRIM3 Halo will have separate service identities and configuration so the game cannot inherit operational secrets.
