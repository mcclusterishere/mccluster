# COM-3 on PR #782: recover a checkout reservation that has no provider session

The brief for the patch series that fixes ledger finding COM-3. The series is not built yet; this file lets any agent
build it from the repository alone. It follows the same pattern as the other series in this folder (read `../README.md`
and one `MANIFEST.json` first).

## The finding

On PR #782's head `53dcd55243e6d847b4ced44817bb22d11bdcce18`, a draft customer-stack integration that is not merged or
live:

- `workers/mccluster/src/creator-billing.js` (lines 72 to 97) reserves the checkout before calling Stripe.
- A definitive provider rejection (Stripe refuses the request and creates no session) is answered with a generic 503,
  and the reservation keeps a null session id.
- `/resume` (lines 29 to 40) cannot reconcile a reservation without that id.
- `supabase/pending/20261026009200_creator_checkout_reservations.sql` (lines 21 to 28) then blocks every other
  request, and after expiry even the original one. The only release function requires a matching non-null session.

The owner's audit reproduced this against the exact handler and pending SQL with a synthetic Stripe 400 that created no
session:

| Step | Answer |
| --- | --- |
| first attempt | 503 |
| a new attempt | 409 |
| resume | 409 |
| the original retry after expiry | still 409 |

The fail-closed answer after an *uncertain* provider result is correct and must stay. Deleting expired reservations
automatically would reintroduce the risk of a second charge.

## What the series must do

- **Persist the attempt state and classify the provider outcome.** A *verified* pre-session rejection, where the
  provider's answer proves no session exists, is one class. Everything else, such as timeouts, connection loss after
  sending and 5xx answers, is *uncertain*.
- **Recover only the verified case.** A verified rejection releases the reservation and allows a new attempt.
- **Reconcile an uncertain attempt with its original identity.**
  - Send the request's idempotency identity to the provider, so that retrying the original request returns the session
    the provider may already have created.
  - Give the owner or operator a queue of uncertain attempts, with audited actions.
- **Keep the existing guarantees.** Owner, request and price binding stay as they are, and so does the
  one-active-subscription guard.
- **Make the UI tell three states apart:**
  - a validation failure the buyer can retry;
  - an uncertain pending payment;
  - an attempt that needs the owner.

Acceptance cases, each a test that fails on `53dcd552` where the behaviour is new:

- definitive rejection;
- connection timeout before and after the provider accepted;
- bind failure;
- reload or a new device;
- the original request retried after expiry;
- a delayed or out-of-order webhook;
- a plan change;
- an account switch;
- a replay.

No real provider call and no real charge: Stripe is a synthetic fixture.

## Rules

- Build on a local branch cut from `53dcd552`, the #782 head (`git fetch origin pull/782/head`). Produce a
  `git format-patch` series with a `MANIFEST.json` and `evidence/` here in `patches/pr-782-com3/`. Never push to #782's
  branch. Applying the series is that PR owner's step.
- Pending SQL stays pending: change the PR's own pending file, or add one in its convention with a rollback. Never
  apply SQL to a real database. Prove the SQL on disposable local PostgreSQL 16 and 17 servers, run as a non-root
  user, on loopback only.
- Mobile first for any UI change: check it at 390 px with `scrollWidth === clientWidth`. Never weaken, skip or delete
  an existing test.
- Then two adversarial reviews (money safety and authority; recovery and state correctness), a repair round, and an
  independent check that applies the series with `git am`. After that, add the series' row to `../README.md`, take
  COM-3 out of its "Not prepared here" table, and update the ledger's COM-3 row, `OPEN-PR-DISPOSITION.md` (#782),
  `CAPABILITY-MATRIX.md` and `WORK-QUEUE.md`.
