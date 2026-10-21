-- THE GLOBE'S FIRST PINS (owner, 2026-10-15: "we need to have it populated
-- with missions. Don't we already have missions?").
--
-- The World's pins come from action_globe_public_region_missions(): a mission
-- shows on the Earth only when action_globe_mission_regions places it in a
-- region and marks it published, and the region itself (a state, province or
-- first-level subdivision with a centroid) exists in action_globe_regions
-- (supabase/migrations/20261014013557_action_globe_regions.sql). Both tables
-- are the service role's; nothing on the site writes them. Production has
-- 27 open missions and no regions, so the Earth is honest and empty.
--
-- This places every open mission at a regional centroid, by its campaign:
--   the Cobalt Action Mission (Critical minerals · DR Congo) → CD-HK, Haut-
--     Katanga, the cobalt belt;
--   the End Racism Action Mission (United States)             → US-GA, Georgia,
--     the company's second state;
--   everything else (Equity Uprise: Policy · Connecticut; Homelessness
--     Action; Be Authentic; the three-path missions; Anti-Social)
--                                                             → US-CT,
--     Connecticut, the program's home.
-- Centroids only, never a member's or a recipient's location (the regional
-- model, docs/action-network/SEVEN-DAY-GLOBE-RECONCILIATION.md). Regional
-- impact totals still need five consenting members per region; nothing here
-- invents those. Idempotent: run it twice and nothing changes. To move a
-- mission, update its row in action_globe_mission_regions.
--
-- Apply as the service role (Supabase SQL editor or MCP), then move this file
-- to supabase/migrations with the applied version (supabase/pending/README.md).

insert into public.action_globe_regions (region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon)
values
  ('US-CT', 'US', 'CT', 'Connecticut', 41.6032, -73.0877),
  ('US-GA', 'US', 'GA', 'Georgia', 32.1656, -82.9001),
  ('CD-HK', 'CD', 'HK', 'Haut-Katanga', -10.7000, 27.5000)
on conflict (region_key) do nothing;

-- every open mission, placed by campaign; the two exceptions first
with placed as (
  select m.id as mission_id,
         case
           when m.campaign_id = 'critical-minerals-drc-001' then 'CD-HK'
           when m.campaign_id = 'end-racism-002' then 'US-GA'
           else 'US-CT'
         end as region_key
    from public.action_missions m
   where m.status = 'open'
)
insert into public.action_globe_mission_regions (mission_id, region_key, published, updated_at)
select p.mission_id, p.region_key, true, now()
  from placed p
on conflict (mission_id) do update
   set published = true, updated_at = now()
 where public.action_globe_mission_regions.published is distinct from true;

-- what the World will read back
select r.region_label, count(*) as missions
  from public.action_globe_mission_regions p
  join public.action_globe_regions r on r.region_key = p.region_key
  join public.action_missions m on m.id = p.mission_id and m.status = 'open'
 where p.published
 group by r.region_label
 order by missions desc;
