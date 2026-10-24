# OVH private GitHub repository access — incident #510

Only OVH Core self-reconciliation is in scope. PR release train #509 remains independent.

## Why this exists

The checked-in systemd service defaults to unauthenticated HTTPS, which worked while the repository was public but produced Git exit 128 when it was private. A deploy key generated on OVH was not proof of its authorization on GitHub. Do not change repository visibility until SSH ref reads and a real reconciliation cycle have passed.

## One-time owner action on OVH

1. SSH into the authorized OVH host. From the current trusted mccluster checkout, run `sudo bash scripts/ovh-private-repo-ssh.sh prepare`. This generates a dedicated Ed25519 key on the OVH machine only if one does not already exist at the script's managed path. The output shows only the public key.
2. In [Repository Settings → Deploy keys](https://github.com/mcclusterishere/mccluster/settings/keys), add that public key with **Allow write access disabled**. Do not paste, upload, commit, or transmit the private key. An earlier key at another path is not automatically assumed to be authorized.
3. Run `sudo bash scripts/ovh-private-repo-ssh.sh activate`. The script pins GitHub's [published Ed25519 host key](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints), proves the key can read both `main` and `deploy/ovh-production`, and only then installs a persistent systemd drop-in. It fails closed without modifying the live transport if authorization fails.
4. Verify `sudo systemctl cat mccluster-vps-reconcile.service`, `sudo systemctl status mccluster-vps-reconcile.timer`, and `sudo journalctl -u mccluster-vps-reconcile.service -n 80 --no-pager`. Confirm two successful timer cycles and that both local and public `/health` attest the deployed SHA. The drop-in survives versioned unit reinstall.
5. Only after success, switch repository visibility to private and repeat the read-only ref, reconciliation, and local/public health checks. Record results on #510. A GitHub branch head or green workflow alone cannot prove the live runtime SHA.

The script never copies or prints a private key, sends no credential to GitHub except standard public-key authentication, and uses strict host-key checking. If key registration fails, keep the repository public and #510 open; do not disable SSH host verification or revert to a token embedded in the Git URL.

The reconciler writes a non-secret, time-stamped `last-source-fetch.json` only after validated Git ref fetches and the production ancestry gate. When GitHub's anonymous REST endpoints return Not Found for a private repository, Core health may use this **only while fresh (10 minutes)** instead of treating an authenticated successful Git fetch as a source outage. Missing/expired/malformed receipts still surface the actual REST error. The system-health result distinguishes `github_rest_api` versus `ovh_reconciler_git_fetch_receipt` as the verification method; neither asserts actual runtime deployment.

## Database drift correction

Production Supabase project `zmnhbrjyhxzhkxmhkexs` already has 348 migrations at latest `20261024014732_analytics_forensics_search_index_v8`, ledger SHA-256 `831e4c7ab8f77390573bf72269e860c47b1f113198d709ff2f0c3f724e47e3ab`. The deployed contract at OVH SHA `ae77f3c2d3627014bdb066f6f576d98955a3ad3c` expected 341. Update the production contract, its ledger, and seven existing SQL migration source files without applying or replaying any production SQL. Keep the remaining newer main commits out of this isolated recovery promotion.

For acceptance, require a passing drift-contract check, exact-head CI, a production ref that is an ancestor of main, and an independently observed host/public runtime SHA plus post-deploy `migration_attestation.parity=true`. Do not claim resolved until those attestations are observed.
