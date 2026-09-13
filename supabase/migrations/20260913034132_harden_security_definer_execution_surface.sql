-- Close ambient function execution and require explicit RPC grants.
-- Production migration identity: 20260913034132.

-- Future functions are closed by default. Client-facing RPCs must opt in explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

-- Remove ambient PUBLIC execution from every current SECURITY DEFINER function
-- in application-owned exposed/internal schemas. Existing explicit role grants remain.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public','private')
  loop
    execute format('revoke execute on function %s from public', r.fn);
  end loop;
end $$;

-- Trigger-only functions are not RPC endpoints. Trigger execution does not require
-- client EXECUTE privileges, so remove direct client invocation entirely.
revoke execute on function public.enforce_media_job_spend_guard() from anon, authenticated;
revoke execute on function public.ensure_network_profile_for_auth_user() from anon, authenticated;
revoke execute on function public.grant_pending_org_invitations() from anon, authenticated;
revoke execute on function public.platform_assign_mccluster_id() from anon, authenticated;
revoke execute on function public.seed_engagement_modules() from anon, authenticated;

-- Internal ID generator is consumed by the profile trigger; it is not a public RPC.
revoke execute on function public.generate_mccluster_id() from anon, authenticated;

-- These RPCs require a signed-in caller by their own authorization contract.
revoke execute on function public.claim_level3_owner(text,text,text) from anon;
revoke execute on function public.l3_dashboard_summary() from anon;
revoke execute on function public.l3_is_owner() from anon;
revoke execute on function public.l3_is_staff() from anon;
revoke execute on function public.l3_org_id() from anon;
revoke execute on function public.l3_update_store_profile(text,text,text,text,text,boolean) from anon;
revoke execute on function public.set_mccluster_id(text) from anon;

-- Preserve explicit intended client contracts after removing PUBLIC inheritance.
grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function private.is_org_owner(uuid) to anon, authenticated, service_role;
grant execute on function public.current_m_uid() to anon, authenticated, service_role;
grant execute on function public.eu_is_admin() to anon, authenticated, service_role;
grant execute on function public.eu_is_staff() to anon, authenticated, service_role;
grant execute on function public.eu_role() to anon, authenticated, service_role;
grant execute on function public.inbox_is_staff() to anon, authenticated, service_role;
grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to anon, authenticated, service_role;
grant execute on function public.mccluster_is_house_owner() to anon, authenticated, service_role;
grant execute on function public.shake_is_crew() to anon, authenticated, service_role;

-- Intentionally public read-only RPCs.
grant execute on function public.eu_match_fellowships(uuid,integer,text[]) to anon, authenticated, service_role;
grant execute on function public.l3_public_products() to anon, authenticated, service_role;
grant execute on function public.l3_public_storefront() to anon, authenticated, service_role;
grant execute on function public.music_pulse() to anon, authenticated, service_role;
grant execute on function public.play_counts() to anon, authenticated, service_role;

-- Intentionally authenticated RPCs.
grant execute on function public.claim_level3_owner(text,text,text) to authenticated, service_role;
grant execute on function public.eu_log(text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.l3_dashboard_summary() to authenticated, service_role;
grant execute on function public.l3_is_owner() to authenticated, service_role;
grant execute on function public.l3_is_staff() to authenticated, service_role;
grant execute on function public.l3_org_id() to authenticated, service_role;
grant execute on function public.l3_update_store_profile(text,text,text,text,text,boolean) to authenticated, service_role;
grant execute on function public.m_my_identities() to authenticated, service_role;
grant execute on function public.m_my_uid() to authenticated, service_role;
grant execute on function public.m_touch_app(text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function public.mnet_mark_feed_entered(text) to authenticated, service_role;
grant execute on function public.mnet_surface_bootstrap(text) to authenticated, service_role;
grant execute on function public.mnet_surface_feed(text,integer,timestamptz) to authenticated, service_role;
grant execute on function public.set_mccluster_id(text) to authenticated, service_role;
