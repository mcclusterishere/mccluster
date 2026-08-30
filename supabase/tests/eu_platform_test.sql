-- ============================================================
-- EQUITY UPRISE — THE WALL, UNDER TEST.
--
-- Every promise the platform makes about who can see and do what is a
-- Row Level Security policy or a trigger. Those are the easiest things
-- in the system to get subtly wrong and the hardest to notice when you
-- do: a policy that is too generous fails silently, forever, and the
-- first person to find out is the person it leaked to.
--
-- So the wall is tested. This file stands up a throwaway Postgres that
-- imitates the parts of Supabase the schema leans on (the auth schema,
-- auth.uid(), auth.jwt(), the anon/authenticated roles), applies
-- 0017 and 0018, and then tries to break in from every direction the
-- product actually exposes. It raises on the first broken promise.
--
-- RUN IT (needs postgresql-16 and nothing else — no Supabase account,
-- no network, no secrets):
--
--   bash supabase/tests/run-eu-tests.sh
--
-- DO NOT run this against the live project. It writes fixtures into
-- auth.users, which on a real project is a table of real people.
-- ============================================================

\set ON_ERROR_STOP on

-- ---- the Supabase shim ---------------------------------------------
-- Only what the schema touches. If a future migration reaches for
-- another piece of Supabase, it gets added here and stays honest.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

grant usage on schema public, auth to anon, authenticated, service_role;

-- ---- the test kit ---------------------------------------------------
create or replace function public.eu_test_as(u text, e text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  perform set_config('request.jwt.claims',
    case when u = '' then '{}' else json_build_object('sub', u, 'email', e)::text end, false);
end $$;

create or replace function public.eu_test_is(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %  — got %, wanted %', label, coalesce(got::text,'null'), coalesce(want::text,'null');
  end if;
  raise notice 'ok    %', label;
end $$;

-- ---- the people ------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','matthew@mccluster.org'),
  ('00000000-0000-0000-0000-0000000000a2','editor@example.org'),
  ('00000000-0000-0000-0000-0000000000a3','member@example.org'),
  ('00000000-0000-0000-0000-0000000000a4','host@example.org')
on conflict (id) do nothing;

-- Seeded with no token on purpose: this is the SQL editor, which is
-- allowed to set roles. That the guard steps aside here is itself a
-- promise under test (see "the SQL editor may seed a role" below).
insert into public.eu_profiles (id, handle, display_name, role, region, interests) values
  ('00000000-0000-0000-0000-0000000000a1','mccluster','Matthew McCluster','admin','CT','{housing}'),
  ('00000000-0000-0000-0000-0000000000a2','ed','An Editor','editor','CT','{}'),
  ('00000000-0000-0000-0000-0000000000a3','ash','A Member','member','CT','{surveillance,civil-liberties}'),
  ('00000000-0000-0000-0000-0000000000a4','hostorg','A Host','host','NY','{energy}')
on conflict (id) do nothing;

insert into public.eu_profile_contact (id, email, phone, sms_optin)
  values ('00000000-0000-0000-0000-0000000000a3','member@example.org','+12035550100', true)
on conflict (id) do nothing;

insert into public.eu_fellowships (slug,title,org,focus_tags,topic_slugs,region,status,verification) values
  ('test-civil-liberties','Civil Liberties Fellow','Test Org','{surveillance,civil-liberties}','{surveillance-and-tracking}','CT','published','verified'),
  ('test-energy-siting','Energy Siting Fellow','Test Grid','{energy,land-use}','{data-centers}','NY','published','unverified'),
  ('test-unrelated','Unrelated Fellow','Test Other','{sonnets}','{}','TX','published','unverified'),
  ('test-pending','Pending Fellow','Test Nobody','{surveillance}','{}','CT','pending','unverified')
on conflict (slug) do nothing;

-- ============================================================
-- THE PROMISES
-- ============================================================
do $$
declare n int; t text; b boolean;
begin
  raise notice '';
  raise notice '-- who is asking --';

  perform public.eu_test_as('00000000-0000-0000-0000-0000000000a1','matthew@mccluster.org');
  perform public.eu_test_is('the owner is admin', public.eu_role(), 'admin');
  perform public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
  perform public.eu_test_is('a fellow with duties is editor', public.eu_role(), 'editor');
  perform public.eu_test_is('an editor is staff', public.eu_is_staff(), true);
  perform public.eu_test_is('an editor is not admin', public.eu_is_admin(), false);
  perform public.eu_test_as('00000000-0000-0000-0000-0000000000a3','member@example.org');
  perform public.eu_test_is('a member is not staff', public.eu_is_staff(), false);
  perform public.eu_test_as('','');
  perform public.eu_test_is('a stranger is a visitor', public.eu_role(), 'visitor');

  -- the SQL editor may seed a role: without this the owner cannot make
  -- the first editor, and the failure looks like nothing happening.
  perform public.eu_test_is('the SQL editor may seed a role',
    (select role from public.eu_profiles where handle = 'ed'), 'editor');
end $$;

-- ---- a member cannot promote themselves ------------------------------
select public.eu_test_as('00000000-0000-0000-0000-0000000000a3','member@example.org');
set role authenticated;
update public.eu_profiles set role = 'admin', bio = 'tried it'
  where id = '00000000-0000-0000-0000-0000000000a3';
reset role;
do $$ begin
  raise notice '';
  raise notice '-- the role guard --';
  perform public.eu_test_is('a member who writes role=admin stays a member',
    (select role from public.eu_profiles where handle='ash'), 'member');
  perform public.eu_test_is('…but the rest of their edit still lands',
    (select bio from public.eu_profiles where handle='ash'), 'tried it');
end $$;

-- ---- what a stranger can reach ---------------------------------------
select public.eu_test_as('','');
set role anon;
-- Counted over this file's own fixtures, not the whole table: 0018
-- seeds a real directory, and a test that asserts on the size of it
-- breaks every time somebody adds a fellowship, which is the one thing
-- the desk is supposed to do freely.
create temp table t_anon as
  select (select count(*) from public.eu_fellowships where slug like 'test-%') as fellowships,
         (select count(*) from public.eu_profiles_public)                      as profiles,
         (select count(*) from public.eu_perspectives_public)                  as perspectives;
reset role;
do $$ begin
  raise notice '';
  raise notice '-- the anonymous door --';
  perform public.eu_test_is('a stranger sees published listings only (3 of 4 fixtures)',
    (select fellowships from t_anon), 3::bigint);
  perform public.eu_test_is('a stranger sees public profiles through the view',
    (select profiles from t_anon), 4::bigint);
  perform public.eu_test_is('a stranger sees no unapproved perspectives',
    (select perspectives from t_anon), 0::bigint);
end $$;

-- ---- the front door: anyone may speak, nobody reads the pile ----------
select public.eu_test_as('','');
set role anon;
insert into public.eu_perspectives (topic_slug, body, display_name)
  values ('data-centers', 'The substation runs loud at night.', 'A neighbor');
reset role;

do $$
declare denied boolean := false;
begin
  raise notice '';
  raise notice '-- the front door --';
  perform public.eu_test_is('a stranger can drop a perspective',
    (select count(*) from public.eu_perspectives where body like 'The substation%'), 1::bigint);
  begin
    set local role anon;
    perform count(*) from public.eu_perspectives;
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  perform public.eu_test_is('a stranger cannot read the pile back', denied, true);
end $$;

-- ---- moderation, and the log that writes itself ----------------------
select public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
set role authenticated;
update public.eu_perspectives set status = 'approved' where body like 'The substation%';
reset role;

select public.eu_test_as('','');
set role anon;
create temp table t_after as select count(*) as n from public.eu_perspectives_public;
reset role;

do $$ begin
  raise notice '';
  raise notice '-- moderation --';
  perform public.eu_test_is('an editor can approve',
    (select status from public.eu_perspectives where body like 'The substation%'), 'approved');
  perform public.eu_test_is('an approved perspective becomes public',
    (select n from t_after), 1::bigint);
  perform public.eu_test_is('approving writes its own audit line',
    (select action from public.eu_audit order by id desc limit 1), 'perspective.approved');
  perform public.eu_test_is('and the line names the editor, not the system',
    (select actor from public.eu_audit order by id desc limit 1), 'editor@example.org');
end $$;

-- ---- contact details are not an editor power -------------------------
select public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
set role authenticated;
create temp table t_ed_contacts as select count(*) as n from public.eu_profile_contact;
reset role;
select public.eu_test_as('00000000-0000-0000-0000-0000000000a1','matthew@mccluster.org');
set role authenticated;
create temp table t_admin_contacts as select count(*) as n from public.eu_profile_contact;
reset role;
do $$ begin
  raise notice '';
  raise notice '-- reachability --';
  perform public.eu_test_is('an editor sees no contact rows', (select n from t_ed_contacts), 0::bigint);
  perform public.eu_test_is('the owner does', (select n from t_admin_contacts), 1::bigint);
end $$;

-- ---- a host lists a program ------------------------------------------
select public.eu_test_as('00000000-0000-0000-0000-0000000000a4','host@example.org');
set role authenticated;
insert into public.eu_fellowships (slug, title, org, status, source, verification)
  values ('test-my-own-program','My Own Program','Host Org','published','staff','verified');
reset role;
do $$ begin
  raise notice '';
  raise notice '-- the host door --';
  perform public.eu_test_is('a host listing lands pending, whatever it asked for',
    (select status from public.eu_fellowships where slug='test-my-own-program'), 'pending');
  perform public.eu_test_is('…and unverified',
    (select verification from public.eu_fellowships where slug='test-my-own-program'), 'unverified');
  perform public.eu_test_is('…and attributed to the host who filed it',
    (select created_by from public.eu_fellowships where slug='test-my-own-program'),
    '00000000-0000-0000-0000-0000000000a4'::uuid);
end $$;

-- ---- an editor drafts a campaign but cannot send it -------------------
select public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
set role authenticated;
insert into public.eu_campaigns (name, body, created_by)
  values ('Test blast', 'hello', '00000000-0000-0000-0000-0000000000a2');
reset role;

do $$
declare blocked boolean := false;
begin
  raise notice '';
  raise notice '-- the send gate --';
  perform public.eu_test_is('an editor can draft',
    (select status from public.eu_campaigns where name='Test blast'), 'draft');
  begin
    perform public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
    set local role authenticated;
    update public.eu_campaigns set status = 'ready' where name = 'Test blast';
  exception when others then blocked := true;
  end;
  reset role;
  perform public.eu_test_is('an editor cannot arm it', blocked, true);
  perform public.eu_test_is('and it is still a draft',
    (select status from public.eu_campaigns where name='Test blast'), 'draft');
end $$;

select public.eu_test_as('00000000-0000-0000-0000-0000000000a1','matthew@mccluster.org');
set role authenticated;
update public.eu_campaigns set status = 'ready' where name = 'Test blast';
reset role;
do $$ begin
  perform public.eu_test_is('the owner can',
    (select status from public.eu_campaigns where name='Test blast'), 'ready');
  perform public.eu_test_is('and arming stamps who approved it',
    (select approved_by from public.eu_campaigns where name='Test blast'),
    '00000000-0000-0000-0000-0000000000a1'::uuid);
end $$;

-- ---- the match ---------------------------------------------------------
do $$
declare top_slug text; top_reasons text[]; n int;
begin
  raise notice '';
  raise notice '-- the match --';
  perform public.eu_test_as('00000000-0000-0000-0000-0000000000a3','member@example.org');

  select slug, reasons into top_slug, top_reasons
  from public.eu_match_fellowships() order by score desc limit 1;
  perform public.eu_test_is('a surveillance-minded member is matched to the right program',
    top_slug, 'test-civil-liberties');
  perform public.eu_test_is('and the match explains itself',
    (cardinality(top_reasons) > 0), true);

  -- The list is allowed to be as long as the directory makes it. What
  -- it is not allowed to do is pad: a program about sonnets has nothing
  -- to do with this person and must not appear at any score.
  select count(*) into n from public.eu_match_fellowships(null, 50) where slug = 'test-unrelated';
  perform public.eu_test_is('an unrelated program is not padded in', n, 0);

  -- a signed-out visitor who ticks boxes on the page still gets matched
  perform public.eu_test_as('','');
  select slug into top_slug from public.eu_match_fellowships(null, 5, '{energy}') order by score desc limit 1;
  perform public.eu_test_is('a stranger can be matched from tags alone', top_slug, 'test-energy-siting');

  -- an unpublished listing never reaches a recommendation
  select count(*) into n from public.eu_match_fellowships(null, 50, '{surveillance}')
    where slug = 'test-pending';
  perform public.eu_test_is('a pending listing is never recommended', n, 0);
end $$;

do $$ begin
  raise notice '';
  raise notice 'ALL PROMISES HELD.';
end $$;

-- ============================================================
-- THE SHAKE RUN (0019)
--
-- Two promises carry real money and a real person's address, so they get
-- their own assertions: an Equity Uprise editor must never see a customer
-- address, and a browser must never be able to write an order at all.
-- ============================================================

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b3','runner@example.org'),
  ('00000000-0000-0000-0000-0000000000b4','buyer@example.org')
on conflict (id) do nothing;

insert into public.eu_profiles (id, handle, display_name, role) values
  ('00000000-0000-0000-0000-0000000000b3','runner','A Runner','member'),
  ('00000000-0000-0000-0000-0000000000b4','buyer','A Buyer','member')
on conflict (id) do nothing;

insert into public.shake_crew (profile_id)
  values ('00000000-0000-0000-0000-0000000000b3') on conflict (profile_id) do nothing;
insert into public.shake_stops (name) values ('Test Hall') on conflict do nothing;
insert into public.shake_windows (closes_at, note) values (now() + interval '2 hours', 'test window');
insert into public.shake_orders (code, customer_name, room_detail, contact_phone, stop_name, profile_id, total_cents, status)
  values ('SHK-TEST-1','A Buyer','Room 412','+12035550111','Test Hall',
          '00000000-0000-0000-0000-0000000000b4', 900, 'paid')
on conflict (code) do nothing;

-- who can read a customer's dorm room
select public.eu_test_as('00000000-0000-0000-0000-0000000000a2','editor@example.org');
set role authenticated;
create temp table t_shake_ed as select count(*) as n from public.shake_orders;
reset role;
select public.eu_test_as('00000000-0000-0000-0000-0000000000b3','runner@example.org');
set role authenticated;
create temp table t_shake_crew as select count(*) as n from public.shake_orders;
reset role;
select public.eu_test_as('00000000-0000-0000-0000-0000000000b4','buyer@example.org');
set role authenticated;
create temp table t_shake_buyer as select count(*) as n from public.shake_orders;
reset role;

do $$
declare denied boolean := false;
begin
  raise notice '';
  raise notice '-- the shake run --';
  perform public.eu_test_is('an Equity Uprise editor cannot see a customer address',
    (select n from t_shake_ed), 0::bigint);
  perform public.eu_test_is('the crew can', (select n from t_shake_crew), 1::bigint);
  perform public.eu_test_is('a customer sees their own order', (select n from t_shake_buyer), 1::bigint);

  -- the price wall: there is no insert policy on orders for anybody, so
  -- the cheap-order attack cannot even be attempted from a browser
  begin
    perform public.eu_test_as('00000000-0000-0000-0000-0000000000b4','buyer@example.org');
    set local role authenticated;
    insert into public.shake_orders (code, total_cents, status) values ('SHK-CHEAP', 1, 'paid');
  exception when others then denied := true;
  end;
  reset role;
  perform public.eu_test_is('a browser cannot write an order at any price', denied, true);

  perform public.eu_test_is('the shop reads as open while the window stands',
    (select count(*) from public.shake_open_window), 1::bigint);
end $$;

-- closing the window closes the shop, without deleting anything
update public.shake_windows set status = 'closed' where note = 'test window';
do $$ begin
  perform public.eu_test_is('closing the window closes the shop',
    (select count(*) from public.shake_open_window), 0::bigint);
end $$;
