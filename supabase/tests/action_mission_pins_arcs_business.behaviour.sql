-- Behaviour tests for supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql,
-- as the real API roles with the JWT claims Supabase would set. Scratch
-- database only (scripts/test-mission-pins-db.sh). Every check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); execute 'set role anon'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'reset role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on function pg_temp.check(boolean, text), pg_temp.must_fail(text, text) to anon, authenticated;

-- members: Ana (member), Bo (member), the desk (admin by email in the role stub)
select pg_temp.as_service();
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ana@test'),
  ('00000000-0000-4000-8000-0000000000b2', 'bo@test'),
  ('00000000-0000-4000-8000-0000000000d3', 'matthew@mccluster.org');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000b2'), ('10000000-0000-4000-8000-0000000000d3');
insert into public.m_links(user_id, m_uid) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d3');

-- 1. regions and lists
select pg_temp.check((select count(*) = 50 from public.action_globe_regions where region_level = 'country'), '50 country regions');
select pg_temp.check((select bool_and(subdivision_code = '' and iso_alpha3 ~ '^[A-Z]{3}$' and boundary_source_version = '5.1.2' and boundary_ref is not null)
                        from public.action_globe_regions where region_level = 'country'), 'country rows carry ISO alpha-3 and a Natural Earth reference');
select pg_temp.check((select iso_alpha3 = 'USA' and continent = 'North America' from public.action_globe_regions where region_key = 'US-CT'), 'existing subdivisions backfilled');
select pg_temp.check((select count(*) = 50 from public.action_globe_country_lists where list_key = 'wb_high_income_fy27_pop1m'), 'first-world list has 50 rows');
select pg_temp.check(exists(select 1 from public.action_globe_country_lists where region_key = 'US')
                     and not exists(select 1 from public.action_globe_country_lists where region_key in ('TW','CN','IN','CD')), 'list membership follows the rule');
select pg_temp.must_fail($$insert into public.action_globe_regions(region_key,country_code,subdivision_code,region_label,centroid_lat,centroid_lon,region_level) values ('XX','XX','A','bad',0,0,'country')$$, '%level_subdivision%');

-- 2. many pins per mission
select pg_temp.check((select count(*) = 52 from public.action_globe_mission_regions where mission_id = '9144bd42-f94a-494e-a17a-a45f9e155f86'), 'trace: 50 countries + CT origin + Haut-Katanga context');
select pg_temp.check((select count(*) = 51 from public.action_globe_mission_regions where mission_id = '49d654e1-dfc8-42aa-a26e-22912ebf8dc6'), 'recycle: 50 countries + Haut-Katanga context');
select pg_temp.check((select pin_role = 'context' from public.action_globe_mission_regions where mission_id = '49d654e1-dfc8-42aa-a26e-22912ebf8dc6' and region_key = 'CD-HK'), 'cobalt belt kept as context');
select pg_temp.check((select bool_and(join_scope = 'anywhere') from public.action_globe_mission_regions), 'every existing and new pin is display-only');

select pg_temp.as_anon();
select pg_temp.check((select count(*) = 52 from public.action_globe_public_region_missions() where mission_id = '9144bd42-f94a-494e-a17a-a45f9e155f86'), 'public RPC returns every pin of trace');
select pg_temp.check((select region_key = 'US-CT' and pin_role = 'origin' and origin_label = 'Started by the Connecticut cohort'
                        from public.action_globe_public_region_missions() where mission_id = '9144bd42-f94a-494e-a17a-a45f9e155f86' limit 1), 'trace pins start at its Connecticut origin');
select pg_temp.check((select region_key = 'US' from public.action_globe_public_region_missions() where mission_id = '49d654e1-dfc8-42aa-a26e-22912ebf8dc6' limit 1), 'recycle pins start with the United States');
select pg_temp.check(not exists(select 1 from public.action_globe_public_region_missions() where mission_id = 'df26314d-d4e1-47e3-b980-1b60b1a682ea'), 'a draft mission has no public pin');
select pg_temp.check((select country_count = 50 and origin_label is not null from public.action_mission_card_extras() where mission_id = '9144bd42-f94a-494e-a17a-a45f9e155f86'), 'card extras: origin and 50 countries');
select pg_temp.check((select next_mission_title = 'Co-write a policy reform paper' and next_mission_open = false
                        from public.action_mission_card_extras() where mission_id = '368fd75a-77d2-4de0-9722-17020674a914'), 'memo card names the next step');
select pg_temp.check((select cta_key = 'business_listing' and cta_label = 'Put your Black business on the map'
                        from public.action_mission_card_extras() where mission_id = 'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c'), 'Black business card CTA');
select pg_temp.must_fail($$select * from public.action_globe_country_lists$$, '%permission denied%');
select pg_temp.must_fail($$select * from public.action_business_listings$$, '%permission denied%');
select pg_temp.must_fail($$select public.submit_action_business_listing('A','B','US','https://a.example',null,false,true,true,true,'v1')$$, '%permission denied%');
select pg_temp.as_service();

-- 3. copy changes
select pg_temp.check((select title = 'Buy from a Black business' and status = 'open' from public.action_missions where id = 'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c'), 'Spend with intention renamed, id kept');
select pg_temp.check((select status = 'closed' from public.action_missions where id = 'ba66d4a3-cb62-4403-9b56-7ee00af059d8'), 'old $20 draft retired');

-- 4. joining: a display pin no longer locks out a member with no region (production bug)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.check((select public.join_action_mission('9144bd42-f94a-494e-a17a-a45f9e155f86')->>'status') = 'in_progress', 'Ana joins a multi-country mission from anywhere');
select pg_temp.check((select public.join_action_mission('368fd75a-77d2-4de0-9722-17020674a914')->>'status') = 'in_progress', 'Ana joins the memo');
select pg_temp.as_service();
-- a region_members pin still gates
update public.action_globe_mission_regions set join_scope = 'region_members' where mission_id = '7cfac26a-d757-42b9-803b-970f9d5030a8';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select pg_temp.must_fail($$select public.join_action_mission('7cfac26a-d757-42b9-803b-970f9d5030a8')$$, '%regional mission not eligible%');
select pg_temp.as_service();
update public.action_globe_mission_regions set join_scope = 'anywhere' where mission_id = '7cfac26a-d757-42b9-803b-970f9d5030a8';

-- 5. the arc: the paper waits for an admin-verified memo
update public.action_missions set status = 'open' where id = 'df26314d-d4e1-47e3-b980-1b60b1a682ea';  -- as if the owner published it
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($$select public.join_action_mission('df26314d-d4e1-47e3-b980-1b60b1a682ea')$$, '%finish the step before this one first%');
select pg_temp.check((select (public.action_mission_arc_status('df26314d-d4e1-47e3-b980-1b60b1a682ea')->>'unlocked')::boolean) = false, 'arc status: locked');
select pg_temp.as_service();
update public.action_mission_assignments set status = 'submitted', submitted_at = now()
 where mission_id = '368fd75a-77d2-4de0-9722-17020674a914' and user_id = '00000000-0000-4000-8000-0000000000a1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($$select public.join_action_mission('df26314d-d4e1-47e3-b980-1b60b1a682ea')$$, '%finish the step before this one first%');
select pg_temp.as_service();
update public.action_mission_assignments set status = 'verified', verified_at = now()
 where mission_id = '368fd75a-77d2-4de0-9722-17020674a914' and user_id = '00000000-0000-4000-8000-0000000000a1';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.check((select public.join_action_mission('df26314d-d4e1-47e3-b980-1b60b1a682ea')->>'status') = 'in_progress', 'verified memo unlocks the paper');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select pg_temp.must_fail($$select public.join_action_mission('df26314d-d4e1-47e3-b980-1b60b1a682ea')$$, '%finish the step before this one first%');
select pg_temp.as_service();
update public.action_missions set status = 'draft' where id = 'df26314d-d4e1-47e3-b980-1b60b1a682ea';

-- 6. Black business listings: submit, never auto-verified, desk review, coarse by default
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select pg_temp.must_fail($$select public.submit_action_business_listing('Bo''s Books','Hartford, CT','US','https://bos.example',null,false,false,true,true,'2026-10-15')$$, '%Black-owned%');
select pg_temp.must_fail($$select public.submit_action_business_listing('Bo''s Books','Hartford, CT','US','http://bos.example',null,false,true,true,true,'2026-10-15')$$, '%public_url%');
select pg_temp.must_fail($$select public.submit_action_business_listing('Bo''s Books','Hartford, CT','US','https://bos.example',null,true,true,true,true,'2026-10-15')$$, '%street address%');
select pg_temp.check((select public.submit_action_business_listing('Bo''s Books','Hartford, CT','US','https://bos.example',null,false,true,true,true,'2026-10-15')->>'status') = 'submitted', 'listing submitted');
select pg_temp.check((select public.submit_action_business_listing('Bo''s Barbers','New Haven, CT','US','https://barbers.example','12 Chapel St, New Haven, CT',true,true,true,true,'2026-10-15')->>'status') = 'submitted', 'exact-opt-in listing submitted');
select pg_temp.must_fail($$select public.submit_action_business_listing('Bo''s Books','Hartford, CT','US','https://bos.example',null,false,true,true,true,'2026-10-15')$$, '%one_live_per_name%');
select pg_temp.check((select count(*) = 2 from public.action_business_listings), 'Bo reads his own listings');
select pg_temp.must_fail($$update public.action_business_listings set status = 'approved'$$, '%permission denied%');
select pg_temp.must_fail($$insert into public.action_business_listings(submitted_by, submitter_m_uid, business_name, area_label, country_code, public_url, attest_black_owned, attest_authorized, consent_public_listing, consent_version, status) values ('00000000-0000-4000-8000-0000000000b2','10000000-0000-4000-8000-0000000000b2','X','Y','US','https://x.example',true,true,true,'v','approved')$$, '%permission denied%');
select pg_temp.must_fail($$select public.review_action_business_listing((select id from public.action_business_listings limit 1),'approve',null,41.76,-72.68)$$, '%only the desk%');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.check((select count(*) = 0 from public.action_business_listings), 'Ana cannot read Bo''s listings');
select pg_temp.as_anon();
select pg_temp.check((select count(*) = 0 from public.action_globe_public_business_pins()), 'nothing on the map before review');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000d3', 'matthew@mccluster.org');
select pg_temp.must_fail($$select public.review_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Books'),'reject',null,null,null)$$, '%say why%');
select pg_temp.must_fail($$select public.review_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Books'),'approve',null,0,0)$$, '%not a place%');
select pg_temp.check((select public.review_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Books'),'approve',null,41.76371,-72.68509)->>'pin_precision') = 'coarse', 'approve: coarse pin');
select pg_temp.check((select public.review_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Barbers'),'approve',null,41.30812,-72.92816)->>'pin_precision') = 'exact', 'approve: exact pin when opted in');
-- approving twice does not make a second profile
select public.review_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Books'),'approve',null,null,null);
select pg_temp.as_service();
select pg_temp.check((select pin_lat = 41.8 and pin_lon = -72.7 and pin_precision = 'coarse' from public.action_business_listings where business_name = 'Bo''s Books'), 'coarse = one decimal degree');
select pg_temp.check((select count(*) = 2 from public.network_organizations where organization_type = 'for_profit' and verification_state = 'verified' and created_by = '10000000-0000-4000-8000-0000000000b2'), 'one business profile per approved listing');
select pg_temp.check((select count(*) = 2 from public.network_organization_members where m_uid = '10000000-0000-4000-8000-0000000000b2' and role = 'owner' and state = 'joined'), 'submitter owns the profile');
select pg_temp.check((select count(*) = 3 from public.control_audit where event = 'action_business_listing.reviewed'), 'every review audited');

select pg_temp.as_anon();
select pg_temp.check((select count(*) = 2 from public.action_globe_public_business_pins()), 'two business pins public');
select pg_temp.check((select street_address is null and latitude = 41.8 from public.action_globe_public_business_pins() where business_name = 'Bo''s Books'), 'coarse pin hides the address');
select pg_temp.check((select street_address = '12 Chapel St, New Haven, CT' and latitude = 41.30812 from public.action_globe_public_business_pins() where business_name = 'Bo''s Barbers'), 'exact pin shows what the business chose to show');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select pg_temp.check((select public.withdraw_action_business_listing((select id from public.action_business_listings where business_name = 'Bo''s Barbers'))->>'status') = 'withdrawn', 'owner withdraws');
select pg_temp.as_anon();
select pg_temp.check((select count(*) = 1 from public.action_globe_public_business_pins()), 'withdrawn pin leaves the map');
select pg_temp.as_service();

select 'action mission pins, arcs and Black business: ok' as result;
