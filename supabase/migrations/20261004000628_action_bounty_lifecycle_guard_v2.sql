-- Bounty payout eligibility is a reservation contract, not a mission reward.
-- A mission can still be completed after its bounty reservation expires, but
-- expired money cannot be resurrected by late proof or verification.
create or replace function public.claim_action_bounty(p_bounty_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_muid uuid := public.current_m_uid();
  v_bounty public.action_bounties%rowtype;
  v_mission public.action_missions%rowtype;
  v_campaign_status text;
  v_join jsonb;
  v_assignment uuid;
  v_existing public.action_bounty_claims%rowtype;
  v_funded bigint;
  v_committed bigint;
  v_committed_awards integer;
  v_claim public.action_bounty_claims%rowtype;
  v_eligible boolean := false;
begin
  if v_user is null or v_muid is null then raise exception 'sign in to take a bounty'; end if;

  select * into v_bounty from public.action_bounties where id=p_bounty_id for update;
  if not found or v_bounty.status<>'open' then raise exception 'this bounty is not open'; end if;

  select c.status into v_campaign_status
  from public.action_campaigns c
  where c.id=v_bounty.campaign_id;
  if v_campaign_status is distinct from 'live' then raise exception 'this campaign is not accepting bounty claims'; end if;

  select * into v_mission from public.action_missions where id=v_bounty.mission_id for update;
  if not found or v_mission.status<>'open' then raise exception 'this mission is not open'; end if;

  if v_bounty.eligibility='any_member' then
    v_eligible:=true;
  elsif v_bounty.eligibility='campaign_cohort' then
    select exists(
      select 1
      from public.action_cohort_members cm
      join public.action_cohorts co on co.id=cm.cohort_id
      where cm.m_uid=v_muid and co.campaign_id=v_bounty.campaign_id and co.status='active'
    ) into v_eligible;
  elsif v_bounty.eligibility='staff_assigned' then
    v_eligible:=(select public.eu_is_admin());
  end if;
  if not v_eligible then raise exception 'this bounty is for approved program participants'; end if;

  update public.action_bounty_claims
     set status='expired'
   where bounty_id=v_bounty.id and status='reserved' and expires_at<=now();

  select * into v_existing
  from public.action_bounty_claims
  where bounty_id=v_bounty.id and user_id=v_user
  for update;

  if found and v_existing.status not in ('cancelled','expired','rejected') then
    return jsonb_build_object(
      'claim_id',v_existing.id,'assignment_id',v_existing.assignment_id,
      'status',v_existing.status,'reward_cents',v_existing.reward_cents,
      'expires_at',v_existing.expires_at,'idempotent',true
    );
  end if;
  if found and v_existing.status='rejected' then
    raise exception 'this bounty proof was rejected; choose another open action';
  end if;

  select greatest(0,coalesce(sum(delta_cents),0))::bigint into v_funded
  from public.action_bounty_funding_ledger
  where bounty_id=v_bounty.id and state='verified';

  select coalesce(sum(reward_cents),0)::bigint, count(*)::int
    into v_committed,v_committed_awards
  from public.action_bounty_claims
  where bounty_id=v_bounty.id
    and (
      status in ('submitted','approved','paid')
      or (status='reserved' and expires_at>now())
    );

  if v_committed_awards>=v_bounty.max_awards then raise exception 'all bounty slots are taken'; end if;
  if v_funded-v_committed<v_bounty.reward_cents then raise exception 'this bounty is waiting for funding'; end if;

  v_join:=public.join_action_mission(v_bounty.mission_id);
  v_assignment:=(v_join->>'assignment_id')::uuid;

  if found then
    update public.action_bounty_claims
       set assignment_id=v_assignment,m_uid=v_muid,reward_cents=v_bounty.reward_cents,
           status='reserved',claimed_at=now(),
           expires_at=now()+make_interval(mins=>v_bounty.claim_ttl_minutes),
           submitted_at=null,approved_at=null,paid_at=null,reviewer_m_uid=null,
           review_note=null,payout_provider=null,payout_ref=null
     where id=v_existing.id
     returning * into v_claim;
  else
    insert into public.action_bounty_claims(
      bounty_id,assignment_id,user_id,m_uid,reward_cents,status,expires_at
    ) values(
      v_bounty.id,v_assignment,v_user,v_muid,v_bounty.reward_cents,'reserved',
      now()+make_interval(mins=>v_bounty.claim_ttl_minutes)
    ) returning * into v_claim;
  end if;

  return jsonb_build_object(
    'claim_id',v_claim.id,'assignment_id',v_claim.assignment_id,
    'mission_id',v_bounty.mission_id,'status',v_claim.status,
    'reward_cents',v_claim.reward_cents,'expires_at',v_claim.expires_at
  );
end;
$$;

revoke all on function public.claim_action_bounty(uuid) from public,anon;
grant execute on function public.claim_action_bounty(uuid) to authenticated;

create or replace function public.action_bounty_sync_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status=old.status then return new; end if;

  if new.status='submitted' then
    update public.action_bounty_claims
       set status=case when expires_at>now() then 'submitted' else 'expired' end,
           submitted_at=case when expires_at>now() then coalesce(submitted_at,now()) else submitted_at end
     where assignment_id=new.id and status='reserved';
  elsif new.status='verified' then
    update public.action_bounty_claims
       set status='approved',approved_at=coalesce(approved_at,now())
     where assignment_id=new.id and status='submitted';
  elsif new.status='rejected' then
    update public.action_bounty_claims
       set status='rejected',review_note=coalesce(review_note,'Mission proof was rejected.')
     where assignment_id=new.id and status in ('reserved','submitted');
  elsif new.status='withdrawn' then
    update public.action_bounty_claims
       set status='cancelled',review_note=coalesce(review_note,'Mission was withdrawn.')
     where assignment_id=new.id and status in ('reserved','submitted');
  end if;
  return new;
end;
$$;

revoke all on function public.action_bounty_sync_claim() from public,anon,authenticated;
