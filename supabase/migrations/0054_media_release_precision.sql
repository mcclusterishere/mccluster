-- Preserve exact microdollar reservations when a provider submission or generation
-- fails. This replaces the v1 release implementation in-place so both the old
-- Worker and the new reconciliation Worker are safe during rollout.

create or replace function public.media_release_cost_reservation(
  p_job_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_reserved public.media_cost_events;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown media job';
  end if;

  select * into v_reserved
  from public.media_cost_events
  where job_id = p_job_id and event_type = 'reserved';

  if found then
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
      v_reserved.org_id,
      p_job_id,
      'released',
      v_reserved.amount_cents,
      v_reserved.amount_usd_micros,
      v_reserved.provider,
      v_job.provider_request_id,
      v_reserved.pricing_snapshot,
      v_reserved.quantity,
      v_reserved.unit,
      v_reserved.unit_price_usd_micros,
      v_reserved.pricing_version,
      'mccluster-release',
      '{}'::jsonb,
      now(),
      now(),
      jsonb_build_object(
        'reason', p_reason,
        'reserved_usd_micros', v_reserved.amount_usd_micros
      )
    )
    on conflict (job_id, event_type) do update
    set amount_cents = excluded.amount_cents,
        amount_usd_micros = excluded.amount_usd_micros,
        provider_request_id = excluded.provider_request_id,
        quantity = excluded.quantity,
        unit = excluded.unit,
        unit_price_usd_micros = excluded.unit_price_usd_micros,
        pricing_version = excluded.pricing_version,
        source = excluded.source,
        raw_provider_usage = excluded.raw_provider_usage,
        occurred_at = excluded.occurred_at,
        reconciled_at = excluded.reconciled_at,
        metadata = excluded.metadata;

    update public.media_jobs
    set routing = coalesce(routing, '{}'::jsonb) || jsonb_build_object(
          'reservation_state', 'released',
          'released_reserve_usd_micros', v_reserved.amount_usd_micros,
          'reservation_released_at', now()
        ),
        updated_at = now()
    where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.media_release_cost_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.media_release_cost_reservation(uuid, text) to service_role;
