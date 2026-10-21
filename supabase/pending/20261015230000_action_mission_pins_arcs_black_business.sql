-- MISSIONS: MULTI-COUNTRY PINS, A MISSION'S ORIGIN, THE POLICY ARC, AND
-- BLACK BUSINESS ON THE MAP (owner mission curation, 2026-10-15; control_audit
-- id 58 records the curation itself, which is already live).
--
-- PENDING. Not applied to production. Owner approval required. Apply as the
-- service role with the Supabase MCP `apply_migration` under the name
-- `action_mission_pins_arcs_black_business`, then promote with the steps in
-- supabase/pending/README.md. Behaviour test:
-- supabase/tests/action_mission_pins_arcs_business.behaviour.sql, run on a
-- scratch Postgres by scripts/test-mission-pins-db.sh.
--
-- What it does, in order:
--   1. Country-level regions. action_globe_regions gains region_level
--      ('country' | 'subdivision'), ISO 3166-1 alpha-3, continent, and a
--      boundary REFERENCE (source, version, licence, URL, feature id), not
--      geometry. Fifty countries are added (list below). Label points are
--      Natural Earth's LABEL_Y/LABEL_X, a point inside each country, stored in
--      the existing centroid columns: never a member's location.
--      Boundary source: Natural Earth, Admin 0 – Countries, 1:50m, v5.1.2
--      (https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/,
--      read from github.com/nvkelso/natural-earth-vector tag v5.1.2,
--      geojson/ne_50m_admin_0_countries.geojson). Natural Earth is public
--      domain (https://www.naturalearthdata.com/about/terms-of-use/).
--      Geometry is NOT loaded here: action_globe_region_boundaries keeps its
--      ADM1 contract; drawing country outlines is the World PR's job (#442).
--   2. Country LISTS as data (action_globe_country_lists), so "first world" is
--      a row set the owner can edit, not a hard-coded idea. The first list,
--      wb_high_income_fy27_pop1m, is every economy the World Bank classifies
--      HIGH INCOME for FY27 (July 1 2026 – June 30 2027: 2025 GNI per capita,
--      Atlas method, above US$14,375), restricted to population of at least
--      1,000,000 (World Bank WDI SP.POP.TOTL, 2024 value, API read
--      2026-10-15, lastupdated 2026-10-08). Source file: World Bank
--      CLASS.xlsx ("List of economies"), https://datahelpdesk.worldbank.org/knowledgebase/articles/906519
--      (download https://ddh-openapi.worldbank.org/resources/DR0095333/download).
--      87 high-income economies → 50 at or above 1M. Taiwan, China (TWN) is
--      high income but the WDI publishes no population for it, so the rule
--      leaves it out: an owner decision, add the row if wanted. Russia (RUS)
--      is high income in FY27 and is in the list: also an owner decision.
--   3. A mission can have MANY pins. action_globe_mission_regions' key moves
--      from (mission_id) to (mission_id, region_key), and each pin gets a
--      role ('pin' | 'origin' | 'context'), a sort order and a JOIN SCOPE.
--      join_scope 'anywhere' (the default) is a display pin; only
--      'region_members' restricts who can join. VERIFIED 2026-10-15 in
--      production: join_action_mission() refuses any mission that has ANY
--      region row unless the member has a consented region there and that
--      region is unlocked; action_globe_member_regions has 0 rows, so every
--      pinned open mission (all six) is currently unjoinable through every
--      join path (join_action_mission_attributed / _live / _origin call it).
--      Defaulting existing pins to 'anywhere' lifts that; a regional mission
--      is now an explicit choice. (Owner: please confirm.)
--   4. A mission's ORIGIN (action_mission_origins): "Started by the
--      Connecticut cohort". Display only. join_action_mission never reads it.
--   5. Mission ARCS (action_mission_arcs): a child step unlocks for a member
--      only after an admin verified that member's assignment on the parent
--      (action_mission_assignments.status = 'verified', set only by review).
--      First arc: Write a policy memo → Co-write a policy reform paper.
--      The child stays DRAFT; publishing it is the owner's call.
--   6. Card calls to action as data (action_mission_ctas).
--   7. "Spend with intention" (d7fc0ca4-…, id kept) becomes "Buy from a Black
--      business". The draft "Spend $20 at a Black-owned business, then put
--      them on" (ba66d4a3-…, no assignments, VERIFIED 2026-10-15) is retired
--      to closed: its review-posting ask moves into the new card's CTA.
--   8. Black business listings (action_business_listings): a member submits
--      a business; an admin reviews it; nothing is auto-verified. Approval
--      gives the submitter a business-type profile in the EXISTING model
--      (network_organizations, organization_type 'for_profit', with an
--      'owner' row in network_organization_members) and, once the reviewer
--      sets a point, a pin: coarse (0.1°, about 11 km) unless the business
--      opted into its exact address.
--   9. The public RPCs: action_globe_public_region_missions() returns one row
--      per PIN (it always did; now a mission can have many) plus region_level,
--      country_code, continent, pin_role and origin_label;
--      action_mission_card_extras() and action_globe_public_business_pins()
--      are new and anon-readable; they expose no member data.
--
-- Ordering: action_globe_demo_pins_v1.sql (pending) is ALREADY APPLIED in
-- production (its rows carry updated_at 2026-10-15 17:55:53Z) and uses
-- ON CONFLICT (mission_id); promote it before this file and never re-run it
-- after. 20261014170000_action_mission_curated_catalog_resources.sql
-- (pending) would CLOSE three missions the owner reopened on 2026-10-15
-- (File a public comment, Spend with intention, Trace the minerals in your
-- phone): do not apply it as written.
--
-- ROLLBACK (service role; reverses this file only):
--   drop function if exists public.action_globe_public_business_pins();
--   drop function if exists public.review_action_business_listing(uuid,text,text,double precision,double precision);
--   drop function if exists public.withdraw_action_business_listing(uuid);
--   drop function if exists public.submit_action_business_listing(text,text,text,text,text,boolean,boolean,boolean,boolean,text);
--   drop table if exists public.action_business_listings;   -- (organizations it created stay; remove by hand if wanted)
--   drop function if exists public.action_mission_card_extras();
--   drop function if exists public.action_mission_arc_status(uuid);
--   re-run supabase/migrations/20261014184518_action_globe_join_authorization.sql and
--     supabase/migrations/20261014014547_action_globe_region_activation.sql (restores both join functions);
--   drop function if exists public.action_mission_arc_unlocked(uuid,uuid);
--   drop table if exists public.action_mission_ctas, public.action_mission_arcs, public.action_mission_origins;
--   update public.action_missions set title='Spend with intention', description=<previous text, kept in the PR doc>, updated_at=now() where id='d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c';
--   update public.action_missions set status='draft', updated_at=now() where id='ba66d4a3-cb62-4403-9b56-7ee00af059d8';
--   delete from public.action_globe_mission_regions where region_key in (select region_key from public.action_globe_regions where region_level='country')
--      or (mission_id='9144bd42-f94a-494e-a17a-a45f9e155f86' and region_key='US-CT');
--   update public.action_globe_mission_regions set pin_role='pin' where region_key='CD-HK';
--   (only when each mission has one row left:) alter table public.action_globe_mission_regions drop constraint action_globe_mission_regions_pkey,
--      add primary key (mission_id), drop column join_scope, drop column pin_role, drop column sort_order;
--   drop function public.action_globe_public_region_missions(); then re-create it from the production
--      definition quoted in docs/action-network/MISSION-PINS-ARCS-BLACK-BUSINESS.md;
--   drop table if exists public.action_globe_country_lists;
--   delete from public.action_globe_regions where region_level='country';
--   alter table public.action_globe_regions drop constraint if exists action_globe_regions_level_check,
--      drop constraint if exists action_globe_regions_level_subdivision_check, drop constraint if exists action_globe_regions_alpha3_check,
--      drop constraint if exists action_globe_regions_continent_check,
--      drop column region_level, drop column iso_alpha3, drop column continent, drop column boundary_source,
--      drop column boundary_source_version, drop column boundary_license, drop column boundary_url, drop column boundary_ref;

-- ---------------------------------------------------------------------------
-- 1. COUNTRY-LEVEL REGIONS
alter table public.action_globe_regions
  add column if not exists region_level text not null default 'subdivision',
  add column if not exists iso_alpha3 text,
  add column if not exists continent text,
  add column if not exists boundary_source text,
  add column if not exists boundary_source_version text,
  add column if not exists boundary_license text,
  add column if not exists boundary_url text,
  add column if not exists boundary_ref text;
alter table public.action_globe_regions drop constraint if exists action_globe_regions_level_check;
alter table public.action_globe_regions add constraint action_globe_regions_level_check
  check (region_level in ('country','subdivision'));
-- a country row has no subdivision; a subdivision row always has one
alter table public.action_globe_regions drop constraint if exists action_globe_regions_level_subdivision_check;
alter table public.action_globe_regions add constraint action_globe_regions_level_subdivision_check
  check ((region_level = 'country') = (subdivision_code = ''));
alter table public.action_globe_regions drop constraint if exists action_globe_regions_alpha3_check;
alter table public.action_globe_regions add constraint action_globe_regions_alpha3_check
  check (iso_alpha3 is null or iso_alpha3 ~ '^[A-Z]{3}$');
-- Natural Earth's CONTINENT values
alter table public.action_globe_regions drop constraint if exists action_globe_regions_continent_check;
alter table public.action_globe_regions add constraint action_globe_regions_continent_check
  check (continent is null or continent in ('Africa','Antarctica','Asia','Europe','North America','Oceania','South America','Seven seas (open ocean)'));

update public.action_globe_regions set iso_alpha3 = 'USA', continent = 'North America'
 where region_key in ('US-CT','US-GA') and iso_alpha3 is null;
update public.action_globe_regions set iso_alpha3 = 'COD', continent = 'Africa'
 where region_key = 'CD-HK' and iso_alpha3 is null;

-- region_key = ISO 3166-1 alpha-2; label point = Natural Earth LABEL_Y, LABEL_X;
-- boundary_ref = Natural Earth ADM0_A3. The last value is the WDI 2024 population
-- the list rule used; it is kept on the list row, not on the region.
drop table if exists pg_temp._mission_pin_countries;
create temporary table _mission_pin_countries (
  a2 text, a3 text, label text, continent text, lat double precision, lon double precision, ne_adm0_a3 text, pop2024 bigint
);
insert into _mission_pin_countries values
  ('AE','ARE','United Arab Emirates','Asia',23.4663,54.5473,'ARE',10986400),
  ('AT','AUT','Austria','Europe',47.5189,14.1305,'AUT',9177982),
  ('AU','AUS','Australia','Oceania',-24.1295,134.0497,'AUS',27194286),
  ('BE','BEL','Belgium','Europe',50.7854,4.8004,'BEL',11858610),
  ('BG','BGR','Bulgaria','Europe',42.5088,25.1571,'BGR',6441421),
  ('BH','BHR','Bahrain','Asia',26.056,50.5548,'BHR',1588670),
  ('CA','CAN','Canada','North America',60.3243,-101.9107,'CAN',41262329),
  ('CH','CHE','Switzerland','Europe',46.7191,7.464,'CHE',9005582),
  ('CL','CHL','Chile','South America',-38.1518,-72.3189,'CHL',19764771),
  ('CR','CRI','Costa Rica','North America',10.0651,-84.0779,'CRI',5129910),
  ('CY','CYP','Cyprus','Asia',34.9133,33.0842,'CYP',1358282),
  ('CZ','CZE','Czechia','Europe',49.8824,15.3776,'CZE',10905028),
  ('DE','DEU','Germany','Europe',50.9617,9.6783,'DEU',83516593),
  ('DK','DNK','Denmark','Europe',55.967,9.0182,'DNK',5976992),
  ('EE','EST','Estonia','Europe',58.7249,25.8671,'EST',1372341),
  ('ES','ESP','Spain','Europe',40.091,-3.4647,'ESP',48848840),
  ('FI','FIN','Finland','Europe',63.2524,27.2764,'FIN',5619911),
  ('FR','FRA','France','Europe',46.6961,2.5523,'FRA',68551653),
  ('GB','GBR','United Kingdom','Europe',54.4027,-2.1163,'GBR',69281000),
  ('GR','GRC','Greece','Europe',39.4928,21.7257,'GRC',10405134),
  ('HK','HKG','Hong Kong','Asia',22.4488,114.0978,'HKG',7524100),
  ('HR','HRV','Croatia','Europe',45.8058,16.3724,'HRV',3866200),
  ('HU','HUN','Hungary','Europe',47.0868,19.4479,'HUN',9562065),
  ('IE','IRL','Ireland','Europe',53.0787,-7.7986,'IRL',5395790),
  ('IL','ISR','Israel','Asia',30.9111,34.8479,'ISR',10002200),
  ('IT','ITA','Italy','Europe',44.7325,11.0769,'ITA',58952704),
  ('JP','JPN','Japan','Asia',36.1425,138.4422,'JPN',123975371),
  ('KR','KOR','South Korea','Asia',36.3849,128.1295,'KOR',51751065),
  ('KW','KWT','Kuwait','Asia',29.4136,47.314,'KWT',4897263),
  ('LT','LTU','Lithuania','Europe',55.1037,24.0899,'LTU',2888278),
  ('LV','LVA','Latvia','Europe',57.0669,25.4587,'LVA',1866124),
  ('NL','NLD','Netherlands','Europe',52.4222,5.6114,'NLD',17993485),
  ('NO','NOR','Norway','Europe',61.3571,9.68,'NOR',5572279),
  ('NZ','NZL','New Zealand','Oceania',-39.759,172.787,'NZL',5290000),
  ('OM','OMN','Oman','Asia',22.1204,57.3366,'OMN',5281538),
  ('PA','PAN','Panama','North America',8.722,-80.3521,'PAN',4515577),
  ('PL','POL','Poland','Europe',51.9903,19.4905,'POL',36559233),
  ('PR','PRI','Puerto Rico','North America',18.2347,-66.4811,'PRI',3202521),
  ('PT','PRT','Portugal','Europe',39.6067,-8.2718,'PRT',10694681),
  ('QA','QAT','Qatar','Asia',25.2374,51.1435,'QAT',2857822),
  ('RO','ROU','Romania','Europe',45.7332,24.9726,'ROU',19051804),
  ('RU','RUS','Russia','Europe',58.2494,44.6865,'RUS',143669648),
  ('SA','SAU','Saudi Arabia','Asia',23.8069,44.6996,'SAU',35300280),
  ('SE','SWE','Sweden','Europe',65.8592,19.0171,'SWE',10569709),
  ('SG','SGP','Singapore','Asia',1.3666,103.8169,'SGP',6036860),
  ('SI','SVN','Slovenia','Europe',46.0608,14.9153,'SVN',2127400),
  ('SK','SVK','Slovakia','Europe',48.734,19.0499,'SVK',5422069),
  ('TT','TTO','Trinidad and Tobago','North America',10.9989,-60.9184,'TTO',1368333),
  ('US','USA','United States','North America',39.5385,-97.4826,'USA',340003797),
  ('UY','URY','Uruguay','South America',-32.9611,-55.9669,'URY',3386588)
;

insert into public.action_globe_regions
  (region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon, region_level, iso_alpha3, continent,
   boundary_source, boundary_source_version, boundary_license, boundary_url, boundary_ref)
select c.a2, c.a2, '', c.label, c.lat, c.lon, 'country', c.a3, c.continent,
       'Natural Earth Admin 0 – Countries (1:50m)', '5.1.2', 'Public domain (Natural Earth terms of use)',
       'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/', c.ne_adm0_a3
  from _mission_pin_countries c
on conflict (region_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. COUNTRY LISTS ARE DATA
create table if not exists public.action_globe_country_lists (
  list_key text not null check (list_key ~ '^[a-z0-9_]{3,64}$'),
  region_key text not null references public.action_globe_regions(region_key) on delete cascade,
  criterion text not null,
  source_name text not null,
  source_version text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_value numeric,
  added_at timestamptz not null default now(),
  primary key (list_key, region_key)
);
alter table public.action_globe_country_lists enable row level security;
revoke all on public.action_globe_country_lists from public, anon, authenticated;
grant all on public.action_globe_country_lists to service_role;
comment on table public.action_globe_country_lists is
  'Named country sets that missions are pinned from (e.g. "first world"). Data, so the owner can edit membership; every row names its source and version.';

insert into public.action_globe_country_lists (list_key, region_key, criterion, source_name, source_version, source_url, source_value)
select 'wb_high_income_fy27_pop1m', c.a2,
       'World Bank high income (FY27) and population >= 1,000,000 (WDI SP.POP.TOTL 2024); source_value = that population',
       'World Bank country and lending groups (CLASS.xlsx) + World Development Indicators', 'FY27 classification, July 1 2026; WDI lastupdated 2026-10-08',
       'https://datahelpdesk.worldbank.org/knowledgebase/articles/906519', c.pop2024
  from _mission_pin_countries c
on conflict (list_key, region_key) do nothing;

drop table if exists pg_temp._mission_pin_countries;

-- ---------------------------------------------------------------------------
-- 3. MANY PINS PER MISSION; A PIN SHOWS, IT DOES NOT GATE (unless it says so)
alter table public.action_globe_mission_regions
  add column if not exists pin_role text not null default 'pin',
  add column if not exists sort_order smallint not null default 100,
  add column if not exists join_scope text not null default 'anywhere';
alter table public.action_globe_mission_regions drop constraint if exists action_globe_mission_regions_pin_role_check;
alter table public.action_globe_mission_regions add constraint action_globe_mission_regions_pin_role_check
  check (pin_role in ('pin','origin','context'));
alter table public.action_globe_mission_regions drop constraint if exists action_globe_mission_regions_join_scope_check;
alter table public.action_globe_mission_regions add constraint action_globe_mission_regions_join_scope_check
  check (join_scope in ('anywhere','region_members'));
do $pk$
begin
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.action_globe_mission_regions'::regclass and c.contype = 'p'
       and array_length(c.conkey, 1) = 1
  ) then
    alter table public.action_globe_mission_regions drop constraint action_globe_mission_regions_pkey;
    alter table public.action_globe_mission_regions add constraint action_globe_mission_regions_pkey primary key (mission_id, region_key);
  end if;
end
$pk$;
create index if not exists action_globe_mission_regions_region_idx on public.action_globe_mission_regions(region_key);

-- ---------------------------------------------------------------------------
-- 4. ORIGIN, ARCS, CALLS TO ACTION
create table if not exists public.action_mission_origins (
  mission_id uuid primary key references public.action_missions(id) on delete cascade,
  origin_label text not null check (char_length(origin_label) between 3 and 80),
  origin_region_key text references public.action_globe_regions(region_key),
  origin_cohort_id uuid references public.action_cohorts(id) on delete set null,
  origin_campaign_id text references public.action_campaigns(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.action_mission_origins is
  'Where a mission started ("Started by the Connecticut cohort"). Display only: joining never reads this table, so an origin never limits who can take part.';

create table if not exists public.action_mission_arcs (
  arc_key text not null check (arc_key ~ '^[a-z0-9-]{3,64}$'),
  parent_mission_id uuid not null references public.action_missions(id) on delete cascade,
  child_mission_id uuid not null references public.action_missions(id) on delete cascade,
  step smallint not null check (step between 2 and 20),
  unlock_rule text not null default 'parent_verified' check (unlock_rule = 'parent_verified'),
  created_at timestamptz not null default now(),
  primary key (parent_mission_id, child_mission_id),
  unique (child_mission_id),
  check (parent_mission_id <> child_mission_id)
);
comment on table public.action_mission_arcs is
  'Mission sequences. A child unlocks for a member only after an admin verified that member''s assignment on the parent (status verified, set only by review).';

create table if not exists public.action_mission_ctas (
  mission_id uuid primary key references public.action_missions(id) on delete cascade,
  cta_key text not null check (cta_key in ('business_listing')),
  label text not null check (char_length(label) between 3 and 60),
  updated_at timestamptz not null default now()
);

alter table public.action_mission_origins enable row level security;
alter table public.action_mission_arcs enable row level security;
alter table public.action_mission_ctas enable row level security;
revoke all on public.action_mission_origins, public.action_mission_arcs, public.action_mission_ctas from public, anon, authenticated;
grant all on public.action_mission_origins, public.action_mission_arcs, public.action_mission_ctas to service_role;

-- Trusted helper: is this mission unlocked for this auth user? Not exposed to clients.
create or replace function public.action_mission_arc_unlocked(p_user uuid, p_mission_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.action_mission_arcs a where a.child_mission_id = p_mission_id)
      or exists (
        select 1 from public.action_mission_arcs a
          join public.action_mission_assignments s on s.mission_id = a.parent_mission_id
         where a.child_mission_id = p_mission_id and s.user_id = p_user and s.status = 'verified'
      )
$$;
revoke all on function public.action_mission_arc_unlocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.action_mission_arc_unlocked(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. JOINING: only a 'region_members' pin restricts; an arc step waits for its parent
create or replace function public.action_globe_can_join_mission(p_m_uid uuid, p_mission_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
 select exists(
  select 1 from public.action_globe_mission_regions mr
  join public.action_missions mission on mission.id = mr.mission_id
  join public.action_globe_member_regions member on member.m_uid = p_m_uid
     and member.region_key = mr.region_key
  where mr.mission_id = p_mission_id and mr.published and mr.join_scope = 'region_members'
    and mission.status = 'open'
    and (select s.unlocked from public.action_globe_region_unlock_status(mr.region_key) s)
 )
$$;
revoke all on function public.action_globe_can_join_mission(uuid, uuid) from public, anon, authenticated;
grant execute on function public.action_globe_can_join_mission(uuid, uuid) to service_role;

create or replace function public.join_action_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_mission public.action_missions%rowtype;
 v_assignment public.action_mission_assignments%rowtype;
 v_taken integer;
begin
 if v_user is null then raise exception 'sign in to take a mission'; end if;
 if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;

 -- display pins never gate; only a pin marked region_members does
 if exists (select 1 from public.action_globe_mission_regions
             where mission_id = p_mission_id and published and join_scope = 'region_members')
    and not public.action_globe_can_join_mission(v_m_uid, p_mission_id) then
   raise exception 'regional mission not eligible for this member';
 end if;

 -- the next step of an arc opens once a reviewer verified the step before it
 if not public.action_mission_arc_unlocked(v_user, p_mission_id) then
   raise exception 'finish the step before this one first';
 end if;

 select * into v_mission from public.action_missions where id = p_mission_id for update;
 if not found or v_mission.status <> 'open'
    or (v_mission.starts_at is not null and v_mission.starts_at > now())
    or (v_mission.ends_at is not null and v_mission.ends_at <= now()) then
   raise exception 'this mission is not open';
 end if;

 select * into v_assignment from public.action_mission_assignments
  where mission_id = p_mission_id and user_id = v_user for update;
 if found then
   if v_assignment.status = 'withdrawn' then
     -- A withdrawn assignment does not occupy a slot; enforce capacity on rejoin.
     if v_mission.capacity is not null then
       select count(*) into v_taken from public.action_mission_assignments
        where mission_id = p_mission_id and status <> 'withdrawn';
       if v_taken >= v_mission.capacity then raise exception 'this mission is full'; end if;
     end if;
     update public.action_mission_assignments set status = 'in_progress', joined_at = now()
      where id = v_assignment.id returning * into v_assignment;
   end if;
   return jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status, 'mission_id', p_mission_id);
 end if;

 if v_mission.capacity is not null then
   select count(*) into v_taken from public.action_mission_assignments
    where mission_id = p_mission_id and status <> 'withdrawn';
   if v_taken >= v_mission.capacity then raise exception 'this mission is full'; end if;
 end if;

 insert into public.action_mission_assignments(mission_id, user_id, m_uid, status)
 values (p_mission_id, v_user, v_m_uid, 'in_progress')
 returning * into v_assignment;
 return jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status, 'mission_id', p_mission_id);
end;
$$;
revoke all on function public.join_action_mission(uuid) from public, anon;
grant execute on function public.join_action_mission(uuid) to authenticated, service_role;

-- A member's view of one arc step: what comes before or after, and whether it is open to them.
create or replace function public.action_mission_arc_status(p_mission_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'mission_id', p_mission_id,
    'previous', (select jsonb_build_object('mission_id', p.id, 'title', p.title, 'arc_key', a.arc_key, 'step', a.step)
                   from public.action_mission_arcs a join public.action_missions p on p.id = a.parent_mission_id
                  where a.child_mission_id = p_mission_id),
    'next', (select jsonb_build_object('mission_id', c.id, 'title', c.title, 'arc_key', a.arc_key, 'step', a.step, 'open', c.status = 'open')
               from public.action_mission_arcs a join public.action_missions c on c.id = a.child_mission_id
              where a.parent_mission_id = p_mission_id
              order by a.step limit 1),
    'unlocked', case when (select auth.uid()) is null then null
                     else public.action_mission_arc_unlocked((select auth.uid()), p_mission_id) end
  )
$$;
revoke all on function public.action_mission_arc_status(uuid) from public;
grant execute on function public.action_mission_arc_status(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. THE PUBLIC GLOBE READ: one row per published pin of an open mission
drop function if exists public.action_globe_public_region_missions();
create function public.action_globe_public_region_missions()
returns table(mission_id uuid, title text, description text, action_path text, region_key text, region_label text,
              latitude double precision, longitude double precision, song_title text,
              region_level text, country_code text, continent text, pin_role text, origin_label text)
language sql stable security definer set search_path = ''
as $$
select m.id, m.title, m.description,
(case when m.kind = 'clip' then 'amplify' when m.domain = 'creative' then 'create' when m.domain in ('community','mutual_aid','advocacy') then 'show_up' else 'explore' end),
r.region_key, r.region_label, r.centroid_lat, r.centroid_lon, s.song_title,
r.region_level, r.country_code, r.continent, p.pin_role, o.origin_label
from public.action_globe_mission_regions p
join public.action_missions m on m.id = p.mission_id
join public.action_globe_regions r on r.region_key = p.region_key
left join public.action_globe_song_missions s on s.mission_id = m.id
left join public.action_mission_origins o on o.mission_id = m.id
where p.published and m.status = 'open'
order by m.id, case p.pin_role when 'origin' then 0 when 'pin' then 1 else 2 end, p.sort_order, r.region_label
$$;
revoke all on function public.action_globe_public_region_missions() from public;
grant execute on function public.action_globe_public_region_missions() to anon, authenticated, service_role;
comment on function public.action_globe_public_region_missions() is
  'One row per published pin of an open mission (a mission can have many). Region label points only; never a member location.';

-- What a mission card adds: where it started, what comes next, how far it reaches, its call to action.
create or replace function public.action_mission_card_extras()
returns table(mission_id uuid, origin_label text, next_mission_id uuid, next_mission_title text, next_mission_open boolean,
              previous_mission_title text, pin_count integer, country_count integer, cta_key text, cta_label text)
language sql stable security definer set search_path = ''
as $$
select m.id,
       o.origin_label,
       nx.id, nx.title, nx.status = 'open',
       pv.title,
       (select count(*)::int from public.action_globe_mission_regions p where p.mission_id = m.id and p.published),
       (select count(distinct r.country_code)::int from public.action_globe_mission_regions p
          join public.action_globe_regions r on r.region_key = p.region_key
         where p.mission_id = m.id and p.published and p.pin_role <> 'context'),
       c.cta_key, c.label
  from public.action_missions m
  left join public.action_mission_origins o on o.mission_id = m.id
  left join lateral (select x.id, x.title, x.status from public.action_mission_arcs a
                       join public.action_missions x on x.id = a.child_mission_id
                      where a.parent_mission_id = m.id order by a.step limit 1) nx on true
  left join lateral (select x.title from public.action_mission_arcs a
                       join public.action_missions x on x.id = a.parent_mission_id
                      where a.child_mission_id = m.id limit 1) pv on true
  left join public.action_mission_ctas c on c.mission_id = m.id
 where m.status = 'open'
   and (o.mission_id is not null or nx.id is not null or pv.title is not null or c.mission_id is not null
        or exists (select 1 from public.action_globe_mission_regions p where p.mission_id = m.id and p.published))
$$;
revoke all on function public.action_mission_card_extras() from public;
grant execute on function public.action_mission_card_extras() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. BLACK BUSINESS ON THE MAP
create table if not exists public.action_business_listings (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submitter_m_uid uuid not null references public.m_people(id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 2 and 120),
  area_label text not null check (char_length(btrim(area_label)) between 2 and 120),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  public_url text not null check (char_length(public_url) between 12 and 500 and public_url ~ '^https://[^[:space:]]+$'),
  street_address text check (street_address is null or char_length(street_address) between 4 and 200),
  exact_location_opt_in boolean not null default false,
  attest_black_owned boolean not null check (attest_black_owned),
  attest_authorized boolean not null check (attest_authorized),
  consent_public_listing boolean not null check (consent_public_listing),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consented_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','needs_more_info','approved','rejected','withdrawn')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid,
  reviewed_at timestamptz,
  pin_lat double precision check (pin_lat is null or pin_lat between -90 and 90),
  pin_lon double precision check (pin_lon is null or pin_lon between -180 and 180),
  pin_precision text check (pin_precision is null or pin_precision in ('coarse','exact')),
  organization_id uuid references public.network_organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((pin_lat is null) = (pin_lon is null)),
  check ((pin_lat is null) = (pin_precision is null)),
  check (pin_precision is distinct from 'exact' or exact_location_opt_in),
  check (not exact_location_opt_in or street_address is not null),
  check (status not in ('approved','rejected','needs_more_info') or (reviewed_by is not null and reviewed_at is not null))
);
create unique index if not exists action_business_listings_one_live_per_name
  on public.action_business_listings (submitter_m_uid, lower(btrim(business_name)))
  where status in ('submitted','needs_more_info','approved');
create index if not exists action_business_listings_status_idx on public.action_business_listings (status, created_at desc);
alter table public.action_business_listings enable row level security;
revoke all on public.action_business_listings from public, anon, authenticated;
grant all on public.action_business_listings to service_role;
grant select on public.action_business_listings to authenticated;
drop policy if exists "submitter or desk reads business listings" on public.action_business_listings;
create policy "submitter or desk reads business listings" on public.action_business_listings
  for select to authenticated
  using (submitted_by = (select auth.uid()) or (select public.eu_is_admin()));
comment on table public.action_business_listings is
  'Black business listings. Members submit through submit_action_business_listing(); only an admin approves (review_action_business_listing). Never auto-verified. Street address is private unless the business opted into an exact pin.';

create or replace function public.submit_action_business_listing(
  p_business_name text, p_area_label text, p_country_code text, p_public_url text, p_street_address text,
  p_exact_location_opt_in boolean, p_attest_black_owned boolean, p_attest_authorized boolean,
  p_consent_public_listing boolean, p_consent_version text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_m_uid uuid := public.current_m_uid();
  v_open integer;
  v_id uuid;
begin
  if v_user is null then raise exception 'sign in to list a business'; end if;
  if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;
  if not coalesce(p_attest_black_owned, false) or not coalesce(p_attest_authorized, false) or not coalesce(p_consent_public_listing, false) then
    raise exception 'confirm the business is Black-owned, that you may list it, and that it may be shown on the map';
  end if;
  if coalesce(p_exact_location_opt_in, false) and nullif(btrim(coalesce(p_street_address, '')), '') is null then
    raise exception 'an exact pin needs the street address';
  end if;
  select count(*) into v_open from public.action_business_listings
   where submitter_m_uid = v_m_uid and status in ('submitted','needs_more_info');
  if v_open >= 3 then raise exception 'you have three listings waiting for review already'; end if;
  insert into public.action_business_listings (
    submitted_by, submitter_m_uid, business_name, area_label, country_code, public_url, street_address,
    exact_location_opt_in, attest_black_owned, attest_authorized, consent_public_listing, consent_version)
  values (
    v_user, v_m_uid, btrim(p_business_name), btrim(p_area_label), upper(btrim(p_country_code)), btrim(p_public_url),
    nullif(btrim(coalesce(p_street_address, '')), ''), coalesce(p_exact_location_opt_in, false),
    true, true, true, btrim(p_consent_version))
  returning id into v_id;
  -- always 'submitted': nothing here can approve a listing
  return jsonb_build_object('id', v_id, 'status', 'submitted');
end;
$$;
revoke all on function public.submit_action_business_listing(text,text,text,text,text,boolean,boolean,boolean,boolean,text) from public, anon;
grant execute on function public.submit_action_business_listing(text,text,text,text,text,boolean,boolean,boolean,boolean,text) to authenticated, service_role;

create or replace function public.withdraw_action_business_listing(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_row public.action_business_listings%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  update public.action_business_listings set status = 'withdrawn', updated_at = now()
   where id = p_id and submitted_by = (select auth.uid()) and status <> 'withdrawn'
   returning * into v_row;
  if not found then raise exception 'listing not found'; end if;
  -- the pin leaves the map at once; the business profile stays the owner's
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;
revoke all on function public.withdraw_action_business_listing(uuid) from public, anon;
grant execute on function public.withdraw_action_business_listing(uuid) to authenticated, service_role;

create or replace function public.review_action_business_listing(
  p_id uuid, p_decision text, p_note text, p_pin_lat double precision, p_pin_lon double precision)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.action_business_listings%rowtype;
  v_status text;
  v_org uuid;
  v_slug text;
  v_lat double precision;
  v_lon double precision;
  v_precision text;
begin
  if (select auth.uid()) is null or not (select public.eu_is_admin()) then
    raise exception 'only the desk reviews business listings';
  end if;
  v_status := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected'
                              when 'needs_more_info' then 'needs_more_info' else null end;
  if v_status is null then raise exception 'decision must be approve, reject or needs_more_info'; end if;
  if v_status <> 'approved' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'say why, so the owner can fix it';
  end if;
  if (p_pin_lat is null) <> (p_pin_lon is null) then raise exception 'a pin needs both latitude and longitude'; end if;
  if p_pin_lat is not null and (p_pin_lat not between -90 and 90 or p_pin_lon not between -180 and 180
                                or (p_pin_lat = 0 and p_pin_lon = 0)) then
    raise exception 'that is not a place';
  end if;

  select * into v_row from public.action_business_listings where id = p_id for update;
  if not found then raise exception 'listing not found'; end if;
  if v_row.status = 'withdrawn' then raise exception 'the owner withdrew this listing'; end if;

  v_org := v_row.organization_id;
  if v_status = 'approved' then
    if p_pin_lat is not null then
      if v_row.exact_location_opt_in then
        v_lat := round(p_pin_lat::numeric, 5)::double precision; v_lon := round(p_pin_lon::numeric, 5)::double precision; v_precision := 'exact';
      else
        -- coarse by default: one decimal degree, about 11 km
        v_lat := round(p_pin_lat::numeric, 1)::double precision; v_lon := round(p_pin_lon::numeric, 1)::double precision; v_precision := 'coarse';
      end if;
    else
      v_lat := v_row.pin_lat; v_lon := v_row.pin_lon; v_precision := v_row.pin_precision;
    end if;
    if v_org is null then
      -- the business-type profile is the existing organization model
      v_slug := left(trim(both '-' from regexp_replace(lower(v_row.business_name), '[^a-z0-9]+', '-', 'g')), 48)
                || '-' || left(replace(v_row.id::text, '-', ''), 6);
      insert into public.network_organizations (slug, name, organization_type, description, website_url, verification_state, created_by)
      values (v_slug, v_row.business_name, 'for_profit', 'Black-owned business · ' || v_row.area_label, v_row.public_url, 'verified', v_row.submitter_m_uid)
      returning id into v_org;
      insert into public.network_organization_members (organization_id, m_uid, role, state)
      values (v_org, v_row.submitter_m_uid, 'owner', 'joined')
      on conflict (organization_id, m_uid) do update set role = 'owner', state = 'joined';
    end if;
  else
    v_lat := v_row.pin_lat; v_lon := v_row.pin_lon; v_precision := v_row.pin_precision;
  end if;

  update public.action_business_listings
     set status = v_status, review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now(),
         pin_lat = v_lat, pin_lon = v_lon, pin_precision = v_precision,
         organization_id = v_org, updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.control_audit (actor_user_id, actor_kind, event, capability, resource_type, resource_id, detail)
  values ((select auth.uid()), 'human', 'action_business_listing.reviewed', 'action.business_listing.review',
          'action_business_listing', p_id::text,
          jsonb_build_object('decision', v_status, 'organization_id', v_org, 'pin_precision', v_precision));

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'organization_id', v_org, 'pin_precision', v_row.pin_precision);
end;
$$;
revoke all on function public.review_action_business_listing(uuid,text,text,double precision,double precision) from public, anon;
grant execute on function public.review_action_business_listing(uuid,text,text,double precision,double precision) to authenticated, service_role;

-- The public pins: approved, consented, placed by a reviewer. Coarse unless the business chose exact.
create or replace function public.action_globe_public_business_pins()
returns table(listing_id uuid, business_name text, area_label text, public_url text, latitude double precision,
              longitude double precision, pin_precision text, street_address text, organization_slug text)
language sql stable security definer set search_path = ''
as $$
select l.id, l.business_name, l.area_label, l.public_url, l.pin_lat, l.pin_lon, l.pin_precision,
       case when l.pin_precision = 'exact' and l.exact_location_opt_in then l.street_address end,
       o.slug
  from public.action_business_listings l
  left join public.network_organizations o on o.id = l.organization_id
 where l.status = 'approved' and l.consent_public_listing and l.pin_lat is not null and l.pin_lon is not null
 order by l.reviewed_at desc
$$;
revoke all on function public.action_globe_public_business_pins() from public;
grant execute on function public.action_globe_public_business_pins() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. THE OWNER'S CURATION, AS DATA (every statement is skipped when its mission is absent)

-- "Spend with intention" → "Buy from a Black business" (same id, same receipts)
update public.action_missions
   set title = 'Buy from a Black business',
       description = 'Buy something from a Black-owned business: a shop, a restaurant, a service, a creator. Proof: a redacted receipt and the business name or its public link. Never post card numbers or anyone else''s details.',
       updated_at = now()
 where id = 'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c';

-- the older draft folds into it: retired, never deleted (it has no assignments)
update public.action_missions m
   set status = 'closed', updated_at = now()
 where m.id = 'ba66d4a3-cb62-4403-9b56-7ee00af059d8' and m.status = 'draft'
   and not exists (select 1 from public.action_mission_assignments a where a.mission_id = m.id);

insert into public.action_mission_ctas (mission_id, cta_key, label)
select m.id, 'business_listing', 'Put your Black business on the map'
  from public.action_missions m where m.id = 'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c'
on conflict (mission_id) do update set cta_key = excluded.cta_key, label = excluded.label, updated_at = now();

-- Policy arc: Write a policy memo → Co-write a policy reform paper (the paper stays draft)
insert into public.action_mission_arcs (arc_key, parent_mission_id, child_mission_id, step)
select 'policy-reform', p.id, c.id, 2
  from public.action_missions p, public.action_missions c
 where p.id = '368fd75a-77d2-4de0-9722-17020674a914' and c.id = 'df26314d-d4e1-47e3-b980-1b60b1a682ea'
on conflict (parent_mission_id, child_mission_id) do nothing;

-- Trace the minerals in your phone + Recycle one dead device the right way:
-- open to everyone, pinned on every country in the "first world" list
insert into public.action_globe_mission_regions (mission_id, region_key, published, pin_role, sort_order, join_scope, updated_at)
select m.id, l.region_key, true, 'pin', case when l.region_key = 'US' then 10 else 100 end, 'anywhere', now()
  from public.action_missions m
  cross join public.action_globe_country_lists l
 where m.id in ('9144bd42-f94a-494e-a17a-a45f9e155f86', '49d654e1-dfc8-42aa-a26e-22912ebf8dc6')
   and l.list_key = 'wb_high_income_fy27_pop1m'
on conflict (mission_id, region_key) do update
   set published = true, pin_role = 'pin', join_scope = 'anywhere', updated_at = now();

-- the cobalt belt stays on the map for both, as where the story comes from
update public.action_globe_mission_regions
   set pin_role = 'context', sort_order = 200, updated_at = now()
 where region_key = 'CD-HK'
   and mission_id in ('9144bd42-f94a-494e-a17a-a45f9e155f86', '49d654e1-dfc8-42aa-a26e-22912ebf8dc6');

-- Trace the minerals started in Connecticut
insert into public.action_globe_mission_regions (mission_id, region_key, published, pin_role, sort_order, join_scope, updated_at)
select m.id, 'US-CT', true, 'origin', 0, 'anywhere', now()
  from public.action_missions m where m.id = '9144bd42-f94a-494e-a17a-a45f9e155f86'
on conflict (mission_id, region_key) do update set published = true, pin_role = 'origin', sort_order = 0, join_scope = 'anywhere', updated_at = now();

insert into public.action_mission_origins (mission_id, origin_label, origin_region_key)
select m.id, 'Started by the Connecticut cohort', 'US-CT'
  from public.action_missions m where m.id = '9144bd42-f94a-494e-a17a-a45f9e155f86'
on conflict (mission_id) do update set origin_label = excluded.origin_label, origin_region_key = excluded.origin_region_key, updated_at = now();
