# Device opt-in: any device, one tap

Owner, 2026-11-24: "I should be able to log in any computer in any processing level, with any processing power,
including possibly a phone ... Anything with a chip, you want it to do work."

The owner signs in on `device.html` (any device) and taps once. Core is the node network; this only adds members.

| Path | For | Runs | What enrols it |
| --- | --- | --- | --- |
| **Opt this device in** | anything with a modern browser: phones, tablets, Chromebooks, computers | while the page is open | `js/device-node.js`: its own Ed25519 key made by WebCrypto, non-extractable in IndexedDB |
| **Get the install command** | Mac (`core/macos/mccluster-mac-node.sh`), and Windows / Linux nodes (two lines for `node.env`) | always, page closed | the full node agent, `MCCLUSTER_NODE_ENROLL_GRANT` |

## The grant (`core/src/compute/device-grant.mjs`)

- `POST /v1/compute/device-grants` with the owner's Supabase session. Core asks Supabase who the session is and
  whether that account holds `ops.use` on the house org (`control_authorize_service`, the check music-access makes).
  Anyone else gets 403; no session, 401.
- The grant is `mccg1.<claims>.<HMAC-SHA256>` keyed with `CORE_COMPUTE_ENROLL_TOKEN`: no new secret, no new table.
  It lives 15 minutes and enrols **one** device (409 `GRANT_USED` for a second key; the same device may retry).
- `POST /v1/compute/enroll` takes it in `x-mccluster-enroll-grant` instead of the raw token. The node is labelled
  `trust: owned`, `opted_in_by: <owner>`, `enrolled_via: browser|website`, pinned so no heartbeat can change them.
- The website calls the gateway across origins: `CORE_COMPUTE_BROWSER_ORIGINS` (default
  `https://matthew.mccluster.org,https://mccluster.org`) is the allowlist, never a wildcard.

## What a browser node does today

It is live and measured (threads, memory, WebGPU) and heartbeats every 30 s (60 s in a background tab). It
advertises **no** capability yet, because no browser runner exists, so the scheduler never hands it a task it
cannot finish. Work for browsers lands as runners in `js/device-node.js` (`RUNNERS`), each one advertised only
on a device that can run it.

## Proof

- `scripts/staging/device-jobs/device-optin.mjs`: the real gateway on the real compute SQL, a real Chromium phone
  opting in (its WebCrypto signatures verified by Core), owner-only grants, one-use, tampered and expired grants
  refused, CORS, and the real node agent enrolling from a grant. 16/16 on 2026-11-24.
- `scripts/e2e/device-page.e2e.mjs`: the page at 390px and 1280px. `scripts/test/device-grant.test.mjs`.

## To turn it on

Promote Core through `deploy/ovh-production` as usual; the gateway needs nothing new beyond what it has
(`SUPABASE_URL`, its Supabase key, `MCCLUSTER_ORG_ID`, `CORE_COMPUTE_ENROLL_TOKEN`) and `compute.mccluster.org`
reaching it. Until then the page says it is not reaching the network.
