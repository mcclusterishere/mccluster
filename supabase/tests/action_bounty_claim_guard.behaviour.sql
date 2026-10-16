begin;
insert into public.action_campaigns values('10000000-0000-0000-0000-000000000001','live');
insert into public.action_missions values('20000000-0000-0000-0000-000000000001','open');
insert into public.action_bounties values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','open','any_member',1,500,60);
insert into public.action_bounty_funding_ledger values('30000000-0000-0000-0000-000000000001',500,'verified');
do $$
declare first_claim jsonb; again jsonb; reclaimed jsonb; n int;
begin
  first_claim := public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
  if first_claim->>'claim_id' is null or first_claim->>'status' <> 'reserved' then
    raise exception 'a funded first claim must INSERT a reservation';
  end if;
  select count(*) into n from public.action_bounty_claims;
  if n<>1 then raise exception 'first claim must persist exactly one row'; end if;
  again := public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
  if again->>'claim_id' is distinct from first_claim->>'claim_id' or again->>'idempotent'<>'true' then
    raise exception 'repeat claim must return the same reservation';
  end if;
  update public.action_bounty_claims set status='cancelled';
  reclaimed := public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
  if reclaimed->>'claim_id' is distinct from first_claim->>'claim_id' or reclaimed->>'status'<>'reserved' then
    raise exception 'cancelled claim must reuse its existing row';
  end if;
  update public.action_bounty_claims set expires_at=now()-interval '1 minute';
  reclaimed := public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
  if reclaimed->>'claim_id' is distinct from first_claim->>'claim_id' then raise exception 'expired claim must reuse its row'; end if;
  update public.action_bounty_claims set status='rejected';
  begin
    perform public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
    raise exception 'REJECTION_GUARD_MISSING';
  exception when others then
    if sqlerrm not like '%proof was rejected%' then raise; end if;
  end;
  delete from public.action_bounty_claims;
  delete from public.action_bounty_funding_ledger;
  begin
    perform public.claim_action_bounty('30000000-0000-0000-0000-000000000001');
    raise exception 'FUNDING_GUARD_MISSING';
  exception when others then
    if sqlerrm not like '%waiting for funding%' then raise; end if;
  end;
  if exists(select 1 from public.action_bounty_claims) then raise exception 'unfunded claim must not persist'; end if;
end $$;
rollback;
