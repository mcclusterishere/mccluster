-- Rollback of supabase/pending/20261119140000_mission_catalog_sources_v1.sql (migration name mission_catalog_sources_v1_rollback).
-- Never a forward migration. Owner approval required; applied as postgres with the Supabase MCP apply_migration.
-- All or nothing: it refuses (55000), changing nothing, while the project-drawdown organization differs from the row the
-- forward file wrote or anything else names it (a member's authenticity check, a group, a campaign, a member); otherwise it
-- drops the two functions and the table and deletes that organization row. It keeps the control_audit rows (the record of
-- what was shown, hidden or said, and when) and touches no mission or details row.
begin;
set local lock_timeout = '5s';
do $refuse$
declare org uuid; n_checks bigint := 0; n_groups bigint := 0; n_campaigns bigint := 0; n_members bigint := 0;
begin
  select o.id into org from public.network_organizations o where lower(o.slug) = 'project-drawdown';
  if org is null then return; end if;
  if exists (select 1 from public.network_organizations o where o.id = org
              and (o.created_by is not null or o.verification_state <> 'unverified' or o.name <> 'Project Drawdown'
                   or o.organization_type <> 'nonprofit' or o.website_url is distinct from 'https://drawdown.org/'
                   or o.description <> 'Credited source of the mission catalog drawdown in McCluster Corp''s World. This record is kept by McCluster Corp; Project Drawdown does not run it. Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19).')) then
    raise exception 'mission_catalog_sources_v1 rollback refused: the project-drawdown organization is not the row the forward file wrote; nothing changed' using errcode = '55000';
  end if;
  if to_regclass('public.authenticity_checks') is not null then select count(*) into n_checks from public.authenticity_checks a where a.organization_id = org; end if;
  if to_regclass('public.network_groups') is not null then select count(*) into n_groups from public.network_groups g where g.organization_id = org; end if;
  if to_regclass('public.action_campaigns') is not null then select count(*) into n_campaigns from public.action_campaigns c where c.organization_id = org; end if;
  if to_regclass('public.network_organization_members') is not null then select count(*) into n_members from public.network_organization_members m where m.organization_id = org; end if;
  if n_checks + n_groups + n_campaigns + n_members > 0 then
    raise exception 'mission_catalog_sources_v1 rollback refused: the project-drawdown organization is named by authenticity_checks %, network_groups %, action_campaigns %, network_organization_members %; nothing changed',
      n_checks, n_groups, n_campaigns, n_members using errcode = '55000';
  end if;
end $refuse$;
drop function if exists public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb);
drop function if exists public.mission_catalog_source_owner_state(uuid);
drop table if exists public.mission_catalog_sources;
delete from public.network_organizations o where lower(o.slug) = 'project-drawdown';
commit;
