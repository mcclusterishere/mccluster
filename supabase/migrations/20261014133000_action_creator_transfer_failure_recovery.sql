-- Transfer failures are only recoverable after Stripe confirms no transfer exists.
-- This RPC does not make Stripe calls and must not be invoked on a timeout alone.
create or replace function public.action_creator_release_failed_transfer(
  p_intent_id uuid, p_failure_ref text
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_intent public.action_creator_payout_intents%rowtype;
begin
  if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
  if p_failure_ref is null or length(trim(p_failure_ref)) < 8 then
    raise exception 'Stripe verification reference required';
  end if;
  select * into v_intent from public.action_creator_payout_intents
    where id=p_intent_id for update;
  if not found then raise exception 'intent not found'; end if;
  if v_intent.state='failed' then return false; end if;
  if v_intent.state not in ('reserved','transferring')
     or v_intent.stripe_transfer_id is not null then
    raise exception 'settled or linked transfer cannot be released';
  end if;
  update public.action_creator_funding
    set reserved_cents=reserved_cents-v_intent.amount_cents,updated_at=now()
    where org_id=v_intent.org_id and mission_id=v_intent.mission_id
      and reserved_cents>=v_intent.amount_cents;
  if not found then raise exception 'reservation mismatch'; end if;
  update public.action_creator_payout_intents
    set state='failed',updated_at=now() where id=v_intent.id;
  insert into public.action_creator_payout_events
    (payout_intent_id,org_id,event_key,event_type,amount_cents,details)
  values (v_intent.id,v_intent.org_id,'failure:'||v_intent.id,
          'transfer.failed',v_intent.amount_cents,
          jsonb_build_object('verification_ref',p_failure_ref));
  return true;
end;
$$;
revoke all on function public.action_creator_release_failed_transfer(uuid,text)
 from public,anon,authenticated;
grant execute on function public.action_creator_release_failed_transfer(uuid,text)
 to service_role;
