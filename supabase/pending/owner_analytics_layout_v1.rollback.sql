-- Non-destructive rollback: stop callers first, revoke RPCs, preserve all evidence.
begin;
revoke all on function public.owner_analytics_layout_read_v1(uuid),public.owner_analytics_layout_save_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
