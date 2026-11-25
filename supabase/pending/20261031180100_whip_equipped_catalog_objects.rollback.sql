-- Rollback for 20261031180100_whip_equipped_catalog_objects.sql: the nine objects stop being live.
-- (Rows are kept and set archived so any live-room reference to them stays resolvable.)
update public.music_catalog_objects set status='archived', updated_at=now()
 where catalog_key in ('whip-equipped:test-drive','whip-equipped:salvage-title-b-side','whip-equipped:repo-guy-b-side','whip-equipped:hundun-b-side','whip-equipped:towyard-killer','whip-equipped:mr-lock-changer-remix','whip-equipped:lana-b-side','whip-equipped:stand-on-business-b-side','whip-equipped:all-in-the-details');
