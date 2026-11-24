-- The owner's credit rules of 2026-11-24, carried to the three live catalog rows that state something else.
-- public.music_catalog_objects.artist_name and credit_line are shown wherever the plane names a song (the live
-- discovery lookups in workers/mccluster/src/platform-api.js, the Control Room's clipping and direct-sales desks,
-- supabase/functions/music-direct-access). The rows were seeded on 2026-10-03
-- (supabase/migrations/20261003233747_action_network_live_governance_v1.sql) before these rules:
--   "Upset" is a Hitman Benji song (Hitman Benji x Raheem x Rahndrx), and its row names McCluster as the artist;
--   Environmental Injustice is produced by McCluster, and the Brave mix (the GA edition) by Zakir Elhajoui and
--   McCluster, and neither row's credit line says so.
-- Each statement changes a row only while it still holds the seeded words, so a row somebody corrected by hand
-- is left alone and applying this twice changes nothing.
-- PENDING: apply with the release of data/albums.json that carries the same credits.
-- Rollback: 20261124130000_music_catalog_owner_credits.rollback.sql
update public.music_catalog_objects
   set artist_name='Hitman Benji × Raheem × Rahndrx', updated_at=now()
 where catalog_key='singles:upset' and artist_name='McCluster';
update public.music_catalog_objects
   set credit_line='McCluster ft. Angel Kastro & Ocho · the Equity Uprise anthem · Produced by McCluster', updated_at=now()
 where catalog_key='equity-uprise:environmental-injustice' and credit_line='McCluster ft. Angel Kastro & Ocho';
update public.music_catalog_objects
   set credit_line='McCluster ft. Angel Kastro & Ocho · the GA edition · Produced by Zakir Elhajoui & McCluster', updated_at=now()
 where catalog_key='equity-uprise:environmental-injustice-brave-mix' and credit_line='McCluster ft. Angel Kastro & Ocho · the GA edition';
