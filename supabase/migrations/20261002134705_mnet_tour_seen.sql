-- The walkthrough remembers that a member has seen it on the server, so it
-- follows them from the web to the app and back. It rides in the existing
-- onboarding row's context; bootstrap already returns that row.
create or replace function public.mnet_mark_tour_seen(p_app_key text default 'mnet-web')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m_uid uuid := public.current_m_uid();
  v_app uuid;
  v_ctx jsonb;
begin
  if auth.uid() is null or v_m_uid is null then raise exception 'sign_in_required'; end if;
  select id into v_app from public.platform_apps where app_key = p_app_key and enabled = true limit 1;
  if v_app is null then raise exception 'unknown_app'; end if;
  update public.mnet_onboarding_state
     set context = coalesce(context, '{}'::jsonb)
                   || jsonb_build_object('tour_done_at', coalesce(context->>'tour_done_at', now()::text))
   where m_uid = v_m_uid and app_id = v_app
  returning context into v_ctx;
  return coalesce(v_ctx, '{}'::jsonb);
end;
$$;

revoke all on function public.mnet_mark_tour_seen(text) from public, anon;
grant execute on function public.mnet_mark_tour_seen(text) to authenticated;
