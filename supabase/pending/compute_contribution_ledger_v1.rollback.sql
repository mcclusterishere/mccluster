-- Pending empty-install recovery only. Once any configuration, reservation,
-- carry, receipt or ledger entry exists, retain the data and use a forward repair.
-- Check and drop in one statement so a failed check releases every lock and
-- a writer cannot add a row between the emptiness check and the drops.
do $rollback$
declare
  ledger_tables constant text[] := array[
    'ops_compute_ledger_operations',
    'ops_compute_display_points',
    'ops_compute_account_carry',
    'ops_compute_contribution_ledger',
    'ops_compute_spend_reservations',
    'ops_compute_fraud_reviews',
    'ops_compute_known_answer_tasks',
    'ops_compute_private_grants',
    'ops_compute_account_relations',
    'ops_compute_account_quotas',
    'ops_compute_model_classes',
    'ops_compute_node_accounts',
    'ops_compute_accounts'
  ];
  target text;
  present integer := 0;
  populated boolean;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'ledger rollback requires READ COMMITTED' using errcode = '55000';
  end if;
  perform set_config('lock_timeout', '5s', true);
  -- A filtered count is not proof of emptiness, including under FORCE RLS.
  perform set_config('row_security', 'off', true);
  foreach target in array ledger_tables loop
    if to_regclass(format('public.%I', target)) is not null then
      execute format('lock table public.%I in access exclusive mode', target);
      present := present + 1;
    end if;
  end loop;
  if present = 0 and not exists (
    select from pg_proc where pronamespace = 'public'::regnamespace and starts_with(proname::text, 'compute_ledger_')
  ) then
    return;
  end if;
  if present <> cardinality(ledger_tables) then
    raise exception 'ledger rollback refused: incomplete installation' using errcode = '55000';
  end if;
  foreach target in array ledger_tables loop
    execute format('select exists (select from public.%I)', target) into populated;
    if populated then
      raise exception 'ledger rollback refused: % contains data; use a reviewed forward repair', target
        using errcode = '55000';
    end if;
  end loop;

  drop function if exists public.compute_ledger_resolve_submission(uuid,uuid,text);
  drop function if exists public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer);
  drop function if exists public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint);
  drop function if exists public.compute_ledger_release(text,uuid,text,text,bigint);
  drop function if exists public.compute_ledger_correct(text,bigint,text,bigint,bigint,text);
  drop function if exists public.compute_ledger_balances(text);
  drop function if exists public.compute_ledger_receipt(uuid);
  drop function if exists public.compute_ledger_balances_internal(text);
  drop function if exists public.compute_ledger_operation_lookup(text,text,text);
  drop function if exists public.compute_ledger_term_ok(uuid,text,bigint);
  drop function if exists public.compute_ledger_sha256(text);
  -- RESTRICT is intentional. External dependents must block the whole rollback.
  foreach target in array ledger_tables loop
    execute format('drop table public.%I restrict', target);
  end loop;
  drop function public.compute_ledger_check_commit_term();
  drop function public.compute_ledger_lock_term(uuid,text,bigint);
  drop function public.compute_ledger_append_only();
end
$rollback$;
