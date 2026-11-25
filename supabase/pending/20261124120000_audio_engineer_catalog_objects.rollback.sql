-- Rollback for 20261124120000_audio_engineer_catalog_objects.sql: the album's objects stop being live.
-- (Rows are kept and set archived so any live-room reference to them stays resolvable.)
update public.music_catalog_objects set status='archived', updated_at=now()
 where catalog_key in ('audio-engineer:outta-tune','audio-engineer:studio-trapped','audio-engineer:sound-trust-anthem','audio-engineer:trackout');
