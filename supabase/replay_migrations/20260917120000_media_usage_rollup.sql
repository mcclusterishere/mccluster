-- Media spend rollup.
--
-- Every control on media spend is per job: the table-boundary trigger refuses a
-- paid job without a budget and a preflight estimate, but nothing aggregates.
-- Twenty-six separate 37.5c generations each pass their own budget check and
-- collectively drain a funded provider account, and no route could tell an
-- operator that was happening.
--
-- This aggregates the existing media_cost_events ledger. It does not introduce
-- a second cost store, and it deliberately computes nothing the ledger does not
-- already hold: a spend figure an operator reads as "what McCluster spent" must
-- come from the rows the system actually settled.
--
-- Committed = settled actuals, plus reservations still in flight (reserved with
-- neither a released nor an actual event). That is the number that answers
-- "how much of the funded balance is already gone or spoken for".

create or replace function public.media_usage_rollup(
  p_org_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_group_by text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_group text := lower(coalesce(nullif(trim(p_group_by), ''), 'day'));
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_rows jsonb;
  v_totals jsonb;
begin
  if p_org_id is null then
    raise exception using errcode = '22023', message = 'org_id is required';
  end if;
  if v_group not in ('day', 'provider', 'capability', 'model') then
    raise exception using errcode = '22023', message = 'group_by must be day, provider, capability, or model';
  end if;
  if v_to < v_from then
    raise exception using errcode = '22023', message = 'to must not precede from';
  end if;

  -- One row per job, with its ledger events pivoted. Reservation and settlement
  -- are separate events, so a job can hold a reservation that never settled.
  with events as (
    select
      e.job_id,
      max(case when e.event_type = 'reserved' then e.amount_cents end) as reserved_cents,
      max(case when e.event_type = 'released' then e.amount_cents end) as released_cents,
      max(case when e.event_type = 'actual' then e.amount_cents end) as actual_cents
    from public.media_cost_events e
    where e.org_id = p_org_id
      and e.created_at >= v_from
      and e.created_at <= v_to
    group by e.job_id
  ),
  joined as (
    select
      j.id,
      j.provider,
      j.capability,
      j.provider_model_id,
      j.status,
      j.created_at,
      coalesce(ev.reserved_cents, 0) as reserved_cents,
      coalesce(ev.released_cents, 0) as released_cents,
      coalesce(ev.actual_cents, 0) as actual_cents,
      -- A settled job counts its actual. An unsettled, unreleased reservation
      -- is still money committed against the provider balance.
      case
        when ev.actual_cents is not null then ev.actual_cents
        when ev.released_cents is not null then 0
        else coalesce(ev.reserved_cents, 0)
      end as committed_cents,
      (ev.actual_cents is null and ev.released_cents is null and ev.reserved_cents is not null) as in_flight
    from events ev
    join public.media_jobs j on j.id = ev.job_id
    where j.org_id = p_org_id
  ),
  grouped as (
    select
      case v_group
        when 'day' then to_char(date_trunc('day', created_at), 'YYYY-MM-DD')
        when 'provider' then coalesce(provider, 'unknown')
        when 'capability' then coalesce(capability, 'unknown')
        else coalesce(provider_model_id, 'unknown')
      end as key,
      count(*)::int as jobs,
      sum(reserved_cents)::int as reserved_cents,
      sum(released_cents)::int as released_cents,
      sum(actual_cents)::int as actual_cents,
      sum(committed_cents)::int as committed_cents,
      count(*) filter (where in_flight)::int as in_flight_jobs
    from joined
    group by 1
  )
  select coalesce(jsonb_agg(to_jsonb(g) order by g.key desc), '[]'::jsonb) into v_rows from grouped g;

  select jsonb_build_object(
    'jobs', coalesce(count(*), 0)::int,
    'reserved_cents', coalesce(sum(reserved_cents), 0)::int,
    'released_cents', coalesce(sum(released_cents), 0)::int,
    'actual_cents', coalesce(sum(actual_cents), 0)::int,
    'committed_cents', coalesce(sum(committed_cents), 0)::int,
    'in_flight_jobs', coalesce(count(*) filter (where in_flight), 0)::int,
    -- Stated so a reader knows how much of the committed figure is still an
    -- estimate rather than a settled provider charge.
    'unsettled_cents', coalesce(sum(case when in_flight then committed_cents else 0 end), 0)::int
  ) into v_totals from joined;

  return jsonb_build_object(
    'ok', true,
    'org_id', p_org_id,
    'from', v_from,
    'to', v_to,
    'group_by', v_group,
    'totals', v_totals,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) to service_role;

comment on function public.media_usage_rollup(uuid, timestamptz, timestamptz, text) is
  'Aggregates media_cost_events for an org. Committed = settled actuals plus unreleased reservations. Reads the ledger only; invents no figure.';
