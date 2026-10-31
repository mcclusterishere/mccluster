# Clothing launch preparation — 2026-10-31

Status: DRAFT; sales disabled. On 2026-10-31 the owner explicitly authorized pushing a separate clothing branch. This authorizes the branch push only: no PR creation, merge, deployment, provider call, migration or production write. This is a public-safe requirements summary, not a transcript or operational customer ledger.

## Product and first increment

Launch repeatable **Hitman Most High Fashion** branded garments alongside personalized customer-name versions. Retain the brand on the bottom and put customization above it. Link the clothing experience with **PRIM3**; exact placement, destination and approved full uncropped artwork remain decisions. Do not invent or redraw marks. The approximate 2× standard and 15× custom cost multipliers are hypotheses, not approved retail prices or validated margins. Costing must include finishing, packaging, shipping, fees, labor and returns before any price is approved.

The existing Closet (`prayer-closet.html`, `js/closet.js`) and commerce contracts (`packages/commerce/src/payments.ts`, `fulfillment.ts`) already exist. Main's `checkoutOf()` chooses configured Shopify/Square links; `merch.html` is the older door. The packages model immutable order snapshots and provider-independent fulfillment. Generic canonical checkout lives at `supabase/functions/checkout/index.ts`; payment session/account/amount/currency binding exists in `_shared/checkout-binding.ts`. Their presence does not prove a completed clothing purchase workflow. `data/merch.json` and older Rack/Closet documentation contain historical prices and provider statements; none validate this launch's inventory, prices or integration.

Missing in the inspected local tree: a reconciled machine-readable plan for this exact sample budget and unresolved allocation, with a repeatable offline check that prevents promoting assumptions to stock or sale readiness. This increment adds `draft.json`, `scripts/validate-clothing-launch.mjs` and `scripts/test/clothing-launch-plan.test.mjs`. It is planning tooling only, with no runtime imports or checkout wiring. It is deliberately narrow because the current #679 source could not be inspected. No claim of complete non-overlap with that inaccessible branch is possible; compare it before publication. It neither changes nor replaces Claude's merch branch.

Run locally from the repository root:

```sh
node scripts/validate-clothing-launch.mjs
node --test scripts/test/clothing-launch-plan.test.mjs
```

A valid draft is **not** release approval. The validator protects this unverified planning stage; verified stock belongs in canonical commerce through a separately reviewed implementation, never by treating this JSON as an inventory authority.

## Sample and content budget

| Planned group | Sizes supplied | Group cost before shipping |
| --- | --- | ---: |
| Women's joggers | Three sizes, labels unknown | $65.91 |
| Cropped hoodies | Unconfirmed | $77.91 |
| Men's fleece pants | S / M / L | $63.12 |
| Hidden-pocket hoodies | XS / S / M | $98.52 |
| Denim jackets | S / M | $111.84 |
| Jeans | S / M | $61.90 |
| Personal black sun-fade hoodie | M | $37.45 |
| Total | Shipping unknown | $516.65 |

These are group costs, not unit costs or purchase receipts. Purchase and receipt are unverified; available stock is unknown, not zero and not three. Later direction calls for three hoodies: own customization, influencer customization, and one unmodified sale/custom-ready sample. M versus L and the relationship to the earlier budget are unresolved. Do not add these as three additional purchased units. Confirm supplier variants, quantities, size allocation and receipt/QC before creating sellable inventory. Reserve content and personal samples separately from sale stock.

Tapstitch is the intended fulfillment provider. No public custom API is confirmed here. Older architecture mentions a Shopify bridge as a future path; an interface or historical statement is not an implemented, verified integration. Start with a documented manual production handoff after a separately approved launch. Influencer giveaway, ads, and a school design contest/partnership are ideas only: no outreach, spending, recipient, partner or agreement is established.

## Next bounded implementation after reconciling #679

1. Extend canonical offerings and existing merch variant/order contracts, not a second store. Keep draft offerings unavailable to public checkout. Resolve organization ownership server-side and preserve tenant checks.
2. Model standard versus customer-name options with immutable versioned garment/size/color, artwork, brand placement and personalization snapshots. Customer names stay in restricted order data, never public repository fixtures or analytics.
3. Proof flow: draft → submitted → proof ready → changes requested / customer approved → production review. Approval binds the exact order item and proof version, including name spelling and artwork. Any material edit invalidates approval. Production release requires current proof approval for custom items, payment evidence, inventory/production capacity and operator approval; payment alone is not proof approval.
4. Separate planned, received, QC-cleared, reserved and fulfilled quantities. Reserve atomically with expiry/reconciliation. Test simultaneous buyers, abandoned sessions, retries, refunds and Stripe success followed by attachment failure before activating checkout.
5. Map production handoff into the existing `FulfillmentOrder`/`OrderItemSnapshot` contracts. Record manual acceptance, QC, dispatch and tracking evidence; do not mark submitted/shipped from a request alone. Use idempotency and explicit failure/retry states. No provider automation until its contract and account access are verified.
6. Prepare product photos with owner-supplied artwork, actual variant measurements, lead time, personalization review terms and customer support/return policy. Approve final pricing and PRIM3 linkage separately. Then run end-to-end staging scenarios before asking to enable sales.

## Cleanup evidence: source, merge and deployment are separate

Audit performed against local HEAD `147f76b7` on 2026-10-31. Initial working tree was clean. Root `AGENTS.md` read; repository `.agents` is absent and `/workspace/.agents` is empty, so no additional local skills were available. This is a scoped launch audit, not a platform-wide completion certification.

| Area | Locally observed evidence | Remaining uncertainty / next action |
| --- | --- | --- |
| Main | HEAD `147f76b7`; history records #677 merged after #676 | GitHub main lookup denied (`Forbidden`); current remote head not independently verified |
| Music cleanup #666 | Merge `249163db` is in local history; shared checkout binding validates session, account, amount, currency and paid state | Supplied prior audit reports production edge source matched; no fresh deployment or real purchase verification here |
| Schema #676 | Merge `bf559b1e`; `b9a7db8e` records schema-manifest refresh, `cb28f34d` records migration application claim | A committed snapshot dated Oct 30 exists and claims SQL provenance; this session did not independently execute SQL or validate that claim. Prior audit says direct checks blocked by database IO warnings since Oct 29. No production SQL attempted |
| Browser cleanup #675 | Merge `951405fd`, stale-suite update `ae6d3c08` in history | Merge is not proof of current deployed browser acceptance; those suites were not rerun in this task |
| Merch #679 | Supplied context identifies `5389eef8` | GitHub PR read denied and object absent locally. Open/merged/current source status unverified. Prior reported risks below are not freshly confirmed findings |
| Music #678 | Supplied context identifies `cf33f448` | GitHub PR read denied and object absent locally. Purchased asset version drift and failed signing consuming download limits are prior reported concerns, not independently revalidated |
| Worker | Supplied Oct 31 00:34 audit reports live `147f76b7` | No fresh live verification; source match alone does not prove purchase behavior |
| Core / #663 | Supplied audit reports Core `da5a44ad`, rollback #663 not deployed | No fresh Core or rollback verification; do not equate Worker/main with Core deployment |
| Release tags | No tags in this local checkout | Remote tag inventory unavailable; supplied prior audit also reported none |

#679 review queue, once access is restored: check generic Connect webhook organization attribution against stored server authority. Prior concern is conditional on legitimate signed events and attacker-controlled metadata; Express-account exploitability is not established. Do not label it an unrestricted exploit. Separately test stock recovery when Stripe session creation succeeds but order/session attachment RPC fails. Inspect current code and existing fixes before writing patches. #678 review queue: purchased asset version stability and ensuring failed URL signing does not consume download allowance. Keep these issues out of clothing feature changes until verified.

Cleanup completion requires distinct evidence for reviewed source, merged commit, migration state, deployed Worker/Core versions, and real staging purchase/retry/refund/download behavior. The next priorities are payment/tenant integrity and inventory recovery, music fulfillment correctness, deployment reconciliation, then end-to-end product acceptance. Clothing preparation does not close any of these gates.

## Platform productization direction

Free individuals plus paid modular business workspaces is the current direction. Keep identity separate from organization membership, module entitlement and permission. Reuse existing canonical accounts, organizations, offerings, orders and Control navigation. Historical fixed-tier launch checklists are background, not approval to sell those plans. Inventory each module's implemented routes, persisted authority, authorization, billing/enforcement, support path and tested acceptance criteria before packaging it as a paid product. The clothing module is one consumer of those services; it does not establish overall platform readiness.

## Publication boundary and later review procedure

The owner subsequently authorized the separate clothing branch push. The tested four-file change is prepared on `clothing/launch-planning` from inspected local base `147f76b7`; current remote main and PR source verification remain blocked as recorded above. The steps below describe later reconciliation and PR preparation, not actions already completed. PR creation, merging, deployment, migrations and enabling sales still require their own authorization.

1. Before PR preparation, restore authorized read access and inspect current main, #679 and #678 at their actual head SHAs. Compare these new files against #679; reconcile or remove overlap without changing its remote branch. Recheck applicable instructions.
2. Preserve this patch and reconcile the clothing branch against current main after read access is restored. Keep only the four files listed below unless additional work is authorized. Do not blindly apply over conflicting changes.
3. Run the two commands above and `git diff --check`. Review the complete diff and ensure no checkout wiring, secrets, customer data or stock claims were introduced.
4. Stage only `docs/products/clothing-launch/README.md`, `docs/products/clothing-launch/draft.json`, `scripts/validate-clothing-launch.mjs`, and `scripts/test/clothing-launch-plan.test.mjs`. Commit with `Document clothing launch and validate draft sample budget`.
5. The authorized push command is `git push -u origin clothing/launch-planning`. Only after separate PR approval: `gh pr create --draft --base main --head clothing/launch-planning --title "Plan clothing launch with offline budget validation" --body-file /tmp/clothing-launch-pr-body.md`. Prepare that body from the final scope, test results, blocked remote inspection and remaining release gates. No automatic merge or deployment follows.

The local diff artifact is `/workspace/clothing-launch-local.patch`. GitHub read actions were denied, not pending or of uncertain outcome; they made no remote changes. No production verification was attempted. A separate branch push is now authorized; its outcome and remote SHA must be reported from the actual Git result, not inferred from this document.
