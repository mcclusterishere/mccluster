-- Containment rollback: disable the new authoring/export RPCs, retain all
-- protected history and the public projection guard. Never restore the unsafe
-- embedded JSON history or drop private revisions. Re-applying the reviewed
-- forward patch restores the grants without erasing data. Review-only.
begin;
revoke execute on function public.music_lyrics_get(uuid,uuid) from service_role;
revoke execute on function public.music_lyrics_save(uuid,uuid,jsonb,boolean,timestamptz,bigint,text) from service_role;
revoke execute on function public.music_lyrics_export(uuid,uuid,bigint,text) from service_role;
commit;
