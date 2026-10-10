-- Creator billing is fail-closed until this migration and Stripe configuration are deployed.
create table if not exists public.creator_billing_subscriptions (
 stripe_subscription_id text primary key check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
 stripe_customer_id text not null,
 owner_user_id uuid not null references auth.users(id),
 stripe_price_id text not null,
 status text not null,
 current_period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 org_id uuid unique references public.orgs(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.creator_billing_events (
 stripe_event_id text primary key,
 stripe_event_type text not null,
 stripe_event_created bigint not null,
 processed_at timestamptz not null default now()
);
alter table public.creator_billing_subscriptions enable row level security;
alter table public.creator_billing_events enable row level security;
revoke all on public.creator_billing_subscriptions,public.creator_billing_events from public,anon,authenticated;
-- The Worker calls this only with its service-role key, after verifying Stripe's signature
-- and retrieving the subscription from Stripe. The function also requires service_role.
create or replace function public.creator_billing_apply_stripe_event(
 p_event_id text,p_event_type text,p_event_created bigint,p_subscription jsonb
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_id text:=p_subscription->>'id';
 v_owner uuid;
 v_customer text:=p_subscription->>'customer';
 v_price text:=p_subscription->>'price';
 v_status text:=p_subscription->>'status';
 v_org uuid;
 v_existing public.creator_billing_subscriptions%rowtype;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_event_id !~ '^evt_[A-Za-z0-9]+$' or v_id !~ '^sub_[A-Za-z0-9]+$' then raise exception 'invalid Stripe identifiers'; end if;
 if v_customer is null or v_price is null or v_status not in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused') then raise exception 'invalid subscription'; end if;
 v_owner:=(p_subscription->>'owner')::uuid;
 if not exists(select 1 from auth.users where id=v_owner) then raise exception 'owner not found'; end if;
 -- Serialize events for a subscription even when different Stripe event IDs race.
 perform pg_advisory_xact_lock(hashtextextended(v_id,0));
 if exists(select 1 from public.creator_billing_events where stripe_event_id=p_event_id) then return; end if;
 select * into v_existing from public.creator_billing_subscriptions where stripe_subscription_id=v_id for update;
 if found and (v_existing.owner_user_id<>v_owner or v_existing.stripe_customer_id<>v_customer) then
   raise exception 'subscription owner or customer mismatch';
 end if;
 v_org:=v_existing.org_id;
 -- Never provision from a pending, unpaid, canceled, or failed subscription.
 if v_org is null and v_status='active' then
   insert into public.orgs(slug,name,kind)
   values ('creator-'||replace(v_owner::text,'-','')||'-'||substr(md5(v_id),1,12),'Creator Workspace','studio')
   on conflict(slug) do update set slug=excluded.slug
   returning id into v_org;
   insert into public.org_members(org_id,profile_id,role) values(v_org,v_owner,'owner')
   on conflict(org_id,profile_id) do nothing;
 end if;
 insert into public.creator_billing_subscriptions
 (stripe_subscription_id,stripe_customer_id,owner_user_id,stripe_price_id,status,current_period_end,cancel_at_period_end,org_id,updated_at)
 values(v_id,v_customer,v_owner,v_price,v_status,
   case when p_subscription->>'current_period_end' is not null then to_timestamp((p_subscription->>'current_period_end')::bigint) end,
   coalesce((p_subscription->>'cancel_at_period_end')::boolean,false),v_org,now())
 on conflict(stripe_subscription_id) do update set
 stripe_price_id=excluded.stripe_price_id,status=excluded.status,current_period_end=excluded.current_period_end,
 cancel_at_period_end=excluded.cancel_at_period_end,org_id=coalesce(creator_billing_subscriptions.org_id,excluded.org_id),updated_at=now();
 insert into public.creator_billing_events(stripe_event_id,stripe_event_type,stripe_event_created)
 values(p_event_id,p_event_type,p_event_created);
end $$;
revoke all on function public.creator_billing_apply_stripe_event(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.creator_billing_apply_stripe_event(text,text,bigint,jsonb) to service_role;
