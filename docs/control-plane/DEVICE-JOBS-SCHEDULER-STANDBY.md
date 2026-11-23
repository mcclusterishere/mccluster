# Device jobs: scheduler standby (OVH normal, Prime standby)

Status: design plus a tested slice that is wired into the Core compute gateway behind an unset variable. Nothing here is promoted or deployed. The SQL is pending owner approval (see the last section). The call path exists in shipped Core code (`core/src/compute/gateway.mjs` builds the election from `electionConfigFromEnv`, awaits `election.start()` before taking traffic, gates job submission and lease claims with `assertActiveScheduler`, and exposes `election.snapshot()` on health), and it is gated off: with `MCCLUSTER_SCHEDULER_ROLE` unset there is no election, no RPC is called, and every admission check passes.

## Why

The compute fabric has one scheduler: the McCluster Core compute gateway, which claims device work and hands out leases over Supabase (`compute_claim_task` and the lease RPCs). Today "which Core instance is the scheduler" is an assumption of the deployment, not a fact the data plane enforces. We want the OVH Core to be the normal scheduler, the owner's Windows box (Prime) to stand by with the same job state, and exactly one of them to act at any moment, including during a network partition and during a deliberate switch back.

## Roles

- **primary**: the OVH Core. It expects to hold the scheduler lease and renews it continuously.
- **standby**: Prime. It runs the same Core code with `MCCLUSTER_SCHEDULER_ROLE=standby`, keeps asking for the lease, and gets it only when the primary's lease has expired or the primary handed it over.
- **no role** (variable unset): today's single-scheduler behaviour. The election is disabled and every admission check passes.

Roles are labels on the holder; they do not grant priority. A primary never preempts a live standby and a standby never preempts a live primary.

The holder id is the identity. Two processes that share a holder id are one holder to the SQL, so every Core process needs its own (`MCCLUSTER_SCHEDULER_HOLDER_ID`, or `MCCLUSTER_CORE_ID`). A live holder's role never changes under it: a same-id acquire with the other role answers `role_conflict`, writes nothing, and the Core reports a `SCHEDULER_CONFIG` fault (variable `MCCLUSTER_SCHEDULER_HOLDER_ID`) once per episode.

## Invariants

1. **One active holder per org.** The row in `ops_compute_scheduler_leases` names one `(holder_id, term)`. It is live while `expires_at` is in the future and `released_at` is null. Locally, at most one Core instance counts itself active at any moment; a controlled handover may leave a bounded gap with none (below), never an overlap.
2. **Fencing by term.** The term only increases, and it increases on every change of holder. Renew, release and handover require the caller's `(holder_id, term)` to match the live row; anything else answers `fenced` with the live holder, and the caller steps down on that answer. A null holder id or term is rejected outright (three-valued logic never skips the fence). An old primary that comes back after a partition cannot act with its old term.
3. **Takeover only after expiry or handover.** A candidate wins the lease when the row is expired or released (`expired_takeover`) or when the live holder named it in `handover_to` and that grace window is still open (`handover`). Nobody preempts a live holder. An expired row is open to any candidate, whoever a lapsed handover still names; `status` reports `handover_pending` only on a live row.
4. **Failback only by handover.** Returning the lease to the primary is a decision by the active standby, not a race: it records a handover to the primary and yields at once, the primary takes over on its next acquire, and the standby's next renew is fenced.
5. **Fail closed locally.** A Core instance counts itself active only while the server said so AND its own deadline has not passed. The deadline is computed from the dispatch time of the call that earned the answer, minus a margin, so the whole round trip is subtracted. A receipt is adopted only when the server states a positive duration, the reply lands before the deadline it earns, and the clocks moved consistently between dispatch and reply; otherwise the instance drops to candidate (`scheduler_unconfirmed` with `bad_receipt`, `late_reply` or `clock_discontinuity`) and re-acquires with a call dispatched after the fault. Network and store faults never flip an instance to active; they only let the deadline run out. A clock discontinuity (wall clock jump or suspend), including one that happens while a renew is in flight, makes the instance inactive until the server confirms again.
6. **A hung call never wedges the loop.** Every production store call carries a network timeout (`AbortSignal.timeout`, 10 s), and the loop abandons a call older than `callTimeoutMs` (default `min(renew interval, TTL/2)`), ignoring its late reply; `stop()` waits at most that long before releasing.

## What is replicated

Nothing new. Supabase already holds the shared job state (`ops_compute_tasks`, `ops_compute_leases`, `ops_compute_nodes`, and the pending attestation table). The scheduler lease row is the only addition, and it is a fact about who may schedule, not a copy of any job. The standby holds no private state: when it takes over it reads the same queue the primary was reading, and the device-lease fences that already exist (`compute_claim_task`, the lease token and attempt checks) keep a job from being handed out twice.

## The partition story

The primary loses Supabase (or Supabase loses the primary):

1. Its renew calls fail. Each failure is an event, not a takeover. Within one TTL minus the margin, its local deadline passes and `isActive()` is false. From then on it refuses admin submissions and node lease claims with `503 SCHEDULER_STANDBY` (retryable, naming the last known live holder). It also stops handing out device leases, so no node is told to work by an instance that may already have been replaced.
2. The server row expires at `expires_at` (at most one TTL after the last successful renew). The standby, which has been asking on every tick, now gets `expired_takeover` with term + 1 and emits `scheduler_active`.
3. When the primary reconnects, its renew is fenced (the term moved). It emits `scheduler_fenced`, drops to candidate, and from then on asks with acquire and is told `held`.

Nodes reach the gateway at a fixed address. Taking over the scheduler lease moves the *authority* to the standby; it does not move node *traffic*. Pointing the nodes at the standby still needs the tunnel or DNS switch, which stays a manual owner step for now. Until that switch is made, a takeover means the fabric is paused (nodes get `SCHEDULER_STANDBY` from the old address) rather than split.

## Controlled failback

1. The owner confirms the primary is healthy and reaches Supabase.
2. On the active standby, request a handover to the primary's holder id (the election's `requestHandover`, or `POST /v1/compute/scheduler/handover` as admin; the `compute_scheduler_handover` RPC as service role records the same fact). The grace window is 10 to 900 seconds, 120 by default. The standby **yields the moment the request is accepted**: `isActive()` is false, it refuses submissions and lease claims with `SCHEDULER_STANDBY` naming the primary, its renews keep the row alive for the primary and show `handover_to`, and it emits `scheduler_handover_pending` (`yielded: true`). The row stays live and held by the standby until the primary takes over.
3. The primary's next acquire returns `handover` with term + 1. The standby's next renew is fenced and it steps down. Between the yield and that acquire nobody admits work: a gap bounded by the primary's renew interval, never two schedulers.
4. If the primary does not appear inside the grace window, the handover lapses: the standby's next renew shows no `handover_to`, it emits `scheduler_handover_lapsed` and resumes admitting work. Nothing moved. If the standby's own lease lapses meanwhile (it stopped renewing), the row is expired and open to any candidate by `expired_takeover`, not reserved for the named primary.
5. Move node traffic back (the same manual step as above).

Stopping either instance cleanly releases its lease (`released_at`), so the other side takes over on its next tick without waiting for expiry.

## Environment variables

- `MCCLUSTER_SCHEDULER_ROLE`: `primary` or `standby`. Unset disables the election (today's behaviour).
- `MCCLUSTER_SCHEDULER_HOLDER_ID`: the holder id, `^[a-z0-9][a-z0-9._-]{0,78}$`. Defaults to `MCCLUSTER_CORE_ID`, then `core-<role>` (`core-primary` or `core-standby`), so an unconfigured pair does not collide; set it explicitly on every deployment all the same. A `MCCLUSTER_CORE_ID` that does not match the pattern is a configuration error, not a silent fallback.
- `MCCLUSTER_SCHEDULER_TTL_SECONDS`: lease TTL, 10..300, default 30.
- `MCCLUSTER_SCHEDULER_RENEW_MS`: renew and acquire interval, default one third of the TTL, never below 1000.
- `MCCLUSTER_ORG_ID`: required when a role is set; the lease is per org. An id that names no row of `public.orgs` is answered `unknown org` (SQLSTATE `P0002`) by the acquire RPC; the Core halts its election loop, keeps the fault on the health snapshot (`config_error`, variable `MCCLUSTER_ORG_ID`) and stays a candidate instead of retrying forever.

## Staging exercise

Neither exercise needs credentials or reaches canonical Supabase, the OVH Core or any device. The SQL check needs a PGlite installed once, outside this repository (no package.json here pins it): `@electric-sql/pglite` 0.5.x, verified on 0.5.10 and 0.5.17; the election tests need Node only.

- SQL semantics on a disposable PGlite database: `PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js node scripts/compute-scheduler-sql-check.mjs`. The fixture installs Supabase's default privileges (grant all on new tables and functions to `anon`, `authenticated`, `service_role`) so the privilege assertions prove the file against the database it targets, applies the pending file, checks `service_role` holds select only on the lease table, runs `supabase/tests/compute_scheduler_lease.behaviour.sql` (fresh acquire with the org advisory lock, renew, held, fenced renew, forced expiry and takeover, stale release, controlled handover, handover to self, handover by a non-holder, handover expiry, release then takeover, status, bounded history, privileges, the stable history helper; then same-id role conflict, null holder/term rejection, unknown org, a lapsed handover on a dead row; then `status` taking no row lock), applies the rollback, checks nothing is left, re-applies and runs the assertions again. With `NATIVE_TEST_DATABASE_URL` (a disposable local PostgreSQL on port 54322) and `POSTGRES_MODULE_PATH` it also proves, on two real connections, that a `status` read left open in a transaction does not block the holder's renew.
- Election runtime with fake clocks: `cd core && node --test test/scheduler-election.test.mjs`. It drives a primary and a standby over the in-memory store (`createMemorySchedulerStore`, the same rules as the SQL) through: primary active with term 1; standby held while the primary renews; partition where the primary fails closed before the server lease expires; standby takeover with term 2; the reconnected primary fenced; controlled failback by handover to term 3; bounded handover (self, non-holder, lapsed grace); clock discontinuity; store faults; the env parser; a suspend while a renew is in flight (never confirmed, only the standby active after takeover); late and time-less receipts rejected; handover yield with no overlap whichever side ticks first, and resumption after a lapse; one holder id with two roles; a hung store call abandoned and `stop()` not wedged; an unknown org halting the loop; memory-store parity (null grace, null identity, dead-row handover, role conflict).
- Two real Core processes: `PGLITE_MODULE_PATH=... node scripts/staging/device-jobs/scheduler-failover.mjs --out <dir>` runs gateway A (primary) and gateway B (standby) over one disposable database through one active holder, a frozen primary and the standby's takeover, the fenced return, and the controlled failback; it writes `PROOF.md` and `proof.json`.

## Not done

- No production promotion. The SQL is pending; nothing was applied to canonical Supabase and nothing was deployed. Once the Core is promoted to OVH, the election code is shipped and calls the pending-only `compute_scheduler_*` RPCs whenever `MCCLUSTER_SCHEDULER_ROLE` is set; leave the variable unset until the SQL is applied.
- No automated DNS or tunnel move. Node traffic follows the owner's manual switch.
- No Prime-side packaging; the standby is the same Core code with a role variable.
- Job-state RPCs (`compute_claim_task`, the lease RPCs) carry no scheduler term. The local yield and deadline rules above keep two instances from admitting work at once; fencing those RPCs by `(holder, term)` would make that a server-side guarantee and is a later step.

## Pending approval

`supabase/pending/compute_scheduler_lease_v1.sql` (rollback: `supabase/pending/compute_scheduler_lease_v1.rollback.sql`) creates `public.ops_compute_scheduler_leases` and the five service-role RPCs `compute_scheduler_acquire`, `compute_scheduler_renew`, `compute_scheduler_release`, `compute_scheduler_handover`, `compute_scheduler_status` (plus the internal history helper that nobody may execute). It needs owner review, an isolated SQL proof (the check above) and explicit migration approval before it is applied; it has no ledger entry. Shipped Core code contains the call path, gated off by an unset `MCCLUSTER_SCHEDULER_ROLE`; nothing calls the RPCs until the owner sets a role, and the owner should not set one before the SQL is applied.
