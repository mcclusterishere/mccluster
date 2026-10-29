-- supabase/pending/20261029100000_privilege_hygiene_v1.sql, after it is applied on top of
-- supabase/tests/privilege_hygiene_v1.stub.sql (production's grants and policies of 2026-10-29).
-- Run by scripts/test-schema-hygiene-db.sh. Scratch database only.
\set ON_ERROR_STOP 1
\set desk_uid '''22222222-2222-4222-8222-222222222222'''
\set member_uid '''11111111-1111-4111-8111-111111111111'''
\set org '''aaaaaaaa-0000-4000-8000-000000000001'''

reset role;
insert into public.m_people(id) values ('99999999-9999-4999-8999-999999999999') on conflict do nothing;
insert into public.m_links(user_id, m_uid) values (:member_uid, '99999999-9999-4999-8999-999999999999') on conflict do nothing;

-- 1. authenticated cannot TRUNCATE (nor hold REFERENCES / TRIGGER); the desk still reads and writes
select t_eq(has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') or has_table_privilege('authenticated', 'public.' || t, 'REFERENCES')
            or has_table_privilege('authenticated', 'public.' || t, 'TRIGGER'), false, t || ': authenticated TRUNCATE/REFERENCES/TRIGGER')
  from unnest(array['campaigns','engagement_modules','engagements','licence_scopes','modules','offerings','eu_suppressions']) t;
select t_as('authenticated', :desk_uid, 'matthew@mccluster.org');
select t_denied('truncate public.campaigns', 'permission denied for table campaigns');
select t_denied('truncate public.eu_suppressions', 'permission denied for table eu_suppressions');
insert into public.campaigns(note) values ('desk still writes');
select t_eq(t_count('select 1 from public.campaigns') >= 1, true, 'the desk still reads campaigns');
reset role;

-- 2. anon cannot write network_* or the news view; it can still select (and sees nothing)
select t_as('anon');
select t_denied($$insert into public.network_blocks values (gen_random_uuid(), gen_random_uuid())$$, 'permission denied for table network_blocks');
select t_denied($$insert into public.network_bookmarks values (gen_random_uuid(), gen_random_uuid())$$, 'permission denied for table network_bookmarks');
select t_denied($$insert into public.network_connections values (gen_random_uuid(), gen_random_uuid(), 'pending')$$, 'permission denied for table network_connections');
select t_denied($$update public.network_mutes set muted_m_uid = null$$, 'permission denied for table network_mutes');
select t_denied($$delete from public.network_blocks$$, 'permission denied for table network_blocks');
select t_eq(t_count('select 1 from public.network_blocks'), 0::bigint, 'anon still selects network_blocks (no rows)');
select t_eq(has_table_privilege('anon', 'public.media_public_world_feed', 'INSERT') or has_table_privilege('anon', 'public.media_public_world_feed', 'UPDATE')
            or has_table_privilege('anon', 'public.media_public_world_feed', 'DELETE'), false, 'anon writes on the news view');
select t_eq(t_count('select 1 from public.media_public_world_feed'), 0::bigint, 'anon still selects the news view');
reset role;
-- a signed-in member still writes their own rows
select t_as('authenticated', :member_uid);
insert into public.network_blocks values ('99999999-9999-4999-8999-999999999999', gen_random_uuid());
select t_eq(t_count('select 1 from public.network_blocks') >= 1, true, 'member blocks someone');
reset role;

-- 3. the nine write policies now name authenticated; the two intakes stay open to anon
select t_eq(roles::text, '{authenticated}', tablename || ' ' || policyname)
  from pg_policies
 where schemaname = 'public'
   and (tablename, policyname) in (('inbox_channels','inbox_channels_admin'), ('out_campaigns','out_campaigns_org'),
        ('out_companies','out_companies_org'), ('out_contacts','out_contacts_org'), ('out_sender_identities','out_sender_owner'),
        ('out_suppressions','out_suppressions_add'), ('prim3_course_progress','prim3 progress insert own'),
        ('prim3_course_progress','prim3 progress update own'), ('prim3_course_progress','prim3 progress delete own'));
select t_eq(count(*), 9::bigint, 'nine policies retargeted') from pg_policies where schemaname = 'public' and roles = '{authenticated}'
   and policyname in ('inbox_channels_admin','out_campaigns_org','out_companies_org','out_contacts_org','out_sender_owner','out_suppressions_add',
                      'prim3 progress insert own','prim3 progress update own','prim3 progress delete own');
select t_eq(roles::text, '{anon,authenticated}', policyname) from pg_policies where policyname in ('leads_in', 'eu_perspectives_in');
select t_eq((select roles::text from pg_policies where policyname = 'prim3 progress select own'), '{public}', 'prim3 select own untouched');
select t_as('anon');
insert into public.leads(name, email) values ('A visitor', 'visitor@example.test');
insert into public.eu_perspectives(body) values ('a stranger may speak');
select t_denied($$insert into public.prim3_course_progress values ('11111111-1111-4111-8111-111111111111', 'l1')$$, 'new row violates row-level security policy%');
select t_denied($$insert into public.out_suppressions(org_id, address) values ('aaaaaaaa-0000-4000-8000-000000000001', 'X@Y.Z')$$, 'new row violates row-level security policy%');
select t_eq(t_count('select 1 from public.out_campaigns'), 0::bigint, 'anon reads no campaigns, without an error');
reset role;
select t_as('authenticated', :member_uid);
insert into public.prim3_course_progress values (:member_uid, 'l1');
update public.prim3_course_progress set lesson = 'l2' where user_id = :member_uid;
select t_eq(t_count('select 1 from public.prim3_course_progress'), 1::bigint, 'member keeps their own progress');
delete from public.prim3_course_progress where user_id = :member_uid;
-- 4. trigger functions still fire for a caller who holds no EXECUTE on them
select t_eq(has_function_privilege('authenticated', 'public.out_lower_address()', 'EXECUTE'), false, 'authenticated EXECUTE out_lower_address');
insert into public.out_suppressions(org_id, address) values (:org, 'Someone@Example.TEST');
reset role;
select t_eq((select address from public.out_suppressions order by id desc limit 1), 'someone@example.test', 'out_lower_address still lowercases');
select t_as('authenticated', :member_uid);
insert into public.action_proofs(kind) values ('photo');
select t_denied($$insert into public.action_proofs(kind) values ('legacy')$$, 'legacy proof refused');
insert into public.media_articles(title) values ('pinned by the trigger');
reset role;
select t_eq((select pinned from public.media_articles order by id desc limit 1), true, 'media_apply_geo_rule still fires');

-- 4. helpers: anon loses eu_role and mnet_is_admin; signed-in members keep them
select t_eq(has_function_privilege('anon', 'public.eu_role()', 'EXECUTE'), false, 'anon EXECUTE eu_role');
select t_eq(has_function_privilege('anon', 'public.mnet_is_admin()', 'EXECUTE'), false, 'anon EXECUTE mnet_is_admin');
select t_eq(has_function_privilege('anon', 'public.antisocial_block_legacy_proof()', 'EXECUTE'), false, 'anon EXECUTE antisocial_block_legacy_proof');
select t_eq(has_function_privilege('anon', 'public.media_apply_geo_rule()', 'EXECUTE'), false, 'anon EXECUTE media_apply_geo_rule');
select t_eq(has_function_privilege('anon', 'public.out_lower_address()', 'EXECUTE'), false, 'anon EXECUTE out_lower_address');
select t_as('anon');
select t_denied('select public.eu_role()', 'permission denied for function eu_role');
select t_denied('select public.mnet_is_admin()', 'permission denied for function mnet_is_admin');
reset role;
select t_as('authenticated', :desk_uid, 'matthew@mccluster.org');
select t_eq(public.eu_role(), 'admin', 'the desk still asks eu_role()');
select t_eq(public.mnet_is_admin(), true, 'the owner still asks mnet_is_admin()');
reset role;

-- why eu_is_admin() stays executable by anon: an anon read whose policy calls it
select t_as('anon');
select t_eq(t_count('select 1 from public.action_missions'), 1::bigint, 'anon reads the open mission');
reset role;
begin;
revoke execute on function public.eu_is_admin() from anon;
select t_as('anon');
select t_denied('select 1 from public.action_missions', 'permission denied for function eu_is_admin');
rollback;
reset role;
select 'privilege_hygiene_v1: ok' as result;
