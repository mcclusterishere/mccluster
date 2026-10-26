# Self-service activation proposal — not authorization

For the latest tested free-site subset and optional canonical-artist/provider
extensions, use [the minimal release sequence](IDENTITY-DOMAIN-BINDINGS.md#smallest-free-website-release).
It includes independent immutable project identity; no paid-domain schema is
required merely to edit and publish a free offers or cinematic page.

**Updated first-offer candidate:** the two-file minimum below describes the
earlier PR637 baseline only. PR638 now routes website uploads through authoritative
quota reservations and adds owned aliases/modules/free tile publication. Do not
deploy its assets/Worker using only those two SQL files. Use the ordered current
candidate and evidence in [FIRST-OFFER-ACTIVATION.md](FIRST-OFFER-ACTIVATION.md).
All definitions remain pending and no production activation is authorized.

No production action in this proposal has been performed. All release candidates remain draft. Recheck exact commit, migration ledger, object definitions, provider configuration and terminal CI before asking for approval. Never apply every file in either pending directory.

## Smallest useful release: existing approved account → owned site

Target: canonical Supabase `zmnhbrjyhxzhkxmhkexs`, Worker `mccluster`, existing static site. Preserve current membership approval, URLs, accounts and personal/Vaunt presentations. No payment, registrar, social-provider or music-model activation is needed for the free cinematic editor path.

1. Resolve profile navigation CI using the coordinated #630 change and verify the integrated release SHA. Review #622/#623 and their affected consolidation dependencies; do not deploy an intermediate stacked PR as though it were standalone.
2. Read-only recheck production `member_fronts`, `managed_projects`, `front-media` bucket/policies and migration ledger immediately before migration preparation. The earlier audit found missing objects; it is not perpetual permission to recreate them.
3. Review precisely these pending definitions. Keep them pending until an authorized application records the actual production version, as required by `supabase/pending/README.md`:
   - `supabase/pending/member_fronts_v1.sql`, SHA256 `39d9b60a761f846e1a5a86f0a4fcdbe899f2fb31c67f9c70aae7b971f886150d`.
   - `supabase/pending/managed_projects_v1.sql`, SHA256 `ffb4fa7247eb29b638e8439f5f8dad19b63837bf3da273621ab0d6e925440de1`.
   The first creates public front-media with owner-scoped writes. Cinematic uploaded bytes are public even before site publication; the existing upload UI must continue disclosing that. Tile Studio uses separate private-media approval/revision semantics. Do not describe both as identical draft privacy.
4. Approval request must name those pending files/hashes and migration names, target project, reviewed application SHA and static/Worker deployment actions. No new credentials or membership policy change is included. Existing canonical Supabase binding reuse is sufficient for this path.
5. After approved application, read the recorded migration versions, compare stored SQL byte for byte, promote files using those versions, update the production ledger/drift contract and verify object definitions. Then release the reviewed Worker/assets together. First read-only checks: health/version, guest unpublished/private handling, reserved Vaunt fallback and public fixture-free assets. A real member publish test would mutate content and needs an explicitly authorized test account/content; the existing offline/native-Postgres fixtures do not authorize creating one.
6. Rollback prefers reverting application behavior and disabling affected entry points while preserving customer data. Do not drop populated tables/buckets as an automatic rollback.

## Separately reviewed additions

- **Paid plans and selling:** inspect existing cohort grants/publisher signature, promote only missing checkout/store/commerce adapters in documented dependency order; verify configured sandbox price IDs, webhook identity/mode and Connect return URLs. Existing canonical commerce v3 precedes storefront093 and adapter095. Worker plus legacy Edge guards release together. No charges, financial-account creation or live flags are covered by the free-site approval.
- **Tile Studio:** existing media/billing/compute prerequisites → `website_studio_v2.sql` → `project_tiles_v1.sql`; reviewed executor registration, allowance and feature configuration are required. Test real configured sandbox processing before claiming cloud upload works. Do not manufacture customer allowances or execute unapproved models.
- **Custom-domain connection:** domain base schema → `creator_domain_targets_v1.sql`; approve exact zone/hostname/route/fallback origin/CNAME and scoped existing-or-new credential separately. DNS control and TLS readiness require actual verification. EquityUprise.com ownership/routing remains unverified.
- **Domain purchase:** domain order schema → registration attempt/contact extensions only after completed review. Provider sandbox credentials/access, supported extension policy, registrant acknowledgements, price/contact reconciliation and operational terms remain gates. No live purchase or renewal authorization is implied; renewals are unsupported.
- **Customer external publishing:** customer-social schema → World delivery identity after existing Action schema; approve exact app/scopes/callback and encrypted credential configuration, then verify authorized provider test accounts. Instagram Professional Reels is the supported adapter; do not advertise arbitrary networks/scheduling.
- **Music:** workspace/creator schema → release handoff → repaired research queue → bridge. Verify actual PGMQ signature, private artifact policies and rights/stage review. Enqueue/execution flags remain independently off until authorized; model binaries/licenses/resources are separate from deploying review UI.

These are distinct approval scopes. A migration or UI deployment approval is not approval to accept legal terms, add credentials, create customers, publish their work or move money. The upload/processing, music consent/review and encrypted sandbox registrar wiring are now implemented and fixture-tested. Terminal CI at the final integrated SHA and the stated real-service verification gates remain required before activation.
