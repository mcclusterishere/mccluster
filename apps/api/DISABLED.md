# Disabled legacy API

This directory is historical reference only.

The only McCluster backend is `workers/mccluster`, deployed as the Cloudflare Worker `mccluster`. Do not deploy, start, containerize, or reconnect this Node API. Its Dockerfile was removed and its runtime scripts intentionally fail closed.

If useful logic remains here, port that logic into `workers/mccluster` behind the existing auth, billing, tenancy, and audit boundaries rather than reviving this service.
