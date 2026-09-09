-- Durable monitor leasing. A monitor's next_run_at is advanced when claimed so
-- overlapping cron invocations cannot run the same watch twice.

create unique index if not exists eu_monitors_identity_idx
  on public.eu_monitors(org_id,monitor_type,provider,coalesce(initiative_id,'00000000-0000-0000-0000-000000000000'::uuid),name);

create or replace function private.eu_monitor_interval(p_cadence text)
returns interval language sql immutable set search_path=pg_catalog as $$
 select case lower(coalesce(p_cadence,'daily'))
  when 'hourly' then interval '1 hour'
  when '6-hourly' then interval '6 hours'
  when '12-hourly' then interval '12 hours'
  when 'weekly' then interval '7 days'
  else interval '1 day' end;
$$;

create or replace function private.eu_claim_monitors(p_limit integer default 20)
returns setof public.eu_monitors
language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 return query
 with due as (
   select id from public.eu_monitors
   where enabled=true and coalesce(next_run_at,now())<=now()
   order by coalesce(next_run_at,created_at),created_at
   for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
 )
 update public.eu_monitors m set last_run_at=now(),next_run_at=now()+private.eu_monitor_interval(m.cadence),updated_at=now()
 from due where m.id=due.id returning m.*;
end;
$$;
revoke all on function private.eu_claim_monitors(integer) from public,anon,authenticated;
grant execute on function private.eu_claim_monitors(integer) to service_role;

create or replace function public.eu_claim_monitors_service(p_limit integer default 20)
returns setof public.eu_monitors language sql security definer set search_path=pg_catalog,public,private as $$
 select * from private.eu_claim_monitors(p_limit);
$$;
revoke all on function public.eu_claim_monitors_service(integer) from public,anon,authenticated;
grant execute on function public.eu_claim_monitors_service(integer) to service_role;
