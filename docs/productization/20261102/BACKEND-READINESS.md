> Current publication supplement: see [the frozen source manifest and continuation](../20261102-current/SNAPSHOT.md). Historical local-only/no-push wording below describes earlier checkpoints and is superseded only for authorized non-force review-branch publication. No main merge, production migration, deployment, credential change or spending is authorized. Claude's implementation is preserved from `edd8cdd8be4d07fa674071a9b151045bf7cfc94c`; see [its handoff](../20261102-claude/HANDOFF.md). This snapshot publishes reviewed source corrections; complete combined acceptance remains outstanding.

# Backend readiness matrix

Current overlay: the table below records the original production/source audit. Missing production CAS is now addressed in local c150/v3 contracts, not deployed. See [v4 integrated proof and remaining caller/real-service gates](../20261102-v4/HANDOFF.md) and [whole-site acceptance](WHOLE-SITE-ACCEPTANCE.md). The whole website is the assignment; the editor is one slice.

Status meanings: source = inspected code; pushed = remote SHA verified; merged = ancestor of fetched main; deployed = independently attested running code; functional = scope of actual exercised behavior. Unknown is not success.

| Area | Source / pushed / merged | Production data evidence | Functional proof / remaining gate |
|---|---|---|---|
| Identity and Control shell | Main; #686 separately pushed, unmerged | Existing platform/network/org authority | Preserve existing M Account and server membership; live session/switch/reauth not exercised |
| Admin homepage builder | Main `js/control-room/front-page.js`; real page preview, `@front` config | `site_content`, history, admin-gated RPC definitions verified | Existing manual controls, save/default-reset; no CAS or arbitrary history restore; do not replace index.html |
| Profile restoration | Parent-reported `1fdef132`, separate local branch | Existing profile authority only | 48 focused/42 mock-browser reported by owner worker, not rerun here; its GitHub credential invalid; no bypass or edits |
| Owned front/page editor | Main front handler; #681 project stack pushed/unmerged | `member_fronts`, `managed_projects`, front-media absent | Minimal real-SQL/Worker fixture passes; stale overwrite reproduced; Storage/session integration pending |
| Project identity | #681 prepared SQL | Immutable project UUID/guard absent until migration | Identity mutation rejected in fixture; no new display-name authority |
| Website quota | #681 prepared SQL | Reservation tables absent | Native two-session quota and fixture recovery pass; live streaming/HEAD/overwrite/delete and signed-upload expiry gate |
| Website modules / aliases | #681 pushed/unmerged | Module/address tables absent | Real SQL/Worker owner/module/alias fixture passes; only World/discovery controls; no full platform module manager |
| Existing tile Website Studio | #493 recovered into #636/#681; keep existing engine | Separate draft/media/revision/processing prerequisites not certified deployed here | Exact expected_revision exists; processing allowance, executor, private storage and publication need separate verification |
| Domain connection | #626→#636→#641→#681 | `creator_domains` absent | Provider binding/fencing fixture passes; scheduled refresh, apex support, TLS and approved routing unresolved |
| Domain registration | #637/#681; adapter disabled | Attempts/contact extensions pending | No credentials/purchases; provider readback, renewals, operating terms and sandbox behavior unresolved |
| Customer billing/storefront | #625/#633/#681; main canonical commerce retained | Existing creator subscriptions and work/payment stores present | Provider event/account/order/session/amount/currency plus refund/failure regression required; no live activation |
| Direct music commerce | Main hardened Edge code and applied schemas | Existing direct order/offer/entitlement and music version stores | Parent-verified mutable-path/early-count gap remains; no actual purchase, download, refund proof |
| Lyrics and immutable revision approval | Remote `9d7a7eed`; no open PR; unmerged | New lyric revisions/RPCs absent per parent catalog | Parent reports 50 SQL assertions; separate approval/export security correction must accompany #684 integration |
| Albums / stems | #684, #685, #687 pushed/unmerged | Their pending catalog/lyric/stem changes not applied by this task | Stack #685/#687 on #684; rights/private originals, immutable versions and exact catalog identity must survive |
| Social posting and recovery | Main social engine; customer #624/#628/#634/#681 | Existing social stores present; customer additions not certified | No provider publish; use canonical queue and provenance, never parallel scheduler |
| Analytics / privacy | Main; #640/#642 independent drafts | Parent catalog evidence pending incorporation | #642 extends #640; minimize event payload and maintain consent/entry-policy match; no broad behavioral certification |
| OVH actors | Remote `baa92490`; no open PR; unmerged | Existing Core plane; no live execution here | Parent 398 Core/55 actor tests; publication_eligible false; semantic reviewer unreliable; direct CLI Forbidden stays a stop |
| Private math LMS | Parent local `5d76d704`, later 60-card work in flight | Actual progress columns, grants and own-user RLS verified | Existing JSON mastery supports personal practice; no new SQL proven necessary. Source archive not materialized here; active worker owns it. No push approval assumed |
| PRIM3 course achievements | Main own-user progress | Browser may update own assessment/mastery/passed fields under RLS | Suitable for personal practice, not independently certified learning outcomes; server scoring needed before credential claims |
| PRIM3 story / game | Parent local `edaf4e09`; separate Prim3 `e5d11804` | No new backend authority inferred | Story ending holds, separate game interface only; neither is backend product completion |
| Independent distribution | #683 merged in main | Current production ledger is not a clean installer | 136 bound runtime/config files; no neutral baseline, two-install isolation, upgrade/restore or supported release package |
| CI / release governance | Pinning present in current Worker lockfile; all PR observations recorded | No production settings changed | #681 visual failures, skipped previews, no approved reviews; branch-protection/HTTPS/Access/password/extension moves remain owner decisions |

Private work is recorded from the delegation as status evidence, not as a claim that this environment can inspect another worker's unpushed filesystem. Old public `prim3-lms-foundation` is not the private math implementation.

## Local v5 registration/trial increment

| Area | Local status | Remaining gate |
|---|---|---|
| Verified annual registration → included trial | Pending SQL, immutable evidence/receipt and idempotency tested | Real registrar charge/registrant readback; reviewed policy and application |
| Trial/module projection, require and cancel | Service-only SQL and authenticated Worker routes tested | No policy/module/price seed; exact app consumers |
| Expiry/cancel/refund | Advanced denied, existing base controls/data retained | Hosting economics and detailed commercial policy unresolved |
| Social server guard | Additional default-off check before mutation; recovery retained | Existing paid-only SQL still applies; atomic consumer integration/queue policy needed |
| Production state | Unchanged | No SQL, flags, billing, credentials, push or deployment authorized |

## Local v6 social consumer increment

Customer social service mutations and managed job admission use transactional entitlement checks; managed token authorization/read is one service-only RPC. Explicit SQL consumer mode and Worker feature flag remain default-off. Snapshot grandfathering, cancellation, app/global safety and mapped paid behavior are tested locally. See ../20261102-social-consumer/CONSUMER-LEDGER.md for every other consumer; metadata is not execution enforcement. Production remains unchanged.
