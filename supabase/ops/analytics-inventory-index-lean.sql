-- Run as its OWN non-transactional production statement before the Step 4 migration.
create index concurrently if not exists events_lean_first_party_inventory_v1_idx
  on public.events_lean (name, at desc)
  where site_id is null;
