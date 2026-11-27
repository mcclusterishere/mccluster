-- Disable the Credential Timeline route before considering rollback.
-- A nonempty table is retained, even if a saved plan has no goals or items.
begin;
set local lock_timeout = '5s';
lock table public.learning_studio_timelines in access exclusive mode;
do $$
begin
  if exists (select 1 from public.learning_studio_timelines) then
    raise exception 'Timeline records exist; refusing destructive rollback' using errcode = '55000';
  end if;
end $$;
drop function public.learning_studio_save_timeline(uuid, integer, jsonb);
drop table public.learning_studio_timelines;
commit;
