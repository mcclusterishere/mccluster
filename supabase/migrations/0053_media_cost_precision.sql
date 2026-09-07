-- Precise media cost accounting and provider reconciliation support.
-- Keep the cents columns for compatibility, but make USD microdollars the
-- canonical internal amount so sub-cent model pricing is not lost.

alter table public.media_cost_events add column if not exists amount_usd_micros bigint;
alter table public.media_cost_events add column if not exists quantity numeric;
alter table public.media_cost_events add column if not exists unit text;
alter table public.media_cost_events add column if not exists unit_price_usd_micros bigint;
alter table public.media_cost_events add column if not exists pricing_version text;
alter table public.media_cost_events add column if not exists source text;
alter table public.media_cost_events add column if not exists raw_provider_usage jsonb;
alter table public.media_cost_events add column if not exists occurred_at timestamptz;
alter table public.media_cost_events add column if not exists reconciled_at timestamptz;

update public.media_cost_events
set amount_usd_micros = amount_cents::bigint * 10000
where amount_usd_micros is null;

update public.media_cost_events
set source = coalesce(source, case when event_type = 'actual' then 'legacy-actual' else 'mccluster-estimate' end),
    raw_provider_usage = coalesce(raw_provider_usage, '{}'::jsonb),
    occurred_at = coalesce(occurred_at, created_at)
where source is null or raw_provider_usage is null or occurred_at is null;

create or replace function public.media_cost_events_normalize()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.amount_usd_micros is null and new.amount_cents is not null then
    new.amount_usd_micros := new.amount_cents::bigint * 10000;
  end if;

  if new.amount_cents is null and new.amount_usd_micros is not null then
    new.amount_cents := ((new.amount_usd_micros + 9999) / 10000)::integer;
  end if;

  new.source := coalesce(new.source, 'mccluster-estimate');
  new.raw_provider_usage := coalesce(new.raw_provider_usage, '{}'::jsonb);
  new.occurred_at := coalesce(new.occurred_at, new.created_at, now());
  return new;
end;
$$;

revoke execute on function public.media_cost_events_normalize() from public, anon, authenticated;

drop trigger if exists media_cost_events_normalize_row on public.media_cost_events;
create trigger media_cost_events_normalize_row
before insert or update on public.media_cost_events
for each row execute function public.media_cost_events_normalize();

alter table public.media_cost_events alter column amount_usd_micros set not null;
alter table public.media_cost_events alter column source set default 'mccluster-estimate';
alter table public.media_cost_events alter column source set not null;
alter table public.media_cost_events alter column raw_provider_usage set default '{}'::jsonb;
alter table public.media_cost_events alter column raw_provider_usage set not null;
alter table public.media_cost_events alter column occurred_at set default now();
alter table public.media_cost_events alter column occurred_at set not null;

create or replace function public.media_create_budgeted_job_v2(
  p_org_id uuid,
  p_created_by uuid,
  p_provider text,
  p_provider_model_id text,
  p_capability text,
  p_prompt text,
  p_input jsonb,
  p_routing jsonb,
  p_estimated_cost_usd_micros bigint,
  p_budget_cents integer,
  p_pricing_snapshot jsonb,
  p_estimate jsonb
)
returns public.media_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_budget_usd_micros bigint;
  v_estimated_cost_cents integer;
  v_quantity numeric;
  v_unit_price_usd_micros bigint;
begin
  if p_budget_cents is not null and p_budget_cents < 0 then
    raise exception using errcode = '22023', message = 'budget_cents cannot be negative';
  end if;

  if p_estimated_cost_usd_micros is not null and p_estimated_cost_usd_micros < 0 then
    raise exception using errcode = '22023', message = 'estimated cost cannot be negative';
  end if;

  v_budget_usd_micros := case when p_budget_cents is null then null else p_budget_cents::bigint * 10000 end;

  if v_budget_usd_micros is not null and p_estimated_cost_usd_micros is null then
    raise exception using errcode = '22023', message = 'Budgeted media jobs require a preflight cost estimate';
  end if;

  if v_budget_usd_micros is not null and p_estimated_cost_usd_micros > v_budget_usd_micros then
    raise exception using errcode = '22023', message = format(
      'Estimated media cost (%s microdollars) exceeds budget (%s microdollars)',
      p_estimated_cost_usd_micros,
      v_budget_usd_micros
    );
  end if;

  v_estimated_cost_cents := case
    when p_estimated_cost_usd_micros is null then null
    else ((p_estimated_cost_usd_micros + 9999) / 10000)::integer
  end;

  v_quantity := case
    when jsonb_typeof(coalesce(p_estimate, '{}'::jsonb) -> 'units') = 'number'
      then (p_estimate ->> 'units')::numeric
    else null
  end;

  v_unit_price_usd_micros := case
    when jsonb_typeof(coalesce(p_estimate, '{}'::jsonb) -> 'unit_price_usd_micros') = 'number'
      then (p_estimate ->> 'unit_price_usd_micros')::bigint
    else null
  end;

  insert into public.media_jobs (
    org_id,
    created_by,
    provider,
    provider_model_id,
    capability,
    status,
    prompt,
    input,
    routing,
    estimated_cost_cents
  ) values (
    p_org_id,
    p_created_by,
    p_provider,
    p_provider_model_id,
    p_capability,
    'queued',
    p_prompt,
    coalesce(p_input, '{}'::jsonb),
    coalesce(p_routing, '{}'::jsonb) || jsonb_build_object(
      'budget_cents', p_budget_cents,
      'budget_usd_micros', v_budget_usd_micros,
      'estimated_cost_usd_micros', p_estimated_cost_usd_micros,
      'estimate', coalesce(p_estimate, '{}'::jsonb),
      'pricing_snapshot', coalesce(p_pricing_snapshot, '{}'::jsonb),
      'reservation_state', case when p_estimated_cost_usd_micros is null then 'unmetered' else 'reserved' end
    ),
    v_estimated_cost_cents
  )
  returning * into v_job;

  if p_estimated_cost_usd_micros is not null then
    insert into public.media_cost_events (
      org_id,
      job_id,
      event_type,
      amount_cents,
      amount_usd_micros,
      provider,
      pricing_snapshot,
      quantity,
      unit,
      unit_price_usd_micros,
      pricing_version,
      source,
      raw_provider_usage,
      occurred_at,
      metadata
    ) values (
      p_org_id,
      v_job.id,
      'reserved',
      v_estimated_cost_cents,
      p_estimated_cost_usd_micros,
      p_provider,
      coalesce(p_pricing_snapshot, '{}'::jsonb),
      v_quantity,
      p_estimate ->> 'unit',
      v_unit_price_usd_micros,
      coalesce(p_pricing_snapshot ->> 'verified_at', p_pricing_snapshot ->> 'version'),
      'mccluster-preflight',
      coalesce(p_estimate, '{}'::jsonb),
      now(),
      jsonb_build_object('budget_cents', p_budget_cents, 'budget_usd_micros', v_budget_usd_micros)
    );
  end if;

  return v_job;
end;
$$;

create or replace function public.media_record_actual_cost_v2(
  p_job_id uuid,
  p_actual_cost_usd_micros bigint,
  p_quantity numeric,
  p_unit text,
  p_unit_price_usd_micros bigint,
  p_source text,
  p_raw_provider_usage jsonb,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_reserved public.media_cost_events;
  v_actual_cost_cents integer;
  v_unused_reserve bigint;
  v_overage bigint;
begin
  if p_actual_cost_usd_micros is null or p_actual_cost_usd_micros < 0 then
    raise exception using errcode = '22023', message = 'actual cost must be zero or greater';
  end if;

  if p_unit_price_usd_micros is not null and p_unit_price_usd_micros < 0 then
    raise exception using errcode = '22023', message = 'unit price cannot be negative';
  end if;

  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown media job';
  end if;

  v_actual_cost_cents := ((p_actual_cost_usd_micros + 9999) / 10000)::integer;

  select * into v_reserved
  from public.media_cost_events
  where job_id = p_job_id and event_type = 'reserved';

  v_unused_reserve := case
    when v_reserved.id is null then 0
    else greatest(v_reserved.amount_usd_micros - p_actual_cost_usd_micros, 0)
  end;
  v_overage := case
    when v_reserved.id is null then 0
    else greatest(p_actual_cost_usd_micros - v_reserved.amount_usd_micros, 0)
  end;

  update public.media_jobs
  set actual_cost_cents = v_actual_cost_cents,
      routing = coalesce(routing, '{}'::jsonb) || jsonb_build_object(
        'actual_cost_usd_micros', p_actual_cost_usd_micros,
        'unused_reserve_usd_micros', v_unused_reserve,
        'reserve_overage_usd_micros', v_overage,
        'reservation_state', 'settled',
        'cost_reconciled_at', now()
      ),
      updated_at = now()
  where id = p_job_id;

  insert into public.media_cost_events (
    org_id,
    job_id,
    event_type,
    amount_cents,
    amount_usd_micros,
    provider,
    provider_request_id,
    pricing_snapshot,
    quantity,
    unit,
    unit_price_usd_micros,
    pricing_version,
    source,
    raw_provider_usage,
    occurred_at,
    reconciled_at,
    metadata
  ) values (
    v_job.org_id,
    p_job_id,
    'actual',
    v_actual_cost_cents,
    p_actual_cost_usd_micros,
    v_job.provider,
    v_job.provider_request_id,
    coalesce(v_job.routing -> 'pricing_snapshot', '{}'::jsonb),
    p_quantity,
    p_unit,
    p_unit_price_usd_micros,
    coalesce(v_job.routing -> 'pricing_snapshot' ->> 'verified_at', v_job.routing -> 'pricing_snapshot' ->> 'version'),
    coalesce(p_source, 'provider-billing'),
    coalesce(p_raw_provider_usage, '{}'::jsonb),
    coalesce(p_occurred_at, now()),
    now(),
    jsonb_build_object('unused_reserve_usd_micros', v_unused_reserve, 'reserve_overage_usd_micros', v_overage)
  )
  on conflict (job_id, event_type) do update
  set amount_cents = excluded.amount_cents,
      amount_usd_micros = excluded.amount_usd_micros,
      provider_request_id = excluded.provider_request_id,
      quantity = excluded.quantity,
      unit = excluded.unit,
      unit_price_usd_micros = excluded.unit_price_usd_micros,
      source = excluded.source,
      raw_provider_usage = excluded.raw_provider_usage,
      occurred_at = excluded.occurred_at,
      reconciled_at = now(),
      metadata = excluded.metadata;

  if v_reserved.id is not null then
    insert into public.media_cost_events (
      org_id,
      job_id,
      event_type,
      amount_cents,
      amount_usd_micros,
      provider,
      provider_request_id,
      pricing_snapshot,
      source,
      raw_provider_usage,
      occurred_at,
      reconciled_at,
      metadata
    ) values (
      v_job.org_id,
      p_job_id,
      'released',
      ((v_unused_reserve + 9999) / 10000)::integer,
      v_unused_reserve,
      v_job.provider,
      v_job.provider_request_id,
      v_reserved.pricing_snapshot,
      'mccluster-reconciliation',
      coalesce(p_raw_provider_usage, '{}'::jsonb),
      now(),
      now(),
      jsonb_build_object(
        'reason', 'unused reserve after provider reconciliation',
        'reserved_usd_micros', v_reserved.amount_usd_micros,
        'actual_usd_micros', p_actual_cost_usd_micros,
        'overage_usd_micros', v_overage
      )
    )
    on conflict (job_id, event_type) do update
    set amount_cents = excluded.amount_cents,
        amount_usd_micros = excluded.amount_usd_micros,
        provider_request_id = excluded.provider_request_id,
        source = excluded.source,
        raw_provider_usage = excluded.raw_provider_usage,
        reconciled_at = now(),
        metadata = excluded.metadata;
  end if;
end;
$$;

revoke all on function public.media_create_budgeted_job_v2(uuid, uuid, text, text, text, text, jsonb, jsonb, bigint, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.media_record_actual_cost_v2(uuid, bigint, numeric, text, bigint, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.media_create_budgeted_job_v2(uuid, uuid, text, text, text, text, jsonb, jsonb, bigint, integer, jsonb, jsonb) to service_role;
grant execute on function public.media_record_actual_cost_v2(uuid, bigint, numeric, text, bigint, text, jsonb, timestamptz) to service_role;
