# Friday review: applied mathematics and network recovery

> Publication update (2026-11-11): draft PR publication is now authorized. Source [PR #24](https://github.com/mcclusterishere/Prim3/pull/24) is published at `2fe190a742f15beb5eb5b3b195c10f2aa64f0eab`; SOURCE.json and replay pins use that commit. The application is rebased on `8e631683b6960fee283ea923c22b1d72cfd09495`, preserving current model/timing fixes. Local-only restrictions, pins and blocked publication statements below record earlier checkpoints and are superseded for draft publication only. Merge, deployment and browser/device acceptance remain outstanding.

Target: Friday, November 13, 2026, America/New_York. **Historical Friday checkpoint, now included in draft PR review.** No merge, deployment, paid compute, live-system configuration or Drive change is authorized or performed by this work.

## Start and play

From this application checkout run `node scripts/prim3/local-network-review.mjs`, then open `http://127.0.0.1:8873/?lab=network&view=2d` and choose **Start disposable local review**. The server binds only 127.0.0.1:8873, checks Host, accepts GET only, serves an allowlist, and blocks network connections with CSP. It substitutes an explicit review bootstrap only in its response; the actual page retains its normal owner gate. This is a developer review harness, not a new backend or proof of authenticated ownership. Stop with Ctrl-C. No account credentials are needed or created.

The training mode lives in the existing hex tactical page. Eliminate or contain the simulated opposition, and move Technical to R. Recon inspects topology within 12 m of X. Entry must hold power access within 7.1 m of X each turn that Technical works. Technical must be within 3.55 m of R. Each inspect/hold/configure/verify/reset/hint costs one AP. Re-reading earned evidence is free.

Use the earned allocated subnet, host count and traffic telemetry to edit prefix, gateway and reserved Mbps. Preview the exact change, then Confirm. Bad authorized settings persist and can damage a previously working route. Verify is a distinct fresh action; stale results are cleared by configuration attempts. Verified recovery opens extraction and pauses service-window pressure consistently before clock resolution; it does not remove combat consequences. Extract all three operators. Reset device costs AP and preserves the audit trail; Restart resets the disposable run explicitly.

Try the changed-address exercise via `?lab=network&variant=transfer&view=2d`. Foundation and transfer have distinct storage keys, isolated from the November 9 drill and LMS progress. Transfer uses different client/router addresses and bandwidth demand. The previous answer does not work. Export local evidence includes every technical action and separate results. Corrupt/unsupported runs are retained and writes blocked until explicit Restart. Local replay proves consistency, not authentic identity or assessment.

## Friday readiness matrix

| Area | Works now | Limit / remaining work |
| --- | --- | --- |
| Applied mathematics | Usable-address arithmetic, allocated subnet boundary, decimal kB/s → Mbps, 25% headroom and shared-link budget affect editable device state | One bounded problem family; not the whole M02 curriculum |
| Cybersecurity / recovery | Explicit `training-edge` scope, allowlisted fields, rejected unknown targets/fields/address encodings, persistent wrong changes, independent verify, recovery | In-process stateful simulation; no actual OS/router administration |
| Executed code | IPv4/TCP byte serialization and decoding, IP and TCP pseudoheader checksums, ports and length validation | TCP connection/handshake/congestion control, DNS, routing and HTTP service are modeled; plaintext port 8080, no TLS, no emitted packets |
| Tactics | Existing hex graph, collision, cover/combat, R/E/T position and AP dependencies, clock, relay and extraction | Reuses the Transit yard as a labeled training subset; not the full multi-room TR02 facility |
| Evidence | Ordered config/probe/revision trail, replay/reload, rejected scope attempts, hints, attempts, local changed-address task result | Unsigned local evidence; no server-authenticated learner identity or mastery credit |
| Learning interpretation | Task completion, recorded-hint independence, first-try status/retries, compliance and tactical outcome separate | Eventual success is not proficiency; one transfer task is not generalized transfer mastery |
| UI | Workbench, preview/confirm/cancel, device state, probes, reset, evidence export; existing 2D/3D mode | Browser/device acceptance blocked at Chromium launch; real iPad review remains required |
| Hosting / isolation | Lab has no fetch/socket/process/shell surface, no credentials, no external targets; read-only loopback harness | No deployed isolated compute, namespace/container isolation or network enforcement claim from recipe metadata |
| Release | Two isolated local branches, exact source pin, preserves Nov9 checkpoints and current animation fixes | User must select what to publish; no remote operation is reopened |

## Architecture audit and integration

Refreshed app main was `3ad888d798278045cc7437a2459f3f6a3461a327`, including #797 sparse-frame/model liveness and #800 active elapsed walks. The November 9 application commits were cherry-picked cleanly into `codex/prim3-applied-network-lab-20261111` as `476108a` and `432aac7`; no conflict resolution replaced renderer code. Focused animation/model tests must remain green. Original app `3e6739853c9b4001422792e16f5efa85de9f04f0` and source `162a1d608be5d3c0df5c43afd0dcc7a75a7e97af` remain intact on their November 9 branches.

Canonical source branch: `codex/prim3-applied-network-lab-20261111`, based on the preserved source checkpoint (remote source main remained `762db6478d5967da70b465fb8f45d6cee51210b3`). Current source pin: `d456c4a2efc037f23dc4211a95d37a4d18624495`. Runtime: `game/runtime/network-path-lab.mjs`; design boundaries: `game/NETWORK-PATH-LOCAL-REVIEW.md`. The source patch also adds an explicit optional clock pause; default legacy results remain unchanged. The application vendors exact files and hashes in SOURCE.json; existing replay traces are unchanged with updated provenance pins.

Inspected existing contracts: Worker `lab-recipe.js` is an allowlisted orchestration plan, not execution; `prim3-range-core.js`/`prim3-range.js` are TR01 systems-harness infrastructure; Worker `adaptive-learning.js` owns signed, scoped coordinate-practice session/replay evidence, not applied network proof. Building electronics/server lab runtimes are in-memory SIMULATION precedents. No usable deployed NETWORK_RANGE execution binding was established by the Core audit. This change adds no endpoint, database table, authentication service or competing backend.

Future integration must retain canonical Worker owner authorization, Core orchestration, disposable isolated execution, trusted independent verifiers and signed/replayed evidence before any competency write. Do not submit local `technicalPerformance` values to existing evidence APIs as trusted grades. Owner-reviewed release selection and hosted isolation remain separate work. Preserve seven-semester mapping, all 21 core story IDs, 66 modules and no story consequences for this training operation.

Integration order after user selection: review source change first; preserve or repin its exact commit, then integrate this app branch onto refreshed main. Re-run vendor hashes, legacy replays, animation, mission journey and browser acceptance. No dependency on an unpublished Claude branch exists. The older `HEX-TACTICS-INTEGRATION.md` records the November 9 checkpoint; this document governs the November 11 learning addition. Roll back the learning commit to remove this workbench while retaining prior hex/semester integration; leave saved records intact for recovery. No production rollback is needed.

## Verification commands and evidence boundaries

- Source: `node --test game/runtime/*.test.mjs`.
- App: `node --test --test-concurrency=4 scripts/test/*.test.mjs`; `python3 -m unittest discover -s scripts/test -p 'test_*.py'`.
- Worker: from `workers/mccluster`, `npm test` after locked root dependencies are installed.
- Browser acceptance artifact: `node scripts/e2e/prim3-network-lab.e2e.mjs /tmp/prim3-network-proof` (uses this workspace's Playwright installation path; adapt to your local installation). It intercepts requests to local files, uses fixture owner responses, and includes the full configuration/verification/extraction journey. It has not executed successfully here.

The loopback server launched and an HTTP GET returned its review HTML. Chromium failed before page load with `process_singleton_posix.cc:297 socket() failed: Operation not permitted (1)` and ptrace EPERM. Therefore no browser screenshot, live UI mission completion, pinch/drag, touch-target measurement or iPad performance claim is made. Headless engine completion is not UI acceptance.

Recorded final checks: canonical runtime 123 passed; root Node aggregate 2,499 passed / zero failed / five existing skipped (2,504 total); Worker aggregate 1,898 passed / zero failed / nine existing skipped (1,907 total); Python seven passed. Focused network/animation/model group 19 passed. The engine journey covers both foundation and changed-address tasks with reload after each action and extraction, wrong configuration remediation, unsafe attempts, evidence tampering, role/position/phase checks, and paused-clock boundaries 1/2/5. No deployment/publication tests were run. Browser launch was blocked as described above.
