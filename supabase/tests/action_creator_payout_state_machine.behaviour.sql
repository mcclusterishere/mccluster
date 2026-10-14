-- Isolated database regression checks for creator payout state-machine boundaries.
-- Run after all migrations. Rolls back. No Stripe calls or production mutations.
begin;
do $audit$
declare
  v_reserve text;
  v_claim text;
  v_finalize text;
  v_reverse text;
  v_bank text;
begin
  select pg_get_functiondef('public.action_creator_reserve_payout(uuid,uuid,text,uuid)'::regprocedure) into v_reserve;
  select pg_get_functiondef('public.action_creator_claim_transfer(uuid)'::regprocedure) into v_claim;
  select pg_get_functiondef('public.action_creator_finalize_transfer(uuid,text)'::regprocedure) into v_finalize;
  select pg_get_functiondef('public.action_creator_record_stripe_event(text,text,text,bigint)'::regprocedure) into v_reverse;
  select pg_get_functiondef('public.action_creator_record_bank_payout(text,text,text,text,bigint,text)'::regprocedure) into v_bank;

  if position('action_creator_connect_accounts' in v_reserve)=0
     or position('creator_m_uid=e.m_uid' in v_reserve)=0 then
    raise exception 'reservation does not bind destination to creator';
  end if;
  if position('state=''reserved''' in v_claim)=0 then
    raise exception 'transfer claim lacks reserved-state predicate';
  end if;
  if position('reserved_cents=reserved_cents-p.amount_cents' in v_finalize)=0
     or position('spent_cents=spent_cents+p.amount_cents' in v_finalize)=0 then
    raise exception 'transfer finalization ledger transition missing';
  end if;
  if position('action_creator_transfer_reversal_totals' in v_reverse)=0
     or position('p_amount_cents - v_prior' in v_reverse)=0 then
    raise exception 'reversal cumulative-delta guard missing';
  end if;
  if position('on conflict(event_id) do nothing' in v_bank)=0 then
    raise exception 'bank payout event deduplication missing';
  end if;

  if has_function_privilege('anon','public.action_creator_reserve_payout(uuid,uuid,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.action_creator_finalize_transfer(uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.action_creator_record_stripe_event(text,text,text,bigint)','EXECUTE')
     or has_function_privilege('authenticated','public.action_creator_record_bank_payout(text,text,text,text,bigint,text)','EXECUTE') then
    raise exception 'creator payout mutation function exposed to untrusted role';
  end if;
end
$audit$;
rollback;
