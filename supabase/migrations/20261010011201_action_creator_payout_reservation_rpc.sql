-- Only server-side trusted code with service-role authority can call this function.
create or replace function public.action_creator_reserve_payout(
  p_org_id uuid, p_earning_id uuid, p_destination text, p_approver uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  e public.action_clip_earnings%rowtype;
  f public.action_creator_funding%rowtype;
  v_id uuid;
begin
  if current_user not in ('postgres','service_role') then raise exception 'server role required'; end if;
  select * into e from public.action_clip_earnings where id = p_earning_id and org_id = p_org_id for update;
  if not found then raise exception 'earning not found'; end if;
  if e.state <> 'released' or e.hold_until > now() or e.payout_id is not null then
    raise exception 'earning not released or already paid';
  end if;
  if p_destination !~ '^acct_[a-zA-Z0-9]+$' then raise exception 'invalid destination'; end if;
  if not exists (select 1 from public.org_members where org_id=p_org_id and profile_id=p_approver and role='owner') then
    raise exception 'owner approval required';
  end if;
  select * into f from public.action_creator_funding where org_id=p_org_id and mission_id=e.mission_id for update;
  if not found or f.funded_cents - f.reserved_cents - f.spent_cents < e.amount_cents then
    raise exception 'insufficient campaign funding';
  end if;
  insert into public.action_creator_payout_intents
    (org_id,mission_id,earning_id,creator_m_uid,amount_cents,stripe_account_id,idempotency_key,approved_by)
  values (p_org_id,e.mission_id,e.id,e.m_uid,e.amount_cents,p_destination,'mccluster_creator_'||e.id,p_approver)
  returning id into v_id;
  update public.action_creator_funding set reserved_cents=reserved_cents+e.amount_cents,updated_at=now()
    where id=f.id;
  insert into public.action_creator_payout_events(payout_intent_id,org_id,event_key,event_type,amount_cents)
    values(v_id,p_org_id,'reserve:'||v_id,'reserved',e.amount_cents);
  return v_id;
end $$;
revoke all on function public.action_creator_reserve_payout(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.action_creator_reserve_payout(uuid,uuid,text,uuid) to service_role;