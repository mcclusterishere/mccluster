# AI Desktop phase 1 — operator and Mac notes (review draft)

## Architecture and authority
Existing OVH Core owns workflow coordination and signed compute-node gateway. Cloudflare `mccluster` remains the authenticated public API. Supabase `zmnhbrjyhxzhkxmhkexs` remains canonical durable state; `ops_agent_jobs` and `ops_compute_tasks` are not replaced. A Mac node is optional outbound inference capacity, **not** a failover for OVH coordination. No new public port, VPN, authentication backend or database is introduced.

## First-phase patch
The compute node now applies a 10-second default timeout to outbound gateway requests and aborts an active loopback HTTP inference request on confirmed lease expiry, explicit authorization/ownership rejection (401/403/409), or shutdown. It refuses late result publication after loss of authority. The server still enforces its own lease token and current lease state. **This is a partial safety hardening patch, not a completed orchestration or desktop rollout.**

## Mac installation (not yet enabled)
1. Use the existing private Control web interface from the Mac, iPad or browser. No desktop application is required.
2. Install a supported Node.js LTS release and an approved local model runtime (Ollama or tested llama.cpp build). Keep inference bound to `127.0.0.1`; do not expose its port to the LAN or internet.
3. Verify actual unified memory, free disk and model license before downloading any weights. M1 8 GB is control-first; M1 16 GB may test a small model; a newer 24–32 GB Mac is a more flexible optional inference target.
4. The existing agent needs `MCCLUSTER_COMPUTE_URL` (the **verified, authenticated HTTPS route to the OVH compute gateway**, not `api.mccluster.org` by assumption), `MCCLUSTER_ORG_ID`, `MCCLUSTER_NODE_MANIFEST`, and `MCCLUSTER_NODE_STATE_DIR`. Initial enrollment additionally requires a short-lived `MCCLUSTER_NODE_ENROLL_TOKEN`, issued through the existing authorized gateway process. **Do not copy OVH service-role or Stripe keys to the Mac.**
5. Until a dedicated macOS manifest, verified gateway Access policy, and launchd unit have passed tests, run the node only in an isolated supervised test session. Do not turn on unattended startup. Keep one inference job/model at a time.
6. Stop the node with SIGTERM/SIGINT; verify that active inference aborts. Remove the node's private identity file only after server-side credential revocation, then uninstall the local runtime if desired.

## Security and data boundary
Mac workers receive task payloads through OVH's signed gateway; this is **not** local-only privacy. Prompt content and results can transit the gateway and be stored in canonical durable records. Never give inference-only workers arbitrary code execution, filesystem, screen recording, Photos, Mail, browser-profile or home-directory privileges.

## Rollout / rollback
Do not merge or promote this draft until node-agent tests and simulated hung-renewal, revocation, and late-completion tests pass. Review active PRs touching the same compute path. Normal production promotion follows the approved `deploy/ovh-production` process and outbound self-reconciliation; verify the actual service revision and health separately. Rollback is reverting this patch and promoting the previously approved revision. This document is not authorization to change OVH configuration or deploy.

## Open acceptance gaps
- Model invocation budget at the shared gateway/runner boundary (ceiling seven) with durable atomic accounting
- Typed finite plan/candidate/review/repair/independent-verification orchestration
- Pinned model license and checksum registry, hardware admission, and representative benchmark
- macOS unified-memory/Metal discovery, launchd installer and uninstall
- Durable job-to-node correlation, private Control receipt, role-isolation and responsive UI tests
- End-to-end lease fencing under hung renewals and concurrent attempts; tested Mac and production runtime attestation
