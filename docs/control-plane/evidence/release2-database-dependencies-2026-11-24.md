# Release 2 database dependency audit — 24 November 2026

## Decision

**The three reviewed branch heads introduce no new required database object, SQL file, bucket or Edge Function.** This is a source/dependency finding, not release approval. Their changed files still contain **15 inherited missing dependencies**. Those features remain blocked and are listed below; the existing allowlist does not make them operational.

All work here was local and read-only against production. Nothing was pushed, merged remotely, deployed, activated or applied to production. Further production SQL requires the owner's explicit approval for each file. The separate 389-migration reconciliation must land before later release work relies on that record.

The complete object-to-caller map, function signatures, snapshot rows, branch file lists, deployment plans and read-only catalog query are in [`release2-database-dependencies-2026-11-24.json`](release2-database-dependencies-2026-11-24.json). This is technical evidence for the Equity Uprise platform, not a building capability or geometry source.

## Exact source inspected

Each remote head was placed in an isolated detached worktree and merged locally with `main` at `7f2644b417994d1b994d763485b6448906bdfdb0`. No remote ref was modified.

| Branch | Remote source head | Local merge head | Diff against merged main |
| --- | --- | --- | --- |
| `claude/engine-s0-20261124` | `bbefd55e31540649cbdd413914a87056dee6447d` | `c9a5e809106c80560d0c7b5d6411d0a5f1ed8504` | 182 files; 84 runtime files; no SQL or Core runtime changes |
| `claude/platform-p1-20261124` | `983a985a75bc6202ecad735f97878d070fd64372` | `0161854cbbf0ae6718800f02702bbe38db2e4b60` | 198 files; 84 runtime files; no SQL or Core runtime changes |
| `claude/globe-timing-20261124` | `2590754b4e3a76048112727ae492430e5f2f1345` | `97364fd72a209d01ee3bd66a2d369d3a551177de` | Only `scripts/e2e/environment-globe.e2e.mjs`; no runtime change |

The engine and globe merges were clean. Platform had eight conflicts. Local resolution retained current main's production records, kept the platform/M5 release notes, retained both music-view and installed-dock repaint listeners, and combined the installed-app test's path guard with its quick-wins readiness selector. Its generated source report was regenerated successfully. These resolutions are local integration work, not a reviewed remote release.

Instructions read: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/control-plane/ECOSYSTEM.md`, the full `docs/control-plane/handoff-20261123/CODEX-HANDOFF.md` and `OWNER-DIRECTIONS-AND-STATUS.md`, and the full pending README and promotion order. The handoff's final Status and the actual branch/main state supersede older prose. The user's later prepare/prove-only instruction controls production work.

## How dependencies were checked

The repository's `scripts/test/rpc-names-exist.test.mjs` extractor was run against every changed runtime file and the same files on main. It found 137 distinct database names in each of engine and platform, with no new caller/name pair. Its three checks passed on each of the three local merges.

The scan was extended by reviewing the changed database/API lines and resolving calls the static test omits: bare service table helpers (`sbCount`, `sbCountFiltered`, `insert`, `ownedRow`, `sb`), the imported `OUTBOX_BUCKET`, the catalog's gated bucket, the direct-sale upload grant and the creator-preview bucket contract. This adds nine distinct names to the inventory, for **146 dependencies: 75 functions, 65 relations and six buckets**. All are inherited from main. Added or altered RPC parameter contracts were not found in the changed call sites.

The six buckets are `creator-artwork`, `creator-previews`, `mcc-gated-audio`, `mnet-avatars`, `mnet-media` and `social-outbox`. The preview name comes from `creator_tracks.preview_bucket`, which the applied music track guard normalizes to `creator-previews`; catalog gated tracks name `mcc-gated-audio`; direct-sale grants use the existing `DIRECT_BUCKET`; social uploads import `social-outbox` from `workers/mccluster/src/social/meta.js`. These are existing contracts, not bucket creation requests.

The names and function signatures were compared with `supabase/schema-manifest.json` and `docs/control-plane/evidence/production-schema-snapshot-2026-11-24.json` (captured `2026-11-24T16:50:59Z`). Their exact hashes are in the JSON. A fresh read-only production catalog check at **2026-11-24 17:19:56.544766 UTC** confirmed **131 present and 15 absent**, with ledger **389**, latest version **20261124164904**. Public RPCs/relations were checked in the `public` namespace, not accepted merely because a private object shared the name.

## Inherited missing names remain feature blockers

Every row below already occurs on main. Host/contact URL changes in these files neither create the missing schema nor approve its activation. The branch dependency audit must not be read as permission to ship any of these features as working.

| Missing dependencies | Changed caller files | Existing pending source | Effect and gate |
| --- | --- | --- | --- |
| `action_globe_public_business_pins`, `action_mission_card_extras`, `submit_action_business_listing` | `js/action-globe.js`, `js/mnet.js` | `20261015230000_action_mission_pins_arcs_black_business.sql` | Business pins/extras reads degrade to empty results; listing submission lacks its RPC. These capabilities remain blocked. The older file's mission curation is separately superseded; do not bulk-apply it to clear names. |
| `policy_ladder_status` | `js/member-desk.js` | `policy_fellowship_ladder_v1.sql` | The member desk treats a missing RPC as closed. Ladder access remains blocked. The pending file has a surviving mission seed requiring its own review. |
| `whip_reserve_booking_v1`, `whip_booking_idempotency`, `whip_driver_clearances` | `workers/mccluster/src/whip/booking-gate.js` | `whip_booking_authority_v1.sql` | Verified booking and clearance persistence remain blocked. `bookingReadiness` also requires launch approval, live rides, database readiness, approved fares, commercial routing, payment credentials and quote authentication. None of those launch decisions is made here. |
| `world_environment_team`, `world_environment_propose`, `world_environment_review`, `world_environment_join`, `action_environment_missions` | `workers/mccluster/src/world-environment.js` | `20261107120000_world_environment_v1.sql` | The legacy team/proposal/join persistence is absent. Existing module policy gates access; no installed/enabled policy means `module_disabled`. This is distinct from the already-applied canonical environmental event store. Enabling the module does not supply these missing action functions. |
| `an_connect_recipients` | `workers/mccluster/src/action-connect.js` | `20261010008000_action_connect_recipients.sql` | Recipient onboarding remains blocked; the route also requires `ACTION_CONNECT_TEST_PILOT=true` and a Stripe test key. The pilot flag is absent from committed configuration and is unchanged. |
| `network_push_subscriptions` | `workers/mccluster/src/web-push.js` | `20261020150000_network_web_push.sql` | Web Push remains blocked/off. Committed `WEB_PUSH_ENABLED=false` is unchanged, and VAPID keys are also required. |
| `mission_catalog_sources` | `js/world-source-profile.js` | `20261119140000_mission_catalog_sources_v1.sql` | The source page remains unavailable when the table is absent. Its organization insertion has public metadata effects and Show is a separate owner action. This audit neither applies that source nor shows the page. |

The source flags above are the committed defaults; this audit did not read production secrets or certify all deployed environment overrides. The schema absences themselves were checked live. Existing debt belongs in its reviewed migration/caller-repair lane. No substitute schema was invented.

## Runtime and deployment coupling

The new `js/carry.js` path (active at P1, dormant at P0) uses the **existing** `/v1/auth/handoff` Worker route. `workers/mccluster/src/auth-handoff.js` already validates the bearer with `/auth/v1/user`, obtains a single-use token with `/auth/v1/admin/generate_link`, and the browser verifies it with `/auth/v1/verify`. It uses no custom handoff table or new RPC. No production sign-in/write probe was performed.

The approved music error/interruption measurements use the existing collector and event store. They are dictionary/client changes, not a new database enum or table. The closing song's later full-profile/questionnaire gate remains separate work requiring its own reviewed SQL; this release's owner-only hold does not implement that future gate.

`supabase/functions/_shared/site-hosts.ts` changes require the existing Edge deployment flow. Running `planDeploy` from `scripts/supabase-functions-deploy.mjs` on both exact diffs produces the same **13 existing functions**, with no undeclared or deleted function:

`backend-sub`, `checkout`, `collect`, `connect-onboard`, `connect-org`, `gev-proxy`, `music-checkout`, `music-direct-access`, `music-direct-checkout`, `org-connect-onboard`, `pay-now`, `shake-order`, `stripe-webhook`.

The last two direct-sales consumers are included through the `_shared/music-direct.ts` import chain even though their own entry files did not change. A read-only Edge Function inventory found all 13 ACTIVE; the separately called `music-access` is ACTIVE too. ACTIVE proves existence, **not deployment of these branch heads**. After an approved release, the deployment flow must verify the changed versions. `pay-now` and `connect-onboard` retain their existing early refusals; the return-host tests explicitly preserve that retirement.

## Proof and remaining release gates

| Local proof | Result |
| --- | --- |
| Engine whole Worker suite, `cd workers/mccluster && npm test` | 2,066 tests: 2,057 passed, nine skipped, zero failures |
| Platform whole Worker suite, same command | 2,084 tests: 2,075 passed, nine skipped, zero failures |
| Platform carry, site-hosts, actual Edge return-handler and creator-attribution tests | 48 passed, zero failures |
| Existing RPC-name checks, each local branch | Three passed on each |
| Platform local merge syntax/whitespace checks and source coverage regeneration | Passed; source coverage 3,018/3,018 before this evidence was added |
| Evidence source-map rows and regenerated engine source coverage | 782 entries; 3,026/3,026 checks passed |

These are local proofs. This audit did not run the full root suite, browser acceptance, a complete database reset, exact-head remote CI or production deployment verification.

**A concrete integration gate remains:** platform P1 alone still has `album: { top: true, view: false }` in `js/music-shell.js`. The final handoff requires M5 stage 2 off for Release 2, and the engine stage-0 branch has `album: { top: false, view: false }`. Assemble/review the release so that containment is retained; do not publish the platform branch alone as satisfying that requirement. No product-code alteration beyond the local main conflict resolutions was made in this audit.

For the globe-timing branch, the only change tightens the environment-globe e2e test's own work/deadline accounting. It has no database or Edge dependency delta. Its browser run remains a release verification task.

The database result is bounded: **no new SQL is required by these diffs, and the 15 inherited absent feature dependencies remain explicit blockers.** Refresh the audit after a different source head or later main is integrated.

## Follow-up: assembled Release 2 and Creator Studio PRs

A read-only follow-up inspected [#837](https://github.com/mcclusterishere/mccluster/pull/837) at `8bef0fd92f153d2690de293758976a4626bfaeff` and [#838](https://github.com/mcclusterishere/mccluster/pull/838) at `29756f29c5801de1043c75f69d0342efa9f3cfa1`. Both comparisons use the same main baseline, `7f2644b417994d1b994d763485b6448906bdfdb0`. These findings are pinned to those heads.

**The #837 assembly adds no server database requirement beyond the earlier map.** Its 205 changed files include no SQL or Core changes. Of 88 changed runtime files when HTML and JSON are included, 87 match an already-audited branch byte for byte. The one combined variant, `js/music-shell.js`, adds eight lines and removes two relative to the engine audit: it uses the existing `MCC_SITE` host/root routing and adds no RPC, table, bucket or Edge Function dependency.

The exact #837 assembly retains `album: { top: false, view: false }`, resolving the M5 assembly containment finding above for this head. The 15 inherited absent or gated dependencies remain separately recorded. No production-state refresh or release approval is implied.

**#838 introduces no new server migration or caller.** Its 26 changed files are the creator page, a new stylesheet, `js/creator-studio-shell.js`, `js/creator-studio-take.js`, a roadmap, tests and screenshots/measurements. There are no SQL, Worker, Core or Edge Function changes. The new JavaScript introduces no fetch, RPC or Supabase call. The take handoff places a local File in the existing master/preview input and dispatches input/change; `js/music-creator-studio.js`, the existing upload/submit handler, is byte-identical to main.

The Take bench does contain a **browser-local IndexedDB upgrade**: `mcc-creator-takes` version2 uses `takes`, `audio` and `rec` stores, with `onupgradeneeded` moving version1 inline audio to its audio store. That upgrade ships in client JavaScript and requires no Supabase SQL. This audit did not execute the browser upgrade or a signed-in upload.

### Scope of the earlier pending-SQL count

The original 51 unique forward candidates were the files in `supabase/pending` on main `7f2644b4`, excluding 41 rollback/recovery files and applied, replay and archive SQL. That count was **not an exhaustive survey of every open PR branch**. The named PR and branch reviews above have separate source and evidence boundaries.
