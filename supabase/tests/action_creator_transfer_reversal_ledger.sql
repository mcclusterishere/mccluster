-- Reversal ledger invariants (isolated database; transaction rolls back).
begin;
do $audit$
declare v_definition text;
begin
  if has_function_privilege('anon','public.action_creator_record_stripe_event(text,text,text,bigint)','EXECUTE')
     or has_function_privilege('authenticated','public.action_creator_record_stripe_event(text,text,text,bigint)','EXECUTE') then
    raise exception 'untrusted role may record creator transfer events';
  end if;
  select pg_get_functiondef('public.action_creator_record_stripe_event(text,text,text,bigint)'::regprocedure)
    into v_definition;
  if position('action_creator_transfer_reversal_totals' in v_definition)=0
     or position('p_amount_cents - v_prior' in v_definition)=0
     or position('action_creator_reversal_quarantine' in v_definition)=0 then
    raise exception 'transfer reversal accounting guard missing';
  end if;
end
$audit$;
rollback;
