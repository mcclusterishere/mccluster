# OVH Core: contract promotion and read-only Git authentication (incident #510)

Written 2026-11-10 on the review branch `claude/new-session-83ken5` (draft PR #793). This is the owner's procedure for the two things that keep #510 open. The mechanism behind the evidence is explained in `docs/control-plane/OVH-PRIVATE-GITHUB-RECONCILE.md`.

## Read this first

- **Nothing in this runbook has been done.** The session that wrote it had no access to the OVH host and attempted none. It did not open an SSH connection, did not dispatch a workflow, did not promote, did not push, did not change any production or GitHub setting, and did not see, create or handle any key or credential. What it produced is source code, tests that run against fakes, and this document.
- **The host does not run any of this yet.** The cycle receipts, the health projection, the `status` mode and the new `activate` proofs are source on a review branch. They take effect on the host only after a commit that contains them is promoted through `deploy/ovh-production` (step 4). The receipts start with the first reconcile cycle after that deploy.
- Every step says who must do it and where:
  - **OWNER**: only the owner can do this.
  - **HOST**: run on the OVH host `vps-af4e71d9` as root. No session has that access.
  - **GITHUB SETTINGS**: a change in the repository's settings on github.com.
  - **GITHUB ACTIONS**: a manual run of a workflow.
  - **PRODUCTION READ**: read-only SQL against Supabase project `zmnhbrjyhxzhkxmhkexs`. Nothing in this runbook writes to production.
  - **REPOSITORY**: commits, a branch and a pull request. No production effect until the owner merges and promotes.

## What is wrong today

Two separate things.

1. **The contract.** OVH runs `deploy/ovh-production` at `9c5b75032d1794c47d8b6db05acf16e3965faa74`. Its `core/drift-contract.json` expects 359 migrations ending in `20261103182544 learning_evidence_v1`, ledger hash `41b4bd62...`. Production holds 363, ending in `20261109194957 media_operation_claims_v1`, ledger hash `90b735eb844eaf336df508cd5ecc15b980518c12108ff3f48b9edbf373f552ef`. Every `host_health` diagnostic is therefore `overall=fail`, `infrastructure=fail`, with exactly one issue: `supabase/supabase_migration_ledger_drift`, critical. As read from production on 2026-11-09 at 23:10 UTC by the lead of the review session (read-only; not re-read when this runbook was written): the last three rows show that one issue, local and public `/health` answer 200 serving `9c5b7503`, the source verification method is `github_rest_api`, the last deploy is `2026-11-07T13:59:29Z`, and the reconcile timer is active. Only a promotion whose contract says 363 clears it. Editing the live file is not an option: the reconciler treats it as drift and redeploys.
2. **The evidence.** Nothing persisted today can show that the host fetches over SSH with a read-only key, or that two distinct timer-started reconcile cycles succeeded. The fetch receipt holds two SHAs and a time. An anonymous HTTPS fetch of the public repository writes the identical file. A single diagnostic that reports `ovh_reconciler_git_fetch_receipt` means only that the REST read failed and a recent receipt existed. "Last successful reconciliation" is `last-success.json`, written on a deploy and never on a no-change cycle.

## What the source change adds

| Piece | Where | On the host after |
| --- | --- | --- |
| One receipt per reconcile cycle: invocation, trigger, outcome, real transport, key fingerprint | `scripts/mccluster-vps-reconcile.sh` | Promotion, from the first cycle after the deploy |
| `deployment.reconcile` in `host_health`, the kept REST error, warnings for a failed or stale cycle | `core/src/reconciler-source-receipt.mjs`, `core/src/executors/host-health-collect.mjs`, `core/src/health-verification.mjs` | Promotion |
| `activate` proves identity and read-only before switching; read-only `status` mode | `scripts/ovh-private-repo-ssh.sh` | Promotion (the host runs the script from its promoted checkout) |
| Rollback accepts liveness from an adapter without `/ready` | `scripts/ovh-core-health.sh` | Not part of this promotion. It belongs to this branch's Core and matters when that Core is first promoted |
| Promotion names the previous head and watches the public serving SHA. A green run is not acceptance: step 5 is | `.github/workflows/promote-ovh-production.yml` | When it is on `main`. It is not something the host runs |

## Step 1. Freeze the production schema and confirm the live attestation

**Who:** OWNER. **Where:** PRODUCTION READ.

1. From now until step 5 passes, apply no migration to `zmnhbrjyhxzhkxmhkexs`. Decide first whether `media_operation_claims_v2` or anything else must go in. Each ledger advance needs its own contract and its own promotion, because the attestation exposes only a count, the latest row and a hash. A merge counts as applying: the Supabase GitHub integration applies `supabase/migrations` on every push to `main` (`docs/control-plane/DEPLOYMENT-CONTROLS-PROPOSAL.md`). So merge into `main` no pull request that adds or changes a file under `supabase/migrations` until step 5 passes. Step 3's pull request is the one exception: production has applied its four files already, and Q3 guards the merge.
2. Run query Q3 (below). Confirm the live attestation is exactly:
   - `migration_count` 363
   - `latest_version` `20261109194957`
   - `latest_name` `media_operation_claims_v1`
   - `ledger_sha256` `90b735eb844eaf336df508cd5ecc15b980518c12108ff3f48b9edbf373f552ef`
3. If any value differs, stop. The contract in step 2 must be recut from the live value. Never the other way round.

## Step 2. Build the isolated promotion branch on the deployed commit

**Who:** OWNER, or a session the owner asks. **Where:** REPOSITORY.

The promoted commit must be contained in `main` (the workflow, the reconciler and the verification job each refuse anything else). It does not have to be the tip of `main`. `main` (at `578e6830`) is 251 commits ahead of what OVH runs, with 50 changed Core files, two new job types and four new units. An isolated branch that starts at the deployed commit, is merged with a merge commit and is then promoted by its own head keeps all of that off the host. The commit OVH runs today got there the same way: `9c5b7503` is not on `main`'s first-parent chain. It entered `main` through the merge commit of PR #775 (`968de211`) and was promoted by its own SHA.

`<SRC>` below is the head of `claude/new-session-83ken5` once it holds this change and the 363 import. Check it first:

```bash
git fetch origin
SRC=<the commit id>
git show "$SRC:core/drift-contract.json"            # must read 363, 20261109194957, media_operation_claims_v1, 90b735eb...
git cat-file -e "$SRC:scripts/test/reconcile-cycle-evidence.test.mjs" && echo "hardening present"
git switch -c repair/ovh-core-contract-363 9c5b75032d1794c47d8b6db05acf16e3965faa74
```

**Commit 1, the contract only.** Exactly these thirteen files from `<SRC>`, and one file written by hand:

```bash
git checkout "$SRC" -- \
  core/drift-contract.json \
  supabase/production-ledger.json \
  supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql \
  supabase/migrations/20261109180829_core_signed_nonces_v1.sql \
  supabase/migrations/20261109181623_city_arcade_v1.sql \
  supabase/migrations/20261109194957_media_operation_claims_v1.sql \
  supabase/schema-manifest.json \
  scripts/supabase-local-reset-with-replay.sh \
  scripts/test/production-schema-verifier.test.mjs \
  docs/control-plane/evidence/releases-2026-11-09/COMMERCE-RELEASE-RECEIPT.md \
  docs/control-plane/evidence/releases-2026-11-09/C5-PRODUCTION-RECEIPT.md \
  docs/control-plane/evidence/releases-2026-11-09/MIGRATION-RELEASE-RECEIPT.md \
  docs/control-plane/evidence/releases-2026-11-09/CLAIMS-APPLIED-VERIFICATION.md

cat > docs/control-plane/evidence/ledger-receipts.json <<'JSON'
{
  "_comment": [
    "Migrations applied in production AFTER the latest production-schema-snapshot-<date>.json was captured, each with its dated receipt. scripts/test/production-schema-verifier.test.mjs lets supabase/production-ledger.json run ahead of the snapshot's ledger only for versions listed here, and fails for any listed version the latest snapshot already contains, so this list only shrinks: capturing a new snapshot retires its entries."
  ],
  "applied_after_snapshot": {
    "20261109175747": { "name": "music_direct_asset_versions_v1", "applied_at": "2026-11-09", "receipt": "docs/control-plane/evidence/releases-2026-11-09/COMMERCE-RELEASE-RECEIPT.md" },
    "20261109180829": { "name": "core_signed_nonces_v1", "applied_at": "2026-11-09", "receipt": "docs/control-plane/evidence/releases-2026-11-09/C5-PRODUCTION-RECEIPT.md" },
    "20261109181623": { "name": "city_arcade_v1", "applied_at": "2026-11-09", "receipt": "docs/control-plane/evidence/releases-2026-11-09/MIGRATION-RELEASE-RECEIPT.md" },
    "20261109194957": { "name": "media_operation_claims_v1", "applied_at": "2026-11-09", "receipt": "docs/control-plane/evidence/releases-2026-11-09/CLAIMS-APPLIED-VERIFICATION.md" }
  }
}
JSON
git add docs/control-plane/evidence/ledger-receipts.json
git commit -m "Reconcile the OVH Core contract with the 363-migration production ledger (#510)"
```

Check commit 1 before anything else:

```bash
node scripts/control-plane-drift-contract-check.mjs          # ok, 363
node --test scripts/test/production-schema-verifier.test.mjs scripts/test/rpc-names-exist.test.mjs scripts/test/supabase-replay-transaction.test.mjs
(cd core && npm run check && npm test)                       # 498 tests
```

**Commit 2, the evidence hardening.** Exactly these twelve files from `<SRC>`:

```bash
git checkout "$SRC" -- \
  scripts/mccluster-vps-reconcile.sh \
  scripts/ovh-private-repo-ssh.sh \
  core/src/reconciler-source-receipt.mjs \
  core/src/executors/host-health-collect.mjs \
  core/src/health-verification.mjs \
  core/test/health-verification.test.mjs \
  core/test/reconcile-cycle-health.test.mjs \
  core/test/reconcile-cycle-receipt.test.mjs \
  scripts/test/reconcile-cycle-evidence.test.mjs \
  scripts/test/ovh-private-repo-ssh.test.mjs \
  docs/control-plane/OVH-PRIVATE-GITHUB-RECONCILE.md \
  docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md
git commit -m "Reconcile cycle receipts, health projection and read-only deploy-key proofs (#510)"
```

Check commit 2:

```bash
# One file per bash -n: it parses only its first file, the rest are that script's arguments.
bash -n scripts/mccluster-vps-reconcile.sh
bash -n scripts/deploy-ovh-core.sh
bash -n scripts/ovh-core-health.sh
bash -n scripts/ovh-private-repo-ssh.sh
(cd core && npm run check && npm test)                       # 527 tests
node --test scripts/test/*.test.mjs
git diff --stat 9c5b75032d1794c47d8b6db05acf16e3965faa74 HEAD -- core/src core/systemd
# must list exactly: host-health-collect.mjs, health-verification.mjs, reconciler-source-receipt.mjs
```

All eight pre-existing files of commit 2 are byte-identical at `9c5b7503`, on `main` and on this branch before the change, so checking them out gives exactly the deployed file plus this change, and the merge into `main` cannot conflict on them.

**What the isolated branch must not carry, and why.** Each reason below was checked by running the tests on an export of `main` plus the files above.

- `supabase/pending/live-callers.json` and `scripts/test/rpc-names-exist.test.mjs` from this branch. They describe this branch's code. On `main` the test fails with entries such as "action_environment_missions is no longer called by shipped code: remove it from pending_only".
- A new production snapshot (`docs/control-plane/evidence/production-schema-snapshot-2026-11-09.json`). On `main` it makes `arcade_command` count as deployed while `main`'s own `live-callers.json` still lists it as pending only, and `rpc-names-exist` fails with "arcade_command is now deployed ... remove it from pending_only". That is why the ledger runs ahead of the 3 November snapshot through the four receipt entries instead.
- This branch's own `docs/control-plane/evidence/ledger-receipts.json`. It is empty there, because this branch does carry the new snapshot. The isolated branch needs the four entries written above.
- `scripts/ovh-core-health.sh`, `scripts/deploy-ovh-core.sh`, `core/src/system-health.mjs` and `core/test/deploy-rollback-recovery.test.mjs`. The first three differ on this branch for other reasons (this branch's `/ready` deploy gate and its health states), and the test covers this branch's health script. None of them is part of what this promotion puts on the host.
- `.github/workflows/promote-ovh-production.yml` and `scripts/test/ovh-self-management.test.mjs`. The workflow file differs between `9c5b7503` and `main`, and the host does not run it. It reaches `main` with PR #793 or with its own pull request cut from `main`.
- Anything under `workers/`, and anything else.

**What was checked offline on 2026-11-10, in a throwaway clone and in exports, with nothing pushed.** Last re-run with `<SRC>` at the head of the second review's workflow and runbook fixes, which added four tests to `scripts/test/ovh-private-repo-ssh.test.mjs`. Any later change to the files of commit 2 changes these counts:

- These exact commands produce commit 1 with 14 files and commit 2 with 12 files.
- On `9c5b7503` plus commit 1: the drift check passes at 363, the three ledger tests pass (14 tests), Core check passes, Core is 498 of 498.
- On `9c5b7503` plus both commits: each of the four scripts passes `bash -n` on its own (the reconciler and the setup script as commit 2 takes them, the deployer and the health library as `9c5b7503` has them), Core check passes, Core is 527 of 527, and the root suite is 1613 tests with 1610 passing and 3 skipped.
- `git merge --no-ff` of that branch into `main` at `578e6830` has no conflict. On the merge: the drift check passes, Core is 584 of 584, and the root suite is 2068 tests with 2065 passing and 3 skipped.
- Not run: the Supabase CLI reset and every database-backed workflow. The regenerated `supabase/schema-manifest.json` is unproven until the pull request's own CI.

## Step 3. Pull request to main, exact-head CI, merge commit

**Who:** OWNER merges. A session may push the branch and open the pull request if the owner asks. **Where:** REPOSITORY, and the pull request on github.com.

1. Push commit 1 alone and open the pull request from `repair/ovh-core-contract-363` to `main`, scoped to #510. Wait until its checks finish. That gives the contract-only commit its own green checks, so it can be promoted on its own if the owner prefers two smaller promotions.
2. Push commit 2. Wait until its checks finish. Its head is `X` below.
3. Never push a "merge main into branch" commit onto this branch. It changes the head and can cancel the runs of the isolated commit. If GitHub reports a conflict, stop: `main` has changed one of these files.
4. Require green on the exact head. The promotion gate reads these ten checks on that SHA (`docs/control-plane/deploy-gate.json`): `architecture`, `contracts`, `scan`, `smoke`, `Worker contracts`, `McCluster Core contracts`, `Equity Uprise Edge Function contracts`, `Admin evidence and pending SQL contracts`, `Equity Uprise RLS wall and offline function contracts`, `Supabase migration reset`. Also expect the drift guard, `production-boundaries` and the path-triggered database workflows to run.
5. If `Supabase migration reset` reports manifest differences, download its `reset-schema` artifact, commit that `schema-manifest.json` unchanged, and take the new head as `X`.
6. Run Q3 once more immediately before merging. If any of the four migration files were committed under a version production does not hold, the Supabase GitHub integration would apply it to production on merge. The `90b735eb...` hash is the guard.
7. Merge with **Create a merge commit**. Never squash and never rebase: either leaves `X` outside `main`, and the workflow and the host both refuse it.
8. Confirm:

```bash
git fetch origin
git merge-base --is-ancestor <X> origin/main && echo "X is in main"
git merge-base --is-ancestor 9c5b75032d1794c47d8b6db05acf16e3965faa74 <X> && echo "fast-forward from the deployed commit"
```

Expect on the merge to `main`: GitHub Pages republishes (it does on every push). The Worker does not redeploy from this change, because nothing under `workers/` changed, unless the repository variable `WORKER_DEPLOY_MODE` is `github-gated`, in which case the Worker workflow redeploys `main`'s unchanged Worker source. The Supabase integration runs with nothing to apply. OVH does nothing until step 4.

## Step 4. Promote through the sanctioned workflow

**Who:** OWNER. **Where:** GITHUB ACTIONS.

Pick a window first. A promotion is not zero-downtime, even when only the contract changes, because the broker's serving SHA is bound when it starts:

- The host picks the new ref up within about 2 minutes 20 seconds.
- It runs Core check and tests, then drains the Core runner and the compute node for up to 660 seconds.
- It restarts the tool broker, the compute gateway, the Ollama adapter, the compute node, the runner and the preview gateway. Queue consumption pauses and in-flight broker HTTP calls can be cut.
- If the release fails its gate, the previous release is restored and the reconciler tries again every two minutes, with a fresh drain each time and no backoff, until the ref names a release that passes. The ref only moves forward: see "To go back, go forward" below.

Decide one promotion or two. One: promote `X` (commit 2), one drain. Two: promote commit 1 first, pass step 5, then promote `X`, two drains and a smaller first change.

Actions, **Promote OVH Production Ref**, Run workflow on `main`:

| Input | Value |
| --- | --- |
| `sha` | `X` (or commit 1 for the first of two promotions) |
| `confirm` | `PROMOTE_OVH` |
| `allow_rollback` | false |
| `expected_current` | `9c5b75032d1794c47d8b6db05acf16e3965faa74` for the first promotion. This input exists only once the workflow change of this branch is on `main`. |

The workflow refuses unless the target is contained in `main`, the current ref is an ancestor of it, Core check and tests pass at the target, and the ten checks are green on that exact SHA.

- If the workflow on `main` has the `observe` job, the run waits up to 30 minutes for `https://core.mccluster.org/health` to serve the target, then requires it to keep serving the target for 20 minutes. It goes red if the target is never served, or if any other commit is served after it.
- **A green run is not acceptance.** The deployer writes the target's manifest and restarts the broker before its own health gate, so `/health` serves the target even for a release that then fails the gate. The 20-minute hold is longer than the deployer's bounded waits in one failing attempt (the gate's probes, a producer drain of up to 660 seconds, the Ollama wait), so a release that is rolled back turns the run red. But a rollback whose producer drain times out is deferred and leaves the failed release live, serving the target, and no poll of `/health` can tell that from a success. Step 5 is acceptance: `deployed_sha` equal to the serving SHA, and `runtime_verification` = `verified`.
- If the workflow on `main` has no `observe` job, the push starts no observation at all (GitHub starts no workflow from a `GITHUB_TOKEN` push). Step 5 is the same either way.

**To go back, go forward.** If the promoted release fails because of commit 2, commit on `repair/ovh-core-contract-363` a revert of commit 2 alone (`git revert --no-edit <commit 2>`). Push it, require green on its exact head as in step 3, merge it with a merge commit, and promote that head with `allow_rollback` = false and `expected_current` = the SHA it replaces. It keeps the contract, the ledger and the four migration files.

- Never revert commit 1. It adds four migration files that production has applied, and the revert would delete them.
- A revert of `core/drift-contract.json` alone does not pass either. The drift check requires the contract to equal `supabase/production-ledger.json`, so CI fails and the promotion's gate refuses the commit. A contract that turns out wrong is recut from the live attestation (step 1.3) and promoted forward the same way.
- Until that promotion lands, the host keeps retrying the failed release every cycle, as described above.

`allow_rollback` = true is not a way back. It moves `deploy/ovh-production` by force (a non-fast-forward push under a lease), which the never-list forbids. It needs the owner's explicit exception, recorded on #510, and acceptance E then does not hold. GitHub refuses it once force pushes are blocked on the ref (ruleset B in `docs/control-plane/DEPLOYMENT-CONTROLS-PROPOSAL.md`). Do not move the ref by hand. Do not use `DEPLOY_OVH` unless the reconciler itself cannot run: that is the documented break-glass path under the `ovh-production` environment.

**What to expect from the hardening on the first cycles.** The cycle that performs the deploy is still the old reconciler and writes no receipt. The next cycle is the new one. Until it has run, `deployment.reconcile.status` is `unverified`, which adds no warning.

## Step 5. Verify the runtime and the contract from data

**Who:** OWNER, or anyone the owner gives read access. **Where:** PRODUCTION READ and one public URL.

1. Within about 30 minutes `https://core.mccluster.org/health` must return `ok=true` with `deployment_sha` equal to the promoted SHA.

```bash
curl -fsS https://core.mccluster.org/health
```

2. Wait for the next five-minute health run, or have the owner request one refresh (`POST /v1/ai/system-health`). Then run Q1 and Q2.
3. Require acceptance A (below) on two consecutive rows, and Q2 returning no rows.
4. With the hardening promoted, also require `deployment.reconcile.status` = `verified`. Before step 6 the transport is `https` and `authenticated` is false. That is correct: the host still fetches the public repository anonymously.
5. `last_deploy_at` must be the promotion time.
6. Record the job ids and values on #510.

Only after this passes may another production migration be applied.

## Step 6. Read-only deploy key, through the host-only script

**Who:** OWNER. **Where:** HOST and GITHUB SETTINGS.

Do this only after step 4 has put the hardened script on the host. Check first, on the host:

```bash
sudo grep -cF 'prepare|activate|status' /var/lib/mccluster/reconcile/source/scripts/ovh-private-repo-ssh.sh
```

It must print 1. If it prints 0, the host still has the old script, whose `activate` switches the transport after reading two refs and proves neither whose key it is nor that it cannot write. Stop and promote first.

**The GitHub host key the script pins.** The script accepts only GitHub's Ed25519 host key, fingerprint `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`. Before `activate`, compare that fingerprint with the one GitHub publishes on its "GitHub's SSH key fingerprints" documentation page. If they differ, stop: do not edit the script on the host, and do not switch.

**If GitHub rotates that key** after the switch, every cycle fails host-key verification and the host stops updating. While the repository is still public, go back to HTTPS with `sudo rm /etc/systemd/system/mccluster-vps-reconcile.service.d/50-github-readonly-ssh.conf && sudo systemctl daemon-reload`; the next cycle fetches over HTTPS, and a promoted script with the new key can then be activated again. Once the repository is private, that HTTPS path no longer works, so a rotation needs a break-glass update of the script on the host. This is one more reason step 8 waits until the SSH path is proven.

**Exit status of the script**, in every mode: 0 done (for `status`, every proof holds); 1 `status` found a proof that does not hold; 2 a precondition (not root, unknown mode, a missing command, a key or known-hosts file that is a symlink or has the wrong owner); 3 `activate` refused a proof, and nothing on the host changed; 4 `activate` could not complete the switch. On 4 the previous transport is in place: either nothing was changed (a reconcile cycle that was already running did not end within 21 minutes), or the script put it back itself and says so (systemd did not reload; the first cycle failed, or its receipt does not show a new cycle over SSH with this key). When only the timer is inactive, the switch has completed over SSH and the timer needs starting.

1. On the host:

```bash
sudo bash /var/lib/mccluster/reconcile/source/scripts/ovh-private-repo-ssh.sh prepare
```

   It prints only the public key and its fingerprint. The private half never leaves the host and is never pasted anywhere.
2. In GitHub, repository Settings, Deploy keys, add that public key with **Allow write access** OFF.
3. Compare the fingerprint GitHub shows with the host's:

```bash
sudo ssh-keygen -lf /var/lib/mccluster/reconcile/ssh/github_deploy_ed25519.pub -E sha256
```

4. Remove any older OVH deploy key that is no longer used. The key created on 2026-10-18 at another path was never confirmed.
5. On the host:

```bash
sudo bash /var/lib/mccluster/reconcile/source/scripts/ovh-private-repo-ssh.sh activate
```

   It proves, before it changes anything: both refs are readable over SSH; GitHub greets the key as `mcclusterishere/mccluster`; GitHub refuses the key for writing (a dry-run push, nothing is sent); and the reconciler's Git does not rewrite the SSH URL. It then waits until no reconcile cycle is running: a cycle the timer has already started keeps the transport it started with, and a start request would join that cycle instead of running a new one. Then it installs the drop-in, reloads systemd and starts one cycle by hand. It prints "switched to authenticated read-only GitHub SSH" only when that cycle's receipt (`last-cycle.json`, named by the unit's invocation id) shows a successful fetch over SSH with the pinned host key and this key's fingerprint, and it prints that cycle's id.

| If `activate` says | It means | Do |
| --- | --- | --- |
| `GitHub greets this key as '<login>'` | The key is registered on a personal account | Remove it there. Add it under the repository's Deploy keys |
| `The deploy key has WRITE access` | "Allow write access" is on | Turn it off, run `activate` again |
| Git's `fatal: Could not read from remote repository`, followed by `Cannot read the repository over SSH (is the deploy key added, and is TCP 22 to github.com open?).`, and exit status 3 | The public key is not registered with GitHub, or the host cannot reach github.com on TCP 22 | Check the deploy key was added. Check outbound port 22. Nothing was changed |
| `GitHub's greeting was not recognised` followed by `GitHub answered: ...` | GitHub answered in words the script does not know | Read the answer line. See "First real run" below |
| `Could not prove the deploy key is read-only` followed by `The dry-run push answered: ...` | GitHub refused in words the script does not know | Read the answer line. See "First real run" below |
| `Git configuration on this host rewrites ...` | A `url.*.insteadOf` rule would send the fetch elsewhere | Remove the rule from the reconciler's Git configuration |
| `did not complete its first cycle after the switch` | The first cycle over SSH failed. The script has already put the previous transport back and says so | Read the journal line it prints, fix the cause, and run `activate` again |
| `was not a new cycle over SSH with this key` | The cycle the start waited for was one the timer had started on the old transport, or the reconciler on the host writes no cycle receipts (step 4 has not put the hardened reconciler there). The script has already put the previous transport back | Check that `/var/lib/mccluster/reconcile/last-cycle.json` exists and is recent, then run `activate` again |
| `A reconcile cycle has been running for over 21 minutes` | A cycle, usually a deploy, was still running. Nothing was changed | Run `activate` again when it has ended |

**To go back while the repository is public:**

```bash
sudo rm /etc/systemd/system/mccluster-vps-reconcile.service.d/50-github-readonly-ssh.conf
sudo systemctl daemon-reload
```

Without the drop-in the unit falls back to its default `MCCLUSTER_REPO_URL`, the anonymous HTTPS URL in `core/systemd/mccluster-vps-reconcile.service`, which can read the repository only while it is public. Once it is private, switch visibility back to public first (step 8.5), then remove the drop-in.

**First real run: confirm the two GitHub answers.** The script depends on two texts that could not be exercised where it was written. Both are matched in one place each, and anything else is refused.

- The greeting. To see it yourself, read-only, on the host:

```bash
sudo /usr/bin/ssh -F /dev/null -i /var/lib/mccluster/reconcile/ssh/github_deploy_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/var/lib/mccluster/reconcile/ssh/github_known_hosts -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o ConnectTimeout=20 -T git@github.com
```

   Expected, with exit status 1: `Hi mcclusterishere/mccluster! You've successfully authenticated, but GitHub does not provide shell access.` Only the opening `Hi mcclusterishere/mccluster!` is matched.
- The read-only refusal. Expected from GitHub: `ERROR: The key you are authenticating with has been marked as read only.` The script needs "key" and "marked as read only" on one line. You do not need to push anything by hand to see it: when the script cannot recognise the answer it prints the answer.
- If a correctly registered key is refused because the wording changed, record the answer line on #510 and change `GITHUB_GREETING_PATTERN` or `GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN` in the script through a reviewed commit and a promotion. Never bypass the check, and never run a push without `--dry-run`.
- When `activate` succeeds and `status` later exits 0, both answers were recognised on the real host. Record the `status` output on #510: that is the confirmation.

## Step 7. Prove SSH is really used and capture two timer-triggered receipts

**Who:** OWNER. **Where:** HOST, then PRODUCTION READ.

The cycle `activate` starts is started by hand. It is recorded as `trigger: other` and does not count. Wait about five minutes for two timer cycles, then on the host:

```bash
sudo bash /var/lib/mccluster/reconcile/source/scripts/ovh-private-repo-ssh.sh status
echo "exit status: $?"
```

`status` changes no key, unit, drop-in or transport. It does create and remove a throwaway probe repository in the key directory and opens three SSH sessions to GitHub, one of them a push dry run that sends nothing. It exits 0 only when every proof holds, and `proofs_unproven=` names whatever does not. Exit 0 means acceptance B and the host side of acceptance C. The lines to read:

| Line | Must be |
| --- | --- |
| `key_fingerprint` | The fingerprint GitHub shows for the one read-only deploy key |
| `github_host_key` | `pinned` |
| `dropin` | `installed` |
| `effective_repo_url` | `git@github.com:mcclusterishere/mccluster.git` |
| `effective_ssh_command` | `pinned_deploy_key` |
| `git_url_rewrite` | `none` |
| `checkout_origin` | `git@github.com:mcclusterishere/mccluster.git` |
| `github_identity` | `deploy_key_of_mcclusterishere/mccluster` |
| `write_access` | `denied_read_only` |
| `ssh_main_sha`, `ssh_promoted_sha` | Two commit ids. The second equals the promoted SHA |
| `reconcile_timer` | `active` |
| `last_verified_cycle` | `ssh_with_this_key_and_fresh` |
| `timer_cycle` (one line per cycle) | At least two, with different cycle ids |
| `timer_cycles_over_ssh_with_this_key` | 2 or more |
| `status` | `proven` |

Cross-check on the host:

```bash
sudo systemctl --version | head -n 1
sudo journalctl -u mccluster-vps-reconcile.service --since "-15 min" -o json | grep -o '"_SYSTEMD_INVOCATION_ID":"[^"]*"' | sort -u
sudo git -C /var/lib/mccluster/reconcile/source remote get-url origin
sudo tail -n 3 /var/lib/mccluster/reconcile/cycles.jsonl
```

The invocation ids in the journal are the `cycle_id` values of the receipts. On systemd 252 or later the trigger reads `timer`, which is systemd's own statement. On older systemd it reads `timer_inferred`.

Then from data, after the next health run: run Q5 and require acceptance C. Record the `status` output, the cycle ids, the fingerprint and the job ids on #510. No key material.

If the hardening is not on the host, there is no `status` mode and there are no receipts. The only evidence is then host-side: for two cycles, pair `systemctl show mccluster-vps-reconcile.timer -p LastTriggerUSec` with `systemctl show mccluster-vps-reconcile.service -p ExecMainStartTimestamp -p InvocationID`, and paste the lines on #510.

## Step 8. Optional: make the repository private, then close #510

**Who:** OWNER. **Where:** GITHUB SETTINGS. Optional, and only after acceptance B and C hold.

1. Decide whether closing #510 requires the repository to be private. The comment of 2026-11-07 reads "before and after any approved private visibility change".
2. If yes, check the plan consequences first: GitHub Pages for a private repository, and metered Actions minutes. `matthew.mccluster.org` is published from this repository.
3. Switch visibility. Then repeat step 5 and step 7 and require acceptance D.
4. While private, Core's anonymous REST source check fails every time and health relies on the receipts. The `repo_health` and `code_patch` clones need their own access.
5. If a cycle fails, switch back to public at once and keep #510 open.
6. Post the before and after evidence on #510: job ids, cycle ids, the fingerprint, SHAs. No key material. Close the issue only then.

Afterwards, in PR #793: retire the four receipt entries with the new production snapshot, remove `main`'s stale `supabase/pending/city_arcade_v1.sql` and its `arcade_command` allowlist entry, and resolve any add/add difference in `ledger-receipts.json` or the manifest in favour of the newer evidence.

## Verification queries

Read-only. Each narrows the rows by indexed columns before it reads the output JSON: reading the JSON first cost 51.7 seconds in production.

Q1, the latest three diagnostics:

```sql
with latest as materialized (select id from public.ops_agent_jobs where job_type='host_health' and status='done' and updated_at > now() - interval '2 hours' order by updated_at desc, id desc limit 3)
select j.id, j.created_at, j.output->'completion_evidence'->>'started_at' as started_at, j.output->'completion_evidence'->>'completed_at' as finished_at, j.output->>'checked_at' as checked_at, j.input->>'requested_by' as requested_by, j.output->>'overall' as overall, j.output->'health_sections'->'infrastructure'->>'status' as infrastructure_status, j.output->'deployment'->>'deployed_sha' as deployed_sha, j.output->'runtime_checks'->'local_core'->>'http_status' as local_http, j.output->'runtime_checks'->'local_core'->>'deployment_sha' as local_serving_sha, j.output->'runtime_checks'->'public_core'->>'http_status' as public_http, j.output->'runtime_checks'->'public_core'->>'deployment_sha' as public_serving_sha, j.output->'deployment'->>'runtime_verification' as runtime_verification, j.output->'supabase'->'migration_attestation'->>'parity' as migration_parity, j.output->'supabase'->'migration_attestation'->'expected'->>'migration_count' as expected_count, j.output->'supabase'->'migration_attestation'->'live'->>'migration_count' as live_count, j.output->'supabase'->'migration_attestation'->'expected'->>'ledger_sha256' as expected_ledger_sha256, j.output->'supabase'->'migration_attestation'->'live'->>'ledger_sha256' as live_ledger_sha256, j.output->'source'->>'verification_method' as source_verification_method, j.output->'source'->>'observed_at' as source_observed_at, j.output->'source'->>'github_promoted_sha' as github_promoted_sha, j.output->'source'->>'error' as source_error, j.output->'deployment'->'last_success'->>'deployed_at' as last_deploy_at, j.output->'deployment'->'last_success'->>'deployed_sha' as last_deploy_sha, j.output->'services'->>'vps_reconcile_timer' as reconcile_timer
from latest l join public.ops_agent_jobs j on j.id=l.id order by j.updated_at desc;
```

Q2, the infrastructure issues of the latest diagnostic:

```sql
with latest as materialized (select id from public.ops_agent_jobs where job_type='host_health' and status='done' and updated_at > now() - interval '2 hours' order by updated_at desc, id desc limit 1)
select i->>'component' as component, i->>'code' as code, i->>'severity' as severity from latest l join public.ops_agent_jobs j on j.id=l.id, jsonb_array_elements(j.output->'health_sections'->'infrastructure'->'issues') as i;
```

Q3, the contract row and the live ledger:

```sql
select schema_version, migration_version, updated_at from public.ops_system_contract where singleton;
select public.system_migration_attestation() as live;
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
```

Q4, the verification method across the monitor's window:

```sql
with w as materialized (select id from public.ops_agent_jobs where job_type='host_health' and status='done' and updated_at >= timestamptz '2026-11-09 20:45:00+00' and updated_at < timestamptz '2026-11-09 22:00:00+00')
select j.id, j.updated_at, j.output->'source'->>'verification_method' as method, j.output->'source'->>'observed_at' as source_observed_at, j.output->'source'->>'error' as source_error from w join public.ops_agent_jobs j on j.id=w.id order by j.updated_at;
```

Q5, the cycles, only after the hardening is promoted:

```sql
with latest as materialized (select id from public.ops_agent_jobs where job_type='host_health' and status='done' and updated_at > now() - interval '1 hour' order by updated_at desc, id desc limit 1)
select c->>'cycle_id' as cycle_id, c->>'trigger' as trigger, c->>'outcome' as outcome, c->>'transport' as transport, c->>'authenticated' as authenticated, c->>'ssh_key_fingerprint' as key_fingerprint, c->>'deployed_sha' as deployed_sha, c->>'finished_at' as finished_at, j.output->'deployment'->'reconcile'->>'status' as reconcile_status, j.output->'deployment'->'source_fallback'->>'github_rest_error' as rest_error
from latest l join public.ops_agent_jobs j on j.id=l.id, jsonb_array_elements(j.output->'deployment'->'reconcile'->'recent_successful') as c order by c->>'finished_at';
```

## Acceptance for closing #510

**A. Contract.** Two consecutive `host_health` rows after the promotion with `infrastructure_status` = `ok`, `migration_parity` = `true`, `expected_count` = `live_count` = 363, both ledger hashes `90b735eb844eaf336df508cd5ecc15b980518c12108ff3f48b9edbf373f552ef`, `deployed_sha` = `local_serving_sha` = `public_serving_sha` = the promoted SHA, `local_http` = `public_http` = 200, `runtime_verification` = `verified`, `reconcile_timer` = `active`. Q2 returns no rows.

**B. Authentication.** `status` on the host exits 0 and prints `effective_repo_url=git@github.com:mcclusterishere/mccluster.git`, `effective_ssh_command=pinned_deploy_key`, `checkout_origin` with the same SSH URL, `git_url_rewrite=none`, `github_host_key=pinned`, `github_identity=deploy_key_of_mcclusterishere/mccluster`, `write_access=denied_read_only`, and a `key_fingerprint` equal to the one GitHub shows for the single read-only deploy key.

**C. Cycles.** At least two distinct `cycle_id` values with `trigger` `timer` or `timer_inferred`, `outcome` `verified_no_change` or `deployed`, `transport` `ssh`, `authenticated` true, the same key fingerprint as in B, finished at least two minutes apart and after activation. Visible through Q5, in `status`, and in the journal.

`authenticated` on its own means GitHub accepted that key over SSH with the pinned host key. While the repository is public it does not mean the key is this repository's deploy key or that it is read-only. B proves those. C counts only together with B and the same fingerprint.

**D. Only if the owner approves a private switch.** B and C repeated while private, with `source_verification_method` = `ovh_reconciler_git_fetch_receipt`, `rest_error` containing `Not Found`, and `infrastructure_status` still `ok`.

**E. Clean path.** No break-glass deploy and no forced ref move: every move of `deploy/ovh-production` was a forward promotion with `allow_rollback` = false. The evidence is recorded on #510.

## Never

- Delete rows from `supabase_migrations.schema_migrations`, or delete applied SQL files.
- Replay applied SQL.
- Hand-edit a ledger hash to anything the live attestation does not return.
- Squash or rebase the isolated pull request.
- Move the deploy ref by hand or by force. A run with `allow_rollback` = true is a forced move: it needs the owner's explicit exception, recorded on #510, and it is refused once force pushes are blocked on the ref.
- Run `DEPLOY_OVH`, except as the documented break-glass path under the `ovh-production` environment.
- Add an always-on SSH deploy from GitHub to the host.
- Use `ssh-keyscan`, `StrictHostKeyChecking=no`, or a token in a Git URL.
- Copy, print, paste or commit the private key or any other secret.
- Enable write access on the deploy key.
- Run the write probe, or any push with this key, without `--dry-run`.
- Make the repository private before B and C hold.
- Apply another production migration between cutting the contract and passing step 5.
- Merge into `main` a pull request that adds or changes a file under `supabase/migrations` before step 5 passes: the Supabase integration applies it on the push. Step 3's pull request is the one exception, guarded by Q3.
- Lower a severity, or special-case a count, to turn health green.
- Edit `/opt/mccluster/core/drift-contract.json` or a receipt file on the host.

## What is not proven without the real host

Everything below was built and tested against fakes. Each item is confirmed, or found wrong, by the step named.

| Not proven | Confirmed by |
| --- | --- |
| GitHub's greeting for a deploy key (`Hi <owner>/<repository>!`) | Step 6, `activate`; step 7, `github_identity` |
| GitHub's refusal text for a read-only deploy key on a push | Step 6, `activate`; step 7, `write_access` |
| How the host's systemd prints the unit's `Environment` (quoted, or with `\x20`). Any other form reads `effective_ssh_command=not_pinned` | Step 7 |
| That the host's systemd passes `TRIGGER_UNIT` to a timer-started unit (version 252 or later; the documented host is Ubuntu 26.04) | Step 7, `systemctl --version` and `trigger` in the receipts |
| The inference used on older systemd (two-second window, one cycle per timer elapse). It reads the timer's last elapse with `busctl` from the system bus, because `systemctl show` prints that value as a time span; a short no-change timer cycle that reads `other` there usually means the D-Bus read failed (a cycle that runs past the next timer elapse, or starts more than 2 s after it, also reads `other`) | Step 7, only on systemd older than 252: timer cycles must read `timer_inferred` |
| The host's `timeout`, `tail` and `date` behaving as the evidence writer expects. If they do not, receipts are missing or say less; the cycle is unaffected | Step 5: `deployment.reconcile.status` leaves `unverified` |
| Receipt files written under the unit's sandbox and readable by the Core runner | Step 5, the same |
| The new Core tests passing as root inside the reconciler unit during the deploy. They run before anything live changes. A failure refuses the deploy and leaves the running release untouched | Step 4 and step 5 |
| Behaviour when systemd itself terminates a cycle. Tested here with SIGTERM to the process group and a fixture deployer, not with systemd | Not exercised by this runbook |
| Outbound TCP 22 from the host to github.com. The script has no `ssh.github.com:443` fallback | Step 6 |
| That `systemctl show --property=InvocationID` still names the cycle that just ended once the oneshot unit is inactive. `activate` compares it with the receipt's `cycle_id`; if they differ it puts the previous transport back and exits 4, so a wrong assumption fails closed | Step 6, `activate` |
| The regenerated schema manifest, the Supabase reset job and the database-backed workflows on the isolated pull request | Step 3 |
| The promotion workflow change. It was not dispatched, and `actionlint` was not run | Its first use in step 4 |
| The text of the REST error when the repository is private | Step 8, Q5 |
| `shellcheck` on the three scripts. It is not installed where this was written | Run it locally before step 3 if available |
