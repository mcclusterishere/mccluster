create or replace function public.api_enforce_billing_limits(
  p_consumer_id uuid,
  p_requested_units bigint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_consumer public.api_consumers%rowtype;
  v_plan public.api_plans%rowtype;
  v_sub public.api_subscriptions%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_monthly_limit bigint;
  v_used bigint := 0;
  v_projected bigint := 0;
  v_overage_units bigint := 0;
  v_overage_cents bigint := 0;
  v_allow_overage boolean := false;
begin
  if p_requested_units is null or p_requested_units <= 0 then
    raise exception 'requested units must be positive';
  end if;

  select * into v_consumer
  from public.api_consumers
  where id = p_consumer_id
  for update;

  if not found or v_consumer.status <> 'active' then
    raise exception 'consumer is not active';
  end if;

  select * into v_plan
  from public.api_plans
  where plan_code = v_consumer.plan_code
    and enabled = true;

  if not found then
    raise exception 'consumer plan is unavailable';
  end if;

  select * into v_sub
  from public.api_subscriptions
  where consumer_id = p_consumer_id
    and status in ('active','trialing')
    and (current_period_start is null or current_period_start <= now())
    and (current_period_end is null or current_period_end > now())
  order by created_at desc
  limit 1;

  if v_consumer.plan_code <> 'developer' and not found then
    raise exception 'active subscription required for paid plan';
  end if;

  if found and v_sub.current_period_start is not null and v_sub.current_period_end is not null then
    v_period_start := v_sub.current_period_start;
    v_period_end := v_sub.current_period_end;
  else
    v_period_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
    v_period_end := v_period_start + interval '1 month';
  end if;

  v_monthly_limit := coalesce(v_consumer.monthly_credit_limit, v_plan.monthly_credits, 0);
  if v_monthly_limit < 0 then
    raise exception 'invalid monthly credit limit';
  end if;

  select
    coalesce((
      select sum(case when r.status = 'settled' then coalesce(r.settled_units,0)
                      when r.status = 'reserved' then r.reserved_units
                      else 0 end)
      from public.api_usage_reservations r
      where r.consumer_id = p_consumer_id
        and r.created_at >= v_period_start
        and r.created_at < v_period_end
    ),0)
    +
    coalesce((
      select sum(case when c.status = 'settled' then coalesce(c.settled_credits,0)
                      when c.status = 'reserved' then c.reserved_credits
                      else 0 end)
      from public.compute_credit_reservations c
      where c.consumer_id = p_consumer_id
        and c.created_at >= v_period_start
        and c.created_at < v_period_end
    ),0)
  into v_used;

  v_projected := v_used + p_requested_units;

  if v_projected <= v_monthly_limit then
    return;
  end if;

  v_allow_overage := lower(coalesce(v_consumer.settings->>'allow_overage','false')) in ('true','1','yes','on');
  if not v_allow_overage then
    raise exception 'monthly credit allowance exceeded and overage is disabled';
  end if;

  if v_plan.overage_price_per_1000_credits_cents is null
     or v_plan.overage_price_per_1000_credits_cents <= 0 then
    raise exception 'overage pricing is not configured for this plan';
  end if;

  v_overage_units := greatest(0, v_projected - v_monthly_limit);
  v_overage_cents := ceil((v_overage_units::numeric * v_plan.overage_price_per_1000_credits_cents::numeric) / 1000.0)::bigint;

  if v_consumer.hard_spend_limit_cents is not null
     and v_overage_cents > v_consumer.hard_spend_limit_cents then
    raise exception 'hard spend limit exceeded';
  end if;
end;
$function$;

revoke execute on function public.api_enforce_billing_limits(uuid,bigint) from public, anon, authenticated;
grant execute on function public.api_enforce_billing_limits(uuid,bigint) to service_role;

create or replace function public.api_usage_reservation_billing_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.api_enforce_billing_limits(new.consumer_id, new.reserved_units);
  return new;
end;
$function$;

create or replace function public.compute_credit_reservation_billing_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.api_enforce_billing_limits(new.consumer_id, new.reserved_credits);
  return new;
end;
$function$;

revoke execute on function public.api_usage_reservation_billing_guard() from public, anon, authenticated;
revoke execute on function public.compute_credit_reservation_billing_guard() from public, anon, authenticated;

drop trigger if exists api_usage_reservation_billing_guard_trg on public.api_usage_reservations;
create trigger api_usage_reservation_billing_guard_trg
before insert on public.api_usage_reservations
for each row execute function public.api_usage_reservation_billing_guard();

drop trigger if exists compute_credit_reservation_billing_guard_trg on public.compute_credit_reservations;
create trigger compute_credit_reservation_billing_guard_trg
before insert on public.compute_credit_reservations
for each row execute function public.compute_credit_reservation_billing_guard();

create or replace function public.api_billing_snapshot(p_consumer_id uuid)
returns table(
  plan_code text,
  period_start timestamptz,
  period_end timestamptz,
  included_credits bigint,
  used_credits bigint,
  remaining_included_credits bigint,
  overage_enabled boolean,
  overage_price_per_1000_credits_cents integer,
  hard_spend_limit_cents bigint,
  projected_overage_spend_cents bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_consumer public.api_consumers%rowtype;
  v_plan public.api_plans%rowtype;
  v_sub public.api_subscriptions%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_limit bigint;
  v_used bigint;
  v_allow boolean;
  v_overage bigint;
begin
  select * into v_consumer from public.api_consumers where id=p_consumer_id;
  if not found then raise exception 'consumer not found'; end if;
  select * into v_plan from public.api_plans where api_plans.plan_code=v_consumer.plan_code;
  if not found then raise exception 'plan not found'; end if;
  select * into v_sub from public.api_subscriptions
   where consumer_id=p_consumer_id and status in ('active','trialing')
     and (current_period_start is null or current_period_start <= now())
     and (current_period_end is null or current_period_end > now())
   order by created_at desc limit 1;
  if found and v_sub.current_period_start is not null and v_sub.current_period_end is not null then
    v_start:=v_sub.current_period_start; v_end:=v_sub.current_period_end;
  else
    v_start:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
    v_end:=v_start+interval '1 month';
  end if;
  v_limit:=coalesce(v_consumer.monthly_credit_limit,v_plan.monthly_credits,0);
  select coalesce((select sum(case when status='settled' then coalesce(settled_units,0) when status='reserved' then reserved_units else 0 end) from public.api_usage_reservations where consumer_id=p_consumer_id and created_at>=v_start and created_at<v_end),0)
       + coalesce((select sum(case when status='settled' then coalesce(settled_credits,0) when status='reserved' then reserved_credits else 0 end) from public.compute_credit_reservations where consumer_id=p_consumer_id and created_at>=v_start and created_at<v_end),0)
    into v_used;
  v_allow:=lower(coalesce(v_consumer.settings->>'allow_overage','false')) in ('true','1','yes','on');
  v_overage:=greatest(0,v_used-v_limit);
  return query select v_consumer.plan_code,v_start,v_end,v_limit,v_used,greatest(0,v_limit-v_used),v_allow,v_plan.overage_price_per_1000_credits_cents,v_consumer.hard_spend_limit_cents,
    case when v_plan.overage_price_per_1000_credits_cents is null then 0 else ceil((v_overage::numeric*v_plan.overage_price_per_1000_credits_cents::numeric)/1000.0)::bigint end;
end;
$function$;

revoke execute on function public.api_billing_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.api_billing_snapshot(uuid) to service_role;
