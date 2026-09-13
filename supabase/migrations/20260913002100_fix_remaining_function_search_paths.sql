-- Some helpers are optional across clean installs. Harden only functions present in this schema.

do $do$
begin
  if to_regprocedure('public.compute_credits_for_microusd(bigint)') is not null then
    execute 'alter function public.compute_credits_for_microusd(bigint) set search_path = pg_catalog, public';
  end if;

  if to_regprocedure('public.compute_retail_microusd(bigint,integer)') is not null then
    execute 'alter function public.compute_retail_microusd(bigint, integer) set search_path = pg_catalog, public';
  end if;

  if to_regprocedure('public.normalize_mccluster_id(text)') is not null then
    execute 'alter function public.normalize_mccluster_id(text) set search_path = pg_catalog, public';
  end if;
end
$do$;
