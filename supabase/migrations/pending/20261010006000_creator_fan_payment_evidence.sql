-- Staged payment evidence journal for fan gifts and qualification.
-- Never call from a browser. Trusted webhook verifies Stripe signature and
-- retrieves current payment state before invoking a service-only RPC.
create table if not exists public.creator_fan_purchase_evidence(
 stripe_payment_intent_id text primary key check(stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 purchaser_user_id uuid not null references auth.users(id),
 creator_user_id uuid not null references auth.users(id),
 amount_cents bigint not null check(amount_cents>0),
 currency text not null check(currency='usd'),
 payment_state text not null check(payment_state in ('settled','refunded','disputed','held')),
 provider_event_id text not null,
 provider_event_created bigint not null,
 updated_at timestamptz not null default now(),
 check(purchaser_user_id<>creator_user_id)
);
create unique index if not exists creator_fan_purchase_event_idx on public.creator_fan_purchase_evidence(provider_event_id);
alter table public.creator_fan_purchase_evidence enable row level security;
alter table public.creator_fan_purchase_evidence force row level security;
revoke all on public.creator_fan_purchase_evidence from public,anon,authenticated;
grant all on public.creator_fan_purchase_evidence to service_role;
create or replace function public.creator_fan_record_payment(
 p_intent text,p_buyer uuid,p_creator uuid,p_amount bigint,p_state text,p_event text,p_created bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_current record;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'Service role required'; end if;
 if p_state not in ('settled','refunded','disputed','held') then raise exception 'Invalid payment state'; end if;
 if p_intent !~ '^pi_[A-Za-z0-9]+$' or p_amount<=0 or p_buyer=p_creator
 then raise exception 'Invalid purchase evidence'; end if;
 select * into v_current from public.creator_fan_purchase_evidence
 where stripe_payment_intent_id=p_intent for update;
 if found and p_created<v_current.provider_event_created then return false; end if;
 if found and p_created=v_current.provider_event_created then
  if p_event=v_current.provider_event_id then return false; end if;
  raise exception 'Conflicting same-time payment event';
 end if;
 insert into public.creator_fan_purchase_evidence
 (stripe_payment_intent_id,purchaser_user_id,creator_user_id,amount_cents,currency,payment_state,provider_event_id,provider_event_created)
 values(p_intent,p_buyer,p_creator,p_amount,'usd',p_state,p_event,p_created)
 on conflict(stripe_payment_intent_id) do update set
 payment_state=excluded.payment_state,provider_event_id=excluded.provider_event_id,
 provider_event_created=excluded.provider_event_created,updated_at=now();
 if p_state='settled' then
  insert into public.creator_superuser_status(user_id,status,qualifying_order_reference)
  values(p_buyer,'qualified',p_intent)
  on conflict(user_id) do update set
    status='qualified',qualifying_order_reference=excluded.qualifying_order_reference,last_verified_at=now();
 elsif exists(select 1 from public.creator_superuser_status
  where user_id=p_buyer and qualifying_order_reference=p_intent) then
  update public.creator_superuser_status set status='held',last_verified_at=now() where user_id=p_buyer;
  update public.creator_superuser_rewards set state='held'
   where beneficiary_user_id=p_buyer and qualifying_order_reference=p_intent and state='reserved';
 end if;
 return true;
end $$;
revoke all on function public.creator_fan_record_payment(text,uuid,uuid,bigint,text,text,bigint) from public,anon,authenticated;
grant execute on function public.creator_fan_record_payment(text,uuid,uuid,bigint,text,text,bigint) to service_role;
-- A later verified purchase must not requalify a permanently banned account;
-- add explicit risk status before enabling production rewards.
