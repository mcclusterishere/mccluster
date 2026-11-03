-- Rollback for mnet_character_cast_v1.sql.
-- Removes the two functions and the receipt table. Character posts and
-- comments already written stay in network_posts / network_post_comments
-- (they are ordinary public content); the character actors and their profiles
-- stay in ops_platform_actors / network_profiles and can be disabled with
--   update public.ops_platform_actors set enabled = false where persona->>'actor_kind' = 'character';
begin;
drop function if exists public.ops_character_publish_post(uuid,uuid,text,text,text,uuid,uuid,text);
drop function if exists public.ops_character_provision(uuid,text,text,text,text,integer,jsonb);
drop table if exists public.ops_character_publications;
commit;
