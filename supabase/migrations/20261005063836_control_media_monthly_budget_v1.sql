create table if not exists public.org_media_budgets (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  enabled boolean not null default false,
  monthly_limit_cents bigint,
  warn_at_percent integer not null default 80,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_media_budgets_limit_nonnegative
    check (monthly_limit_cents is null or monthly_limit_cents >= 0),
  constraint org_media_budgets_warn_range
    check (warn_at_percent between 1 and 100)
);

alter table public.org_media_budgets enable row level security;
alter table public.org_media_budgets force row level security;

revoke all on table public.org_media_budgets from public;
revoke all on table public.org_media_budgets from anon;
revoke all on table public.org_media_budgets from authenticated;
grant select, insert, update on table public.org_media_budgets to service_role;

create or replace function public.enforce_media_job_spend_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget_text text;
  v_monthly_limit bigint;
  v_monthly_committed bigint := 0;
begin
  if new.provider <> 'fal' then
    return new;
  end if;

  if new.created_by is null then
    raise exception using errcode = '42501', message = 'Paid media jobs require an authenticated creator';
  end if;

  if not exists (
    select 1
    from public.org_members m
    where m.org_id = new.org_id
      and m.profile_id = new.created_by
      and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Organization owner access is required to spend on media generation';
  end if;

  v_budget_text := new.routing ->> 'budget_cents';
  if v_budget_text is null or v_budget_text = 'null' then
    raise exception using errcode = '22023', message = 'budget_cents is required for paid media generation';
  end if;

  if new.estimated_cost_cents is null then
    raise exception using errcode = '22023', message = 'Paid media generation requires a preflight cost estimate';
  end if;

  if new.estimated_cost_cents > v_budget_text::integer then
    raise exception using errcode = '22023', message = 'Estimated media cost exceeds the approved budget';
  end if;

  select b.monthly_limit_cents
    into v_monthly_limit
  from public.org_media_budgets b
  where b.org_id = new.org_id
    and b.enabled
    and b.monthly_limit_cents is not null
  for update;

  if v_monthly_limit is not null then
    select coalesce(sum(coalesce(j.actual_cost_cents, j.estimated_cost_cents, 0)), 0)::bigint
      into v_monthly_committed
    from public.media_jobs j
    where j.org_id = new.org_id
      and j.provider = 'fal'
      and j.created_at >= date_trunc('month', now())
      and j.status not in ('failed', 'cancelled');

    if v_monthly_committed + new.estimated_cost_cents > v_monthly_limit then
      raise exception using
        errcode = '22023',
        message = 'Organization monthly media allowance exceeded',
        detail = format(
          'committed=%s cents, next=%s cents, limit=%s cents',
          v_monthly_committed,
          new.estimated_cost_cents,
          v_monthly_limit
        );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_media_job_spend_guard() from public;

drop trigger if exists media_job_spend_guard on public.media_jobs;
create trigger media_job_spend_guard
before insert on public.media_jobs
for each row
execute function public.enforce_media_job_spend_guard();

comment on table public.org_media_budgets is
  'Owner-configured aggregate monthly allowance for paid media generation. Direct browser roles have no access; the Worker mediates reads and writes.';
