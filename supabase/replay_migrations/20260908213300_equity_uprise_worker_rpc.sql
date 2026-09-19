-- Service-only RPC wrapper for the Edge Function worker. The implementation
-- stays in private; PostgREST exposes only this narrow function and only to service_role.
create or replace function public.eu_claim_jobs_service(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns setof public.eu_jobs
language sql security definer set search_path = pg_catalog, public, private as $$
  select * from private.eu_claim_jobs(p_worker, p_limit, p_lease_seconds);
$$;
revoke all on function public.eu_claim_jobs_service(text,integer,integer) from public, anon, authenticated;
grant execute on function public.eu_claim_jobs_service(text,integer,integer) to service_role;
