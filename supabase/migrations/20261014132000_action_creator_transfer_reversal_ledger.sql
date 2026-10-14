-- Record Stripe transfer reversals exactly once and reconcile campaign funding.
-- A reversal returns platform funds but does not cancel a creator's underlying earning.
-- Amounts are cumulative per transfer; Stripe webhook deliveries may be duplicated or reordered.
create table if not exists public.action_creator_transfer_reversal_totals (
  payout_intent_id uuid primary key references public.action_creator_payout_intents(id),
  reversed_cents bigint not null default 0 check (reversed_cents >= 0),
  updated_at timestamptz not null default now()
);
alter table public.action_creator_transfer_reversal_totals enable row level security;
alter table public.action_creator_transfer_reversal_totals force row level security;
revoke all on public.action_creator_transfer_reversal_totals from public, anon, authenticated;

create or replace function public.action_creator_record_stripe_event(
  p_event_id text, p_transfer_id text, p_kind text, p_amount_cents bigint
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  p public.action_creator_payout_intents%rowtype;
  v_prior bigint;
  v_delta bigint;
  v_inserted integer;
begin
  if current_user not in ('postgres','service_role') then raise exception 'server only'; end if;
  if p_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_transfer_id !~ '^tr_[A-Za-z0-9]+$'
     or p_kind not in ('transfer.reversed','payout.paid','payout.failed')
     or p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'invalid event';
  end if;

  select * into p from public.action_creator_payout_intents
   where stripe_transfer_id = p_transfer_id for update;
  if not found then return false; end if;

  insert into public.action_creator_payout_events
    (payout_intent_id,org_id,event_key,event_type,amount_cents)
  values (p.id,p.org_id,p_event_id,p_kind,p_amount_cents)
  on conflict (event_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  if p_kind = 'transfer.reversed' then
    if p.state not in ('transferred','reversed') then
      raise exception 'transfer is not settled';
    end if;
    -- Stripe's transfer.amount_reversed is cumulative, not the delta of this event.
    if p_amount_cents > p.amount_cents then raise exception 'reversal exceeds transfer'; end if;
    insert into public.action_creator_transfer_reversal_totals(payout_intent_id,reversed_cents)
      values(p.id,0) on conflict (payout_intent_id) do nothing;
    select reversed_cents into v_prior from public.action_creator_transfer_reversal_totals
      where payout_intent_id=p.id for update;
    v_delta := greatest(p_amount_cents - v_prior,0);
    if v_delta > 0 then
      update public.action_creator_funding
        set spent_cents = spent_cents - v_delta,
            updated_at = now()
        where org_id=p.org_id and mission_id=p.mission_id
          and spent_cents >= v_delta;
      if not found then raise exception 'funding reversal mismatch'; end if;
      update public.action_creator_transfer_reversal_totals
        set reversed_cents=p_amount_cents, updated_at=now()
        where payout_intent_id=p.id;
    end if;
    if p_amount_cents = p.amount_cents then
      update public.action_creator_payout_intents set state='reversed',updated_at=now()
        where id=p.id and state='transferred';
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.action_creator_record_stripe_event(text,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.action_creator_record_stripe_event(text,text,text,bigint)
  to service_role;
