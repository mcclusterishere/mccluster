-- Read-only catalog preflight; does not inspect or modify content or auth rows.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proacl as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'owner_front_snapshot_v1','owner_front_publish_v1','owner_front_draft_save_v1',
 'owner_front_draft_discard_v1','owner_front_validate_v1','mnet_is_admin',
 'current_m_uid','mnet_admin_m_uids','site_content_set','site_content_revert');
select c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('site_content','site_content_history','owner_front_drafts');
select tgname,pg_get_triggerdef(oid) from pg_trigger
where tgrelid=to_regclass('public.site_content') and not tgisinternal;
-- In a real authenticated owner session only, use the existing read-only
-- mnet_is_admin() or owner_front_snapshot_v1() RPC; never forge a session claim.
