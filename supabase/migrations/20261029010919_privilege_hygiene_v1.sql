-- Client privilege hygiene, v1 (finding 2 of
-- docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md).
--
-- Purpose: take away grants and policy roles production's API roles hold but no reviewed
-- migration meant them to, without changing what any signed-out or signed-in caller can
-- actually do today. Every statement below was checked against production's catalogs
-- (read-only, 2026-10-29) and against the repo's callers (js/, root pages, workers/,
-- supabase/functions/).
--
--   1. authenticated loses TRUNCATE, REFERENCES and TRIGGER on campaigns,
--      engagement_modules, engagements, licence_scopes, modules, offerings and
--      eu_suppressions. TRUNCATE is not subject to RLS; PostgREST cannot issue it, but no
--      migration granted it.
--   2. anon loses INSERT, UPDATE and DELETE on network_blocks, network_bookmarks,
--      network_connections, network_mutes (their policies are all `to authenticated`, so
--      anon could never write a row) and on the view media_public_world_feed (a join, not
--      updatable). anon keeps SELECT; the policies still return it nothing.
--   3. Nine write policies that applied to the `public` role now name `authenticated`:
--      inbox_channels_admin, out_campaigns_org, out_companies_org, out_contacts_org,
--      out_sender_owner, out_suppressions_add and the three "prim3 progress … own" writes.
--      Each expression already needs auth.uid(), eu_is_admin() or org membership, so anon
--      was refused; now anon is not even evaluated against them. Expressions unchanged.
--      KEPT for anon on purpose: eu_perspectives_in and leads_in. They are the public
--      intake (js/eu-api.js drop(): "a stranger may speak"; the contact forms' lead drop)
--      and allow profile_id/company_id null for a signed-out visitor.
--   4. EXECUTE is revoked from anon (and from PUBLIC, through which anon also held it) on
--      eu_role(), mnet_is_admin() and the trigger functions antisocial_block_legacy_proof()
--      and media_apply_geo_rule(), and from PUBLIC, anon and authenticated on the trigger
--      function out_lower_address(). A trigger function runs when its trigger fires
--      whatever the inserting role's EXECUTE (supabase/tests/privilege_hygiene_v1.behaviour.sql
--      proves it), so the inserts that fire them are unaffected. eu_role() is called by
--      js/eu-api.js role(), which already answers "visitor" when the call fails;
--      mnet_is_admin() is only called for a signed-in member (js/mnet.js paintNewsroom).
--      KEPT for anon on purpose, and why:
--        eu_is_admin(), eu_is_staff(), shake_is_crew(): RLS policies that anon is subject
--          to call them (action_campaigns, action_cohorts, action_ledger, action_missions,
--          song_tests, events, events_lean, eu_fellowships, eu_topics, shake_products,
--          shake_stops). Postgres checks EXECUTE on every function in an applicable
--          policy, so revoking them would turn those public reads into "permission
--          denied". Narrowing them needs the policies split by role first.
--        eu_match_fellowships(uuid, integer, text[]): js/eu-api.js match() calls it for a
--          signed-out visitor on purpose ("no account required to get a real answer").
--
-- Dependency order: none; applies to production as it is today. Promotion position:
-- supabase/pending/PROMOTION-ORDER.md, group 0 (after step 0, before every other file).
-- Independent of 20261029100200_rls_initplan_select_wrap_v1.sql (that one rewrites the
-- prim3 policy expressions; this one only their roles), in either order.
--
-- Rollback: supabase/pending/20261029100000_privilege_hygiene_v1.rollback.sql restores
-- every grant and policy role exactly as production had it on 2026-10-29.
-- Test: bash scripts/test-schema-hygiene-db.sh (scratch Postgres, never production).

set local lock_timeout = '5s';

-- 1. TRUNCATE / REFERENCES / TRIGGER
revoke truncate, references, trigger on table
  public.campaigns, public.engagement_modules, public.engagements, public.licence_scopes,
  public.modules, public.offerings, public.eu_suppressions
  from authenticated;

-- 2. anon writes that no policy admits
revoke insert, update, delete on table
  public.network_blocks, public.network_bookmarks, public.network_connections, public.network_mutes,
  public.media_public_world_feed
  from anon;

-- 3. write policies scoped to the role their expressions already require
alter policy inbox_channels_admin on public.inbox_channels to authenticated;
alter policy out_campaigns_org on public.out_campaigns to authenticated;
alter policy out_companies_org on public.out_companies to authenticated;
alter policy out_contacts_org on public.out_contacts to authenticated;
alter policy out_sender_owner on public.out_sender_identities to authenticated;
alter policy out_suppressions_add on public.out_suppressions to authenticated;
alter policy "prim3 progress insert own" on public.prim3_course_progress to authenticated;
alter policy "prim3 progress update own" on public.prim3_course_progress to authenticated;
alter policy "prim3 progress delete own" on public.prim3_course_progress to authenticated;

-- 4. helpers and trigger functions anon has no reason to call
revoke execute on function public.eu_role() from anon;
revoke execute on function public.mnet_is_admin() from public, anon;
grant execute on function public.mnet_is_admin() to authenticated, service_role;
revoke execute on function public.antisocial_block_legacy_proof() from public, anon;
grant execute on function public.antisocial_block_legacy_proof() to service_role;
revoke execute on function public.media_apply_geo_rule() from public, anon;
grant execute on function public.media_apply_geo_rule() to service_role;
revoke execute on function public.out_lower_address() from public, anon, authenticated;
grant execute on function public.out_lower_address() to service_role;
