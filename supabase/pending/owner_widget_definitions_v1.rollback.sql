-- Non-destructive rollback: disable entrypoints and trigger; preserve drafts,
-- history and registry values for review/recovery. Never drop owner data.
begin;
revoke all on function public.owner_widget_snapshot_v1(text) from authenticated;
revoke all on function public.owner_widget_edit_v1(text,text,text,text,jsonb,text) from authenticated;
drop trigger if exists owner_widget_history_v1 on public.platform_apps;
commit;
