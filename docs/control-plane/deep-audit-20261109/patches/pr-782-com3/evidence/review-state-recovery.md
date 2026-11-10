# COM-3 independent recovery and state-correctness review

Date: 2026-11-10 UTC.
Base: `53dcd55243e6d847b4ced44817bb22d11bdcce18`.
Scope: local COM-3 working changes in the buyer UI, checkout handler/recovery helper, pending reservation SQL and rollback, synthetic provider fixture, and test evidence. Root AGENTS.md and the COM-3 BRIEF at `9d29616021337806860bab891163844dca2f1d26` were read. The existing auth implementation, owner predicate, entitlement and webhook persistence were examined for context. No source code was edited by this reviewer.

## Decision

No remaining implementation blocker found in the reviewed recovery/state snapshot after the repair round. This is a local code/fixture review, not browser acceptance or release approval. Browser execution and actual 390px layout acceptance remain unverified because Chromium launch was reported blocked by socket EPERM, including the approved escalation. The reviewer did not retry browser launch or seek another sandbox route.

## Findings raised and repaired

1. **P2: a complete payment became “ready” again on reload.** Reproduced independently: timeout after Stripe acceptance, then current session `complete`; `/resume` correctly returned 409 `pending`, but `/status` returned `ready` merely because an ID was bound. After subscription activation, the screen prioritized that checkout receipt and told the paid user to resume while disabling the Resume button. The repair makes the stored-ID projection conservatively `pending` until current provider truth is retrieved; paid state and existing-subscription guidance now take precedence in the UI. A new completed-session/status-reload handler test passes, and a paid-receipt-priority browser fixture was added.

2. **P3: competing device displayed its rejected identity instead of the active attempt.** Independently reproduced with an uncertain starter checkout and a second-device plus request: the conflict originally echoed the second request ID and the UI retained its proposed plan. The repaired conflict response reads the canonical active checkout projection, and the UI merges that projection before rendering. A new handler test passes and a corresponding browser fixture was added. This never bypassed the server guard, but the wrong reference would have misdirected recovery/support.

3. **Browser fixture corrections.** Static review found a stale “workspace owner” expectation against the actual “McCluster owner” copy. After the state repair, the guarded-subscription fixture also needed `pending` rather than `paid` when `paid:false`; the explicit `paid:true` check remains. Both corrections were inspected. The final second-device fixture also now waits for its canonical reference after the conflict response, rather than checking during the optimistic `pending` state; that repair was inspected. Browser execution is still required to validate these fixtures.

The money reviewer’s fresh-GET-after-idempotent-POST repair and durable bound-session owner escalation were inspected. The former prevents the cached original POST response from being mistaken for current provider status; the latter preserves the known session while making an actual identity mismatch visible to the owner queue.

## Checks executed by this reviewer

- `node --test scripts/test/creator-checkout-recovery.test.mjs scripts/test/customer-billing.test.mjs scripts/test/creator-checkout-contract.test.mjs scripts/test/creator-billing-testmode-contract.test.mjs scripts/test/creator-billing-webhook-contract.test.mjs`: **28 passed, zero failed or skipped** after the implementation repair round.
- Independent synthetic missing-schema probes: missing reserve RPC returns 503 with zero Stripe calls; missing attempt-table reads cause status and resume to return 503 without any additional provider call.
- Independent synthetic reproductions of the complete/reload/paid conflict and the competing-device identity issue, followed by inspection and execution of the new passing handler regression tests.
- `git diff --check`: clean.
- Read the existing native PostgreSQL 16.15 and 17.11 evidence in the separate SQL evidence directory: each reports all 16 checks passed, including concurrency, upgrade, append-only receipts/audit, helper-to-native-RPC integration, repeat application and emergency rollback. Those server runs were not performed by this reviewer; they were independently run by the money/authority reviewer.

## Recovery and state coverage assessed

- Account/token/generation fences reject delayed account-A responses after account B is selected. In-flight ownership and local request hints are account scoped; a stale release cannot clear another account’s storage or busy state.
- Reload/new-device recovery derives the active request from authenticated server state, not a browser-supplied owner or request ID. Plan changes cannot replace an existing original payload.
- Only explicit verified-rejection evidence can release and rotate the matching identity. Unproven failures, timeout, persistence/binding failure, competing dispatches and later rejection remain blocked. Original payload/key remain immutable, with permanent retired receipts and a conservative retry cutoff.
- Bound session verification includes owner, original request, plan/period, price/quantity, mode and provider identity. Fresh provider GET determines open/complete/expired state. Time alone never releases.
- Delayed/out-of-order webhook fixture execution retains the subscription guard; this helper does not grant entitlement. The existing webhook is unchanged by COM-3.
- Owner recovery uses the canonical house-owner check, server-bound target identity and append-only actor audit. Supplied session IDs are verified, not trusted. There is no force-release action or operator redirect into a buyer’s checkout.
- Missing pending schema fails closed before creating a provider session. Upgrade retains legacy guards; known legacy IDs can be GET-reconciled without inventing a payload. Rollback suspends writes while retaining receipts and guards, rather than restoring the vulnerable overload.
- Mobile source uses min-width expansion, minmax(0,1fr), wrapping, and at least 16px form controls. These are source observations only; actual 390px scrollWidth/clientWidth equality is not certified.

## Remaining acceptance limits

Actual browser flows, 390px rendering, the final aggregate rerun, independent `git am` of the exported series, and the PR-owner integration/release process remain separate gates. No push, provider call, real charge, live SQL, deploy or entitlement activation was performed. This report does not authorize any of those actions.

## Implementation snapshot SHA-256

- `e08428e76c20ebe74e5876be45a5f792bff10299f47ceda90887d5b494be6a98` customer-commerce.html
- `d5ecb723add92c71faf5c4bce3ad326480ce513b295463ac4fb8eae5963347a0` js/customer-commerce.js
- `98499b4af0a439e41d0ee83704bb5e443efd77acedf45be43150bd6166b7d71d` workers/mccluster/src/creator-billing.js
- `d3857e43d7fa2c10c16ebf7118dc169f0687d1fc6f2a4c52265fd5b9ab0d4385` workers/mccluster/src/creator-checkout-recovery.js
- `15aad9fb8d6688ee0a54592d43da898533ed7adb976e865c2ce951f893296b7e` supabase/pending/20261026009200_creator_checkout_reservations.sql
- `48a8d26836015f64354b985bca8167cb23ae2d33798b3e1ea6e6f6ef0442a6db` supabase/pending/20261026009200_creator_checkout_reservations.rollback.sql
- `efa8da4c70aa62312062a3424fcdf29c0ca5218af7e6eebb37e1c98d04115c15` scripts/test/creator-checkout-recovery.test.mjs
- `9a5b07347a15eede26f5aef5bd30d53ed3125798a1b808be88349e66d4b4c4d8` scripts/test/creator-checkout-native-db.mjs
- `dcf5340fbdacd256525f5dd63709753ebdc2e681a42fb363ca71aaba6dd6b9bd` scripts/test/support/creator-checkout-fixture.mjs
- `76d74e9a90957586c43cf0f1e5142eec559aa0f872ca778417cb072526522c72` scripts/test/customer-checkout-recovery-browser.mjs
