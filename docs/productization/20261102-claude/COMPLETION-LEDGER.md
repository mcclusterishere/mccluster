# Productization finish line — one platform, one completion ledger (2026-11-02 09:36 ET)

**DONE** means a real customer can buy and use the advertised platform and the owner can operate it. Nothing below is DONE by that definition. This ledger says exactly how far each stage is, what evidence exists, what kind of evidence it is, and who holds the next move. Source: review branch `claude/whole-platform-20261102` (see `HANDOFF.md` for the per-surface detail); no main merge, production SQL, activation, deployment, purchase or spend has occurred or is requested here.

Evidence classes used throughout: **local-fixture** (real SQL + real Worker handlers on a disposable PostgreSQL, synthetic Auth/Storage/provider) · **local-runtime** (the real page scripts driven in a harness) · **local-browser** (Chrome at 390/1280 over the static tree, signed out) · **sandbox** (a provider's sandbox, with its own evidence) · **live** (the production service, a real customer). Only **live** counts toward DONE.

## 1. One current build — PINNED (review branch; not merged, not deployed)

| Item | State | Evidence |
|---|---|---|
| Backend snapshot published | **done** | `codex/productization-recovery-20261102` = `17ed110d52a425c1570e67fbbdc6308d7b064559` (ls-remote + GitHub API agree, committed 2026-11-02 14:38 UTC); parent is my `edd8cdd8`; `e80cb0a1` and `5e020833` are ancestors |
| Snapshot verified | **done** | all 19 `MANIFEST.json` staged hashes match the committed blobs; every backend runtime/SQL file (`customer_social_trial_consumer_v2.sql`, `social/customer.js`, `social/meta.js`, the three v5 pending SQL files, `editor-versioned.js`, `project-tiles.js`, `platform-module-access.js`, fixtures, drivers) is byte-identical to the v6 bundle (`SOURCE-HASHES.json`, bundle self-check 0 mismatches); the four manifest "bundle" differences are the documented doc/registry unions; my preserved files unchanged; `live-callers.json` carries my `site_content_v2` + the three social v2 RPCs; `supabase/migrations` + 355 ledger byte-identical to main |
| One combined revision | **pinned** | review branch merge commit `5d44e435…` (= `17ed110d` + my `45b81861` completion ledger), followed by this cycle's social status-contract UI; tip recorded in HANDOFF/commit log. No history rewritten; the v6 bundle was NOT overlaid onto the snapshot |
| Versions verified | partial | Worker lockfile unchanged; pending SQL set = v5 three + `customer_social_trial_consumer_v2.sql`; new RPCs `customer_social_access_v2/service_v2/token_v2` registered pending-only; **npm/pip still unreachable here → 4 Worker test files dependency-blocked** |

## 2. Module-by-module — explicit result for every module in the master assignment

| Module | Implementation (this branch + existing engine) | Test result | Blockers / unfinished |
|---|---|---|---|
| Account / login / return-to-draft | existing M Account; template intent kept via `account.html?next=`; account-switch guard | local-runtime: account switch drops draft, nothing saved | **live Auth not exercised**; profile restoration source `1fdef132` not on remote |
| Builder / publishing (front, project, three tiles) | revision-aware save/publish/unpublish/withdraw/recover/history/restore; fail-closed; history-verified readback; recovered-success contract | local-fixture 158 (editor), 57 (Tile bridge), native races; local-runtime 15 + 18 + 6 + 3; local-browser 14/14 | flags off; SQL pending; **real Storage bytes / renderer not live-tested** |
| Domain checkout / fulfillment | existing adapters; honest status vocabulary; term/renewal disclosure; 24h provider-lapse surfaced | Worker units; native: duplicate funding → one payment, same-host claims → one attempt, same-order → one authority | **registrar sandbox-only; live mode refused by factory; 18 bindings absent on inspected deployment; refund settlement, renewal, transfer absent; apex/TLS; no scheduled refresh** |
| Trial / billing / entitlements | v5 projection UI; authenticated cancel; expiry wording retains site/data/control | local-fixture 103 + native; local-runtime 5 | **flag off; policy unseeded; grant blocked on registrar readback adapter; order id missing from projection (Codex req. 2); no module price mapping** |
| Social / community / shop | v6 atomic consumer (SQL-enforced mutation authorization, atomic managed-token read, `entitlement_reason` vs readiness) is now in the combined source; UI renders authority/mode and both reasons, gates publish on `can_publish`, keeps recovery controls, 403 generic | v6: 67 SQL/Worker + native (duplicate grant once; mutation/cancel serialized; lock-inversion safe abort) rerun here on native PG; Worker +10 social tests pass; UI harness 6 | flag `CREATOR_SOCIAL_MODULE_ACCESS_ENABLED` unset; policy unseeded; paid SKU mapping (owner); World delivery + signed uploads remain paid/preflight-gated (CONSUMER-LEDGER); provider OAuth live; shop/direct-music flaws (Codex) |
| Admin operations (Control) | Member fronts moderation view (now a NAV leaf); Control homepage revisions; module switches server-confirmed; #686 six-section NAV adopted via main merge `e91f8336` | local-runtime 5 + 6 + 4; control-room-nav e2e 218/218 | member-front e2e 24/27 and control-front-page 50/52 fail identically on the pre-merge tip (pre-existing, recorded) |
| Music / lyrics / releases / stems | #684/#685/#687 in via main; Now Playing renders from one source on every track change (autoplay fixed), actions reduced to License this track (sleep timer removed per the supplemental handoff), license requests name the rights holder; High Alert + Red/Blue lyrics re-timed to the owner's sheets (PR #691); PRIM3 artist + label model (PR #690, pending SQL) | now-playing e2e 18/18; lyrics-sync 328/328; music-world 117/117 | `9d7a7eed` correction **not integrated** (17 conflict hunks; follow-up); main's `operator-lyrics-save` stores review flags in creator JSON (advisory until the correction lands); tenant license routing needs a controller-resolving route; ISRC pairing blocked on the source file (none in storage) |
| Navigation | #686 NAV + one/two-tap Control button adopted (owner merged #686 on main 2026-11-02); Control crumb back to Home | appbar/route suites green; control-room-nav 218/218 | — |
| Learning (private math LMS, PRIM3 progress) | **PRIM3 optional learning-unlocked tactical hints** on the real tactical resolver (`mcclusterishere/Prim3` `claude/tactical-hints-20261102` = `7d6bd3169239ea5e732fc2903d8931ffb233d7c6`: `game/runtime/tactical-hints.mjs`); phone-first board (`prim3-tactics-preview.html`, noindex): tap-to-select, legal-only action menu, path-checked move preview + Confirm/Back, Fire preview, visible math (axes, origin/target, x/y run trace), saved progress, zoom/pan — see PRIM3-MOBILE-PASS.md (designed vs implemented vs verified) | Prim3 engine 39/39 (15 new hint tests); engine 41/41 (Prim3 `f4aac223`); phone e2e 65/65 at 390/1280 + reduced motion; vendor-hash test | source `5d76d704` (private math LMS) not on remote → challenge bank authored + exact-rational checker instead; no server route yet (preview holds the session in-page; production must keep the answer server-side); objective/LAB-node positions only via `battlefield.objectiveTiles`; resolver has no pathfinding; hex adapter not built |
| Story / game / profile integration | — | — | `edaf4e09` / `e5d11804` / `1fdef132` not on remote; holds persist |
| AI proposal route (owned assistance) | full host slice; owner-typed source works | 5 pure + 3 runtime | **`POST /v1/ai/tile-proposal` does not exist on the plane (Codex req. 1)**; "Ask McCluster" says so honestly |
| OVH character controls | — | — | `baa92490` uninspected; `publication_eligible:false`; CLI Forbidden |
| Analytics / privacy | — | existing suites | #640/#642 uninspected together |
| Operations / release tooling | pg-native-shim, cdp-lite audit, evidence logs | all suites at tip | deployed attestation; monitoring/support runbook (stage 5) |

## 3. Customer journeys — what is proven, and by what kind of evidence

Two synthetic customers (A, B), the house owner and an anonymous session exist in the fixtures. **No real customer account has been created or used; no live journey has run.**

| Step | Evidence class | Where | Live? |
|---|---|---|---|
| Sign up | — | `account.html` exists; fixture Auth only | **no** |
| Build / save / preview / publish | local-fixture + local-runtime | editor suite "free-builder journey" (create → save → resume → publish → public read 200 → withdraw → public 404 → recover → still 404); harnesses | no |
| Return / edit (two tabs, lost responses) | local-fixture + local-runtime | native PT409 races; readback-contract block; harness two-tab race | no |
| Cross-account isolation | local-fixture | B reading/restoring/taking down A's record → 404/P0002/42501; B's access to A's org → 403 | no |
| Purchase a domain | **sandbox-only, not run live** | checkout session binding; quote identity checks; `registered_pending_reconciliation` honest | **no** |
| Receive a registered domain | — | adapter reports `charge_readback=false`, `registrant_readback=false` | **no** |
| Connect DNS / HTTPS | local-fixture | provider-binding recovery fixture; UI lapse notice | **no** (CNAME-only; apex unverified) |
| Receive the included month | local-fixture | `creator_domain_trial_record_v1` with trusted evidence; idempotent replay; native duplicate-grant-once | **no** (grant adapter blocked) |
| Add / cancel modules | local-fixture + local-runtime | cancel route 200 + idempotent; projection flips | no |
| Expire advanced access, retain site/control/data | local-fixture | expiry/cancel states deny advanced, `base_manage` stays allowed, drafts retained | no |
| Failed / duplicate payments | native | duplicate funding → one payment; failed order → `refund_required` (not a refund) | no |
| Signed-out public read of a published page | local-fixture | public read 200 only when published, profile public, not removed | no |

## 4. Owner and provider gates — decisions needed together (none can be made by an agent)

| # | Decision | Why it blocks | Options on the table |
|---|---|---|---|
| D1 | Registrar / resale permission and account | live purchase is refused by the factory until a reviewed registrar account with registrant + charge readback exists | Cloudflare Registrar (current adapter, sandbox proven; resale terms to confirm) vs another provider (new adapter) |
| D2 | Secure configuration of the 18 absent bindings | nothing can be fulfilled without them; **no keys in chat** | owner sets them in the Worker's settings; agents verify presence by name only (read-only), never values |
| D3 | Post-trial prices and app↔price mapping | `creator_domain_trial_modules` is unseeded; UI cannot show a price it does not have | per-app monthly/annual Stripe prices; which apps are "advanced" vs "white-label" |
| D4 | Baseline hosting after the trial | projection says `economics_policy_unresolved`; the UI promises nothing | free static hosting at the McCluster address retained / paid hosting module / time-boxed grace |
| D5 | Trial policy | SQL supports both; policy row unseeded | `calendar_month_utc` vs `fixed_30_days`; `once_per_org`; evidence freshness window; sandbox allowed? |
| D6 | Renewal and cancellation policy | adapter has `renew:false`, `auto_renew:false`; no renewal price disclosed | manual renewal only (current) vs auto-renew with explicit consent capture |
| D7 | Operating costs and refund settlement | `refund_required` is a state, not a refund; registrar fees are owner's | who absorbs failed-registration refunds; markup (`CREATOR_DOMAIN_MARKUP_CENTS`) |
| D8 | #686 navigation | **answered 2026-11-02**: owner merged #686 (NAV + shared bottom bar kept, one/two-tap Control) | — |
| D9 | Anti-Social rights checklist | no ad creative until answered | the 10 lines in `ANTI-SOCIAL-CAMPAIGN.md` |
| D10 | Retention / export terms | required before any paid activation | keep-forever at free tier vs export window |

## 5. Release and verify — prepared, not requested

Exact code: this branch at `edd8cdd8…` merged with the backend commit once published (stage 1). Database: the four pending SQL files by hash (`HANDOFF.md`), applied by Codex in the documented chain with backup of source tables + `private.editor_versions` + heads; no drop/truncate. Rollout: flags stay off at deploy; enable `EDITOR_V2_ENABLED` only together with this frontend; `WEBSITE_STUDIO_ENABLED` and `CREATOR_DOMAIN_TRIAL_ENABLED` after D1–D5. Recovery: `HANDOFF.md` → "Rollback and recovery for enrolled records" (flag containment, forward fix, Restore, backup restore; never protection removal). Post-release verification, in order, with a real customer account: sign up → publish → signed-out read → two-tab conflict → purchase (D1/D2) → registration readback → DNS/HTTPS → included month → cancel → expiry; admin: moderation takedown, Control homepage restore, module switches; operations: Worker logs for PT409 rates and readback outcomes, support path for "saving paused" states. **None of this is authorized by this ledger.**

## Engineering still open for agents (not owner decisions)

Codex: backend publication (stage 1); requests 1–6 in `HANDOFF.md` (tile-proposal route; order id in projection; module manager contract; lyric security correction; PT409→409 mapping). Claude: reconcile the backend commit when published and rerun acceptance against the combined source; #686 adoption if D8 says so; music/LMS/story UI once their sources and corrections exist.
