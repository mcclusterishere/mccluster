# Whole-platform implementation — Claude frontend handoff (2026-11-02)

**Release decision: gated, unchanged.** Published for review only: branch `claude/whole-platform-20261102` on `mcclusterishere/mccluster` (owner authorisation 2026-11-02 08:26 ET, review-branch publication only; pushed without force, no pre-existing remote branch). No PR, merge, deploy, production SQL, flag, credential, purchase, charge, provider call, ad or external message occurred. Backend sources from the v5 bundle are byte-identical in this branch (hashes checked against `SOURCE-HASHES.json`); Codex owns them.

Status words used below, as WHOLE-SITE-ACCEPTANCE.md defines them: `uninspected` · `blocked` · `implemented locally` · `verified locally` (local fixtures/harness) · `deployed attested` · `functionally verified` (real service). Source / pushed / merged / deployed / functional are separate fields and none of the last three is claimed anywhere.

The finish-line view (stages, journeys by evidence class, owner/provider decisions D1–D10, release plan): [COMPLETION-LEDGER.md](COMPLETION-LEDGER.md).

## Per-module ledger (2026-11-02 09:05 ET) — the platform is NOT finished because the editors pass

Status words: **implemented** (code in this branch) · **tested locally** (runtime harness / real-SQL fixture / native proof in this branch) · **blocked — dependency** (exact gate) · **not implemented** (in scope, not started here). "Live-verified" appears nowhere below: no real Supabase Auth/Storage/browser/provider acceptance was performed.

| Module (WHOLE-SITE-ACCEPTANCE row) | Implemented here | Tested locally | Blocked — exact dependency | Not implemented |
|---|---|---|---|---|
| Public hosts / navigation / account bar | — (unchanged) | existing suites green (appbar, domain-architecture, 390px audit on touched pages) | #686 six-section shell: 5 conflicts + bottom-bar policy decision (owner) | adoption of #686 |
| M Account / profile / sign-in return | template intent kept through `account.html?next=`; account-switch guard proven in harness | front-studio harness (account switch) | live Auth/session/re-auth (real service); profile restoration source `1fdef132` not on remote | profile-visibility editing changes |
| Control homepage editor (`front-page.js`) + inline `site-editor.js` | revision-aware save/reset/restore, conflict decision, history-verified readback, fail-closed blocked state | 6 + 5 harness tests; `site_content_v2` real-SQL (editor suite) | `editor_versioned_contracts_v1.sql` pending; `EDITOR_V2_ENABLED` off; admin session (live) | multi-slot atomic scene restore (not in contract by design) |
| Personal/project Front Studio + project list + public front | v2 save/publish/unpublish/withdraw/recover/history/restore; preflight validator copy; blocked state | 15 harness tests incl. two-tab race; real-SQL free-builder journey 158 assertions | same SQL/flag; real Storage bytes; browser renderer acceptance | media upload progress states beyond existing `front-media.js` |
| Website/Tile Studio (`project-tiles.js` bridge) | dual-revision save/publish/unpublish/withdraw/recover/switch-front; manage panel; recovered-success contract; blocked state | 18 harness tests; bridge SQL 57 + native lock-order | `project_tile_editor_v2.sql` pending; `WEBSITE_STUDIO_ENABLED`/`EDITOR_V2_ENABLED` off; media processing allowance + paid entitlement (live) | template picker beyond motion-portfolio (one template exists) |
| Owned editor assistance (proposal → Apply → Undo) | full slice, owner-typed source works; McCluster source honest about missing route | 5 pure + 3 harness tests | Codex request 1: `POST /v1/ai/tile-proposal` member route to Core's bounded qwen path | URL reconstruction importer (later contract, by design) |
| Control **Member fronts** moderation | new view; revision-carrying takedown; blocked state | 5 harness tests | v2 flag; house-owner session (live) | member search/list (no list route exists; lookup by handle only) |
| Storage/media quota | — (unchanged UI) | existing quota fixtures | real Storage / signed-upload expiry (live) | upload retry/rollback UI beyond "Recover interrupted uploads" |
| Control Work / module registry / customer modules | module switches confirmed by server projection, status-specific rollback, distinct 401/404/503 states | 4 harness tests | Codex request 3: general module manager contract (dependency/version/disable/drain) | admin module catalogue UI (no contract) |
| Addresses / domain connections | 24h provider-verification lapse surfaced with Verify-again recovery; honest status words | 2 harness tests | no scheduled refresh (backend); apex/TLS (provider); `CREATOR_DOMAINS_*` bindings absent on inspected deployment | automatic refresh (must be backend) |
| Domain purchase pipeline | quoted-term/no-renewal disclosure; status words that never equate payment with registration | existing Worker unit + native domain proofs (local) | registrar sandbox-only; 18 bindings absent; refund settlement, renewal/transfer absent (Codex/provider); live purchase forbidden | renewal/transfer controls (no backend) |
| Platform access / included month (v5) | projection UI per workspace/app; cancel route | 5 harness tests; `domain-trial-db` 103 + native | `CREATOR_DOMAIN_TRIAL_ENABLED` off; policy unseeded; Codex request 2 (order id in projection); registrar readback adapter (grant blocked) | module purchase checkout (no price mapping decided) |
| Anti-Social door + brief | `free-website.html`; brief + rights checklist | page suites; 390/1280 audit; screenshot reviewed | rights checklist answers (owner); campaign budget/platforms (owner) | any ad creative (by design until rights answered) |
| Music / lyrics / releases / stems | — | — | #684/#685/#687 + `9d7a7eed` need the lyric approval/export security correction with Codex (INTEGRATION-ORDER 6) | all UI adoption |
| Creator production Studio / media jobs | — | — | provider receipts / pinned outputs (backend) | status/retry UI changes |
| Social publishing / recovery | — | — | atomic trial consumer integration + `customer_social_paid` guard (Codex); provider publish (live) | trial-publishing UI (must not be claimed) |
| Billing / storefront / direct music commerce | — | existing regressions green | mutable-asset / early-download flaws (Codex); financial flows paused (owner) | entitlement recovery UI |
| Analytics / privacy (#640/#642) | — | — | review of 21 shared files together (uninspected here) | — |
| Private math LMS / PRIM3 story & game | — | — | sources `5d76d704` / `edaf4e09` not on remote | — |
| OVH character engine controls | — | — | `baa92490` uninspected; `publication_eligible:false`; direct CLI Forbidden | abstention/hold display |
| Release / portability / operations | pg-native-shim; cdp-lite 390px audit; evidence logs | all suites rerun at tip | npm/pip blocked here (4 Worker files dependency-blocked); deployed attestation | — |

## Review findings (2026-11-02 08:43 ET) and their corrections

Two confirmed findings against `ab84cb3f`, fixed in this branch and reproduced by runtime regressions:

1. **Fail closed on versioned-API errors.** Before: each editor decided "legacy" when its opening v2 read failed with anything that classified loosely (`/not enabled/` text, a text-only 503) and `front-page.js` also on `signin`; a 403, generic 503, network failure, timeout or malformed body left `v2=null` and the next write branched to the legacy path behind a `updated_at` readback guard. Now: `classify()` recognises `unconfigured` ONLY on the documented signals (`503 {code:"unconfigured"}` from the Worker; `404 PGRST202` for the missing RPC); `legacyAllowed(classified, record)` additionally requires the record not to be `protected`; every editor has a third state, **blocked**, in which save/publish/unpublish/reset/takedown/withdraw are refused with the specific recoverable reason and unsaved edits kept; the legacy readback guard is explicitly a courtesy for a deployment without revisions, never a substitute for revision enforcement, and is closed the moment the versioned API has answered at all. Files: `js/editor-revisions.js`, `js/front-studio.js`, `js/control-room/front-page.js`, `js/site-editor.js`, `js/customer-projects.js`, `js/control-room/member-fronts.js`, `js/website-studio/editor.mjs`.
2. **Verify the intended operation after a lost response.** Before: `reconcile()` accepted `revision === expected+1` plus a weak state check (`publish` only compared the draft, so `published:null` could be reported as published; `restore` had no link to the requested revision; `unpublish`/`withdraw` would accept any coincidentally matching state). Now: the readback reads the **history** and requires the row at `expected+1` to record **this operation** (`operation` = `save|publish|unpublish|withdraw|recover|restore|takedown`, or `tiles_<action>` for the Tile bridge), for `restore` its `restored_from === restore_revision`, AND the snapshot to show the operation's effect (`publish`: `published` non-null and equal to the sent config; `unpublish`/`withdraw`: `published` null; …). Anything else is **unknown**: shown as such, edits kept, nothing retried; the latest state is offered as a conflict decision. The contract is proven against real SQL + the real Worker adapter (`editor-versioned-db.mjs`, "readback contract" block, now 158 assertions): rows carry `operation`/`restored_from`, publish state is explicit, a protected record refuses a blind legacy write.

**Follow-up finding (09:05 ET), fixed:** after a lost response that the history then confirmed, `write()` in the Studio editor resolved to `null` and the management callbacks passed that to `adoptBridge`, which (correctly) refused it as malformed. Contract corrected: `write()` resolves to a well-formed bridge state on every success — the server's answer, or the history-confirmed state flagged `recovered:true` — and never to `null`; every consumer (unpublish, withdraw, recover, switch-front, conflict-keep, save, publish, proposal Apply/Undo) adopts it identically; no second write is issued to repair the screen; the "Confirmed from the history" line stands. Regressions: recovered success and unknown outcome for each of unpublish/withdraw/switch-front, recover, conflict-keep, and proposal Apply (10 tests).

Regressions added (runtime harnesses over the real page scripts): front-studio (403/503-generic/503-text-only/network/malformed → blocked, no legacy write, edits kept; lost publish with `published:null` → unknown; lost restore vs unrelated next revision → unknown, genuine `restored_from` row → confirmed; different-operation row at rev+1 → unknown), Control front page (same four failure classes; unrelated `reset` row → unknown), inline editor (403/503/malformed; text-only 503 is not legacy), member fronts (403/503/malformed pause takedown), Website Studio (five failure classes; lost publish without `tiles_publish*` row/published revision → unknown; `tiles_unpublish` row at rev+1 → unknown for a save).

New backend request found while proving the contract (request 6 below): the legacy `managed-projects.js` adapter maps the enrollment trigger's PT409 to a generic 503.

## Exact sources

| What | Identity |
|---|---|
| Audited main | `e80cb0a137683393f19ba251f9beb9e66577ce64` (clone HEAD at start; now a true ancestor) |
| Consolidated customer candidate | PR #681 `5e020833534b68b31e191b137e9a30da8b58314f` (fetched `refs/pull/681/head`) |
| v5 bundle | `backend-productization-source-v5-20261102.zip` → `CHECKPOINT.json` commit `e55b9be0`, branch `codex/domain-trial-worker-20261102`, `pushed:false`; applied as `implementation.patch` on exact #681 → `38805bd6` |
| Main merge | `f61c7323`: four conflicts resolved to the v4-reconciled union; `supabase/migrations` + `production-ledger.json` byte-identical to main (355 ledger) |
| Authoritative backend snapshot | `codex/productization-recovery-20261102` `17ed110d52a425c1570e67fbbdc6308d7b064559` (built on `edd8cdd8`; v6 content; verified as recorded in COMPLETION-LEDGER §1) — merged into this branch at `5d44e435` |
| This branch's tip | see `git log 5e020833..HEAD`; frontend commits `943ecd7d` … (current tip in the commit log) |
| Other workers | #684 `21c92673`, #685 `bdb8a945`, #686 `86a90f71`, #687 `a2a32da1`, #493 `9ad0503e`, #636 `a5efd156`, #640 `431da5bd`, #642 `327625eb`, `9d7a7eed` (`story/cluster-fucked-workspace-20261101`), `baa92490` (`codex/actor-evidence-preview-20261101`) — all fetched/resolved read-only; **not integrated** (below). `1fdef132` (profile restoration), `5d76d704` (private math LMS), `edaf4e09` (PRIM3 story), `c1505931`/`ba06fed8`/`e1eeacec`/`cded251c` (local checkpoints) are not advertised by the remote: **blocked, inaccessible from this session**; nothing was substituted for them. |

## Session gates (environment, not product)

- npm and PyPI registries are refused by this session's egress policy (DNS fails; proxy 403). Consequences: the pinned PGlite tools could not be installed; 4 Worker test files that import `@cfworker/json-schema` / `@fal-ai/client` fail to load (`cloudflare-registration`, `registration-contact-vault`, `travel-routing`, one `observability-instrumentation` case). They are dependency-load failures, not source regressions (same code passed 1,338/0 in the v4 run with dependencies present).
- In their place: `scripts/test/pg-native-shim` (source `pglite/index.cjs`, linked into a gitignored `node_modules` path by `link.sh`) is a psql-backed stand-in for the four PGlite calls the fixtures use, run against a disposable local PostgreSQL 16 cluster. Evidence produced through it is **native PostgreSQL**, labelled as such, never "PGlite". `domain-purchase-native.py` gained a `--local` mode equal to the other three native drivers (Docker daemon absent here).
- Cloudflare: the connected MCP server is the deprecated bindings server and returns only the Worker's name/id, so the deployed-binding inspection could not be refreshed; the v4 read-only evidence (`../20261102-domain/evidence/deployed-binding-metadata.json`, 18 candidate bindings absent, 03:30 UTC) stands and is cited, not restated as new.
- Playwright absent → `scripts/e2e/cdp-lite.mjs` drives Chrome for Testing 153 over raw CDP for the 390px proof.

## Verification (final run on this branch tip)

| Suite | Result | Scope |
|---|---|---|
| Root `node --test scripts/test/*.test.mjs` | **1,417 passed · 0 failed · 0 skipped** | combined source; 11 runtime harnesses incl. the social status-contract UI (front-studio 10, Control front page 6, inline editor 3, Studio bridge 7, proposal 5, platform access 5, member fronts 4) and the validator-copy parity test |
| Root Python | 7 / 7 | |
| Worker `npm test` (with shim, formerly skipped PGlite suites executed) | **1,319 passed · 4 failed (dependency-load, not source) · 0 skipped** of 1,323 — not a fully passing run; v6's 10 new `customer-social` tests pass | the 4 are `test/cloudflare-registration.test.mjs`, `test/registration-contact-vault.test.mjs`, `test/travel-routing.test.mjs` (cannot resolve `@cfworker/json-schema`) and one `observability-instrumentation` case (`fal gateway client is not installed`); they pass where `npm ci` can reach the registry (v4 evidence: 1,338/0) |
| `editor-versioned-db.mjs` | **158 assertions PASS** (free-builder journey + editor contract + readback contract) | native PG via shim |
| `tile-editor-bridge-db.mjs` | 57 PASS | native PG via shim |
| `domain-trial-db.mjs` | 103 SQL/Worker assertions PASS | native PG via shim |
| `social-consumer-db.mjs` (v6) | **67 SQL/Worker assertions PASS** | native PG via shim |
| `social-consumer-native.py` (v6) | duplicate grant once; mutation/cancel serialized; lock-inversion bounded safe abort — PASS | native PG 16.15 |
| `prepared-foundation-db.mjs` / `free-site-minimum-db.mjs` | 28 PASS / PASS | native PG via shim |
| `editor-versioned-native.py`, `tile-editor-bridge-native.py`, `domain-trial-native.py`, `domain-purchase-native.py --local` | all PASS (two-session races: one commit/one PT409; lock order; duplicate funding/claims) | native PG 16.15 |
| `scripts/e2e/mobile-overflow-audit.mjs` | 14/14 page×width checks PASS (390 and 1280; scrollWidth === clientWidth; no script errors) | signed-out gates; screenshots in `evidence/mobile/` |

Logs: `evidence/baseline-*.log` (combined baseline before frontend work) and the same suites rerun at the tip (`evidence/final-*.log`). Not performed here, as a matter of record: real Supabase Auth sign-in, managed Storage bytes, browser session/account switch against the live API, paid-provider sandbox, deployed attestation. Those remain the functional gates for every row below.

## Coverage by surface

| Surface / entry | Source | Implemented locally (this branch) | Verified locally | Backend / owner gate |
|---|---|---|---|---|
| Personal + project front editor `js/front-studio.js` (`front-studio.html`, `project-studio.html`) | v2 API (`editor-versioned.js`, bundle) | revision-carrying save/publish/unpublish; 409 → "replace mine / keep mine (one deliberate overwrite) / decide later" with the latest revision read; lost response → readback (committed / not committed / unknown→conflict); History panel + Restore to draft (new revision, never publishes); withdrawn projects read-only; tiles presentation routed to Website Studio; client-side preflight names refused settings via a published, parity-tested copy of `packages/front-config`; legacy write only on `503 unconfigured`, behind an `updated_at` readback guard | harness 10/10; member-front test updated to the contract | `EDITOR_V2_ENABLED` off; `editor_versioned_contracts_v1.sql` pending; real Auth/Storage/renderer |
| Project list `js/customer-projects.js` | v2 withdraw/recover (v3) | Remove → **Withdraw** carrying the revision (draft/history/address/ID kept); **Recover** for owner-withdrawn projects; legacy DELETE only when unconfigured and only after the list's `updated_at` readback | covered by the shared client tests; no DOM harness for this page | same |
| Control homepage `js/control-room/front-page.js` | `site_content_v2` RPC (bundle) | save/reset carry `p_expected`; conflict decision; readback; History + explicit **live** restore (confirmed; new revision); legacy RPCs only when `PGRST202` (RPC absent) after public-row readback | harness 6/6; `front-cabin-first`, `control-surface`, `account-identity-gate` green | RPC pending; admin session |
| Inline pencil editor `js/site-editor.js` (60+ pages) | `site_content_v2` | per-slot revision read at edit start, saved with it; a slot changed meanwhile keeps the typed text on screen and is not overwritten; revert carries the revision; the shared client is lazy-loaded by the editor (no page edits) | harness 3/3 | same |
| Website Studio `js/website-studio/editor.mjs` | dual-revision Tile bridge (`project_tile_editor_v2`, bundle) | GET/PUT/publish/unpublish/withdraw/recover/switch-front on `/v2/projects/{slug}/tiles` with BOTH tokens; stale pair keeps edits + "keep mine" decision; readback; manage panel (`#manage`); legacy single-token PUT only when unconfigured | harness 7/7; bridge SQL 57 + native lock-order proofs | `EDITOR_V2_ENABLED`, `WEBSITE_STUDIO_ENABLED` off; SQL pending; media/entitlement real-service |
| Owned proposal slice `js/website-studio/proposal.mjs` + Studio `#assist` | OWNED-ARCHITECTURE.md | capture (project, both revisions, SHA-256 digest) → host envelope → bounded headline/body changes (unknown field / empty / >8 KiB / markup / non-text / too long / no-op **rejected**) → candidate by stable tile id re-validated by `assertDocument` → field diff + real renderer preview (pure) → explicit **Apply** = the one dual-revision save → one **Undo** entry = new deliberate save on the returned tokens; dirty draft / moved revisions / project switch invalidate; late output after cancel discarded; publish untouched. Sources: owner-typed (works now) and McCluster (`POST /v1/ai/tile-proposal`, not registered → said plainly, no fake success) | 5 pure + 2 harness tests | Codex request 1 below; no paid inference; no streaming |
| Control **Member fronts** (moderation) `js/control-room/member-fronts.js` | `/v2/fronts/{handle}/edit|history|takedown` | new view (`#create:member-fronts`, route home added): house-owner read with revision, takedown with recorded reason carrying `expected_revision`, re-read on 409, legacy unconditional route labelled | harness 4/4 | house-owner session; v2 flag |
| Platform access / entitlements `js/platform-access.js` on `customer-site.html` and `customer-domain-purchases.html` | v5 `GET /v2/platform/apps/{app}/access`, `POST /v2/platform/domain-trials/{order}/cancel` | capability lines with the server's reason (denied stays visible, greyed); trial state/expiry and annual domain expiry kept distinct; hosting "economics_policy_unresolved"; "no automatic paid conversion"; unconfigured/401/403/404 said plainly; cancel with exactly `{org_id}` after confirmation; malformed scope never leaves the browser | harness 5/5 | `CREATOR_DOMAIN_TRIAL_ENABLED` off; policy unseeded; Codex request 2 (order id in projection) |
| Domain purchases `js/customer-domain-purchases.js` | existing adapters (sandbox only) | status vocabulary that never overstates (funded ≠ registered; `registered_pending_reconciliation` = not confirmed; `refund_required` = not refunded); quoted-term + no-renewal disclosure; annual term shown as independent of the included month | existing unit regressions; native domain proofs | registrar bindings absent on inspected deployment; live mode refused by factory; renewal/transfer/refund settlement absent |
| Anti-Social door `free-website.html` (+js/css) | asset in tree | sound on press only; captions from `assets/captions/antisocial.en.vtt` at runtime; real demos linked (`index.html`, Studio demo); three template doors with intent kept via `account.html?next=…` and a one-shot `sessionStorage` fallback honoured by front-studio; "what free means" from existing contracts; no time promise; `data-cta` only (consent-gated collector) | page-wide tests green; 390/1280 audit; screenshot reviewed | brief + rights checklist `ANTI-SOCIAL-CAMPAIGN.md`; **no campaign/spend/publication** |
| Shared revision client `js/editor-revisions.js` | — | one contract for all writers: classify (conflict/signin/forbidden/notfound/unconfigured/toolarge/invalid/network), explain, `reconcile` after lost responses, owned + site clients; registered in `live-callers.json` as pending-only caller of `site_content_v2` | exercised by every harness | — |

### Not changed in this branch (status recorded, not claimed)

| Area | Status | Why / what it needs |
|---|---|---|
| Control shell #686 (six sections, NAV-derived views) | inspected; **not integrated** | trial merge: 5 conflicts (`control-room-v2.js` ×3, `workspace-core.js`, `control-surface.test.mjs`) — #686 derives routes from `js/control-room/nav.js` and asserts "no hand-written rail or bottom bar" while AGENTS.md/SHARED-NAVIGATION.md require the shared bottom control bar: an owner navigation decision before adoption. When adopted, NAV must gain `create.member-fronts` and keep every #681 Create view (all present except `member-fronts`); INTEGRATION-ORDER step 5. |
| Music #684/#685/#687 and `9d7a7eed` | inspected (heads fetched); **not integrated** | carry pending SQL (`lyrics_machine_v1`, `whip_equipped_catalog_objects`) and `music-access` Edge changes; INTEGRATION-ORDER step 6 requires the private immutable revision / approved export security correction reviewed with them (Codex). No UI cherry-picked without its SQL. |
| Analytics #640/#642 | uninspected beyond heads | 21 shared files; review together; no behavioural claim |
| OVH actors `baa92490` | head resolved; uninspected | `publication_eligible:false`; direct CLI Forbidden; display-only review flow not built here |
| Private math LMS / PRIM3 story / profile restoration | **blocked** | sources not advertised by the remote; the old public LMS branch is not a substitute (CONTRACTS.md) |
| Customer modules (world / world_discovery) | existing UI unchanged | not a platform module manager; Codex request 3 |
| Social, Studio media jobs, billing/storefront, direct music commerce | existing UI unchanged | their backend gates are unchanged (BACKEND-READINESS.md); the social trial guard needs the atomic consumer integration before any UI claims trial publishing |

## Backend requests for Codex (exact, with callers)

1. **Tile proposal capability on the one plane.** Caller: `js/website-studio/editor.mjs` → `POST https://api.mccluster.org/v1/ai/tile-proposal` (member bearer). Current state: `/v1/ai/*` serves owner jobs only (`ai/router.js`, `OWNER_JOB_TYPES`), `/v1/compute/run` needs an API-key principal with `compute:write` and charges credits; no member-session route exists. Requested semantics: nonstreaming, one in-flight run per session (429 otherwise), request `{schema:'mccluster-tile-proposal/v1', proposal_id, run_id, target:{projectId,tileId}, base_revision:{editor,studio}, base_document_digest, request≤2000 chars, tile:{kind,headline,body}}`; the Worker verifies Auth + project ownership (slug) and only then calls Core's bounded qwen3 path (`core/src/compute/ollama-adapter.mjs`, stream:false, max_concurrency 1); response `{proposal_id, run_id, status:'complete'|'failed'|'cancelled', changes:{headline?,body?}}` and nothing else (no tools, no components); 404/501 until registered. Authorization/data impact: no persistence, no credits for members unless the owner decides; Core audit/cost boundaries apply. Acceptance: wrong owner 404; mismatched run ids discarded client-side (test exists); oversized/markup refused server-side too; interrupted → `failed`, never a partial patch. Also: expose `project_id` (immutable UUID) in the bridge read so proposals bind to it rather than the slug.
2. **Trial order identity in the access projection.** Caller: `js/platform-access.js`. `creator_platform_access_at_v1` returns `trial.*` and `domain.*` but not the receipt's `order_id`; the cancel route needs it. Request: add `trial.order_id` (uuid|null) to the projection; add `hostname` to the `/v1/creator-domain-orders` list projection (`creator-domain-orders.js` line 36 select) so an order card can name its domain. Impact: read-only fields; no policy change. Acceptance: cross-org read still 403; order id only for the caller's own receipt.
3. **Platform module manager contract** (unchanged from PLATFORM-CONTRACT-QUEUE.md): dependency/version/disable/drain semantics and tenant-scoped admin catalog authorization; the current `customer_site_modules` switches remain the only UI.
4. **Durable idempotency receipt for Apply** — only if required: CAS suffices for exactly-once in the harness; a request-receipt ledger is not requested now.
5. **Lyric revision/approval security correction** to accompany #684–#687 before any frontend adoption (INTEGRATION-ORDER 6).
6. **Legacy adapter status for protected records.** Caller: `js/front-studio.js` legacy path (only when `unconfigured`). `workers/mccluster/src/managed-projects.js` line 25 maps every non-OK PostgREST answer except `23505` to 503 "Project storage unavailable"; when the enrollment trigger raises `PT409` on a protected record, the browser sees a 503 indistinguishable from an outage. Request: map `PT409`/`40001` → 409 with `code:'protected'` (and likewise in `member-fronts.js`). Acceptance: `editor-versioned-db.mjs` readback block asserts the status (currently `[409,503]`, to be tightened to 409). No data impact.

## Migration / application / recovery plan (prepared, not requested)

Target if ever approved: Supabase `zmnhbrjyhxzhkxmhkexs`; applied by this branch: **none**; ledger unchanged at 355. Prerequisite chain and containment are as in `../20261102/MIGRATIONS.md`, `../20261102-v2/migration-manifest.json`, `../20261102-tile-bridge/migration-manifest.json`, `../20261102-domain-trial/HANDOFF.md`. Exact pending SQL in this tree (SHA-256, unchanged from the bundle):

| File | SHA-256 |
|---|---|
| `supabase/pending/editor_versioned_contracts_v1.sql` | `35e654322b78a45ea828a5d038a171f12840d0bc80367ce38a60e821c42c48b2` |
| `supabase/pending/project_tile_editor_v2.sql` | `affb44cad38da1635c519da1df2cca411f8d103e436d5718f7b3ae9dec1b9898` |
| `supabase/pending/creator_domain_trial_v1.sql` | `d8c6736232ad3e9d8441a2bff316d556b5bc19a4786b3606586c07f129756426` |
| `supabase/pending/creator_domain_orders_v1.sql` | `cd82c370a0707ee445f1e0360f964d93a832c510684236c929314715a0918ccc` |

Coordination that the frontend now requires: **every writer in this branch uses the versioned API the moment it answers, and fails closed when it answers with anything but its own `unconfigured` signal**; enrolling a record (first v2 mutation) is therefore safe for these callers. A deployment that enables `EDITOR_V2_ENABLED` must ship this frontend (or newer) in the same release: older browsers' blind legacy writes to an enrolled record receive PT409 by design (today surfaced as 503 by the legacy project adapter — request 6).

### Rollback and recovery for enrolled (protected) records — corrected

Once a record is enrolled, its history and protection are the record of truth. **Rollback is never "disable protections" or "revert to blind legacy writers":** dropping the triggers, clearing `protected`, or shipping a frontend that writes without revisions would let two tabs overwrite each other again and would orphan the audit the owner has already relied on. What is compatible, in order:

1. **Containment (configuration, approval-gated):** set `EDITOR_V2_ENABLED=false` (and `WEBSITE_STUDIO_ENABLED` as today). This frontend then reports `unconfigured` for **unenrolled** records and uses the legacy path with its courtesy readback; for **enrolled** records the legacy write is refused server-side (PT409) and the frontend shows that it cannot save until the versioned editor is back. That is the honest state: no silent data loss, the owner's edits stay on screen. Enrolled records are therefore **read-only for ordinary owners while the flag is off**; house moderation still works through the legacy takedown route for member fronts (it advances the revision; the SQL preserves the trigger's accounting).
2. **Forward fix (code, review-branch):** repair the frontend/Worker and re-enable the flag. Because every mutation is an immutable revision, nothing needs to be "undone": a bad save is corrected by a new save or a Restore from the history (new audited revision), never by deleting rows.
3. **Content recovery (owner action in the UI):** History → Restore to draft (owned pages, never republishes) or History → Restore to the live site (Control homepage, explicit). Both create a new revision and keep the old ones. A house takedown is not reversed from the member's editor (v3 contract); recovery of a member page is a house decision.
4. **Data recovery (Codex, approval-gated):** if the private history itself must be restored, that is a database restore from backup of `private.editor_versions` + heads + source tables together, on an authorized target, as MIGRATIONS.md already requires — not a migration that drops or truncates (the triggers refuse history edits by design, `42501`).

**Real limits:** containment makes enrolled records uneditable by owners for its duration; there is no supported way to "unenroll" a record (no browser unprotect endpoint by design); the legacy project adapter's PT409→503 mapping (request 6) means an owner on an old frontend sees "storage unavailable" rather than "protected" until Codex maps it; none of the above is proven against live Supabase here. Production flag changes, backups and restores remain separately approval-gated; this branch requests none.

## Remote state at publication (2026-11-02, checked read-only)

- `main` still `e80cb0a1`; the review branch is 82 commits ahead, 0 behind (GitHub compare).
- No newer authoritative backend integration branch is advertised yet. The only `codex/*` refs are `actor-evidence-preview-20261101` (`baa92490`), `onboarding-integration-20261031` (= exact #681 `5e020833`), `reflection-health-read-20261031`, `end-racism-reel-funnel-v1`; `claude/backend-control-integration-601s0k` is a September Channels view, unrelated. The owner reports backend corrections (social enforcement, lyric fixes) made after the v5 snapshot: **v5 is therefore not assumed current.** When the integration commit is supplied, the delta is reconciled here only after verifying its exact commit, ancestry over `e80cb0a1`/`5e020833`, `SOURCE-HASHES.json`-style source hashes and the pending SQL/API versions; nothing in this branch's bundle-sourced backend files (`editor-versioned.js`, `project-tiles.js`, `platform-module-access.js`, the four pending SQL files) is to be kept over a newer Codex version, and none of them was modified here.

## Owner decisions still open (unchanged)

Trial policy (calendar month vs 720 h, once-per-org, freshness, sandbox), app↔price mapping, hosting economics, renewal consent/prices, retention/export terms, pricing/commission, #686 navigation adoption, branch protection / HTTPS / Access / password / extension moves, campaign budget/platforms, the Anti-Social rights checklist answers.

## Continuation 2026-11-02 PM (Claude, taking over the remaining scoped work)

Authority: owner handoff "CLAUDE CONTINUATION HANDOFF" (review-branch publication only; no main merge, production SQL, deploy, paid service, domain purchase, ad, actor posting or tracking activation). Nothing below was applied to production.

### Stage 1 re-verified before any change

| Ref | Full SHA | Finding |
|---|---|---|
| `origin/main` | `6cddfbec6e75a123dedecbd8a069f5d61c476ef2` | 14 commits past `e80cb0a1`: #684, #685, #687, #688, #686 |
| `codex/productization-recovery-20261102` | `17ed110d52a425c1570e67fbbdc6308d7b064559` | parent `edd8cdd8`; already merged into this branch at `5d44e435` (no re-application) |
| review branch before this cycle | `6df05e3d2c5c3842bac9fa3587436bdac3dba816` | contains `edd8cdd8`, `17ed110d`, `e80cb0a1` |
| `story/cluster-fucked-workspace-20261101` | `9d7a7eedc495bb577da1df879cbf7a8fe7aa1cfa` | not an ancestor of main or of this branch (see Music below) |
| `a3cde5de` (Whip Equipped local checkpoint) | — | **not a valid object on the remote**; not invented, not redone. Request: the recoverable patch/commit. |

### Merge of main (`e91f8336`)

Seven conflicts, resolved deliberately (no side dropped):
- **#686 Control NAV adopted** (owner merged it 2026-11-02 after the bottom-bar trial was approved; D8 is answered). The branch's Create view `member-fronts` is a NAV leaf (`#create:member-fronts` + aliases `members`, `moderation`, `takedown`); its bind is kept; the removed `crViewSelect` is not revived.
- `css/control-admin.css`: the branch's front-page revision/member-fronts styles AND main's lyrics/stems styles.
- `js/music-creator-studio.js`: the branch's "never roll back the handoff draft" rule AND main's `attachLyricSheet()`.
- Equity Uprise source map: union in main's order then the branch's, plus the missing `ANTI-SOCIAL-CAMPAIGN.md` entry; generated reports path-normalized.
- The versioned editor protections, dual-CAS Tile bridge, social status contract, conflict/readback fixes and corrected recovery guidance are untouched by the merge (none of their files conflicted).

### Shared Now Playing (`3cb46a81`)

| Item | Result |
|---|---|
| 2A autoplay metadata | **fixed**: `renderSheetTrack()` is the one renderer for title, artist, credit, film, license target and a `mcc:now-playing` event; `load()` calls it on every track change, so natural `ended → next` updates the open sheet with no tap and no timer. The 60 ms `setTimeout(openSheet)` is gone. `album.html` has no repeat/shuffle control (not tested; not claimed). |
| 2B actions | **done**: the sheet keeps License this track and the sleep timer; "On the record" (catalogue) and "Book the studio" removed from the sheet. Timer: "Sleep timer: off" / "Stop playback after N minutes" + "Turn off timer"; 44px. |
| 2C license routing | **partial, honest**: requests from `album.html` are saved as a house lead naming the record and the rights holder (`data-license-holder` = the record's artist). They appear in Control (Home → Needs you; People → Inbox). **No email is sent**: `public.leads` has only a rate-limit trigger (verified read-only); the confirmation now says so. Every record the desk lists is house catalog (Matthew; PRIM3 and the Equity Uprise act, both controlled by the house account). **Gap:** a tenant's own release must route to that release's controller account through a server route that resolves it (needs the label model below applied + a Worker/Edge route); until then tenant releases are not offered in this desk. |
| Evidence | `scripts/e2e/now-playing-continuity.e2e.mjs` 18/18 at 390 (natural ended→next, exactly one advance, manual next/prev synchronous, actions, timer, license lead body, no overflow, no page errors); `lyrics-sync` 328/328; `music-world-continuity` 117/117. |

### High Alert lyrics — investigated, cause established

- Player state is not the cause of the wrong words: the shipped `data/lyrics/high-alert.json` itself carries `source:"auto"` (recogniser text, faster-whisper small.en) — e.g. "Hylar", "Terved you with the scope of my work".
- The owner's sheet exists, verbatim, in `mcclusterishere/Prim3` at `source-material/high-alert/LYRICS.md` (from `Prim3 - High Alert.docx`; repo HEAD `160020bdeac4afa0cd3f25638169e657af55bc29`). It was **not among the files uploaded to this session** and no lyric table exists in production (no `lyric` tables; `lyrics_machine_v1` and `music_lyric_revisions_v1` are pending), so the machine never had it. The same is true for Red, Blue, Purple, White Team.
- So the defect is a **text** mismatch (no sheet), and timing was computed against the wrong words. Passages that matched are where the recogniser heard correctly.
- Fix: both sheets copied verbatim into `data/lyrics/src/` and aligned with the existing machine (`--sheet`, local CPU, no paid provider), output `reviewed:false` — shipped as a separate main PR (see Music row), not approved on the owner's behalf.

### Music module (`9d7a7eed` reconciliation) — attempted, not yet integrated

- `88f58527` + `9d7a7eed` (story branch) add private, immutable lyric revisions (`private.music_lyric_revisions`, pending `music_lyric_revisions_v1.sql`), server-checked approved export, and public-projection allowlisting for **uploaded (DB) releases**. Shelf tracks (`data/lyrics/*.json`, e.g. High Alert) are not affected by it.
- Cherry-pick of `88f58527` onto this branch: **17 conflict hunks** — `js/control-room/lyrics-review.js` (12; both sides grew the same module: main added Core re-run + stems, the story branch added revision identity/approved export), `music-ops.js` (1; main's Stems tab vs the story branch's prepare/expected-hash review), `supabase/functions/music-access/index.ts` (1), `css/control-admin.css` (2). Aborted cleanly rather than resolved by picking a side; it needs a deliberate union (handed to a follow-up on this branch).
- **Security finding on main (relevant to the correction):** main's `operator-lyrics-save` (`supabase/functions/music-access/index.ts` ~L221) writes `reviewed`, `reviewed_at`, `reviewed_by` **inside `creator_tracks.lyrics`**, the creator-editable, publicly readable JSON — the exact pattern `LYRIC-HISTORY-CORRECTION-20261101.md` identifies (a creator can set their own "reviewed" flag; history in the row is public). Not exploitable for audio release (the release guard is separate) and no production lyric data exists yet (no lyric tables; pending SQL unapplied), but it must not ship as the approval record. The correction above is the fix; until it lands, the Control "reviewed" mark on uploaded releases is advisory only.

### Owner-directed music work (separate PRs on main, not this branch)

- PR #690 `feature/prim3-artist`: PRIM3 its own artist (`MusicGroup` `…/prim3-artist.html#prim3-artist`), album "Cyber Security Specialist", artist page, label model as pending SQL (`music_label_artists_v1.sql`, `music_creator_managers`, `music_can_act_for()`), Control "Acting as" switcher (read-only until SQL applied). Credits not invented; slug/keys unchanged.
- ISRC matching = pairing uploaded recordings/files with songs. **Blocked on source**: storage holds no ISRC/CSV/spreadsheet object and `music_isrc_allocations` is empty (read-only check); the owner has been asked where the file lives.

### Regional intelligence / OVH (item 4)

Implemented what is ready, on the owner globe only: PR #689 (`feature/world-markets`) — GDP (World Bank WDI + IMF, periodic, `is_live:false`, source/period/retrieved), 49 exchanges with open/closed by schedule (holidays not modelled, said), listings via a key-gated provider (`needs_key`, never fabricated; non-US price `needs_paid_feed`), GDELT finance headlines labelled unverified; owner-gated, cached, rate-capped, no model call per click. **Not done**: PRIM3 multi-agent missions, character voice, public privacy-preserving aggregates beyond what exists, OVH benchmarking — OVH capacity is unmeasured and no concurrency is promised. No tracking or posting was activated.

### Whip Equipped (item 5)

Spec preserved as given. `a3cde5de` not on the remote → not redone; WHIPFOUNDING100 is a proposal, not active; gross-vs-net for the house allocation unanswered; no live revenue routing.

### Verification at this continuation's tip (2026-11-02 PM)

The npm registry was reachable this time, so the dependency-blocked results above are superseded by real runs:

| Suite | Result | Note |
|---|---|---|
| Root `node --test scripts/test/*.test.mjs` | **1,436 / 1,436 pass, 0 fail, 0 skip** | combined source after the main merge + Now Playing |
| Worker `npm test` (`npm ci` + real `@electric-sql/pglite@0.5.10` via `PGLITE_DIR`) | **1,355 / 1,355 pass, 0 fail, 0 skip** | the 4 former dependency-load failures and the 4 PGlite-gated skips all ran and passed |
| `editor-versioned-db.mjs` (real PGlite) | PASS 158 | |
| `tile-editor-bridge-db.mjs` (real PGlite) | PASS 57 | |
| `social-consumer-db.mjs` (real PGlite) | PASS 67 | |
| `domain-trial-db.mjs` (real PGlite) | PASS 103 | |
| `prepared-foundation-db.mjs` / `free-site-minimum-db.mjs` (real PGlite) | PASS 28 / PASS | |
| `now-playing-continuity.e2e` (new, Playwright 1.58.2) | 18 / 18 | 390px |
| `lyrics-sync.e2e` / `music-world-continuity.e2e` / `control-room-nav.e2e` | 328/328 · 117/117 · 218/218 | |
| `member-front-auth.e2e` | 5 / 5 | |
| `member-front.e2e` / `control-front-page.e2e` | **24/27 · 50/52 (FAIL)** | identical on the pre-merge tip `6df05e3d` (git-archive check) → pre-existing, not caused by this cycle; open |
| Equity Uprise verifiers (repo sources, program coverage, authority hygiene) | PASS | |
| Not run | Python suite, native-PG race drivers (`*-native.py`), `control-workspace` e2e (needs `CESIUM_DIR`) | no claim made for them this cycle |

Remote: review branch tip is recorded by the commit that adds this section (see the commit log; full SHA reported with the handoff reply).
