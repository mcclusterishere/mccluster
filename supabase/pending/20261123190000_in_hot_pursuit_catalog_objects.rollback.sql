-- Rollback for 20261123190000_in_hot_pursuit_catalog_objects.sql: the album's objects stop being live.
-- (Rows are kept and set archived so any live-room reference to them stays resolvable.)
update public.music_catalog_objects set status='archived', updated_at=now()
 where catalog_key in ('in-hot-pursuit:hitshake','in-hot-pursuit:hitlist','in-hot-pursuit:hit-mode','in-hot-pursuit:see-me-up','in-hot-pursuit:other-side','in-hot-pursuit:new-phone','in-hot-pursuit:block-so-hot','in-hot-pursuit:up-for-days');
