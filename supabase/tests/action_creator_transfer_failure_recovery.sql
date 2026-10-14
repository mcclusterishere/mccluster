-- Test-only guardrails for creator payout recovery.
begin;
do $audit$
declare v_sql text;
begin
 select pg_get_functiondef('public.action_creator_release_failed_transfer(uuid,text)'::regprocedure) into v_sql;
 if position('stripe_transfer_id is not null' in v_sql)=0 then
  raise exception 'failed-transfer release lacks linked-transfer protection';
 end if;
 if position('reserved_cents=reserved_cents-v_intent.amount_cents' in v_sql)=0 then
  raise exception 'failed-transfer release does not decrement reservation';
 end if;
 if has_function_privilege('anon','public.action_creator_release_failed_transfer(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.action_creator_release_failed_transfer(uuid,text)','EXECUTE') then
  raise exception 'untrusted role can release transfer reservation';
 end if;
 if has_table_privilege('authenticated','public.action_creator_bank_payout_review','SELECT') then
  raise exception 'bank payout review exposed to authenticated role';
 end if;
end
$audit$;
rollback;
