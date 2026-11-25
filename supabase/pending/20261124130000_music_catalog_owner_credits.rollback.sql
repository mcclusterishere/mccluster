-- Rollback for 20261124130000_music_catalog_owner_credits.sql: the three rows take their seeded words back,
-- each only while it still holds the words that file wrote.
update public.music_catalog_objects
   set artist_name='McCluster', updated_at=now()
 where catalog_key='singles:upset' and artist_name='Hitman Benji × Raheem × Rahndrx';
update public.music_catalog_objects
   set credit_line='McCluster ft. Angel Kastro & Ocho', updated_at=now()
 where catalog_key='equity-uprise:environmental-injustice' and credit_line='McCluster ft. Angel Kastro & Ocho · the Equity Uprise anthem · Produced by McCluster';
update public.music_catalog_objects
   set credit_line='McCluster ft. Angel Kastro & Ocho · the GA edition', updated_at=now()
 where catalog_key='equity-uprise:environmental-injustice-brave-mix' and credit_line='McCluster ft. Angel Kastro & Ocho · the GA edition · Produced by Zakir Elhajoui & McCluster';
