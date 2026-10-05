-- Item 8 security re-audit (2026-10-05): execute grants.
--
-- Read against the live advisor and every browser-callable SECURITY DEFINER
-- body, not against the old "84 functions" count. Most of the 131 advisor
-- rows are deliberate RPC contracts that gate on auth.uid() / eu_is_admin()
-- / mnet_is_admin() inside the body. These are the ones that were not.
-- Recorded in docs/control-plane/SECURITY-POSTURE.md.

-- 1. Cross-tenant read. The pre-tenancy kb_search overload searches every
--    org's enabled knowledge base and was executable by anon through PUBLIC.
--    The inbox calls the org-scoped overload (service role only); nothing
--    calls this one.
do $
begin
  -- This pre-tenancy overload exists in production but is intentionally absent
  -- from clean source-controlled resets; harden it when present.
  if to_regprocedure('public.kb_search(text,vector,integer,integer)') is not null then
    execute 'revoke execute on function public.kb_search(text, vector, integer, integer) from public, anon, authenticated';
    execute 'grant execute on function public.kb_search(text, vector, integer, integer) to service_role';
  end if;
end
$;

-- 2. Forgery. mnet_follow_admins(p_m_uid) inserts follows on behalf of any
--    member id it is handed. Its only callers are the network_profiles
--    trigger and mnet_complete_surface_profile, both SECURITY DEFINER, so
--    they run it as the owner.
revoke execute on function public.mnet_follow_admins(uuid) from public, anon, authenticated;
grant execute on function public.mnet_follow_admins(uuid) to service_role;

-- 3. Oracle. mnet_is_blocked_pair(a, b) answered, for any two members,
--    whether either had blocked the other. Only SECURITY DEFINER Mnet
--    functions call it and no RLS policy references it.
revoke execute on function public.mnet_is_blocked_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mnet_is_blocked_pair(uuid, uuid) to service_role;

-- 4. Trigger functions. A trigger fires whatever its function's EXECUTE
--    grant says, so no client needs to call these directly.
revoke execute on function public.mnet_autofollow_on_profile() from public, anon, authenticated;
revoke execute on function public.mnet_notify_message() from public, anon, authenticated;
revoke execute on function public.mnet_touch_conversation() from public, anon, authenticated;
revoke execute on function public.music_creator_guard() from public, anon, authenticated;
revoke execute on function public.music_license_guard() from public, anon, authenticated;
revoke execute on function public.music_track_guard() from public, anon, authenticated;
revoke execute on function public.network_group_recount() from public, anon, authenticated;
revoke execute on function public.site_content_audit() from public, anon, authenticated;
do $
begin
  -- site_requests_touch() is another pre-reconciliation production helper.
  if to_regprocedure('public.site_requests_touch()') is not null then
    execute 'revoke execute on function public.site_requests_touch() from public, anon, authenticated';
  end if;
end
$;

-- 5. Admin-only RPCs. A visitor can never pass mnet_is_admin(); the Worker
--    calls these with the signed-in member's own token.
revoke execute on function public.mnet_admin_remove_post(uuid, text) from public, anon;
revoke execute on function public.mnet_admin_set_pinned(uuid, boolean) from public, anon;
grant execute on function public.mnet_admin_remove_post(uuid, text) to authenticated, service_role;
grant execute on function public.mnet_admin_set_pinned(uuid, boolean) to authenticated, service_role;

-- 6. The two public ranking views stay SECURITY DEFINER on purpose (see
--    20260919150000_track_recommendation_signals): they publish aggregates
--    of owner-only events. They are read-only by construction, so the
--    write grants they inherited are dropped.
revoke all on public.v_track_signals from anon, authenticated;
revoke all on public.v_track_affinity from anon, authenticated;
grant select on public.v_track_signals to anon, authenticated;
grant select on public.v_track_affinity to anon, authenticated;

-- 7. Pin the two mutable search paths the advisor reports.
alter function public.site_requests_touch() set search_path = '';
alter function public.mccluster_id_problem(text) set search_path = '';

