-- Lock down SECURITY DEFINER helpers that are implementation details rather than public RPC contracts.
-- Clean resets may not include every optional helper, so harden only functions that exist.

do $do$
begin
  if to_regprocedure('public.eu_log(text,text,text,jsonb)') is not null then
    execute 'revoke execute on function public.eu_log(text,text,text,jsonb) from public, anon, authenticated';
    execute 'grant execute on function public.eu_log(text,text,text,jsonb) to service_role';
  end if;

  if to_regprocedure('public.mccluster_is_house_owner()') is not null then
    execute 'revoke execute on function public.mccluster_is_house_owner() from public, anon, authenticated';
    execute 'grant execute on function public.mccluster_is_house_owner() to service_role';
  end if;

  if to_regprocedure('public.l3_is_owner()') is not null then
    execute 'revoke execute on function public.l3_is_owner() from public, anon, authenticated';
    execute 'grant execute on function public.l3_is_owner() to service_role';
  end if;
end
$do$;
