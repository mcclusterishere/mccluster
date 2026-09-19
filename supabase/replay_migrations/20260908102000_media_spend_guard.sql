-- Defense in depth for paid media generation.
-- The Worker uses the service role, so RLS alone is not an authorization boundary.
-- Enforce spend authorization and finite preflight budgeting at the table boundary.

create or replace function public.enforce_media_job_spend_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget_text text;
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

  return new;
end;
$$;

revoke all on function public.enforce_media_job_spend_guard() from public;

DROP TRIGGER IF EXISTS media_job_spend_guard ON public.media_jobs;
CREATE TRIGGER media_job_spend_guard
BEFORE INSERT ON public.media_jobs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_media_job_spend_guard();
