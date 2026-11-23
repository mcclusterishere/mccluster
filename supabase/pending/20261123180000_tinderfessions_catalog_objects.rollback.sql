-- Rollback for 20261123180000_tinderfessions_catalog_objects.sql: the album's objects stop being live.
-- (Rows are kept and set archived so any live-room reference to them stays resolvable.)
update public.music_catalog_objects set status='archived', updated_at=now()
 where catalog_key in ('tinderfessions:rolling-with-me','tinderfessions:tinderella','tinderfessions:alquifina-new-chick','tinderfessions:bussin-juggs','tinderfessions:one-gon-ride-feat-jiddy','tinderfessions:recipe','tinderfessions:spell','tinderfessions:fire','tinderfessions:promises','tinderfessions:drunk-driving','tinderfessions:no-friend','tinderfessions:numb');
