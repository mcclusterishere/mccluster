# Self-service work reconciliation — 2026-10-26

The customer editors were not lost. Basic profile editing, a rich cinematic front
editor, creator release tools, recording/video trim, subscription checkout and a
minimal paid publisher are already merged. Several substantial implementations
remain on branches. The customer journey is fragmented across different data
models, permissions and deployment states; some required migrations were never
activated. Do not build another editor or merge historical branches wholesale.

## Evidence boundary

Released-main baseline: `396760eb72121e9673c6fc3df062f3af29660c10` (#620/#621).
Inventoried all 605 pull requests returned by the repository API, all 206 reachable
branch heads, and relevant paths changed since each branch's common ancestor with
that main. The inventories include closed-unmerged PRs and branches with no PR.
Metadata inventory is exhaustive for this snapshot; semantic source review is
focused on the relevant implementations below, not every unrelated PR. Squash
merges mean ancestry alone is not proof of unique missing functionality.

- [PR inventory](reconciliation/pr-inventory.json): state, head, merge SHA and URL.
- [Branch inventory](reconciliation/branch-inventory.json): pinned heads, matching
  PRs and relevant changed paths since common ancestor, separate from snapshot diff.
- [Live ledger](reconciliation/live-migration-ledger.json): read-only metadata,
  348 entries. Version/name pairs exactly match `supabase/production-ledger.json`.
- Public asset re-fetches in this pass were blocked by the execution proxy (HTTP
  tunnel 403). That is not evidence that the pages are absent or broken. The release
  coordinator's main/live attestation is distinct from our source inspection.
- No real signed-in customer, provider payment, domain purchase, live mail or
  external social delivery was exercised. Historical branch test claims are not
  fresh live verification. No production changes were made.

## Preserved and parked implementation ledger

Paths refer to the pinned main or branch specified in each row; line numbers can
move in later revisions. Every PR link resolves the exact historical context.

| Capability | PR / commit / state | Source and actual boundary | Consolidation action |
| --- | --- | --- | --- |
| Basic member profile | [#516](https://github.com/mcclusterishere/mccluster/pull/516), merged `d723846d` | `member-front.html:29`, `js/member-front.js:157`: owner name/headline/bio/image/website editor over `/v1/mnet/profile` | Keep as profile settings, not another site builder |
| Creator profile studio | Main commits `04726010`, `ce3e2f53` | `mccluster-creator-studio.html`, `js/mccluster-creator-account.js:22–104`: authenticated profile load/save, visibility/discovery; marketing links it | Preserve real saves; clarify distinction from local draft preview and paid site publication |
| Owner inline editor | Main `2c0ebf42` | `js/site-editor.js:22–41,131,164`; migration `20260922100615_site_content_service_role_path.sql`: owner UI/admin RPC authority | Do not give customers the owner's site_content authority |
| Owner homepage controls | [#591](https://github.com/mcclusterishere/mccluster/pull/591), merged `21e0a7c1` | `js/control-room/front-page.js:26,61,199`: index @front controls in Control; #621 adds Vaunt context | Retain owner surface, reconcile tenant-brand footer separately |
| Motion template | Main `3443a1e3`, `ed2c839c` | `creator-template-motion-preview.html:7–10`: explicitly concept preview, plans links; no template application | Do not advertise it as applied customer template |
| Rich customer front editor | [#595](https://github.com/mcclusterishere/mccluster/pull/595), merged `7efa9b24`, implementation `03083ae5` | `front-studio.html`, `js/front-studio.js`, `js/front-media.js`, `packages/front-config`, `member-fronts.js`; member/artist owner links exist. Pending `member_fronts_v1.sql` explicitly left backend unactivated | #622 repairs this work; activate only after approved schema/storage review |
| Multiple managed projects | New draft [#623](https://github.com/mcclusterishere/mccluster/pull/623), `ed91755a` | Dashboard and project ownership reuse #595 editor; separate project media prefixes and managed-first Vaunt renderer | Extension of existing editor, not replacement/completion of #493 |
| Versioned three-tile Website Studio | Open draft [#493](https://github.com/mcclusterishere/mccluster/pull/493), `9ad0503ead6c4a581e61cc529639bebd4fa64131` | `website-studio.html`, `js/website-studio/editor.mjs:12–28`, renderer, `website-studio/service.mjs:80–139`, `website_studio_v2.sql`, `core/src/website-studio/{prepare,executor}.mjs`: templates, revisions, private media, trim/crop and FFmpeg processing | Substantial recoverable implementation; conflicts with main, flags off, access projection/processor/SQL pending. Reconcile publication authority before integration |
| Paid site publisher | Merged [#400](https://github.com/mcclusterishere/mccluster/pull/400), `43820c7e`; [#325](https://github.com/mcclusterishere/mccluster/pull/325) distribution | Existing `creator-billing.js`, `creator-site-publish.js:85–94`, minimal title/tagline/bio studio. Actual live RPC has four args while Worker sends five | #625 extends existing billing; repair compatibility with identity preserved, not four-argument fallback |
| Merchant Connect | Merged [#22](https://github.com/mcclusterishere/mccluster/pull/22), [#25](https://github.com/mcclusterishere/mccluster/pull/25) | `connect.js:376` onward, `org_stripe_accounts`: onboarding/status already exist | #625 reuses account authority and adds customer journey; no duplicate Connect account model |
| Canonical orders/fulfillment | Merged [#396](https://github.com/mcclusterishere/mccluster/pull/396), `1b80344b` | `supabase/functions/stripe-webhook/{commerce,index}.ts`, `commerce/{receipt,summary}.js`; existing live `work_orders`, `work_payments`, `work_tasks` | **Release integration blocker:** #625 creator_store_orders does not yet project into this canonical reporting/fulfillment system |
| Earlier commerce reconciler | Open [#376](https://github.com/mcclusterishere/mccluster/pull/376), `4eb85a817ab8` | Earlier branch overlaps #396, which reconciled onto current main | Compare remaining unique semantics; do not merge obsolete snapshot |
| Direct music sales | Open [#397](https://github.com/mcclusterishere/mccluster/pull/397), `66ab6a509be8` | `music-direct-checkout/index.ts`, `music-direct-access/index.ts`: order/access/provider metadata and failed persistence recovery; absent from inspected main | Recover source/SQL/webhook differences before changing music sales; generic products are not music entitlements |
| Platform creator earnings | Open [#401](https://github.com/mcclusterishere/mccluster/pull/401), `96a62bd3f398` | Stale PR prose says scaffold, but `creator-transfers.js`, six SQL files, webhook code/tests and `control-creator-payouts.html` exist; routes are house-owner-only/test gated | Preserve real implementation; distinct from seller proceeds, crowdfunding and spendable balance. Branch ledger edits are not production proof |
| Artist release studio | Merged [#144](https://github.com/mcclusterishere/mccluster/pull/144), `1058c1a3`; #288/#399/#423 hardening | `creator.html`, `js/music-creator-studio.js:627–638`: masters/previews/rights/release review; [#398](https://github.com/mcclusterishere/mccluster/pull/398) adds artist albums/photos/rate-sheet booking | #629 private collaboration needs explicit rights-preserving draft-to-release handoff, not replacement |
| Recording/video trim/post/schedule | Merged [#278](https://github.com/mcclusterishere/mccluster/pull/278), `53f26f12`, later lifecycle hardening | `create.html:40`, `js/create.js:296,652–658`, `platform-api.js:678,710` | Already exists outside music workspace. Reuse capture/trim/post flow; don't claim no video editing exists anywhere |
| Stem/audio analysis | Open [#541](https://github.com/mcclusterishere/mccluster/pull/541), `e528b3609a84` | `js/resonance/*`, `scripts/research-engine/derive-stems-score.py:55`: actual local analysis and optional offline tools | Branch-present, not integrated into main/#629; retain local-analysis/privacy boundary |
| Persistent runtime and stem/MIDI/MusicXML queue | Open [#543](https://github.com/mcclusterishere/mccluster/pull/543), `2d0b8da4e3dd`, stacked on #541 | Runtime shell, SQL queue, `music-job-worker.mjs`, `model-adapters.mjs`, creator review; creator-owned rights-attested tracks required | Reuse pipeline. #629 project assets/members differ from creator_tracks/creator-masters; design reviewed handoff, not new queue |
| Helix | Open internal-only [#535](https://github.com/mcclusterishere/mccluster/pull/535), `a7f7a84c0f93` | `_unfinished/helix`, publishing exclusion | Keep internal; no shipping DAW claim |
| Legacy domain offerings | Main `sites.html`, `data/offerings.json`, `docs/domain-search.md`; admin `platform/src/server.mjs:287` | Search/price marketing and manual registration after payment; legacy SKUs are not new Creator Platform; admin registrar route gated | #626 does not fulfill legacy domain SKUs. Do not reuse admin purchase endpoint as customer checkout |
| Owned-domain draft | New [#626](https://github.com/mcclusterishere/mccluster/pull/626), `f259bbb5` | Immutable owner/handle binding to member_fronts, DNS/TLS state, disabled registrar order lifecycle | Domain target does not yet cover #493 Studio revision or arbitrary managed project; resolve target contract before selling |
| Password/profile successor | Closed-unmerged [#236](https://github.com/mcclusterishere/mccluster/pull/236), merged [#239](https://github.com/mcclusterishere/mccluster/pull/239) `16f67753` | Existing profile password flow survived via successor | Do not revive old branch merely because it was closed unmerged |
| Other profile branches | Closed-unmerged [#289](https://github.com/mcclusterishere/mccluster/pull/289) `ca74d40b`; open [#425](https://github.com/mcclusterishere/mccluster/pull/425) `70380ab1` | Website-as-profile proposal and artist identity alignment; later #516/#595/#577/#581 overlap | Compare remaining handle/collision/write-through semantics before replay |
| Existing social queue | Merged #29/#30, main `625439e8`, `08a251f0` | Org-scoped queue/leases, Meta private uploads/drafts and Action content identity already exist | #624 adds customer OAuth/credential lifecycle on that queue; preserve canonical queue |
| Existing multi-destination composition | Main `91b47807`, Socials Room | Multi-destination text UI uses legacy pinned-org Edge social, INTAKE_ORG_SLUG default jnh-elevate | Not customer-owned destinations; do not expose shared owner credentials as a shortcut |
| World posting/scheduling | Main `platform-api.js:479`; existing mnet | Durable scheduled World posts predate #628 | #628 adds unified composer, not new feed backend. Scheduling is absent from combined composer, not whole platform |
| Campaign/mission foundation | Main `js/control-room/action-network.js:39,395,570`, `js/mnet.js:4057–4061`; #294/#298 | Operator draft campaign creation, participant joins/proof RPCs already exist | Sponsor customer launch/funding/review/reward integration is the gap; reuse existing mission identities |
| Collaboration/Anti-Social lineage | #432 merged `ef6d1434`; open #427 and #431 overlap | #432 already includes #427 ancestry and selected #431 resources | Do not merge those whole historical heads again |
| Three-path missions/admission | Open #426 `886d09d5fcce`, #417 `f534edb2eb22`; #473 contract | #426 has proposal docs/pending SQL; #417 prototype apply/studios; #444 completion approval is not pre-assignment admission | Distinguish reviewed completion/publication from candidate admission and sponsor funded work |
| Modules/apps | Main `docs/products/MCCLUSTER-OS-REUSE-AUDIT.md`, #518 | Capability/app registries exist; sellable tenant module installer remains a proposed layer | Reuse registry authority; do not call existing operator modules a working customer installation lifecycle |

Social integration must also preserve existing attribution. Main `08a251f0` and
`social/router.js:335–360` bind social content to campaigns/missions and network
posts. #624's customer enqueue currently has no `content_id`; #628's combined
composer holds its confirmed `worldId` in browser memory. Independent retry is
fixture-tested within that session, but durable combined delivery/reload recovery
and Action conversion linkage are missing. Extend the canonical content/queue and
existing World scheduler rather than create another scheduler or promise exactly
once cross-platform publication.

Mission completion approval in pending `mission_admin_approval_v1.sql` (#444) must
not be represented as pre-assignment admission. #473's application/video/résumé
contract and #417 prototype are separate. Existing app/identity registries
(`platform_apps`, `platform_user_apps`, `platform_oauth_clients`), enabled API
catalog, developer keys and `core/src/capabilities/registry.mjs` are reusable, but
do not implement tenant module dependency/entitlement/install/upgrade/withdrawal.
The existing `MCCLUSTER-OS-PRODUCTION-PLAN-20261019.md:32–48` calls that design only.

## Related repository: mccluster-we-trust

Main `4c72de610e8b9aa81c1f02fcaf635281e3e4189a` (merged #8 after #1/#5)
contains real Studio/renderer, motion/360 and D1 draft/publish/revision/rollback.
`web/studio.js:244–315` implements the operations. `kernel/authorization.js:11`
explicitly calls its Core site authorization endpoint proposed; missing binding
fails closed. Bindings/provisioning examples do not establish an active service.
Open #10 `0f0e329d5319` adds MCC token refresh and owner MCP integration, not a
completed customer site authorization adapter; open #9 `69ad116c533b` adds
contracts. Preserve reusable code, but do not create a competing backend or infer
integration from repository existence. No deployment was verified in this pass.

## Branch-only and superseded work

The common-ancestor scan identified 57 heads with relevant unique-path deltas,
including branches without a matching PR. This is a recovery queue, not a claim
that all those deltas should be merged. Notable non-PR examples:

- `explore/artist-ecosystem-rashawn-hendricks` at `3e2a61a67859`: actual
  `artist-checkout` Edge Function, artist product/order SQL and Stripe webhook
  changes. It uses connected-account direct charges and artist_open_order; its
  store-credit/referral semantics must not be silently imported into #625 or
  generalized as a platform wallet.
- `feature/m-account-social-providers` at `aa6635071dcc`: historical auth,
  onboarding and connected-account webhook work. Later merged Connect/identity
  work must be compared semantically; an unmerged head does not mean all its
  functionality is missing.
- `feat/privacy-gate-account-integrity-20260926` at `a3afe4ee47dc`: account profile
  completion redirects and signup validation changes in mnet. Do not revive older
  signup code over #577's later unified flow or change the current access policy.
- `claude/app-store-deployment-audit-sncef9` has native profile work;
  `ui/claude-operator-os` has operator modules, not a customer module installer;
  `claude/level3-media-repo-deploy-re1i8a` has tenant-specific social code.
- `gh-pages` is a publication artifact branch, not a source-feature branch to
  merge. Architecture/course template matches are excluded from customer editor
  conclusions even though the broad inventory captures their names.

## Live metadata and ordered activation proposal — no application performed

Read-only project `zmnhbrjyhxzhkxmhkexs` findings on 2026-10-26:

- All 348 live migration version/name pairs match the committed production ledger;
  latest `20261024014732` / `analytics_forensics_search_index_v8`. This proves ledger
  parity, not every table/function definition or every applied pre-cutover checksum.
- Present: creator billing subscriptions/published sites, org_channels,
  social_publish_jobs, media_assets/media_jobs/ops_compute_tasks and canonical
  work_orders/work_payments/work_tasks. Private `mnet-media` bucket exists.
- Absent among queried objects: member_fronts, managed_projects, world directory,
  creator store/reservations/domains/orders/cohort grants, customer social private
  session/connection tables and music workspace project tables.
- `front-media` and `music-workspace-originals` buckets absent.
- `creator_publish_site(uuid,text,text,text)` exists; five-argument identity-bound
  overload does not. Source sends `p_user_id`; fallback would discard the intended
  identity check and is not the fix.

Proposed isolated activation units, each requiring an exact reviewed release and
fresh ledger/object check before approval:

1. **Free member front repair:** review existing `supabase/pending/member_fronts_v1.sql`
   with #622; test actual Storage/RLS with two authorized test tenants before public
   activation. Preserve membership/access policy. This closes an existing feature's
   missing backend, not a new business model.
2. **Managed projects:** `managed_projects_v1.sql` and #623 after member storage.
   No automatic Vaunt row/owner seed; resolve verified ownership separately.
3. **Existing paid publisher compatibility:** review
   `20261010009000_creator_site_cohort_grants.sql` (exact filename in pending tree)
   then `20261010009100_creator_publish_cohort_entitlement.sql`. Check prior
   cohort/identity tables and retain explicit service-only grants. No payment or
   cohort grant is created by the compatibility fix.
4. **Commerce:** reservations `20261026009200`, store `20261026009300` only after
   reconciling canonical work_orders/payment/fulfillment ownership with #396.
   Verify actual sandbox prices, Connect and signed event delivery before any live
   flag. Do not replay legacy base migrations that already exist.
5. **Optional connected services:** customer social SQL/Vault/paid-org trigger
   contract; domains/order SQL after target/registrar contract; directory after
   owned public source records. No external accounts/credentials/DNS are created.
6. **Private music collaboration:** `20261026009400_music_workspace.sql` with
   actual private Storage tests; existing release/recording/analysis handoffs need
   review. It does not activate #543 processing or publish a track.
7. **Parked Studio/We Trust:** do not apply #493 or satellite SQL alongside these
   models without a chosen publication authority, tenant authorization adapter,
   entitlement mapping, processor recovery and canonical commerce connection.

The plan intentionally does not renumber or mark pending migrations applied.
Compare exact SQL, dependencies and grants against live metadata at activation.
No payment-provider, registrar, Meta or production approval is implied here.

## Consolidation decisions before more overlapping implementation

1. Keep one customer dashboard and distinct profile settings/personal front/
   managed projects/music destinations. Preserve legacy routes until redirects are
   tested. Do not replace existing editors with the landing page.
2. Reconcile #493's private processed/revisioned publication with #595/#623's
   front-config/public-media model. Prefer adapters and an explicit source of truth
   over two writes that can diverge. This is an engineering integration decision;
   do not ask the owner to choose database tables.
3. Map new storefront paid/refund events into canonical commerce exactly once;
   keep seller proceeds, creator rewards and project backing separate. No common
   wallet, escrow or automated transfers are implied.
4. Preserve music originals/credits and connect private collaboration to existing
   creator review. Recover #278 capture/trim and #541/#543 runtime/analysis rather
   than implementing replacements. Do not expose the internal Helix prototype.
   Likewise connect customer social jobs to durable content/World delivery identity
   and existing campaign attribution before presenting robust reload-safe combined
   delivery or scheduling.
5. Coordinate latest profile-brand navigation before #627 merge: verified active
   profile logo/route, E=Up only platform/default, no stale logo on owner switch.
   The separate draft [#630](https://github.com/mcclusterishere/mccluster/pull/630),
   head `2cc9a0ce15249fc45f23fbaf409594552e03e04b`, now implements a document-local
   `MCC_BAR.pageProfile()` hook, same-origin profile home/logo validation and Vaunt
   entry behavior. Its tabbar remains based on main's perspective logic, whereas
   #627 replaced that logic with unconditional platform home. These require a
   deliberate merge preserving profile priority and platform fallback; simply
   choosing either complete file loses the other behavior. Also reconcile
   `front-member.js`, `main.js`, registry wording and project browser fixtures.
6. Minimum external decisions remain explicit: approved site plan price IDs and
   Connect configuration; registrar/provider plus registrant/renewal/terms model;
   owned EquityUprise.com zone/routing; Meta app/scopes/callback. Scope each request
   to the reviewed activation unit. Missing integrations are engineering work,
   not a reason to request blanket production permission.
