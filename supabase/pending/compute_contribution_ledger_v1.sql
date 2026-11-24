-- PENDING ONLY. Owner review, isolated SQL proof and explicit migration approval
-- are required before applying this to canonical Supabase. No ledger entry here.
--
-- Compute contribution ledger (docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md).
--
-- Internal, nontransferable, noncash work units for opted-in compute devices.
-- No cash, no payouts, no transfers between accounts. The customer-spend credit
-- stack (api_credit_ledger, compute_credit_reservations) is not touched.
--
-- Design:
--   * Append-only ledger: public.ops_compute_contribution_ledger. A trigger
--     refuses UPDATE and DELETE for every role, the owner included. Balances
--     are sums over the ledger and the open reservations, never stored columns.
--   * One writer at a time: settle and release are fenced by the scheduler
--     lease (ops_compute_scheduler_leases, PR #823) through (holder_id, term),
--     and by the device lease through (task_id, sha256(lease_token), attempt).
--     With no scheduler row for the org (single-scheduler deployment, the
--     election never used) a null term is accepted and recorded as null. The
--     moment ANY row exists for the org (live, expired or released) a null
--     term is refused, and only the live row's (holder_id, term) passes: in
--     the gap between one holder's expiry or release and the next acquire
--     nobody writes, and the next holder's sweep settles what is left.
--   * Idempotent on operation_key: every writing RPC claims its key in
--     public.ops_compute_ledger_operations with INSERT ... ON CONFLICT DO
--     NOTHING. A replay with the same payload returns the stored outcome with
--     replayed=true; the same key with a different payload is refused CONFLICT.
--     Refusals that write nothing (STALE_TERM, LEASE_REJECTED, TASK_NOT_QUEUED,
--     MODEL_CLASS_UNKNOWN, UNIT_VERSION_STALE at reserve, OVER_BUDGET, the
--     quotas, ACCOUNT_FROZEN, DUPLICATE_SETTLE, NO_RESERVATION) do not consume
--     the key, so a fresh holder can settle the same attempt under its own key.
--   * Integer arithmetic only: micro-units (1 unit = 1,000,000 micro-units) in
--     bigint; redemption floor((carry + units) / ratio) with the remainder
--     carried per account; display points cross a 100,000-unit boundary once.
--   * Every writing RPC holds the task row FOR UPDATE before it reads or
--     writes the ledger, so two settles of one task serialise and the second
--     sees the first's operation row. compute_ledger_settle takes its row
--     locks in the device RPCs' order (compute_claim_task and
--     compute_transition_lease_v2): node, then lease, then task. reserve and
--     release lock the task only (then the account or the reservation).
--   * Who pays: the submitter is debited only for an attempt the ledger
--     accepts, or one it declines to mint for a reason that is not the
--     worker's fault (SELF_ROUTED, QUOTA_DAILY_MINT, NODE_UNBOUND), and never
--     more than the reservation's max_units_micro. Every other verdict
--     (node unavailable, model or digest not approved, class or unit version
--     not the pinned one, counters invalid or outside the class window or the
--     task's own caps, units above the reservation, output hash mismatch,
--     late, known-answer mismatch) records the settle with spend 0 and
--     releases the whole reservation.
--   * The class and its unit_version are pinned on the reservation at reserve
--     time and enforced at settle (MODEL_CLASS_MISMATCH, UNIT_VERSION_STALE).
--   * The acceptance checks never quarantine a node: a known-answer mismatch
--     records an ops_compute_fraud_reviews row and leaves the node to a human.
--   * All tables: RLS on, no anon or authenticated policy or privilege. The
--     ledger, reservations, carry, points and operations tables grant
--     service_role select only (writes go through the definer RPCs);
--     configuration tables (accounts, node bindings, classes, quotas, relations,
--     grants, known answers) grant service_role DML so the owner's Core tools
--     can administer them; fraud reviews grant select and update (status).
--   * Additions beyond the contract's named tables, each stated here:
--     ops_compute_ledger_operations (the idempotency arbiter and stored
--     outcomes) and ops_compute_node_accounts (which account a node works for,
--     needed by the self-routing and worker-mint rules). compute_ledger_reserve
--     takes an optional fifth argument p_deadline_seconds (default 3600): the
--     reservation's expires_at is the task's deadline for the late-completion
--     rule, since ops_compute_tasks has no deadline column and this file alters
--     no applied table.
--     compute_ledger_reserve also takes optional p_model_class and
--     p_unit_version (the class the Core priced the task with); without them
--     the class is resolved from the task's implementation.
--   * The output hash is computed in ONE place: hashJson() in
--     core/src/compute/jobs.mjs, over the stored ops_compute_tasks.output, and
--     passed in as p_output_sha256. This file does not re-derive it: jsonb
--     text renders numbers differently from JSON.stringify (1e21, 1e-7), so a
--     second implementation here could only disagree. The settle checks what
--     the database can know: the lease's result is the task's output, the
--     passed hash equals the hash the gateway recorded with the node's
--     completion attestation (ops_compute_attestations.result_sha256, when
--     that pending table exists and has the row), and it equals the expected
--     hash of a known-answer task.
-- Rollback: compute_contribution_ledger_v1.rollback.sql. Proof:
-- PGLITE_MODULE_PATH=... node scripts/compute-ledger-sql-check.mjs.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.ops_compute_accounts (
  account_id text primary key check (account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('owner','community')),
  status text not null default 'active' check (status in ('active','frozen')),
  display_points_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

-- Which account a node works for (mint target; self-routing rule). One account per node.
create table if not exists public.ops_compute_node_accounts (
  node_id text primary key references public.ops_compute_nodes(id) on delete cascade,
  account_id text not null references public.ops_compute_accounts(account_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.ops_compute_model_classes (
  model_class text primary key check (model_class ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  unit_version integer not null check (unit_version >= 1),
  -- [{"model": "qwen3:8b", "digest": "sha256:..."}, ...]
  approved_models jsonb not null default '[]'::jsonb check (jsonb_typeof(approved_models) = 'array'),
  -- implementation ids this class prices (Core resolves a task's class by its implementation)
  implementations jsonb not null default '[]'::jsonb check (jsonb_typeof(implementations) = 'array'),
  out_unit_micro bigint not null check (out_unit_micro >= 0),
  in_unit_micro bigint not null check (in_unit_micro >= 0),
  redemption_ratio integer not null default 3 check (redemption_ratio >= 1),
  min_tokens_per_s integer not null check (min_tokens_per_s >= 0),
  max_tokens_per_s integer not null check (max_tokens_per_s >= min_tokens_per_s),
  max_eval_count integer not null check (max_eval_count >= 1),
  max_prompt_eval_count integer not null check (max_prompt_eval_count >= 1),
  created_at timestamptz not null default now()
);

create table if not exists public.ops_compute_account_quotas (
  account_id text primary key references public.ops_compute_accounts(account_id) on delete cascade,
  max_open_reservations integer check (max_open_reservations is null or max_open_reservations >= 0),
  max_queued_tasks integer check (max_queued_tasks is null or max_queued_tasks >= 0),
  daily_mint_cap_micro bigint check (daily_mint_cap_micro is null or daily_mint_cap_micro >= 0)
);

create table if not exists public.ops_compute_account_relations (
  account_id text not null references public.ops_compute_accounts(account_id) on delete cascade,
  related_account_id text not null references public.ops_compute_accounts(account_id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (account_id, related_account_id),
  check (account_id <> related_account_id)
);

create table if not exists public.ops_compute_private_grants (
  account_id text not null references public.ops_compute_accounts(account_id) on delete cascade,
  node_id text not null references public.ops_compute_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, node_id)
);

create table if not exists public.ops_compute_known_answer_tasks (
  task_id uuid primary key references public.ops_compute_tasks(id) on delete cascade,
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.ops_compute_fraud_reviews (
  review_id bigserial primary key,
  task_id uuid references public.ops_compute_tasks(id) on delete set null,
  lease_id uuid references public.ops_compute_leases(id) on delete set null,
  node_id text references public.ops_compute_nodes(id) on delete set null,
  account_id text references public.ops_compute_accounts(account_id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','cleared','confirmed')),
  created_at timestamptz not null default now()
);
create index if not exists ops_compute_fraud_reviews_open_idx
  on public.ops_compute_fraud_reviews(status, created_at desc);

create table if not exists public.ops_compute_spend_reservations (
  reservation_id bigserial primary key,
  operation_key text not null unique,
  account_id text not null references public.ops_compute_accounts(account_id) on delete restrict,
  task_id uuid not null unique references public.ops_compute_tasks(id) on delete restrict,
  max_units_micro bigint not null check (max_units_micro >= 0),
  -- The class and unit_version the reservation was priced at; the settle enforces both.
  model_class text not null,
  unit_version integer not null check (unit_version >= 1),
  status text not null default 'open' check (status in ('open','settled','released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists ops_compute_spend_reservations_account_open_idx
  on public.ops_compute_spend_reservations(account_id) where status = 'open';

create table if not exists public.ops_compute_contribution_ledger (
  entry_id bigserial primary key,
  operation_key text not null unique,
  kind text not null check (kind in ('reserve','settle','mint','release','correction')),
  account_id text not null references public.ops_compute_accounts(account_id) on delete restrict,
  task_id uuid references public.ops_compute_tasks(id) on delete set null,
  lease_id uuid references public.ops_compute_leases(id) on delete set null,
  attempt integer check (attempt is null or attempt > 0),
  node_id text references public.ops_compute_nodes(id) on delete set null,
  scheduler_holder_id text,
  scheduler_term bigint,
  units_micro bigint not null default 0,
  spend_micro bigint not null default 0,
  metering jsonb,
  model_class text,
  unit_version integer,
  correction_of bigint references public.ops_compute_contribution_ledger(entry_id),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists ops_compute_contribution_ledger_account_idx
  on public.ops_compute_contribution_ledger(account_id, kind, created_at desc);
create index if not exists ops_compute_contribution_ledger_task_idx
  on public.ops_compute_contribution_ledger(task_id, entry_id);
-- At most one settle per (task, attempt).
create unique index if not exists ops_compute_contribution_ledger_one_settle_uidx
  on public.ops_compute_contribution_ledger(task_id, attempt) where kind = 'settle';

create table if not exists public.ops_compute_account_carry (
  account_id text primary key references public.ops_compute_accounts(account_id) on delete cascade,
  carry_micro bigint not null default 0 check (carry_micro >= 0)
);

create table if not exists public.ops_compute_display_points (
  account_id text primary key references public.ops_compute_accounts(account_id) on delete cascade,
  points bigint not null default 0 check (points >= 0),
  -- accepted micro-units carried below the next 100,000-unit boundary
  accepted_units_remainder bigint not null default 0 check (accepted_units_remainder >= 0)
);

-- The idempotency arbiter: one row per operation_key, the payload hash it was
-- made with and the outcome it returned, replayed verbatim.
create table if not exists public.ops_compute_ledger_operations (
  operation_key text primary key check (operation_key ~ '^[!-~]{1,200}$'),
  kind text not null check (kind in ('reserve','settle','release','correction')),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  outcome jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Append-only trigger
-- ---------------------------------------------------------------------------

create or replace function public.compute_ledger_append_only()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  raise exception 'ops_compute_contribution_ledger is append-only (% refused)', tg_op
    using errcode = '55000', hint = 'append a correction entry with compute_ledger_correct';
end;
$$;
revoke all on function public.compute_ledger_append_only() from public, anon, authenticated, service_role;

drop trigger if exists ops_compute_contribution_ledger_append_only on public.ops_compute_contribution_ledger;
create trigger ops_compute_contribution_ledger_append_only
  before update or delete on public.ops_compute_contribution_ledger
  for each row execute function public.compute_ledger_append_only();

-- ---------------------------------------------------------------------------
-- Privileges: RLS on everywhere, nothing for the API roles, service_role as stated
-- ---------------------------------------------------------------------------

alter table public.ops_compute_accounts enable row level security;
alter table public.ops_compute_node_accounts enable row level security;
alter table public.ops_compute_model_classes enable row level security;
alter table public.ops_compute_account_quotas enable row level security;
alter table public.ops_compute_account_relations enable row level security;
alter table public.ops_compute_private_grants enable row level security;
alter table public.ops_compute_known_answer_tasks enable row level security;
alter table public.ops_compute_fraud_reviews enable row level security;
alter table public.ops_compute_spend_reservations enable row level security;
alter table public.ops_compute_contribution_ledger enable row level security;
alter table public.ops_compute_account_carry enable row level security;
alter table public.ops_compute_display_points enable row level security;
alter table public.ops_compute_ledger_operations enable row level security;

revoke all on public.ops_compute_accounts from public, anon, authenticated, service_role;
revoke all on public.ops_compute_node_accounts from public, anon, authenticated, service_role;
revoke all on public.ops_compute_model_classes from public, anon, authenticated, service_role;
revoke all on public.ops_compute_account_quotas from public, anon, authenticated, service_role;
revoke all on public.ops_compute_account_relations from public, anon, authenticated, service_role;
revoke all on public.ops_compute_private_grants from public, anon, authenticated, service_role;
revoke all on public.ops_compute_known_answer_tasks from public, anon, authenticated, service_role;
revoke all on public.ops_compute_fraud_reviews from public, anon, authenticated, service_role;
revoke all on public.ops_compute_spend_reservations from public, anon, authenticated, service_role;
revoke all on public.ops_compute_contribution_ledger from public, anon, authenticated, service_role;
revoke all on public.ops_compute_account_carry from public, anon, authenticated, service_role;
revoke all on public.ops_compute_display_points from public, anon, authenticated, service_role;
revoke all on public.ops_compute_ledger_operations from public, anon, authenticated, service_role;
revoke all on sequence public.ops_compute_fraud_reviews_review_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.ops_compute_spend_reservations_reservation_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.ops_compute_contribution_ledger_entry_id_seq from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.ops_compute_accounts to service_role;
grant select, insert, update, delete on public.ops_compute_node_accounts to service_role;
grant select, insert, update, delete on public.ops_compute_model_classes to service_role;
grant select, insert, update, delete on public.ops_compute_account_quotas to service_role;
grant select, insert, update, delete on public.ops_compute_account_relations to service_role;
grant select, insert, update, delete on public.ops_compute_private_grants to service_role;
grant select, insert, update, delete on public.ops_compute_known_answer_tasks to service_role;
grant select, update on public.ops_compute_fraud_reviews to service_role;
grant select on public.ops_compute_spend_reservations to service_role;
grant select on public.ops_compute_contribution_ledger to service_role;
grant select on public.ops_compute_account_carry to service_role;
grant select on public.ops_compute_display_points to service_role;
grant select on public.ops_compute_ledger_operations to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (no role may execute them directly)
-- ---------------------------------------------------------------------------

-- An earlier draft of this file re-derived the output hash in SQL; the hash now
-- has one implementation (see header) and the helper is gone.
drop function if exists public.compute_ledger_canonical_json(jsonb);

create or replace function public.compute_ledger_sha256(p_text text)
returns text
language sql immutable
set search_path = public, extensions, pg_temp
as $$ select encode(digest(convert_to(coalesce(p_text, ''), 'UTF8'), 'sha256'), 'hex'); $$;
revoke all on function public.compute_ledger_sha256(text) from public, anon, authenticated, service_role;

-- Scheduler term fence. A null term is accepted only while NO scheduler row
-- exists for the org (single-scheduler deployment, the election never used).
-- Once a row exists, expired or released included, only the live row's
-- (holder_id, term) passes: an instance that is not the live holder never
-- writes, whatever the row's state. To return an org to the single-scheduler
-- mode the owner deletes its ops_compute_scheduler_leases row.
create or replace function public.compute_ledger_term_ok(p_org_id uuid, p_holder_id text, p_term bigint)
returns boolean
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_row record;
  v_now timestamptz := clock_timestamp();
begin
  if to_regclass('public.ops_compute_scheduler_leases') is null then
    return p_term is null;
  end if;
  select holder_id, term, released_at, expires_at into v_row
    from public.ops_compute_scheduler_leases where org_id = p_org_id;
  if not found then return p_term is null; end if;
  if v_row.released_at is not null or v_row.expires_at <= v_now then return false; end if;
  return p_holder_id is not null and p_term is not null and v_row.holder_id = p_holder_id and v_row.term = p_term;
end;
$$;
revoke all on function public.compute_ledger_term_ok(uuid,text,bigint) from public, anon, authenticated, service_role;

create or replace function public.compute_ledger_operation_lookup(p_key text, p_kind text, p_payload_hash text)
returns jsonb
language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare v_op public.ops_compute_ledger_operations%rowtype;
begin
  select * into v_op from public.ops_compute_ledger_operations where operation_key = p_key;
  if not found then return null; end if;
  if v_op.kind <> p_kind or v_op.payload_hash <> p_payload_hash then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'replayed', false,
      'reason', 'operation_key was already used with a different payload', 'operation_key', p_key);
  end if;
  return v_op.outcome || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function public.compute_ledger_operation_lookup(text,text,text) from public, anon, authenticated, service_role;

create or replace function public.compute_ledger_balances_internal(p_account_id text)
returns jsonb
language plpgsql stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_pending bigint; v_earned bigint; v_spent bigint; v_points bigint; v_carry bigint;
begin
  select coalesce(sum(max_units_micro), 0) into v_pending
    from public.ops_compute_spend_reservations where account_id = p_account_id and status = 'open';
  select coalesce(sum(units_micro), 0) into v_earned
    from public.ops_compute_contribution_ledger where account_id = p_account_id and kind = 'mint';
  select coalesce(sum(spend_micro), 0) into v_spent
    from public.ops_compute_contribution_ledger where account_id = p_account_id and kind in ('settle','correction');
  select coalesce(points, 0) into v_points from public.ops_compute_display_points where account_id = p_account_id;
  select coalesce(carry_micro, 0) into v_carry from public.ops_compute_account_carry where account_id = p_account_id;
  return jsonb_build_object('account_id', p_account_id, 'pending', v_pending, 'earned', v_earned, 'spent', v_spent,
    'available', v_earned - v_spent - v_pending, 'display_points', coalesce(v_points, 0), 'carry_micro', coalesce(v_carry, 0));
end;
$$;
revoke all on function public.compute_ledger_balances_internal(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER, service_role only)
-- ---------------------------------------------------------------------------

-- a) reserve: open a spend reservation for a QUEUED task at its max units, and
-- pin the model class and unit_version the settle will be held to. The class
-- is p_model_class when given (p_unit_version, when given, must be its current
-- version: UNIT_VERSION_STALE otherwise), else the class whose implementations
-- name the task's implementation, else the only class.
drop function if exists public.compute_ledger_reserve(text,text,uuid,bigint,integer);
create or replace function public.compute_ledger_reserve(
  p_op_key text,
  p_account_id text,
  p_task_id uuid,
  p_max_units_micro bigint,
  p_deadline_seconds integer default 3600,
  p_model_class text default null,
  p_unit_version integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_task public.ops_compute_tasks%rowtype;
  v_account public.ops_compute_accounts%rowtype;
  v_quota public.ops_compute_account_quotas%rowtype;
  v_hash text;
  v_existing jsonb;
  v_balances jsonb;
  v_open integer;
  v_queued integer;
  v_res public.ops_compute_spend_reservations%rowtype;
  v_class public.ops_compute_model_classes%rowtype;
  v_entry bigint;
  v_outcome jsonb;
  v_deadline integer := greatest(60, least(coalesce(p_deadline_seconds, 3600), 604800));
begin
  if p_op_key is null or p_op_key !~ '^[!-~]{1,200}$' then raise exception 'invalid operation key'; end if;
  if p_task_id is null then raise exception 'p_task_id is required'; end if;
  if p_account_id is null then raise exception 'p_account_id is required'; end if;
  if p_max_units_micro is null or p_max_units_micro < 0 then raise exception 'p_max_units_micro must be a non-negative integer'; end if;

  select * into v_task from public.ops_compute_tasks where id = p_task_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_FOUND', 'replayed', false); end if;

  v_hash := public.compute_ledger_sha256(jsonb_build_object('account_id', p_account_id, 'task_id', p_task_id, 'max_units_micro', p_max_units_micro,
    'model_class', p_model_class, 'unit_version', p_unit_version)::text);
  v_existing := public.compute_ledger_operation_lookup(p_op_key, 'reserve', v_hash);
  if v_existing is not null then return v_existing; end if;

  -- Only a queued task can be reserved: a task a node already holds, or one
  -- that is done, failed or canceled, would get a reservation nothing closes.
  if v_task.status <> 'queued' then
    return jsonb_build_object('ok', false, 'code', 'TASK_NOT_QUEUED', 'replayed', false, 'task_status', v_task.status,
      'reason', 'a reservation is opened only while the task is queued');
  end if;

  if p_model_class is not null then
    select * into v_class from public.ops_compute_model_classes where model_class = p_model_class;
  else
    select c.* into v_class from public.ops_compute_model_classes c
     where v_task.implementation is not null and c.implementations ? v_task.implementation
     order by c.model_class limit 1;
    if not found and (select count(*) from public.ops_compute_model_classes) = 1 then
      select * into v_class from public.ops_compute_model_classes;
    end if;
  end if;
  if v_class.model_class is null then
    return jsonb_build_object('ok', false, 'code', 'MODEL_CLASS_UNKNOWN', 'replayed', false, 'reason', 'no model class prices this task');
  end if;
  if p_unit_version is not null and p_unit_version <> v_class.unit_version then
    return jsonb_build_object('ok', false, 'code', 'UNIT_VERSION_STALE', 'replayed', false,
      'model_class', v_class.model_class, 'unit_version', v_class.unit_version, 'requested_unit_version', p_unit_version);
  end if;

  select * into v_account from public.ops_compute_accounts where account_id = p_account_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ACCOUNT_UNKNOWN', 'replayed', false); end if;
  if v_account.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN', 'replayed', false); end if;
  if v_account.org_id <> v_task.org_id then return jsonb_build_object('ok', false, 'code', 'CROSS_ORG_DENIED', 'replayed', false); end if;

  if exists (select 1 from public.ops_compute_spend_reservations where task_id = p_task_id) then
    return jsonb_build_object('ok', false, 'code', 'TASK_RESERVED', 'replayed', false, 'reason', 'the task already has a reservation under another operation_key');
  end if;

  select * into v_quota from public.ops_compute_account_quotas where account_id = p_account_id;
  if found then
    select count(*) into v_open from public.ops_compute_spend_reservations where account_id = p_account_id and status = 'open';
    if v_quota.max_open_reservations is not null and v_open >= v_quota.max_open_reservations then
      return jsonb_build_object('ok', false, 'code', 'QUOTA_RESERVATIONS', 'replayed', false, 'open_reservations', v_open, 'max_open_reservations', v_quota.max_open_reservations);
    end if;
    select count(*) into v_queued
      from public.ops_compute_spend_reservations r join public.ops_compute_tasks t on t.id = r.task_id
     where r.account_id = p_account_id and r.status = 'open' and t.status = 'queued';
    if v_quota.max_queued_tasks is not null and v_queued >= v_quota.max_queued_tasks then
      return jsonb_build_object('ok', false, 'code', 'QUOTA_QUEUE', 'replayed', false, 'queued_tasks', v_queued, 'max_queued_tasks', v_quota.max_queued_tasks);
    end if;
  end if;

  v_balances := public.compute_ledger_balances_internal(p_account_id);
  if (v_balances->>'available')::bigint < p_max_units_micro then
    return jsonb_build_object('ok', false, 'code', 'OVER_BUDGET', 'replayed', false, 'available', (v_balances->>'available')::bigint, 'requested', p_max_units_micro);
  end if;

  insert into public.ops_compute_spend_reservations(operation_key, account_id, task_id, max_units_micro, model_class, unit_version, status, expires_at)
    values (p_op_key, p_account_id, p_task_id, p_max_units_micro, v_class.model_class, v_class.unit_version, 'open', clock_timestamp() + make_interval(secs => v_deadline))
    returning * into v_res;
  insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, units_micro, spend_micro, model_class, unit_version, reason)
    values (p_op_key, 'reserve', p_account_id, p_task_id, p_max_units_micro, 0, v_class.model_class, v_class.unit_version, 'reserve')
    returning entry_id into v_entry;

  v_outcome := jsonb_build_object('ok', true, 'replayed', false, 'reservation_id', v_res.reservation_id, 'entry_id', v_entry,
    'account_id', p_account_id, 'task_id', p_task_id, 'max_units_micro', p_max_units_micro, 'expires_at', v_res.expires_at,
    'model_class', v_res.model_class, 'unit_version', v_res.unit_version);
  insert into public.ops_compute_ledger_operations(operation_key, kind, payload_hash, outcome)
    values (p_op_key, 'reserve', v_hash, v_outcome)
    on conflict (operation_key) do nothing;
  if not found then raise exception 'operation_key % claimed concurrently', p_op_key using errcode = '40001'; end if;
  return v_outcome;
end;
$$;

-- b) settle: every acceptance check, then settle + mint + release in one transaction.
create or replace function public.compute_ledger_settle(
  p_op_key text,
  p_task_id uuid,
  p_lease_token_hash text,
  p_attempt integer,
  p_metering jsonb,
  p_output_sha256 text,
  p_scheduler_holder_id text,
  p_scheduler_term bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_task public.ops_compute_tasks%rowtype;
  v_lease public.ops_compute_leases%rowtype;
  v_node public.ops_compute_nodes%rowtype;
  v_res public.ops_compute_spend_reservations%rowtype;
  v_class public.ops_compute_model_classes%rowtype;
  v_hash text;
  v_existing jsonb;
  v_reason text := null;
  v_review boolean := false;
  v_worker text;
  v_submitter text;
  v_metering jsonb := coalesce(p_metering, '{}'::jsonb);
  v_model text;
  v_digest text;
  v_prompt bigint; v_cached bigint; v_eval bigint; v_eval_ns bigint; v_total_ns bigint; v_load_ns bigint; v_prompt_ns bigint;
  v_units bigint := 0;
  v_spend bigint := 0;
  v_minted bigint := 0;
  v_carry bigint := 0;
  v_total bigint;
  v_points_delta bigint := 0;
  v_points_total bigint;
  v_remainder bigint;
  v_computed_hash text;
  v_expected text;
  v_daily bigint;
  v_cap bigint;
  v_settle_id bigint; v_mint_id bigint; v_release_id bigint;
  v_outcome jsonb;
  v_now timestamptz;
  v_counter text;
  v_value jsonb;
  v_counters_ok boolean := true;
  v_counts jsonb := '{}'::jsonb;
  v_node_id text;
  v_node_found boolean := false;
  v_lease_found boolean := false;
  -- true once a check fails for a reason on the worker's side: no charge, full release
  v_fault boolean := false;
  v_charged boolean;
  v_released bigint;
  v_cap_eval bigint;
  v_cap_prompt bigint;
  v_attested text;
begin
  if p_op_key is null or p_op_key !~ '^[!-~]{1,200}$' then raise exception 'invalid operation key'; end if;
  if p_task_id is null then raise exception 'p_task_id is required'; end if;
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'p_lease_token_hash must be a sha256 hex'; end if;
  if p_attempt is null or p_attempt < 1 then raise exception 'p_attempt must be a positive integer'; end if;
  if p_output_sha256 is null or p_output_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'p_output_sha256 must be a sha256 hex'; end if;
  if jsonb_typeof(v_metering) <> 'object' then raise exception 'p_metering must be a JSON object'; end if;

  -- Lock order: node, then lease, then task: the order compute_claim_task and
  -- compute_transition_lease_v2 take, so a settle and a node's lease call on
  -- the same rows queue behind each other instead of deadlocking. The lease's
  -- node_id never changes, so it is read without a lock to find the node row.
  select node_id into v_node_id from public.ops_compute_leases
   where task_id = p_task_id and lease_token_hash = p_lease_token_hash;
  if v_node_id is not null then
    select * into v_node from public.ops_compute_nodes where id = v_node_id for update;
    v_node_found := found;
    select * into v_lease from public.ops_compute_leases
     where task_id = p_task_id and lease_token_hash = p_lease_token_hash for update;
    v_lease_found := found;
  end if;
  select * into v_task from public.ops_compute_tasks where id = p_task_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_FOUND', 'replayed', false); end if;

  v_hash := public.compute_ledger_sha256(jsonb_build_object('task_id', p_task_id, 'lease_token_hash', p_lease_token_hash, 'attempt', p_attempt,
    'metering', v_metering, 'output_sha256', p_output_sha256)::text);
  v_existing := public.compute_ledger_operation_lookup(p_op_key, 'settle', v_hash);
  if v_existing is not null then return v_existing; end if;

  if not public.compute_ledger_term_ok(v_task.org_id, p_scheduler_holder_id, p_scheduler_term) then
    return jsonb_build_object('ok', false, 'code', 'STALE_TERM', 'replayed', false, 'reason', 'scheduler (holder_id, term) is not the live row');
  end if;

  -- The completing lease of the task's current attempt: same fence as compute_transition_lease_v2.
  if not v_lease_found or v_lease.attempt is distinct from p_attempt or v_task.attempts <> p_attempt
     or v_lease.status <> 'done' or v_task.status <> 'done' then
    return jsonb_build_object('ok', false, 'code', 'LEASE_REJECTED', 'replayed', false,
      'reason', 'not the completing lease of the task''s current attempt');
  end if;

  if exists (select 1 from public.ops_compute_contribution_ledger where task_id = p_task_id and attempt = p_attempt and kind = 'settle') then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_SETTLE', 'replayed', false, 'reason', 'this (task_id, attempt) is already settled under another operation_key');
  end if;

  select * into v_res from public.ops_compute_spend_reservations where task_id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_RESERVATION', 'replayed', false, 'reason', 'the task has no spend reservation');
  end if;
  if v_res.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_CLOSED', 'replayed', false, 'reason', 'the reservation is ' || v_res.status);
  end if;
  v_submitter := v_res.account_id;
  v_now := clock_timestamp();

  -- Node (locked above) and worker account.
  if not v_node_found or v_node.state not in ('online','draining') or v_node.revoked_at is not null then
    v_reason := coalesce(v_reason, 'NODE_UNAVAILABLE'); v_fault := true;
  end if;
  select account_id into v_worker from public.ops_compute_node_accounts where node_id = v_lease.node_id;
  if v_worker is null then v_reason := coalesce(v_reason, 'NODE_UNBOUND'); end if;

  -- Model class from (model, digest); it must be the class and the
  -- unit_version the reservation pinned (and the one the metering names, if any).
  v_model := v_metering->>'model';
  v_digest := v_metering->>'model_digest';
  select c.* into v_class from public.ops_compute_model_classes c
   where exists (select 1 from jsonb_array_elements(c.approved_models) m where m->>'model' = v_model)
   order by (c.model_class = v_res.model_class) desc, c.model_class limit 1;
  if not found then
    v_reason := coalesce(v_reason, 'MODEL_NOT_APPROVED'); v_fault := true;
  else
    if v_digest is null or not exists (select 1 from jsonb_array_elements(v_class.approved_models) m where m->>'model' = v_model and m->>'digest' = v_digest) then
      v_reason := coalesce(v_reason, 'DIGEST_NOT_APPROVED'); v_fault := true;
    end if;
    if v_class.model_class <> v_res.model_class then
      v_reason := coalesce(v_reason, 'MODEL_CLASS_MISMATCH'); v_fault := true;
    elsif v_class.unit_version <> v_res.unit_version
       or (v_metering ? 'unit_version' and jsonb_typeof(v_metering->'unit_version') <> 'null'
           and (v_metering->>'unit_version') is distinct from v_res.unit_version::text) then
      v_reason := coalesce(v_reason, 'UNIT_VERSION_STALE'); v_fault := true;
    end if;
  end if;

  -- Counters: non-negative integers. A counter the runtime did not report
  -- (absent or JSON null: Ollama omits zero counters and never reports
  -- prompt_eval_cached_count) counts as 0; a present one must be well formed.
  foreach v_counter in array array['prompt_eval_count','prompt_eval_cached_count','eval_count','total_duration_ns','load_duration_ns','prompt_eval_duration_ns','eval_duration_ns'] loop
    v_value := v_metering->v_counter;
    if v_value is null or jsonb_typeof(v_value) = 'null' then
      v_counts := v_counts || jsonb_build_object(v_counter, 0);
    elsif jsonb_typeof(v_value) <> 'number' or (v_value::text) !~ '^[0-9]{1,18}$' then
      v_counters_ok := false;
      v_reason := coalesce(v_reason, 'COUNTERS_INVALID'); v_fault := true;
    else
      v_counts := v_counts || jsonb_build_object(v_counter, v_value);
    end if;
  end loop;
  if v_counters_ok then
    v_prompt := (v_counts->>'prompt_eval_count')::bigint;
    v_cached := (v_counts->>'prompt_eval_cached_count')::bigint;
    v_eval := (v_counts->>'eval_count')::bigint;
    v_eval_ns := (v_counts->>'eval_duration_ns')::bigint;
    v_total_ns := (v_counts->>'total_duration_ns')::bigint;
    v_load_ns := (v_counts->>'load_duration_ns')::bigint;
    v_prompt_ns := (v_counts->>'prompt_eval_duration_ns')::bigint;
    if v_cached > v_prompt then v_reason := coalesce(v_reason, 'COUNTERS_INVALID'); v_fault := true; end if;
    if v_eval_ns <= 0 then v_reason := coalesce(v_reason, 'COUNTERS_INVALID'); v_fault := true; end if;
    if v_class.model_class is not null then
      -- The task's own caps bound the counters as well as the class maxima:
      -- input.num_predict (the adapter never generates fewer than 16) and
      -- input.num_ctx (the adapter never runs a context under 2048). Same rule
      -- as taskCounterCaps() in core/src/compute/contribution-ledger.mjs, which
      -- priced the reservation.
      v_cap_eval := v_class.max_eval_count;
      v_cap_prompt := v_class.max_prompt_eval_count;
      if jsonb_typeof(v_task.input->'num_predict') = 'number' and (v_task.input->>'num_predict') ~ '^[0-9]{1,9}$' and (v_task.input->>'num_predict')::bigint > 0 then
        v_cap_eval := least(v_cap_eval, greatest(16, (v_task.input->>'num_predict')::bigint));
      end if;
      if jsonb_typeof(v_task.input->'num_ctx') = 'number' and (v_task.input->>'num_ctx') ~ '^[0-9]{1,9}$' and (v_task.input->>'num_ctx')::bigint > 0 then
        v_cap_prompt := least(v_cap_prompt, greatest(2048, (v_task.input->>'num_ctx')::bigint));
      end if;
      if v_eval > v_cap_eval or v_prompt > v_cap_prompt then
        v_reason := coalesce(v_reason, 'COUNTERS_OUT_OF_WINDOW'); v_fault := true;
      elsif v_eval_ns > 0 and (v_eval * 1000000000 < v_class.min_tokens_per_s * v_eval_ns or v_eval * 1000000000 > v_class.max_tokens_per_s * v_eval_ns) then
        v_reason := coalesce(v_reason, 'COUNTERS_OUT_OF_WINDOW'); v_fault := true;
      end if;
      -- The units the counters claim, at the class weights. Recorded on the
      -- settle entry whatever the verdict; charged only as decided below.
      v_units := v_eval * v_class.out_unit_micro + greatest(0, v_prompt - v_cached) * v_class.in_unit_micro;
      if v_units > v_res.max_units_micro then
        v_reason := coalesce(v_reason, 'UNITS_EXCEED_RESERVATION'); v_fault := true;
      end if;
    end if;
  end if;

  -- The output hash is the Core's (hashJson over the stored output; see the
  -- header). The lease's result must be the task's output, and the hash must
  -- be the one the gateway recorded with the node's completion attestation.
  v_computed_hash := p_output_sha256;
  if v_lease.result is distinct from v_task.output then
    v_reason := coalesce(v_reason, 'OUTPUT_HASH_MISMATCH'); v_fault := true;
  end if;
  if to_regclass('public.ops_compute_attestations') is not null then
    select result_sha256 into v_attested from public.ops_compute_attestations where lease_id = v_lease.id;
    if v_attested is not null and v_attested <> p_output_sha256 then
      v_reason := coalesce(v_reason, 'OUTPUT_HASH_MISMATCH'); v_fault := true;
    end if;
  end if;

  -- Not late.
  if v_lease.completed_at is null or v_lease.completed_at > v_res.expires_at then
    v_reason := coalesce(v_reason, 'LATE'); v_fault := true;
  end if;

  -- Not self-routed or collusive.
  if v_worker is not null and (v_worker = v_submitter
      or exists (select 1 from public.ops_compute_account_relations r
                  where (r.account_id = v_worker and r.related_account_id = v_submitter)
                     or (r.account_id = v_submitter and r.related_account_id = v_worker))) then
    v_reason := coalesce(v_reason, 'SELF_ROUTED');
  end if;

  -- Known-answer sampling.
  select expected_sha256 into v_expected from public.ops_compute_known_answer_tasks where task_id = p_task_id;
  if v_expected is not null and v_expected <> v_computed_hash then
    v_reason := coalesce(v_reason, 'KNOWN_ANSWER_MISMATCH'); v_fault := true;
    v_review := true;
  end if;

  -- Daily mint cap.
  if v_reason is null and v_worker is not null then
    select daily_mint_cap_micro into v_cap from public.ops_compute_account_quotas where account_id = v_worker;
    if v_cap is not null then
      select coalesce(sum(units_micro), 0) into v_daily from public.ops_compute_contribution_ledger
       where account_id = v_worker and kind = 'mint' and created_at > v_now - interval '24 hours';
      -- The spendable share of this attempt at the class ratio, before carry.
      if v_daily + (v_units / greatest(1, v_class.redemption_ratio)) > v_cap then
        v_reason := coalesce(v_reason, 'QUOTA_DAILY_MINT');
      end if;
    end if;
  end if;

  -- Writes. 1) settle: the submitter pays the units of an attempt that is
  -- accepted, or declined for a reason that is not the worker's fault
  -- (SELF_ROUTED, QUOTA_DAILY_MINT, NODE_UNBOUND), never above the
  -- reservation. Any worker-side fault charges nothing and releases it all.
  v_charged := not v_fault;
  v_spend := case when v_charged then least(v_units, v_res.max_units_micro) else 0 end;
  v_released := v_res.max_units_micro - v_spend;
  insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, lease_id, attempt, node_id,
      scheduler_holder_id, scheduler_term, units_micro, spend_micro, metering, model_class, unit_version, reason)
    values (p_op_key, 'settle', v_submitter, p_task_id, v_lease.id, p_attempt, v_lease.node_id,
      p_scheduler_holder_id, p_scheduler_term, v_units, v_spend, v_metering, v_class.model_class, v_class.unit_version,
      coalesce(v_reason, 'accepted'))
    returning entry_id into v_settle_id;

  -- 2) mint: only an accepted attempt, with the carry.
  if v_reason is null then
    insert into public.ops_compute_account_carry(account_id, carry_micro) values (v_worker, 0)
      on conflict (account_id) do nothing;
    select carry_micro into v_carry from public.ops_compute_account_carry where account_id = v_worker for update;
    v_total := v_carry + v_units;
    v_minted := v_total / v_class.redemption_ratio;
    v_carry := v_total % v_class.redemption_ratio;
    update public.ops_compute_account_carry set carry_micro = v_carry where account_id = v_worker;
    insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, lease_id, attempt, node_id,
        scheduler_holder_id, scheduler_term, units_micro, spend_micro, metering, model_class, unit_version, reason)
      values (p_op_key || ':mint', 'mint', v_worker, p_task_id, v_lease.id, p_attempt, v_lease.node_id,
        p_scheduler_holder_id, p_scheduler_term, v_minted, 0,
        jsonb_build_object('accepted_units_micro', v_units, 'redemption_ratio', v_class.redemption_ratio, 'carry_micro', v_carry),
        v_class.model_class, v_class.unit_version, 'mint')
      returning entry_id into v_mint_id;
    -- Display points: 100,000 accepted whole units per point, remainder carried in micro-units.
    if exists (select 1 from public.ops_compute_accounts where account_id = v_worker and display_points_opt_in) then
      insert into public.ops_compute_display_points(account_id, points, accepted_units_remainder) values (v_worker, 0, 0)
        on conflict (account_id) do nothing;
      select points, accepted_units_remainder into v_points_total, v_remainder from public.ops_compute_display_points where account_id = v_worker for update;
      v_remainder := v_remainder + v_units;
      v_points_delta := v_remainder / 100000000000;
      v_remainder := v_remainder % 100000000000;
      update public.ops_compute_display_points set points = v_points_total + v_points_delta, accepted_units_remainder = v_remainder where account_id = v_worker;
    end if;
  end if;

  -- 3) close the reservation: 'settled' with the unused part released when the
  -- submitter was charged, 'released' in full when the attempt was rejected.
  update public.ops_compute_spend_reservations set status = case when v_charged then 'settled' else 'released' end
   where reservation_id = v_res.reservation_id;
  insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, lease_id, attempt, node_id,
      scheduler_holder_id, scheduler_term, units_micro, spend_micro, reason)
    values (p_op_key || ':release', 'release', v_submitter, p_task_id, v_lease.id, p_attempt, v_lease.node_id,
      p_scheduler_holder_id, p_scheduler_term, v_released, 0, case when v_charged then 'settled' else 'rejected:' || v_reason end)
    returning entry_id into v_release_id;

  -- 4) a review row for a known-answer mismatch; never a state change on the node.
  if v_review then
    insert into public.ops_compute_fraud_reviews(task_id, lease_id, node_id, account_id, kind, detail)
      values (p_task_id, v_lease.id, v_lease.node_id, v_worker, 'known_answer_mismatch',
        jsonb_build_object('expected_sha256', v_expected, 'output_sha256', v_computed_hash, 'attempt', p_attempt, 'operation_key', p_op_key));
  end if;

  v_outcome := jsonb_build_object('ok', true, 'replayed', false, 'accepted', v_reason is null, 'reason', coalesce(v_reason, 'accepted'),
    'task_id', p_task_id, 'attempt', p_attempt, 'lease_id', v_lease.id, 'node_id', v_lease.node_id,
    'submitter_account_id', v_submitter, 'worker_account_id', v_worker,
    'model_class', v_class.model_class, 'unit_version', v_class.unit_version,
    'units_micro', v_units, 'spend_micro', v_spend, 'minted_micro', v_minted, 'carry_micro', v_carry,
    'released_micro', v_released, 'charged', v_charged, 'max_units_micro', v_res.max_units_micro,
    'reservation_status', case when v_charged then 'settled' else 'released' end, 'display_points_delta', v_points_delta,
    'review_opened', v_review,
    'entries', jsonb_build_object('settle', v_settle_id, 'mint', v_mint_id, 'release', v_release_id));
  insert into public.ops_compute_ledger_operations(operation_key, kind, payload_hash, outcome)
    values (p_op_key, 'settle', v_hash, v_outcome)
    on conflict (operation_key) do nothing;
  if not found then raise exception 'operation_key % claimed concurrently', p_op_key using errcode = '40001'; end if;
  return v_outcome;
end;
$$;

-- c) release: an open reservation on cancel, fail, expiry or rejection.
create or replace function public.compute_ledger_release(
  p_op_key text,
  p_task_id uuid,
  p_reason text,
  p_scheduler_holder_id text,
  p_scheduler_term bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_task public.ops_compute_tasks%rowtype;
  v_res public.ops_compute_spend_reservations%rowtype;
  v_hash text;
  v_existing jsonb;
  v_entry bigint;
  v_outcome jsonb;
  v_reason text := left(coalesce(p_reason, 'released'), 200);
begin
  if p_op_key is null or p_op_key !~ '^[!-~]{1,200}$' then raise exception 'invalid operation key'; end if;
  if p_task_id is null then raise exception 'p_task_id is required'; end if;

  select * into v_task from public.ops_compute_tasks where id = p_task_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_FOUND', 'replayed', false); end if;

  v_hash := public.compute_ledger_sha256(jsonb_build_object('task_id', p_task_id, 'reason', v_reason)::text);
  v_existing := public.compute_ledger_operation_lookup(p_op_key, 'release', v_hash);
  if v_existing is not null then return v_existing; end if;

  if not public.compute_ledger_term_ok(v_task.org_id, p_scheduler_holder_id, p_scheduler_term) then
    return jsonb_build_object('ok', false, 'code', 'STALE_TERM', 'replayed', false, 'reason', 'scheduler (holder_id, term) is not the live row');
  end if;

  select * into v_res from public.ops_compute_spend_reservations where task_id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_RESERVATION', 'replayed', false);
  end if;
  if v_res.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_CLOSED', 'replayed', false, 'reason', 'the reservation is ' || v_res.status);
  end if;

  update public.ops_compute_spend_reservations set status = 'released' where reservation_id = v_res.reservation_id;
  insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, attempt,
      scheduler_holder_id, scheduler_term, units_micro, spend_micro, reason)
    values (p_op_key, 'release', v_res.account_id, p_task_id, nullif(v_task.attempts, 0),
      p_scheduler_holder_id, p_scheduler_term, v_res.max_units_micro, 0, v_reason)
    returning entry_id into v_entry;

  v_outcome := jsonb_build_object('ok', true, 'replayed', false, 'released', true, 'entry_id', v_entry, 'task_id', p_task_id,
    'account_id', v_res.account_id, 'released_micro', v_res.max_units_micro, 'reason', v_reason);
  insert into public.ops_compute_ledger_operations(operation_key, kind, payload_hash, outcome)
    values (p_op_key, 'release', v_hash, v_outcome)
    on conflict (operation_key) do nothing;
  if not found then raise exception 'operation_key % claimed concurrently', p_op_key using errcode = '40001'; end if;
  return v_outcome;
end;
$$;

-- d) correct: append a correction; never edits. correction_of may be null (an opening grant).
create or replace function public.compute_ledger_correct(
  p_op_key text,
  p_correction_of bigint,
  p_account_id text,
  p_spend_micro bigint,
  p_units_micro bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_existing jsonb;
  v_entry bigint;
  v_outcome jsonb;
  v_ref public.ops_compute_contribution_ledger%rowtype;
begin
  if p_op_key is null or p_op_key !~ '^[!-~]{1,200}$' then raise exception 'invalid operation key'; end if;
  if p_account_id is null then raise exception 'p_account_id is required'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'p_reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('compute_ledger_correct:' || p_op_key, 0));

  v_hash := public.compute_ledger_sha256(jsonb_build_object('correction_of', p_correction_of, 'account_id', p_account_id,
    'spend_micro', coalesce(p_spend_micro, 0), 'units_micro', coalesce(p_units_micro, 0), 'reason', p_reason)::text);
  v_existing := public.compute_ledger_operation_lookup(p_op_key, 'correction', v_hash);
  if v_existing is not null then return v_existing; end if;

  if not exists (select 1 from public.ops_compute_accounts where account_id = p_account_id) then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_UNKNOWN', 'replayed', false);
  end if;
  if p_correction_of is not null then
    select * into v_ref from public.ops_compute_contribution_ledger where entry_id = p_correction_of;
    if not found then return jsonb_build_object('ok', false, 'code', 'ENTRY_NOT_FOUND', 'replayed', false); end if;
  end if;

  insert into public.ops_compute_contribution_ledger(operation_key, kind, account_id, task_id, lease_id, attempt, node_id,
      units_micro, spend_micro, correction_of, reason)
    values (p_op_key, 'correction', p_account_id, v_ref.task_id, v_ref.lease_id, v_ref.attempt, v_ref.node_id,
      coalesce(p_units_micro, 0), coalesce(p_spend_micro, 0), p_correction_of, left(p_reason, 1000))
    returning entry_id into v_entry;

  v_outcome := jsonb_build_object('ok', true, 'replayed', false, 'entry_id', v_entry, 'account_id', p_account_id,
    'correction_of', p_correction_of, 'spend_micro', coalesce(p_spend_micro, 0), 'units_micro', coalesce(p_units_micro, 0));
  insert into public.ops_compute_ledger_operations(operation_key, kind, payload_hash, outcome)
    values (p_op_key, 'correction', v_hash, v_outcome)
    on conflict (operation_key) do nothing;
  if not found then raise exception 'operation_key % claimed concurrently', p_op_key using errcode = '40001'; end if;
  return v_outcome;
end;
$$;

-- e) balances: sums, never stored columns.
create or replace function public.compute_ledger_balances(p_account_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_account_id is null then raise exception 'p_account_id is required'; end if;
  if not exists (select 1 from public.ops_compute_accounts where account_id = p_account_id) then return null; end if;
  return public.compute_ledger_balances_internal(p_account_id);
end;
$$;

-- f) receipt: the per-job ledger receipt (reservation, entries, verdict, reviews).
create or replace function public.compute_ledger_receipt(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_res jsonb;
  v_entries jsonb;
  v_verdict jsonb;
  v_reviews jsonb;
begin
  if p_task_id is null then raise exception 'p_task_id is required'; end if;
  if not exists (select 1 from public.ops_compute_tasks where id = p_task_id) then return null; end if;
  select to_jsonb(r) into v_res from public.ops_compute_spend_reservations r where r.task_id = p_task_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.entry_id), '[]'::jsonb) into v_entries
    from public.ops_compute_contribution_ledger l where l.task_id = p_task_id;
  select o.outcome into v_verdict from public.ops_compute_ledger_operations o
    join public.ops_compute_contribution_ledger l on l.operation_key = o.operation_key
   where o.kind = 'settle' and l.task_id = p_task_id and l.kind = 'settle'
   order by l.entry_id desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.review_id), '[]'::jsonb) into v_reviews
    from public.ops_compute_fraud_reviews f where f.task_id = p_task_id;
  return jsonb_build_object('schema', 'mccluster-ledger-receipt/1', 'task_id', p_task_id,
    'reservation', v_res,
    'settle', (select to_jsonb(l) from public.ops_compute_contribution_ledger l where l.task_id = p_task_id and l.kind = 'settle' order by l.entry_id desc limit 1),
    'mint', (select to_jsonb(l) from public.ops_compute_contribution_ledger l where l.task_id = p_task_id and l.kind = 'mint' order by l.entry_id desc limit 1),
    'releases', (select coalesce(jsonb_agg(to_jsonb(l) order by l.entry_id), '[]'::jsonb) from public.ops_compute_contribution_ledger l where l.task_id = p_task_id and l.kind = 'release'),
    'corrections', (select coalesce(jsonb_agg(to_jsonb(l) order by l.entry_id), '[]'::jsonb) from public.ops_compute_contribution_ledger l where l.task_id = p_task_id and l.kind = 'correction'),
    'entries', v_entries,
    'verdict', v_verdict,
    'reviews', v_reviews);
end;
$$;

revoke all on function public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer) from public, anon, authenticated;
revoke all on function public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint) from public, anon, authenticated;
revoke all on function public.compute_ledger_release(text,uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function public.compute_ledger_correct(text,bigint,text,bigint,bigint,text) from public, anon, authenticated;
revoke all on function public.compute_ledger_balances(text) from public, anon, authenticated;
revoke all on function public.compute_ledger_receipt(uuid) from public, anon, authenticated;
grant execute on function public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer) to service_role;
grant execute on function public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint) to service_role;
grant execute on function public.compute_ledger_release(text,uuid,text,text,bigint) to service_role;
grant execute on function public.compute_ledger_correct(text,bigint,text,bigint,bigint,text) to service_role;
grant execute on function public.compute_ledger_balances(text) to service_role;
grant execute on function public.compute_ledger_receipt(uuid) to service_role;
