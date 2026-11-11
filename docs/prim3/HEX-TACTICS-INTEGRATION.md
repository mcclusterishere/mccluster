# PRIM3 hex tactics and semester chronology

> Publication update (2026-11-11): draft PR publication is now authorized. Source [PR #24](https://github.com/mcclusterishere/Prim3/pull/24) is published at `2fe190a742f15beb5eb5b3b195c10f2aa64f0eab`; SOURCE.json and replay pins use that commit. The application is rebased on `8e631683b6960fee283ea923c22b1d72cfd09495`, preserving current model/timing fixes. Local-only restrictions, pins and blocked publication statements below record earlier checkpoints and are superseded for draft publication only. Merge, deployment and browser/device acceptance remain outstanding.

This isolated implementation is based on mccluster main `578e683088fdd49fb77848733e70dd4f3af039c3`. Local branch: `codex/prim3-hex-tactics-20261109`. No deployment, production service changes, merge, or edits to Claude's branch occurred.

## Source and integration order

1. Review the companion Prim3 branch, local commit `162a1d608be5d3c0df5c43afd0dcc7a75a7e97af`, tree `2bf77d6ca8e2a70326ef9b29ead73fbeb4256ac1`, based on `762db6478d5967da70b465fb8f45d6cee51210b3`. It changes canonical runtime, tests, story chronology, course feed and attribute provenance. Read its `story/SEMESTER-CHRONOLOGY-AUTHORITY.md`, `development/2026-SEMESTER-RESEARCH.md`, and `game/HEX-SEMESTER-INTEGRATION.md`.
2. Publish/merge the source change first after review. This application's `js/prim3-tactics/SOURCE.json` pins that exact local commit with hashes. Publication is currently blocked: shell push has no credentials; connected GitHub tree creation was interrupted, and the expected tree returned 404. Two unattached data blobs were uploaded, but no remote source branch/commit is confirmed. Do not treat the pin as remotely resolvable. Preserve the exact commit when pushing, or update the pin and replay fixture to the actual source commit and recheck hashes.
3. Integrate the application branch after the canonical source. The Worker copy of `semester-progression.mjs` must match the canonical runtime copy too. No database migration is required: episode/mission/course keys stay stable.
4. Claude PR #793 was inspected at `161faa68a13af6107f119dbfa5be6fe4caac9b50`. The implementation starts from main, not that PR. At that inspected head there were no incoming changes to our shared level3d, resolver, metric navigation, progression UI or Worker course entry files. Recheck current heads before integration. Claude's W1 public `levels/recipe.mjs` compiler repair is independent of this slice but required for its generated public mission path; integrate W1 before testing/exporting that path. Do not revert W1 to a private-tree import. Resolve future conflicts semantically: retain optional hex rendering and legacy square behavior together, preserve source hashes, combine additive course fields, rerun replay tests. Exact future conflicts cannot be predicted from a moving branch.

## Playable change

Open `prim3-hex-tactics.html` through the existing owner account, or follow the opt-in link from Transit. The drill reuses Transit authored yard positions and PRIM3's canonical resolver, player visibility, threat AI, technical state machine and extraction. It is not story credit or a second campaign. The existing square game and its storage are unchanged.

Three operatives have two AP per turn. Select an operative, tap a reachable hex or visible opponent, review route/metres/AP or shot chance/damage/critical, then Confirm; Cancel spends nothing. Technical connects the relay twice. Extract all three before the 14-turn clock or any casualty. Hunker, reload and overwatch use existing resolver rules. Shooting costs one AP. Directional low/high cover comes from actual yard solids; high solids block LOS. White map edges show cover facing. A fixed order tray keeps selection and confirmation visible at tablet widths. This is one floor; no pretend elevation control.

The same pointy axial graph supplies 2D polygons, 3D tiles/picking, metre path costs, collision and cover. Containers/barriers/crates in this bounded yard are rendered from the same physical boxes used to reject nodes and edges. Conservative crate boxes are a deliberate approximation. Other interiors, stairs and City layouts remain their existing topology; this does not claim all environments are converted.

Hex runs use `here.prim3.transit-relay.hex.v1` and deterministic command replay. Unsupported/corrupt runs are retained and writes blocked until Restart. Legacy square runs are never converted implicitly. Course migration adds `prim3.semesters/v2` metadata while preserving passed/read/scores and unknown metadata. Unsupported chronology records remain intact and block writes until explicit Reset. The UI-loader tests exercise these real read/write paths.

## Canonical chronology

S1 Fall 2026; S2 Spring 2027; S3 Fall 2027; S4 Spring 2028; S5 Fall 2028; S6 Spring 2029; S7 Fall 2029. All 21 episode identities remain: semester = ceil(global episode / 3), slot = (global episode − 1) modulo 3, mapping to opening/midterms/finals. All three are required. Winter/summer adventures follow separately and are unreleased, not optional replacements for finals. The 66 playable LMS modules remain distinct from 21 story episodes.

Seven semesters is 3.5 academic years, not a literal 42-month elapsed interval. College entry stays age 33; finale approximately 36–37 without an invented birthday. Pilot rewind is FALL 2026. S7's three academic frames converge on the uninterrupted finals operation RAID → Evil Twin → Ghost, preserving injury and succession continuity through framing/flash-forwards. Historical pre-college seven-year spans and sibling age differences stay intact. Deprecated historical proposals remain explicitly superseded. Connected Drive was audited read-only by the researcher; no authoritative live canon register was verified or edited. Cross-source owners still need to reconcile any live copies against the new authority.

## Reference decisions

The requested reference is the **XCOM 2 Collection iPad** interface: large commit/cancel panels, target choices with percentages, squad selection, movement budgets and cover feedback. PRIM3 deliberately uses real hex geometry; XCOM-inspired interaction does not establish a hex claim about XCOM. Sources: [official App Store screenshots](https://apps.apple.com/id/app/xcom-2-collection/id1288508230), [Feral mobile features](https://www.feralinteractive.com/en/games/xcom2collection/android-ios/features/), [official manual](https://www.feralinteractive.com/en/manuals/xcom2/latest/steam/), [hex coordinate reference](https://www.redblobgames.com/grids/hexagons/). The source research document keeps verified 2026 events separate from proposed scenes; fictional organizations are not assigned responsibility for real events.

## Local verification and launch

From repository root: `npm ci --ignore-scripts`, `npm test`; Worker: `cd workers/mccluster && npm test`. Canonical source: `node --test game/runtime/*.test.mjs` and `python3 -I data/attributes/tools/validate_registry.py data/attributes/v1/catalog.json --self-test`. Campaign: `node PRIM3/game/halo/validate-campaign.mjs`.

On a machine with Playwright and Chromium, run `node scripts/e2e/prim3-hex-tactics.e2e.mjs /tmp/prim3-hex-proof`. Its Playwright require path is this cloud workspace's `/opt/codex/cua_node/lib/node_modules`; adapt to your installed Playwright. It intercepts all requests to local files and uses a fixture owner session, never a production write. It exercises 390/768/1024/1280 widths, preview, commit, reload, enemy turn, 3D, access denial, and the complete 30-action mission with cancel/repeated confirmation and reload at every step. A normal local static server can render the gate, but the real owner auth route requires the normal site environment; do not disable the gate for release.

Browser execution here is BLOCKED before page load: Chromium `process_singleton_posix.cc:297 socket() failed: Operation not permitted (1)` and ptrace EPERM. Thus no actual UI mission, touch gesture, viewport, WebGL or screenshot acceptance is claimed. Engine simulation success does not verify touch usability. Verify pinch/drag cannot create movement orders, view switching preserves previews, and controls remain usable on real iPad before release. The automated browser script itself is unexecuted and may need adjustment after its first real run.

## Rollback and remaining gaps

Revert the application commit to remove the opt-in page and additive chronology UI; preserve localStorage records rather than deleting them. Source canon/runtime revert must be a separately reviewed owner decision, not an incidental app rollback. Existing IDs need no reverse remap. No infrastructure rollback is needed because nothing was deployed.

This is a bounded experimental yard, not a conversion of all 3D interiors or production-ready tablet release. Browser acceptance, actual-device accessibility/performance, wider seed/balance playtesting, public-export closure with Claude W1, remote publication and final remote-head verification remain required. No live Drive updates or production migrations were performed.

## Recorded checks (2026-11-09)

- PASS: canonical runtime, 116/116; attribute registry validation plus 12 corruption self-tests; campaign validator, 66 missions/21 arcs.
- PASS: final root Node aggregate with `--test-concurrency=4`, 2,055 passed, zero failed, three existing skipped (2,058 total). Python aggregate, seven passed.
- PASS: final Worker aggregate, 1,459/1,459. Initially failed because the locked fal client was absent; resolved with `npm ci --ignore-scripts`.
- PASS: focused new hex/UI-loader/vendor/navigation group, 19/19. The eight hex tests include a complete five-round/30-action engine mission, replay after every action and corrupt mutable-state rejection. Both existing square replay fixtures retained their exact traces and were repinned to the new source commit.
- RESOLVED initial failures: replay source-pin mismatches and missing shared shell/app navigation. Unbounded aggregate runs also had interrupted file-level tests; final bounded aggregate completed cleanly.
- BLOCKED: Chromium browser launch by environment socket/ptrace restrictions, before any page execution. No UI acceptance or real iPad test passed.
- NOT RUN: deployed-site checks, production services, full public export including Claude W1, real-device touch/performance/accessibility acceptance, live Drive reconciliation. No deployment was attempted.
- Publication check: both requested remote branch refs returned 404. GitHub create-tree was aborted by user with no additional reason; the expected source tree also returned 404. No retry or alternative write route was used after that interruption. Remote-head verification cannot pass until publication succeeds.

Local recovery without losing commit identity: from a separate review clone, `git fetch <preserved-source-checkout> codex/prim3-hex-tactics-20261109` (source), then use the analogous `codex-prim3-hex-tactics-20261109` checkout path for the app. Review FETCH_HEAD and create your review branch; do not reset Claude's existing branch. A credentialed authorized push of each exact local branch preserves source provenance.

Final chronology follow-up: the active psychological-background PRIME shorthand now starts after validated succession at the Fall 2029 finale, without an age-40 gate or invented birthday. A focused source regression covers that shorthand and retains the unrelated 19–26 and 26–33 spans. Source runtime bytes are unchanged; application provenance and both replay fixture pins now name the follow-up source commit. No remote writes were retried.
