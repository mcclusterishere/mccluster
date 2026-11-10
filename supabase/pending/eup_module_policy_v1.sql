-- E=Up module policy: persisted enable / drain / disable for the Equity Uprise product modules that the
-- McCluster implementation runs (environment, league, intake), composed INTO the canonical data plane.
-- Pending, unapplied, reviewed LOCAL schema.
--
-- Upstream notice (preserved): this ports the semantics, not the bytes, of the unpublished Equity Uprise
-- portable control follow-on. "Unpublished review evidence; contains known audit defects. Not an installable
-- release or authorization to apply." (PATCH_PROVENANCE.json, status of portable-control-followon.patch)
--   patch   local-source-review/portable-control-followon.patch
--   sha256  d4d6d087f2e30811884b9a0ae097f53aa942e98fe536935e952d16bbde8342cd   (102808 bytes)
--   base    5880179931848181c6ebd55bba5727f29a21c6e2   target 1c76d64176e4be929817517496b8d342d65a6d7b
--   ported  database/control/001-baseline.sql  sha256 815907f426f7f95d1b54ef6c918c5157e22a131c3e74a927f1e1b905cf950c9e
--           database/control/002-audit-reason.sql sha256 cd1df626bfb07b23cef33320e48a09cc750d0ce7654a9c93e49428215ca7afb2
--   upstream header kept verbatim: "-- Portable, private control baseline. Not a production Supabase migration."
-- Machine-readable copy: supabase/pending/eup_module_policy_v1.provenance.json.
--
-- What is ported: states enabled -> draining -> disabled (enabled -> disabled refused until drained), a safe-integer
-- revision that moves only on a real state change, idempotent owner commands whose replay returns the stored
-- receipt and whose changed replay fails, an append-only command log, a guard that domain writes call in their
-- OWN transaction, new modules start disabled, nothing is ever deleted, and the runtime holds function grants
-- and no table privilege.
-- What is deliberately NOT ported (McCluster already owns that authority; a copy would be a second one):
--   equity_control.installations  -> the canonical house organisation row public.orgs (slug 'mccluster')
--   equity_control.owners         -> canonical house ownership public.org_members(role = 'owner'), rechecked per call
--   equity.installation_id / equity.actor_id settings -> an explicit p_actor verified by the Worker bearer check
--   installer, schema_versions, restricted runtime role -> the Supabase migration ledger and service_role
-- Deliberate differences from upstream (the full list is in the provenance file):
--   1. FAIR QUEUE. Upstream locks the policy row FOR SHARE only. On native PostgreSQL a NEW "for share" locker is
--      admitted while a "for update" waits, so writers that arrive after the drain was requested still get in and
--      a steady stream of them starves the drain. Here the guard first takes a per-module transaction-level
--      advisory lock in shared mode and the owner command takes it in exclusive mode. Heavyweight locks queue
--      fairly: the drain waits only for the transactions already inside, and later ones wait behind it and then
--      read 'draining'. The row lock is kept so the check stays correct at every isolation level.
--   2. REDUCE-ONLY ENTRY POINT. public.eup_module_guard_reduce() admits a transaction that only stops work or
--      removes exposure (a member revoking consent, a withdrawal, a discard, an owner pause, a purge of retained
--      media) while the module is draining or disabled. Upstream has no such door, so a drained or disabled
--      module would trap a member's consent or keep retained media past its date. It takes the same two locks as
--      the guard, so a state command still waits for it. Reduce-only is a MODE of the guard, never a way round
--      it: the trigger backstop runs the reduce guard itself whenever a transaction carries the reduce marker, so
--      every write to a guarded table holds both locks and has had the EUM00 / EUM01 check, whoever set the marker.
--   3. Stable SQLSTATEs EUM00..EUM07, an owner-authorised install instead of provision(), a mandatory reason,
--      an optional expected revision on guarded writes, and the E=Up text idempotency key.
--
-- No seed and no copied data: this file creates no policy row. Until the house owner installs a module it has no
-- row, and a missing row refuses every guarded write (EUM01). Installing creates it 'disabled' at revision 0.
-- Idempotent: safe to run twice (the second run changes no row, no revision and no grant).
-- Rollback: eup_module_policy_v1.rollback.sql. Apply BEFORE eup_league_v1.sql / eup_intake_v1.sql.
begin;
set local lock_timeout = '5s';

create table if not exists public.eup_module_policies (
  org_id uuid not null references public.orgs(id),
  module_id text not null check (module_id in ('environment','league','intake')),
  state text not null check (state in ('enabled','draining','disabled')),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (org_id, module_id)
);
create table if not exists public.eup_module_policy_commands (
  seq bigint generated always as identity,
  org_id uuid not null references public.orgs(id),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  actor uuid not null references auth.users(id),
  module_id text not null check (module_id in ('environment','league','intake')),
  command text not null check (command in ('install','set_state')),
  requested_state text not null check (requested_state in ('enabled','draining','disabled')),
  expected_revision bigint check (expected_revision is null or expected_revision >= 0),
  reason text not null check (length(reason) between 1 and 500),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  prior_state text,
  prior_revision bigint,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, idempotency_key)
);
create index if not exists eup_module_policy_commands_module_time on public.eup_module_policy_commands (org_id, module_id, seq desc);

alter table public.eup_module_policies enable row level security;
alter table public.eup_module_policy_commands enable row level security;
-- Deliberately no policy and no table grant, service_role included: the functions below are the only door.
revoke all on public.eup_module_policies, public.eup_module_policy_commands from public, anon, authenticated, service_role;
-- The identity sequence is a relation too; Supabase default privileges would hand it to every API role.
revoke all on sequence public.eup_module_policy_commands_seq_seq from public, anon, authenticated, service_role;

-- The command log is append-only and a policy row is never deleted or rewritten out of sequence.
create or replace function public.eup_module_policy_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'eup_module_policy_commands' then
    raise exception 'eup_module_policy_commands is append-only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id = old.org_id and new.module_id = old.module_id and new.revision = old.revision + 1
       and new.state <> old.state and new.created_at = old.created_at then
      return new;
    end if;
  end if;
  raise exception 'eup_module_policies rows change only by one revision and are never deleted' using errcode = '42501';
end $$;
create or replace trigger eup_module_policy_commands_append_only before update or delete on public.eup_module_policy_commands
  for each row execute function public.eup_module_policy_immutable();
create or replace trigger eup_module_policy_commands_no_truncate before truncate on public.eup_module_policy_commands
  for each statement execute function public.eup_module_policy_immutable();
create or replace trigger eup_module_policies_monotonic before update or delete on public.eup_module_policies
  for each row execute function public.eup_module_policy_immutable();
create or replace trigger eup_module_policies_no_truncate before truncate on public.eup_module_policies
  for each statement execute function public.eup_module_policy_immutable();

-- The shape the pinned product reads (vendor/equity-uprise/src/server/module-policy.mjs readModulePolicy).
create or replace function public.eup_module_policy_json(p_module text, p_state text, p_revision bigint) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('schema', 'equity-uprise.module-policy/v1', 'installationId', 'mccluster',
    'moduleId', p_module, 'state', p_state, 'revision', p_revision)
$$;

-- Read one module's policy. No lock, no owner identity: a public route has to be gateable. A missing row is an
-- error, never "enabled".
create or replace function public.eup_module_policy_read(p_module text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pol public.eup_module_policies%rowtype;
begin
  select p.* into pol from public.eup_module_policies p join public.orgs o on o.id = p.org_id
   where o.slug = 'mccluster' and p.module_id = p_module;
  if not found then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  return public.eup_module_policy_json(pol.module_id, pol.state, pol.revision);
end $$;

-- Owner view: every module the registry knows (installed or not), its last command, and the latest commands.
create or replace function public.eup_module_control_read(p_actor uuid, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare house uuid;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'installationId', 'mccluster',
    'modules', (select jsonb_agg(jsonb_build_object('moduleId', r.module_id, 'installed', p.org_id is not null,
        'state', p.state, 'revision', p.revision, 'updated_at', p.updated_at, 'updated_by', p.updated_by,
        'last_command', (select jsonb_build_object('seq', c.seq, 'command', c.command, 'requested_state', c.requested_state,
            'expected_revision', c.expected_revision, 'reason', c.reason, 'actor', c.actor, 'created_at', c.created_at,
            'idempotency_key', c.idempotency_key, 'receipt', c.receipt)
          from public.eup_module_policy_commands c where c.org_id = house and c.module_id = r.module_id order by c.seq desc limit 1)
      ) order by r.ord)
      from (values (1, 'environment'), (2, 'league'), (3, 'intake')) r(ord, module_id)
      left join public.eup_module_policies p on p.org_id = house and p.module_id = r.module_id),
    'commands', coalesce((select jsonb_agg(to_jsonb(q) order by q.seq desc) from (
        select c.seq, c.module_id, c.command, c.requested_state, c.expected_revision, c.reason, c.actor, c.prior_state,
               c.prior_revision, c.idempotency_key, c.receipt, c.created_at
        from public.eup_module_policy_commands c where c.org_id = house order by c.seq desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)) q), '[]'::jsonb));
end $$;

-- Install: the house owner creates the policy row, disabled, revision 0. Replaces upstream's installer-only
-- provision(); it is owner-authorised by canonical house ownership, never first-caller-wins.
create or replace function public.eup_module_policy_install(p_actor uuid, p_module text, p_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; prior public.eup_module_policy_commands%rowtype; pol public.eup_module_policies%rowtype; digest text; receipt jsonb;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  if p_module is null or p_module not in ('environment','league','intake') or p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_reason is null or length(p_reason) not between 1 and 500 or p_reason ~ '[\u0000-\u001f\u007f]' then
    raise exception 'invalid_policy_command' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(p_actor::text || '|' || p_module || '|install|disabled||' || p_reason, 'utf8')), 'hex');
  perform pg_advisory_xact_lock(1163219023, hashtext(house::text || ':' || p_module));
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  if exists (select 1 from public.eup_module_policies where org_id = house and module_id = p_module) then
    raise exception 'module_already_installed' using errcode = 'EUM07'; end if;
  insert into public.eup_module_policies(org_id, module_id, state, revision, updated_by) values (house, p_module, 'disabled', 0, p_actor) returning * into pol;
  receipt := jsonb_build_object('policy', public.eup_module_policy_json(pol.module_id, pol.state, pol.revision), 'changed', true,
    'prior', null, 'recorded_at', pol.updated_at);
  insert into public.eup_module_policy_commands(org_id, idempotency_key, actor, module_id, command, requested_state, expected_revision, reason, payload_digest, prior_state, prior_revision, receipt)
    values (house, p_key, p_actor, p_module, 'install', 'disabled', null, p_reason, digest, null, null, receipt);
  return receipt;
end $$;

-- Enable / drain / disable. Takes the module's advisory lock in EXCLUSIVE mode and the policy row FOR UPDATE:
-- it waits for every guarded transaction already running (reduce-only ones included), and guarded transactions
-- that arrive later wait behind it and then see the new state. If the wait exceeds lock_timeout (5 s, kept under
-- the 8 s statement timeout Supabase gives the API login role) nothing is changed (55P03) and the same key can
-- be sent again.
-- Transitions: every pair is admitted except enabled -> disabled (EUM05, drain first), as upstream. That includes
-- disabled -> draining. It is kept on purpose: in this file it admits no write (the guard refuses both states,
-- EUM03 becomes EUM02; the reduce guard answers in both) and it moves the revision, so a job bound to an older
-- revision stays refused. The only difference between the two states is outside this file: the pinned product
-- answers reads while draining and nothing while disabled (vendor/equity-uprise/src/server/module-policy.mjs).
create or replace function public.eup_module_policy_command(p_actor uuid, p_module text, p_state text, p_expected_revision bigint, p_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; prior public.eup_module_policy_commands%rowtype; pol public.eup_module_policies%rowtype; digest text; receipt jsonb;
        old_state text; old_revision bigint; changed boolean := false;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  if p_module is null or p_module not in ('environment','league','intake') or p_state is null or p_state not in ('enabled','draining','disabled')
     or p_expected_revision is null or p_expected_revision < 0 or p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_reason is null or length(p_reason) not between 1 and 500 or p_reason ~ '[\u0000-\u001f\u007f]' then
    raise exception 'invalid_policy_command' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(p_actor::text || '|' || p_module || '|set_state|' || p_state || '|' || p_expected_revision::text || '|' || p_reason, 'utf8')), 'hex');
  -- A finished command replays without waiting for the lock.
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  perform pg_advisory_xact_lock(1163219023, hashtext(house::text || ':' || p_module));
  select * into pol from public.eup_module_policies where org_id = house and module_id = p_module for update;
  if not found then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  -- Under the lock: a concurrent identical command has either finished (replay) or not started.
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  if pol.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
  if pol.state = 'enabled' and p_state = 'disabled' then raise exception 'drain_required' using errcode = 'EUM05'; end if;
  old_state := pol.state; old_revision := pol.revision;
  if pol.state <> p_state then
    if pol.revision >= 9007199254740991 then raise exception 'revision_exhausted' using errcode = '22003'; end if;
    update public.eup_module_policies set state = p_state, revision = revision + 1, updated_by = p_actor, updated_at = clock_timestamp()
     where org_id = house and module_id = p_module returning * into pol;
    changed := true;
  end if;
  receipt := jsonb_build_object('policy', public.eup_module_policy_json(pol.module_id, pol.state, pol.revision), 'changed', changed,
    'prior', jsonb_build_object('state', old_state, 'revision', old_revision), 'recorded_at', clock_timestamp());
  insert into public.eup_module_policy_commands(org_id, idempotency_key, actor, module_id, command, requested_state, expected_revision, reason, payload_digest, prior_state, prior_revision, receipt)
    values (house, p_key, p_actor, p_module, 'set_state', p_state, p_expected_revision, p_reason, digest, old_state, old_revision, receipt);
  return receipt;
end $$;

-- The guard. Every domain RPC calls it FIRST among its writes, in its own transaction; both locks are held to
-- commit. Returns the policy revision it locked. p_expected_revision binds longer work (a claimed job, a request
-- that read the policy earlier) to the revision it started under.
--   EUM00 no house organisation   EUM01 no policy row   EUM02 draining   EUM03 disabled   EUM04 revision moved
-- Never call it inside a block that has an EXCEPTION handler: the handler would swallow the refusal and the
-- sub-transaction rollback would release the locks. One module per transaction.
create or replace function public.eup_module_guard(p_module text, p_expected_revision bigint default null) returns bigint
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; pol public.eup_module_policies%rowtype;
begin
  select o.id into house from public.orgs o where o.slug = 'mccluster' limit 1;
  if house is null or p_module is null then raise exception 'module_policy_unavailable' using errcode = 'EUM00'; end if;
  perform pg_advisory_xact_lock_shared(1163219023, hashtext(house::text || ':' || p_module));
  select * into pol from public.eup_module_policies where org_id = house and module_id = p_module for share;
  if not found then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  if pol.state = 'draining' then raise exception 'module_draining' using errcode = 'EUM02'; end if;
  if pol.state <> 'enabled' then raise exception 'module_disabled' using errcode = 'EUM03'; end if;
  if p_expected_revision is not null and pol.revision <> p_expected_revision then raise exception 'module_policy_changed' using errcode = 'EUM04'; end if;
  return pol.revision;
end $$;

-- The reduce-only guard: for an action that only stops work or removes exposure. It stays possible while the
-- module is draining or disabled, because refusing it would trap a member's consent or keep retained media past
-- its date. Same lock order as the guard (shared advisory lock, then the row FOR SHARE, both held to commit), so
-- a state command waits for an in-flight reduce writer exactly as it waits for any other.
--   EUM00 no house organisation   EUM01 no policy row   (never EUM02 / EUM03 / EUM04)
-- It then marks the transaction: set_config('eup.module_reduce', <module>, true). The marker is transaction-local
-- (it is gone at commit, at rollback, and when the savepoint it was set under is rolled back) and names ONE
-- module; the trigger below honours it for that module only, by running THIS function again in the writer's
-- transaction (re-entrant: the locks are already held, the marker is set to the same value). It grants nothing
-- else: authorisation, readiness and audience checks stay with the caller. Same placement rules as the guard
-- (not under an EXCEPTION handler, one module per transaction: a second reduce guard for another module moves
-- the marker and the first module's tables fall back to the full guard).
create or replace function public.eup_module_guard_reduce(p_module text) returns bigint
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; pol public.eup_module_policies%rowtype;
begin
  select o.id into house from public.orgs o where o.slug = 'mccluster' limit 1;
  if house is null or p_module is null then raise exception 'module_policy_unavailable' using errcode = 'EUM00'; end if;
  perform pg_advisory_xact_lock_shared(1163219023, hashtext(house::text || ':' || p_module));
  select * into pol from public.eup_module_policies where org_id = house and module_id = p_module for share;
  if not found then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  perform set_config('eup.module_reduce', pol.module_id, true);
  return pol.revision;
end $$;

-- Backstop for writes that do not come through a guarded RPC (service-role REST, a legacy RPC, a job writing a
-- table directly): a statement trigger on a module's tables takes the same guard in the writer's transaction.
--   create trigger <t>_module_policy before insert or update or delete on public.<t>
--     for each statement execute function public.eup_module_guard_trigger('league');
-- The reduce marker selects a MODE, it is never a bypass. When the transaction carries the marker for THIS
-- trigger's module (non-empty and equal to tg_argv[0]) the trigger performs eup_module_guard_reduce for that
-- module; a marker for any other module, an empty one, or none performs the full guard. No path returns without
-- one of the two. A transaction that writes a guarded table therefore ALWAYS holds the module's shared advisory
-- lock and the policy row FOR SHARE to its end, and has had the EUM00 / EUM01 check, whoever set the marker: a
-- state command always waits for it, and a marker set by hand (set_config without the reduce guard) on a module
-- with no row is refused EUM01 like any other write. (Rolling back to a savepoint releases the locks a write
-- under it took and undoes that write with them; the next write takes them again.) What the marker changes is
-- one thing only: the write is not refused for 'draining' or 'disabled'.
-- A PostgREST table write is its own transaction and cannot carry the marker, so direct table writes are still
-- refused whenever the module is not enabled. This is a correctness backstop, not a security boundary against
-- the service role: a session that can run arbitrary SQL can set the marker itself and so choose reduce mode
-- for a write that is not reduce-only. It still cannot write unlocked or to a module that is not installed.
-- Attached without a module argument it refuses every write (EUM00); with an empty one, EUM01. Attached FOR EACH
-- ROW by mistake it still guards and lets the row through instead of silently dropping it.
create or replace function public.eup_module_guard_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare marker text := current_setting('eup.module_reduce', true);
begin
  if marker is not null and marker <> '' and marker = tg_argv[0] then
    perform public.eup_module_guard_reduce(tg_argv[0]);
  else
    perform public.eup_module_guard(tg_argv[0]);
  end if;
  if tg_level = 'ROW' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  return null;
end $$;

revoke all on function public.eup_module_policy_immutable(), public.eup_module_policy_json(text, text, bigint), public.eup_module_policy_read(text),
  public.eup_module_control_read(uuid, integer), public.eup_module_policy_install(uuid, text, text, text),
  public.eup_module_policy_command(uuid, text, text, bigint, text, text), public.eup_module_guard(text, bigint),
  public.eup_module_guard_reduce(text), public.eup_module_guard_trigger() from public, anon, authenticated, service_role;
-- The runtime entry points: five as upstream granted (read_policy, read_control, read_audit, change_policy,
-- guard_enabled), plus the reduce-only guard. Nothing else is executable by any API role.
grant execute on function public.eup_module_policy_read(text), public.eup_module_control_read(uuid, integer),
  public.eup_module_policy_install(uuid, text, text, text), public.eup_module_policy_command(uuid, text, text, bigint, text, text),
  public.eup_module_guard(text, bigint), public.eup_module_guard_reduce(text) to service_role;
commit;
