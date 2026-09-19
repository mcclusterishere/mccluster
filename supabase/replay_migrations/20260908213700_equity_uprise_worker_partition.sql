-- Partition durable Equity Uprise jobs by worker class.
-- The core worker owns deterministic internal/Crossref/OpenAlex work.
-- The external worker owns repositories, ORCID, government and music adapters.
-- This prevents two Edge Functions from racing for the same queued job.

create or replace function private.eu_claim_jobs(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns setof public.eu_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return query
  with due as (
    select j.id from public.eu_jobs j
    where j.state in ('queued','retry')
      and j.provider in ('internal','crossref','openalex')
      and j.scheduled_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.priority desc, j.scheduled_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,20),100))
  )
  update public.eu_jobs j
     set state='leased', lease_owner=left(coalesce(p_worker,'eu-core-worker'),120),
         lease_until=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),1800))),
         attempts=j.attempts+1, updated_at=now()
   from due where j.id=due.id
  returning j.*;
end;
$$;
revoke all on function private.eu_claim_jobs(text,integer,integer) from public, anon, authenticated;
grant execute on function private.eu_claim_jobs(text,integer,integer) to service_role;

create or replace function private.eu_claim_external_jobs(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 180
)
returns setof public.eu_jobs
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return query
  with due as (
    select j.id from public.eu_jobs j
    where j.state in ('queued','retry')
      and j.provider not in ('internal','crossref','openalex')
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
end;
$$;
revoke all on function private.eu_claim_external_jobs(text,integer,integer) from public, anon, authenticated;
grant execute on function private.eu_claim_external_jobs(text,integer,integer) to service_role;

create or replace function public.eu_claim_external_jobs_service(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 180
)
returns setof public.eu_jobs
language sql security definer set search_path = pg_catalog, public, private as $$
  select * from private.eu_claim_external_jobs(p_worker,p_limit,p_lease_seconds);
$$;
revoke all on function public.eu_claim_external_jobs_service(text,integer,integer) from public, anon, authenticated;
grant execute on function public.eu_claim_external_jobs_service(text,integer,integer) to service_role;
