-- Run as its OWN non-transactional production statement before the Step 4 migration.
-- This avoids blocking collector writes during the index build.
create index concurrently if not exists events_first_party_inventory_v1_idx
  on public.events (name, at desc) include (is_bot)
  where site_id is null;
