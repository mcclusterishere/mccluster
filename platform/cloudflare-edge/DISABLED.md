# Disabled legacy Worker

This directory is an archived predecessor and must never be deployed.

The canonical and only Cloudflare Worker is `workers/mccluster`, named `mccluster`. The legacy Wrangler config was removed and this package's deploy/dev scripts intentionally fail closed.

If useful code remains here, port it into `workers/mccluster` rather than restoring a second Worker.
