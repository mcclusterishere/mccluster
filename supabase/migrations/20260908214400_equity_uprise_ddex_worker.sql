-- DDEX has its own choreography, validation and partner contract. Keep it out of
-- the general repository/government worker so a future ERN validator or DSP-specific
-- transport change cannot affect scholarly distribution.

create or replace function private.eu_claim_external_jobs(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 180
)
returns setof public.eu_jobs
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  return query
  with due as (
    select j.id from public.eu_jobs j
    where j.state in ('queued','retry')
      and j.provider not in ('internal','crossref','openalex','ddex')
      and j.scheduled_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.priority desc, j.scheduled_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,20),100))
  )
  update public.eu_jobs j
     set state='leased', lease_owner=left(coalesce(p_worker,'eu-external-worker'),120),
         lease_until=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,180),1800))),
         attempts=j.attempts+1, updated_at=now()
   from due where j.id=due.id
  returning j.*;
end;$fn$;

create or replace function private.eu_claim_ddex_jobs(
 p_worker text,p_limit integer default 10,p_lease_seconds integer default 300
) returns setof public.eu_jobs
language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 return query
 with due as (
   select id from public.eu_jobs
    where state in ('queued','retry') and provider='ddex' and scheduled_at<=now()
      and (lease_until is null or lease_until<now())
    order by priority desc,scheduled_at,created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
 )
 update public.eu_jobs j set state='leased',lease_owner=left(coalesce(p_worker,'eu-ddex-worker'),120),
   lease_until=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,300),1800))),attempts=j.attempts+1,updated_at=now()
 from due where j.id=due.id returning j.*;
end;$fn$;
revoke all on function private.eu_claim_ddex_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function private.eu_claim_ddex_jobs(text,integer,integer) to service_role;

create or replace function public.eu_claim_ddex_jobs_service(
 p_worker text,p_limit integer default 10,p_lease_seconds integer default 300
) returns setof public.eu_jobs
language sql security definer set search_path=pg_catalog,public,private as $fn$
 select * from private.eu_claim_ddex_jobs(p_worker,p_limit,p_lease_seconds);
$fn$;
revoke all on function public.eu_claim_ddex_jobs_service(text,integer,integer) from public,anon,authenticated;
grant execute on function public.eu_claim_ddex_jobs_service(text,integer,integer) to service_role;
