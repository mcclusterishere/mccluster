# Whip product routes on the plane

These modules are the Whip Equipped API. They belong here, not in `Whip-Equipped/backend` as a second Cloudflare Worker.

Source that must live in this folder:

- identity-gateway.js (entry for `/api/*`)
- security.js
- gateway.js
- router.js
- worker.js
- stripe.js
- identity.js

Satellites may keep a read-only copy for history. They must not deploy it.
