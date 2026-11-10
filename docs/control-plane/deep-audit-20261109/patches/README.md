# Patch series for findings on other pull requests

Some deep-audit findings live in code that only exists on another open pull request's head. This branch cannot
push to those branches, so each fix is kept here as a `git format-patch` series cut against that PR's head, with a
`MANIFEST.json` recording the base, the files, what failed before, what passes after, and what was not run. Nothing
here is applied, merged or deployed.

| PR | Findings | Cut against (the PR head; unchanged when checked on 2026-11-10) | Series | Proof (details in the manifest) |
| --- | --- | --- | --- | --- |
| [#760](https://github.com/mcclusterishere/mccluster/pull/760) privacy agree or go back | A3, A4 | `8c7d60db90935659418ef1f1e6308913ced5febc` | `pr-760-a3-a4/` (3 patches: fix, tests, docs) | unit 31/31 (23/31 on the base); real-Chromium back/forward-cache, other-tab and handoff journeys; mutation matrix |
| [#758](https://github.com/mcclusterishere/mccluster/pull/758) Chem 108 guest trial | W4 | `90ce7c4ce2debf02586bc52672e3813faff2eac5` | `pr-758-w4/` (2 patches: fix, tests; the lane's evidence logs in `evidence/`) | trial account suite 23/23, six runs; browser coverage for late account answers |
| [#789](https://github.com/mcclusterishere/mccluster/pull/789) Control editor presentation (stacked on #788) | A6 | `5f5766ee7c3e1b538263f368e588f429a7a19639` | `pr-789-a6/` (1 patch) | helper and adapter 23/23 (9 and 9 failed on the base); recovery journey 104/0, repeated (24 passed, 22 failed on the base); admin layout journey 184/184. The Control shell journey (`control-room-nav.e2e.mjs`, 214/214) loads none of the patched files, so it is not A6 proof |
| [#787](https://github.com/mcclusterishere/mccluster/pull/787) PRIM3 square/hex learning | W5 | `cf8c3cc7f642bf7e48a4b5e042df1e24203d2ecf` | `pr-787-w5/` (2 patches: the published runtime, the 12 ft frame; evidence in `evidence/`) | the PR's unit files 19/19 (two new tests fail on the base); Worker PRIM3 105/105; merged with this branch, the published-import closure test fails without the series and passes with it; Chromium topology journey 8/8, and a stripped export boots only with the series. The PR's PostgreSQL harness was not run (no Docker) |
| [#734](https://github.com/mcclusterishere/mccluster/pull/734) actor evidence and coverage | C8 | `8255fb35bb1821df74411e9ec726139c8b23c727` | `pr-734-c8/` (2 patches: the coverage fix, the queue-to-coverage contract test; evidence in `evidence/`) | Core 483/483 on Node 22 and 24 (475 on the base); contract and coverage files 17/17 three times, 10 pass and 7 fail with the base reader; mutation check (the writer storing `completed` is caught only by the contract test) |

Each series was checked to apply with `git am` on its base on 2026-11-10. The close-out verification of the same day checked the first three again against the local ref of its PR head and corrected the #789 manifest (see the ledger's A6 row); the #787 and #734 series were each checked by an independent skeptic, who corrected their manifests in place (recorded in each manifest's notes). None of these checks had a live view of GitHub, so none confirms that the live PR heads are still these commits.

## Applying one

```sh
git fetch origin pull/760/head
git switch -c apply-760 FETCH_HEAD          # must be the "cut against" commit above
git am docs/control-plane/deep-audit-20261109/patches/pr-760-a3-a4/*.patch
# run the manifest's commands, then push to the PR's own branch (the PR owner's step)
```

If the PR head has moved, rebase the series (`git am -3`) and rerun the manifest's commands before pushing.

## Not prepared here

| Item | Where | Why not here, and the next step |
| --- | --- | --- |
| COM-3 | #782 | A design change, not a patch: persist attempt state and the provider outcome, allow recovery only for a verified pre-session rejection, add an operator reconciliation queue. Needed before paid activation of the customer stack. |
| A7 | `main`, this branch's pending SQL, #776, #789 | An owner decision first: whether a retained owner keeps break-glass access to a disabled house. The ledger's A7 row lists which Worker and SQL checks keep access and which refuse today, what each outcome needs (refusing needs a new migration for the applied `arcade_command`) and the tests either needs. |
| #792 | #792 | Not a defect patch. #792 changes `core/src/digest.mjs` and `objective-reflection.mjs`, which this branch also changes (window identity, the duplicate-window rule, the lease checkpoint); it needs a rebase onto whichever lands first. |

## Limits

Chromium only (headless, software GL); no Firefox, WebKit or device; no authenticated live owner session; every
service answer was a fixture; no GitHub Actions run on the patched heads, because nothing was pushed to them.
