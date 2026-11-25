-- Stand-in for public.music_catalog_objects (supabase/migrations/20261003233747_action_network_live_governance_v1.sql),
-- the catalogue music_direct_offers.catalog_key points at. Applied by
-- scripts/test-music-direct-sales-db.sh after supabase_api_roles.stub.sql. Scratch database only.
create table if not exists public.music_catalog_objects(
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique check (catalog_key ~ '^[a-z0-9-]+:[a-z0-9-]+$'),
  album_slug text not null,
  album_title text not null,
  track_title text not null,
  artist_name text not null,
  canonical_url text not null default 'https://matthew.mccluster.org/album.html',
  source_kind text not null default 'site_catalog',
  status text not null default 'active'
);
insert into public.music_catalog_objects(catalog_key, album_slug, album_title, track_title, artist_name) values
  ('here:here', 'here', 'I AM HERE', 'Here', 'McCluster'),
  ('here:antisocial', 'here', 'I AM HERE', 'Antisocial', 'McCluster'),
  ('here:lightroom', 'here', 'I AM HERE', 'Lightroom', 'McCluster')
on conflict (catalog_key) do nothing;
