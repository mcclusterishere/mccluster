-- Lock down SECURITY DEFINER helpers that are implementation details rather than public RPC contracts.
-- Keep caller-facing RPCs and predicates required by RLS policies unchanged.

-- Internal audit writer: callers should not be able to fabricate arbitrary audit actions/details.
revoke execute on function public.eu_log(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.eu_log(text,text,text,jsonb) to service_role;

-- Internal authority predicate. Higher-level SECURITY DEFINER predicates such as eu_is_admin()
-- may call this as the function owner; clients do not need direct execution rights.
revoke execute on function public.mccluster_is_house_owner() from public, anon, authenticated;
grant execute on function public.mccluster_is_house_owner() to service_role;

-- Internal Level 3 authorization helper. RLS uses l3_is_staff()/l3_org_id();
-- owner-only mutation RPCs call this helper under SECURITY DEFINER.
revoke execute on function public.l3_is_owner() from public, anon, authenticated;
grant execute on function public.l3_is_owner() to service_role;
