# OVH private GitHub repository access (incident #510)

Only OVH Core self-reconciliation is in scope. PR release train #509 remains independent.

The full owner procedure for closing #510, with the queries and the acceptance criteria, is `docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md`. This page explains the mechanism and what each piece of evidence proves.

## Why this exists

The checked-in systemd service defaults to unauthenticated HTTPS, which worked while the repository was public but produced Git exit 128 when it was private. A deploy key generated on OVH was not proof of its authorization on GitHub. Do not change repository visibility until SSH ref reads and real reconciliation cycles have passed.

## One-time owner action on OVH

1. SSH into the authorized OVH host. From the current trusted mccluster checkout, run `sudo bash scripts/ovh-private-repo-ssh.sh prepare`. This generates a dedicated Ed25519 key on the OVH machine only if one does not already exist at the script's managed path. The output shows only the public key and its fingerprint.
2. In [Repository Settings → Deploy keys](https://github.com/mcclusterishere/mccluster/settings/keys), add that public key with **Allow write access disabled**. Do not paste, upload, commit, or transmit the private key. An earlier key at another path is not automatically assumed to be authorized. Compare the fingerprint GitHub shows with the one `prepare` printed.
3. Run `sudo bash scripts/ovh-private-repo-ssh.sh activate`. The script pins GitHub's [published Ed25519 host key](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) and then proves four things before it changes anything. It exits non-zero and leaves the live transport untouched if any of them fails:
   - both `main` and `deploy/ovh-production` are readable over SSH with this key, using a Git that ignores system, user and environment configuration;
   - GitHub greets the key as `mcclusterishere/mccluster`, which is how it greets a deploy key of this repository. A personal key is greeted with a login and is refused;
   - GitHub refuses the key for writing. The probe is a dry-run push from a throwaway repository, so nothing is ever sent. A dry run that is accepted means the key can write, and the key is refused;
   - Git as the reconciler runs it resolves the SSH URL to itself, with no `url.*.insteadOf` rewrite.

   Only then does it install the persistent systemd drop-in and start one reconcile cycle by hand.
4. Wait about five minutes, then run `sudo bash scripts/ovh-private-repo-ssh.sh status`. It is read-only: it creates no key, writes no unit and no drop-in, and does not start or reload anything. The only thing it creates is the throwaway repository of the write probe, which it removes. It prints `key=value` evidence and exits 0 only when every proof holds. `proofs_unproven=` names whatever does not. The drop-in survives versioned unit reinstall.
5. Only after `status` exits 0 and both local and public `/health` attest the deployed SHA, and only if the owner decides to, switch repository visibility to private and repeat the status, reconciliation and local/public health checks. Record results on #510. A GitHub branch head or green workflow alone cannot prove the live runtime SHA.

The script never copies or prints a private key, sends no credential to GitHub except standard public-key authentication, and uses strict host-key checking. If key registration fails, keep the repository public and #510 open; do not disable SSH host verification or revert to a token embedded in the Git URL.

Two answers from GitHub could not be exercised where the script was written: the greeting of `ssh -T git@github.com`, and the refusal a read-only deploy key gets on a push. Each is matched in one place in the script, through `GITHUB_GREETING_PATTERN` with `GITHUB_DEPLOY_KEY_IDENTITY`, and `GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN`. Anything the script does not recognise is treated as unproven and refused. If `activate` refuses a key that is correctly registered, GitHub's wording has changed: compare it as the runbook describes and change the variable through a reviewed commit. Never bypass the check.

## What each piece of evidence proves

### The fetch receipt

The reconciler writes a non-secret, time-stamped `last-source-fetch.json` only after validated Git ref fetches and the production ancestry gate. When GitHub's anonymous REST endpoints return Not Found for a private repository, Core health may use this **only while fresh (10 minutes)** instead of treating an authenticated successful Git fetch as a source outage. Missing, expired or malformed receipts still surface the actual REST error. The system-health result distinguishes `github_rest_api` versus `ovh_reconciler_git_fetch_receipt` as the verification method; neither asserts actual runtime deployment.

`ovh_reconciler_git_fetch_receipt` means only this: the REST read failed and a fetch receipt less than ten minutes old existed. It does not say the fetch used SSH, that it was authenticated, or what started the cycle. An anonymous HTTPS fetch of a public repository writes the identical file. When the fallback is used, the REST error that caused it is kept as `deployment.source_fallback.github_rest_error`, so a rate limit, a timeout and a private repository's `Not Found` can be told apart.

### The cycle receipts

Every reconcile cycle that takes the lock leaves one receipt under `/var/lib/mccluster/reconcile` (schema `mccluster-reconcile-cycle/v1`):

- `last-cycle.json`: the newest cycle, whatever its outcome.
- `last-verified-cycle.json`: the newest successful cycle. A cycle that verified the promoted ref and found nothing to change is a success (`verified_no_change`), as is a deploy (`deployed`).
- `cycles.jsonl`: the newest 40 cycles, one line each.

`last-success.json` is unchanged and still means the last deploy.

| Field | Meaning |
| --- | --- |
| `cycle_id` | The systemd invocation id of the cycle. Empty for a run outside systemd. The journal carries the same id as `_SYSTEMD_INVOCATION_ID`. |
| `trigger` | `timer`: systemd itself said the timer started this invocation (`TRIGGER_UNIT`, systemd 252 and later). `timer_inferred`: only on older systemd, when this invocation started within two seconds of the timer's last elapse (read over D-Bus with `busctl`, since `systemctl show` prints it as a time span) and no earlier receipt carries that elapse. `other`: everything else, including a start by hand. The inference never guesses: on older systemd a timer-started cycle that runs past the next timer elapse, such as a long deploy, is recorded as `other`. |
| `outcome`, `stage`, `exit_code`, `interrupted` | `verified_no_change`, `deployed`, `deferred` (exit 75) or `failed`, the stage the cycle was in when it ended, and its exit status. A cycle the unit terminated has no exit status: `exit_code` is null and `interrupted` is true. A cycle whose comparison of the live install with the promoted commit could not run (rsync failed) is `failed` at stage `drift_compare` with exit status 4: it never reads as `verified_no_change`. |
| `transport` | `ssh` or `https`, from the URL Git resolves for `origin` after any `url.*.insteadOf` rule, not from the configured URL. Anything but the two canonical GitHub forms is `other`. |
| `ssh_host_key_pinned` | True only when `GIT_SSH_COMMAND` is exactly the command the setup script installs and the known-hosts file is exactly GitHub's pinned line. |
| `ssh_key_fingerprint` | The SHA-256 fingerprint of the public half of the key that command names. The private key is never opened. |
| `https_credential_configured` | Whether a credential helper, an extra header, an askpass program, a netrc file or a credential in the URL was present. A boolean, never a value. |
| `github_main_sha`, `github_promoted_sha`, `deployed_sha`, `started_at`, `finished_at` | What the cycle fetched, what the host is on, and when. |

Writing a receipt cannot fail, delay or change a cycle. It happens after the outcome is decided, in a subshell, under one ten-second budget, and it never changes the exit status.

### What "authenticated" means

Core health reports `authenticated: true` for a cycle only when the cycle succeeded over SSH with the pinned GitHub host key and one named key. It is never true for HTTPS, with or without a credential helper, because a public repository answers an HTTPS fetch without asking for the credential.

Over SSH, GitHub only answers a key that is registered with it. So `authenticated: true` shows that GitHub accepted the key with that fingerprint. While the repository is public it does not show that the key is this repository's deploy key or that it is read-only, because any registered key can read a public repository. Those two facts are proved on the host by `status` (`github_identity` and `write_access`). Acceptance needs both: the receipts and `status`, with the same fingerprint. Once the repository is private, a successful SSH fetch also shows that the key has access to it.

### Core health

`host_health` output carries the receipts under `deployment.reconcile`:

- `status`: `verified` (the newest cycle did not fail and a cycle succeeded within the window), `failed` (the newest cycle failed or was terminated), `stale` (no cycle succeeded within the window) or `unverified` (the host has no receipts because its reconciler predates them).
- `last_cycle`, `last_verified_cycle`, `consecutive_failed_cycles`.
- `recent_successful`: the newest five distinct successful cycles, with trigger, transport, `authenticated` and key fingerprint.
- `distinct_successful_cycles`, `distinct_successful_timer_cycles`, `distinct_authenticated_timer_cycles`: counted over `recent_successful`.

A `failed` or `stale` status adds a warning, `deployment/reconcile_cycle_failed` or `deployment/reconcile_cycle_stale`, at the same level as the existing `reconcile_timer_inactive`. `unverified` adds nothing, so a host that still runs the older reconciler reports exactly what it reported before.

The window is 25 minutes. The timer starts a cycle two minutes after the previous one started, plus up to 20 seconds of jitter, plus up to one minute because the timer sets no `AccuracySec` and systemd's default lets it elapse that late, and a cycle that deploys may run to the service's 20 minute start limit. The longest gap a healthy host can show between two successes is therefore 23 minutes 20 seconds. A test reads both unit files and fails if they stop matching these numbers.

### None of this is on the host until it is promoted

The cycle receipts, the health projection, the `status` mode and the new `activate` proofs are source. They take effect on the host only after a commit that contains them is promoted through `deploy/ovh-production`, and the receipts start with the first cycle after that deploy. Until then the only evidence of a timer cycle is on the host itself: the journal, and `systemctl show` of the timer and the service.

## Database drift correction

This section records the October correction. The current one, with its numbers, is in `docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md`.

Production Supabase project `zmnhbrjyhxzhkxmhkexs` already has 348 migrations at latest `20261024014732_analytics_forensics_search_index_v8`, ledger SHA-256 `831e4c7ab8f77390573bf72269e860c47b1f113198d709ff2f0c3f724e47e3ab`. The deployed contract at OVH SHA `ae77f3c2d3627014bdb066f6f576d98955a3ad3c` expected 341. Update the production contract, its ledger, and seven existing SQL migration source files without applying or replaying any production SQL. Keep the remaining newer main commits out of this isolated recovery promotion.

For acceptance, require a passing drift-contract check, exact-head CI, a production ref that is an ancestor of main, and an independently observed host/public runtime SHA plus post-deploy `migration_attestation.parity=true`. Do not claim resolved until those attestations are observed.
