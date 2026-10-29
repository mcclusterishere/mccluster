-- Rollback of supabase/pending/20261029100000_privilege_hygiene_v1.sql: every grant and
-- policy role back to what production held on 2026-10-29 (read from pg_class.relacl,
-- pg_proc.proacl and pg_policies that day).

set local lock_timeout = '5s';

grant truncate, references, trigger on table
  public.campaigns, public.engagement_modules, public.engagements, public.licence_scopes,
  public.modules, public.offerings, public.eu_suppressions
  to authenticated;

grant insert, update, delete on table
  public.network_blocks, public.network_bookmarks, public.network_connections, public.network_mutes,
  public.media_public_world_feed
  to anon;

alter policy inbox_channels_admin on public.inbox_channels to public;
alter policy out_campaigns_org on public.out_campaigns to public;
alter policy out_companies_org on public.out_companies to public;
alter policy out_contacts_org on public.out_contacts to public;
alter policy out_sender_owner on public.out_sender_identities to public;
alter policy out_suppressions_add on public.out_suppressions to public;
alter policy "prim3 progress insert own" on public.prim3_course_progress to public;
alter policy "prim3 progress update own" on public.prim3_course_progress to public;
alter policy "prim3 progress delete own" on public.prim3_course_progress to public;

grant execute on function public.eu_role() to anon;
grant execute on function public.mnet_is_admin() to public;
grant execute on function public.antisocial_block_legacy_proof() to public;
grant execute on function public.media_apply_geo_rule() to public;
grant execute on function public.out_lower_address() to public, anon, authenticated;
