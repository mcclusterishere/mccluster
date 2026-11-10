# Creator checkout recovery (COM-3)

Implementation for draft PR #782, cut from `53dcd55243e6d847b4ced44817bb22d11bdcce18`.
This is code and disposable-test evidence, not a production release. The SQL is
pending. Do not enable paid activation until the complete customer-stack release
is authorized and its remaining integration and browser gates pass.

## Authority and persistence

`creator_checkout_reservations` is the one-active-attempt guard for an account.
`creator_checkout_attempts` retains immutable owner, request, price, complete
provider parameters, provider-mode metadata, original expiration, idempotency
key, retry deadline and terminal receipts. A rejected or expired request identity
cannot be reused. `creator_checkout_recovery_audit` is append-only.

A reserve call records a possible provider dispatch before network I/O. Only the
first dispatch, with no prior uncertainty or bound session, may release on a
Stripe HTTP 400 `invalid_request_error` with a valid provider request ID and no
payment/setup/charge evidence. SQL rechecks the classification and concurrency
history. Timeouts, 5xx, malformed replies, missing proof, failed binding and failed
persistence remain blocked. A late negative cannot erase a bound session.

Retry uses the persisted original parameters and key. No current email or changed
plan is substituted. Original retries remain possible after the 35-minute session
expiry, but only inside a conservative 23-hour window before Stripe can prune its
idempotency record. Beyond that, an unknown session needs owner reconciliation.
No timer releases a reservation. A change of provider mode requires owner review.

An idempotent Stripe POST replays the original response, which can be stale. The
handler binds the verified session ID, then retrieves the current session before
using its URL, pending status or expiry. Owner, original request, plan, price,
quantity and mode must match. Only a verified expired session can release its
exact guard. Subscription entitlement remains controlled by the existing signed
webhook/subscription reconciler, never by checkout returns or this queue.

## Buyer and owner recovery

- GET `/v1/creator-billing/status` returns the account's persisted checkout state.
  A stored session ID alone is never called ready: the live session may already
  be complete. Paid subscriptions take precedence in the screen's instructions.
- POST `/resume` with `{}` recovers the server-held original identity, including
  on a new device. Browser storage is only an account/plan-scoped request hint.
- A verified validation rejection explicitly returns `released:true` and
  `retryable:true`; the screen can replace only that attempt's identity.
- An uncertain outcome blocks other plan buttons and offers original recovery.
  An owner-required outcome remains blocked and says who must review it.
- The same commerce page conditionally exposes the owner queue. GET `/recovery`
  and POST `/reconcile` require the existing canonical McCluster house-owner
  membership check. A customer, workspace admin or supplied owner ID confers no
  such access. Every operator request/result is audited with the verified actor.
- Operators can replay an eligible original request, or supply a known Stripe
  session ID. The server verifies that session against the original receipt.
  There is no force-release, replacement identity, refund or charge override.
  The operator is not redirected to another buyer's checkout.

Account/token/generation checks fence delayed responses and operator results.
A response for account A never clears account B's local identity or busy state.

## Pending SQL, upgrade and rollback

Apply `supabase/pending/20261026009200_creator_checkout_reservations.sql`
transactionally only after authorized migration review. Its existing subscription
and auth dependencies must already be present. Deploy the matching Worker/UI
contract together; an old 3-argument reserve cannot create a new attempt.

An existing reservation without its original payload is not reconstructed. It
keeps its guard and requires owner attention. An already known legacy session can
still be retrieved and verified against its persisted session ID, owner and price.
Unknown legacy sessions are never attached by guessed identity.

The paired `.rollback.sql` suspends writes/RPC execution and preserves every
receipt, guard and audit entry. It is deliberately not a destructive downgrade to
the vulnerable implementation. Reapply the forward file to restore reviewed
operation; never truncate the history to get past a stuck payment.

## Local verification

- `node --test scripts/test/creator-checkout-recovery.test.mjs scripts/test/customer-billing.test.mjs`
- `ALLOW_LOCAL_CREATOR_DB_TESTS=1 PG_BIN=<PG16-or-PG17-bin> PG_MODULE=<node-postgres-module> node scripts/test/creator-checkout-native-db.mjs`
- `PGLITE_MODULE=<pglite-module> node --test scripts/test/creator-checkout-reservation-db.mjs`
- `PLAYWRIGHT_MODULE=<playwright-module> node --test scripts/test/customer-commerce-browser.mjs scripts/test/customer-checkout-recovery-browser.mjs`

The native harness accepts no external database URL. It creates a non-root,
loopback-only disposable PostgreSQL cluster, exercises real independent-session
lock races, and stops/removes the cluster. All provider answers are synthetic.
The browser fixture blocks non-fixture traffic and asserts exact 390px viewport
width equality, account switches, reload/new device recovery and owner actions.

At preparation time the native PostgreSQL 16.15/17.11 checks passed. Chromium
could not launch in the executor (socket EPERM, including an approved escalation),
so browser journeys and 390px rendering remain an explicit release blocker.
No real provider call, live SQL, charge or deployment was performed.

## Current-main reconciliation, 2026-11-10

PR #796 merged the tested recovery source and first-offer fixture follow-up into
customer head `8fc3a937`. Customer reconciliation `18f8363b` then preserved that
ancestry while merging main `7e41f0b3` (including #793); draft #782 now targets
main because #772 already landed and its old base branch is gone.

The combined tree passed root JavaScript 2,426 tests (three existing skips),
Worker 1,997 (four existing skips), Core 654 plus syntax checks, Python seven,
and source classification 2,790 checks. Both disposable PostgreSQL 16.15 and
17.11 runs passed all 16 recovery checks. Node was the pinned 24.22.1. The final
local Chromium attempt still failed before page load with socket EPERM, so fresh
hosted browser checks are required; prior #796 results do not certify this tree.

This source reconciliation did not apply SQL or activate customer features.
The checkout contract requires all three receipt/reservation tables and their
matching RPCs. Existing billing authority is not a substitute for that contract.
A functional COM-3-only extraction needs this exact reviewed SQL and matching
callers; the whole customer branch also introduces separately gated site,
commerce, domain, music and publishing dependencies. Keep the production merge
held until the selected schema/caller cutover is reviewed and authorized. Do not
apply every pending file or infer payment/provider activation from source approval.
